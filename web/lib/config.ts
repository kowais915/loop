// Client config from public env. See web/.env.local.example.

export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL?.replace(/\/$/, "") || "http://localhost:8000";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// When Supabase is configured we use realtime subscriptions; otherwise we poll
// the agent's REST endpoints so the UI works against the in-memory backend.
export const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
