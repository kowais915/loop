"use client";

import { useCallback, useEffect, useState } from "react";

import { getIncident, getSteps, listIncidents } from "./api";
import { USE_SUPABASE } from "./config";
import { getSupabase } from "./supabase";
import type { AgentStep, Incident } from "./types";

/**
 * Live view of a single incident + its agent_steps.
 * Prefers Supabase realtime; falls back to polling the agent REST API.
 */
export function useIncident(id: string | null): {
  incident: Incident | null;
  steps: AgentStep[];
} {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [trackedId, setTrackedId] = useState<string | null>(id);

  // Reset when the selected incident changes — adjusting state during render
  // (React's sanctioned pattern; no effect, no ref mutation).
  if (trackedId !== id) {
    setTrackedId(id);
    setSteps([]);
    setIncident(null);
  }

  // Dedup by id via functional update — no ref needed.
  const mergeStep = useCallback((s: AgentStep) => {
    setSteps((prev) =>
      prev.some((p) => p.id === s.id)
        ? prev
        : [...prev, s].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  }, []);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    // Initial snapshot regardless of transport.
    void getIncident(id).then((i) => !cancelled && setIncident(i)).catch(() => {});
    void getSteps(id)
      .then((ss) => {
        if (cancelled) return;
        ss.forEach(mergeStep);
      })
      .catch(() => {});

    if (USE_SUPABASE) {
      const sb = getSupabase()!;
      const channel = sb
        .channel(`incident-${id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "incidents", filter: `id=eq.${id}` },
          (payload) => setIncident(payload.new as Incident),
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "agent_steps",
            filter: `incident_id=eq.${id}`,
          },
          (payload) => mergeStep(payload.new as AgentStep),
        )
        .subscribe();
      return () => {
        cancelled = true;
        void sb.removeChannel(channel);
      };
    }

    // Polling fallback.
    const tick = async () => {
      try {
        const [i, ss] = await Promise.all([getIncident(id), getSteps(id)]);
        if (cancelled) return;
        setIncident(i);
        ss.forEach(mergeStep);
      } catch {
        /* transient */
      }
    };
    const interval = setInterval(tick, 700);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, mergeStep]);

  return { incident, steps };
}

/** Live list of all incidents (memory shelf, MTTR comparison). */
export function useIncidents(pollMs = 1500): Incident[] {
  const [incidents, setIncidents] = useState<Incident[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await listIncidents();
        if (!cancelled) setIncidents(list);
      } catch {
        /* transient */
      }
    };
    void tick();

    if (USE_SUPABASE) {
      const sb = getSupabase()!;
      const channel = sb
        .channel("incidents-list")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "incidents" },
          () => void tick(),
        )
        .subscribe();
      return () => {
        cancelled = true;
        void sb.removeChannel(channel);
      };
    }

    const interval = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollMs]);

  return incidents;
}
