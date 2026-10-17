# F4 actual Temporal history replay and failure validation — 2026-10-16

**Deployment decision:** **F4 status-projection isolation is validated for scoped deployment.** The historical Task B successor **remains blocked and is not authorized by this test**.

**Working repository:** /Users/test/Documents/work/temporal-harness-mvp
**Evidence directory:** /Users/test/Documents/work/temporal-harness-mvp/.state/verification-runs/f4-replay-20261016T030603
**Temporal server / namespace:** `127.0.0.1:7233` / `default`
**Git HEAD:** `203092cbc35d70d6aee8fd4580298635a0e44890` (insufficient by itself: most new source is untracked).
**Workflow code SHA-256:** `7b9ab405f09ce9c772ce33856b43836c99ed69231cc7cae863dddd0cbcd68bae`.
All exact source/build/test hashes and prior dirty-state inventory appear in `baseline.json` and `final-build-manifest.json`.

## Current architecture and historical guard
F4 introduces the one-time version marker `flowdeck-status-projection-isolation-v1`. New histories record one core patch marker, use a bounded optional status-publisher activity (start-to-close 5s; schedule-to-close 15s; retry at most twice) and expose queryable projection health. Legacy histories with no patch marker must keep their original publication behavior. Task approval, send claims, recovery lineage, one-click intent, deadlines and cancellation remain authoritative/fail-closed. No original Task A/B send or recovery was attempted.

## Exact-run read-only replay (installed Temporal SDK)
`scripts/flowdeck-replay-check.mjs` takes explicit server/namespace/workflow ID/run ID; describes and checks the exact run, fetches history into memory and calls `Worker.runReplayHistory` with this built workflow. It uses no production task queue, activity registration, workflow start or signal. It has a bounded watchdog and closes its client connection. No raw user histories are persisted by the runner.

| Replay | Workflow type | History events | F4 marker count | Result |
| --- | --- | ---: | ---: | --- |
| legacy-normal | flowdeckSupervisor | 326 | 0 | Passed |
| legacy-recovery | flowdeckRecoverSend | 41 | 0 | Passed |
| new-happy | flowdeckSupervisor | 190 | 1 | Passed |
| new-persistent | flowdeckSupervisor | 187 | 1 | Passed |
| new-final-failure | flowdeckSupervisor | 190 | 1 | Passed |
| new-exhausted-timeout | flowdeckSupervisor | 190 | 1 | Passed |

An intentionally nonexistent exact run ID was refused as `WorkflowNotFoundError` (exit 1); no fallback to the most recent run. All six specified replay histories passed against the same F4 bundle.

## Isolated real-Temporal synthetic failure matrix
Every scenario used a unique synthetic workflow ID and task queue, fake activity/browser adapters, no production task enrollment, and deterministic cleanup. Every `smoke-*.json` has a corresponding `.exit` and `.err`; `activity-history-evidence.json` records retry-policy fields, started-attempt number, terminal failure counts and patch markers.

| Scenario | Temporal result | Publisher invocations | Final projection health |
| --- | --- | ---: | --- |
| happy | COMPLETED | 16 | healthy |
| projection-transient | COMPLETED | 17 | healthy |
| projection-persistent | COMPLETED | 32 | degraded |
| projection-timeout | COMPLETED | 17 | healthy |
| projection-final-failure | COMPLETED | 17 | degraded |
| projection-and-send-failure | COMPLETED | 10 | degraded |
| projection-missing-authority | COMPLETED | 2 | degraded |
| recovery-no-release | TIMED_OUT | 2 | N/A |
| projection-cancellation | CANCELLED | 1 | N/A |
| projection-cancellation-late | CANCELLED | 4 | N/A |
| projection-timeout-exhausted | implementation_done_review_pending | 17 | healthy |

- **Transient failure:** publisher called 17 times for 16 logical publications, recorded activity attempt 2, finished healthy.
- **Persistent failure:** publisher called 32 times for 16 logical publications, Temporal recorded 16 terminal activity failures; both fake tasks still reached review_pending and health ended degraded.
- **Initial timeout with successful retry:** Temporal recorded attempt 2; fake business cycle completed. A late fake activity completion logged a harmless SDK warning after its task token timed out. Such late writes are why the disk status snapshot must not be treated as authoritative.
- **Exhausted two-attempt timeout:** both initial publication attempts exceeded start-to-close, history recorded a terminal activity timeout (count 1) and attempt 2. The business cycle still finished; the later successful publications reset health to healthy. This final scenario initially exposed a **synthetic expected-snapshot assertion** (a failed publication should not be present in the snapshot list). The fixture was corrected, rerun and passed; the original failed probe logs remain preserved.
- **Failed final publication:** completed business result despite degraded final projection; the earlier acknowledged `lastPublishedAt` was retained.
- **Publication + send/journal failure:** paused needs_attention after one fake attempted continuation; *no next-task send*.
- **Missing authority while publisher fails:** loader failed, workflow paused; no adoption or fake send.
- **Recovery without readiness release:** synthetic recovery workflow ended TIMED_OUT under its seven-second test budget; zero recovery dispatch and zero browser sends.
- **Cancellation:** both initial-publication and sending_continuation-publication cancellations ended Temporal status CANCELLED; no subsequent fake send.

`activity-history-evidence.json` proves actual Temporal scheduled publisher settings (5-second start-to-close, 15-second schedule-to-close, retry maximum 2) and observed start-attempt=2 in transient, persistent, timeout and final-failure cases. Distinguish *one logical publication* from two server-managed activity attempts.

## Regression results (final harness)
- `npm run build`: exit 0.
- `npm run test:portable`: **193 passed, 0 failed, 1 skipped** (194 total), exit 0.
- `npm test`: **330 passed, 0 failed, 3 skipped** (333 total), exit 0.
- `git diff --check`: exit 0.
- Historical replay & fault checks: six replay executions and eleven synthetic real-Temporal scenario variants passed (final runs).

## Isolation and privacy limitations
- This tests **workflow bundle compatibility** and business decisions with fake browser and plugin work events; it is not acceptance of the historical B incident.
- It starts **new synthetic** Temporal histories on the local server, using unique queues, with workers and connections closed afterward. No production worker queue was polled and no real Helium or ChatGPT message was sent.
- Full raw Temporal histories were **not** written to the repo. Local logs may contain synthetic task data, IDs and SDK diagnostics; restrict sharing accordingly.
- Production `.state/flowdeck-supervisor` claims, successor authorization slots, original inboxes and workflows were not intentionally modified or reconciled.
- The existing production B preview remains blocked by predecessor tab/message seal and occupied successor slot. Later browser readiness passed 20 consecutive no-send checks in its separate evidence packet, but that never licensed a B recovery.

## Release recommendation and subsequent owner decision
**F4 component:** suitable for **scoped deployment** subject to ordinary controlled rollout/monitoring and preservation of the legacy version branch. Do not remove or rename `flowdeck-status-projection-isolation-v1`. For a late publisher write, treat the Temporal query/result—not the optional dashboard snapshot—as authoritative.
**Historical B:** **not deployable by this evidence**. The owner must separately approve either an audited remedy for the missing predecessor/lineage constraints or a genuinely new two-task pilot with fresh IDs. Never reuse the already occupied authorization, rebind the old tab by assumption, replay A or click again after uncertain send.
