"use client";

import { motion } from "framer-motion";
import { ArrowRight, Hand, Loader2, Play } from "lucide-react";

// The calm intro shown below the (idle) orb before a run starts.
// Palette discipline: neutral zinc + a single emerald CTA; amber only marks the
// human-approval step. The orb itself is the only multi-color element.

const STEPS = [
  { label: "Detect", gate: false },
  { label: "Diagnose", gate: false },
  { label: "Remediate", gate: false },
  { label: "Approve", gate: true },
  { label: "Verify", gate: false },
  { label: "Learn", gate: false },
];

interface Props {
  onRunDemo: () => void;
  onTrigger: () => void;
  busy: boolean;
}

export function LandingScreen({ onRunDemo, onTrigger, busy }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="mx-auto flex w-full max-w-2xl flex-col items-center text-center"
    >
      {/* the loop, as a single calm line */}
      <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                s.gate
                  ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-400/30"
                  : "bg-zinc-900/70 text-zinc-400 ring-1 ring-white/10"
              }`}
            >
              {s.gate && <Hand className="h-3 w-3" />}
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <ArrowRight className="h-3 w-3 text-zinc-700" />
            )}
          </div>
        ))}
      </div>

      {/* example callout */}
      <div className="mt-6 rounded-xl subtle px-4 py-3 text-left">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          What you&apos;ll watch
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">
          Checkout latency jumps <span className="text-zinc-100">280 ms → 3.2 s</span>.
          LOOP traces it to <span className="text-zinc-100">deploy v2.4.1</span>,
          drafts the fix, waits for your approval, then proves the latency
          recovered — all from live Splunk data.
        </p>
      </div>

      {/* actions */}
      <div className="mt-7 flex flex-col items-center gap-3">
        <button
          onClick={onRunDemo}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run the live demo
        </button>
        <button
          onClick={onTrigger}
          disabled={busy}
          className="text-[12px] text-zinc-500 transition hover:text-zinc-300 disabled:opacity-60"
        >
          or trigger a single incident →
        </button>
      </div>
    </motion.div>
  );
}
