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
app = FastAPI(title="LOOP Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins + ["*"] if settings.loop_allow_stubs else settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Singletons
store = get_store(settings)
mcp = SplunkMCPClient(settings)
engine = LoopEngine(store, mcp, get_model_client(settings), get_embedder())


@app.on_event("startup")
async def _startup() -> None:
    await mcp.list_tools()  # logs available MCP tools + generate_spl detection


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class CreateIncident(BaseModel):
    symptom: str = Field(..., min_length=3)
    service: str = Field(..., min_length=1)
    title: str | None = None


class ApprovalBody(BaseModel):
    approved_by: str = "engineer"
    reason: str = ""


class DemoBody(BaseModel):
    include_recurrence: bool = True


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
async def health() -> dict[str, object]:
    return {
        "service": "loop-agent",
        "status": "ok",
        "splunk_live": mcp.live,
        "store": type(store).__name__,
    }


@app.post("/incidents")
async def create_incident(body: CreateIncident, bg: BackgroundTasks) -> dict[str, str]:
    title = body.title or f"{body.service} — {body.symptom}"
    incident = await store.create_incident(
        title=title, service=body.service, symptom=body.symptom)
    bg.add_task(engine.run_until_gate, incident["id"])
    return {"id": incident["id"]}


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
