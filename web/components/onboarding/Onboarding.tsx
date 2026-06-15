"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  Play,
  Server,
} from "lucide-react";
import { useState } from "react";

import { LoopRing } from "@/components/LoopRing";
import { connectSample, connectSplunk } from "@/lib/connection";

type Step = "welcome" | "choose" | "connect";

const LOOP_STEPS = ["Detect", "Diagnose", "Remediate", "✋ Approve", "Verify", "Learn"];

const springTransition = { type: "spring", bounce: 0, duration: 0.7 };
const stepVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.96, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: springTransition },
  exit: { opacity: 0, y: -20, scale: 0.96, filter: "blur(8px)", transition: springTransition },
};

export function Onboarding({ onDone }: { onDone: (mode: "sample" | "live") => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [busy, setBusy] = useState<"" | "sample" | "live">("");
  const [url, setUrl] = useState("https://localhost:8089/services/mcp");
  const [token, setToken] = useState("");
  const [verifyTls, setVerifyTls] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useSample = async () => {
    setBusy("sample");
    setError(null);
    try {
      await connectSample();
      onDone("sample");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start sample mode");
    } finally {
      setBusy("");
    }
  };

  const connect = async () => {
    setBusy("live");
    setError(null);
    try {
      await connectSplunk(url, token, verifyTls);
      onDone("live");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="relative mx-auto flex min-h-[88vh] w-full max-w-2xl flex-1 flex-col items-center justify-center px-5 py-12 text-center">
      {/* Persistent orb hero — stays put while the steps morph beneath it */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8, filter: "blur(10px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        transition={{ ...springTransition, duration: 1.2 }}
        layout
      >
        <LoopRing stage="detect" idle />
      </motion.div>

      <motion.div layout className="mt-2 w-full">
        <AnimatePresence mode="wait">
          {step === "welcome" && (
            <motion.div
              key="welcome"
              variants={stepVariants}
              initial="hidden"
              animate="show"
              exit="exit"
              className="flex flex-col items-center"
              layout
            >
              <motion.h1
                initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ ...springTransition, delay: 0.1 }}
                className="text-4xl font-extrabold tracking-tight text-zinc-100"
              >
                LOOP
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ ...springTransition, delay: 0.2 }}
                className="mt-4 max-w-md text-sm leading-relaxed text-zinc-400"
              >
                Splunk&apos;s agent tells you what broke. LOOP gives you the fix,
                ready to approve in one click — proves it worked against live
                data, and remembers the pattern.{" "}
                <span className="text-emerald-300 font-medium">Human stays in command.</span>
              </motion.p>

              <motion.div
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.3 } } }}
                className="mt-8 flex flex-wrap items-center justify-center gap-2"
              >
                {LOOP_STEPS.map((s) => (
                  <motion.span
                    key={s}
                    variants={{
                      hidden: { opacity: 0, scale: 0.8, y: 10, filter: "blur(4px)" },
                      show: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)", transition: springTransition }
                    }}
                    whileHover={{ scale: 1.05 }}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors cursor-default ${
                      s.startsWith("✋")
                        ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                        : "bg-zinc-900/80 text-zinc-300 ring-1 ring-white/10 hover:bg-zinc-800"
                    }`}
                  >
                    {s}
                  </motion.span>
                ))}
              </motion.div>

              <motion.button
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...springTransition, delay: 0.6 }}
                whileHover={{ scale: 1.03, backgroundColor: "#34d399" }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setStep("choose")}
                className="mt-10 flex items-center gap-2 rounded-2xl bg-emerald-500 px-8 py-4 text-sm font-bold text-emerald-950 shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-shadow hover:shadow-[0_0_40px_rgba(16,185,129,0.4)]"
              >
                Get started <ArrowRight className="h-4 w-4" />
              </motion.button>
            </motion.div>
          )}

          {step === "choose" && (
            <motion.div
              key="choose"
              variants={stepVariants}
              initial="hidden"
              animate="show"
              exit="exit"
              className="flex flex-col items-center"
              layout
            >
              <h2 className="text-2xl font-bold tracking-tight text-zinc-100">
                How do you want to run LOOP?
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                Try it instantly, or point it at your own Splunk.
              </p>

              <motion.div
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } } }}
                className="mt-8 grid w-full max-w-md gap-4 text-left"
              >
                <motion.button
                  variants={{
                    hidden: { opacity: 0, y: 15, scale: 0.98, filter: "blur(4px)" },
                    show: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: springTransition }
                  }}
                  whileHover={{ scale: 1.02, backgroundColor: "rgba(16, 185, 129, 0.15)" }}
                  whileTap={{ scale: 0.98 }}
                  onClick={useSample}
                  disabled={busy !== ""}
                  className="group relative flex items-start gap-4 rounded-3xl bg-zinc-900/50 p-5 ring-1 ring-white/5 transition-all disabled:opacity-60 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  <div className="relative rounded-xl bg-emerald-500/20 p-2.5 ring-1 ring-emerald-500/30">
                    {busy === "sample" ? (
                      <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
                    ) : (
                      <Play className="h-6 w-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    )}
                  </div>
                  <div className="relative">
                    <div className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                      Try with sample data
                      <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-400/30">
                        instant
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-400">
                      Watch the full loop run on a realistic incident — zero
                      configuration. Best for a first look.
                    </p>
                  </div>
                </motion.button>

                <motion.button
                  variants={{
                    hidden: { opacity: 0, y: 15, scale: 0.98, filter: "blur(4px)" },
                    show: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: springTransition }
                  }}
                  whileHover={{ scale: 1.02, backgroundColor: "rgba(255, 255, 255, 0.05)" }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setError(null);
                    setStep("connect");
                  }}
                  disabled={busy !== ""}
                  className="group relative flex items-start gap-4 rounded-3xl bg-zinc-900/50 p-5 ring-1 ring-white/5 transition-all disabled:opacity-60 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  <div className="relative rounded-xl bg-zinc-800 p-2.5 ring-1 ring-white/10 transition-colors group-hover:bg-zinc-700">
                    <Server className="h-6 w-6 text-zinc-300" />
                  </div>
                  <div className="relative">
                    <div className="text-base font-semibold text-zinc-100">
                      Connect my Splunk
                    </div>
                    <p className="mt-1 text-sm text-zinc-400">
                      Run LOOP against your own data via the Splunk MCP Server.
                      Paste your endpoint + token.
                    </p>
                  </div>
                </motion.button>
              </motion.div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setStep("welcome")}
                className="mt-8 flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300"
              >
                <ArrowLeft className="h-4 w-4" /> back
              </motion.button>

              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 text-sm text-red-400 font-medium"
                >
                  {error}
                </motion.p>
              )}
            </motion.div>
          )}

          {step === "connect" && (
            <motion.div
              key="connect"
              variants={stepVariants}
              initial="hidden"
              animate="show"
              exit="exit"
              className="mx-auto flex w-full max-w-md flex-col items-center"
              layout
            >
              <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-zinc-100">
                <Server className="h-6 w-6 text-emerald-400" /> Connect your Splunk
              </h2>
              <p className="mt-2 text-center text-sm text-zinc-400">
                From the Splunk MCP Server app: copy the endpoint and create an
                encrypted token.
              </p>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springTransition, delay: 0.1 }}
                className="mt-8 w-full text-left space-y-5"
              >
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    MCP endpoint URL
                  </label>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://localhost:8089/services/mcp"
                    className="w-full rounded-xl bg-black/50 px-4 py-3 font-mono text-sm text-zinc-200 ring-1 ring-white/10 transition-all focus:bg-black focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Encrypted token
                  </label>
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    type="password"
                    placeholder="paste the MCP encrypted token"
                    className="w-full rounded-xl bg-black/50 px-4 py-3 font-mono text-sm text-zinc-200 ring-1 ring-white/10 transition-all focus:bg-black focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>

                <label className="flex items-center gap-3 rounded-xl bg-zinc-900/50 p-3 ring-1 ring-white/5 cursor-pointer hover:bg-zinc-900/80 transition-colors">
                  <input
                    type="checkbox"
                    checked={!verifyTls}
                    onChange={(e) => setVerifyTls(!e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-700 bg-black/50 text-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-0"
                  />
                  <span className="text-sm font-medium text-zinc-300">
                    Skip TLS verification <span className="text-zinc-500">(local self-signed)</span>
                  </span>
                </label>
              </motion.div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: "auto", marginTop: 16 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    className="w-full overflow-hidden rounded-xl bg-rose-500/10 ring-1 ring-rose-500/20 px-4 py-3 text-sm font-medium text-rose-300"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <motion.button
                whileHover={{ scale: busy || token.length < 4 || url.length < 4 ? 1 : 1.02 }}
                whileTap={{ scale: busy || token.length < 4 || url.length < 4 ? 1 : 0.98 }}
                onClick={connect}
                disabled={busy !== "" || token.length < 4 || url.length < 4}
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-4 text-base font-bold text-emerald-950 shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-400 disabled:opacity-50 disabled:shadow-none"
              >
                {busy === "live" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" /> Testing connection…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-5 w-5" /> Test &amp; connect
                  </>
                )}
              </motion.button>

              <div className="mt-6 flex w-full items-center justify-between gap-4 text-sm">
                <motion.button
                  whileHover={{ x: -2, color: "#d4d4d8" }}
                  onClick={() => setStep("choose")}
                  className="flex items-center gap-1.5 font-medium text-zinc-500 transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" /> back
                </motion.button>
                <span className="flex items-center gap-1.5 text-zinc-500">
                  <Lock className="h-3.5 w-3.5" />
                  Local only. Never stored.
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </main>
  );
}
