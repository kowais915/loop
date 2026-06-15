"use client";

import { CheckCircle2, Crosshair, ShieldCheck } from "lucide-react";

import type { AgentStep, Incident } from "@/lib/types";

export function EvidenceCard({
  incident,
  steps,
  bare = false,
}: {
  incident: Incident;
  steps: AgentStep[];
  bare?: boolean;
}) {
  const rc = steps.find(
    (s) => s.kind === "action" && s.content.label === "root_cause",
  )?.content;
  const evidence = rc?.evidence ?? [];
  const rootCause = rc?.root_cause ?? incident.root_cause;

  if (!rootCause) return null;

  return (
    <div className={bare ? "" : "glass rounded-2xl p-4"}>
      <div className="flex items-center gap-2">
        <Crosshair className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-200">Root cause</h3>
        {rc?.confidence != null && (
          <span className="ml-auto rounded-full bg-zinc-800/80 px-2 py-0.5 text-[10px] text-zinc-400">
            {(Number(rc.confidence) * 100).toFixed(0)}% confidence
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-zinc-200">
        {rootCause}
      </p>

      {evidence.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Cited evidence (real Splunk data)
          </div>
          {evidence.map((e, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg subtle px-2.5 py-1.5"
            >
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span className="text-[12px] text-zinc-300">{e}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
