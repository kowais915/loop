"""Splunk MCP client.

Talks to the Splunk MCP Server over streamable-HTTP with a Bearer token and
runs SPL via the server's query tool. Designed to never crash the loop: a failed
query returns an empty result set plus an error note, and the engine reasons
about emptiness rather than throwing.

When no Splunk creds are present and LOOP_ALLOW_STUBS is on, it serves
deterministic synthetic rows that match the seeded `index=ecommerce` incidents
so the full loop runs end-to-end for local UI development.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from config import Settings, get_settings

logger = logging.getLogger("loop.mcp")

# Tool-name candidates the Splunk MCP Server may expose for running SPL.
_QUERY_TOOL_CANDIDATES = (
    "run_splunk_query",
    "run_oneshot_search",
    "run_search",
    "search",
)

# Optional tools we care about detecting (Splunk AI Assistant).
_GENERATE_SPL_TOOL = "generate_spl"
_EXPLAIN_SPL_TOOL = "explain_spl"

Row = dict[str, Any]


@dataclass
class SplQueryResult:
    """Result of one SPL run. Empty rows + an error string means a soft failure."""

    rows: list[Row] = field(default_factory=list)
    error: str | None = None
    query: str = ""
    earliest: str = ""
    latest: str = ""
    used_stub: bool = False

    @property
    def ok(self) -> bool:
        return self.error is None

    @property
    def count(self) -> int:
        return len(self.rows)


class SplunkMCPClient:
    """Streamable-HTTP MCP client for running SPL against the Splunk MCP Server."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._tool_names: list[str] = []
        self._query_tool: str | None = None
        self.has_generate_spl = False
        self.has_explain_spl = False
        self._listed = False

    # -- connection helpers --------------------------------------------------
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.settings.splunk_mcp_token}"}

    @property
    def live(self) -> bool:
        return self.settings.has_splunk

    async def list_tools(self) -> list[str]:
        """List MCP tools on startup; detect generate_spl / explain_spl. Logged."""
        if not self.live:
            logger.warning(
                "Splunk MCP not configured; running in STUB mode (LOOP_ALLOW_STUBS=%s).",
                self.settings.loop_allow_stubs,
            )
            self._listed = True
            return []

        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client

            async with streamablehttp_client(
                self.settings.splunk_mcp_url, headers=self._headers()
            ) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    listing = await session.list_tools()
                    self._tool_names = [t.name for t in listing.tools]
        except Exception as exc:  # never crash startup on MCP issues
            logger.error("Failed to list Splunk MCP tools: %s", exc)
            self._listed = True
            return []

        self._listed = True
        self.has_generate_spl = _GENERATE_SPL_TOOL in self._tool_names
        self.has_explain_spl = _EXPLAIN_SPL_TOOL in self._tool_names
        self._query_tool = next(
            (t for t in _QUERY_TOOL_CANDIDATES if t in self._tool_names), None
        )
        logger.info("Splunk MCP tools: %s", self._tool_names)
        logger.info(
            "Query tool=%s  generate_spl=%s  explain_spl=%s",
            self._query_tool,
            self.has_generate_spl,
            self.has_explain_spl,
        )
        if self._query_tool is None:
            logger.error(
                "No known SPL query tool found among %s", _QUERY_TOOL_CANDIDATES
            )
        return self._tool_names

    # -- the one method the loop needs --------------------------------------
    async def run_spl(
        self, query: str, earliest: str = "-24h", latest: str = "now"
    ) -> SplQueryResult:
        """Run SPL and return typed rows. Soft-fails to an empty result + error."""
        if not self.live:
            rows = _stub_rows(query)
            return SplQueryResult(
                rows=rows, query=query, earliest=earliest, latest=latest, used_stub=True
            )

        if not self._listed:
            await self.list_tools()
        tool = self._query_tool or _QUERY_TOOL_CANDIDATES[0]

        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client

            async with streamablehttp_client(
                self.settings.splunk_mcp_url, headers=self._headers()
            ) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool(
                        tool,
                        {
                            "query": _ensure_search_prefix(query),
                            "earliest_time": earliest,
                            "latest_time": latest,
                        },
                    )
            rows = _parse_tool_result(result)
            return SplQueryResult(
                rows=rows, query=query, earliest=earliest, latest=latest
            )
        except Exception as exc:
            logger.error("SPL query failed (%s): %s", query, exc)
            return SplQueryResult(
                rows=[], error=str(exc), query=query, earliest=earliest, latest=latest
            )


# ---------------------------------------------------------------------------
# Result parsing
# ---------------------------------------------------------------------------
def _ensure_search_prefix(query: str) -> str:
    q = query.strip()
    if q.startswith("|") or q.lower().startswith("search "):
        return q
    return f"search {q}"


def _parse_tool_result(result: Any) -> list[Row]:
    """Best-effort parse of an MCP CallToolResult into a list of row dicts."""
    texts: list[str] = []
    content = getattr(result, "content", None) or []
    for item in content:
        text = getattr(item, "text", None)
        if text:
            texts.append(text)
    blob = "\n".join(texts).strip()
    if not blob:
        # Some servers put parsed output in structuredContent.
        structured = getattr(result, "structuredContent", None)
        if isinstance(structured, dict):
            return _coerce_rows(structured)
        return []

    # Try a single JSON document first.
    try:
        parsed = json.loads(blob)
        return _coerce_rows(parsed)
    except json.JSONDecodeError:
        pass

    # Fall back to JSON-lines (one event per line).
    rows: list[Row] = []
    for line in blob.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                rows.append(obj)
        except json.JSONDecodeError:
            continue
    return rows


def _coerce_rows(parsed: Any) -> list[Row]:
    if isinstance(parsed, list):
        return [r for r in parsed if isinstance(r, dict)]
    if isinstance(parsed, dict):
        for key in ("results", "rows", "data", "events"):
            val = parsed.get(key)
            if isinstance(val, list):
                return [r for r in val if isinstance(r, dict)]
        return [parsed]
    return []


# ---------------------------------------------------------------------------
# Stub data — deterministic synthetic rows matching the seeded incidents.
# Only used when Splunk creds are absent (local UI dev). Heuristic on the SPL.
# ---------------------------------------------------------------------------
def _stub_rows(query: str) -> list[Row]:
    q = query.lower()

    # Deployment events (cross-domain correlation source).
    if "deployment:event" in q or "event_type=deployment" in q:
        if "wishlist" in q:
            return [
                {
                    "_time": "2026-06-13T16:49:00",
                    "service": "wishlist",
                    "build": "v1.7.0",
                    "previous_build": "v1.6.4",
                    "event_type": "deployment",
                    "message": "Deployed wishlist v1.7.0",
                    "change": "Add wishlist line-item enrichment",
                }
            ]
        return [
            {
                "_time": "2026-06-13T14:19:00",
                "service": "checkout",
                "build": "v2.4.1",
                "previous_build": "v2.4.0",
                "event_type": "deployment",
                "message": "Deployed checkout v2.4.1",
                "change": "Cart item enrichment refactor",
            }
        ]

    # N+1 span evidence.
    if "checkout:span" in q or "span=db.query" in q or "n+1" in q:
        table = "wishlist_items" if "wishlist" in q else "cart_items"
        return [
            {
                "table": table,
                "span": "db.query",
                "span_count": 38 if table == "cart_items" else 41,
                "avg_duration_ms": 74.2,
                "note": "per-line-item fetch (N+1)",
            }
        ]

    # Payment red herring — healthy.
    if "payment:transaction" in q or "provider=stripe" in q:
        return [{"provider": "stripe", "p95_latency_ms": 121, "status": "healthy"}]

    # DB pool red herring — healthy.
    if "db:pool" in q or "pool_timeouts" in q:
        return [
            {"pool_size": 50, "active_connections": 7, "pool_timeouts": 0}
        ]

    # Latency timechart (DETECT / VERIFY).
    if "timechart" in q or "p95" in q or "latency_ms" in q or "stats" in q:
        wishlist = "wishlist" in q
        onset = "16:50" if wishlist else "14:20"
        recover = "17:05" if wishlist else "14:46"
        spike = 3100 if wishlist else 3200
        # If the window is the post-fix verify window, return baseline only.
        if "verify" in q or "post" in q:
            return [
                {"_time": f"2026-06-13T{recover}:00", "p95_latency_ms": 268},
                {"_time": "2026-06-13T17:10:00" if wishlist else "2026-06-13T15:00:00",
                 "p95_latency_ms": 275},
            ]
        return [
            {"_time": "2026-06-13T14:15:00" if not wishlist else "2026-06-13T16:45:00",
             "p95_latency_ms": 281},
            {"_time": f"2026-06-13T{onset}:00", "p95_latency_ms": spike},
            {"_time": f"2026-06-13T{recover}:00", "p95_latency_ms": 272},
        ]

    # Generic error events.
    if "checkout:error" in q or "level=error" in q:
        return [
            {
                "level": "ERROR",
                "message": "checkout latency SLA breach",
                "build": "v2.4.1",
            }
        ]

    return []
