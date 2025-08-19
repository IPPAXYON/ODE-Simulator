export type GenVar = {
  name: string; // ユーザー変数名 (Unicode可)
  order: number; // 階数 (0, 1, 2 など)
  initial: string; // 初期値
  initialDot?: string; // 初期速度 (1階以上で有効)
  initialDDot?: string; // 初期加速度 (2階以上で有効)
  expr: string; // d^order/dt^order の右辺
};

export type Particle = {
  id: number;
  color: string;
  vars: GenVar[]; // 上限3
};

export type PoincareConfig = {
  mode: "time" | "plane";
  period: string; // For time mode (e.g., "2 * PI")
  planeVar: string; // For plane mode (e.g., "p1_x")
  planeValue: string; // For plane mode (e.g., "0")
  direction: "positive" | "negative" | "both"; // For plane mode
  plotX: string; // Variable for X-axis of Poincare plot
  plotY: string; // Variable for Y-axis of Poincare plot
};