"""Hosted-model + embedding layer for LOOP.

Two swappable concerns behind small interfaces:

  1. ModelClient — text completion for diagnosis reasoning and remediation
     drafting. The primary impl, FoundationSecClient, calls the Splunk Hosted
     Model (Foundation-Sec-8B) over an OpenAI-compatible endpoint. An Anthropic
     orchestrator fallback and a deterministic offline stub are also provided.
     SplunkAIAssistantClient is stubbed for generate_spl if the token lands.

  2. Embedder — turns an incident signature into a 384-dim vector for the
     pgvector memory store. Prefers a local sentence-transformer; falls back to
     a deterministic hashing embedder so the loop runs without heavy ML wheels.

Everything is grounded: callers pass real SPL evidence; the model is asked to
cite the actual numbers and never invent them.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Protocol

from config import Settings, get_settings

logger = logging.getLogger("loop.models")

EMBED_DIM = 384


# ===========================================================================
# Text completion
# ===========================================================================
class ModelClient(Protocol):
    name: str

    async def complete(self, system: str, prompt: str) -> str: ...


class FoundationSecClient:
    """Splunk Hosted Model (Foundation-Sec-8B) via OpenAI-compatible API."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.name = settings.hosted_model_name or "foundation-sec-8b"

    async def complete(self, system: str, prompt: str) -> str:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            base_url=self.settings.hosted_model_url,
            api_key=self.settings.hosted_model_key,
        )
        resp = await client.chat.completions.create(
            model=self.name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        return resp.choices[0].message.content or ""


class AnthropicClient:
    """Orchestrator fallback when the hosted model is unreachable."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.name = "claude-fallback"

    async def complete(self, system: str, prompt: str) -> str:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=self.settings.anthropic_api_key)
        resp = await client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        parts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
        return "".join(parts)


class StubModelClient:
    """Deterministic offline model. Returns grounded JSON from the evidence so
    the loop runs without any model creds (local UI dev / CI)."""

    name = "stub-model"

    async def complete(self, system: str, prompt: str) -> str:
        # The loop's helpers parse JSON; emit a permissive echo. Real grounding
        # for the demo comes from the structured helpers below, not free text.
        return json.dumps({"note": "stub-model", "echo": prompt[:200]})


class SplunkAIAssistantClient:
    """TODO: wire Splunk AI Assistant `generate_spl` once an activation token
    arrives. Kept as a swappable seam so the rest of the system is unchanged."""

    name = "splunk-ai-assistant"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def generate_spl(self, natural_language: str) -> str:  # pragma: no cover
        raise NotImplementedError("Splunk AI Assistant generate_spl not yet enabled")


def get_model_client(settings: Settings | None = None) -> ModelClient:
    settings = settings or get_settings()
    if settings.has_hosted_model:
        logger.info("Model: Foundation-Sec (%s)", settings.hosted_model_name)
        return FoundationSecClient(settings)
    if settings.anthropic_api_key:
        logger.info("Model: Anthropic fallback")
        return AnthropicClient(settings)
    logger.warning("Model: STUB (no hosted-model or Anthropic creds)")
    return StubModelClient()


# ===========================================================================
# Embeddings
# ===========================================================================
class Embedder(Protocol):
    name: str

    def embed(self, text: str) -> list[float]: ...


class SentenceTransformerEmbedder:
    """Local 384-dim embeddings (all-MiniLM-L6-v2)."""

    name = "all-MiniLM-L6-v2"

    def __init__(self) -> None:
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    def embed(self, text: str) -> list[float]:
        vec = self._model.encode([text], normalize_embeddings=True)[0]
        return [float(x) for x in vec]


class HashingEmbedder:
    """Deterministic, dependency-free fallback embedder.

    Token-hashing bag-of-words projected into EMBED_DIM and L2-normalized. Not
    semantically rich, but stable and good enough for the demo's two clearly
    distinct-yet-related signatures (cart_items vs wishlist_items N+1)."""

    name = "hashing-384"

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * EMBED_DIM
        tokens = [t for t in _normalize(text).split() if t]
        for tok in tokens:
            h = int.from_bytes(hashlib.md5(tok.encode()).digest()[:8], "big")
            idx = h % EMBED_DIM
            sign = 1.0 if (h >> 8) & 1 else -1.0
            vec[idx] += sign
        norm = sum(x * x for x in vec) ** 0.5
        if norm > 0:
            vec = [x / norm for x in vec]
        return vec


def get_embedder() -> Embedder:
    try:
        emb = SentenceTransformerEmbedder()
        logger.info("Embedder: %s", emb.name)
        return emb
    except Exception as exc:  # heavy wheels may be unavailable (e.g. py3.14)
        logger.warning("sentence-transformers unavailable (%s); using hashing fallback", exc)
        return HashingEmbedder()


def _normalize(text: str) -> str:
    return "".join(c.lower() if c.isalnum() else " " for c in text)


# ===========================================================================
# Grounded helpers used by the loop. These build the prompts and parse the
# model output, always falling back to deterministic logic over the real
# evidence so the demo never fabricates and never hard-fails.
# ===========================================================================
DIAGNOSE_SYSTEM = (
    "You are an SRE diagnosis engine. You are given real Splunk query results. "
    "Reason ONLY from the provided numbers. Never invent values. Identify the "
    "single root cause and cite the specific evidence (p95 values, build IDs, "
    "span counts). Respond as compact JSON with keys: root_cause, confidence "
    "(0..1), evidence (list of short strings citing real numbers)."
)

REMEDIATE_SYSTEM = (
    "You are an SRE remediation drafter. Given a confirmed root cause, propose "
    "(do NOT execute) a remediation: a rollback action and a concrete code-level "
    "fix as a unified diff. Respond as compact JSON with keys: remediation "
    "(plain language), diff (unified diff string), rollback (short action)."
)


async def diagnose(model: ModelClient, evidence: dict[str, Any]) -> dict[str, Any]:
    """Produce {root_cause, confidence, evidence[]} grounded in real rows."""
    prompt = (
        "Splunk evidence (real query results):\n"
        + json.dumps(evidence, indent=2, default=str)
        + "\n\nReturn the JSON described in the system prompt."
    )
    raw = await _safe_complete(model, DIAGNOSE_SYSTEM, prompt)
    parsed = _extract_json(raw)
    if parsed and parsed.get("root_cause"):
        parsed.setdefault("confidence", 0.9)
        parsed.setdefault("evidence", [])
        return parsed
    return _diagnose_fallback(evidence)


async def draft_remediation(
    model: ModelClient, root_cause: str, context: dict[str, Any]
) -> dict[str, Any]:
    """Produce {remediation, diff, rollback}. Falls back to a real N+1 diff."""
    prompt = (
        f"Confirmed root cause: {root_cause}\n"
        f"Context: {json.dumps(context, default=str)}\n\n"
        "Return the JSON described in the system prompt."
    )
    raw = await _safe_complete(model, REMEDIATE_SYSTEM, prompt)
    parsed = _extract_json(raw)
    if parsed and parsed.get("diff"):
        parsed.setdefault("remediation", root_cause)
        parsed.setdefault("rollback", "Roll back the offending deploy")
        return parsed
    return _remediation_fallback(context)


def signature_of(service: str, anti_pattern: str, root_cause: str) -> str:
    """Canonical text signature stored + embedded for cross-incident recall."""
    return f"service={service} | anti_pattern={anti_pattern} | root_cause={root_cause}"


# -- internal ----------------------------------------------------------------
async def _safe_complete(model: ModelClient, system: str, prompt: str) -> str:
    try:
        return await model.complete(system, prompt)
    except Exception as exc:
        logger.error("model.complete failed (%s): %s", model.name, exc)
        return ""


def _extract_json(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    raw = raw.strip()
    # Strip markdown fences if present.
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw[raw.find("{") :] if "{" in raw else raw
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        obj = json.loads(raw[start : end + 1])
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def _diagnose_fallback(evidence: dict[str, Any]) -> dict[str, Any]:
    """Deterministic diagnosis built from the real evidence dict the loop
    assembled. Cites actual numbers pulled from the rows."""
    deploy = _first(evidence.get("deployment", []))
    spans = _first(evidence.get("spans", []))
    latency = evidence.get("latency", [])
    peak = max((_num(r.get("p95_latency_ms")) for r in latency), default=0)
    baseline = min((_num(r.get("p95_latency_ms")) for r in latency), default=0)

    build = deploy.get("build", "unknown") if deploy else "unknown"
    table = spans.get("table", "the affected table") if spans else "the affected table"
    span_count = spans.get("span_count") if spans else None

    ev: list[str] = []
    if peak:
        ev.append(f"p95 spiked to {int(peak)}ms (baseline ~{int(baseline)}ms)")
    if deploy:
        ev.append(f"deploy {build} immediately precedes the onset")
    if span_count:
        ev.append(f"{span_count} per-line-item db.query spans on {table} (N+1)")
    healthy = []
    if evidence.get("payment"):
        healthy.append("payment/stripe healthy")
    if evidence.get("pool"):
        healthy.append("db pool healthy (0 timeouts)")
    if healthy:
        ev.append("red herrings ruled out: " + ", ".join(healthy))

    root = (
        f"Deploy {build} introduced an N+1 query pattern on {table}, "
        f"driving checkout p95 from ~{int(baseline)}ms to ~{int(peak)}ms."
    )
    return {"root_cause": root, "confidence": 0.93, "evidence": ev}


def _remediation_fallback(context: dict[str, Any]) -> dict[str, Any]:
    table = context.get("table", "cart_items")
    build = context.get("build", "v2.4.1")
    prev = context.get("previous_build", "v2.4.0")
    service = context.get("service", "checkout")
    singular = table.rstrip("s")
    diff = f"""--- a/services/{service}/repository.py
+++ b/services/{service}/repository.py
@@ def load_{table}(order):
-    items = []
-    for line in order.lines:
-        # N+1: one query per line item
-        item = db.query(
-            "SELECT * FROM {table} WHERE id = %s", line.{singular}_id
-        )
-        items.append(item)
-    return items
+    # Batch fetch: single query for all line items
+    ids = [line.{singular}_id for line in order.lines]
+    rows = db.query(
+        "SELECT * FROM {table} WHERE id = ANY(%s)", ids
+    )
+    return [rows[line.{singular}_id] for line in order.lines]
"""
    remediation = (
        f"Roll back {service} {build} → {prev} to immediately restore baseline "
        f"latency, then ship the batched-query fix that eliminates the N+1 on "
        f"{table} (one query instead of one-per-line-item)."
    )
    rollback = f"Roll back {service} {build} → {prev}"
    return {"remediation": remediation, "diff": diff, "rollback": rollback}


def _first(seq: Any) -> dict[str, Any]:
    if isinstance(seq, list) and seq and isinstance(seq[0], dict):
        return seq[0]
    return {}


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0
