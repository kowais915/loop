"use client";

import { motion } from "framer-motion";
import { Activity, Loader2, Play, Sparkles } from "lucide-react";
import { useState } from "react";

import { ApprovalGate } from "@/components/ApprovalGate";
import { CrossDomainBanner } from "@/components/CrossDomainBanner";
import { EvidenceCard } from "@/components/EvidenceCard";
import { LatencySparkline } from "@/components/LatencySparkline";
import { LoopRing } from "@/components/LoopRing";
import { MemoryShelf, MttrCounter } from "@/components/MemoryShelf";
import { ReasoningTrace } from "@/components/ReasoningTrace";
import { createIncident, runDemo } from "@/lib/api";
import { useIncident, useIncidents } from "@/lib/hooks";

const PRESETS = [
  { label: "checkout", service: "checkout", symptom: "checkout p95 latency spiked to ~3.2s" },
  { label: "wishlist (recurrence)", service: "wishlist", symptom: "wishlist p95 latency spiked to ~3.1s" },
];

export default function Home() {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const incidents = useIncidents();
  const { incident, steps } = useIncident(currentId);

  const launch = async (service: string, symptom: string) => {
    setBusy(true);
    try {
      const { id } = await createIncident({ service, symptom });
      setCurrentId(id);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const launchDemo = async () => {
    setBusy(true);
    try {
      const { incident_ids } = await runDemo(true);
      if (incident_ids[0]) setCurrentId(incident_ids[0]);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8">
      {/* Header */}
      <header className="flex flex-col items-center text-center">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-zinc-900 p-2 ring-1 ring-zinc-700">
            <Activity className="h-5 w-5 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">LOOP</h1>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Splunk&apos;s agent tells you what broke.{" "}
          <span className="text-zinc-200">
            LOOP gives you the fix, ready to approve in one click
          </span>{" "}
          — proves it worked against live data, and remembers the pattern so the
          next one is one click away.{" "}
          <span className="text-emerald-300">Human stays in command.</span>
        </p>
      </header>

      {/* Controls */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => launch(p.service, p.symptom)}
            disabled={busy}
            className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" />
            Trigger {p.label}
          </button>
        ))}
        <button
          onClick={launchDemo}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Run full demo
        </button>
      </div>

      {/* Incident tabs */}
      {incidents.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {incidents.map((i) => (
            <button
              key={i.id}
              onClick={() => setCurrentId(i.id)}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
                i.id === currentId
                  ? "bg-zinc-200 text-zinc-900"
                  : "bg-zinc-900/60 text-zinc-400 ring-1 ring-zinc-800 hover:text-zinc-200"
              }`}
            >
              {i.service} · {i.stage}
            </button>
          ))}
        </div>
      )}

      {/* Hero ring */}
      <div className="mt-8 flex justify-center">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <LoopRing stage={incident?.stage ?? "detect"} />
        </motion.div>
      </div>

      {!currentId && (
        <p className="mt-2 text-center text-[12px] text-zinc-600">
          Trigger an incident or run the full demo to watch the loop close.
        </p>
      )}

      {/* Cross-domain moment */}
      {currentId && (
        <div className="mt-6">
          <CrossDomainBanner steps={steps} />
        </div>
      )}

      {/* Main grid */}
      {currentId && (
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="h-[560px]">
            <ReasoningTrace steps={steps} />
          </div>
          <div className="flex flex-col gap-5">
            {incident && <ApprovalGate incident={incident} steps={steps} />}
            {incident && <EvidenceCard incident={incident} steps={steps} />}
            <LatencySparkline steps={steps} />
          </div>
        </div>
      )}

      {/* Bottom: MTTR + memory */}
      {currentId && (
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          <MttrCounter incident={incident} incidents={incidents} />
          <MemoryShelf incidents={incidents} currentId={currentId} />
        </div>
      )}

      <footer className="mt-12 text-center text-[11px] text-zinc-600">
        DETECT → DIAGNOSE → REMEDIATE → ✋ HUMAN APPROVES → VERIFY → LEARN ·
        copilot, not autopilot
      </footer>
    </main>
  );
}
