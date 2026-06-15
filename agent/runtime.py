"""Runtime Splunk connection — lets the UI connect a Splunk MCP Server at run
time (no .env editing) and switch between live data and zero-setup sample mode.

Process-global and in-memory only: credentials are received from the UI, held
here for the agent's lifetime, and never persisted to disk or the browser. Fine
for a single-worker demo; note this if scaling to multiple workers.
"""

from __future__ import annotations

from dataclasses import dataclass

from config import get_settings


@dataclass
class Connection:
    use_sample: bool
    splunk_mcp_url: str
    splunk_mcp_token: str
    verify_tls: bool

    @property
    def live(self) -> bool:
        """True when we should hit a real Splunk MCP Server (vs stub/sample)."""
        return (not self.use_sample) and bool(
            self.splunk_mcp_url and self.splunk_mcp_token
        )

    @property
    def mode(self) -> str:
        return "live" if self.live else "sample"


_conn: Connection | None = None


def get_connection() -> Connection:
    global _conn
    if _conn is None:
        s = get_settings()
        has_creds = bool(s.splunk_mcp_url and s.splunk_mcp_token)
        _conn = Connection(
            use_sample=not has_creds,  # start live if env has creds, else sample
            splunk_mcp_url=s.splunk_mcp_url,
            splunk_mcp_token=s.splunk_mcp_token,
            verify_tls=s.splunk_verify_tls,
        )
    return _conn


def set_live(url: str, token: str, verify_tls: bool = True) -> Connection:
    c = get_connection()
    c.use_sample = False
    c.splunk_mcp_url = url.strip()
    c.splunk_mcp_token = token.strip()
    c.verify_tls = verify_tls
    return c


def set_sample() -> Connection:
    c = get_connection()
    c.use_sample = True
    return c
