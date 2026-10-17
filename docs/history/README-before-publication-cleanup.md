# Historical snapshot: former root README

> **Historical context only — not current startup instructions.** This snapshot predates current documentation organization and may contain stale operational claims and commands. Consult the current root README and `docs/README.md` instead. It is preserved for historical context, not authorization.

# Flowdeck — Temporal ChatGPT Project Supervisor MVP

The **active** product is the explicitly enrolled, owner-scoped Temporal supervisor
(`src/flowdeck-supervisor-workflow.ts`, `src/flowdeck-supervisor-activities.ts`).
The owner manually starts the first approved Project task; Flowdeck adopts its exact
chat/work session, continues unfinished work in that chat, and may advance to a new
chat for an **independent, already approved task**. `implementation_done` means
**review pending**, never code-review approval. Current connector: **Probe RemoteMCP2**.

Read-only operator commands (do not dispatch ChatGPT messages):

```bash
npm run build
npm run supervisor:status
npm run supervisor:workflow-status -- sashai-probe-pilot --attempt probe-b-successor-20261015-02
npm run test:portable
```

`npm test` includes legacy checkout-specific evidence tests; `test:portable` exercises
the portable Flowdeck/browser tier. `npm run supervisor:smoke` runs real Temporal
with **synthetic** browser activities. None proves a completed live Task B.

**Protected live incident:** real Task A is preserved. Real B remains unsent.
The historical successor authorization slot is occupied, and predecessor browser
identity/evidence is missing. **No retry, workflow release, tab rebind, or
authorization reuse is granted by this README.** Work on code/tests and read-only
previews only until a separate audited owner decision.

**Operations:** `scripts/flowdeck-supervisor.mjs` and `scripts/flowdeck-launch.mjs`
are the current normal-start paths; `scripts/flowdeck-resume-send.mjs` is a separately
approved recovery path. Starts in this checkout share an exclusive, non-expiring
claim for the configured device/browser profile. This is not a machine-wide lock
across cloned checkouts, different device IDs, or Temporal namespaces; operate only
one configured checkout/profile scope for this MVP. An uncertain claim requires
audited reconciliation and must not be cleared just because a PID disappeared. The old root `npm run worker`,
`npm run start`, `npm run seed` and `npm run verify` operate the **historical
fixture**, not the active product. Never delete `.state` to repeat this MVP.

Current architecture and limits: `docs/FLOWDECK_ARCHITECTURE_REVIEW_2026-10-16.md`;
incident/runbook: `docs/FLOWDECK_B_ONLY_ATTENDED_DEMO_2026-10-16.md`.

## Historical notes (not the current start instructions)

# Flowdeck — Oracle-only Sashai Chat Supervisor

**Created:** 2026-10-14 · **MacBook:** Tests-MacBook-Air · **historical deadline demo:** next morning.

A small, independent Git repository under `~/Documents/work/temporal-harness-mvp`. Its primary demonstration is **Oracle-only Sashai conversation supervision** in Helium Profile 4; the original Temporal two-fixture execution proof remains available for historical inspection.

## Historical Temporal fixture stages (not the active Sashai pipeline)

```
Temporal Server 1.32.1 (installed in Nix-Config, loopback only)
   ↕ Temporal TypeScript Worker, taskQueue=repo-harness-mvp
   → discover TODO across two disposable Git repositories
   → independently compile a full exact-output spec packet with SHA-256
   → optional OpenCode Zen Jev reasoning-risk classification (advisory)
   → Repo Harness ChatGPT browser-consult --dry-run (no Web submission)
   → isolated Git worktree → exact packet application (Codex substitute)
   → independently check file hash + changed-file allowlist
   → verified Git commit promotion → check off TODO
   → durable receipt → next repo
```

**Important scope:** This is an intentionally narrow proof. The spec compiler is **deterministic**, not an autonomous AI planner. The executor applies an exact file, not a real Codex model invocation. The browser stage generates local **dry-run** sessions; it is not proof of a completed ChatGPT consultation. Temporal is real and persistent, but retry recovery of arbitrary side effects is not yet production-hardened. No real project repositories are modified.

## Temporal bound review and disposable first-task pilot (2026-10-15)

A real new Temporal execution verified the **immutable post-resume task, attempt ID, chat, contract, report path/hash and send claim** after a worker restart. The verifier's receipt now includes the attempt ID and is matched to the pre-wait binding. A swapped attempt ID fails at pre-verification, receipt, and post-verification.

Two new **synthetic-only** Temporal runs then exercised a fresh task lifecycle: `repair` prepared and sent a disposable report, independently rejected a known missing acceptance marker, applied one targeted correction and reverified; `uncertain` injected a lost response after the send claim and safely **blocked without any resend or correction**. The synthetic reports never opened ChatGPT or invoked Desktop Commander. This is an orchestration proof, not a real connector-selected browser dispatch. No Sashai implementation plan is active. See [the execution report](../history/SASHAI-TEMPORAL-BINDING-AND-SYNTHETIC-LIFECYCLE-2026-10-15.md).

Read-only receipts: `node scripts/sashai-binding-proof.mjs status`, `node scripts/sashai-synthetic-temporal.mjs status repair`, and `node scripts/sashai-synthetic-temporal.mjs status uncertain`.

## Report evidence hardening and Temporal restart proof (2026-10-15)

The approved browser report remains independently accepted, but the supervisor now distinguishes **historical limited evidence** from stronger safeguards required for all new attempts. Both connector-preserving report senders compare the **entire normalized composer payload** before clicking Send, and new attempts bind staged diffs plus hashes of modified/untracked file contents. Flowdeck requires the current contract, persisted attempt, acceptance and report hashes to match before showing current report verification.

The new `sashaiReportLifecycle` Temporal workflow safely adopted the prior report's sealed submission and correction records, survived a **dedicated worker restart**, then completed on a durable resume signal at `verified_approval_boundary`. It performs read-only reconciliation and verification; **it cannot send prompts or dispatch new tasks**. Check the recorded run with `node scripts/sashai-report-temporal.mjs status` and see [the evidence and limitations](../history/SASHAI-TEMPORAL-REVIEW-RECOVERY-2026-10-15.md). The report's original Git evidence was limited to status/unstaged diff; stronger v2 snapshots cannot be applied retroactively. No Sashai product implementation is authorized.

## Sashai ChatGPT Supervisor — current primary MVP (Oracle-only)

The active CLI is the isolated, unmodified Oracle **0.21.5** (`npm run oracle:pin`); the global Homebrew Oracle 0.21.3 is untouched. Live new-chat and same-chat followup tests completed with accurate saved responses. A read-only background watcher (`scripts/manage-sashai-watcher.sh status|start|stop`) may adopt exactly one active Sashai chat; it never dispatches work.

The live homepage at **http://127.0.0.1:4319/** now displays the Sashai project conversation, **read-only adoption**, the current ChatGPT turn status and independently observed Oracle answer evidence. The active integration uses **Oracle CLI + Helium Profile 4 CDP** without Repo Harness. The earlier two-fixture workflow is retained as historical evidence, but its `POST /api/start` launcher is disabled with HTTP 410. One **approved report-only** browser task was submitted and verified through Desktop Commander; there is still no general unattended Sashai implementation task dispatcher.

```bash
cd ~/Documents/work/temporal-harness-mvp
npm test
node scripts/sashai-supervisor.mjs doctor
node scripts/sashai-supervisor.mjs status
node scripts/sashai-supervisor.mjs watch 5
node scripts/sashai-supervisor.mjs auto-adopt
scripts/manage-sashai-watcher.sh status
scripts/open-helium-profile4.sh
```

Read-only Oracle browser diagnostics: `node scripts/oracle-sashai.mjs diagnose flowdeck-sashai-oracle-live-cdp`. See [root-cause report](../history/ORACLE-PROMPT-COMMIT-RCA.md). Oracle **0.21.5 now captures answers and same-chat followups** in live Sashai smoke tests. Legacy 0.21.3 sessions must not be blindly replayed.

**New live browser-origin integration proof:** Desktop Commander was selected in a fresh Sashai project chat, invoked read-only (ChatGPT activity: “Listed devices and retrieved file metadata”), adopted by the watcher while running, then continued in the SAME conversation by Oracle 0.21.5 `--browser-tab`. The watcher and dashboard remain non-sending. An explicit read-only active-plan resolver reports **no approved active plan**, so actual tasks must not auto-start. Test and design evidence: [canonical plan](../plans/ORACLE-SASHAI-SUPERVISOR-PLAN.md).

The one-shot test helper `scripts/ui-sashai-plugin-smoke.mjs` is for diagnosing this specific 2026-10-14 harmless smoke; its persistent send guard intentionally refuses repeat submissions. Do not use it to dispatch production tasks.

See [the canonical Oracle Sashai plan](../plans/ORACLE-SASHAI-SUPERVISOR-PLAN.md) and [Sashai user journey](../history/SASHAI-SUPERVISOR-JOURNEY.md). Prior Repo Harness integration in `src/activities.ts` remains isolated in the legacy fixture and is **not** part of the active Sashai supervisor.

## Live browser dashboard (now implemented)

Open **http://127.0.0.1:4319/** in a **new Helium Profile 4 window** (verified name: `drunkod gpt`), keeping your existing ChatGPT tab untouched:

```bash
cd ~/Documents/work/temporal-harness-mvp
scripts/open-helium-profile4.sh
```

The dashboard is served by `org.drunkod.temporal-harness-mvp-dashboard`; its **main Sashai view polls Helium via CDP every two seconds**. The independent Temporal worker remains available for historical fixture runs, but new fixture dispatch via the HTTP API is disabled. Check `docs/ORACLE-SASHAI-SUPERVISOR-PLAN.md` for the current architecture.

## Quick start on MacBook

```bash
cd ~/Documents/work/temporal-harness-mvp
npm install
npm run build
npm run seed                       # two distinct disposable Git repositories
npm run worker                     # terminal A: real Temporal Worker
npm run start -- --wait            # terminal B: real two-repo Temporal Workflow
npm run verify                     # checks final files, receipts, and TODO completion
npm run list                       # list workflow IDs and statuses
npm run status -- <workflow-id>    # inspect one workflow
npm test
```

The server must respond `SERVING` to:
```bash
~/.local/share/temporal-server/nix-cli/bin/temporal --address 127.0.0.1:7233 operator cluster health
```

The worker can run without ChatGPT.com being open. A running Workflow is queryable by `mvpStatus`. To query from anywhere with access to the Mac, run `npm run status -- <id>` via Remote Desktop Commander.

## Evidence and paths

| Location | Contents |
|---|---|
| `examples/projects/alpha`, `beta` | Two independent seed Git repositories with TASKS.md and generated OUTPUT.md |
| `.state/packets/` | Frozen spec packet JSON, hashes, base Git HEAD |
| `.state/claims/` | Claim-before-effect; uncertain attempts are not blindly replayed |
| `.state/worktrees/` | Disposable isolated execution worktrees |
| `.state/receipts/` | One verification receipt per task |
| `examples/projects/*/.ai/harness/chatgpt/sessions/` | Repo Harness browser dry-run records |
| `.state/worker.log` | Background Temporal Worker log (when launched via nohup) |

No new public endpoints, OAuth bypass, Chrome profile access, or modifications to RemoteMCP-Jazz/Nix-Config are required for this test.

## Jev compatibility

The system reuses `/Users/test/nix-config/ai-tools/opencode/plugin/jev-core.mjs`; it uses **OpenCode Zen** model `jev-1.13-free`, with the existing SOPS runtime credential. No secrets are placed in source or logged. The Jev result is advisory for these two pre-approved fixtures. `--no-jev` disables this optional network call.

## Browser compatibility

Installed `repo-harness` is 0.20.0, but the global `oracle` binary is 0.21.3 whereas its doctor requires **exactly 0.20.0**. We do not downgrade or change the global binary. The dry-run exercises prompt packaging/session persistence without opening Chrome. To test actual ChatGPT browser submission later, install a pinned 0.20.0 Oracle locally and pass an explicit `--oracle-bin`, then repeat `browser-doctor` and confirm the approved browser profile.

## What remains for product MVP

A model-backed planner that creates independently checkable specs, real Codex typewriter adapter, asynchronous device dispatch through RemoteMCP-Jazz, protected MCP control tools, live ChatGPT browser consult/follow-up with compatible Oracle, and safe replay/reconciliation for crashes. **The live browser task-progress dashboard is implemented and verified.** The existing 26 RemoteMCP executor tool schemas remain untouched.

## Stop and reset

Stop Worker only: `kill $(cat .state/worker.pid)` (if background PID exists).
The Temporal server is independent and remains running. **Do not delete `.state`**: this checkout contains immutable Flowdeck send claims, authorization slots, audit journals, and historical task bindings. To repeat a fixture experiment, create a **new separate disposable test root** under a temporary directory and run the fixture exclusively there; do not reuse the active root or disturb the live project, Temporal histories, or the plugin's ledger.
