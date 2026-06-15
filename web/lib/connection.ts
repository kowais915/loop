// Runtime Splunk connection — lets the user connect their Splunk MCP Server (or
// pick zero-setup sample mode) from the UI. Creds go to the agent, never stored
// in the browser.
import { AGENT_URL } from "./config";

export interface ConnectionStatus {
  mode: "live" | "sample";
  live: boolean;
  url: string;
  tools: string[];
}

export interface ConnectResult {
  ok: boolean;
  mode: string;
  tools?: string[];
  query_tool?: string | null;
  test_ok?: boolean;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  return jsonOrThrow(await fetch(`${AGENT_URL}/connection`, { cache: "no-store" }));
}

export async function connectSample(): Promise<ConnectResult> {
  return jsonOrThrow(
    await fetch(`${AGENT_URL}/connect/sample`, { method: "POST" }),
  );
}

export async function connectSplunk(
  splunkMcpUrl: string,
  splunkMcpToken: string,
  verifyTls: boolean,
): Promise<ConnectResult> {
  return jsonOrThrow(
    await fetch(`${AGENT_URL}/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        splunk_mcp_url: splunkMcpUrl,
        splunk_mcp_token: splunkMcpToken,
        verify_tls: verifyTls,
      }),
    }),
  );
}
