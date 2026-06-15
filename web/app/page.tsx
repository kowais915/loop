"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Activity, Crosshair, Database, Loader2, Play, Search, Server, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { AnalyzeForm } from "@/components/AnalyzeForm";
import { ApprovalGate } from "@/components/ApprovalGate";
import { CrossDomainBanner } from "@/components/CrossDomainBanner";
import { EvidenceCard } from "@/components/EvidenceCard";
import { LandingScreen } from "@/components/LandingScreen";
import { LatencySparkline } from "@/components/LatencySparkline";
import { LoopRing } from "@/components/LoopRing";
import { MemoryShelf, MttrCounter } from "@/components/MemoryShelf";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { ReasoningTrace } from "@/components/ReasoningTrace";
import { createIncident } from "@/lib/api";
import { useIncident, useIncidents } from "@/lib/hooks";
import type { Stage } from "@/lib/types";

const PRESETS = [
  { label: "checkout", service: "checkout", symptom: "checkout p95 latency spiked to ~3.2s" },
  { label: "wishlist (recurrence)", service: "wishlist", symptom: "wishlist p95 latency spiked to ~3.1s" },
];

// Friendly, always-visible status under the orb so the user knows what's
// happening and what to do. Amber = the human's turn; emerald = closed.
function stageStatus(
  stage: Stage | undefined,
): { text: string; tone: string; loading: boolean } {
  switch (stage) {
    case "detect":
      return { text: "Detecting the anomaly in Splunk…", tone: "", loading: true };
    case "diagnose":
      return { text: "Diagnosing — correlating latency with deploys…", tone: "", loading: true };
    case "remediate":
      return { text: "Drafting the fix…", tone: "", loading: true };
    case "awaiting_approval":
      return { text: "✋ Your turn — review & approve →", tone: "text-emerald-300", loading: false };
    case "verify":
      return { text: "Verifying recovery against live Splunk data…", tone: "", loading: true };
    case "learn":
      return { text: "Saving the incident signature…", tone: "", loading: true };
    case "resolved":
      return { text: "✓ Loop closed — verified and learned", tone: "text-emerald-300", loading: false };
    case "rejected":
      return { text: "Rejected — no action taken", tone: "text-red-300", loading: false };
    default:
      return { text: "Starting…", tone: "", loading: true };
  }
}

export default function Home() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"sample" | "live">("sample");
  const [started, setStarted] = useState(false);
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [demoCheckoutId, setDemoCheckoutId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const incidents = useIncidents();
  const { incident, steps } = useIncident(currentId);

  useEffect(() => {
    // One-time read of persisted onboarding state from the browser. setState in
    // this mount effect is intentional (no SSR value exists for localStorage).
    const done = localStorage.getItem("loop.onboarded") === "1";
    const m = (localStorage.getItem("loop.mode") as "sample" | "live") || "sample";
    /* eslint-disable react-hooks/set-state-in-effect */
    setMode(m);
    setOnboarded(done);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Auto-follow the active incident (replaces manual incident pills). Stay on
  // the current one while it's running/held; when it's terminal, advance only to
  // a NEWER live incident — never jump back to old/held ones (e.g. after a demo).
  useEffect(() => {
    if (!started || incidents.length === 0) return;
    const isTerminal = (s: string) => s === "resolved" || s === "rejected";
    const cur = incidents.find((i) => i.id === currentId);
    if (cur && !isTerminal(cur.stage)) return; // running or held → stay put
    const next = incidents.find(
      (i) => !isTerminal(i.stage) && (!cur || i.created_at > cur.created_at),
    );
    if (next && next.id !== currentId) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setCurrentId(next.id);
    }
  }, [incidents, started, currentId]);

  const finishOnboarding = (m: "sample" | "live") => {
    localStorage.setItem("loop.onboarded", "1");
    localStorage.setItem("loop.mode", m);
    setMode(m);
    setOnboarded(true);
  };

  const reopenConnection = () => {
    setStarted(false);
    setCurrentId(null);
    setOnboarded(false);
  };

  const launch = async (service: string, symptom: string) => {
    setBusy(true);
    setStarted(true);
    try {
      const { id } = await createIncident({ service, symptom });
      setCurrentId(id);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  // Run full demo = fire checkout and STOP at the gate for the human to approve.
  // Once checkout is human-approved (resolved), the recurrence is chained below.
  const launchDemo = async () => {
    setBusy(true);
    setStarted(true);
    setDemoCheckoutId(null);
    try {
      const { id } = await createIncident({
        service: PRESETS[0].service,
        symptom: PRESETS[0].symptom,
      });
      setCurrentId(id);
      setDemoCheckoutId(id);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  // After the human approves the demo's checkout incident, auto-chain the
  // wishlist recurrence (so the memory match fires) — and stop at its gate too.
  useEffect(() => {
    if (!demoCheckoutId) return;
    const co = incidents.find((i) => i.id === demoCheckoutId);
    if (co && co.stage === "resolved") {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setDemoCheckoutId(null);
      void createIncident({
        service: PRESETS[1].service,
        symptom: PRESETS[1].symptom,
      }).then(({ id }) => setCurrentId(id));
    }
  }, [incidents, demoCheckoutId]);

  const goHome = () => {
    setStarted(false);
    setCurrentId(null);
  };

  // Gate on onboarding (null = reading localStorage, avoid flash).
  if (onboarded === null) return <main className="h-[100dvh] bg-background" />;
  if (!onboarded) return <Onboarding onDone={finishOnboarding} />;

  const stage = incident?.stage;
  // "Held" = DETECT found no anomaly / no data → a clean dead-end, not progress.
  const heldStep = [...steps].reverse().find((s) => s.content.held);
  const held = Boolean(heldStep) && stage === "detect";
  const atGate = stage === "awaiting_approval";
  const showEvidence = Boolean(incident?.root_cause);
  const showMemory =
    stage === "resolved" || stage === "learn" || Boolean(incident?.matched_incident_id);
  const working = !held && !showEvidence && !atGate;

  const status = held
    ? {
        text: heldStep?.content.text ?? "No anomaly found in this window.",
        tone: "text-zinc-400",
        loading: false,
      }
    : stageStatus(incident?.stage);

  const connectionPill = (
    <button
      onClick={reopenConnection}
      title="Change data source"
      className="flex items-center gap-1.5 rounded-full subtle px-3 py-1 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-200"
    >
      {mode === "live" ? (
        <Server className="h-3 w-3 text-emerald-400" />
      ) : (
        <Database className="h-3 w-3 text-zinc-400" />
      )}
      {mode === "live" ? "Connected: Splunk" : "Sample data"}
    </button>
  );

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-3 px-5 py-2.5">
        <button
          onClick={goHome}
          className="flex items-center gap-2 rounded-lg transition hover:opacity-80"
          title="Back to start"
        >
          <div className="rounded-lg bg-zinc-900 p-1.5 ring-1 ring-white/10">
            <Activity className="h-4 w-4 text-emerald-400" />
          </div>
          <span className="text-lg font-bold tracking-tight text-zinc-100">LOOP</span>
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {connectionPill}
          <button
            onClick={() => setShowAnalyze(true)}
            className="flex items-center gap-1.5 rounded-lg subtle px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            <Search className="h-3 w-3" /> Analyze
          </button>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => launch(p.service, p.symptom)}
              disabled={busy}
              className="hidden items-center gap-1.5 rounded-lg subtle px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:bg-emerald-500/10 hover:text-emerald-300 disabled:opacity-60 sm:flex"
            >
              <Play className="h-3 w-3" /> {p.label}
            </button>
          ))}
          <button
            onClick={launchDemo}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Run full demo
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1">
        <LayoutGroup>
          {!started ? (
            /* ---------- Idle: centered orb + landing ---------- */
            <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-5 py-8">
              <motion.div layoutId="loop-orb">
                <LoopRing stage="detect" idle />
              </motion.div>
              <div className="mt-6 w-full">
                <LandingScreen
                  onRunDemo={launchDemo}
                  onTrigger={() => launch(PRESETS[0].service, PRESETS[0].symptom)}
                  busy={busy}
                />
                <div className="mt-3 text-center">
                  <button
                    onClick={() => setShowAnalyze(true)}
                    className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 transition hover:text-emerald-300"
                  >
                    <Search className="h-3 w-3" /> Analyze a service on your own data
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ---------- Active: mission-control shell ---------- */
            <div className="flex h-full min-h-0 flex-col lg:flex-row">
              {/* Left — full-height logs, flush to the edge (no padding) */}
              <aside className="order-2 h-[38vh] shrink-0 lg:order-1 lg:h-full lg:w-[26%]">
                <ReasoningTrace steps={steps} flush />
              </aside>

              {/* Center — orb hero + status + cross-domain + sparkline */}
              <div className="order-1 flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-5 lg:order-2">
                <motion.div layoutId="loop-orb">
                  <LoopRing stage={incident?.stage ?? "detect"} />
                </motion.div>

                <div className="flex items-center gap-2">
                  {status.loading && (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                  )}
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={incident?.stage ?? "pending"}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.35 }}
                      className={`text-center text-base font-medium ${
                        status.loading ? "shimmer-text" : status.tone
                      }`}
                    >
                      {incident?.service && (
                        <span className={status.loading ? "" : "text-zinc-500"}>
                          {incident.service} ·{" "}
                        </span>
                      )}
                      {status.text}
                    </motion.p>
                  </AnimatePresence>
                </div>

                <div className="w-full max-w-xl space-y-4">
                  <CrossDomainBanner steps={steps} />
                  <LatencySparkline steps={steps} service={incident?.service} />
                </div>
              </div>

              {/* Right — flush details panel (mirrors the left logs panel) */}
              <aside className="order-3 h-[45vh] shrink-0 overflow-hidden bg-white/[0.02] lg:h-full lg:w-[31%]">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex items-center gap-2 px-4 py-3">
                    <Crosshair className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-zinc-200">Diagnosis &amp; fix</h3>
                  </div>
                  <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
                    {held ? (
                      <div>
                        <div className="flex items-center gap-2">
                          <Search className="h-4 w-4 text-zinc-400" />
                          <h3 className="text-sm font-semibold text-zinc-200">
                            {heldStep?.content.no_data ? "No data matched" : "No anomaly found"}
                          </h3>
                        </div>
                        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                          {heldStep?.content.text}
                        </p>
                        <p className="mt-3 text-[12px] text-zinc-500">
                          Try the demo, or open <span className="text-zinc-300">Analyze</span>{" "}
                          and pick a sourcetype with a numeric latency field (it
                          auto-suggests one) over a window that contains the spike.
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => setShowAnalyze(true)}
                            className="flex items-center gap-1.5 rounded-lg subtle px-3 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:bg-emerald-500/10 hover:text-emerald-300"
                          >
                            <Search className="h-3 w-3" /> Analyze
                          </button>
                          <button
                            onClick={launchDemo}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-semibold text-emerald-950 transition hover:bg-emerald-400"
                          >
                            <Sparkles className="h-3 w-3" /> Run demo
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {atGate && incident && (
                          <ApprovalGate incident={incident} steps={steps} bare />
                        )}
                        {showEvidence && incident && (
                          <EvidenceCard incident={incident} steps={steps} bare />
                        )}
                        <MttrCounter incident={incident} incidents={incidents} bare />
                        {showMemory && (
                          <MemoryShelf incidents={incidents} currentId={currentId} bare />
                        )}
                        {working && (
                          <p className="text-[12px] text-zinc-500">
                            LOOP is investigating in Splunk — the diagnosis and proposed
                            fix will appear here.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          )}
        </LayoutGroup>
      </div>

      {showAnalyze && (
        <AnalyzeForm
          onClose={() => setShowAnalyze(false)}
          onCreated={(id) => {
            setStarted(true);
            setCurrentId(id);
          }}
        />
      )}
    </main>
  );
}
