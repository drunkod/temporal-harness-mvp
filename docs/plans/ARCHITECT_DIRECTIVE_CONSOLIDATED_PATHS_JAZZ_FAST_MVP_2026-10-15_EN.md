# CONSOLIDATED Architect Directive — MacBook Repository Paths, One-Day Autonomous MVP, Jazz Client, and Deferred Research

**Date:** October 15, 2026  
**Project:** Autonomous ChatGPT Project Supervisor / Flowdeck  
**Main code repository:** `/Users/test/Documents/work/temporal-harness-mvp`  
**Plugin code repository:** `/Users/test/Documents/RemoteMCP-Jazz/repositories/RemoteMCP-Jazz`  
**Priority:** Implement the smallest working autonomous ChatGPT Project task loop first. Document deeper research for later implementation.

## Message to the architect

## Immediate owner instruction — FAST TRACK / MINIMUM WORKING MVP

**This instruction supersedes the previous documents' nonessential hardening, broad acceptance-test, and architectural-review work for the first development day.** My primary goal is to **get the Jazz status client working as fast as possible and immediately begin the minimum unattended ChatGPT/Flowdeck supervisor cycle**. We have already spent too much time on preparatory verification. Prioritize observable running software over a polished architecture or an extensive test suite.

**Do now, in this order:**

1. **Reuse an existing working surface first.** Immediately expose a Flowdeck link to the plugin's owner-authenticated Jazz Work Sessions panel if an embedded client is blocked on cross-origin authorization. That is an interim viewing path—not a completed Flowdeck client. In parallel, implement the smallest authorized, read-only Flowdeck Jazz subscriber using the plugin's **installed alpha.53 API**; no new Jazz server, schema migration, authentication system or dashboard framework.
2. **Wire the real triggers to the supervisor.** Connect the existing `work_started` / `work_reported` source event reader to a small local bridge and Temporal wake-up. This remains separate from Jazz, which is **display only**. Adopt the single unambiguously identifiable manually opened ChatGPT Project conversation without replaying its initial message.
3. **Implement the minimum autonomous loop.** After a work report, observe that chat, continue unfinished work in the same conversation, or advance to one further **explicitly approved** task in a new conversation within the same Project. Use the already working Oracle/Helium/Temporal components. Prove only one small live two-task cycle before generalization.
4. **Report the exact running result.** Give me links/local URLs, the actual changed files, what was demonstrated live, and the next concrete blocker. If a nonessential detail takes more than 30–60 minutes, use the simplest safe fallback and keep moving.

**Defer for later:** broad security/architecture audits, formal threat modelling, comprehensive code-quality reviews, extended fault injection, full p50/p95/p99 performance matrices, multi-browser support, generalized multi-project scheduling, a new database, observability frameworks, aggressive test-coverage targets, and optional production-hardening work. Keep these as written follow-up tasks, not gate conditions for the first live demonstration. External review systems will handle code quality.

**Do not remove the tiny operational boundaries that make the MVP valid:** maintain the plugin's existing owner-only, read-only Jazz authorization (no exposed secrets or weakened access controls); ensure the widget has no dependency in the MCP execution path; limit automation to **approved tasks and the correct project/chat**; and **never blindly resend a potentially submitted ChatGPT message**. These are small integration constraints, not a request for a new security or verification platform. Do not bypass login, CSRF/CORS or private-key protection to speed up embedding; use the existing authenticated panel link until a narrow authorized integration works.

**Fast-track first-pass acceptance only:** (a) show one actual `active → reported` status change through an owner-authorized Jazz subscription without manual refresh, or use the existing plugin panel as a clearly labelled interim fallback; (b) show `work_started / work_reported` waking the correct supervised chat without repeated initial sends; (c) demonstrate the smallest approved same-chat continuation and new-chat handoff possible. Record any unmet criterion as unfinished, without blocking unrelated progress. The 750 ms latency objective and comprehensive performance certification remain follow-up measurements, not claims of present behavior.

---

## EXPLICIT MACBOOK CODE LOCATION AND TWO-PLAN HANDOFF — READ BEFORE IMPLEMENTATION

**Both repositories are on the same MacBook. They are separate projects, not nested packages.** These absolute paths were checked in the current connected MacBook codebase during our read-only review. Inspect each repository's latest branch, working-tree changes and local build configuration when beginning development; **do not reset, clean or overwrite the uncommitted work**.

| Purpose | MacBook path / existing files | Immediate use |
| --- | --- | --- |
| **Main supervisor and Flowdeck repository** | `/Users/test/Documents/work/temporal-harness-mvp` | Implement the new Jazz client widget, event bridge and autonomous Temporal loop here. |
| Flowdeck HTTP server, currently plain Node/HTML | `/Users/test/Documents/work/temporal-harness-mvp/src/dashboard-server.ts` | Serve the isolated widget and its non-secret status or static resources; do **not** migrate the dashboard to Next.js. Current local default: `http://127.0.0.1:4319`. |
| Flowdeck pages | `.../temporal-harness-mvp/public/sashai.html` and `public/index.html` | Attach or link the status module without rewriting existing pages. |
| Browser adoption, existing Oracle/Helium observer | `.../temporal-harness-mvp/src/sashai-observer.ts` and `scripts/sashai-supervisor.mjs` | Reuse manual-chat adoption and controlled read-only observation; generalize only as needed for the authorized pilot. |
| Prepared (uncommitted) live browser/Temporal layer | `.../temporal-harness-mvp/src/sashai-live-browser.ts`, `src/sashai-live-report-activities.ts`, `src/sashai-live-report-workflow.ts`, `scripts/sashai-live-temporal.mjs` | Inspect/reuse existing work, and never count fixtures as live proof. |
| Existing Temporal/Flowdeck runtime | `.../temporal-harness-mvp/src/workflows.ts`, `src/activities.ts`, `src/worker.ts`, `src/dashboard-server.ts` | Build on the existing Temporal coordinator, with a small new event consumer. |
| **RemoteMCP-Jazz plugin repository** | `/Users/test/Documents/RemoteMCP-Jazz/repositories/RemoteMCP-Jazz` | **Read/reference only by default**. Do not modify/restart the plugin as part of this client work without coordinating the plugin architect. |
| Event-contract / reader / adapter | `.../RemoteMCP-Jazz/control-plane/packages/work-events/src/contracts.ts`, `sqlite-reader.ts`, `pump.ts`, `checkpoint.ts`, `watch.ts`, `supervisor-adapter.ts` | Already implemented. Consume `remote-mcp.work-event/v1`; reuse existing read-only follower/checkpoint logic, or an adapter to its JSONL output. `TemporalSupervisorAdapter` is a wake callback, **not** a wired Temporal client. |
| Event CLI | `.../RemoteMCP-Jazz/control-plane/apps/control-plane/scripts/work-events.ts` | Existing `events`, `snapshot`, `follow` modes; isolate Flowdeck's own checkpoint and scope. |
| Work hooks and work-session ledger | `.../RemoteMCP-Jazz/control-plane/apps/control-plane/lib/work-control-tool-definitions.ts`, `device-control-store.ts` | `begin_work` / `finish_work` emit `work_started` / `work_reported`. Never lease the OS notification endpoint for monitoring. |
| Deployed Jazz schema and client precedent | `.../RemoteMCP-Jazz/control-plane/packages/protocol/src/work-status-schema.ts`, `control-plane/apps/control-plane/app/dashboard/devices/work-status-panel.tsx` | Reuse `workStatusViews` / `workStatusHealth` fields and pinned `JazzProvider`/`useAll` subscription patterns; **no Jazz schema upgrade**. |
| Jazz owner-authenticated bootstrap and permissions | `.../RemoteMCP-Jazz/control-plane/apps/control-plane/app/api/dashboard/work-status/config/route.ts`, `control-plane/apps/control-plane/lib/jazz-capability.ts`, `control-plane/apps/control-plane/permissions.ts` | Work with the owner-scoped short-lived JWT and read-only permissions. Flowdeck's localhost origin does not automatically have the plugin website's session. |
| Jazz projector (read-only for Flowdeck) | `.../RemoteMCP-Jazz/control-plane/apps/control-plane/lib/jazz-work-status-projection.ts` | Already writes current-state projection independently of MCP execution. Do not add another publisher or put Jazz on the MCP hot path. |
| Plugin architect's integration guide | `.../RemoteMCP-Jazz/docs/live-status/EXTERNAL-INTEGRATION.md` and `docs/live-status/README.md` | Canonical, implemented event/Jazz integration instructions and caveats. |

**Code/version facts:** RemoteMCP-Jazz pins **`jazz-tools@2.0.0-alpha.53`**. Its working panel uses an in-memory `JazzProvider` and `useAll()` yielding `Row[] | undefined` rather than the newer documentation's `{data,isLoading,error}` shape. The plugin's `/api/dashboard/work-status/config` is a **POST under authenticated plugin-dashboard origin**, not an unauthenticated endpoint available from `127.0.0.1:4319`. Reuse the deployed contract, not an incompatible current upstream example.

### The TWO planning files for the fast MVP

These are **two document attachments**, not two code repositories or two implementation source files. They were prepared as downloadable handoff artifacts in this conversation; **do not assume they already exist at a MacBook repository path**. Put copies in a suitably named `docs/` location in the main project if they are not present, keep source/versions, and link them from the **editable** roadmap:

1. **`SUPERVISOR_MASTER_PLAN_FROZEN_V1_2_EN.md` — fixed product target.** Defines the high-level user journey: owner starts in an existing ChatGPT Project, `begin_work` wakes supervision, adopt without resend, `finish_work` wakes review of the chat checkpoint, continue unfinished work in the same chat, record `review_pending`, then launch the next *approved* task in a new in-Project chat. Do not rewrite this frozen version as work progresses; new scope is a separately versioned amendment.
2. **`SUPERVISOR_ONE_DAY_MVP_EXECUTION_2026-10-15_EN.md` — timeboxed execution outline.** Use it to update the actual mutable work plan: hours 1–2 event bridge; 2–3 owner-started chat adoption; 3–5 same-chat continuation/status; 5–7 next approved task/new in-Project chat; hour 8 a real short demonstration. This timetable is a prioritization target, not a guarantee. Adjust task sequencing for parallel Jazz UI development without making Jazz a dependency of control.

**Supplemental attachments:** This consolidated directive; `FLOWDECK_JAZZ_READ_ONLY_CLIENT_IMPLEMENTATION_PLAN_FAST_TRACK_2026-10-15_EN.md` (code sketches and compatibility details); and the existing Deep Research report. Copy them into the main project's documentation area or reference them from its task-authority files, **without overwriting pre-existing local files of the same name**.

### Practical implementation split (one day, minimum code)

**Track A — make unattended automation work (critical path):** add a standalone local event consumer process reading `remote-mcp.work-event/v1` with a separate checkpoint; validate fixed owner/device and deduplicate `eventId`; on a new work event wake the appropriate Temporal workflow **only if a unique correct Project/chat binding is established**; use the existing Oracle/Helium observer to adopt the owner's active chat without re-sending; after `work_reported`, inspect the chat, continue once if unfinished or mark implementation reported/review pending; select the next approved independent task and test creation of a new chat within the **same** Project with the connector selected on the new message. The work event alone is *not* approval and `workId` is *not* a ChatGPT conversation ID. If binding or a click outcome is unknown, stop that step rather than duplicate it.

**Track B — show live Jazz status (independent, optional for core automation):** first add a visible link from Flowdeck to the plugin's existing authorized Work Sessions panel; then implement the smallest self-contained browser Jazz subscriber (React island or verified vanilla TS) that reads only `workStatusViews` and `workStatusHealth`, displays `active` / `reported`, source/revision/outcome and freshness, and updates without page reload. Use the exact alpha.53 API. Resolve origin/auth through an approved owner-capability integration or keep the external panel link as the *honestly labelled fallback*; **never copy session cookies, admin credentials or signing keys into a static client**. Jazz remains display-only; a disconnected projector cannot prevent MCP tools, notifications or Temporal triggers.

**Only smoke-test what establishes this vertical slice:** a real `active → reported` UI transition, a `work_started → work_reported` wake-up for the right pre-approved chat, one same-chat continuation, and one in-project next-task handoff if the browser surface supports it. Record what is still unproven. Defer extended benchmark certification, formal security review, new state storage, exhaustive fault matrices, general architecture research and code review to separately listed future work. **Do not weaken authentication, create arbitrary work, or blindly repeat a possibly accepted browser send.**

**Definition of done for the architect's first status report:** exact changed files, the active local URLs, the two paths actually used, the currently running components, one real event observed, one real Jazz status change or documented auth blocker, and the exact highest-priority next implementation task. The main cycle may proceed even while the embedded Jazz widget is blocked.

---

Please **revise our active implementation roadmap and begin building the simplified one-day MVP immediately**. We have spent too long on verification architecture. The objective for this milestone is functioning unattended task automation, not a new code-review or evidence-analysis platform.

Treat **`SUPERVISOR_MASTER_PLAN_FROZEN_V1_2_EN.md`** as the proposed updated product target and **`SUPERVISOR_ONE_DAY_MVP_EXECUTION_2026-10-15_EN.md`** as the editable starting execution outline. Preserve the original frozen v1.0/v1.1 artifacts unchanged; do not silently overwrite an immutable version. Record any further product-scope changes as separately versioned amendments. Update the repository's *mutable* active roadmap and task breakdown accordingly. The v1.2 product direction takes priority over older plans that require comprehensive independent verification before demonstrating the automation loop.

### What to build now — only the first usable vertical slice

The owner manually opens a chat **inside an existing ChatGPT.com Project**, selects their customized **Remote Desktop Commander** MCP connector, submits a task once, and leaves. The supervisor then:

1. **Wake on start:** consume the existing Desktop Commander `begin_work` / work-start hook as a **machine-readable event** (not by scraping the macOS notification banner). Associate the work session with the intended ChatGPT Project and conversation, using actual identifiers/evidence available in the runtime.
2. **Adopt without duplication:** attach to the chat already started by the owner. Never resend the owner's original message or interfere with an actively generating response.
3. **Wake on finish:** consume the corresponding `finish_work` / work-finish hook. Treat it as the end of a **work session**, not as automatic proof that the project task is done. Read the current chat response/checkpoint to decide what happens next.
4. **Continue unfinished work:** when there is a clear unfinished checkpoint, submit an informed continuation **in the same conversation**, with Desktop Commander selected for that message. Wait for the next work-session event and repeat within a simple bounded policy.
5. **Hand off implementation status:** when implementation is reported complete, record `implementation_done / review_pending` (or the existing project's equivalent). **Code review, quality assessment, defect resolution, merging, and release decisions belong to other systems**. Do not implement a new internal review service.
6. **Move to the next approved task:** consult the repository's **authoritative active task list**, preserve dependencies and approvals, create a **new chat inside the same ChatGPT Project**, select Desktop Commander there, submit the next eligible task once, and continue the cycle. Deferred ideas and unapproved backlog items are never automatically promoted into executable work.
7. **Pause on a real blocker:** if the chat/project identity, permission, connector selection, prior send outcome, or task eligibility is uncertain, pause only the affected project and report the blocker. Do not guess or send duplicate messages.

**Scope for the first live demonstration:** one enabled test project, a deliberately unfinished first task, and one further pre-approved small task. A second project and generalized portfolio scheduling can follow once this loop works. The objective is one focused workday, not a promise of production readiness.

### Reuse the current stack and work already completed

Keep and extend **Temporal**, **Oracle 0.21.5**, the existing authenticated **Helium Chromium Profile 4**, the customized **Remote Desktop Commander**, the passive watcher, and the current minimal claim/state persistence. Use **Flowdeck** only if its existing status view helps the demonstration. **Do not reintroduce Repo Harness** into the active runtime, replace Oracle wholesale, introduce a new agent framework, or migrate storage to SQLite during this timebox.

Inspect the actual working tree **before** changing code. The October 15 export had committed HEAD `203092cbc35d70d6aee8fd4580298635a0e44890`, with a **new uncommitted live browser adapter, Temporal workflow/activities, tests and research files**. The local test run reported **141 passed, two skipped, zero failed**. Historical manual-chat adoption and same-chat continuation have evidence; the newly prepared fresh Temporal-controlled live workflow and the complete unattended handoff have **not** been proven in a new live run. Preserve useful work and do not present fixture results as live acceptance.

### Minimal safeguards — keep these, without building a verification platform

- One guarded browser send attempt for a given work step; no blind replay after an uncertain click.
- Correct project/chat binding; do not navigate, overwrite, or close unrelated user windows, tabs, or drafts.
- Reconfirm Desktop Commander selection on supervisor-authored follow-ups and new chats.
- Only run previously approved work within its allowed repository/scope; respect the repository's task-authority rules.
- Distinguish **session finished**, **implementation reported done**, and **external review approved** in status reporting.

For the Sashai repository specifically, the previously documented authoritative execution source is the **selected active plan's `Task Breakdown`**, routed via `AGENTS.md`; `tasks/current.md` is derived and `tasks/todos.md` contains deferred goals. The earlier exported evidence showed **no selected active implementation plan**. Do not invent one, mine deferred tasks as if approved, or use Sashai as an unrestricted live write target. Use an authorized test project/approved tasks for the pilot.

### Revise the roadmap, create tasks, and begin implementation

1. Update the **editable** project roadmap to make the one-day flow the active milestone. Split it into small execution tasks: event bridge; chat adoption/identity; same-chat continuation; implementation-status handoff; approved-task lookup; new in-project chat + connector selection; and one full live demonstration.
2. Note the baseline, existing code reuse and known unknowns beside those tasks. Keep the pass criteria observable and focused on the real chat cycle rather than exhaustive correctness proofs.
3. Begin the first implementation task immediately after confirming the actual local hooks and target project scope. If an intended browser capability is missing, document the exact blocker and continue with the next independently useful part rather than turning the day into a new architecture study.
4. After implementation, report the changed files, which steps of the real loop actually worked, what remains blocked, and the next immediate action. Do not claim autonomous success based on tests alone.

### New immediate parallel module — Flowdeck Jazz Live Status Client (October 15 addendum)

The RemoteMCP-Jazz architect has now implemented a **read-only, owner-scoped Jazz status projection**. Please add a small, modular **Flowdeck Jazz client** to the editable MVP task list and make it available as a real-time work-session status panel. The objective is to subscribe to the plugin's existing Jazz projection **without polling the plugin dashboard and without modifying MCP command execution**.

**Keep two lanes independent:**

- **Control:** RemoteMCP-Jazz `work_started` / `work_reported` source events → independent JSONL/TypeScript consumer with its own durable inbox/checkpoint → Temporal wake-up → ChatGPT observation and approved orchestration. This is the supervisor's event trigger. A Jazz row update is **not** an authorization to send a message.
- **Display:** the already separate plugin Jazz projector → owner-authorized `workStatusViews` and `workStatusHealth` reactive subscriptions → a lightweight, read-only Flowdeck status widget. This presents current work sessions, not a guaranteed history or verified project-task completion.

**Client implementation tasks:**

1. **Confirm exact source and version:** use the implemented source in `RemoteMCP-Jazz/control-plane`, pinned **`jazz-tools@2.0.0-alpha.53`**. The existing plugin panel `app/dashboard/devices/work-status-panel.tsx` is the compatibility reference: `JazzProvider`, a memory driver, `useAll()` returning **arrays / `undefined`** (unlike newer docs' `{data,isLoading,error}`), global-tier queries, and short-lived JWT refresh. Match deployed schema and permissions without migrating or upgrading the plugin.
2. **Resolve authorized cross-origin bootstrap:** `POST /api/dashboard/work-status/config` on the plugin's site requires its own authenticated Better Auth dashboard session; Flowdeck currently serves plain HTML on `127.0.0.1:4319`. Therefore a copied `fetch('/api/dashboard/work-status/config')` cannot simply run inside Flowdeck. For the fastest pilot, link to the plugin's existing authorized panel. For an embedded Flowdeck widget, design a narrowly scoped owner-authorized token/bootstrap path with the plugin architect; respect origin/CORS/CSRF and do not copy cookies, JWT signing keys, or admin secrets into Flowdeck.
3. **Build an isolated widget, not a UI rewrite:** use a small standalone JavaScript/React island (whichever yields a pinned, tested client fastest), bundled independently and mounted in Flowdeck's existing HTML. Only this widget imports Jazz. Never add a Jazz runtime to Temporal Workers, Oracle, RemoteMCP dispatch, or the notifier.
4. **Subscribe and render:** query `app.workStatusViews.where({ownerId})` (limited, sorted) and `app.workStatusHealth.where({ownerId})`, with `{tier:'global'}`. Show `active` / `reported`, reported outcome and device/work IDs, revisions, timestamps, connection state and recent projector-health freshness. Label completion **"agent reported"**, not verified task success. Health older than 45 seconds means **status freshness unconfirmed**, not that the projector stopped; silence does not imply task failure.
5. **Preserve fail independence:** no status REST polling loop, no Jazz write calls, no increased MCP awaited work, and no dependency of Temporal triggers on the Jazz projector. Owner reconnect/error states should be explicit. Keep the event consumer separate, deduplicated, and correlation-aware; a `workId` is not a ChatGPT chat ID.
6. **Show a fast end-to-end smoke demonstration:** owner-authenticated `begin_work` → status becomes `active`; `finish_work` → the same work row becomes `reported` without refreshing. If embedding is blocked by authorization, show the working existing plugin panel via a Flowdeck link and mark embedding incomplete. In a short smoke run, confirm Jazz does not prevent MCP command execution. **Defer** the full token-expiry matrix, all failure/reconnect cases, wrong-owner automated tests, sustained soak, render-latency certification, and paired MCP p50/p95/p99 throughput testing to the documented hardening backlog. The previous p95 ≤750 ms goal is **unverified**; do not report it as achieved.

**Technical reference and code sketches:** `FLOWDECK_JAZZ_READ_ONLY_CLIENT_IMPLEMENTATION_PLAN_FAST_TRACK_2026-10-15_EN.md`. It contains the existing plugin source-file map, version-correct React `useAll()` and provider sketches, the independent Temporal event-consumer pseudocode, official Jazz docs and a concise acceptance checklist.

**Priority:** show working live status as early as possible **while immediately implementing the core autonomous-supervisor loop**. The embedded widget must not become a prerequisite to event-led autonomy. Do not introduce a new database, projector, webhook platform, auth rewrite, production schema migration or full dashboard rewrite.

### Deep-research results: document now, implement later

The research already completed is valuable but **must not expand today's MVP**. Create a separate **`Deferred Research Backlog`** document linked from the roadmap. Turn the findings into identifiable, scoped **future tasks** with a rationale, reference to the source report, dependencies, suggested milestone, and state `DEFERRED / NOT AUTHORIZED FOR AUTO-EXECUTION` (or equivalent). Do **not** place them in the current active execution checklist unless separately approved.

Preserve at least these research-derived future workstreams:

- **Reliable browser/connector evidence:** versioned evidence adapter; experiment with Desktop Commander local tool-history records; correlate connector calls to ChatGPT turns; assess Oracle provider-native transcript/message capture and its undocumented-interface limitations.
- **Browser compatibility and alternatives:** capture sanitized DOM fixtures; assess Playwright's attach-to-existing-Chromium path for read-only observation; consider Puppeteer or raw CDP only as targeted fallbacks. Avoid multiple competing browser writers.
- **Durable recovery and side effects:** strengthen Temporal activity retry/timeout policies, worker-restart behavior, cancellation, uncertain-send reconciliation, idempotency claims and browser send safety.
- **State and storage:** evaluate a transactional SQLite journal (Node `node:sqlite` or a maintained driver), durable identity/receipt schemas, SHA-256 evidence exports and Zod boundary validation if complexity warrants it.
- **Advanced tests:** `@temporalio/testing`, local workflow integration, replay/fault injection, browser-contract fixtures and the fresh Temporal-controlled live report lifecycle, explicitly separated from synthetic tests.
- **Observability:** OpenTelemetry correlation and richer Flowdeck status, after the core unattended flow works.
- **Scaling:** multi-project scheduling/fairness, per-project budgets and retries, no-progress detection, richer handoffs, permissions, and review-system integrations.
- **Longer-term owner concept (separate future product work):** discover eligible project repositories under the owner's configured folders; read their approved task lists; let the customized plugin prepare project specifications; use Codex as an implementation executor/'typewriter' under those specifications; rotate between projects. This is documented intent, not authorization to run a cross-repository coding loop today.

Carry over the actual deep-research links and findings from **`Pasted text(20261015-044722).txt`** and **`RESEARCH-PROMPT.md`** rather than inventing package capabilities. The research recommendation to strengthen evidence and independent acceptance remains a **future hardening path**, not a new prerequisite for today's demonstration beyond the narrow anti-duplication/identity/approval safeguards above. External code-review systems remain responsible for judging implementation quality.

### Deliverables I expect from you

- Updated **editable** roadmap, with the simplified one-day MVP prioritized.
- Active MVP task breakdown with owner-visible progress and one real end-to-end acceptance run.
- Separate, source-linked **deferred research backlog** whose items cannot silently become approved active tasks.
- A concise status/handoff summary stating **implemented vs. observed live vs. not yet working**, touched paths, blockers, and next action.
- A modular, read-only Jazz status-client demonstration or a clearly documented authorized-bootstrap blocker with an immediate link to the existing plugin panel; the event-driven main MVP must still proceed.

**Please make the minimum necessary plan corrections, then start working on the MVP rather than doing another general architectural review.**

---

**Updated October 15 fast-track technical plan:** `FLOWDECK_JAZZ_READ_ONLY_CLIENT_IMPLEMENTATION_PLAN_FAST_TRACK_2026-10-15_EN.md` (part of this updated handoff). Previous directive and technical-plan files remain unchanged as historical versions.

**Source pack to supply or link with this directive (these files are not assumed to be on the MacBook unless you place them there):** `SUPERVISOR_MASTER_PLAN_FROZEN_V1_2_EN.md`; `SUPERVISOR_ONE_DAY_MVP_EXECUTION_2026-10-15_EN.md`; `RESEARCH-PROMPT.md`; research report `Pasted text(20261015-044722).txt`; `HANDOFF.md`; `working-tree-status.txt`; `build-and-tests.log`; current code snapshot or live repository. This directive is a draft for the architect. It does not itself change the MacBook repository or launch any workflow.
