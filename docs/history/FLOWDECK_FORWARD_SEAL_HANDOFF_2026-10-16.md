# Flowdeck forward seal handoff — engineering-only fix

**Date:** 2026-10-16. **Scope:** source and test correction only. **No live B dispatch, no work-event follower, no Temporal worker, no recovery authorization, and no browser send.** The authorization slot and old claims remain immutable. B is not complete.

## Defect and correction

Before this packet, `adoptStartedWork` verified `expectedRecord.expectedPromptHash` against the visible next user message, but the new work-session `binding-*.json` was claimed without that already verified seal. Thus a future correctly supervised B conversation could reach a finished report with no message seal and fail the read-only predecessor readiness gate.

The corrected `src/flowdeck-supervisor-activities.ts`:
- When adopting a post-send expected binding, requires a full existing record whose binding matches the **exact expected binding**, with a positive stored turn count and valid 64-character lowercase SHA-256 `expectedPromptHash`.
- Preserves that **same** sealed hash when claiming the new work-session binding after the existing tab/chat/task/worktree/user-hash and turn-count checks have passed.
- Does **not** invent `expectedPromptHash` for manual initial adoption; historical Task A retains its original unsealed evidence.
- Existing `observeWorkResult` preserves the seal via `{...r, observation: result}`. No send/click behavior, workflow signals, browser adapter, or authorization semantics were altered.

## Regression checks

The persistent `tests/flowdeck-supervisor-activities.test.mjs` now asserts:
- Manual adoption never fabricates a stored seal.
- Continuation and new-chat adoption both preserve the exact previously sealed message hash under the **new** work ID.
- A subsequent finished observation keeps the hash.
- Mismatched stored binding, malformed hash, and invalid stored turn count refuse adoption **before** a new binding is claimed; no reclick occurs.
- A full **disposable fixture** send → adopt → finish → predecessor-readiness evaluation returns `readyForPredecessor:true` using the genuine fixture binding and retained seal. This is synthetic, not a live B execution.

Build and full suite: `npm test` **300 tests, 297 passed, 0 failed, 3 skipped**, exit code 0. The focused newly added tests passed.

## Live incident guard remains closed

The exact read-only B successor preview still reports:
```json
{
  "lineageEligible": false,
  "predecessorTabPresent": false,
  "predecessorEvidenceVerified": false,
  "readyForExecution": false,
  "blockers": [
    "successor_authorization_already_exists",
    "original_predecessor_tab_missing",
    "fresh_predecessor_completion_unverified"
  ],
  "writes": false
}
```
SHA-256 of recursive `.state/flowdeck-supervisor` content **both before and after** this preview: `31aac9fd409fbfa6a5fba847812f535ef7ed76dde49c34b4b94f2a03d449d70f`. No running Flowdeck send worker or follower was found and `task-b.md` remains absent.

## Build provenance

The P0 **browser implementation** remains unchanged:
- `src/sashai-live-browser.ts`: `ce9db1411433d76bc5faafff6bde7cef7297c26faee750ae54439b420a8118bb`
- `dist/sashai-live-browser.js`: `83ab93a6d679a6b99728e484f18b540d6c1fdf0d946a54a49504dbcb2a38b7e3`

The **supervisor activities source/build are revised** and must not be represented by the older P0 worker-build manifest:
- `src/flowdeck-supervisor-activities.ts`: `e8b5f5db6d41b0cd5a16ffb71c911d08fc6295104557b7e3939208f55b7032f9`
- `dist/flowdeck-supervisor-activities.js`: `760d4fa86ae32301e78c02865089c1f4d456c6e7c7bd7889d9cf6ec94dec906e`

The code remains **uncommitted** within an already untracked, active working tree; HEAD alone does not describe the tested state. Before any *separately approved* future operation, independently rehash/review the full build and the unresolved owner-approval, predecessor-tab, historical message seal, cancellation/deadline and successor-lineage problems.

**Conclusion:** the future-path seal-loss defect is fixed and regression-tested. This does not resolve the historical Task A tab or missing historical seal, and it does not authorize another Task B attempt.
