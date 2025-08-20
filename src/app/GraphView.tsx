'use client';

import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

type GenVar = {
  name: string;
  order: number;
  initial: string;
  initialDot?: string;
  initialDDot?: string;
  expr: string;
};

type History = { time: number; values: number[] }[];

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  scales: {
    x: {
      title: { display: true, text: '時間 (s)', color: '#fff' },
      ticks: { color: '#fff' },
      grid: { color: 'rgba(255, 255, 255, 0.1)' },
    },
    y: {
      ticks: { color: '#fff' },
      grid: { color: 'rgba(255, 255, 255, 0.1)' },
    },
  },
  plugins: {
    legend: { labels: { color: '#fff' } },
  },
};

const COLORS = [
  'rgb(255, 99, 132)',
  'rgb(53, 162, 235)',
  'rgb(75, 192, 192)',
  'rgb(255, 206, 86)',
  'rgb(153, 102, 255)',
  'rgb(255, 159, 64)',
];

export default function GraphView({
  historyData,
  vars,
  expandedVarNames,
  selectedVarIndex,
  onClose,
  dt,
}: {
  historyData: History;
  vars: GenVar[];
  expandedVarNames: string[];
  selectedVarIndex: number | null;
  onClose: () => void;
  dt: number;
}) {
  if (selectedVarIndex === null) return null;

  const selectedVar = vars[selectedVarIndex];
  if (!selectedVar) return null;

  const labels = historyData.map(d => d.time.toFixed(2));
  const datasets = [];

  let selectedVarStateStartIndex = 0;
  for (let i = 0; i < selectedVarIndex; i++) {
    selectedVarStateStartIndex += vars[i].order > 0 ? vars[i].order : 1;
  }

  const derivativeSuffixes = ['', '˙', '¨'];

  // Helper for numerical differentiation
  const calculateDerivative = (data: number[], timeSteps: number[]): number[] => {
    if (data.length < 2) return data.map(() => 0); // Not enough data points

    const derivative: number[] = [];

    // Handle the first point (forward difference)
    if (data.length >= 2) {
      const timeDiff = timeSteps[1] - timeSteps[0];
      if (timeDiff === 0) {
        derivative.push(0);
      } else {
        derivative.push((data[1] - data[0]) / timeDiff);
      }
    } else {
      derivative.push(0); // Fallback for single point
    }


    // Central difference for interior points
    for (let j = 1; j < data.length - 1; j++) {
      const timeDiff = timeSteps[j+1] - timeSteps[j-1];
      if (timeDiff === 0) {
        derivative.push(0);
      } else {
        derivative.push((data[j+1] - data[j-1]) / timeDiff);
      }
    }

    // Handle the last point (backward difference)
    if (data.length >= 2) {
      const timeDiff = timeSteps[data.length - 1] - timeSteps[data.length - 2];
      if (timeDiff === 0) {
        derivative.push(0);
      } else {
        derivative.push((data[data.length - 1] - data[data.length - 2]) / timeDiff);
      }
    } else if (data.length === 1) { // If only one point, derivative is 0
        derivative.push(0);
    }


    return derivative;
  };

  const timeSteps = historyData.map(d => d.time);

  // Store the data for each derivative as we calculate it
  const derivativeData: number[][] = [];

  for (let i = 0; i < 3; i++) { // Always create 3 datasets
    const color = COLORS[i % COLORS.length];
    const derivativeName = `${selectedVar.name}${derivativeSuffixes[i] || ''}`;
    let currentDerivativeValues: number[];

    if (i < selectedVar.order) {
      // If this derivative is explicitly part of the ODE state, get it directly
      const varIndex = selectedVarStateStartIndex + i;
      currentDerivativeValues = historyData.map(d => d.values[varIndex]);
    } else {
      // If this derivative is higher than the ODE order, numerically differentiate the previous one
      if (i === 0) { // This case is for the 0-th derivative itself
          if (selectedVar.order === 0) {
            // For order 0 variables, the value is directly in the history.
            const varIndex = selectedVarStateStartIndex;
            currentDerivativeValues = historyData.map(d => d.values[varIndex] ?? 0);
          } else {
            // This should not be reached if the logic is correct, but as a fallback.
            currentDerivativeValues = historyData.map(() => Number(selectedVar.initial) || 0);
          }
      } else {
          // Numerically differentiate the (i-1)th derivative data
          currentDerivativeValues = calculateDerivative(derivativeData[i - 1], timeSteps);
      }
    }
    derivativeData.push(currentDerivativeValues); // Store for next iteration

    datasets.push({
      label: derivativeName,
      data: currentDerivativeValues,
      borderColor: color,
      backgroundColor: color.replace('rgb', 'rgba').replace(')', ', 0.5)'),
      pointRadius: 0,
      borderWidth: 2,
    });
  }

  const chartData = {
    labels,
    datasets,
  };

  return (
    <div className="fixed inset-0 bg-slate-900 p-4 flex flex-col">
      <div className="flex justify-between items-center mb-4 flex-shrink-0">
        <h2 className="text-xl text-white">
          変数 {selectedVar.name} のグラフ
        </h2>
        <button onClick={onClose} className="px-3 py-1 rounded bg-blue-600 text-white">
          シミュレーターに戻る
        </button>
      </div>
      <div className="flex-1 relative bg-slate-800 rounded-lg p-4">
        <Line options={chartOptions} data={chartData} />
      </div>
    </div>
  );
}