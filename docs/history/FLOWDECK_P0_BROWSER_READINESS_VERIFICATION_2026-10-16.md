# Flowdeck P0 browser staging: patch and verification

**Date:** 2026-10-16
**Checkout:** `/Users/test/Documents/work/temporal-harness-mvp`
**Observed HEAD:** `203092c` (working tree remains dirty; active Flowdeck source and tests are untracked).
**Authority:** Development and **no-send staging only**. No successor authorization, task send, workflow release, claim reset, project enrollment change or review approval.

## Decision

The immediate browser staging readiness gate is **met**, with **20 consecutive independent real Helium Profile 4 create → stage → full-match no-send checks**. A preceding ten-attempt series had one failure on attempt 5, after four passes, and is preserved. This is a readiness gate, not a production-reliability guarantee or proof of a live Task B execution.

## Focused modified implementation

- `src/sashai-live-browser.ts`:
  - Separate bounded composer, picker opening, connector choice and selected-label hydration stages under a shared 30-second staging deadline.
  - Preserve the pinned CDP target, tag and exact Project identity; do not adopt other tabs.
  - Select the uniquely visible editor rather than a possibly hidden first editor; refuse ambiguous visible composers.
  - Refuse duplicate connector candidates; retain a single connector click and a single prompt insertion.
  - Wait read-only for Probe RemoteMCP2 to appear in the composer before insertion.
  - Add redacted structural readiness snapshots (route state, visible-element counts, picker/connector/menu/dialog counts, selected-label boolean, busy state); no prompt bodies, page text or credentials.
- `tests/sashai-live-browser.test.mjs`: add regressions for async selected-label hydration, hidden-first composer, duplicate visible composers, and ambiguous connector choices.
- `scripts/flowdeck-browser-check.mjs` remains unchanged. It creates only tagged test tabs, checks full composer match, never calls `click()`, and closes the owned test tab.
- No Temporal workflow, supervisor activity, recovery or approval protocol modifications in this P0 patch.

## Validation

| Check | Outcome |
|---|---|
| `npm test` (build included), after focused patch and structural diagnostics | 275 tests: **272 passed, 0 failed, 3 skipped** |
| `npm run supervisor:smoke` | Passed; real Temporal with fake browser activities, no ChatGPT send |
| First post-patch `--repeat 10` attempt | **4 passed, 5th failed** at `stage.connector: connector_missing`; 0 submissions; stopped at first failure |
| Second `--repeat 10` attempt (after diagnostic instrumentation) | **10/10 passed**; full drafts matched, 0 submissions, test tabs closed |
| Third `--repeat 10` attempt, immediately following | **10/10 passed**; 20 consecutive overall, 0 submissions, test tabs closed |
| Read-only exact B successor preview | `eligible=true`, `writes=false`, `receiptPresent=false`, `taskBindingPresent=false` |
| Sashai pilot artifact check | Task A `task-a.md` present; Task B `task-b.md` absent |

### Cause evidence and limitations

The initial failure previously ended with only `cdp_target_ready`. The patched diagnostics distinguish `composer_missing`, `connector_missing`, and selected-label hydration. Several successful attempts captured a transient expanded picker with zero visible connector choices, followed by a successful selection without reopening the picker. This supports a UI hydration delay as an observed transient state, **not proof of the original failure's sole root cause**.

The staging deadline is checked between operations. Individual existing CDP calls retain their own transport timeouts; the new readiness budgets do not yet guarantee instantaneous cancellation of an in-flight CDP operation. The later supervisor send-activity cancellation/deadline integration is a separate safety packet.

## Preserved evidence

All full logs are retained on this Mac, under:
`.state/verification-runs/p0-browser-readiness-20261016/`

- `baseline-nosend.log`
- `first-ten-stopped-at-fifth.log` (failure preserved, not counted as a pass)
- `consecutive-01-10.log`
- `consecutive-11-20.log`
- `npm-test.log`
- `temporal-fake-browser-smoke.log`

## B-only gate / required owner action

The exact recovery preview concerns failed dispatch `007175b7-99b6-4c66-9e73-2726f49986b4` for `sashai-flowdeck-probe-b-20261015`. It is **preview-only** and does not authorize successor issuance. Follow `docs/FLOWDECK-SUCCESSOR-INTEGRATION-FIX-2026-10-15.md`, beginning with another read-only preview and current-state revalidation. Obtain fresh explicit approval for **one named B-only successor generation** before any `--apply`, worker start, follower attachment, release or real Send. Never restart A, erase old claims or repeat an uncertain click.

**Operational status:** P0 no-send readiness gate met; live B-only completion unverified and blocked on owner authorization.

## Frozen tested source/build manifest — operational preflight

**Recorded:** 2026-10-15T19:50Z (Mac clock: 2026-10-16 00:50 +05:00).
**Full Git HEAD:** `203092cbc35d70d6aee8fd4580298635a0e44890`.
**Manifest type:** SHA-256 hashes of the **actual dirty/untracked working tree**, not hashes of committed HEAD. Do not use `git diff` alone as the identity of the tested implementation.

| Source or runtime artifact | SHA-256 |
|---|---|
| `src/sashai-live-browser.ts` | `ce9db1411433d76bc5faafff6bde7cef7297c26faee750ae54439b420a8118bb` |
| `tests/sashai-live-browser.test.mjs` | `5ca2bda11c8a4a235af59e595e3f0df98bc395f3a1f2a4177783c5fbb4217544` |
| `scripts/flowdeck-browser-check.mjs` | `0607c98e133493e311bb63e671aff168abcf5d84cace1fd3f9a4de08cefe7473` |
| `src/sashai-dispatch-evidence.ts` | `65297d76cf0acbe5a5450949726484a45697f3694fd94158556285372d40244a` |
| `src/flowdeck-supervisor-activities.ts` | `c2c45224c4c99da8db55a958cfec1efcaa78645d51013c830895de742fc8bc5f` |
| `src/flowdeck-supervisor-workflow.ts` | `ac6da0150bc8c97158b90ebb97a4c8a64888d876dcac822369badc040de3187e` |
| `dist/sashai-live-browser.js` | `83ab93a6d679a6b99728e484f18b540d6c1fdf0d946a54a49504dbcb2a38b7e3` |
| `dist/sashai-dispatch-evidence.js` | `fc464bcb932931ae1b07f4eb8f5e6e6b582028bed7d892dc67c6e1739f239299` |
| `dist/flowdeck-supervisor-activities.js` | `0a4b2557de620029450a97ebdda7edcc8fe207b7cb91beff4d9531228c0e8be9` |
| `dist/flowdeck-supervisor-workflow.js` | `120f9679207e6e0c5141eae984ce08708df59d93d460e15065d4c7eb64aa29d3` |

The production worker at `scripts/flowdeck-supervisor.mjs worker` imports the above `dist/flowdeck-supervisor-activities.js` and `dist/flowdeck-supervisor-workflow.js`; the compiled activities transitively import the compiled browser adapter. The compiled browser artifact was written after the source modification. **No worker for the B successor has been started**; the manifest confirms what it would load if the files are unchanged. Before any authorized worker launch, compare all hashes, and halt on drift. The source files and compiled build must not be changed or rebuilt silently between the tested gate and the demonstration.

Existing P0 verification logs have SHA-256 `e47556abeb1be87410b6f4988ee0ea894904dcc047738a675be0c60234f11b4f` (`npm-test.log`), `96f611bd12433546f168dca85b9021f7bd26b200c66a0d6036fd6fdc6e1a3520` (consecutive checks 01–10), and `be905e788c2d5166939c56f32ec65d76f0189a8932ca7c0e741939ec4c7abc49` (checks 11–20). Preserve the failed five-attempt series separately; do not overwrite evidence.

## Final read-only operational preflight (2026-10-16 local)

| Gate | Result | Evidence / limit |
|---|---|---|
| Competing Flowdeck worker/follower/browser-check process | **No active Flowdeck sender found** | Read-only `ps` / `pgrep`; no Flowdeck worker, recovery or event-follower process identified. The only named Sashai watcher was `scripts/sashai-supervisor.mjs supervise forever`; its inspected source is oracle-only and contains no send operation. |
| Active Temporal executions | **No RUNNING executions returned** | Temporal visibility query `ExecutionStatus='Running'` returned 0 workflows. |
| Historical pilot workflow IDs | **3/3 COMPLETED** | Base pilot, `indent-recovery-20261015`, and `probe-b-recovery-20261015` listed by Temporal. The last two are business `needs_attention` but **not** running/suspended executions. |
| Intended successor workflow | **Absent** | `workflow-status sashai-probe-pilot --attempt probe-b-successor-20261015-02` returned `exists=false`. |
| Exact B predecessor journal | **Only pre-click phases** | Failed dispatch `007175b7-99b6-4c66-9e73-2726f49986b4` has `claimed → preparing → pre_send_failed`. No `click_attempted`, `submitted`, or `reconciled`; successor lineage validator also inspected ancestor/sibling phases and rejected forks in the read-only preview. |
| Exact B successor recovery | **eligible=true; writes=false** | Repeated actual `flowdeck-reconcile-send.mjs ... --successor-recovery` preview with exact event/phase hashes and recorded audit attempt. `receiptPresent=false`, `taskBindingPresent=false`; no successor slot exists. |
| Existing historical recovery request | **Preserved, already consumed** | One `resume-*.json` found in `send-recovery`, for the previous standard B recovery of `legacy-b-stage-126`. Its authorization is consumed. It is **not** a new successor request. Zero recovery release-intent files were found. |
| Enrollment, plan and worktree | **Verified by production loader** | `dist/flowdeck-projects.js` accepted the live approved plan, active worktree markers and exact Sashai Project URL. Both approved Task IDs match unique unchecked plan tasks; B is independent with no dependencies or review-before-next gate. |
| Approved B instruction identity | **SHA-256 recorded** | `82e1f18adbc6da33592da990e97381f84a1ddd232ab93647dec1f61e4f8e3d86`; enrollment fingerprint `d13131849dc13e208695638836bbdcecc1f6a6969ef5fca0f857af85efcff106`. These are content fingerprints, not additional authority. |
| Artifact preservation | **A present / B absent** | Approved probe worktree `task-a.md` SHA-256: `5bbda057e2af8c98c5fd865d6ca646bd2f48b3f1f3788598703987fa62798a4f`. The expected `task-b.md` does not exist. |
| Runtime build | **Matches recorded tested build** | Hashes of source and the compiled `dist` files captured above. The worker has not been launched, so this verifies the available build, **not** a running worker's loaded module state. |

### Operator decision / remaining limitation

The narrow P0 browser-readiness gate and this single-host read-only preflight are satisfied. For the shortest MVP path, the recommended **next** stage is **one explicitly owner-approved, attended B-only successor demonstration**, rather than a new browser rewrite or dashboard work. This recommendation does not issue an authorization or allow unattended operation.

**Cancellation/deadline hardening remains outstanding:** Temporal activity timeout is not proof a JavaScript call stopped; a timed-out or cancelled operation may still approach a browser side effect. No test here establishes universal cancellation of in-flight CDP operations. Verify no competing or lingering sender again immediately before issuance and release, hold attendance throughout, retain the durable pre-click claim and click intent barriers, and stop/reconcile after any uncertain send or timeout. Implement and test cancellation propagation before claiming unattended production readiness.

**Stop boundary:** Do not run `--apply`, `--approve-successor-recovery`, start a worker/follower or successor execution, or release a send until the owner grants fresh **explicit one-generation B-only approval**. After approval, revalidate all gates/hashes and use only the existing successor runbook. Task A must never be resent; preserve old claims and histories, and do not infer independent review approval from `implementation_done`.
