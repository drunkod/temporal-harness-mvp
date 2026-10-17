# Sashai report: evidence hardening and Temporal restart proof

Date: 2026-10-15
Scope: The one approved **report-only** task. This report is about supervisor reliability, not new Sashai product work.
Repository: `/Users/test/Documents/work/temporal-harness-mvp`
Existing report acceptance: `verified_report` for `sashai-architecture-report-2026-10-15`.

## Review findings addressed

1. **Full browser composer identity before send:** `scripts/sashai-report-dispatch.mjs` and `scripts/sashai-report-fix.mjs` now compute the normalized **entire** expected payload (`Remote Desktop Commander` mention plus contract-derived text), validate it after staging, validate again before writing a send claim, and validate it a final time **in the DOM evaluation that clicks Send**. New attempts record `composerSha256`. The historical sent attempts were not changed or resent. Whitespace and Unicode normalization intentionally ignore presentation-only whitespace, not added instructions. A real browser interaction for these newly tightened branches remains to be tested in a separately approved future task.

2. **Tracked, staged and untracked contents:** `src/sashai-dispatch-evidence.ts` returns a versioned `snapshotSashaiTree()` fingerprint binding Git HEAD, porcelain status, **unstaged and staged binary diffs**, and actual file hashes for every Git-listed modified/staged/untracked non-ignored working-tree path. Symlink destinations are hashed without following them. Oversized evidence is rejected, not silently skipped. New prepared dispatch/correction attempts must record this v2 snapshot, and send refuses a mismatch. Fixture tests verify that untracked-content mutations undetectable to Git status/diff and staged-content mutations are detected. This is not a snapshot of every unchanged tracked or ignored file; unchanged committed files are bound via HEAD.

3. **Acceptance / contract / artifact binding:** `src/sashai-report-status.ts` checks that acceptance's task-contract hash matches **both** the persisted attempt and the currently existing contract before displaying `verified_report`. It also checks the report file SHA-256. The status exposes `historicalAcceptance`, `currentBindingValid`, and `evidenceScope`, so the historical report acceptance is not automatically treated as current after contract or artifact drift. Negative tests mutate each side of the contract identity without touching live state.

4. **Content validation limits:** The verifier still performs structural and source-file existence checks, not full semantic architectural proof or Mermaid parsing. `verified_report` means **this bounded report contract passed**, not that all architectural conclusions are independently established.

## Historical evidence versus new safeguards

The actual browser report was dispatched before the v2 working-tree fingerprint existed. Its immutable preflight record binds HEAD, Git status and **unstaged tracked diff only**. The verifier therefore reports `baselineEvidenceScope=legacy_git_status_and_unstaged_diff_only` and the dashboard preserves that label. Do **not** state that the full staged/untracked content baseline was captured on that historical dispatch. Current live SHA and dirty-file contents were examined separately, but cannot retroactively prove the historical baseline.

The original submission and corrective send records under ignored `.state/report-review-dispatch/` remain sealed with `SEND_ATTEMPTED` and `FIX_SEND_ATTEMPTED`. No new ChatGPT send was made during this reliability pass.

## Real Temporal worker-restart proof

A new, dedicated Temporal task queue, `oracle-sashai-report-review`, isolates the report pilot from the historical Repo Harness fixture queue. The Temporal workflow `sashaiReportLifecycle` calls **read-only** activities to inspect the previously persisted approval/send/correction claims and rerun the independent verifier with `--preview`. It has no activity that can click ChatGPT Send, apply an edit, select the next task, or write into Sashai. Workflow state always has `dispatchPermitted=false` and `nextTaskPermitted=false`.

Workflow ID: `sashai-report-review-8f64480c627c2605c58f`, Temporal run ID `01a13c3a-8208-714c-9bdf-e1558f9ea62b`.

Observed sequence:
- Started the workflow against the existing one-time report attempt. Status reached `waiting_for_durable_resume`, with original and corrective claims observed.
- Stopped only the dedicated report worker. Temporal still reported the workflow `RUNNING`. Querying detailed workflow state waited for a worker to return; `temporal workflow describe` remained available.
- Restarted the dedicated worker (same queue), queried the workflow again, and observed the **same** `waiting_for_durable_resume` state, task/chat binding and previously persisted claims.
- Sent the durable `resumeReportReview` signal. Workflow completed with `verified_approval_boundary`, `acceptance=verified_report`, no blockers, and **both** dispatch/next-task flags false.
- The report SHA-256 and Sashai Git revision and tracked status/diff remained unchanged. No duplicate browser submission or code task occurred.

This establishes **Temporal durability for adopting and re-verifying an existing report** and stopping at its approval boundary. It does **not** establish Temporal-driven browser submission, automated targeted correction after a new failure, generalized arbitrary-task workflows, or end-to-end unattended product implementation.

## Reproduction and next checkpoint

Read-only status:

```bash
cd ~/Documents/work/temporal-harness-mvp
node scripts/sashai-report-temporal.mjs status
npm test
node scripts/verify-sashai-browser-report.mjs --preview
```

The recorded workflow is already completed. The CLI intentionally refuses a second `start` for the same task/contract; do not reset or replay its browser send guards.

**Next bounded milestone** (requires a new approved disposable/report-only task): introduce activity interfaces and an idempotent journal for preparing a new connector-selected task; prove independent rejection of changed browser draft before any click; let Temporal observe a new pending review, request an explicitly bounded same-chat correction when a verifier fails, then reverify and stop. First test with a synthetic fixture and controlled browser smoke. Only after that, consider a separately approved Sashai implementation plan. Repo Harness remains excluded from the active chain.

No Sashai product source, Sashai services, active-plan/worktree authority markers, or existing research were modified. The supervisor's Flowdeck dashboard service was refreshed, and the dedicated Temporal report worker was started, restarted for the durability test, and stopped after its workflow completed.
