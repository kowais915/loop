// Shared types — mirror the Supabase schema in agent/db/schema.sql.

export type Stage =
  | "detect"
  | "diagnose"
  | "remediate"
  | "awaiting_approval"
  | "verify"
  | "learn"
  | "resolved"
  | "rejected";

export type StepKind = "think" | "spl" | "mcp_result" | "action" | "verify";

export interface Incident {
  id: string;
  title: string;
  service: string;
  symptom: string;
  stage: Stage;
  root_cause: string | null;
  remediation: string | null;
  remediation_diff: string | null;
  confidence: number | null;
  mttr_seconds: number | null;
  matched_incident_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

// `content` is free-form jsonb; these are the keys the engine emits.
export interface StepContent {
  text?: string;
  label?: string;
  query?: string;
  earliest?: string;
  latest?: string;
  rows?: Array<Record<string, unknown>>;
  row_count?: number;
  error?: string | null;
  used_stub?: boolean;
  // flags
  anomaly?: boolean;
  cross_domain?: boolean;
  gate?: boolean;
  matched?: boolean;
  learned?: boolean;
  recovered?: boolean;
  applied?: boolean;
  // values
  peak?: number;
  baseline?: number;
  onset?: string;
  build?: string;
  table?: string;
  similarity?: number;
  matched_incident_id?: string | null;
  confidence?: number;
  evidence?: string[];
  root_cause?: string;
  remediation?: string;
  diff?: string;
  rollback?: string;
  post_fix_p95?: number;
  mttr_seconds?: number;
  approved_by?: string;
  [key: string]: unknown;
}

export interface AgentStep {
  id: string;
  incident_id: string;
  stage: string;
  kind: StepKind;
  content: StepContent;
  created_at: string;
}

export interface MemorySignature {
  id: string;
  service: string;
  anti_pattern: string;
  fix: string;
  source_incident_id: string | null;
  created_at: string;
}

// The five visible ring stages (awaiting_approval is the gate between
// remediate and verify; resolved/rejected are terminal).
export const RING_STAGES = [
  "detect",
  "diagnose",
  "remediate",
  "verify",
  "learn",
] as const;
export type RingStage = (typeof RING_STAGES)[number];
