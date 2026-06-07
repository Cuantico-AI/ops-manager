# Architecture Review — June 2026

**Status:** Decisions accepted, sequenced for build
**Companion to:** `ARCHITECTURE.md` (source of truth — if anything here conflicts, the architecture doc wins once these decisions are folded in)
**Author:** Jonathan Ferrell
**Audience:** Cuantico ops + build team

---

## Why this document exists

This is part decision record, part explainer. Two reasons it's here:

1. **For the build:** An outside review (a long architecture call with Mario — founder of Legion Code, ships large production systems) surfaced three changes worth making to ops-manager. This doc captures what we're changing, what we're deliberately *not* changing, and the order to do it in.

2. **For the team:** Most of you can't see ops-manager yet. This explains what it is and why it's being built the way it is, so when it lands, the design makes sense instead of looking like a black box.

---

## What ops-manager actually is (plain version)

Today, running 40 client accounts means a person logging into each one to check health, make changes, and answer requests. That person is mostly Jonathan. It does not scale, and it makes Jonathan a single point of failure for the whole operation.

**ops-manager is the system that removes that bottleneck.** It watches every account, surfaces what needs attention, and — with approval — takes action. Slack is how a human talks to it today. The endgame is that it handles routine client requests on its own and only escalates the edge cases.

The reason this is urgent: one client in the pipeline has 1,200 loan officers who all want AI, and it's one of three companies that size. If we land one, we are instantly over capacity with no visibility. ops-manager has to be real before that happens.

**The origin matters too.** A previous vendor silently rolled out a new platform, took down nearly all our accounts, and cost us 5 clients. ops-manager exists so we are never blind to our own fleet again. That history is the lens for every decision below.

---

## Three things we're changing

### 1. Kill the single point of failure (highest priority)

**Current state:** ops-manager runs on one droplet. App, Postgres, and Redis are all containers on that one box. If it goes down, we are blind to the entire fleet.

**The problem in one sentence:** The system whose entire job is fleet resilience is itself running on the same one-box failure mode that the Jordan/Bubble outage taught us to never tolerate. That's a contradiction in the design, not a nice-to-have.

**The change:**
- Move to **two always-available droplets behind a load balancer**, so one box dying doesn't take down visibility.
- Move the state layer off Docker containers and onto **DigitalOcean managed Postgres and managed Valkey** (Valkey is the modern Redis replacement). These are auto-healing and failure-tolerant in ways a container on a single box is not.

**Why managed databases specifically:** Containerized Redis loses its in-memory state on reboot, or corrupts it if you force persistence. Chained container health checks fail in cascades — one dependency hiccups and the whole stack stops responding. For a system whose value is "it's always watching," the state layer cannot be the fragile part.

**Non-negotiable constraint during this migration:** The audit log immutability — enforced at the Postgres role level (`ops_app` has INSERT and SELECT only, no UPDATE or DELETE) — **must survive the move to managed Postgres.** It's a role grant, so it carries over, but it is a verify-before-you-trust item, not an assume-it-works. Same goes for the approval gate (`BYPASS_APPROVAL=false`): confirm it still gates both directions on the new infrastructure before trusting it.

**Timing:** This is real migration work, not a config flip. It does not have to happen this week, but it must be **done before the 1,200-LO client lands.** Treat it as a hard prerequisite for scale, sequenced and verified — not rushed.

---

### 2. Reorder the roadmap: visual-first → API routes → Slack last

**Current state:** Slack does everything. There are no API routes built yet. The dashboard (`cuantico-ops-dash`) is planned but not scoped.

**The change — build in this order going forward:**

1. **Visual-first.** Prototype every widget and surface we want to track in Claude Design *before* building the backend for it. Designing the interface first drives the product decisions ("why is this button here? what should I see on this screen that I don't?") and converts cleanly into build specs. This directly de-risks the dashboard scoping session that's already on the list.
2. **API routes are the connecting layer.** They're what talks to GHL's OAuth app, creates and receives webhooks (a webhook is just an outbound API call), and feeds the dashboard. The dashboard data layer is already decided — it reads from ops-manager's Postgres, not from GHL Custom Objects. The read API is the thing that makes that real, and we'll need it the moment the dashboard exists.
3. **Slack last.** Slack is an interface, not the foundation. Build the routes and the data layer first; Slack and the dashboard both sit on top of them.

**Why this is nearly free to adopt:** We're building the dashboard anyway. Doing the visual prototype first and the API routes before more Slack work costs almost nothing extra and saves us from building the same data access twice.

---

### 3. Crons for plumbing, agents for judgment

This is the one place we're **partially rejecting** the outside advice, on purpose. Worth understanding why.

**The advice was:** "Don't use AI agents in this at all — use scripted crons."

**Why that's right for some of it:** For deterministic, repeatable work — scheduled fleet health sweeps, token expiry checks, the hourly heartbeat — scripted crons are exactly correct. Same input, same output, every time. We already build these on BullMQ. No change there; we lean into that discipline.

**Why it's wrong as a blanket rule for us:** The advice comes from someone whose business is deterministic data pipelines, where "no surprises" is the entire point. Our endgame is the opposite — **autonomous client ops**, which means triaging an incoming client request, figuring out which account it's about, and deciding what action it needs. That's a judgment problem, not a determinism problem. Scripting every possible client request is neither possible nor desirable.

**The synthesis (this is the rule going forward):**
- **Deterministic plumbing → crons.** Health sweeps, token checks, heartbeats, scheduled syncs. BullMQ, as today.
- **Judgment → agents, behind the approval gate.** Client-request triage, "this account looks wrong, what do we do about it," anything requiring reasoning rather than a fixed script.

This is why the Claude Managed Agents path (GHL MCP + n8n MCP) stays in the architecture as a live option. It's the difference between ops-manager being Jarvis and being a fancier status-checker. We keep the cron discipline for the plumbing and keep the agent layer for the brain.

---

## The QA agent layer (why it exists, where it lives)

This is being added to the architecture for a specific reason, not as a generic monitoring feature.

**The failure it answers:** We have already been burned by an assistant hallucinating — a bot sending messages it never should have (recruiting content that had nothing to do with the client's actual use case, among other off-script output). The damage wasn't that a model made a mistake once; models do that. The damage was that **nothing caught it.** No human reads every transcript across the fleet, so a hallucination runs unchecked until a client notices it downstream — and by then the trust hit has already landed.

The QA layer is the safety net that should have existed. Same lesson as the fleet-resilience origin story: we are building the thing whose absence already cost us.

**What it does:** A QA agent reads SMS and voice-call transcripts after the fact and judges whether the assistant stayed truthful and on-script — did it hallucinate, give wrong information, go off its intended purpose. Likely-bad interactions get flagged.

**Where it runs — backend, not dashboard:** The QA agent runs in the ops-manager **agent layer**, triggered by the Assistable post-call webhook. The dashboard does not do the reading or the judging — it only displays results. The flow:

```
Call / SMS ends
  → Assistable post-call webhook → ops-manager
  → QA agent reads transcript, scores it (hallucination? off-script? wrong info?)
  → writes a QA record to Postgres (score, flags, transcript reference, account)
  → dashboard reads and surfaces that record
  → likely hallucinations route to the human review/approval queue
```

**Why this is the clearest case for the agent layer:** A cron cannot tell whether a bot hallucinated — that requires reading unstructured human speech and exercising judgment about truthfulness. This is the textbook example of why ops-manager needs agents and isn't "just cron jobs." Fleet health is deterministic (poll, compare, report → cron). QA is judgment (read speech, assess truth → agent). If anyone asks why the agent layer is justified, **QA is the answer.**

**Where it shows up in the dashboard:** A dedicated QA surface (flagged interactions, score trend per assistant, a "needs human review" queue), plus a QA health indicator inside each account's detail view — because "is the bot up" and "is the bot saying correct things" are both health, just different layers. Human confirmation of a flag doubles as a training signal for tuning the QA agent's threshold.

**Timing:** Phase 3+, gated on the Assistable post-call webhook being wired (currently on the open-items list). But the QA surface goes into the dashboard design *now*, as a placeholder if needed, so the data contract accounts for it from the start instead of being retrofitted.

---

## What we are deliberately NOT changing

- **Assistable stays for Cuantico.** Full stop. The "alternative platform" recommendation from the call is set aside. The source of that recommendation has a personal history with Assistable's founder, which means the opinion is not a clean technical assessment. No weight on our decision.
- **The God-skill / 500-agent Cursor workflow** is a dev-velocity tool for building faster. It is *not* an ops-manager runtime architecture input. Worth learning to ship quicker; keep it out of the production design conversation.
- **Legion Code (enrichment platform)** is a separate track — a Cuantico capability and a resale product, not part of ops-manager infrastructure. Real opportunity, handled on its own. Does not touch this scope.

---

## Priority order for the build

1. **HA infrastructure** — two droplets + load balancer, managed Postgres + Valkey. Hard prerequisite before the large client lands. Audit-log role grant and approval gate verified on the new infra before trusting it.
2. **Roadmap reorder** — visual-first in Claude Design, then API routes, then Slack/dashboard on top. De-risks the dashboard and gives us the read API we need anyway.
3. **Crons vs. agents discipline** — crons for scheduled/deterministic jobs (as today), agent layer behind the approval gate for judgment work. Preserves the differentiator.
4. **QA agent layer** (Phase 3+) — automated truthfulness/hallucination review of SMS and voice transcripts, results surfaced in the dashboard, bad interactions routed to human review. Direct answer to a hallucination failure that already cost us. Gated on the Assistable post-call webhook; QA surface designed into the dashboard now.

---

*This document folds into `ARCHITECTURE.md` once the HA migration is sequenced. Until then, it's the record of what changed after the June review and why.*
