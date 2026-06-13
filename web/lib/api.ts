// Calls to the LOOP agent (FastAPI). The agent owns the loop; the UI only
// triggers transitions (create / approve / reject / demo) and reads state.
import { AGENT_URL } from "./config";
import type { AgentStep, Incident } from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}

export async function createIncident(input: {
  symptom: string;
  service: string;
  title?: string;
}): Promise<{ id: string }> {
  const res = await fetch(`${AGENT_URL}/incidents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res);
}

export async function approveIncident(
  id: string,
  approvedBy = "engineer",
): Promise<{ status: string }> {
  const res = await fetch(`${AGENT_URL}/incidents/${id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approved_by: approvedBy }),
  });
  return jsonOrThrow(res);
}

export async function rejectIncident(
  id: string,
  approvedBy = "engineer",
  reason = "",
): Promise<{ status: string }> {
  const res = await fetch(`${AGENT_URL}/incidents/${id}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approved_by: approvedBy, reason }),
  });
  return jsonOrThrow(res);
}

export async function runDemo(
  includeRecurrence = true,
): Promise<{ incident_ids: string[] }> {
  const res = await fetch(`${AGENT_URL}/demo/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ include_recurrence: includeRecurrence }),
  });
  return jsonOrThrow(res);
}

export async function listIncidents(): Promise<Incident[]> {
  return jsonOrThrow(await fetch(`${AGENT_URL}/incidents`, { cache: "no-store" }));
}

export async function getIncident(id: string): Promise<Incident> {
  return jsonOrThrow(
    await fetch(`${AGENT_URL}/incidents/${id}`, { cache: "no-store" }),
  );
}

export async function getSteps(id: string): Promise<AgentStep[]> {
  return jsonOrThrow(
    await fetch(`${AGENT_URL}/incidents/${id}/steps`, { cache: "no-store" }),
  );
}
