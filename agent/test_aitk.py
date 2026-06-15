"""Quick check: does the Splunk AI Toolkit (fit DensityFunction) fire + flag the
seeded latency spike? Run after installing AI Toolkit + Python for Scientific
Computing:  python test_aitk.py
"""

import asyncio

from config import get_settings
from mcp_client import SplunkMCPClient
from runtime import set_live

QUERIES = {
    "DensityFunction (raw events)": (
        "index=ecommerce sourcetype=checkout:transaction service=checkout "
        '| fit DensityFunction latency_ms threshold=0.005 '
        '| search "IsOutlier(latency_ms)"=1 | stats count as outliers'
    ),
    "DensityFunction (per-minute p95)": (
        "index=ecommerce sourcetype=checkout:transaction service=checkout "
        "| timechart span=1m p95(latency_ms) as p95 "
        '| fit DensityFunction p95 threshold=0.01 '
        '| search "IsOutlier(p95)"=1 | stats count as outliers'
    ),
}


async def main() -> None:
    s = get_settings()
    set_live(s.splunk_mcp_url, s.splunk_mcp_token, False)
    c = SplunkMCPClient()
    for name, q in QUERIES.items():
        r = await c.run_spl(q, "2026-06-13T14:00:00", "2026-06-13T15:10:00")
        print(f"\n=== {name} ===")
        print("error:", r.error)
        print("rows:", r.rows[:3])


if __name__ == "__main__":
    asyncio.run(main())
