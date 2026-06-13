"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Activity, ArrowLeftRight, GitCommitHorizontal } from "lucide-react";

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
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative overflow-hidden rounded-2xl border border-purple-400/30 bg-gradient-to-r from-sky-500/10 via-purple-500/10 to-amber-500/10 p-4"
      >
        <div className="flex items-center justify-center gap-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-sky-500/15 p-2">
              <Activity className="h-5 w-5 text-sky-400" />
            </div>
            <div className="text-left">
              <div className="text-[10px] uppercase tracking-wider text-sky-300/80">
                Observability
              </div>
              <div className="text-xs font-medium text-zinc-200">
                Latency anomaly
              </div>
            </div>
          </div>

          <motion.div
            animate={{ x: [-3, 3, -3] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            <ArrowLeftRight className="h-5 w-5 text-purple-300" />
          </motion.div>

          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-amber-500/15 p-2">
              <GitCommitHorizontal className="h-5 w-5 text-amber-400" />
            </div>
            <div className="text-left">
              <div className="text-[10px] uppercase tracking-wider text-amber-300/80">
                CI/CD · Platform
              </div>
              <div className="text-xs font-medium text-zinc-200">
                {build ? `Deploy ${build}` : "Deployment event"}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-[12px] text-zinc-300">
          <span className="font-semibold text-purple-200">
            Cross-domain correlation:
          </span>{" "}
          LOOP linked the latency spike to{" "}
          {build ? <span className="text-amber-200">deploy {build}</span> : "a deploy"}
          {table ? (
            <>
              {" "}
              and the <span className="text-sky-200">N+1 on {table}</span>
            </>
          ) : null}
          . No single-domain tool makes this connection.
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
