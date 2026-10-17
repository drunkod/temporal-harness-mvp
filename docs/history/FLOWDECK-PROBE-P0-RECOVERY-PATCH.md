# Probe pilot P0 recovery patch and operator procedure

Date: 2026-10-15. Extends the existing supervisor. No plugin, Jazz, authentication or external-review changes. **No live recovery or ChatGPT submission was performed by this patch.**

Incident source: [FLOWDECK_PROBE_LIVE_P0_HANDOFF_2026-10-15_EN.md](FLOWDECK_PROBE_LIVE_P0_HANDOFF_2026-10-15_EN.md). Task A is already implementation_done/review_pending. Never resubmit its initial prompt or continuation.

## Implemented corrections

### Explicit historical-event reconciliation

`src/flowdeck-event-reconciliation.ts` and `scripts/flowdeck-reconcile-events.mjs` provide preview-first recovery for one exact task/workId/chat/tab and selected Temporal execution/run. The command reads actual `origin:event` records through the installed plugin's read-only reader, validates the approved worktree, preceding sent receipt and claims, current user-message hash, task/chat binding, follower inbox and exact `supervisorWorkEvent` history. It signals only missing selected events under separate exclusive operator audit intents. Snapshots do not become triggers. It never writes the plugin or follower inbox.

Run-specific audit receipts prevent repeated signals. An uncertain signal without a history receipt stays sealed; it is not blindly retried. Closed or wrong-phase executions are rejected. An inbox entry alone does not prove Temporal received it; history is the authoritative delivery evidence.

The genuine A Stage 2 pair was already reconciled by the operator and must not be replayed into the old closed execution:

- Work ID: `62370a89-634f-45ec-b169-6a19482a1826`.
- Start: `699901ae-2b31-417c-bc2b-c9648428bd32`.
- Report: `08b0e37a-f1de-4b06-bdac-e36c3aa6f26a`.

Command shape for a future missing-event incident (supply exact inspected scope; no placeholder config is created automatically):

```sh
node scripts/flowdeck-reconcile-events.mjs --config /absolute/selected-reconciliation.json
# Only after inspecting the preview and authorizing these exact events:
node scripts/flowdeck-reconcile-events.mjs --config /absolute/selected-reconciliation.json --apply --approve-reconciliation
```

The selected config must include `plugin-repo`, `db`, `owner`, `device`, `flowdeck-root`, `inbox-directory`, `audit-directory`, `workflow-id`, `execution-id` (Temporal run ID), `project-id`, `task-id`, `work-id`, `chat-url`, `tab-id`, `start-event-id`, `report-event-id`, and `worktree`. Use the actual attempt inbox directory, not a different attempt's inbox. Current scope is a previously submitted same-chat turn with a sealed preceding receipt; this is not a generic arbitrary-chat import command.

### Durable pre-send versus uncertain-send distinction

`src/flowdeck-send-recovery.ts` records immutable, synced phase files:

`claimed → preparing → staged → click_attempted → submitted → reconciled`

Failures before the click boundary record `pre_send_failed` with the sanitized actual cause. `click_attempted` is synced **before** the browser click. Any such marker or later state forbids pre-send recovery, including crash/timeout cases. Missing receipts alone never prove no click.

Original `send-event` and `send-phase` files remain the normal single-host claim authority. A recovery requires a one-use authorization for those exact logical-send hashes. It gets a separate generation; old claims are preserved. An exclusive logical-phase authorization slot prevents issuing multiple parallel recovery generations. Authorization consumption is synced before another physical opportunity. The new receipt reconciles repeated activity calls without clicking again.

The legacy failed B send predates phase files. Its recovery is permitted only by an explicit reviewed-stage-failure attestation plus actual exact-run Temporal history: scheduled activity arguments equal current enrolled project/task/prior binding/event, a genuine non-timeout `Object.stage` failure in `send`, maximumAttempts=1, no retry evidence, exact original claim hashes, and no B receipt or binding. This is a narrow legacy exception, not a caller-supplied stack or a receipt-absence bypass. The attestation flag is an explicit operator ordering review, not a cryptographic attestation of historical source code.

Operator diagnostics now preserve a sanitized underlying activity cause and identify `pre_send_failed` separately from a potentially submitted message.

### B-only continuation of the existing supervisor

`flowdeckRecoverSend` enters the existing supervisor loop with A recorded as implementation_done/review_pending and B as the only recovered successor. It does not recreate A's chat or rerun A. It waits for a `supervisorRecoveryReady` release before consuming authorization or sending. After B submission it uses the normal durable hydration, event ordering, adoption, completion and review-pending logic.

The worker registers `recoverPreSendOnce`. The standalone `scripts/flowdeck-resume-send.mjs` exposes preview/start/release, rejects execution-ID reuse, and pins release to the exact run ID. Start alone cannot send; release is the send-enabling operator step after follower readiness.

## Real read-only eligibility result for the current B failure

The preview was run successfully against actual Temporal history and local claim records, without applying anything:

- Workflow: `flowdeck-supervisor-sashai-probe-pilot--indent-recovery-20261015`.
- Run: `01a1400a-4fb3-7c9e-9fa6-902bdb1addfa`.
- Status: COMPLETED.
- Scheduled event: `126`, activity `startNextTaskOnce`, maximumAttempts `1`.
- Cause: `Original owned ChatGPT tab changed`, stack `Object.stage → send`.
- Project: `sashai-probe-pilot`.
- B task: `sashai-flowdeck-probe-b-20261015`.
- Exact sent receipt: absent; B task binding: absent.
- Preview eligibility: true.

No authorization was issued, old claims were not cleared, and no recovery workflow was started.

## Safe current B recovery — explicit approval required

The original two-task scope remains approved. **One operational approval is still required for the legacy pre-click attestation and new named B-only attempt.** This is not a request to reapprove or repeat A.

### 1. Preview, then authorize this exact legacy failure

From the main repository, this exact command is read-only:

```sh
node scripts/flowdeck-reconcile-send.mjs \
  --project sashai-probe-pilot \
  --task sashai-flowdeck-probe-b-20261015 \
  --send-event-hash 08076302136d096ac07686d3ceeca0b8814a6561cff7a629789198ba4618cc1d \
  --phase-hash 55f4be3428230a279420ead41d818447dde3d2f8d50b6c72bafbb661c2aae998 \
  --failed-attempt-id flowdeck-supervisor-sashai-probe-pilot--indent-recovery-20261015 \
  --old-dispatch-id legacy-b-stage-126 \
  --attest-legacy-stage-failure \
  --workflow-id flowdeck-supervisor-sashai-probe-pilot--indent-recovery-20261015 \
  --run-id 01a1400a-4fb3-7c9e-9fa6-902bdb1addfa \
  --scheduled-event-id 126 \
  --source-attestation 1b4c6bf755189ce949f0dfc1e269b10a0487e68e9b32da71131d6413dfcd394e
```

After explicit approval only, repeat that exact command with `--apply --approve-pre-send-recovery`. It emits a one-use authorization and `requestPath`. Preserve that output. Neither command clicks ChatGPT Send. Do not repeat apply to seek another authorization if startup later fails; inspect the existing one.

### 2. Start worker and the fresh B-only workflow

In one terminal:

```sh
npm run build && node scripts/flowdeck-supervisor.mjs worker
```

In a second terminal use the emitted absolute `requestPath` in place of `REQUEST_PATH` below:

```sh
node scripts/flowdeck-resume-send.mjs preview --request REQUEST_PATH --attempt probe-b-recovery-20261015
node scripts/flowdeck-resume-send.mjs start --request REQUEST_PATH --attempt probe-b-recovery-20261015 --approve-start
```

This creates `flowdeck-supervisor-sashai-probe-pilot--probe-b-recovery-20261015` and prints its new run ID. It waits for readiness release. Use a new name only with explicit operator authorization; never terminate/delete history to reuse a name.

### 3. Establish the follower boundary before any B send

Once the workflow query shows `waiting_for_manual_start`, start the follower in another terminal:

```sh
node scripts/flowdeck-work-events.mjs follow \
  --config /Users/test/Documents/work/temporal-harness-mvp/.state/flowdeck-supervisor/probe-pilot-events.json \
  --project-id sashai-probe-pilot \
  --workflow-id flowdeck-supervisor-sashai-probe-pilot--probe-b-recovery-20261015 \
  --directory /Users/test/Documents/work/temporal-harness-mvp/.state/flowdeck-supervisor/event-inbox-probe-b-recovery-20261015
```

Wait for `flowdeck.work-events.ready`, with pending=0 and blocked=0. The fresh inbox/checkpoint does not modify the previous attempt. Do not send B manually.

### 4. Release the authorized one-time recovery

Use the exact new run ID printed by start:

```sh
node scripts/flowdeck-resume-send.mjs release --request REQUEST_PATH --attempt probe-b-recovery-20261015 --run-id NEW_RUN_ID --approve-send
```

This enables the one authorized B send, in a newly owned Sashai Project window with Probe RemoteMCP2. A's original chat, completed files and histories remain untouched. The old empty B staging tab is not adopted or overwritten.

The readiness release expires after ten minutes if not given; no send occurs. If any click becomes uncertain, stop and reconcile; do not issue another authorization, clear claims, or manually send B.

## Validation and remaining proof

- Final `npm test`: **261 passed, 2 skipped, 0 failed**, including TypeScript build.
- Regression coverage includes exact source-event selection, encoded signal history, missed-start recovery, collision/closed-target rejection, pre-click versus post-click sealing, authorization tampering and one-use consumption, preserved original claims, B-only recovery waiting for release, report-before-start, and no A replay.
- Real no-send Helium Profile 4 test: Probe RemoteMCP2 selected; full draft matched; zero submissions; only the owned test tab closed.
- Legacy B preview: actual run/history/claims checked, eligible=true, no apply.
- `git diff --check`: passed.

The full autonomous live cycle remains incomplete until the authorized B recovery actually emits its real start/report events and reaches implementation_done/review_pending. That live recovery has not been executed by this patch.
