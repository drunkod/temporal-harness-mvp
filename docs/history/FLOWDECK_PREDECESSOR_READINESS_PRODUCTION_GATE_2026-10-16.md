# Flowdeck successor: read-only predecessor readiness gate

**Date:** 2026-10-16. **Scope:** engineering implementation and tests only; no live successor authorization/release/worker/follower/ChatGPT send. **Task B remains incomplete.** The previously issued successor authorization and its slot are preserved and are **not** reusable.

## Implementation

- `scripts/flowdeck-predecessor-readiness.mjs` implements a fail-closed `evaluatePredecessorReadiness` with injected read-only tab/DOM readers, `readPredecessorRecords` with an injectable JSON file reader, and production read-only CDP/observation readers. No window creation, typing, connector selection, click, authorization consumption, journal write or workflow signal is exposed by the evaluator.
- `scripts/flowdeck-reconcile-send.mjs` uses this evaluator in the existing `--successor-recovery` preview. It evaluates **lineage eligibility** and **predecessor readiness** separately. Existing/ambiguous lineage does not skip predecessor checks. Preview returns `lineageEligible`, `predecessorTabPresent`, `predecessorEvidenceVerified`, `readyForExecution`, distinct `blockers`, and `writes:false`. The existing `--apply` route fails **before** authorization issuance when `readyForExecution` is false.
- The browser adapter (`src/sashai-live-browser.ts`), Temporal workflow and supervisor send activity are **unchanged**; the worker retains its own strict tab and send checks. No special override flag was added for tests.
- Fresh readiness requires the unchanged approved project/worktree/task scope, exact persisted predecessor binding and active task binding, exact CDP target ID and URL/WebSocket identity, a stored **sealed expected prompt hash**, matching fresh user-message hash and user-turn count, matching original task/worktree/project identity, and an actual finished assistant response whose last line is exactly `FLOWDECK_STATUS: implementation_done`. Missing historic message seal **fails closed**. A historical `implementation_done` observation by itself never substitutes for a fresh read.

## Exact earlier write blocker and resolution

A previous tool attempt targeted `/Users/test/Documents/work/temporal-harness-mvp/scripts/flowdeck-predecessor-readiness-core.mjs` using the Remote Desktop Commander `write_file` action, and returned: **`Script error: This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.`** No macOS `EACCES`, ownership or permission error was returned. The rejected attempt did **not** create that module. Ordinary repository permissions remained `test:staff`; no `sudo`, `chmod`, `chown` or Desktop Commander security-setting change was used. The focused implementation was subsequently saved successfully via the permitted `write_file` and `edit_block` operations at the new `scripts/flowdeck-predecessor-readiness.mjs` path. The specific reason the earlier safety check rejected its payload is unknown.

## Regression and non-mutation evidence

- `tests/flowdeck-predecessor-readiness.test.mjs`: **23 passing tests** (valid sealed case, more than 16 permanent negative/edge cases, and injected filesystem-reader case). Covers missing/duplicate/replaced tabs, URL/type/socket drift, stored task/binding/history drift, task/project/worktree identity changes, absent or mismatched seal, pending response, missing marker, turn-count mismatch and CDP/DOM failures.
- `tests/flowdeck-supervisor-activities.test.mjs`: extended the disposable legacy-root successor integration fixture to assert actual **CLI preview** is non-mutating, with byte-level snapshot equality of the fixture recovery directory, unchanged fake-browser effects (no stage/click/create), and refused `--apply` without predecessor readiness. Any subsequent fixture-only synthetic issuance and fake-browser workflow exercise are separate and never contact the live project.
- Full `npm test` (build included): **298 tests; 295 pass, 0 fail, 3 skip**. The final run completed with exit code 0.
- Before/after the real incident's **preview-only** invocation, the recursive `.state/flowdeck-supervisor` SHA-256 aggregate was identical: `31aac9fd409fbfa6a5fba847812f535ef7ed76dde49c34b4b94f2a03d449d70f`. This includes the predecessor claims, successor slot, authorizations, release record, and retained journals.
- Frozen browser source SHA-256: `ce9db1411433d76bc5faafff6bde7cef7297c26faee750ae54439b420a8118bb`; compiled browser SHA-256: `83ab93a6d679a6b99728e484f18b540d6c1fdf0d946a54a49504dbcb2a38b7e3`. These are unchanged from the P0 source/build manifest.

## Current production preview (exact recorded B lineage)

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

Additional output fields retain exact project/task/failed-dispatch identity and absent B receipt/binding. The existing successor authorization is issued but unconsumed; neither this preview nor the output contract implies reuse permission. The missing original tab still requires **audited rebind policy and separate verified owner authority**, not relaxation of `requireTab`. The historical A record also lacks a sealed expected user-message hash. **Explicit owner approval is not established in the available incident evidence.**

**Status:** production preview fail-closed gate implemented and tested; no B send and no recovery execution; a separate owner-verified decision remains necessary for any later remedy.

## Subsequent forward-path seal fix

The statement above that the supervisor activity was unchanged applied to the **initial preflight integration milestone** only. A later engineering-only packet corrected sealed-message evidence loss during post-send work-session adoption. See `docs/FLOWDECK_FORWARD_SEAL_HANDOFF_2026-10-16.md` for the revised supervisor activities source/build hashes, 300-test full suite, and preserved live state. It does **not** permit another recovery execution.
