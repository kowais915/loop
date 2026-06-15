"""Second demo dataset — a DIFFERENT app, to test LOOP's generic mode as if you
were a judge with your own logs (nothing checkout/ecommerce-shaped).

Service `payments-api`, sourcetype `paymentsvc:request` with latency field
`duration_ms`, and deploy sourcetype `paymentsvc:deploy` using a `version` field
(not `build`) — proving LOOP isn't hardcoded to the demo's names. A latency
regression: ~95ms → ~1400ms after deploy 2025.6.2, recovers after rollback.

Loads into the same index as the main seed (default `ecommerce`, so your existing
HEC token works). Set SPLUNK_SEED_INDEX to use a different index (the HEC token
must allow it).

Run:  python -m seed.load_demo2     (agent/ dir, venv active)
Then in the UI → Analyze:
  index=ecommerce  sourcetype=paymentsvc:request  latency_field=duration_ms
  service=payments-api  deploy_sourcetype=paymentsvc:deploy
  earliest=2026-06-13T10:00:00  latest=2026-06-13T11:00:00
"""

from __future__ import annotations

import os
import random

from seed.load_seed import _epoch, _in_window, _minutes, _p95_batch, _t, post

random.seed(11)
INDEX = os.environ.get("SPLUNK_SEED_INDEX", "ecommerce")
SERVICE = "payments-api"
ST_REQ = "paymentsvc:request"
ST_DEPLOY = "paymentsvc:deploy"

WINDOW = ("10:00", "11:00")
SPIKE = ("10:25", "10:45")
DEPLOY_MIN = "10:24"
ROLLBACK_MIN = "10:46"
BASE_MS = 95
SPIKE_MS = 1400
BAD = "2025.6.2"
GOOD = "2025.6.1"


def build_events() -> list[dict]:
    events: list[dict] = []

    def add(dt, sourcetype, event):
        events.append({
            "time": _epoch(dt), "index": INDEX, "host": "payments-api-prod",
            "source": "loop-seed", "sourcetype": sourcetype, "event": event,
        })

    for dt in _minutes(*WINDOW):
        spiking = _in_window(dt, *SPIKE)
        target = SPIKE_MS if spiking else BASE_MS
        version = GOOD if (dt < _t(DEPLOY_MIN) or dt >= _t(ROLLBACK_MIN)) else BAD
        for dur in _p95_batch(target):
            add(dt, ST_REQ, {
                "service": SERVICE, "version": version,
                "status": 200 if not spiking else random.choice([200, 200, 504]),
                "duration_ms": dur, "endpoint": "/v1/charge",
                "trace_id": f"{random.randrange(16**12):012x}",
            })
        if spiking and random.random() < 0.5:
            add(dt, "paymentsvc:error", {
                "level": "ERROR", "version": BAD,
                "message": "charge latency SLA breach", "service": SERVICE,
            })

    # deploy + rollback (note: field is `version`/`previous_version`, not `build`)
    add(_t(DEPLOY_MIN), ST_DEPLOY, {
        "event_type": "deployment", "service": SERVICE,
        "version": BAD, "previous_version": GOOD,
        "message": f"Deployed {SERVICE} {BAD}", "change": "retry/timeout refactor",
    })
    add(_t(ROLLBACK_MIN), ST_DEPLOY, {
        "event_type": "deployment", "service": SERVICE,
        "version": GOOD, "previous_version": BAD,
        "message": f"Rolled back {SERVICE} to {GOOD}", "change": "rollback",
    })
    return events


def main() -> None:
    ev = build_events()
    print(f"Seeding {len(ev)} payments-api events into index={INDEX} "
          f"(sourcetype={ST_REQ}/{ST_DEPLOY}) ...")
    post(ev)
    print("Done. In the UI → Analyze: index=%s sourcetype=%s latency_field=duration_ms "
          "service=%s deploy_sourcetype=%s earliest=2026-06-13T10:00:00 "
          "latest=2026-06-13T11:00:00" % (INDEX, ST_REQ, SERVICE, ST_DEPLOY))


if __name__ == "__main__":
    main()
