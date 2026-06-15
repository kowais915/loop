"""LOOP agent — FastAPI service (the brain's HTTP surface).

Endpoints:
  GET  /                         health check
  POST /incidents                create + run loop UNTIL the approval gate
  POST /incidents/{id}/approve   resume: apply → verify → learn → resolved
  POST /incidents/{id}/reject    record rejection, stop
  GET  /incidents                list (for the UI)
  GET  /incidents/{id}           single incident
  GET  /incidents/{id}/steps     all steps so far (snapshot)
  GET  /incidents/{id}/stream    SSE of agent_steps as they arrive
  POST /demo/run                 fire the scripted Incident 1 (+ optional 2)

The loop runs as a FastAPI background task and PAUSES at the human approval
gate. It never executes a remediation on its own.
"""

from __future__ import annotations

import asyncio
import json
import logging

from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from config import get_settings
from loop import LoopEngine
from mcp_client import SplunkMCPClient
from models import get_embedder, get_model_client
from store import get_store

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("loop.api")

settings = get_settings()

# Singletons
store = get_store(settings)
mcp = SplunkMCPClient(settings)
engine = LoopEngine(store, mcp, get_model_client(settings), get_embedder())


@asynccontextmanager
async def lifespan(_: FastAPI):
    await mcp.list_tools()  # logs available MCP tools + generate_spl detection
    yield


app = FastAPI(title="LOOP Agent", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Configured origins (e.g. the Vercel domain) PLUS any localhost port, so
    # local dev works no matter which port Next picks (3000/3001/3003/…).
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class CreateIncident(BaseModel):
    symptom: str = Field(..., min_length=3)
    service: str = Field(..., min_length=1)
    title: str | None = None
    # Optional generic-analysis overrides (Analyze a service). When omitted, the
    # engine uses the curated demo defaults.
    index: str | None = None
    sourcetype: str | None = None
    latency_field: str | None = None
    deploy_sourcetype: str | None = None
    earliest: str | None = None
    latest: str | None = None


class ApprovalBody(BaseModel):
    approved_by: str = "engineer"
    reason: str = ""


class DemoBody(BaseModel):
    include_recurrence: bool = True


class ConnectBody(BaseModel):
    splunk_mcp_url: str = Field(..., min_length=4)
    splunk_mcp_token: str = Field(..., min_length=4)
    verify_tls: bool = True


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
async def health() -> dict[str, object]:
    from runtime import get_connection

    return {
        "service": "loop-agent",
        "status": "ok",
        "splunk_live": mcp.live,
        "mode": get_connection().mode,
        "store": type(store).__name__,
    }


@app.get("/connection")
async def connection_status() -> dict[str, object]:
    from runtime import get_connection

    conn = get_connection()
    return {
        "mode": conn.mode,
        "live": conn.live,
        "url": conn.splunk_mcp_url if conn.live else "",
        "tools": mcp._tool_names if conn.live else [],
    }


@app.post("/connect")
async def connect(body: ConnectBody) -> dict[str, object]:
    """Connect a real Splunk MCP Server at runtime (no .env editing). Verifies by
    listing tools + a test query; leaves the prior connection intact on failure."""
    from runtime import get_connection, set_live, set_sample

    prev = get_connection()
    prev_state = (prev.use_sample, prev.splunk_mcp_url, prev.splunk_mcp_token, prev.verify_tls)

    set_live(body.splunk_mcp_url, body.splunk_mcp_token, body.verify_tls)
    mcp.reset()
    tools = await mcp.list_tools()
    if not tools:
        # revert
        if prev_state[0]:
            set_sample()
        else:
            set_live(prev_state[1], prev_state[2], prev_state[3])
        mcp.reset()
        raise HTTPException(
            502,
            "Could not reach the Splunk MCP Server, or it exposed no tools. "
            "Check the URL/token and that the MCP Server app is running.",
        )
    # quick sanity query (non-fatal)
    test = await mcp.run_spl("| metadata type=sourcetypes index=*", "-24h", "now")
    return {
        "ok": True,
        "mode": "live",
        "tools": tools,
        "query_tool": mcp._query_tool,
        "test_ok": test.ok,
    }


@app.post("/connect/sample")
async def connect_sample() -> dict[str, object]:
    """Zero-setup: serve deterministic sample data so the full loop runs with no
    Splunk at all."""
    from runtime import set_sample

    set_sample()
    mcp.reset()
    return {"ok": True, "mode": "sample"}


# ---------------------------------------------------------------------------
# Discovery — so users can pick from THEIR real indexes/sourcetypes/fields
# instead of guessing names (powers the Analyze form).
# ---------------------------------------------------------------------------
_LATENCY_HINTS = ("latency", "resp", "response", "duration", "elapsed", "time", "ms", "rt")
_SKIP_KEYS = {"host", "index", "source", "sourcetype", "splunk_server", "linecount", "punct"}


def _suggest_latency(fields: list[str]) -> str | None:
    ranked = sorted(
        fields,
        key=lambda f: min(
            (i for i, h in enumerate(_LATENCY_HINTS) if h in f.lower()), default=99
        ),
    )
    return next((f for f in ranked if any(h in f.lower() for h in _LATENCY_HINTS)), None)


@app.get("/splunk/indexes")
async def splunk_indexes() -> dict[str, object]:
    res = await mcp.run_spl(
        "| eventcount summarize=false index=* | where count>0 | fields index", "-24h", "now")
    idx = sorted({str(r.get("index")) for r in res.rows if r.get("index")
                  and not str(r.get("index")).startswith("_")})
    return {"indexes": idx, "error": res.error}


@app.get("/splunk/sourcetypes")
async def splunk_sourcetypes(index: str) -> dict[str, object]:
    res = await mcp.run_spl(
        f"| metadata type=sourcetypes index={index} | sort - totalCount | fields sourcetype",
        "-24h", "now")
    sts = [str(r.get("sourcetype")) for r in res.rows if r.get("sourcetype")]
    return {"sourcetypes": sts, "error": res.error}


@app.get("/splunk/fields")
async def splunk_fields(index: str, sourcetype: str) -> dict[str, object]:
    """Sample recent events and return numeric field names (the client merges
    `_raw` JSON, so this sees fields Splunk doesn't auto-extract)."""
    res = await mcp.run_spl(
        f"search index={index} sourcetype={sourcetype} | head 50", "-7d@d", "now")
    counts: dict[str, int] = {}
    for row in res.rows:
        for k, v in row.items():
            if k.startswith("_") or k in _SKIP_KEYS:
                continue
            try:
                float(v)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                continue
            counts[k] = counts.get(k, 0) + 1
    numeric = sorted(counts, key=lambda k: counts[k], reverse=True)
    return {"numeric_fields": numeric, "suggested": _suggest_latency(numeric), "error": res.error}


@app.post("/incidents")
async def create_incident(body: CreateIncident, bg: BackgroundTasks) -> dict[str, str]:
    from loop import IncidentConfig

    title = body.title or f"{body.service} — {body.symptom}"
    incident = await store.create_incident(
        title=title, service=body.service, symptom=body.symptom)
    iid = incident["id"]

    # Generic "Analyze a service" run when any override is provided; otherwise
    # the engine uses the curated demo defaults.
    if any([body.index, body.sourcetype, body.latency_field,
            body.deploy_sourcetype, body.earliest, body.latest]):
        engine.register_config(iid, IncidentConfig(
            service=body.service,
            index=body.index or "ecommerce",
            sourcetype=body.sourcetype or "checkout:transaction",
            latency_field=body.latency_field or "latency_ms",
            deploy_sourcetype=body.deploy_sourcetype or "deployment:event",
            earliest=body.earliest or "-24h",
            latest=body.latest or "now",
            curated=False,
        ))

    bg.add_task(engine.run_until_gate, iid)
    return {"id": iid}


@app.post("/incidents/{incident_id}/approve")
async def approve(incident_id: str, body: ApprovalBody, bg: BackgroundTasks) -> dict[str, str]:
    incident = await store.get_incident(incident_id)
    if not incident:
        raise HTTPException(404, "incident not found")
    if incident["stage"] != "awaiting_approval":
        raise HTTPException(409, f"incident not awaiting approval (stage={incident['stage']})")
    bg.add_task(engine.resume_after_approval, incident_id, body.approved_by)
    return {"status": "approved", "id": incident_id}


@app.post("/incidents/{incident_id}/reject")
async def reject(incident_id: str, body: ApprovalBody) -> dict[str, str]:
    incident = await store.get_incident(incident_id)
    if not incident:
        raise HTTPException(404, "incident not found")
    if incident["stage"] != "awaiting_approval":
        raise HTTPException(409, f"incident not awaiting approval (stage={incident['stage']})")
    await engine.reject(incident_id, body.approved_by, body.reason)
    return {"status": "rejected", "id": incident_id}


@app.get("/incidents")
async def list_incidents() -> list[dict[str, object]]:
    return await store.list_incidents()


@app.get("/incidents/{incident_id}")
async def get_incident(incident_id: str) -> dict[str, object]:
    incident = await store.get_incident(incident_id)
    if not incident:
        raise HTTPException(404, "incident not found")
    return incident


@app.get("/incidents/{incident_id}/steps")
async def get_steps(incident_id: str) -> list[dict[str, object]]:
    return await store.get_steps(incident_id)


@app.get("/incidents/{incident_id}/stream")
async def stream(incident_id: str) -> StreamingResponse:
    """SSE: emits each new agent_step + a final 'incident' snapshot. Polls the
    store so it works for both Supabase and in-memory backends."""

    async def gen():
        seen = 0
        terminal = {"resolved", "rejected"}
        idle_ticks = 0
        while True:
            steps = await store.get_steps(incident_id)
            for step in steps[seen:]:
                yield f"event: step\ndata: {json.dumps(step, default=str)}\n\n"
            if len(steps) > seen:
                seen = len(steps)
                idle_ticks = 0
            else:
                idle_ticks += 1

            incident = await store.get_incident(incident_id)
            if incident:
                yield f"event: incident\ndata: {json.dumps(incident, default=str)}\n\n"
                if incident["stage"] in terminal:
                    yield "event: done\ndata: {}\n\n"
                    return
            # Stop streaming if nothing happens for a long time (e.g. at the gate
            # the client keeps the connection but we throttle keepalives).
            if idle_ticks > 600:  # ~5 min of silence
                yield "event: done\ndata: {}\n\n"
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/demo/run")
async def demo_run(body: DemoBody, bg: BackgroundTasks) -> dict[str, object]:
    """Fire the scripted incidents so a judge reproduces the full arc."""
    from demo import run_demo

    ids = await run_demo(engine, store, include_recurrence=body.include_recurrence)
    return {"incident_ids": ids}
