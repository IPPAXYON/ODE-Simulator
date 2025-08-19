"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { create, all, MathNode } from "mathjs";
import GraphView from "./GraphView";
import PoincareView from "./PoincareView";
import { Particle, GenVar, PoincareConfig } from "./types"; // Import PoincareConfig

const math = create(all);

const AXIS_COLORS = ["#ff4d4d", "#4dff6a", "#4da8ff"]; // X:red, Y:green, Z:blue
const DEFAULT_PARTICLE_COLOR = "#ff4d4d";

export default function ODESimulatorCanvas() {
  // ===== Particles state =====
  const [particles, setParticles] = useState<Particle[]>(() => [
    {
      id: 1,
      color: DEFAULT_PARTICLE_COLOR,
      vars: [
        { name: "x", order: 1, initial: "1", expr: "10*(y-x)" },
        { name: "y", order: 1, initial: "0", expr: "x*(28-z)-y" },
        { name: "z", order: 1, initial: "0", expr: "x*y-8/3*z" },
      ],
    },
  ]);
  const [activePid, setActivePid] = useState<number>(1);

  // ===== View Control =====
  const [view, setView] = useState<"simulator" | "graph">("simulator");
  const [selectedVarIndex, setSelectedVarIndex] = useState<number | null>(null);
  const [showPoincare, setShowPoincare] = useState<boolean>(false); // New state for Poincare view

  // Poincare Section states
  const [poincareConfig, setPoincareConfig] = useState<PoincareConfig>({
    mode: "time",
    period: "2 * PI",
    planeVar: "",
    planeValue: "0",
    direction: "positive",
    plotX: "p1_x", // Default to x
    plotY: "p1_y", // Default to y
  });
  const [poincarePoints, setPoincarePoints] = useState<THREE.Vector3[]>([]);

  // ===== Display mode & phase config =====
  const [displayMode, setDisplayMode] = useState<"particle" | "phase">("particle");
  // phaseConfig: { [particleId]: {x: string, y: string, z?: string} }
  const [phaseConfig, setPhaseConfig] = useState<Record<number, {x: string, y: string, z?: string}>>({});

  // 軸表示・軌跡関連
  const [showAxes, setShowAxes] = useState<boolean>(true);
  const [running, setRunning] = useState(false);
  const [dt, setDt] = useState<number>(0.01);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [trailLength, setTrailLength] = useState<number>(500);
  const [isTrailInfinite, setIsTrailInfinite] = useState<boolean>(true);
  const [showTrail, setShowTrail] = useState<boolean>(true);

  // ===== Numeric engine refs =====
  const compiledRef = useRef<(MathNode | null)[]>([]);
  const exprParticleIdsRef = useRef<number[]>([]); // 各式がどの粒子に属するか
  const expandedVarNamesRef = useRef<string[]>([]); // 例: p1_x, p1_x_dot, p2_y, ...
  const nameToIndexRef = useRef<Record<string, number>>({});
  const stateRef = useRef<number[]>([]);
  const genHistoryRef = useRef<{ time: number; values: number[] }[]>([]);
  const timeRef = useRef<number>(0);

  // ===== Render state =====
  const [particlePos, setParticlePos] = useState<Record<number, [number, number, number]>>({});
  const [trails, setTrails] = useState<Record<number, { x: number; y: number; z: number }[]>>({});
  const rafRef = useRef<number | null>(null);

  // ===== Helpers =====
  function preprocessExpr(expr: string): string {
    if (!expr) return expr;
    return expr
      .replace(/([a-zA-Z_][a-zA-Z0-9_]*)'''/g, "$1_dddot")
      .replace(/([a-zA-Z_][a-zA-Z0-9_]*)''/g, "$1_ddot")
      .replace(/([a-zA-Z_][a-zA-Z0-9_]*)'/g, "$1_dot");
  }
  function compileExpression(expr: string): MathNode | null {
    if (!expr || expr.trim() === "") return null;
    try {
      return math.parse(preprocessExpr(expr));
    } catch (err) {
      console.warn("parse error", expr, err);
      return null;
    }
  }

  // UI util
  const activeParticle = useMemo(() => particles.find(p => p.id === activePid) ?? particles[0], [particles, activePid]);
  const variableUiColor = (index: number) => AXIS_COLORS[index % AXIS_COLORS.length];

  // ===== System builder =====
  const buildSystem = () => {
    const expanded: string[] = [];
    const exprs: string[] = [];
    const exprPids: number[] = [];
    const state0: number[] = [];

    // 変数展開（prefix: p{id}_）
    particles.forEach((p) => {
      p.vars.slice(0, 3).forEach((g) => {
        const base = `p${p.id}_${g.name || "x"}`;
        if (g.order > 0) expanded.push(base);
        for (let o = 1; o < (g.order || 0); o++) {
          expanded.push(`${base}_${"d".repeat(o)}ot`);
        }
      });
    });
    expandedVarNamesRef.current = expanded;

    // 式の並び（高階は連立1階に展開: x_dot = v, v_dot = f など）
    particles.forEach((p) => {
      p.vars.slice(0, 3).forEach((g) => {
        const base = `p${p.id}_${g.name || "x"}`;
        if (g.order === 0) {
          // 定数は微分なし
        } else if (g.order === 1) {
          exprs.push(preprocessExpr(g.expr) || "0");
          exprPids.push(p.id);
        } else {
          // 1階〜(order-1)階は"その次の導関数"に等しい形
          for (let o = 1; o < g.order; o++) {
            exprs.push(`${base}_${"d".repeat(o)}ot`);
            exprPids.push(p.id);
          }
          // 最後に与えられた右辺
          exprs.push(preprocessExpr(g.expr) || "0");
          exprPids.push(p.id);
        }
      });
    });

    compiledRef.current = exprs.map((e) => compileExpression(e));
    exprParticleIdsRef.current = exprPids;

    // 初期状態ベクトル
    const s0: number[] = [];
    particles.forEach((p) => {
      p.vars.slice(0, 3).forEach((g) => {
        if (g.order === 0) return;
        for (let o = 0; o < g.order; o++) {
          if (o === 0) s0.push(Number(g.initial) || 0);
          else if (o === 1) s0.push(Number(g.initialDot) || 0);
          else if (o === 2) s0.push(Number(g.initialDDot) || 0);
          else s0.push(0);
        }
      });
    });
    stateRef.current = s0;

    // name -> index マップ
    const map: Record<string, number> = {};
    expanded.forEach((nm, i) => { map[nm] = i; });
    nameToIndexRef.current = map;
    console.log("DEBUG: nameToIndexRef.current:", nameToIndexRef.current);
  };

  // ===== Evaluator =====
  interface BaseScopeConstants {
    eps0: number;
    mu0: number;
    k: number;
    g: number;
    G: number;
  }

  interface Scope extends BaseScopeConstants {
    t: number;
    [key: string]: number | ((...args: number[]) => number) | ((...args: number[]) => number[]);
  }

  // Define baseScope here
  const baseScope: BaseScopeConstants = { // Omit 't' as it's dynamic
    eps0: 8.8541878128e-12,
    mu0: 4 * Math.PI * 1e-7,
    k: 8.9875517923e9,
    g: 9.80665,
    G: 6.67430e-11,
  };

  function evaluateNode(node: MathNode | null, scope: Scope): number {
    if (!node) return 0;
    try {
      const compiled = node.compile();
      const v = compiled.evaluate(scope);
      if (typeof v === "number") return v;
      if (Array.isArray(v)) return v[0] ?? 0;
      return Number(v) || 0;
    } catch (err) {
      console.warn("eval error", err);
      return 0;
    }
  }

  const evalDeriv = (y: number[], tNow: number) => {
    console.log("DEBUG: evalDeriv input y:", y); // New line
    const expanded = expandedVarNamesRef.current;
    const scopeBase: Scope = { // This will now include baseScope
      t: tNow,
      ...baseScope, // Spread baseScope here
    };

    // すべての展開名をスコープに入れる（p{id}_x など）
    for (let i = 0; i < expanded.length; i++) scopeBase[expanded[i]] = y[i];

    // ユーティリティ（必要に応じて拡張）
    scopeBase.dist = (i: number, j: number) => {
      const pi = particles[i] ?? particles[0];
      const pj = particles[j] ?? particles[0];
      const ppos = (pid: number) => particlePos[pid] || [0, 0, 0];
      const a = ppos(pi?.id ?? 0), b = ppos(pj?.id ?? 0);
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };

    const out: number[] = [];
    for (let i = 0; i < compiledRef.current.length; i++) {
      const node = compiledRef.current[i];
      const pid = exprParticleIdsRef.current[i];

      // 粒子ごとローカル名エイリアス（x, y, z, x_dot など）
      const localScope: Scope = { ...scopeBase };
      const p = particles.find((pp) => pp.id === pid);
      if (p) {
        p.vars.slice(0, 3).forEach((g) => {
          const base = `p${p.id}_${g.name}`;
          const idx0 = nameToIndexRef.current[base];
          if (idx0 != null) localScope[g.name] = y[idx0];
          // 導関数も解決
          const d1 = nameToIndexRef.current[`${base}_dot`];
          if (d1 != null) localScope[`${g.name}_dot`] = y[d1];
          const d2 = nameToIndexRef.current[`${base}_ddot`];
          if (d2 != null) localScope[`${g.name}_ddot`] = y[d2];
          const d3 = nameToIndexRef.current[`${base}_dddot`];
          if (d3 != null) localScope[`${g.name}_dddot`] = y[d3];
        });
      }

      const v = evaluateNode(node, localScope);
      out.push(v);
    }
    return out;
  };

  // ===== Integrator =====
  const addScaled = (a: number[], b: number[], scale: number) => a.map((v, i) => v + (b[i] ?? 0) * scale);
  const rk4 = (state: number[], h: number, tNow: number) => {
    const k1 = evalDeriv(state, tNow);
    const s1 = addScaled(state, k1, h / 2);
    const k2 = evalDeriv(s1, tNow + h / 2);
    const s2 = addScaled(state, k2, h / 2);
    const k3 = evalDeriv(s2, tNow + h / 2);
    const s3 = addScaled(state, k3, h);
    const k4 = evalDeriv(s3, tNow + h);
    return state.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  };

  // ===== Helper: Poincare Section Sampling =====
  const samplePoincare = (state: number[]) => {
    const idxX = nameToIndexRef.current[poincareConfig.plotX];
    const idxY = nameToIndexRef.current[poincareConfig.plotY];
    if (idxX != null && idxY != null) {
      const x = state[idxX] ?? 0;
      const y = state[idxY] ?? 0;
      const newPoint = new THREE.Vector3(x, y, 0);
      console.log("DEBUG: Point sampled!", newPoint); // Very simple log
      setPoincarePoints(prev => [...prev, newPoint]);
    }
  };

  // ===== Main loop =====
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

      const stepSize = dt;
      let steps = Math.floor(accumulated / stepSize);
      if (steps <= 0) return;
      steps = Math.min(steps, 10);

      for (let s = 0; s < steps; s++) {
        const prevState = stateRef.current.slice(); // 前ステップのコピー
        const tNow = timeRef.current;
        const newState = rk4(stateRef.current, stepSize, tNow);
         console.log("DEBUG: rk4 newState:", newState);

        stateRef.current = newState;
        timeRef.current += stepSize;
        genHistoryRef.current.push({ time: timeRef.current, values: newState.slice() });
        if (genHistoryRef.current.length > 2000) genHistoryRef.current.shift();

        // ---- Poincare Section Recording ----
        if (poincareConfig.mode === "time") {
          try {
            const Tnode = compileExpression(poincareConfig.period);
            const currentScope: Scope = { t: timeRef.current, ...baseScope };
            const T = evaluateNode(Tnode, currentScope) || 0;
            if (T > 0) {
              const prevT = timeRef.current - stepSize;
              const nPrev = Math.floor(prevT / T);
              const nNow = Math.floor(timeRef.current / T);
              if (nNow > nPrev) samplePoincare(newState);
            }
          } catch {}
        } else if (poincareConfig.mode === "plane") {
          console.log("DEBUG: poincareConfig.direction at check:", poincareConfig.direction);
          const idx = nameToIndexRef.current[poincareConfig.planeVar];
          if (idx != null) {
            const prevVal = prevState[idx]; // 前ステップの値を使用
            const newVal = newState[idx];
            const planeVal = Number(poincareConfig.planeValue) || 0;

            console.log("DEBUG: Poincare Plane Check - planeVar:", poincareConfig.planeVar, "idx:", idx);
            console.log("DEBUG:   prevVal:", prevVal, "newVal:", newVal, "planeVal:", planeVal);

            let crossed = false;
            if (poincareConfig.direction === "positive" && prevVal < planeVal && newVal >= planeVal) {
              crossed = true;
            } else if (poincareConfig.direction === "negative" && prevVal > planeVal && newVal <= planeVal) {
              crossed = true;
            } else if (poincareConfig.direction === "both" && ((prevVal < planeVal && newVal >= planeVal) || (prevVal > planeVal && newVal <= planeVal))) {
              crossed = true;
            }

            if (crossed) {
              samplePoincare(newState);
              console.log("DEBUG: Plane crossed. Direction:", poincareConfig.direction);
            } else {
              console.log("DEBUG: Plane not crossed.");
            }
          }
        }
        // ---- End Poincare Section Recording ----

        // 粒子ごとの現在位置を更新
        const newPositions: Record<number, [number, number, number]> = {};
        if (displayMode === "particle") {
          let idx = 0;
          particles.forEach((p) => {
            const vals: number[] = [];
            p.vars.slice(0, 3).forEach((g) => {
              if (g.order > 0) {
                vals.push(stateRef.current[idx] ?? 0);
                idx += g.order;
              }
            });
            while (vals.length < 3) vals.push(0);
            newPositions[p.id] = [vals[0], vals[1], vals[2]] as [number, number, number];
          });
        } else {
          particles.forEach((p) => {
            const config = phaseConfig[p.id];
            if (config?.x && config?.y && config?.z) {
              const idxX = nameToIndexRef.current[`p${p.id}_${config.x}`];
              const idxY = nameToIndexRef.current[`p${p.id}_${config.y}`];
              const idxZ = nameToIndexRef.current[`p${p.id}_${config.z}`];
              const vx = stateRef.current[idxX] ?? 0;
              const vy = stateRef.current[idxY] ?? 0;
              const vz = stateRef.current[idxZ] ?? 0;
              newPositions[p.id] = [vx, vy, vz];
            } else if (config?.x && config?.y) {
              const idxX = nameToIndexRef.current[`p${p.id}_${config.x}`];
              const idxY = nameToIndexRef.current[`p${p.id}_${config.y}`];
              const vx = stateRef.current[idxX] ?? 0;
              const vy = stateRef.current[idxY] ?? 0;
              newPositions[p.id] = [vx, vy, 0];
            } else {
              newPositions[p.id] = [0, 0, 0];
            }
          });
        }
        setParticlePos(newPositions);

        // 軌跡
        setTrails((prev) => {
          if (!showTrail) return {};
          const next: Record<number, { x: number; y: number; z: number }[]> = { ...prev };
          particles.forEach((p) => {
            const pos = newPositions[p.id] || [0, 0, 0];
            next[p.id] = [...(next[p.id] || []), { x: pos[0], y: pos[1], z: pos[2] }];
            if (!isTrailInfinite && next[p.id].length > trailLength) {
              next[p.id] = next[p.id].slice(-trailLength);
            }
          });
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
  }, [running, dt, playbackSpeed, trailLength, isTrailInfinite, showTrail, particles]);

  // ===== UI handlers =====
  const toggleRunning = () => setRunning((r) => !r);

  const resetAll = () => {
    setRunning(false);
    timeRef.current = 0;
    genHistoryRef.current = [];
    setTrails({});
    buildSystem();

    // 初期位置の設定
    const s = stateRef.current;
    const newPositions: Record<number, [number, number, number]> = {};
    if (displayMode === "particle") {
      let idx = 0;
      particles.forEach((p) => {
        const vals: number[] = [];
        p.vars.slice(0, 3).forEach((g) => {
          if (g.order > 0) {
            vals.push(s[idx] ?? 0);
            idx += g.order;
          }
        });
        while (vals.length < 3) vals.push(0);
        newPositions[p.id] = [vals[0], vals[1], vals[2]] as [number, number, number];
      });
    } else {
      particles.forEach((p) => {
        const config = phaseConfig[p.id];
        if (config?.x && config?.y && config?.z) {
          const idxX = nameToIndexRef.current[`p${p.id}_${config.x}`];
          const idxY = nameToIndexRef.current[`p${p.id}_${config.y}`];
          const idxZ = nameToIndexRef.current[`p${p.id}_${config.z}`];
          const vx = s[idxX] ?? 0;
          const vy = s[idxY] ?? 0;
          const vz = s[idxZ] ?? 0;
          newPositions[p.id] = [vx, vy, vz];
        } else if (config?.x && config?.y) {
          const idxX = nameToIndexRef.current[`p${p.id}_${config.x}`];
          const idxY = nameToIndexRef.current[`p${p.id}_${config.y}`];
          const vx = s[idxX] ?? 0;
          const vy = s[idxY] ?? 0;
          newPositions[p.id] = [vx, vy, 0];
        } else {
          newPositions[p.id] = [0, 0, 0];
        }
      });
    }
    setParticlePos(newPositions);
  };

  const applyAndCompile = () => {
    buildSystem();
    timeRef.current = 0;
    genHistoryRef.current = [];
    setTrails({});

    const s = stateRef.current;
    const newPositions: Record<number, [number, number, number]> = {};
    if (displayMode === "particle") {
      let idx = 0;
      particles.forEach((p) => {
        const vals: number[] = [];
        p.vars.slice(0, 3).forEach((g) => {
          if (g.order > 0) {
            vals.push(s[idx] ?? 0);
            idx += g.order;
          }
        });
        while (vals.length < 3) vals.push(0);
        newPositions[p.id] = [vals[0], vals[1], vals[2]] as [number, number, number];
      });
    } else {
      particles.forEach((p) => {
        const config = phaseConfig[p.id];
        if (config?.x && config?.y && config?.z) {
          const idxX = nameToIndexRef.current[`p${p.id}_${config.x}`];
          const idxY = nameToIndexRef.current[`p${p.id}_${config.y}`];
          const idxZ = nameToIndexRef.current[`p${p.id}_${config.z}`];
          const vx = s[idxX] ?? 0;
          const vy = s[idxY] ?? 0;
          const vz = s[idxZ] ?? 0;
          newPositions[p.id] = [vx, vy, vz];
        } else if (config?.x && config?.y) {
          const idxX = nameToIndexRef.current[`p${p.id}_${config.x}`];
          const idxY = nameToIndexRef.current[`p${p.id}_${config.y}`];
          const vx = s[idxX] ?? 0;
          const vy = s[idxY] ?? 0;
          newPositions[p.id] = [vx, vy, 0];
        } else {
          newPositions[p.id] = [0, 0, 0];
        }
      });
    }
    setParticlePos(newPositions);
  };

  // 変数編集（アクティブ粒子のみ既存UIを流用）
  const updateVar = (i: number, patch: Partial<GenVar>) => {
    if (typeof patch.expr === "string") patch.expr = patch.expr.replace(/=/g, "");
    setParticles((prev) =>
      prev.map((p) =>
        p.id !== activePid
          ? p
          : {
              ...p,
              vars: p.vars.map((v, idx) => (idx === i ? { ...v, ...patch } : v)),
            }
      )
    );
  };
  const addVariable = () => {
    setParticles((prev) =>
      prev.map((p) =>
        p.id !== activePid || p.vars.length >= 3
          ? p
          : { ...p, vars: [...p.vars, { name: `x${p.vars.length + 1}`, order: 1, initial: "0", expr: "0" }] }
      )
    );
  };
  const removeVariable = (i: number) => {
    setParticles((prev) =>
      prev.map((p) => (p.id !== activePid ? p : { ...p, vars: p.vars.filter((_, j) => j !== i) }))
    );
  };

  // 粒子管理（最小限）
  const addParticle = () => {
    const newId = Math.max(0, ...particles.map((p) => p.id)) + 1;
    setParticles((prev) => [
      ...prev,
      {
        id: newId,
        color: "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0"),
        vars: [{ name: "x", order: 1, initial: "0", expr: "0" }],
      },
    ]);
    setActivePid(newId);
  };
  const removeParticle = (pid: number) => {
    setParticles((prev) => prev.filter((p) => p.id !== pid));
    if (activePid === pid) {
      const rest = particles.filter((p) => p.id !== pid);
      setActivePid(rest[0]?.id ?? 0);
    }
  };
  const updateParticleColor = (pid: number, color: string) => {
    setParticles((prev) => prev.map((p) => (p.id === pid ? { ...p, color } : p)));
  };

  // ===== Axes helper =====
  const AxesHelper = () => {
    const length = 1000;
    if (!showAxes) return null;
    return (
      <>
        <Line points={[-length, 0, 0, length, 0, 0]} color={AXIS_COLORS[0]} lineWidth={2} />
        <Line points={[0, -length, 0, 0, length, 0]} color={AXIS_COLORS[1]} lineWidth={2} />
        <Line points={[0, 0, -length, 0, 0, length]} color={AXIS_COLORS[2]} lineWidth={2} />
      </>
    );
  };

  // ===== Graph view (選択粒子だけをフィルタして渡す) =====
  if (view === "graph" && activeParticle) {
    const prefix = `p${activeParticle.id}_`;
    const allNames = expandedVarNamesRef.current;
    const indices = allNames.map((nm, i) => (nm.startsWith(prefix) ? i : -1)).filter((i) => i >= 0);
    const filteredNames = indices.map((i) => allNames[i].slice(prefix.length));
    const filteredHistory = genHistoryRef.current.map((h) => ({
      time: h.time,
      values: indices.map((i) => h.values[i] ?? 0),
    }));

    return (
      <GraphView
        historyData={filteredHistory}
        vars={activeParticle.vars}
        expandedVarNames={filteredNames}
        selectedVarIndex={selectedVarIndex}
        onClose={() => setView("simulator")}
        dt={dt}
      />
    );
  }

  // ===== Render =====
  return (
    <div className="flex gap-4 p-4 h-screen bg-slate-900 text-white">
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button className="px-3 py-1 rounded bg-green-500" onClick={toggleRunning}>
            {running ? "停止" : "再生"}
          </button>
          <button className="px-3 py-1 rounded bg-blue-500" onClick={resetAll}>リセット</button>
          <label className="text-sm">
            dt:
            <input
              className="ml-1 w-20 rounded bg-slate-700 text-white px-1"
              value={String(dt)}
              onChange={(e) => setDt(Number(e.target.value) || dt)}
            />
          </label>
          <label className="text-sm">
            速度:
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="mx-2"
            />
            <span>{playbackSpeed.toFixed(1)}x</span>
          </label>
          <label className="text-sm">
            表示:
            <select className="ml-1 bg-slate-700 rounded px-1"
              value={displayMode}
              onChange={e => setDisplayMode(e.target.value as "particle" | "phase")}
            >
              <option value="particle">質点運動</option>
              <option value="phase">相空間</option>
            </select>
          </label>
          <button
            className="ml-auto px-3 py-1 rounded bg-pink-600"
            onClick={() => setShowPoincare(true)}
          >
            ポアンカレ断面
          </button>
        </div>

        <div className="flex-1 min-h-0 border border-slate-700 rounded overflow-hidden bg-slate-950">
          <Canvas camera={{ position: [6, 6, 6], fov: 50 }}>
            <color attach="background" args={["#0b1220"]} />
            <hemisphereLight intensity={0.5} />
            <ambientLight intensity={0.3} />
            <pointLight position={[10, 10, 10]} intensity={0.6} />
            <Grid infiniteGrid fadeDistance={30} fadeStrength={5} />
            <AxesHelper />

            {particles.map((p) => (
              <React.Fragment key={p.id}>
                <mesh position={particlePos[p.id] || [0, 0, 0]}> 
                  <sphereGeometry args={[0.2, 32, 32]} />
                  <meshStandardMaterial color={p.color} />
                </mesh>
                {trails[p.id] && trails[p.id].length > 1 && (
                  <Line
                    points={trails[p.id].map((t) => new THREE.Vector3(t.x, t.y, t.z))}
                    lineWidth={2}
                    color={p.color}
                  />
                )}
              </React.Fragment>
            ))}

            <OrbitControls />
          </Canvas>
        </div>

        <div className="mt-2 flex gap-2 items-center text-xs flex-wrap">
          <div>時間: {timeRef.current.toFixed(3)} s</div>
          <label className="flex items-center gap-1 ml-auto">
            軌跡長:
            <input
              className="ml-1 w-20 rounded bg-slate-700 text-white px-1"
              value={String(trailLength)}
              onChange={(e) => setTrailLength(Number(e.target.value) || trailLength)}
            />
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
            <input type="checkbox" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} />
            軸表示
          </label>
        </div>
      </div>

      {/* === Sidebar (UIはできる限り既存を維持) === */}
      <div className="w-2/5 flex flex-col gap-4 overflow-y-auto h-full pr-2">
        {/* 粒子管理（最小限）：追加・選択・削除・色 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button className="px-3 py-1 rounded bg-purple-600" onClick={addParticle}>質点を追加</button>
          <label className="text-xs">対象質点:
            <select
              className="ml-1 bg-slate-700 rounded px-1"
              value={activePid}
              onChange={(e) => setActivePid(Number(e.target.value))}
            >
              {particles.map((p) => (
                <option key={p.id} value={p.id}>{`質点 ${p.id}`}</option>
              ))}
            </select>
          </label>
          {activeParticle && (
            <>
              <label className="flex items-center gap-1 text-xs">
                色:
                <input
                  type="color"
                  className="ml-1 w-6 h-6 rounded border-0 p-0"
                  value={activeParticle.color}
                  onChange={(e) => updateParticleColor(activeParticle.id, e.target.value)}
                />
              </label>
              {particles.length > 1 && (
                <button className="bg-red-600 px-2 py-0.5 rounded text-sm" onClick={() => removeParticle(activeParticle.id)}>
                  選択質点を削除
                </button>
              )}
            </>
          )}
        </div>

        {/* 既存の変数UI：選択中の粒子に対してのみ表示（最大3変数） */}
        <div className="flex items-center gap-2">
          <button className="px-3 py-1 rounded bg-purple-600" onClick={addVariable} disabled={(activeParticle?.vars.length ?? 0) >= 3}>
            変数を追加
          </button>
          <div className="text-xs text-gray-300">（上から順に 赤, 緑, 青 軸に対応）</div>
        </div>

        {activeParticle?.vars.slice(0, 3).map((g, i) => (
          <div key={i} className="border border-slate-700 rounded p-3" style={{ background: variableUiColor(i) + "22" }}>
            <div className="flex items-center justify-between">
              <strong style={{ color: variableUiColor(i) }}>{`${i + 1}. ${g.name || `var${i + 1}`}`}</strong>
              <div className="flex items-center gap-2">
                <button className="bg-teal-600 px-2 py-0.5 rounded text-sm" onClick={() => { setSelectedVarIndex(i); setView("graph"); }}>
                  グラフ
                </button>
                <label className="text-xs">
                  階数:
                  <select
                    className="ml-1 bg-slate-700 rounded px-1"
                    value={g.order ?? 1}
                    onChange={(e) => updateVar(i, { order: Number(e.target.value) })}
                  >
                    <option value={0}>0階</option>
                    <option value={1}>1階</option>
                    <option value={2}>2階</option>
                    <option value={3}>3階</option>
                  </select>
                </label>
                <button className="bg-red-600 px-2 py-0.5 rounded text-sm" onClick={() => removeVariable(i)}>
                  削除
                </button>
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
                {(g.order ?? 1) === 0 ? "これは定数です。" : `d^${g.order}${g.name}/dt^${g.order} = の右辺を入力してください。`}<br />
                式中では t、定数 eps0, mu0, k, g, G を使用可能。<br />
                微分はアポストロフィで入力してください。
              </div>
            </div>
          </div>
        ))}

        {/* Phase space axis selection */}
        {displayMode === "phase" && activeParticle && (
          <div className="text-xs mt-2">
            <div>相空間軸選択:</div>
            <div className="flex gap-2 mt-1">
              <select
                value={phaseConfig[activeParticle.id]?.x || ""}
                onChange={e =>
                  setPhaseConfig(prev => ({
                    ...prev,
                    [activeParticle.id]: {
                      ...(prev[activeParticle.id] || {}),
                      x: e.target.value,
                    },
                  }))
                }
                className="bg-slate-700 rounded px-1"
              >
                <option value="">未選択</option>
                {activeParticle.vars.map(v => (
                  <React.Fragment key={v.name}>
                    <option value={v.name}>{v.name}</option>
                    <option value={`${v.name}_dot`}>{`${v.name}'`}</option>
                    <option value={`${v.name}_ddot`}>{`${v.name}''`}</option>
                    <option value={`${v.name}_dddot`}>{`${v.name}'''`}</option>
                  </React.Fragment>
                ))}
              </select>
              <select
                value={phaseConfig[activeParticle.id]?.y || ""}
                onChange={e =>
                  setPhaseConfig(prev => ({
                    ...prev,
                    [activeParticle.id]: {
                      ...(prev[activeParticle.id] || {}),
                      y: e.target.value,
                    },
                  }))
                }
                className="bg-slate-700 rounded px-1"
              >
                <option value="">未選択</option>
                {activeParticle.vars.map(v => (
                  <React.Fragment key={v.name}>
                    <option value={v.name}>{v.name}</option>
                    <option value={`${v.name}_dot`}>{`${v.name}'`}</option>
                    <option value={`${v.name}_ddot`}>{`${v.name}''`}</option>
                    <option value={`${v.name}_dddot`}>{`${v.name}'''`}</option>
                  </React.Fragment>
                ))}
              </select>
              <select
                value={phaseConfig[activeParticle.id]?.z || ""}
                onChange={e =>
                  setPhaseConfig(prev => ({
                    ...prev,
                    [activeParticle.id]: {
                      ...(prev[activeParticle.id] || {}),
                      z: e.target.value,
                    },
                  }))
                }
                className="bg-slate-700 rounded px-1"
              >
                <option value="">未選択</option>
                {activeParticle.vars.map(v => (
                  <React.Fragment key={v.name}>
                    <option value={v.name}>{v.name}</option>
                    <option value={`${v.name}_dot`}>{`${v.name}'`}</option>
                    <option value={`${v.name}_ddot`}>{`${v.name}''`}</option>
                    <option value={`${v.name}_dddot`}>{`${v.name}'''`}</option>
                  </React.Fragment>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <button className="bg-indigo-600 px-3 py-1 rounded" onClick={applyAndCompile}>初期値・式を適用</button>
          <button
            className="bg-gray-600 px-3 py-1 rounded"
            onClick={() => {
              buildSystem();
              const s = stateRef.current;
              const newPositions: Record<number, [number, number, number]> = {};
              if (displayMode === "particle") {
                let idx = 0;
                particles.forEach((p) => {
                  const vals: number[] = [];
                  p.vars.slice(0, 3).forEach((g) => {
                    if (g.order > 0) {
                      vals.push(s[idx] ?? 0);
                      idx += g.order;
                    }
                  });
                  while (vals.length < 3) vals.push(0);
                  newPositions[p.id] = [vals[0], vals[1], vals[2]] as [number, number, number];
                });
              } else {
                particles.forEach((p) => {
                  const config = phaseConfig[p.id];
                  if (config?.x && config?.y && config?.z) {
                    const idxX = nameToIndexRef.current[`p${p.id}_${config.x}`];
                    const idxY = nameToIndexRef.current[`p${p.id}_${config.y}`];
                    const idxZ = nameToIndexRef.current[`p${p.id}_${config.z}`];
                    const vx = s[idxX] ?? 0;
                    const vy = s[idxY] ?? 0;
                    const vz = s[idxZ] ?? 0;
                    newPositions[p.id] = [vx, vy, vz];
                  } else if (config?.x && config?.y) {
                    const idxX = nameToIndexRef.current[`p${p.id}_${config.x}`];
                    const idxY = nameToIndexRef.current[`p${p.id}_${config.y}`];
                    const vx = s[idxX] ?? 0;
                    const vy = s[idxY] ?? 0;
                    newPositions[p.id] = [vx, vy, 0];
                  } else {
                    newPositions[p.id] = [0, 0, 0];
                  }
                });
              }
              setParticlePos(newPositions);
            }}
          >
            Set Initials
          </button>
        </div>
      </div>
      {/* ポアンカレ断面ビュー */}
      {showPoincare && (
        <PoincareView
          poincareConfig={poincareConfig}
          setPoincareConfig={setPoincareConfig}
          poincarePoints={poincarePoints}
          setPoincarePoints={setPoincarePoints}
          allPoincareVars={expandedVarNamesRef.current}
          formatPoincareVarName={(nm) => nm}
          onClose={() => setShowPoincare(false)}
        />
      )}
    </div>
  );
}