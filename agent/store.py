"""Persistence layer for LOOP.

A small Store protocol with two impls:
  - SupabaseStore: writes to Postgres; the UI gets live updates via Supabase
    realtime on `incidents` and `agent_steps`, and pgvector recall via the
    match_incident_memory RPC.
  - InMemoryStore: zero-dependency fallback so the full loop runs locally
    without Supabase (LOOP_ALLOW_STUBS). SSE polling reads the in-memory lists.

All public methods are async; SupabaseStore offloads the sync supabase-py
client to a thread so it never blocks the event loop.
"""

from __future__ import annotations

import asyncio
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Protocol

from config import Settings, get_settings

logger = logging.getLogger("loop.store")

Json = dict[str, Any]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store(Protocol):
    async def create_incident(self, *, title: str, service: str, symptom: str) -> Json: ...
    async def get_incident(self, incident_id: str) -> Json | None: ...
    async def list_incidents(self) -> list[Json]: ...
    async def update_incident(self, incident_id: str, **fields: Any) -> Json: ...
    async def add_step(self, incident_id: str, stage: str, kind: str, content: Json) -> Json: ...
    async def get_steps(self, incident_id: str) -> list[Json]: ...
    async def match_memory(self, embedding: list[float], threshold: float, count: int) -> list[Json]: ...
    async def add_memory(self, *, signature_text: str, embedding: list[float], service: str,
                         anti_pattern: str, fix: str, source_incident_id: str) -> Json: ...


# ===========================================================================
# In-memory
# ===========================================================================
class InMemoryStore:
    def __init__(self) -> None:
        self._incidents: dict[str, Json] = {}
        self._steps: dict[str, list[Json]] = {}
        self._memory: list[Json] = []
        self._lock = asyncio.Lock()

    async def create_incident(self, *, title: str, service: str, symptom: str) -> Json:
        async with self._lock:
            iid = str(uuid.uuid4())
            rec = {
                "id": iid, "title": title, "service": service, "symptom": symptom,
                "stage": "detect", "root_cause": None, "remediation": None,
                "remediation_diff": None, "confidence": None, "mttr_seconds": None,
                "matched_incident_id": None, "approved_by": None, "approved_at": None,
                "created_at": _now(), "resolved_at": None,
            }
            self._incidents[iid] = rec
            self._steps[iid] = []
            return dict(rec)

    async def get_incident(self, incident_id: str) -> Json | None:
        rec = self._incidents.get(incident_id)
        return dict(rec) if rec else None

    async def list_incidents(self) -> list[Json]:
        return sorted(
            (dict(r) for r in self._incidents.values()),
            key=lambda r: r["created_at"], reverse=True,
        )

    async def update_incident(self, incident_id: str, **fields: Any) -> Json:
        async with self._lock:
            rec = self._incidents[incident_id]
            rec.update(fields)
            return dict(rec)

    async def add_step(self, incident_id: str, stage: str, kind: str, content: Json) -> Json:
        async with self._lock:
            step = {
                "id": str(uuid.uuid4()), "incident_id": incident_id, "stage": stage,
                "kind": kind, "content": content, "created_at": _now(),
            }
            self._steps.setdefault(incident_id, []).append(step)
            return dict(step)

    async def get_steps(self, incident_id: str) -> list[Json]:
        return [dict(s) for s in self._steps.get(incident_id, [])]

    async def match_memory(self, embedding: list[float], threshold: float, count: int) -> list[Json]:
        scored: list[Json] = []
        for m in self._memory:
            sim = _cosine(embedding, m["embedding"])
            if sim >= threshold:
                scored.append({**m, "similarity": sim})
        scored.sort(key=lambda m: m["similarity"], reverse=True)
        return [{k: v for k, v in m.items() if k != "embedding"} for m in scored[:count]]

    async def add_memory(self, *, signature_text: str, embedding: list[float], service: str,
                         anti_pattern: str, fix: str, source_incident_id: str) -> Json:
        async with self._lock:
            rec = {
                "id": str(uuid.uuid4()), "signature_text": signature_text,
                "embedding": embedding, "service": service, "anti_pattern": anti_pattern,
                "fix": fix, "source_incident_id": source_incident_id, "created_at": _now(),
            }
            self._memory.append(rec)
            return {k: v for k, v in rec.items() if k != "embedding"}


# ===========================================================================
# Supabase
# ===========================================================================
class SupabaseStore:
    def __init__(self, settings: Settings) -> None:
        from supabase import create_client

        self._client = create_client(settings.supabase_url, settings.supabase_service_key)

    async def _run(self, fn: Any) -> Any:
        return await asyncio.to_thread(fn)

    async def create_incident(self, *, title: str, service: str, symptom: str) -> Json:
        def op() -> Json:
            res = self._client.table("incidents").insert(
                {"title": title, "service": service, "symptom": symptom, "stage": "detect"}
            ).execute()
            return res.data[0]
        return await self._run(op)

    async def get_incident(self, incident_id: str) -> Json | None:
        def op() -> Json | None:
            res = self._client.table("incidents").select("*").eq("id", incident_id).execute()
            return res.data[0] if res.data else None
        return await self._run(op)

    async def list_incidents(self) -> list[Json]:
        def op() -> list[Json]:
            res = (self._client.table("incidents").select("*")
                   .order("created_at", desc=True).execute())
            return res.data or []
        return await self._run(op)

    async def update_incident(self, incident_id: str, **fields: Any) -> Json:
        def op() -> Json:
            res = (self._client.table("incidents").update(fields)
                   .eq("id", incident_id).execute())
            return res.data[0]
        return await self._run(op)

    async def add_step(self, incident_id: str, stage: str, kind: str, content: Json) -> Json:
        def op() -> Json:
            res = self._client.table("agent_steps").insert(
                {"incident_id": incident_id, "stage": stage, "kind": kind, "content": content}
            ).execute()
            return res.data[0]
        return await self._run(op)

    async def get_steps(self, incident_id: str) -> list[Json]:
        def op() -> list[Json]:
            res = (self._client.table("agent_steps").select("*")
                   .eq("incident_id", incident_id).order("created_at").execute())
            return res.data or []
        return await self._run(op)

    async def match_memory(self, embedding: list[float], threshold: float, count: int) -> list[Json]:
        def op() -> list[Json]:
            res = self._client.rpc("match_incident_memory", {
                "query_embedding": embedding,
                "match_threshold": threshold,
                "match_count": count,
            }).execute()
            return res.data or []
        try:
            return await self._run(op)
        except Exception as exc:
            logger.error("match_incident_memory RPC failed: %s", exc)
            return []

    async def add_memory(self, *, signature_text: str, embedding: list[float], service: str,
                         anti_pattern: str, fix: str, source_incident_id: str) -> Json:
        def op() -> Json:
            res = self._client.table("incident_memory").insert({
                "signature_text": signature_text, "embedding": embedding, "service": service,
                "anti_pattern": anti_pattern, "fix": fix, "source_incident_id": source_incident_id,
            }).execute()
            return res.data[0]
        return await self._run(op)


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


_store: Store | None = None


def get_store(settings: Settings | None = None) -> Store:
    global _store
    if _store is not None:
        return _store
    settings = settings or get_settings()
    if settings.has_supabase:
        logger.info("Store: Supabase")
        _store = SupabaseStore(settings)
    else:
        logger.warning("Store: in-memory (no Supabase creds)")
        _store = InMemoryStore()
    return _store
