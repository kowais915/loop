"use client";

import { motion } from "framer-motion";
import { Loader2, Search, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { createIncident, type CreateIncidentInput } from "@/lib/api";
import { getFields, getIndexes, getSourcetypes } from "@/lib/discovery";

// "Analyze a service" — run the loop on any index/sourcetype/time range, not just
// the curated demo. Discovers the user's real indexes/sourcetypes/fields so they
// pick from dropdowns instead of guessing.
export function AnalyzeForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [f, setF] = useState({
    service: "",
    index: "",
    sourcetype: "",
    latency_field: "",
    deploy_sourcetype: "deployment:event",
    earliest: "-24h",
    latest: "now",
  });
  const [indexes, setIndexes] = useState<string[]>([]);
  const [sourcetypes, setSourcetypes] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- async discovery fetches */
  // Discover indexes on open.
  useEffect(() => {
    void getIndexes().then((idx) => {
      setIndexes(idx);
      if (idx.length === 1) setF((p) => ({ ...p, index: p.index || idx[0] }));
    });
  }, []);

  // When the index changes, discover its sourcetypes.
  useEffect(() => {
    if (!f.index) return;
    void getSourcetypes(f.index).then(setSourcetypes);
  }, [f.index]);

  // When the sourcetype changes, discover numeric fields + suggest a latency field.
  useEffect(() => {
    if (!f.index || !f.sourcetype) return;
    setDiscovering(true);
    void getFields(f.index, f.sourcetype)
      .then(({ numeric_fields, suggested }) => {
        setFields(numeric_fields);
        if (suggested) setF((p) => ({ ...p, latency_field: suggested }));
      })
      .finally(() => setDiscovering(false));
  }, [f.index, f.sourcetype]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const input: CreateIncidentInput = {
        service: f.service || f.sourcetype || "service",
        symptom: `${f.service || f.sourcetype} latency analysis`,
        index: f.index || "ecommerce",
        sourcetype: f.sourcetype || "checkout:transaction",
        latency_field: f.latency_field || "latency_ms",
        deploy_sourcetype: f.deploy_sourcetype || "deployment:event",
        earliest: f.earliest,
        latest: f.latest,
      };
      const { id } = await createIncident(input);
      onCreated(id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start analysis");
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    key: keyof typeof f,
    placeholder: string,
    listId?: string,
    hint?: string,
  ) => (
    <div>
      <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
        {label}
        {hint && <span className="text-[10px] text-emerald-400/80">{hint}</span>}
      </label>
      <input
        value={f[key]}
        onChange={set(key)}
        placeholder={placeholder}
        list={listId}
        className="mt-1 w-full rounded-lg bg-black/40 px-3 py-2 font-mono text-[12px] text-zinc-200 outline-none transition focus:ring-1 focus:ring-emerald-400/40"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 px-5 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="glass-strong w-full max-w-md rounded-2xl p-5"
      >
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-bold text-zinc-100">Analyze a service</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-1 text-zinc-500 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-[12px] text-zinc-500">
          {indexes.length > 0
            ? "Pick from your Splunk — LOOP runs detect → cross-domain deploy correlation on your data."
            : "Enter your index / sourcetype / latency field (connect Splunk to auto-discover)."}
        </p>

        {/* datalists populated from discovery */}
        <datalist id="dl-indexes">
          {indexes.map((i) => <option key={i} value={i} />)}
        </datalist>
        <datalist id="dl-sourcetypes">
          {sourcetypes.map((s) => <option key={s} value={s} />)}
        </datalist>
        <datalist id="dl-fields">
          {fields.map((s) => <option key={s} value={s} />)}
        </datalist>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {field("Index", "index", "ecommerce", "dl-indexes")}
          {field("Sourcetype", "sourcetype", "checkout:transaction", "dl-sourcetypes")}
          {field(
            "Latency field",
            "latency_field",
            "latency_ms",
            "dl-fields",
            discovering ? "discovering…" : f.latency_field ? "auto-detected" : undefined,
          )}
          {field("Service (optional)", "service", "checkout")}
          {field("Deploy sourcetype", "deploy_sourcetype", "deployment:event", "dl-sourcetypes")}
          {field("Earliest", "earliest", "-24h")}
        </div>
        <div className="mt-3">{field("Latest", "latest", "now")}</div>

        {error && (
          <p className="mt-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/20 px-3 py-2 text-[12px] text-red-300">
            {error}
          </p>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Run analysis
        </button>
      </motion.div>
    </div>
  );
}
