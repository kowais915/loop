"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftRight } from "lucide-react";

import type { AgentStep } from "@/lib/types";

// Surfaces the moment LOOP connects the observability anomaly to the CI/CD
// deployment event — two domains Splunk uniquely sees together.
export function CrossDomainBanner({ steps }: { steps: AgentStep[] }) {
  const correlation = steps.find(
    (s) => s.content.cross_domain && s.content.build,
  );
  const visible = steps.some((s) => s.content.cross_domain);
  if (!visible) return null;

  const build = correlation?.content.build as string | undefined;
  const table = correlation?.content.table as string | undefined;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass relative overflow-hidden rounded-2xl px-6 py-5"
      >
        {/* faint emerald glow behind the link */}
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(40rem 8rem at 50% 0%, rgba(16,185,129,0.10), transparent 70%)",
          }}
        />
        <div className="relative flex items-center justify-center gap-5 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Observability
            </div>
            <div className="mt-0.5 text-sm font-medium text-zinc-100">
              Latency anomaly
            </div>
          </div>

          <motion.div
            animate={{ x: [-3, 3, -3] }}
            transition={{ duration: 1.8, repeat: Infinity }}
            className="text-emerald-400"
          >
            <ArrowLeftRight className="h-5 w-5" />
          </motion.div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              CI/CD · Platform
            </div>
            <div className="mt-0.5 text-sm font-medium text-zinc-100">
              {build ? `Deploy ${build}` : "Deployment event"}
            </div>
          </div>
        </div>

        <p className="relative mt-3 text-center text-[12px] leading-relaxed text-zinc-400">
          <span className="font-semibold text-emerald-300">
            Cross-domain correlation
          </span>{" "}
          — LOOP linked the latency spike to{" "}
          {build ? <span className="text-zinc-200">deploy {build}</span> : "a deploy"}
          {table ? (
            <>
              {" "}
              and the <span className="text-zinc-200">N+1 on {table}</span>
            </>
          ) : null}
          . No single-domain tool makes this connection.
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
