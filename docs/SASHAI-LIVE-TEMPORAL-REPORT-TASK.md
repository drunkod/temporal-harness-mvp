# Approved one-off Sashai task-routing report — live Temporal pilot

Approval: APPROVED, report-only, by the owner replying "approve" to the specific `SASHAI-LIVE-TEMPORAL-REPORT-TEST-PROPOSAL.md` proposal on 2026-10-15.
Scope: ONE initial connector-selected ChatGPT project turn, ONE conditional same-conversation correction of a known Evidence Index omission. No other sends or automatic retries.
Task ID: `sashai-task-routing-report-live-v1`
Project: `dr/sashai` — `g-p-6ab28bdd7fbc8191b581316ff09da79d`
Read-only source: `/Users/test/Documents/work/sashai`
Expected Sashai HEAD at approval: `7d2cc6818afe837119e0c171928506b1c4967269`
Authorized connector-created output ONLY: `/Users/test/Documents/work/temporal-harness-mvp/docs/SASHAI-BROWSER-TASK-ROUTING-REVIEW-2026-10-15.md`

## Exact initial report requirements

Read `AGENTS.md`, `.ai/harness/policy.json`, the presence or absence of `.ai/harness/active-plan` and `.ai/harness/active-worktree`, `tasks/current.md` and `tasks/todos.md`. Identify the HEAD and task/attempt ID. Explain how an approved active plan's `## Task Breakdown` differs from the derived current snapshot and deferred to-dos, and whether any implementation task is selected. Include source paths, conclusions supported by observed content, and a Validation and Limits section. Do not invent or activate a plan, run Codex, change a Sashai file, or edit repository metadata.

## Controlled correction

The first turn intentionally omits the **Evidence Index** heading. This is a disclosed acceptance exercise; all substantive findings and source paths should already be present. The independent verifier must reject only with `evidence_index_missing` when every other requirement passes.

Only then may Temporal permit exactly ONE same-project, same-conversation, connector-selected correction: add `## Evidence Index` listing actual inspected repository source paths and which finding each supports. Preserve the original report content and replace nothing else. Do not submit another task, change Sashai, or alter original evidence.

## Safety and acceptance

Fresh UUID attempt and dedicated, immutable write-ahead send/correction guards; full normalized composer text equality at click; independent Git HEAD + version-2 dirty/index/content fingerprint before send, correction and final acceptance; exact contract/attempt/chat/artifact identity across Temporal waits and receipts; observable connector use. Unknown send outcomes block for reconciliation with no retries. Exact output path must not exist before preparation.

After final acceptance, stop at `verified_approval_boundary`. `dispatchPermitted=false` and `nextTaskPermitted=false` for all stages, including success. No Sashai implementation work, active-plan/worktree marker, service change, repository commit/push or unrelated file modification is approved.

The original proposal remains an audit trail of the planned test. This document is the **approved, fixed-scope dispatch contract** for this one fresh attempt.

Execution status as of this approval pass: **NOT DISPATCHED**. The live Temporal sender remains incomplete and has not passed its installation gate. No attempt ID, send claim, ChatGPT conversation, or report has been created for this task. Approval must not be treated as evidence of execution; resume only after the adapter builds and passes preflight tests.
