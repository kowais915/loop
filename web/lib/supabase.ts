// Typed Supabase browser client (realtime). Null when not configured.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL, USE_SUPABASE } from "./config";
import type { AgentStep, Incident } from "./types";

export interface Database {
  public: {
    Tables: {
      incidents: { Row: Incident };
      agent_steps: { Row: AgentStep };
    };
  };
}

let _client: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> | null {
  if (!USE_SUPABASE) return null;
  if (!_client) {
    _client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return _client;
}
