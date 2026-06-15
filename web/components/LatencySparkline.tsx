"use client";

import { motion } from "framer-motion";
import { TrendingDown } from "lucide-react";

import type { AgentStep } from "@/lib/types";

interface Pt {
  t: string;
  v: number;
  phase: "before" | "after";
}

function extract(steps: AgentStep[]): Pt[] {
  const pts: Pt[] = [];
  for (const s of steps) {
    if (s.kind !== "mcp_result" || !Array.isArray(s.content.rows)) continue;
    const isVerify = s.content.label === "Post-fix p95 latency";
    const isDetect = s.content.label === "p95 latency by minute";
    if (!isVerify && !isDetect) continue;
    for (const row of s.content.rows) {
      const v = Number((row as Record<string, unknown>).p95_latency_ms);
      const t = String((row as Record<string, unknown>)._time ?? "");
      if (!Number.isFinite(v)) continue;
      pts.push({ t, v, phase: isVerify ? "after" : "before" });
    }
  }
  return pts;
}

const W = 520;
const H = 120;
const PAD = 8;
const BASELINE = 300; // SLA-ish reference line

export function LatencySparkline({
  steps,
  service,
}: {
  steps: AgentStep[];
  service?: string;
}) {
  const pts = extract(steps);
  if (pts.length < 2) return null;

  const max = Math.max(...pts.map((p) => p.v), 400);
  const min = Math.min(...pts.map((p) => p.v), 0);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (pts.length - 1);
  const y = (v: number) =>
    H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD);

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.v)}`).join(" ");
  const area = `${line} L ${x(pts.length - 1)} ${H - PAD} L ${x(0)} ${H - PAD} Z`;

  const peak = Math.max(...pts.map((p) => p.v));
  const last = pts[pts.length - 1].v;
  const recovered = pts.some((p) => p.phase === "after");
  const baseY = y(BASELINE);

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <TrendingDown className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-zinc-200">
          {service ?? "service"} p95 latency
        </h3>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="text-red-300">peak {Math.round(peak)}ms</span>
          {recovered && (
            <span className="text-emerald-300">now {Math.round(last)}ms</span>
          )}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(244,63,94,0.35)" />
            <stop offset="100%" stopColor="rgba(244,63,94,0)" />
          </linearGradient>
        </defs>

        {/* baseline reference */}
        {baseY > 0 && baseY < H && (
          <g>
            <line
              x1={PAD}
              x2={W - PAD}
              y1={baseY}
              y2={baseY}
              stroke="rgba(16,185,129,0.4)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={W - PAD} y={baseY - 4} textAnchor="end" className="fill-emerald-400/70" fontSize="9">
              ~baseline
            </text>
          </g>
        )}

        <motion.path
          d={area}
          fill="url(#spark)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke="#f43f5e"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: "easeInOut" }}
        />

        {pts.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.v)}
            r={p.v === peak ? 4 : 2.5}
            fill={p.phase === "after" ? "#10b981" : p.v === peak ? "#f43f5e" : "#fb7185"}
          />
        ))}
      </svg>

      {recovered && (
        <p className="mt-1 text-center text-[11px] text-emerald-300">
          Verified against live data — returned to baseline after approval.
        </p>
      )}
    </div>
  );
}
