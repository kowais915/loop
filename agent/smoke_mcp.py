"""Quick smoke test for the Splunk MCP client.

Run with no Splunk creds to exercise the stub path; with creds set it will hit
the real Splunk MCP Server. Usage:  python smoke_mcp.py
"""

import asyncio

from mcp_client import SplunkMCPClient


async def main() -> None:
    client = SplunkMCPClient()
    print("live (real Splunk MCP):", client.live)
    tools = await client.list_tools()
    print("tools:", tools or "(none — stub mode)")

    for q in (
        "index=ecommerce sourcetype=checkout:transaction | timechart span=1m p95(latency_ms)",
        "index=ecommerce sourcetype=deployment:event service=checkout",
        "index=ecommerce sourcetype=checkout:span span=db.query",
        "index=ecommerce sourcetype=payment:transaction provider=stripe",
        "index=ecommerce sourcetype=db:pool",
    ):
        res = await client.run_spl(q, earliest="-24h", latest="now")
        flag = "STUB" if res.used_stub else "LIVE"
        status = res.error or f"{res.count} rows"
        print(f"\n[{flag}] {status}\n  q: {q}\n  rows: {res.rows}")


if __name__ == "__main__":
    asyncio.run(main())
