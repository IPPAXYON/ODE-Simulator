"use client";

import React from "react";
import { Canvas } from "@react-three/fiber";
import { Points, OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { PoincareConfig } from "./page";

type PoincareViewProps = {
  poincareConfig: PoincareConfig;
  setPoincareConfig: React.Dispatch<React.SetStateAction<PoincareConfig>>;
  poincarePoints: THREE.Vector3[];
  setPoincarePoints: React.Dispatch<React.SetStateAction<THREE.Vector3[]>>;
  allPoincareVars: string[];
  formatPoincareVarName: (name: string) => string;
  onClose: () => void;
};

export default function PoincareView({
  poincareConfig,
  setPoincareConfig,
  poincarePoints,
  setPoincarePoints,
  allPoincareVars,
  formatPoincareVarName,
  onClose,
}: PoincareViewProps) {
  const onConfigChange = (newConfig: Partial<PoincareConfig>) => {
    setPoincareConfig((prev) => ({ ...prev, ...newConfig }));
  };

  const onClear = () => {
    setPoincarePoints([]);
  };

  return (
    <div className="absolute inset-0 bg-slate-800 bg-opacity-90 z-10 flex flex-col p-4">
      <div className="flex-1 flex gap-4 min-h-0">
        {/* === Sidebar === */}
        <div className="w-1/4 flex flex-col gap-4 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Poincaré Section</h2>
            <button onClick={onClose} className="px-3 py-1 rounded bg-red-500">
              閉じる
            </button>
          </div>

          {/* Mode Selection */}
          <div className="p-2 rounded bg-slate-700">
            <div className="font-bold mb-2">モード選択</div>
            <div className="flex gap-4">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  value="time"
                  checked={poincareConfig.mode === "time"}
                  onChange={(e) => onConfigChange({ mode: e.target.value as "time" | "plane" })}
                />
                時間周期
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  value="plane"
                  checked={poincareConfig.mode === "plane"}
                  onChange={(e) => onConfigChange({ mode: e.target.value as "time" | "plane" })}
                />
                固定座標
              </label>
            </div>
          </div>

          {/* Config for Time Mode */}
          {poincareConfig.mode === "time" && (
            <div className="p-2 rounded bg-slate-700">
              <label>
                周期 (T):
                <input
                  className="ml-2 w-full rounded bg-slate-600 text-white px-2 py-1"
                  value={poincareConfig.period}
                  onChange={(e) => onConfigChange({ period: e.target.value })}
                  placeholder="例: 2 * PI"
                />
              </label>
            </div>
          )}

          {/* Config for Plane Mode */}
          {poincareConfig.mode === "plane" && (
            <div className="p-2 rounded bg-slate-700 flex flex-col gap-2">
              <div>
                <label>
                  変数:
                  <select
                    className="ml-2 w-full bg-slate-600 rounded px-2 py-1"
                    value={poincareConfig.planeVar}
                    onChange={(e) => onConfigChange({ planeVar: e.target.value })}
                  >
                    {allPoincareVars.flatMap(v => [
                      <option key={v} value={v}>{formatPoincareVarName(v)}</option>,
                      <option key={v + "_dot"} value={v + "_dot"}>{formatPoincareVarName(v) + "'"}</option>
                    ])}
                  </select>
                </label>
              </div>
              <div>
                <label>
                  値:
                  <input
                    className="ml-2 w-full rounded bg-slate-600 text-white px-2 py-1"
                    value={poincareConfig.planeValue}
                    onChange={(e) => onConfigChange({ planeValue: e.target.value })}
                  />
                </label>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    value="positive"
                    checked={poincareConfig.direction === "positive"}
                    onChange={(e) => onConfigChange({ direction: e.target.value as any })}
                  />
                  正方向
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    value="negative"
                    checked={poincareConfig.direction === "negative"}
                    onChange={(e) => onConfigChange({ direction: e.target.value as any })}
                  />
                  負方向
                </label>
                 <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    value="both"
                    checked={poincareConfig.direction === "both"}
                    onChange={(e) => onConfigChange({ direction: e.target.value as any })}
                  />
                  両方
                </label>
              </div>
            </div>
          )}
          
          {/* Plot Axes Selection */}
          <div className="p-2 rounded bg-slate-700 flex flex-col gap-2">
             <div className="font-bold">プロット軸</div>
             <div>
                <label>
                  X軸:
                  <select
                    className="ml-2 w-full bg-slate-600 rounded px-2 py-1"
                    value={poincareConfig.plotX}
                    onChange={(e) => onConfigChange({ plotX: e.target.value })}
                  >
                    {allPoincareVars.flatMap(v => [
                      <option key={v} value={v}>{formatPoincareVarName(v)}</option>,
                      <option key={v + "_dot"} value={v + "_dot"}>{formatPoincareVarName(v) + "'"}</option>
                    ])}
                  </select>
                </label>
              </div>
               <div>
                <label>
                  Y軸:
                  <select
                    className="ml-2 w-full bg-slate-600 rounded px-2 py-1"
                    value={poincareConfig.plotY}
                    onChange={(e) => onConfigChange({ plotY: e.target.value })}
                  >
                    {allPoincareVars.flatMap(v => [
                      <option key={v} value={v}>{formatPoincareVarName(v)}</option>,
                      <option key={v + "_dot"} value={v + "_dot"}>{formatPoincareVarName(v) + "'"}</option>
                    ])}
                  </select>
                </label>
              </div>
          </div>


          <button onClick={onClear} className="px-3 py-1 rounded bg-yellow-500">
            点をクリア
          </button>
        </div>

        {/* === Canvas === */}
        <div className="flex-1 min-h-0 border border-slate-700 rounded overflow-hidden bg-slate-950">
          <Canvas camera={{ position: [0, 0, 30], fov: 50 }}>
            <color attach="background" args={["#0b1220"]} />
            <Grid infiniteGrid fadeDistance={50} fadeStrength={5} />
            {poincarePoints.length > 0 && (
              <Points positions={new Float32Array(poincarePoints.flatMap(p => [p.x, p.y, 0]))}>
                <pointsMaterial color="white" size={1.0} />
              </Points>
            )}
            <OrbitControls enableRotate={false} />
          </Canvas>
        </div>
      </div>
    </div>
  );
}