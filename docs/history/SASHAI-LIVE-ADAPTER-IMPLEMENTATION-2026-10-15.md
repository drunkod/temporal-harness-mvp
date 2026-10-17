# Live Sashai report adapter — implementation and validation

Date: 2026-10-15
Scope: fixes to the reviewed adapter drafts and completion of the explicitly approved one-off report lifecycle.
Approval authority: [../SASHAI-LIVE-TEMPORAL-REPORT-TASK.md](../SASHAI-LIVE-TEMPORAL-REPORT-TASK.md), unchanged.
Execution: NOT STARTED during this implementation pass. No new ChatGPT prompt, worker, or live workflow was started.

## Fixed Review Findings

1. **Invocation evidence:** connector names in prompts and whole-chat text are not invocation proof. Evidence must come from completed structured tool calls associated with the exact submitted user message and responding assistant group, scoped to the expected report path. The initial write and correction require separate call evidence.
2. **Complete lifecycle:** task-bound prepare, send, observe, verify, conditional correction, reverify, acceptance and reconciliation activities now exist, with a dedicated Temporal coordinator and explicit CLI.
3. **Post-staging checks:** reread contract, durable attempt, routing-source hashes and v2 Git evidence after staging and before each claim. Recheck again after claiming. Full normalized composer equality, location, generation state and dispatch deadline are checked at the actual click.
4. **Owned target:** always request a new Helium Profile 4 window with a unique ownership query and select only a newly observed matching target. Never reuse an arbitrary personal project-landing tab. A sealed preparation claim prevents automatic window recreation after a crash.
5. **Existing attempts:** validate contract, immutable identity, source state and owned target. A persisted send claim requires reconciliation, not fresh preparation. Orphaned preparation/send claims block instead of being reset.

## Additional Hardening

- Initial conversation binding requires the exact submitted user payload, unique attempt marker and stable user-message identity in the owned target. A project URL or marker in the local artifact alone is insufficient.
- Turn completion and tool evidence are read from the SAME owned target and submitted message group, not the first tab with that URL. A later owner message invalidates the current phase observation.
- Require two stable finished observations of the phase's artifact. The correction cannot finish on the old report/old response.
- Temporal holds immutable raw initial/correction claim SHA-256 values and checks receipt equality. Correction claims include the original failed-artifact hash and original user-turn identity. Changed claims, chat, attempt, contract, source or artifact block acceptance.
- Preserve report bytes as Buffer, with strict UTF-8 decoding for content checks. Final report must have the exact initial-byte prefix and only an appended Evidence Index section; original report changes reject acceptance.
- Independently check actual marker presence/absence and require explicit routing conclusions and per-source Evidence Index mappings. Content acceptance remains structural plus objective source checks, not an exhaustive semantic architecture proof.
- Activities have no automatic retries. Browser-send activities check cancellation and a local 45-second deadline, including the page's final click evaluation. The Temporal activity budget is two minutes. This bounds late work but does not claim distributed exactly-once delivery or the ability to undo an already accepted click.
- Routing-file hashes include ignored authority markers and snapshots, in addition to the Git evidence, so a new authority marker cannot evade the source-binding check.

## Files

- src/sashai-live-browser.ts: owned target, connector staging, full-payload click guard, submitted-turn observation and structured invocation evidence.
- src/sashai-live-report-activities.ts: fixed-scope contract, attempts/claims, independent source/report checks, exact correction and acceptance.
- src/sashai-live-report-workflow.ts: bounded durable coordinator; one initial send and at most one correction; no next-task authority.
- scripts/sashai-live-temporal.mjs: explicit status/worker/start, fixed queue/workflow ID and duplicate-start rejection; only the fixed activity object is registered.
- tests/sashai-live-browser.test.mjs: DOM/ownership/deadline fixtures without browser access.
- tests/sashai-live-activities.test.mjs: isolated file/browser-port fixtures, actual adapter lifecycle and negative cases.
- tests/sashai-live-workflow.test.mjs: Temporal primitive/activity mocks testing coordinator decisions, claims, identities, bounded polling and uncertainty.

## Validation

- Full suite: 141 passed, two historical-browser tests skipped, zero failed (143 total).
- TypeScript build passed.
- Dedicated new adapter/workflow/browser suite: 86 passed with no live browser or Temporal dispatch.
- Temporal workflow bundling succeeded independently; browser/Node activity code is excluded from the workflow bundle.
- CLI syntax/help and git diff --check passed; editor diagnostics had no errors or warnings.
- Read-only live CLI status returned exists=false for sashai-task-routing-report-live-v1.

The fixture suite exercises code paths, not actual ChatGPT UI compatibility. No fresh live end-to-end acceptance is claimed.

## Current UI Capability Boundary

The adapter deliberately requires stable user-message IDs, exact visible user payload and structured tool-call attributes (call ID, connector, operation, destination and completion). These have fixture coverage but have NOT been demonstrated on the current live ChatGPT layout for this new task. If the site hides the initiating user turn or does not expose attributable structured tool activity, observation/verification blocks; it must not silently use a connector-name regex or a screenshot as stronger proof.

A current live layout may therefore need a separately tested extraction adapter or a real connector-history evidence reader before successful acceptance. No fallback is permitted to weaken the approved task binding. This is the remaining live validation gate, not a claim that hidden connector activity can be observed.

The existing human/report smoke workflow and accepted report are retained unchanged. No Sashai active plan, implementation work or broader queue is enabled.

## Explicit Execution Commands

Preparation/testing does not start work. The same approved task scope remains valid; it does not authorize a general sender.

Read-only:

```bash
npm run build
npm run sashai:live:status
```

Only when deliberately executing the approved live test, run a foreground worker in one terminal:

```bash
npm run sashai:live:worker
```

Then explicitly start the one-off workflow from another terminal:

```bash
npm run sashai:live:start
```

Starting is a browser side effect: it can open the owned window and submit the approved task and its single conditional correction. Do not run start as a health check. The CLI rejects an existing workflow ID; there are no reset, replay or arbitrary-prompt commands. If interrupted at a claimed send, inspect persisted evidence and workflow state rather than deleting guards or creating another attempt.

Successful final state is verified_approval_boundary with dispatchPermitted=false and nextTaskPermitted=false. Any unexpected failure, unverifiable tool evidence or unknown send stops at a blocked state without replay.
