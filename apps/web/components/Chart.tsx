"use client";
import { useEffect, useRef } from "react";
import { BarController, BarElement, CategoryScale, Chart, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

export interface Series { label: string; data: number[]; color: string; type?: "bar" | "line"; yAxis?: "y" | "y1" }

/** Thin Chart.js wrapper (canvas created and destroyed with the component; no animation under prefers-reduced-motion). */
export function SeriesChart({ labels, series, height = 240, ariaLabel }: { labels: string[]; series: Series[]; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dual = series.some((s) => s.yAxis === "y1");
    const chart = new Chart(ref.current, {
      type: "bar",
      data: { labels, datasets: series.map((s) => ({ type: s.type ?? "bar", label: s.label, data: s.data, backgroundColor: s.color, borderColor: s.color, yAxisID: s.yAxis ?? "y", tension: 0.3, borderRadius: 4 })) },
      options: {
        responsive: true, maintainAspectRatio: false, animation: reduce ? false : undefined,
        scales: { y: { beginAtZero: true, position: "left" }, ...(dual ? { y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } } } : {}) },
        plugins: { legend: { display: series.length > 1 } },
      },
    });
    return () => chart.destroy();
  }, [labels, series]);
  return <div style={{ height }}><canvas ref={ref} role="img" aria-label={ariaLabel} /></div>;
}
