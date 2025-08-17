"use client";

import React, { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { create, all, MathNode } from "mathjs";

const math = create(all);

type GenVar = {
  name: string;             // ユーザー変数名 (Unicode可)
  order: number;            // 階数 (0, 1, 2 など)
  initial: string;          // 初期値
  initialDot?: string;      // 初期速度 (1階以上で有効)
  initialDDot?: string;     // 初期加速度 (2階以上で有効)
  expr: string;             // d^order/dt^order の右辺
};

const AXIS_COLORS = ["#ff4d4d", "#4dff6a", "#4da8ff"]; // X:red, Y:green, Z:blue
// デフォルト色
const DEFAULT_PARTICLE_COLOR = "#ff4d4d";

export default function ODESimulatorCanvas(){
  // --- UI / variables ---
  // 次元指定を削除。常にvars.lengthを使う。
  const [vars, setVars] = useState<GenVar[]>(() => [
    { name: "x", order: 1, initial: "1", expr: "10*(y-x)" },
    { name: "y", order: 1, initial: "0", expr: "x*(28-z)-y" },
    { name: "z", order: 1, initial: "0", expr: "x*y-8/3*z" },
  ]);

  // 軸表示・質点色・軌跡色
  const [showAxes, setShowAxes] = useState<boolean>(true);
  const [particleColor, setParticleColor] = useState<string>(
    DEFAULT_PARTICLE_COLOR
  );

  const [running, setRunning] = useState(false);
  const [dt, setDt] = useState<number>(0.01);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [trailLength, setTrailLength] = useState<number>(500);
  const [isTrailInfinite, setIsTrailInfinite] = useState<boolean>(true); // default infinite
  const [showTrail, setShowTrail] = useState<boolean>(true); // toggle on/off

  // compiled mathjs nodes for RHS
  const compiledRef = useRef<(MathNode | null)[]>([]);
  const expandedVarNamesRef = useRef<string[]>([]); // expanded state variable names (e.g. x, x_dot, y, ...)
  const stateRef = useRef<number[]>([]); // numeric state vector matching expandedVarNamesRef
  const genHistoryRef = useRef<{ time: number; values: number[] }[]>([]);
  const timeRef = useRef<number>(0);

  // For rendering:
  const [particlePos, setParticlePos] = useState<[number, number, number]>([0, 0, 0]);
  const [variableTrails, setVariableTrails] = useState<Record<string, { x: number; y: number; z: number }[]>>({});
  const rafRef = useRef<number | null>(null);

  // helpers
  // clampDim削除

function renderVarName(name: string): string {
  return name;
}

function preprocessExpr(expr: string): string {
  if (!expr) return expr;
  return expr
    .replace(/([a-zA-Z_][a-zA-Z0-9_]*)'''/g, "$1_dddot") // 3階
    .replace(/([a-zA-Z_][a-zA-Z0-9_]*)''/g, "$1_ddot")   // 2階
    .replace(/([a-zA-Z_][a-zA-Z0-9_]*)'/g, "$1_dot");   // 1階
}

  const buildSystem = () => {
    const newVars = vars.map(v => ({ ...v }));

    const expanded: string[] = [];
    newVars.forEach((g) => {
      const base = g.name || `x${expanded.length + 1}`;
      expanded.push(base);
      for (let o = 1; o < (g.order || 0); o++) {
        expanded.push(`${base}_${"d".repeat(o)}ot`);
      }
    });
    expandedVarNamesRef.current = expanded;

    const exprs: string[] = [];
    newVars.forEach((g) => {
      const base = g.name || `x${exprs.length + 1}`;
      if (g.order === 0) {
        exprs.push("0");
      } else if (g.order === 1) {
        exprs.push(preprocessExpr(g.expr) || "0");
      } else {
        for (let o = 1; o < g.order; o++) {
          exprs.push(`${base}_${"d".repeat(o)}ot`);
        }
        exprs.push(preprocessExpr(g.expr) || "0");
      }
    });

    compiledRef.current = exprs.map(e => {
      try {
        return compileExpression(e);
      } catch {
        return null;
      }
    });

    const state0: number[] = [];
    newVars.forEach((g) => {
      if (g.order === 0) {
        state0.push(Number(g.initial) || 0);
        return;
      }
      for (let o = 0; o < g.order; o++) {
        if (o === 0) state0.push(Number(g.initial) || 0);
        else if (o === 1) state0.push(Number(g.initialDot) || 0);
        else if (o === 2) state0.push(Number(g.initialDDot) || 0);
        else state0.push(0);
      }
    });

    if (genHistoryRef.current.length > 0) {
      const last = genHistoryRef.current[genHistoryRef.current.length - 1];
      if (Math.abs(last.time - timeRef.current) < 1e-12) {
        stateRef.current = [...last.values];
      } else if (last.time <= timeRef.current) {
        stateRef.current = last.values.slice(0, state0.length).concat(state0.slice(last.values.length));
      } else {
        stateRef.current = state0;
      }
    } else {
      stateRef.current = state0;
    }
  };

  // compile helper
  function compileExpression(expr: string): MathNode | null {
    if (!expr || expr.trim() === "") return null;
    try {
      // parse but do not compile to function yet
      return math.parse(preprocessExpr(expr));
    } catch (err) {
      console.warn("parse error", expr, err);
      return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function evaluateNode(node: MathNode | null, scope: Record<string, any>): number {
    if (!node) return 0;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const compiled = (node as any).compile ? (node as any).compile() : node;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = typeof compiled.evaluate === "function" ? compiled.evaluate(scope) : compiled(scope);
      if (typeof v === "number") return v;
      if (Array.isArray(v)) return v[0] ?? 0;
      return Number(v) || 0;
    } catch (err) {
      console.warn("eval error", err);
      return 0;
    }
  }

  // build f(y,t) from compiledRef and expandedVarNamesRef
  const evalDeriv = (y: number[], tNow: number) => {
    const expanded = expandedVarNamesRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scope: Record<string, any> = { t: tNow };
    // constants
    // expose constants if needed; keep same as earlier
    scope.eps0 = 8.8541878128e-12;
    scope.mu0 = 4 * Math.PI * 1e-7;
    scope.k = 8.9875517923e9;
    scope.g = 9.80665;
    scope.G = 6.67430e-11;

    // expose vars by name and var_dot names
    for (let i = 0; i < expanded.length; i++) {
      scope[expanded[i]] = y[i];
    }
    // also map base names to their value (if both present, base is first occurrence)
    const baseMap: Record<string, number> = {};
    expanded.forEach((nm, i) => {
      const base = nm.split('_')[0];
      if (baseMap[base] === undefined) baseMap[base] = y[i];
    });
    Object.entries(baseMap).forEach(([k, v]) => { scope[k] = v; });

    // also provide helpers that reference particles if user wants (for compatibility)
    scope.dist = (i: number, j: number) => {
      // compute from current particle positions (mapping variables to axes)
      const x = y[0] ?? 0;
      const yy = y[1] ?? 0;
      // particle indexing uses 1-based like earlier computeDist? simple Euclidean with available dims
      return Math.hypot(x - (i === 2 ? yy : 0), yy - (j === 2 ? y[1] : 0)); // simple placeholder (user likely won't use)
    };
    scope.dx = (_i: number, _j: number) => 0;
    scope.dy = (_i: number, _j: number) => 0;
    scope.dz = (_i: number, _j: number) => 0;
    scope.rvec = (_i: number, _j: number) => [0,0,0];

    const out: number[] = [];
    for (let i = 0; i < compiledRef.current.length; i++) {
      const node = compiledRef.current[i];
      const v = evaluateNode(node, scope);
      out.push(v);
    }
    return out;
  };

  // RK4 step helper
  const addScaled = (a: number[], b: number[], scale: number) => a.map((v, i) => v + (b[i] ?? 0) * scale);
  const rk4 = (state: number[], h: number, tNow: number) => {
    const k1 = evalDeriv(state, tNow);
    const s1 = addScaled(state, k1, h / 2);
    const k2 = evalDeriv(s1, tNow + h / 2);
    const s2 = addScaled(state, k2, h / 2);
    const k3 = evalDeriv(s2, tNow + h / 2);
    const s3 = addScaled(state, k3, h);
    const k4 = evalDeriv(s3, tNow + h);
    const newState = state.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    return newState;
  };

  useEffect(() => {
    if (!running) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    let last = performance.now();
    let accumulated = 0;

    const step = (now: number) => {
      rafRef.current = requestAnimationFrame(step);
      const elapsed = (now - last) / 1000;
      last = now;
      accumulated += elapsed * playbackSpeed;

      // integrate in fixed dt steps
      const stepSize = dt;
      let steps = Math.floor(accumulated / stepSize);
      if (steps <= 0) return;
      // cap steps to avoid spiral-of-death
      steps = Math.min(steps, 10);

      for (let s = 0; s < steps; s++) {
        // perform one rk4 step
        const tNow = timeRef.current;
        const newState = rk4(stateRef.current, stepSize, tNow);
        stateRef.current = newState;
        timeRef.current += stepSize;
        genHistoryRef.current.push({ time: timeRef.current, values: newState.slice() });
        if (genHistoryRef.current.length > 2000) genHistoryRef.current.shift();

        // update particle position: map top N base variables to x,y,z
        const expanded = expandedVarNamesRef.current;
        // base values: take first occurrence of base names in expanded order
        const baseVals: number[] = [];
        const seenBases = new Set<string>();
        for (let i = 0; i < expanded.length && baseVals.length < 3; i++) {
          const nm = expanded[i];
          const base = nm.split('_')[0];
          if (!seenBases.has(base)) {
            seenBases.add(base);
            baseVals.push(stateRef.current[i] ?? 0);
          }
        }
        while (baseVals.length < 3) baseVals.push(0);
        setParticlePos([baseVals[0], baseVals[1], baseVals[2]]);

        // update variable trails: each base variable has trail keyed by var name
        setVariableTrails(prev => {
          if (!showTrail) { // 軌跡非表示の場合
            return {}; // 全ての軌跡をクリア
          }

          const next = { ...prev };
          // ensure using current vars (first vars.length bases)
          for (let i = 0; i < vars.length; i++) {
            const baseName = vars[i].name || `x${i+1}`;
            const key = `v:${baseName}`;
            const pxv = baseVals[0] ?? 0;
            const pyv = baseVals[1] ?? 0;
            const pzv = baseVals[2] ?? 0;
            next[key] = [...(next[key] || []), { x: pxv, y: pyv, z: pzv }];
            if (!isTrailInfinite && next[key].length > trailLength) { // 無限でない場合のみ制限
              next[key] = next[key].slice(-trailLength);
            }
          }
          return next;
        });

        accumulated -= stepSize;
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, dt, playbackSpeed, trailLength]);

  // UI actions
  const toggleRunning = () => setRunning(r => !r);

  const resetAll = () => {
    setRunning(false);
    timeRef.current = 0;
    genHistoryRef.current = [];
    setVariableTrails({});
    // reinitialize state from initials
    buildSystem();
    const s = stateRef.current;
    const px = s[0] ?? 0, py = s[1] ?? 0, pz = s[2] ?? 0;
    setParticlePos([px, py, pz]);
  };

  const updateVar = (i: number, patch: Partial<GenVar>) => {
    if (typeof patch.expr === 'string') {
      patch.expr = patch.expr.replace(/=/g, ''); // Remove all '='
    }
    setVars(prev => {
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const addVariable = () => {
    if (vars.length >= 3) return;
    setVars(prev => [
      ...prev,
      { name: `x${prev.length+1}`, order: 1, initial: "0", expr: "0" }
    ]);
  };

  const removeVariable = (i: number) => {
    setVars(prev => {
      const next = prev.slice();
      next.splice(i, 1);
      return next;
    });
  };

  const applyAndCompile = () => {
    // build system and compile expressions into math nodes
    buildSystem();
    // reset history / time
    timeRef.current = 0;
    genHistoryRef.current = [];
    setVariableTrails({});
    // set initial particle pos
    const s = stateRef.current;
    setParticlePos([s[0] ?? 0, s[1] ?? 0, s[2] ?? 0]);
  };

  // 色: ユーザー指定 or デフォルト
  const containerColor = () => particleColor || DEFAULT_PARTICLE_COLOR;
  // 軌跡色: 質点色を透明度0.3で
  function trailColor(): string {
    const c = containerColor();
    // HEX (#rrggbb) → rgba
    if (c.startsWith("#") && c.length === 7) {
      const r = parseInt(c.slice(1, 3), 16);
      const g = parseInt(c.slice(3, 5), 16);
      const b = parseInt(c.slice(5, 7), 16);
      return `rgba(${r},${g},${b},0.3)`;
    }
    // fallback
    return c;
  }
  const variableUiColor = (index: number) => AXIS_COLORS[index % AXIS_COLORS.length];

  // AxesHelper component definition
  const AxesHelper = () => {
    const length = 1000; // Represents "infinite" length
    if (!showAxes) return null;
    return (
      <>
        {/* X-axis (Red) */}
        <Line points={[-length, 0, 0, length, 0, 0]} color={AXIS_COLORS[0]} lineWidth={2} />
        {/* Y-axis (Green) */}
        <Line points={[0, -length, 0, 0, length, 0]} color={AXIS_COLORS[1]} lineWidth={2} />
        {/* Z-axis (Blue) */}
        <Line points={[0, 0, -length, 0, 0, length]} color={AXIS_COLORS[2]} lineWidth={2} />
      </>
    );
  };

  // Rendering JSX
  return (
    <div className="flex gap-4 p-4 h-screen bg-slate-900 text-white">
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button className="px-3 py-1 rounded bg-green-500" onClick={toggleRunning}>{running ? "停止" : "再生"}</button>
          <button className="px-3 py-1 rounded bg-blue-500" onClick={resetAll}>リセット</button>
          {/* 次元選択UI削除 */}
          <label className="text-sm">dt:
            <input className="ml-1 w-20 rounded bg-slate-700 text-white px-1" value={String(dt)} onChange={(e) => setDt(Number(e.target.value) || dt)} />
          </label>
          <label className="text-sm">速度:
            <input type="range" min="0.1" max="5" step="0.1" value={playbackSpeed} onChange={(e) => setPlaybackSpeed(Number(e.target.value))} className="mx-2" />
            <span>{playbackSpeed.toFixed(1)}x</span>
          </label>
          <button className="ml-auto bg-indigo-600 px-2 py-1 rounded" onClick={applyAndCompile}>式を適用</button>
        </div>

        <div className="flex-1 min-h-0 border border-slate-700 rounded overflow-hidden bg-slate-950">
          {/* Canvas */}
          <Canvas camera={{ position: [6, 6, 6], fov: 50 }}>
            <color attach="background" args={['#0b1220']} />
            <hemisphereLight intensity={0.5} />
            <ambientLight intensity={0.3} />
            <pointLight position={[10, 10, 10]} intensity={0.6} />
            <Grid infiniteGrid fadeDistance={30} fadeStrength={5} />
            {/* Axes helper */}
            <AxesHelper />
            {/* Particle */}
            <mesh position={particlePos}>
              <sphereGeometry args={[0.2, 32, 32]} />
              <meshStandardMaterial color={containerColor()} />
            </mesh>
            {/* variable trails */}
            {Object.entries(variableTrails).map(([key, trail]) => {
              if (!trail || trail.length < 2) return null;
              const points = trail.map(t => new THREE.Vector3(t.x, t.y, t.z));
              const col = trailColor();
              return <Line key={key} points={points} lineWidth={2} color={col} />;
            })}
            <OrbitControls />
          </Canvas>
        </div>

        <div className="mt-2 flex gap-2 items-center text-xs flex-wrap">
          <div>時間: {timeRef.current.toFixed(3)} s</div>
          <label className="flex items-center gap-1 ml-auto">軌跡長:
            <input className="ml-1 w-20 rounded bg-slate-700 text-white px-1" value={String(trailLength)} onChange={(e) => setTrailLength(Number(e.target.value) || trailLength)} />
          </label>
          <label className="flex items-center gap-1 ml-4">
            <input type="checkbox" checked={isTrailInfinite} onChange={(e) => setIsTrailInfinite(e.target.checked)} />
            軌跡無限長
          </label>
          <label className="flex items-center gap-1 ml-2">
            <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} />
            軌跡表示
          </label>
          <label className="flex items-center gap-1 ml-2">
            <input type="checkbox" checked={showAxes} onChange={e => setShowAxes(e.target.checked)} />
            軸表示
          </label>
          <label className="flex items-center gap-1 ml-2">
            質点色:
            <input
              type="color"
              className="ml-1 w-6 h-6 rounded border-0 p-0"
              value={particleColor}
              onChange={e => setParticleColor(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* Right panel: variable table */}
      <div className="w-2/5 flex flex-col gap-4 overflow-y-auto h-full pr-2">
        <div className="flex items-center gap-2">
          <button className="px-3 py-1 rounded bg-purple-600" onClick={addVariable} disabled={vars.length >= 3}>変数を追加</button>
          <div className="text-xs text-gray-300">（上から順に 赤, 緑, 青 軸に対応）</div>
        </div>

        {vars.slice(0, 3).map((g, i) => (
          <div key={i} className="border border-slate-700 rounded p-3" style={{ background: variableUiColor(i) + "22" }}>
            <div className="flex items-center justify-between">
              <strong style={{ color: variableUiColor(i) }}>
                {`${i+1}. ${renderVarName(g.name || `var${i+1}`)}`}
              </strong>
              <div className="flex items-center gap-2">
                <label className="text-xs">階数:
                  <select
                    className="ml-1 bg-slate-700 rounded px-1"
                    value={g.order ?? 1}
                    onChange={e => updateVar(i, { order: Number(e.target.value) })}
                  >
                    <option value={0}>0階</option>
                    <option value={1}>1階</option>
                    <option value={2}>2階</option>
                    <option value={3}>3階</option>
                  </select>
                </label>
                <button className="bg-red-600 px-2 py-0.5 rounded text-sm" onClick={() => removeVariable(i)}>削除</button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 items-center">
              <div>
                <div className="text-xs">変数名</div>
                <input className="w-full rounded bg-slate-700 px-1" value={g.name} onChange={(e) => updateVar(i, { name: e.target.value })} />
              </div>
              <div>
                <div className="text-xs">初期値 ({g.name})</div>
                <input className="w-full rounded bg-slate-700 px-1" value={g.initial} onChange={(e) => updateVar(i, { initial: e.target.value })} />
              </div>
              {(g.order ?? 1) >= 2 && (
                <div>
                  <div className="text-xs">初期速度 ({g.name}˙)</div>
                  <input className="w-full rounded bg-slate-700 px-1" value={g.initialDot ?? ""} onChange={(e) => updateVar(i, { initialDot: e.target.value })} />
                </div>
              )}
              {(g.order ?? 1) >= 3 && (
                <div>
                  <div className="text-xs">初期加速度 ({g.name}¨)</div>
                  <input className="w-full rounded bg-slate-700 px-1" value={g.initialDDot ?? ""} onChange={(e) => updateVar(i, { initialDDot: e.target.value })} />
                </div>
              )}
            </div>
            <div className="mt-2">
              <div className="text-xs">微分方程式(右辺)</div>
              <textarea className="w-full rounded bg-slate-700 px-1 py-1 mt-1 text-sm" value={g.expr} onChange={(e) => updateVar(i, { expr: e.target.value })} rows={3} />
              <div className="mt-1 text-xs text-gray-300">
                {(g.order ?? 1) === 0
                  ? "これは定数です。"
                  : `d^${g.order}${renderVarName(g.name)}/dt^${g.order} = の右辺を入力してください。`
                }<br />
                {/* ギリシャ文字は「theta」「omega」「gamma」などASCII綴りで入力できます（例: theta → θ, omega → ω）。<br /> */}
                式中では t、定数 eps0, mu0, k, g, G を使用可能。<br />
                微分はアポストロフィで入力してください。<br />
              </div>
            </div>
          </div>
        ))}

        <div className="mt-2 flex gap-2">
          <button className="bg-indigo-600 px-3 py-1 rounded" onClick={applyAndCompile}>初期値・式を適用</button>
          <button className="bg-gray-600 px-3 py-1 rounded" onClick={() => { /* set particle to initial immediately */ buildSystem(); const s = stateRef.current; setParticlePos([s[0] ?? 0, s[1] ?? 0, s[2] ?? 0]); }}>Set Initials</button>
        </div>

      </div>
    </div>
  );
}