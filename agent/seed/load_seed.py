"""Seed loader for LOOP — pushes the two demo incidents into index=ecommerce
via Splunk HTTP Event Collector (HEC), with timestamps that line up exactly
with the windows the loop engine queries.

Prereqs (do these in the Splunk UI once):
  1. Settings → Indexes → New Index → name `ecommerce`.
  2. Settings → Data Inputs → HTTP Event Collector:
       - Global Settings → All Tokens: Enabled (port 8088).
       - New Token → name `loop` → allow index `ecommerce` → copy the token.
  3. Put the token in agent/.env as SPLUNK_HEC_TOKEN (and SPLUNK_HEC_URL if not
     the localhost default). Set SPLUNK_VERIFY_TLS=0 for local self-signed certs.

Run:  python -m seed.load_seed        (from the agent/ dir, venv active)

Incident 1 (checkout): baseline ~280ms → deploy v2.4.1 @ 14:19 introduces an
N+1 on cart_items → p95 ~3200ms (14:20–14:45) → rollback v2.4.0 @ 14:46 →
recovery. Incident 2 (wishlist): deploy v1.7.0 @ 16:49, same N+1 on
wishlist_items, ~3100ms (16:50–17:05). Payment + DB pool stay healthy.

All events are dated 2026-06-13 to match the loop's query windows.
"""

from __future__ import annotations

import json
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx

# Make `config` importable whether run as module or script.
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
from config import get_settings  # noqa: E402

INDEX = "ecommerce"
DAY = "2026-06-13"
random.seed(7)


@dataclass
class IncidentSpec:
    service: str
    table: str
    build_bad: str
    build_good: str
    deploy_min: str          # "HH:MM" deploy of the bad build
    rollback_min: str        # "HH:MM" rollback to good build
    window_start: str        # "HH:MM"
    window_end: str          # "HH:MM"
    spike_start: str         # "HH:MM"
    spike_end: str           # "HH:MM"
    baseline_ms: int
    spike_ms: int


CHECKOUT = IncidentSpec(
    service="checkout", table="cart_items",
    build_bad="v2.4.1", build_good="v2.4.0",
    deploy_min="14:19", rollback_min="14:46",
    window_start="14:00", window_end="15:10",
    spike_start="14:20", spike_end="14:45",
    baseline_ms=280, spike_ms=3200,
)
WISHLIST = IncidentSpec(
    service="wishlist", table="wishlist_items",
    build_bad="v1.7.0", build_good="v1.6.4",
    deploy_min="16:49", rollback_min="17:05",
    window_start="16:30", window_end="17:10",
    spike_start="16:50", spike_end="17:05",
    baseline_ms=275, spike_ms=3100,
)


def _t(hhmm: str) -> datetime:
    return datetime.fromisoformat(f"{DAY}T{hhmm}:00")


def _epoch(dt: datetime) -> float:
    # Local-time epoch so it matches naive earliest/latest in the instance tz.
    return dt.astimezone().timestamp()


def _minutes(start: str, end: str):
    cur, stop = _t(start), _t(end)
    while cur <= stop:
        yield cur
        cur += timedelta(minutes=1)


def _p95_batch(target_ms: int, n: int = 12) -> list[int]:
    """n latencies whose ~95th percentile is target_ms."""
    out = [int(target_ms * random.uniform(0.6, 0.85)) for _ in range(n - 2)]
    out += [int(target_ms * random.uniform(0.95, 1.02)) for _ in range(2)]
    return out


def _in_window(dt: datetime, start: str, end: str) -> bool:
    return _t(start) <= dt <= _t(end)


def build_events(spec: IncidentSpec) -> list[dict]:
    events: list[dict] = []

    def add(dt: datetime, sourcetype: str, event: dict) -> None:
        events.append({
            "time": _epoch(dt), "index": INDEX, "host": f"{spec.service}-prod",
            "source": "loop-seed", "sourcetype": sourcetype, "event": event,
        })

    # transaction events per minute
    for dt in _minutes(spec.window_start, spec.window_end):
        spiking = _in_window(dt, spec.spike_start, spec.spike_end)
        target = spec.spike_ms if spiking else spec.baseline_ms
        # build reflects deploy/rollback timeline
        if dt >= _t(spec.rollback_min):
            build = spec.build_good
        elif dt >= _t(spec.deploy_min):
            build = spec.build_bad
        else:
            build = spec.build_good
        for lat in _p95_batch(target):
            db_ms = int(lat * (0.85 if spiking else 0.4))
            add(dt, "checkout:transaction", {
                "service": spec.service, "build": build, "status": "ok",
                "latency_ms": lat, "db_query_ms": db_ms,
                "cart_items": random.randint(2, 9),
                "endpoint": f"/{spec.service}/submit",
                "trace_id": f"{random.randrange(16**12):012x}",
            })
        # N+1 spans during the spike window
        if spiking:
            for _ in range(random.randint(6, 9)):
                add(dt, "checkout:span", {
                    "span": "db.query", "table": spec.table,
                    "duration_ms": round(random.uniform(60, 95), 1),
                    "service": spec.service,
                    "note": "per-line-item fetch (N+1)",
                })
            if random.random() < 0.5:
                add(dt, "checkout:error", {
                    "level": "ERROR", "build": spec.build_bad,
                    "message": f"{spec.service} latency SLA breach",
                })

    # deployment events (the cross-domain signal)
    add(_t(spec.deploy_min), "deployment:event", {
        "event_type": "deployment", "service": spec.service,
        "build": spec.build_bad, "previous_build": spec.build_good,
        "message": f"Deployed {spec.service} {spec.build_bad}",
        "change": f"{spec.table} enrichment refactor",
    })
    add(_t(spec.rollback_min), "deployment:event", {
        "event_type": "deployment", "service": spec.service,
        "build": spec.build_good, "previous_build": spec.build_bad,
        "message": f"Rolled back {spec.service} to {spec.build_good}",
        "change": "rollback",
    })

    # red herrings — healthy throughout
    for dt in _minutes(spec.window_start, spec.window_end):
        add(dt, "payment:transaction", {
            "provider": "stripe", "status": "healthy",
            "latency_ms": random.randint(110, 130),
        })
        add(dt, "db:pool", {
            "pool_size": 50, "active_connections": random.randint(4, 12),
            "pool_timeouts": 0,
        })
    return events


def post(events: list[dict]) -> None:
    s = get_settings()
    if not s.splunk_hec_token:
        raise SystemExit("SPLUNK_HEC_TOKEN not set (see agent/.env).")
    headers = {"Authorization": f"Splunk {s.splunk_hec_token}"}
    verify = s.splunk_verify_tls
    # HEC accepts concatenated JSON objects in one body.
    with httpx.Client(verify=verify, timeout=60) as client:
        for i in range(0, len(events), 200):
            batch = events[i : i + 200]
            body = "\n".join(json.dumps(e) for e in batch)
            r = client.post(s.splunk_hec_url, headers=headers, content=body)
            r.raise_for_status()
            print(f"  posted {i + len(batch)}/{len(events)}")


def main() -> None:
    all_events = build_events(CHECKOUT) + build_events(WISHLIST)
    print(f"Seeding {len(all_events)} events into index={INDEX} ...")
    post(all_events)
    print("Done. Verify in Splunk:")
    print(f'  index={INDEX} earliest="06/13/2026:14:00:00" latest="06/13/2026:15:10:00"'
          ' sourcetype=checkout:transaction | timechart span=1m p95(latency_ms)')


if __name__ == "__main__":
    main()
