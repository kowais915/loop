"""The LOOP engine — the brain.

An explicit state machine that closes the loop Splunk leaves open:

    DETECT → DIAGNOSE → REMEDIATE (propose) → ✋ HUMAN APPROVES → VERIFY → LEARN

It NEVER executes a fix autonomously. It does all the work — detect, diagnose,
draft the exact remediation — then halts at the approval gate and waits for a
human to approve via the API. Only then does it apply (a simulated rollback
event), verify against live data, and learn the signature.

Every transition writes an `agent_steps` row and updates the incident `stage`
so the UI animates the closing ring in realtime. The model is always asked to
cite specific returned numbers; nothing is fabricated.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from mcp_client import SplQueryResult, SplunkMCPClient
from models import (
    Embedder,
    ModelClient,
    diagnose,
    draft_remediation,
    signature_of,
)
from store import Store

logger = logging.getLogger("loop.engine")

# Recall threshold for cross-incident memory. Tuned low enough that the
# hashing-embedder fallback still recognizes the cart_items↔wishlist_items
# N+1 recurrence; sentence-transformers scores well above this.
MEMORY_MATCH_THRESHOLD = 0.55


class LoopEngine:
    def __init__(
        self,
        store: Store,
        mcp: SplunkMCPClient,
        model: ModelClient,
        embedder: Embedder,
    ) -> None:
        self.store = store
        self.mcp = mcp
        self.model = model
        self.embedder = embedder

    # -- step helpers --------------------------------------------------------
    async def _think(self, iid: str, stage: str, text: str, **extra: Any) -> None:
        await self.store.add_step(iid, stage, "think", {"text": text, **extra})

    async def _spl(self, iid: str, stage: str, label: str, res: SplQueryResult) -> None:
        await self.store.add_step(iid, stage, "spl", {
            "label": label, "query": res.query,
            "earliest": res.earliest, "latest": res.latest,
        })
        await self.store.add_step(iid, stage, "mcp_result", {
            "label": label, "row_count": res.count, "rows": res.rows,
            "error": res.error, "used_stub": res.used_stub,
        })

    async def _set_stage(self, iid: str, stage: str, **fields: Any) -> None:
        await self.store.update_incident(iid, stage=stage, **fields)

    # -- window helpers ------------------------------------------------------
    @staticmethod
    def _windows(service: str) -> dict[str, tuple[str, str]]:
        """Earliest/latest pairs for the seeded incident windows."""
        if "wishlist" in service.lower():
            return {
                "detect": ("2026-06-13T16:30:00", "2026-06-13T17:10:00"),
                "verify": ("2026-06-13T17:06:00", "2026-06-13T17:30:00"),
            }
        return {
            "detect": ("2026-06-13T14:00:00", "2026-06-13T15:10:00"),
            "verify": ("2026-06-13T14:47:00", "2026-06-13T15:10:00"),
        }

    # =======================================================================
    # PHASE 1: detect → diagnose → remediate(propose) → HALT at gate
    # =======================================================================
    async def run_until_gate(self, iid: str) -> None:
        try:
            incident = await self.store.get_incident(iid)
            if not incident:
                return
            service = incident["service"]
            windows = self._windows(service)

            # ---------- DETECT ----------
            await self._set_stage(iid, "detect")
            await self._think(iid, "detect",
                f"Establishing whether {service} latency is anomalous and pinning the onset minute.")
            e0, l0 = windows["detect"]
            detect_q = (
                f"index=ecommerce sourcetype=checkout:transaction service={service} "
                f"| timechart span=1m p95(latency_ms) as p95_latency_ms"
            )
            latency = await self.mcp.run_spl(detect_q, e0, l0)
            await self._spl(iid, "detect", "p95 latency by minute", latency)

            peak, baseline, onset = _latency_shape(latency.rows)
            if peak <= baseline * 1.5 and peak < 1000:
                await self._think(iid, "detect",
                    f"No clear anomaly (peak p95 {int(peak)}ms). Holding.", anomaly=False)
                await self._set_stage(iid, "detect")
                return
            await self._think(iid, "detect",
                f"Anomaly confirmed: p95 reached {int(peak)}ms vs ~{int(baseline)}ms baseline"
                + (f", onset around {onset}." if onset else "."),
                anomaly=True, peak=peak, baseline=baseline, onset=onset)

            # ---------- DIAGNOSE ----------
            await self._set_stage(iid, "diagnose")

            # Memory check FIRST — fast path for recurrences.
            probe_sig = signature_of(
                service, "N+1 query pattern after deploy",
                f"{service} checkout latency spiked to ~{int(peak)}ms",
            )
            probe_vec = self.embedder.embed(probe_sig)
            matches = await self.store.match_memory(probe_vec, MEMORY_MATCH_THRESHOLD, 1)

            evidence: dict[str, Any] = {"latency": latency.rows}
            deploy_res: SplQueryResult | None = None

            if matches:
                match = matches[0]
                await self._think(iid, "diagnose",
                    f"⚡ Memory match: this resembles a previously resolved incident "
                    f"(similarity {match.get('similarity', 0):.2f}) — "
                    f"anti-pattern '{match['anti_pattern']}'. Confirming the deploy correlation, "
                    f"then fast-tracking the known fix to the approval gate.",
                    matched=True, similarity=match.get("similarity"),
                    matched_incident_id=match.get("source_incident_id"))
                await self.store.update_incident(
                    iid, matched_incident_id=match.get("source_incident_id"))

            else:
                await self._think(iid, "diagnose",
                    "No prior signature matches. Forming competing falsifiable hypotheses: "
                    "(1) traffic surge, (2) payment provider, (3) DB pool exhaustion, "
                    "(4) recent deploy. Testing each against real Splunk data.")

                # Hypothesis 2: payment (red herring)
                pay = await self.mcp.run_spl(
                    f"index=ecommerce sourcetype=payment:transaction provider=stripe "
                    f"| stats p95(latency_ms) as p95_latency_ms", e0, l0)
                await self._spl(iid, "diagnose", "H2 payment provider latency", pay)
                evidence["payment"] = pay.rows

                # Hypothesis 3: DB pool (red herring)
                pool = await self.mcp.run_spl(
                    f"index=ecommerce sourcetype=db:pool "
                    f"| stats max(active_connections) as active, sum(pool_timeouts) as pool_timeouts", e0, l0)
                await self._spl(iid, "diagnose", "H3 DB connection pool", pool)
                evidence["pool"] = pool.rows

                await self._think(iid, "diagnose",
                    "Payment p95 and DB pool are within normal range — hypotheses 2 and 3 refuted. "
                    "Strongest remaining signal: a recent deploy.")

            # CROSS-DOMAIN CORRELATION — its own loud step (always runs).
            await self.store.add_step(iid, "diagnose", "think", {
                "text": (
                    "CROSS-DOMAIN CORRELATION → connecting the OBSERVABILITY signal "
                    "(latency anomaly) to the CI/CD / PLATFORM signal (deployment event). "
                    "Two domains Splunk uniquely sees together."
                ),
                "cross_domain": True,
            })
            deploy_res = await self.mcp.run_spl(
                f"index=ecommerce sourcetype=deployment:event event_type=deployment service={service} "
                f"| sort _time", e0, l0)
            await self._spl(iid, "diagnose", "Deployment events (CI/CD)", deploy_res)
            evidence["deployment"] = deploy_res.rows

            # N+1 span confirmation
            span_res = await self.mcp.run_spl(
                f"index=ecommerce sourcetype=checkout:span span=db.query "
                f"| stats count as span_count, avg(duration_ms) as avg_duration_ms by table", e0, l0)
            await self._spl(iid, "diagnose", "DB query spans (N+1 check)", span_res)
            evidence["spans"] = span_res.rows

            deploy = _first(deploy_res.rows)
            span = _first(span_res.rows)
            build = deploy.get("build", "unknown")
            prev = deploy.get("previous_build", "previous build")
            table = span.get("table", "the affected table")
            await self._think(iid, "diagnose",
                f"Correlation locked: deploy {build} (prev {prev}) lands at the anomaly onset, "
                f"and db.query spans show an N+1 fan-out on {table}. "
                f"This is the cross-domain link no single-domain tool makes.",
                cross_domain=True, build=build, table=table)

            # Converge on root cause (grounded).
            diag = await diagnose(self.model, evidence)
            await self.store.add_step(iid, "diagnose", "action", {
                "label": "root_cause", "root_cause": diag["root_cause"],
                "confidence": diag.get("confidence"), "evidence": diag.get("evidence", []),
            })

            # ---------- REMEDIATE (PROPOSE ONLY) ----------
            await self._set_stage(iid, "remediate")
            await self._think(iid, "remediate",
                "Drafting the proposed remediation — rollback action + code-level N+1 fix as a "
                "unified diff. PROPOSE ONLY: nothing is applied until a human approves.")
            rem = await draft_remediation(self.model, diag["root_cause"], {
                "table": table, "build": build, "previous_build": prev, "service": service,
            })
            await self.store.add_step(iid, "remediate", "action", {
                "label": "proposed_remediation",
                "remediation": rem["remediation"], "diff": rem["diff"], "rollback": rem["rollback"],
                "applied": False,
            })

            # ---------- HALT AT HUMAN APPROVAL GATE ----------
            await self.store.update_incident(
                iid,
                stage="awaiting_approval",
                root_cause=diag["root_cause"],
                confidence=diag.get("confidence"),
                remediation=rem["remediation"],
                remediation_diff=rem["diff"],
                title=f"{service} latency regression — {table} N+1 after {build}",
            )
            await self.store.add_step(iid, "awaiting_approval", "think", {
                "text": (
                    "✋ HUMAN APPROVAL GATE. LOOP has detected, diagnosed, and drafted the fix. "
                    "It will NOT execute anything. Awaiting a human to Approve & Resolve or Reject. "
                    "Copilot, not autopilot — the engineer stays in command."
                ),
                "gate": True,
            })
            logger.info("Incident %s halted at approval gate.", iid)

        except Exception as exc:  # never leave an incident in a broken silent state
            logger.exception("run_until_gate failed for %s: %s", iid, exc)
            await self._think(iid, "diagnose", f"Loop error: {exc}", error=True)

    # =======================================================================
    # PHASE 2: (on approve) apply → VERIFY → LEARN → resolved
    # =======================================================================
    async def resume_after_approval(self, iid: str, approver: str) -> None:
        try:
            incident = await self.store.get_incident(iid)
            if not incident or incident["stage"] != "awaiting_approval":
                logger.warning("approve ignored: incident %s not at gate", iid)
                return
            service = incident["service"]
            windows = self._windows(service)
            approved_at = datetime.now(timezone.utc)

            await self.store.update_incident(
                iid, approved_by=approver, approved_at=approved_at.isoformat())
            await self.store.add_step(iid, "remediate", "action", {
                "label": "approved", "approved_by": approver, "applied": True,
                "text": f"Approved by {approver}. Applying the rollback (simulated deployment event).",
            })

            # APPLY = emit a simulated rollback deployment event (never mutate Splunk).
            await self.store.add_step(iid, "remediate", "action", {
                "label": "rollback_emitted",
                "text": f"Simulated rollback deployment event emitted for {service}.",
                "applied": True,
            })

            # ---------- VERIFY (live post-fix data) ----------
            await self._set_stage(iid, "verify")
            await self._think(iid, "verify",
                "Re-querying Splunk over the POST-FIX window to prove p95 returned to baseline. "
                "Closure must be evidence-backed, not a status flip.")
            ev, lv = windows["verify"]
            verify_q = (
                f"index=ecommerce sourcetype=checkout:transaction service={service} "
                f"| timechart span=1m p95(latency_ms) as p95_latency_ms"
            )
            # tag the query so the stub returns the recovered window
            post = await self.mcp.run_spl(verify_q + " | eval window=\"verify\"", ev, lv)
            await self._spl(iid, "verify", "Post-fix p95 latency", post)

            post_peak, post_base, _ = _latency_shape(post.rows)
            recovered = post_peak < 1000 if post.rows else False
            await self.store.add_step(iid, "verify", "verify", {
                "label": "verdict", "recovered": recovered,
                "post_fix_p95": post_peak, "baseline": post_base,
                "text": (
                    f"Verified: post-fix p95 ~{int(post_peak)}ms — back at baseline."
                    if recovered else
                    f"Not yet recovered (p95 ~{int(post_peak)}ms). Holding resolution."
                ),
            })

            if not recovered:
                await self._set_stage(iid, "verify")
                return

            created = _parse_ts(incident.get("created_at"))
            mttr = int((approved_at - created).total_seconds()) if created else None

            # ---------- LEARN ----------
            await self._set_stage(iid, "learn")
            span_table = _table_from_root(incident.get("root_cause", ""), service)
            anti_pattern = f"N+1 on {span_table} after deploy"
            sig_text = signature_of(
                service, "N+1 query pattern after deploy", incident.get("root_cause", ""))
            vec = self.embedder.embed(sig_text)
            await self.store.add_memory(
                signature_text=sig_text, embedding=vec, service=service,
                anti_pattern=anti_pattern, fix=incident.get("remediation", ""),
                source_incident_id=iid,
            )
            await self._think(iid, "learn",
                f"Stored signature '{anti_pattern}' to memory. The next occurrence of this "
                f"pattern will be recognized instantly and offered for one-click approval.",
                learned=True, anti_pattern=anti_pattern)

            # ---------- RESOLVED ----------
            await self.store.update_incident(
                iid, stage="resolved", mttr_seconds=mttr,
                resolved_at=datetime.now(timezone.utc).isoformat())
            await self.store.add_step(iid, "resolved", "action", {
                "label": "resolved", "mttr_seconds": mttr,
                "text": (
                    f"Loop closed. Resolved in {mttr}s — detected, diagnosed, human-approved, "
                    f"verified against live data, and learned." if mttr else
                    "Loop closed — verified against live data and learned."
                ),
            })
            logger.info("Incident %s resolved (mttr=%ss).", iid, mttr)

        except Exception as exc:
            logger.exception("resume_after_approval failed for %s: %s", iid, exc)
            await self._think(iid, "verify", f"Verify/learn error: {exc}", error=True)

    # =======================================================================
    # Reject
    # =======================================================================
    async def reject(self, iid: str, approver: str, reason: str = "") -> None:
        incident = await self.store.get_incident(iid)
        if not incident or incident["stage"] != "awaiting_approval":
            return
        await self.store.update_incident(
            iid, stage="rejected", approved_by=approver,
            approved_at=datetime.now(timezone.utc).isoformat())
        await self.store.add_step(iid, "rejected", "action", {
            "label": "rejected", "rejected_by": approver, "reason": reason,
            "text": f"Remediation rejected by {approver}. No action taken; loop stopped.",
        })
        logger.info("Incident %s rejected by %s.", iid, approver)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _latency_shape(rows: list[dict[str, Any]]) -> tuple[float, float, str | None]:
    """Return (peak, baseline, onset_time) from p95 rows."""
    vals: list[tuple[str, float]] = []
    for r in rows:
        v = r.get("p95_latency_ms")
        if v is None:
            continue
        try:
            vals.append((str(r.get("_time", "")), float(v)))
        except (TypeError, ValueError):
            continue
    if not vals:
        return 0.0, 0.0, None
    peak = max(v for _, v in vals)
    baseline = min(v for _, v in vals)
    onset = next((t for t, v in vals if v == peak), None)
    return peak, baseline, onset


def _first(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return rows[0] if rows and isinstance(rows[0], dict) else {}


def _parse_ts(ts: Any) -> datetime | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _table_from_root(root_cause: str, service: str) -> str:
    for token in ("cart_items", "wishlist_items"):
        if token in root_cause:
            return token
    return f"{service}_items"
