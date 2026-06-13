"""Demo orchestration — fire the scripted incidents end-to-end so a judge can
reproduce the full arc in one click.

Incident 1 (checkout) runs the full diagnosis. Incident 2 (wishlist) is the
recurrence that hits the learned signature for one-click approval. Approvals
are still simulated through the same gate the UI uses — the human-in-the-loop
gate is real; demo mode just auto-approves after a short, visible pause so the
verify + learn stages play out.
"""

from __future__ import annotations

import asyncio
import logging

from loop import LoopEngine
from store import Store

logger = logging.getLogger("loop.demo")

# Visible pause at the gate so the approval moment is narratable on video.
GATE_PAUSE_SECONDS = 6.0


async def _drive(engine: LoopEngine, store: Store, *, service: str, symptom: str,
                 auto_approve: bool, approver: str) -> str:
    incident = await store.create_incident(
        title=f"{service} — {symptom}", service=service, symptom=symptom)
    iid = incident["id"]
    await engine.run_until_gate(iid)
    if auto_approve:
        await asyncio.sleep(GATE_PAUSE_SECONDS)  # let the gate be seen
        await engine.resume_after_approval(iid, approver)
    return iid


async def run_demo(engine: LoopEngine, store: Store, *,
                   include_recurrence: bool = True,
                   auto_approve: bool = True) -> list[str]:
    """Run Incident 1, then (optionally) the Incident 2 recurrence."""
    ids: list[str] = []
    ids.append(await _drive(
        engine, store, service="checkout",
        symptom="checkout p95 latency spiked to ~3.2s",
        auto_approve=auto_approve, approver="demo-engineer"))

    if include_recurrence:
        await asyncio.sleep(2.0)
        ids.append(await _drive(
            engine, store, service="wishlist",
            symptom="wishlist p95 latency spiked to ~3.1s",
            auto_approve=auto_approve, approver="demo-engineer"))
    return ids


if __name__ == "__main__":  # local: python demo.py
    from mcp_client import SplunkMCPClient
    from models import get_embedder, get_model_client
    from store import get_store

    async def _main() -> None:
        store = get_store()
        engine = LoopEngine(store, SplunkMCPClient(), get_model_client(), get_embedder())
        ids = await run_demo(engine, store)
        for iid in ids:
            inc = await store.get_incident(iid)
            print(f"{inc['service']:10s} stage={inc['stage']:9s} "
                  f"mttr={inc['mttr_seconds']} matched={bool(inc['matched_incident_id'])}")

    asyncio.run(_main())
