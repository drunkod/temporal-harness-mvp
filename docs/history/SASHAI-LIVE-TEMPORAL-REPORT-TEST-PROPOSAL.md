# Proposed fresh Temporal-controlled Sashai report test

Date: 2026-10-15
Original proposal status: PROPOSED when written. Owner approval was subsequently granted in this ChatGPT conversation on 2026-10-15 (reply: “approve”). See the separate approved task contract in `SASHAI-LIVE-TEMPORAL-REPORT-TASK.md`. Approval does not establish dispatcher readiness or prove that a live browser task was submitted.
Runtime: Oracle-only browser integration with a connector-preserving UI adapter; Repo Harness remains excluded.
No Sashai product implementation or plan activation is included.

## Objective

Prove that Temporal initiates a fresh Remote Desktop Commander-selected report turn, observes its result, receives an independent acceptance failure, issues one scoped corrective instruction in the same Sashai conversation and independently verifies the final report.

Existing synthetic and historical report proofs are not substitutes for this browser test. Do not reuse their task IDs, output paths, send/correction guards or acceptance files.

## Proposed Task and Output

Task ID: sashai-task-routing-report-live-v1.
Target source: /Users/test/Documents/work/sashai, read-only.
Target project: the existing Sashai ChatGPT project.
Output: /Users/test/Documents/work/temporal-harness-mvp/docs/SASHAI-BROWSER-TASK-ROUTING-REVIEW-2026-10-15.md.
Output must not already exist; never overwrite the accepted architecture report.

Report content:
- Actual inspected HEAD and task/attempt marker.
- AGENTS.md, policy and active-plan/worktree marker findings.
- Roles of the active plan Task Breakdown, tasks/current.md and tasks/todos.md.
- Explicit source-backed evidence index and validation limits.
- Current readiness to select work, without creating authority markers or promoting deferred goals.

## Controlled Acceptance Correction

Disclose the test design in the approved contract: the initial turn asks for the routing findings and validation limits, but deliberately defers the separately required Evidence Index section. The independent final-contract verifier should return exactly evidence_index_missing when all other checks pass.

Temporal may request ONE correction: add only the missing source evidence index to the same report, using the same Sashai conversation and Desktop Commander connector. The correction must not alter source facts merely to satisfy a check. The final verifier requires actual source references and reports remaining failures rather than treating section text alone as semantic proof.

If any unexpected criterion fails, identity changes, report content drifts outside the permitted correction, or submission is uncertain, stop and reconcile; do not send the planned correction unconditionally.

## Required Implementation Before Approval/Dispatch

- Generalize the one-off report sender behind task-specific structured contracts, preserving full composer equality and connector selection at click time. Retain a non-submitting preview.
- New workflow input includes the explicit contract approval, task ID, unique attempt ID, output path and source snapshot, with durable per-attempt claims.
- Prepare/submit/observe/verify/correct/reverify are Temporal-controlled activities, not manual script sends attributed to Temporal afterward.
- No activity retry may replay a potentially submitted prompt. A lost response leads to persisted-claim reconciliation.
- Use stable chat identity and a verified source binding; capture the task marker if visible and explicitly qualify any weaker binding.
- Keep execution permission for this single report separate from permission to dispatch arbitrary Sashai tasks.
- Recheck persisted attempt and artifact revision immediately before correction, as now required by the synthetic adapter.

## Acceptance

- A fresh approved attempt and project-scoped conversation are recorded.
- Original and corrective Remote Desktop Commander invocations have independently observed execution evidence.
- Initial rejection contains the expected bounded missing criterion and no identity/source failures.
- Correction occurs at most once in the SAME conversation, with matched failed-artifact identity.
- Final report passes content and source-reference checks and has a recorded artifact hash.
- Sashai's HEAD and versioned dirty/index/content baseline remain unchanged within the recorded evidence scope.
- Temporal ends at verified_approval_boundary with no next-task authority.
- Any uncertain send blocks without replay; actual website/tool cancellation is not inferred from stopping the worker.

## Explicit Non-goals

No Sashai source/docs/dependencies/configuration edits, active markers, Git commits/pushes/fetches, application/service changes, product milestone selection, broad autonomous task queue or repeated live test sends. Writing the new approved MVP report is the only connector-mediated filesystem change. Local supervised attempt/journal/receipt artifacts are allowed once approved.

## Readiness Review — 2026-10-15

Current baseline commit 2ac5cae passed 51 tests with two historical-browser skips. Subsequent local hardening adds a persisted-attempt recheck before synthetic correction and four isolated fixture tests; 55 passed, two skipped. These are local regression proofs, not live-send approval.

The proposed live test remains gated on implementing the fresh task-bound transport and owner approval of this exact limited scope. No browser prompt was submitted while preparing this proposal.
