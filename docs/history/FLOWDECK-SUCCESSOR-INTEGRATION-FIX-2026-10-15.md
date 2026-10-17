# Task B successor recovery — integration correction

Date: 2026-10-15. Implemented directly, without Luna. **No live authorization issued, workflow started/released, or ChatGPT message submitted.** Existing task approval, Task A status, original claims and all previous authorizations remain unchanged.

## Actual read-only result

The exact failed dispatch `007175b7-99b6-4c66-9e73-2726f49986b4` now previews successfully:

```json
{
  "mode": "successor-preview",
  "eligible": true,
  "recordedAttemptId": "flowdeck-supervisor-sashai-probe-pilot--indent-recovery-20261015",
  "failedDispatchId": "007175b7-99b6-4c66-9e73-2726f49986b4",
  "projectId": "sashai-probe-pilot",
  "taskId": "sashai-flowdeck-probe-b-20261015",
  "receiptPresent": false,
  "taskBindingPresent": false,
  "writes": false
}
```

A recursive content/path hash of `.state/flowdeck-supervisor` was identical immediately before and after the final preview:

`e4017c9f29138af24b61c7f780e78e43c18b1b0b85bc3c4e75be90a729cf6ede`

### Identity terminology

- **Failed dispatch ID** is the exact immutable generation UUID: `007175b7-99b6-4c66-9e73-2726f49986b4`.
- **Recorded attempt ID** is the audit label in that generation's `claimed` record. For these historical records it is the older `indent-recovery` workflow ID, inherited from the original authorization. It is not the B-only execution's newer workflow ID or run ID.
- The CLI now names this value `--recorded-attempt-id`; `--failed-attempt-id` remains a backwards-compatible alias with the same meaning.
- A future Temporal **workflow attempt name** is separately supplied to `flowdeck-resume-send.mjs --attempt`. Temporal returns its distinct run ID after start. Do not substitute either for the recorded audit label or rewrite historical journals to rename it.

## Integration corrections

1. **Real legacy root:** traversal accepts an absent root journal only when the already-issued, consumed root authorization and unchanged root slot contain the recorded verified Temporal legacy-stage proof. It does not fabricate a root journal. Journaled children must still show claimed/preparing/pre_send_failed. Missing unproven ancestry, altered scope, cycles, forks and any related click boundary reject.
2. **Actual sender consumption:** `SendRecoveryAuthorization` includes standard and successor variants. The real `recoverPreSendOnce` sender calls `consumeSuccessor` for the successor variant and retains the original consume path for standard authorizations.
3. **Immutable request:** the successor CLI checks current approved enrollment, exact claim hashes, absent B receipt/binding and the completed predecessor record. Only explicit apply writes `resume-<authorizationId>.json` with exclusive creation. It contains B's approved task ID, A's prior binding, the original event and the exact successor authorization.
4. **Shared resume validation:** the resume CLI and tests use `readRecoveryResumeRequest`. It validates the issued path, stored authorization, correct root/successor slot, task/event scope, hashes and unconsumed state.
5. **Single readiness release:** a synced exclusive release intent is keyed to the exact workflow/run before signaling. A duplicate or uncertain release cannot be blindly repeated. The existing workflow also treats duplicate ready signals as a single gate.
6. **Browser readiness:** waiting is limited to freshly created tagged targets. The exact CDP ID remains pinned; only transient pre-send CDP/DOM readiness may wait. Existing conversation drift fails immediately; persistent owned-target drift times out without typing, selecting or sending. Foreign origin and changed ownership tag reject. Strict full-payload match and Send checks remain unchanged.

### Browser test correction

The old transient-route mock consumed its next readiness response when the new diagnostic performed an additional read. It also treated an existing conversation as a newly owned project page. It now models an actually created tagged project target and handles diagnostic reads separately. Additional DOM-executed tests model CDP bootstrap, delayed DOM readiness, permanent route drift, replacement tab ID and changed ownership tag. Assertions were not merely relaxed.

The no-send script previously waited for hydration before calling `stage`, masking the live create-to-stage transition. It now invokes the production transition immediately and supports `--repeat 1..10`, printing bounded redacted diagnostics for CDP versus DOM subchecks. It never calls the Send method.

## Validation

- Full `npm test`, including TypeScript build: **269 passed, 0 failed, 2 skipped**.
- `git diff --check`: passed.
- End-to-end disposable regression: no root journal; recorded legacy proof; consumed parent; real successor CLI preview/apply in a temporary fixture; immutable request; resume loader; B-only workflow; real sender's `consumeSuccessor`; one fake browser click; A/B review-pending statuses; original root slot and request bytes unchanged. No real ChatGPT submission.
- Repeated real Helium Profile 4 no-send check: **3/3 passed**, Probe RemoteMCP2 selected, full composer matched, zero submissions, only each newly owned check tab closed.
- Proposed workflow name `flowdeck-supervisor-sashai-probe-pilot--probe-b-successor-20261015-02` was checked read-only and did not exist.

The original historical failing subcheck cannot be reconstructed from its generic error alone. The instrumented immediate-staging runs passed; the next authorized live attempt will provide specific subcheck evidence if readiness fails again. This patch is not a claim that the live two-task MVP has completed.

## Final preview-first operator sequence

### 1. Safe now: build and preview only

```sh
cd /Users/test/Documents/work/temporal-harness-mvp
npm run build
node scripts/flowdeck-reconcile-send.mjs \
  --project sashai-probe-pilot \
  --task sashai-flowdeck-probe-b-20261015 \
  --send-event-hash 08076302136d096ac07686d3ceeca0b8814a6561cff7a629789198ba4618cc1d \
  --phase-hash 55f4be3428230a279420ead41d818447dde3d2f8d50b6c72bafbb661c2aae998 \
  --recorded-attempt-id flowdeck-supervisor-sashai-probe-pilot--indent-recovery-20261015 \
  --old-dispatch-id 007175b7-99b6-4c66-9e73-2726f49986b4 \
  --successor-recovery
```

Expected: eligible=true, writes=false. If current state changes, the command may correctly refuse. Never clear records to make it pass.

### 2. STOP for owner review and separate successor approval

After review and explicit approval only, repeat the exact preview command with these additional flags:

```text
--apply --approve-successor-recovery
```

It returns `requestPath` for a newly issued immutable request. No request UUID/path can be filled in before issuance; use the actual emitted absolute value for `REQUEST_PATH` below. This apply step was not run during this patch.

### 3. Start the worker, then the new B-only attempt

In one terminal:

```sh
cd /Users/test/Documents/work/temporal-harness-mvp
node scripts/flowdeck-supervisor.mjs worker
```

In another terminal, replace `REQUEST_PATH` with the actual value from step 2:

```sh
cd /Users/test/Documents/work/temporal-harness-mvp
node scripts/flowdeck-resume-send.mjs preview --request REQUEST_PATH --attempt probe-b-successor-20261015-02
node scripts/flowdeck-resume-send.mjs start --request REQUEST_PATH --attempt probe-b-successor-20261015-02 --approve-start
```

Save the printed new run ID. Start creates a distinct execution using REJECT_DUPLICATE/FAIL conflict policies. It does not release B's send. Do not reuse an existing name or issue another authorization if startup fails.

### 4. Establish the new follower boundary

Once the new workflow query shows `waiting_for_manual_start`, run:

```sh
node scripts/flowdeck-work-events.mjs follow \
  --config /Users/test/Documents/work/temporal-harness-mvp/.state/flowdeck-supervisor/probe-pilot-events.json \
  --project-id sashai-probe-pilot \
  --workflow-id flowdeck-supervisor-sashai-probe-pilot--probe-b-successor-20261015-02 \
  --directory /Users/test/Documents/work/temporal-harness-mvp/.state/flowdeck-supervisor/event-inbox-probe-b-successor-20261015-02
```

Wait for `flowdeck.work-events.ready`, pending=0, blocked=0. Leave worker and follower running. The readiness gate expires after ten minutes if not released.

### 5. Release exactly once, only after readiness

Replace `NEW_RUN_ID` with the exact run from step 3:

```sh
node scripts/flowdeck-resume-send.mjs release --request REQUEST_PATH --attempt probe-b-successor-20261015-02 --run-id NEW_RUN_ID --approve-send
```

This is the send-enabling step. The supervisor then opens a new Sashai project chat, selects Probe RemoteMCP2 and may submit B once. Do not manually submit B or repeat A. An uncertain release or click remains sealed for history reconciliation.

Observe B's actual start/report events, final implementation_done marker and review_pending status. Preserve every original claim, root slot, parent authorization, failed dispatch phase file and workflow history throughout.
