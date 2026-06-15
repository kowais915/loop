// Client config from public env. See web/.env.local.example.

// Splunk's web UI owns port 8000, so the LOOP agent runs on 8001 by default.
export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL?.replace(/\/$/, "") || "http://localhost:8001";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// When Supabase is configured we use realtime subscriptions; otherwise we poll
// the agent's REST endpoints so the UI works against the in-memory backend.
export const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
