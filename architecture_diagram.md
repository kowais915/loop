# LOOP — Architecture

> **Track: Observability**  ·  Bonus targets: 🏆 **Best Use of Splunk MCP
> Server**  ·  🏆 **Best Use of Splunk Hosted Models**
>
> *New project, built entirely within the Submission Period · OSI license at
> repo root · Splunk AI capabilities are called at runtime (not mocked).*

Splunk's agent tells you *what* broke. **LOOP closes the loop** — it diagnoses
the cause, drafts the fix, **waits for a human to approve**, proves the fix
worked against live Splunk data, and remembers the pattern for next time.

```
DETECT → DIAGNOSE → PROPOSE FIX → ✋ HUMAN APPROVES → VERIFY → LEARN
```

Nothing is applied until an engineer clicks **Approve**.

## System diagram

The three colored lanes answer the three required hooks: **how the app talks to
Splunk**, **how Splunk AI is integrated**, and **the data flow between
services**.

![LOOP architecture — SRE and web app (pink) ⇄ FastAPI agent (blue) ⇄ Splunk AI capabilities (orange: MCP Server, ML predict, AI Assistant) and Supabase state (green). The agent halts at the human approval gate.](./assets/architecture.png)

**Legend** — 🟠 orange = **Splunk AI** (MCP Server, ML `predict`, AI Assistant:
the prize surfaces) · 🔵 blue = **the agent** (FastAPI: API, LoopEngine, MCP
client, model layer) · 🟢 green = state (Supabase realtime + pgvector) and the
Foundation-Sec hosted model · 🟡 yellow = **human touchpoints** (the SRE and the
approval gate). Bold arrows trace the live Splunk evidence path; the loop
**halts until a human approves**.

## What each part does

| Component | Role |
|---|---|
| **Web app** | Shows the loop running live and presents the **approval gate** (proposed fix, diff, rollback, evidence). The human approves or rejects here. |
| **Agent (LoopEngine)** | The agent. An explicit 5-stage state machine that pulls evidence from Splunk, forms and tests hypotheses, drafts a fix, and **halts for approval**. |
| **Splunk** | The source of truth. Every stage's evidence comes from live `splunk_run_query` calls; DETECT also calls **Splunk ML `predict`** to forecast the baseline. |
| **Incident memory** | pgvector store so a recurring incident is recognized instantly and offered for one-click approval. |

## The three required hooks

**1 · How LOOP interacts with Splunk**
The agent is an **MCP client** over streamable-HTTP (Bearer token) to the
**Splunk MCP Server**. Every fact shown to the user comes from a real
`splunk_run_query` call. The Splunk endpoint + token are set from the UI at
runtime — nothing to install. (A `sample` mode serves deterministic rows so
judges can run the full loop with zero setup.)

**2 · How Splunk AI is integrated (at runtime)**
- **Splunk MCP Server** (`splunk_run_query`) feeds evidence to every stage.
- **Splunk ML (`predict`)** forecasts the latency baseline in DETECT and
  quantifies the regression.
- **AI Assistant** (`generate_spl`, `ask_splunk_question`) is called via MCP
  where available.

**3 · Data flow**
`SRE → Web app ⇄ Agent (LoopEngine) → Splunk (MCP + ML) → indexes`, with the
agent reading/writing pattern memory in pgvector. The **approval gate sits
between PROPOSE FIX and VERIFY** — the loop stops there until a human acts.

## The 5 stages

| Stage | What the agent does | Live source |
|---|---|---|
| **DETECT** | Measures p95 latency and calls **Splunk ML `predict`** to forecast the baseline — confirms the anomaly and its onset. | `splunk_run_query` + `predict` |
| **DIAGNOSE** | Checks memory first; otherwise tests hypotheses (traffic / payment / pool / deploy) against live SPL and correlates the latency onset to a deploy event. | MCP queries + pgvector |
| **PROPOSE FIX** | Drafts a rollback + code fix as a unified diff. Sets `awaiting_approval`. **Applies nothing.** | model layer |
| **✋ APPROVE** | Loop halts. Resumes only on `approve`; `reject` records the decision and stops. On approve, LOOP emits a **simulated rollback event** — it **never mutates your Splunk instance**. | UI → agent |
| **VERIFY** | Re-queries Splunk over the post-fix window and marks resolved only if live data shows p95 back at baseline. Records MTTR. | `splunk_run_query` |
| **LEARN** | Stores the incident signature + embedding so the next recurrence is one-click. | pgvector |

*Only wired paths are shown — the diagram reflects what actually runs. LOOP
reads from Splunk via MCP and proposes fixes; it never writes to or mutates your
Splunk instance.*
