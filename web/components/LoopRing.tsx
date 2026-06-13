"use client";

import { motion } from "framer-motion";
import { Check, Hand, X } from "lucide-react";

import { RING_ORDER, STAGE_META, stageProgress } from "@/lib/stages";
import type { Stage } from "@/lib/types";

const SIZE = 340;
const C = SIZE / 2;
const R = 132;
const GAP_DEG = 7;
const SEG_DEG = 360 / RING_ORDER.length; // 72
const DRAW_DEG = SEG_DEG - GAP_DEG;

function polar(angleDeg: number, r = R): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arcPath(startDeg: number, endDeg: number, r = R): string {
  const [x1, y1] = polar(startDeg, r);
  const [x2, y2] = polar(endDeg, r);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function LoopRing({ stage }: { stage: Stage }) {
  const { activeIndex, atGate, done, rejected } = stageProgress(stage);
  const current = STAGE_META[RING_ORDER[Math.min(activeIndex, 4)]];

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* track */}
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke="rgba(63,63,70,0.4)"
          strokeWidth={2}
        />

        {RING_ORDER.map((key, i) => {
          const meta = STAGE_META[key];
          const start = i * SEG_DEG + GAP_DEG / 2;
          const end = start + DRAW_DEG;
          const reached = done || i <= activeIndex;
          // The remediate(2)→verify(3) boundary is the "open" arc that pulses
          // while waiting for the human at the gate.
          const isGateArc = atGate && i === 2;

          return (
            <g key={key}>
              {/* dim base */}
              <path
                d={arcPath(start, end)}
                fill="none"
                stroke={meta.color}
                strokeWidth={6}
                strokeLinecap="round"
                opacity={0.12}
              />
              {/* lit overlay */}
              <motion.path
                d={arcPath(start, end)}
                fill="none"
                stroke={meta.color}
                strokeWidth={isGateArc ? 8 : 6}
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{
                  pathLength: reached ? 1 : 0,
                  opacity: reached ? (isGateArc ? [0.5, 1, 0.5] : 1) : 0,
                }}
                transition={{
                  pathLength: { duration: 0.7, ease: "easeInOut" },
                  opacity: isGateArc
                    ? { duration: 1.5, repeat: Infinity }
                    : { duration: 0.4 },
                }}
                style={{
                  filter: reached
                    ? `drop-shadow(0 0 6px ${meta.color}aa)`
                    : "none",
                }}
              />
            </g>
          );
        })}

        {/* stage nodes */}
        {RING_ORDER.map((key, i) => {
          const meta = STAGE_META[key];
          const mid = i * SEG_DEG + SEG_DEG / 2;
          const [nx, ny] = polar(mid, R);
          const reached = done || i <= activeIndex;
          return (
            <g key={`node-${key}`}>
              <motion.circle
                cx={nx}
                cy={ny}
                r={6}
                fill={reached ? meta.color : "#18181b"}
                stroke={meta.color}
                strokeWidth={2}
                initial={{ scale: 0.6 }}
                animate={{ scale: reached ? 1 : 0.7, opacity: reached ? 1 : 0.4 }}
                style={{ filter: reached ? `drop-shadow(0 0 5px ${meta.color})` : "none" }}
              />
            </g>
          );
        })}
      </svg>

      {/* labels around the ring */}
      {RING_ORDER.map((key, i) => {
        const meta = STAGE_META[key];
        const mid = i * SEG_DEG + SEG_DEG / 2;
        const [lx, ly] = polar(mid, R + 34);
        const reached = done || i <= activeIndex;
        return (
          <div
            key={`label-${key}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none transition-opacity duration-500"
            style={{ left: lx, top: ly, opacity: reached ? 1 : 0.35 }}
          >
            <div
              className={`text-[11px] font-semibold tracking-wide ${reached ? meta.tw : "text-zinc-500"}`}
            >
              {meta.label}
            </div>
          </div>
        );
      })}

      {/* center */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-12">
        {done ? (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center"
          >
            <div className="rounded-full bg-emerald-500/15 p-3 ring-1 ring-emerald-400/40">
              <Check className="h-7 w-7 text-emerald-400" />
            </div>
            <div className="mt-2 text-sm font-semibold text-emerald-300">
              Loop closed
            </div>
          </motion.div>
        ) : rejected ? (
          <div className="flex flex-col items-center">
            <div className="rounded-full bg-red-500/15 p-3 ring-1 ring-red-400/40">
              <X className="h-7 w-7 text-red-400" />
            </div>
            <div className="mt-2 text-sm font-semibold text-red-300">Rejected</div>
          </div>
        ) : atGate ? (
          <motion.div
            className="flex flex-col items-center"
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          >
            <div className="rounded-full bg-amber-500/15 p-3 ring-1 ring-amber-400/50">
              <Hand className="h-7 w-7 text-amber-400" />
            </div>
            <div className="mt-2 text-xs font-semibold text-amber-300">
              Awaiting human
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-col items-center">
            <div className={`text-lg font-semibold ${current.tw}`}>
              {current.label}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400 max-w-[10rem] leading-tight">
              {current.blurb}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
