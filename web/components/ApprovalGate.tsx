"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, GitPullRequest, Hand, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { approveIncident, rejectIncident } from "@/lib/api";
import type { AgentStep, Incident } from "@/lib/types";
import { DiffView } from "./DiffView";

interface Props {
  incident: Incident;
  steps: AgentStep[];
}

function findProposal(steps: AgentStep[]) {
  return steps.find(
    (s) => s.kind === "action" && s.content.label === "proposed_remediation",
  )?.content;
}
function findRootCause(steps: AgentStep[]) {
  return steps.find((s) => s.kind === "action" && s.content.label === "root_cause")
    ?.content;
}

export function ApprovalGate({ incident, steps }: Props) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const open = incident.stage === "awaiting_approval";

  const proposal = findProposal(steps);
  const rc = findRootCause(steps);
  const diff = proposal?.diff || incident.remediation_diff || "";
  const remediation = proposal?.remediation || incident.remediation || "";
  const rollback = proposal?.rollback || "";
  const confidence = rc?.confidence ?? incident.confidence ?? null;
  const matched = Boolean(incident.matched_incident_id);

  const onApprove = async () => {
    setBusy("approve");
    try {
      await approveIncident(incident.id, "you@oncall");
    } finally {
      setBusy(null);
    }
  };
  const onReject = async () => {
    setBusy("reject");
    try {
      await rejectIncident(incident.id, "you@oncall", "manual review");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          className="glass-strong rounded-2xl p-5 ring-1 ring-amber-400/30 shadow-[0_0_40px_-12px_rgba(245,158,11,0.4)]"
        >
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              className="rounded-lg bg-amber-500/15 p-1.5"
            >
              <Hand className="h-5 w-5 text-amber-400" />
            </motion.div>
            <div>
              <h3 className="text-sm font-semibold text-amber-200">
                Human approval required
              </h3>
              <p className="text-[11px] text-zinc-400">
                LOOP drafted the fix. Nothing is applied until you approve —
                copilot, not autopilot.
              </p>
            </div>
            {confidence != null && (
              <span className="ml-auto rounded-full bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                confidence {(confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>

          {matched && (
            <div className="mt-3 rounded-lg border border-pink-400/30 bg-pink-500/10 px-3 py-2 text-[12px] text-pink-200">
              ⚡ Recognized pattern — fix pre-filled from a previously resolved
              incident. One click to resolve.
            </div>
          )}

          {/* rationale */}
          {remediation && (
            <p className="mt-4 text-sm text-zinc-300 leading-relaxed">
              {remediation}
            </p>
          )}

          {/* rollback action */}
          {rollback && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <RotateCcw className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="text-[12px] text-zinc-300">{rollback}</span>
            </div>
          )}

          {/* the diff */}
          {diff && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                <GitPullRequest className="h-3.5 w-3.5" />
                Proposed code fix (N+1 → batched query)
              </div>
              <DiffView diff={diff} />
            </div>
          )}

          {/* actions */}
          <div className="mt-5 flex gap-3">
            <button
              onClick={onApprove}
              disabled={busy !== null}
              className="group flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              {busy === "approve" ? "Applying…" : "Approve & Resolve"}
            </button>
            <button
              onClick={onReject}
              disabled={busy !== null}
              className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:border-red-500/60 hover:text-red-300 disabled:opacity-60"
            >
              <X className="h-4 w-4" />
              Reject
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
