"use client";

import { motion } from "framer-motion";
import { BrainCircuit, Timer, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import type { Incident } from "@/lib/types";

function useLiveSeconds(incident: Incident | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!incident || incident.mttr_seconds != null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [incident]);
  if (!incident) return 0;
  if (incident.mttr_seconds != null) return incident.mttr_seconds;
  const start = new Date(incident.created_at).getTime();
  return Math.max(0, Math.floor((now - start) / 1000));
}

export function MttrCounter({
  incident,
  incidents,
  bare = false,
}: {
  incident: Incident | null;
  incidents: Incident[];
  bare?: boolean;
}) {
  const seconds = useLiveSeconds(incident);
  const running = incident && incident.mttr_seconds == null && incident.stage !== "rejected";

  // Compare against the first resolved incident to show the drop on recurrence.
  const matched = incident?.matched_incident_id
    ? incidents.find((i) => i.id === incident.matched_incident_id)
    : null;
  const prevMttr = matched?.mttr_seconds ?? null;
  const drop =
    prevMttr != null && incident?.mttr_seconds != null && prevMttr > 0
      ? Math.round((1 - incident.mttr_seconds / prevMttr) * 100)
      : null;

  return (
    <div className={bare ? "" : "glass rounded-2xl p-4"}>
      <div className="flex items-center gap-2">
        <Timer className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-200">Time to resolution</h3>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <motion.span
          key={seconds}
          className={`font-mono text-4xl font-bold tabular-nums ${
            running ? "text-zinc-100" : "text-emerald-300"
          }`}
        >
          {seconds}s
        </motion.span>
        {running && (
          <span className="animate-pulse-ring text-[11px] text-zinc-500">
            live
          </span>
        )}
      </div>
      {drop != null && drop > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-200"
        >
          <Zap className="h-3 w-3" />
          {drop}% faster — known pattern, one-click approval
        </motion.div>
      )}
    </div>
  );
}

export function MemoryShelf({
  incidents,
  currentId,
  bare = false,
}: {
  incidents: Incident[];
  currentId: string | null;
  bare?: boolean;
}) {
  const current = incidents.find((i) => i.id === currentId) ?? null;
  // Resolved incidents are the ones that contributed a learned signature.
  const learned = incidents.filter((i) => i.stage === "resolved");
  // Always keep a matched signature visible, then fill with the most recent.
  const MAX_SHOWN = 6;
  const matchedId = current?.matched_incident_id ?? null;
  const ordered = matchedId
    ? [
        ...learned.filter((i) => i.id === matchedId),
        ...learned.filter((i) => i.id !== matchedId),
      ]
    : learned;
  const shown = ordered.slice(0, MAX_SHOWN);
  const moreCount = learned.length - shown.length;

  return (
    <div className={bare ? "" : "glass rounded-2xl p-4"}>
      <div className="flex items-center gap-2">
        <BrainCircuit className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-200">Incident memory</h3>
        <span className="ml-auto text-[11px] text-zinc-500">
          {learned.length} learned
        </span>
      </div>

      {current?.matched_incident_id && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1.5 text-[12px] text-emerald-200"
        >
          <Zap className="h-3.5 w-3.5" />
          Matched a prior incident — fix recalled from memory
        </motion.div>
      )}

      <div className="mt-3 space-y-2">
        {learned.length === 0 && (
          <p className="text-[12px] text-zinc-600">
            No signatures yet. Resolve an incident to teach LOOP.
          </p>
        )}
        {shown.map((i) => (
          <div
            key={i.id}
            className={`rounded-lg px-3 py-2 ${
              i.id === current?.matched_incident_id
                ? "bg-emerald-500/10 ring-1 ring-emerald-400/40"
                : "subtle"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-zinc-200">
                {i.service}
              </span>
              {i.mttr_seconds != null && (
                <span className="text-[10px] text-zinc-500">
                  resolved in {i.mttr_seconds}s
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-400">
              N+1 query pattern after deploy
            </div>
          </div>
        ))}
        {moreCount > 0 && (
          <p className="pt-0.5 text-center text-[11px] text-zinc-600">
            +{moreCount} more learned
          </p>
        )}
      </div>
    </div>
  );
}
