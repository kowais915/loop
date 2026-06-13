"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Database,
  Hand,
  Link2,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AgentStep } from "@/lib/types";

function StepIcon({ step }: { step: AgentStep }) {
  const c = step.content;
  if (c.gate) return <Hand className="h-3.5 w-3.5 text-amber-400" />;
  if (c.cross_domain) return <Link2 className="h-3.5 w-3.5 text-purple-400" />;
  if (c.matched) return <Zap className="h-3.5 w-3.5 text-pink-400" />;
  if (c.learned) return <Sparkles className="h-3.5 w-3.5 text-pink-400" />;
  if (c.error) return <AlertTriangle className="h-3.5 w-3.5 text-red-400" />;
  switch (step.kind) {
    case "spl":
      return <Terminal className="h-3.5 w-3.5 text-cyan-400" />;
    case "mcp_result":
      return <Database className="h-3.5 w-3.5 text-sky-400" />;
    case "verify":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
    case "action":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
    default:
      return <BrainCircuit className="h-3.5 w-3.5 text-zinc-400" />;
  }
}

function SplBlock({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const q = step.content.query;
  if (!q) return null;
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-cyan-400/80 hover:text-cyan-300"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
        Show SPL
      </button>
      {open && (
        <pre className="mt-1 overflow-x-auto rounded-md border border-zinc-800 bg-black/60 p-2 font-mono text-[10.5px] text-cyan-200">
          {q}
        </pre>
      )}
    </div>
  );
}

function ResultBlock({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const { row_count, rows, used_stub } = step.content;
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-sky-400/80 hover:text-sky-300"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {row_count ?? 0} rows{used_stub ? " · sample" : ""}
      </button>
      {open && rows && rows.length > 0 && (
        <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-zinc-800 bg-black/60 p-2 font-mono text-[10.5px] text-zinc-300">
          {JSON.stringify(rows, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function ReasoningTrace({ steps }: { steps: AgentStep[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [steps.length]);

  return (
    <div className="glass rounded-2xl flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <Terminal className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-zinc-200">Reasoning trace</h3>
        <span className="ml-auto text-[11px] text-zinc-500">
          {steps.length} steps
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 font-mono"
      >
        {steps.length === 0 && (
          <p className="text-[12px] text-zinc-600">
            Waiting for the agent to start…
          </p>
        )}
        <AnimatePresence initial={false}>
          {steps.map((step) => {
            const c = step.content;
            const highlight = c.cross_domain
              ? "border-l-purple-500/60"
              : c.gate
                ? "border-l-amber-500/60"
                : c.matched || c.learned
                  ? "border-l-pink-500/60"
                  : c.error
                    ? "border-l-red-500/60"
                    : "border-l-zinc-700/60";
            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className={`mb-2 border-l-2 pl-3 ${highlight}`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">
                    <StepIcon step={step} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-600">
                      {step.stage}
                    </span>
                    {c.text && (
                      <p
                        className={`text-[12px] leading-snug ${
                          c.cross_domain
                            ? "text-purple-200"
                            : c.gate
                              ? "text-amber-200"
                              : c.matched || c.learned
                                ? "text-pink-200"
                                : c.error
                                  ? "text-red-300"
                                  : "text-zinc-300"
                        }`}
                      >
                        {c.text}
                      </p>
                    )}
                    {c.label === "root_cause" && c.root_cause && (
                      <p className="text-[12px] text-zinc-200">{c.root_cause}</p>
                    )}
                    {step.kind === "spl" && (
                      <>
                        <span className="text-[11px] text-zinc-400">
                          {c.label}
                        </span>
                        <SplBlock step={step} />
                      </>
                    )}
                    {step.kind === "mcp_result" && <ResultBlock step={step} />}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
