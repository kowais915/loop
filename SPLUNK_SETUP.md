# LOOP — Splunk Setup & Deployment Guide

Step-by-step to connect LOOP to a real Splunk instance, load the demo data, and
deploy it so judges can use it. Follow top to bottom.

> **TL;DR for judging:** judges never need their own Splunk. They watch your
> video (recorded against real Splunk) and/or open your live URL. Deploy the
> live URL in **stub mode** so it's always up; show real Splunk in the video.

---

## Part 1 — Local Splunk Enterprise (real MCP + real data)

### 1. Start Splunk & log in
```bash
/path/to/splunk/bin/splunk start --accept-license
```
- Open **http://localhost:8000**, log in as the `admin` user you set at install.
- (Add your dev license later under **Settings → Licensing**; the trial works now.)

### 2. Install the MCP Server app
- **Apps → Find More Apps** → search **"MCP Server"** → install **Splunk MCP
  Server** (Splunkbase app **7931**), or download the `.tgz` from
  https://splunkbase.splunk.com/app/7931 and **Apps → Manage Apps → Install app
  from file**.
- Restart Splunk when prompted. The `admin` role already has `mcp_tool_admin`.

### 3. Create the index + an HEC token (for seed data)
- **Settings → Indexes → New Index** → name **`ecommerce`** → Save.
- **Settings → Data Inputs → HTTP Event Collector**:
  - **Global Settings** → **All Tokens: Enabled** (port `8088`) → Save.
  - **New Token** → name `loop` → set **Allowed Indexes = `ecommerce`** (and make
    it the default) → finish → **copy the token value**.

### 4. Load the demo data
```bash
cd loop/agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```
Edit `agent/.env`:
```
SPLUNK_HEC_TOKEN=<the HEC token from step 3>
SPLUNK_VERIFY_TLS=0          # local Splunk uses a self-signed cert on 8088/8089
```
Then:
```bash
python -m seed.load_seed
```
Verify in the Splunk search bar (time range → **All time**):
```
index=ecommerce sourcetype=checkout:transaction service=checkout
| timechart span=1m p95(latency_ms)
```
Expect ~280ms → ~3200ms spike (14:20–14:45) → back to ~280ms.

### 5. Get the MCP URL + token from the MCP app
- Open the **Splunk MCP Server** app from the Apps menu.
- It shows the **endpoint** + sample client config → that's your URL
  (local = `https://localhost:8089/services/mcp`).
- **Generate a new encrypted token** → **copy it (shown once)** → that's your
  `SPLUNK_MCP_TOKEN`.

### 6. Point the agent at real Splunk (`agent/.env`)
```
SPLUNK_MCP_URL=https://localhost:8089/services/mcp
SPLUNK_MCP_TOKEN=<encrypted token from step 5>
SPLUNK_VERIFY_TLS=0
LOOP_ALLOW_STUBS=0
```

### 7. Verify the live connection
```bash
python smoke_mcp.py
```
With creds set, this hits **real Splunk**: it lists the MCP tools and runs live
SPL. If you see your tool list and real rows (not `[STUB]`), you're wired. Then:
```bash
uvicorn main:app --port 8001   # Splunk's web UI owns 8000, so use 8001
```

---

## Part 2 — Run the whole app locally
```bash
# terminal 1 — agent (Splunk's web UI owns 8000, so the agent uses 8001)
cd loop/agent && source .venv/bin/activate && uvicorn main:app --port 8001

# terminal 2 — web
cd loop/web && npm install
# set web/.env.local → NEXT_PUBLIC_AGENT_URL=http://localhost:8001
npm run dev
```
Open the printed URL, click **Run full demo**, watch the loop close.

---

## Part 3 — Deploy so judges can use it

You deploy two things: the **web** (Vercel) and the **agent** (a FastAPI host).
The judge's browser → Vercel → your agent → a Splunk source.

### 3a. Choose how the deployed agent reaches Splunk
| Mode | How | Best when |
|---|---|---|
| **Stub** (recommended for the live link) | set `LOOP_ALLOW_STUBS=1` on the agent | always-on demo that never depends on your laptop |
| **ngrok tunnel to local Splunk** | `ngrok http 8089` → use that https URL as `SPLUNK_MCP_URL`, `SPLUNK_VERIFY_TLS=1`, `LOOP_ALLOW_STUBS=0` | showing real data live while your laptop is on |
| **Splunk Cloud** | file the Support ticket to open 8089 + allowlist the agent's egress IPs | most robust real-data path |

**Recommended:** live URL in **stub mode** + real Splunk in the **video**.

### 3b. Deploy the agent (FastAPI)
Using the included `agent/render.yaml` (Render) or `agent/Procfile`
(Railway/etc.). Set these env vars in the host's dashboard (not a file):
```
LOOP_ALLOW_STUBS = 1          # or 0 if using ngrok/Cloud
LOOP_CORS_ORIGINS = https://<your-app>.vercel.app
SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY   # from Supabase → Settings → API
ANTHROPIC_API_KEY   # optional diagnosis fallback
# if NOT stub mode, also:
SPLUNK_MCP_URL / SPLUNK_MCP_TOKEN / SPLUNK_VERIFY_TLS
```
Note the agent's deployed URL (e.g. `https://loop-agent.onrender.com`).

### 3c. Deploy the web (Vercel)
Import `web/` into Vercel, set env vars:
```
NEXT_PUBLIC_AGENT_URL = https://<your-agent-host>
NEXT_PUBLIC_SUPABASE_URL = https://xxxx.supabase.co     # optional (enables realtime)
NEXT_PUBLIC_SUPABASE_ANON_KEY = <anon key>
```
Deploy. Open the Vercel URL → **Run full demo**. That's the link judges use.

### 3d. Supabase (one-time)
Run `agent/db/schema.sql` in the Supabase SQL editor. Without Supabase the agent
falls back to an in-memory store (fine for stub demos; realtime won't persist).

---

## Troubleshooting
- **TLS / cert errors to localhost:** set `SPLUNK_VERIFY_TLS=0` (local self-signed).
- **`smoke_mcp.py` shows `[STUB]`:** `SPLUNK_MCP_URL`/`SPLUNK_MCP_TOKEN` aren't set,
  or `LOOP_ALLOW_STUBS` masks them — set the creds and `LOOP_ALLOW_STUBS=0`.
- **Seed data not in the query window:** the loop queries the `2026-06-13` date.
  Make sure your Splunk user timezone matches the machine that ran the loader
  (Account → Preferences → Time zone), or re-run the loader.
- **HEC 403 / index error:** the HEC token must allow index `ecommerce`
  (set it under the token's Allowed Indexes).
- **No tools listed at agent startup:** confirm the MCP Server app is installed
  and your role has `mcp_tool_execute` / `mcp_tool_admin`.
- **CORS errors in the browser:** `LOOP_CORS_ORIGINS` on the agent must include
  your exact web origin.
