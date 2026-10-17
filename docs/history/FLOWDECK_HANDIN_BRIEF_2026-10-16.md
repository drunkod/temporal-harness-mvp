# Flowdeck MVP — hand-in brief
**Prepared:** 2026-10-16. **Evidence-based status:** engineering prototype demonstrable; full live A→B completion **NOT** demonstrated.

## What the project does
Flowdeck supervises an approved sequence of work inside one existing ChatGPT Project. A manually started work session is bound to the exact task/chat/work ID, emits durable work-start/report events, and is orchestrated by Temporal. In the synthetic integration, it continues Task A in the same chat and then opens a separate Project chat for the approved independent Task B. Completed implementation is **review pending**, never automatically accepted.

## Verified engineering results
- The latest repository-wide `npm test` passed on 2026-10-16: **304 total / 301 passed / 0 failed / 3 skipped**. Evidence: `/tmp/flowdeck-handin-p1-final-20261016.log`.
- `npm run supervisor:smoke` completed a **real local Temporal workflow with synthetic activities** to `approved_cycle_finished` / `implementation_done_review_pending`, verified durable workflow signals and clean worker shutdown. No actual browser send. Evidence: `/tmp/flowdeck-handin-smoke-20261016.log`.
- A consecutive **10/10 live Helium Profile 4 no-send** run created owned Project tabs, selected Probe RemoteMCP2, staged and matched the full test draft, then closed each owned tab. **Zero submissions**. Evidence: `/tmp/flowdeck-repeat-nosend-20261016.log` (latest completed 10/10 run).
- The production B recovery preview is **read-only and fail-closed**, with distinct blockers and `readyForExecution:false`. Its permanent tests include missing predecessor tabs and evidence, binding drift, malformed/missing seals, and non-mutating CLI preview.
- Source was hardened to preserve the sealed user-message hash across post-send work-session adoption. This correction is tested with real module logic and disposable fixture state; it does **not** backfill old evidence.
- The send activity now checks Temporal cancellation and a local 90-second deadline at bounded pre-send checkpoints and supplies the guard to the click adapter. Four new synthetic regression tests cover cancellation, expiry and conservative post-click-intent uncertainty. **This does not certify in-flight CDP transport cancellation or Temporal heartbeat delivery.**

## What is *not* demonstrated
- Historical real Task A completed its manual initial and same-chat continuation according to the preserved pilot artifact and handoff. **Task A must not be repeated.**
- **Real Task B has never been submitted in the successful cycle and its artifact is absent.** The one attended B-only successor execution terminated before staging/Send when the **original Task A browser tab was missing**.
- Its issuance slot is occupied by a previously created, **unconsumed** successor authorization. This is not permission to retry. The historical A record also lacks the sealed expected prompt hash.
- Therefore, do **not** claim end-to-end live autonomy, B implementation completion, or production readiness. Independent review/acceptance is not demonstrated. Local cancellation/deadline guards have been added, but **in-flight transport termination and Temporal cancellation/heartbeat delivery are not independently certified for unattended sending**.
- The incident evidence does not establish independently verified owner authority for that past successor. Do not describe it as authenticated owner approval.

## Running tests from the submitted ZIP
After extracting `Flowdeck_MVP_HANDIN_2026-10-16.zip`, install dependencies with `npm ci` and run `npm run test:portable`. This selected Flowdeck/browser test suite is designed not to depend on excluded private `.state` history. On the original Mac it passed **165 total / 164 passed / 0 failed / 1 skipped**.

The historical `npm test` includes legacy Oracle/Sashai tests tied to private on-machine `.state` snapshots and an Oracle installation. Those fixtures are intentionally **not** included in the ZIP. Therefore the full historical suite is green on the original authorized Mac but **must not** be presented as a clean-checkout portable test. The optional synthetic Temporal demonstration requires a running Temporal service at `127.0.0.1:7233`.

## Safe five-minute demonstration for an evaluator
1. Show the source structure `src/flowdeck-supervisor-workflow.ts`, `src/flowdeck-supervisor-activities.ts`, and the per-project loader `src/flowdeck-projects.ts`.
2. Present the full test log: `/tmp/flowdeck-handin-p1-final-20261016.log` (301 pass / 3 skip / 0 fail).
3. Present `/tmp/flowdeck-handin-smoke-20261016.log` as a real Temporal workflow using **fake browser activities**, with the Task A same-chat continuation and Task B separate-chat path.
4. Present `/tmp/flowdeck-repeat-nosend-20261016.log` for ten consecutive real browser composer/picker/connector staging successes, with zero clicks.
5. State the failed live predecessor-tab identity guard and show the read-only `successor-preview` output. Do **not** run an apply, release, or message submission in the presentation.

## Priority to complete the full MVP
1. Obtain an owner-verified and audited decision on how to reconcile the missing original Task A tab and unsealed historic message. A replacement tab is a **new identity** and may not be silently rebound.
2. Separately resolve the existing successor authorization slot and documented last execution. Never clear or reuse old claims as a shortcut.
3. Certify Temporal heartbeat/cancellation delivery and bounded in-flight CDP transport termination before unattended sends; local pre-send and click guards now have unit regressions.
4. Only following new, appropriately scoped owner authorization and a clean, freshly revalidated preflight may a *new* attended B execution be considered. Observe genuine plugin work events, B artifact, exact finished ChatGPT response and Temporal `implementation_done / review_pending`.

## Submission cautions
- The implementation is **not a clean Git HEAD**. Numerous active source, scripts and tests are untracked. Submit the **tested working tree** rather than an archive built from HEAD alone.
- Exclude local `.state` histories, secrets, cookies, browser profiles, `node_modules`, and private worktree evidence from any public deliverable unless independently reviewed and expressly required.
- Detailed handoffs: `docs/FLOWDECK_PREDECESSOR_READINESS_PRODUCTION_GATE_2026-10-16.md`, `docs/FLOWDECK_FORWARD_SEAL_HANDOFF_2026-10-16.md`, `docs/FLOWDECK_P1_SEND_GUARD_2026-10-16.md`, `docs/FLOWDECK_B_ONLY_ATTENDED_DEMO_2026-10-16.md`.
