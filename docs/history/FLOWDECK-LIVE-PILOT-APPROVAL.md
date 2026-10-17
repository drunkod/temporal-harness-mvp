# Flowdeck live two-task pilot — approval request

Prepared 2026-10-15 for the October 16 target. **PROPOSED / NOT APPROVED / NOT ENROLLED / NOT DISPATCHED.** Approval of this document authorizes only the two documentation tasks and the listed isolated setup, not Sashai product implementation.

## Scope requiring one owner approval

- Source repository: `/Users/test/Documents/work/sashai`.
- Proposed isolated detached execution worktree: `/Users/test/Documents/work/sashai-flowdeck-pilot`, based on `7d2cc6818afe837119e0c171928506b1c4967269`. No branch, commit, merge, deployment, package installation or changes to the existing dirty Sashai worktree.
- Same existing ChatGPT Project: `https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project`.
- After approval only: create that worktree, read its AGENTS/policy/context routing, create `plans/plan-flowdeck-pilot-2026-10-16.md`, and select it with its own `.ai/harness/active-plan` and `.ai/harness/active-worktree` markers. Do not change the original worktree's markers. The worktree owner marker resolves to the new worktree itself.
- Plan status becomes `Approved` only after owner approval. Its exact task breakdown rows are the titles below, initially unchecked. Connector instructions forbid editing the plan/markers; Flowdeck records implementation status and leaves review pending. Checklist reconciliation is deferred until the pilot ends because enrollment currently requires both exact titles to remain unchecked throughout the cycle.
- After approval: populate main MVP `.state/flowdeck-supervisor/projects.json` with project ID `sashai`, initial task A, both exact instructions below, no dependencies, no review-before-next requirement, isolated repo path, existing project URL and confirmed owner/device scope. No other tasks enrolled.
- Owner then manually submits A once only after the launcher prints readiness. Supervisor is authorized to send one normal A continuation and one B initial instruction, without ordinary per-turn approval. Any uncertain send pauses; no retry authorization is implied.
- Both artifacts are implementation reports, not independently reviewed results. No automated code-review lane.

## Pilot Task A

**ID:** `sashai-flowdeck-pilot-a-20261016`  
**Exact title:** `Flowdeck pilot A: two-turn documentation checkpoint`  
**Only output:** `/Users/test/Documents/work/sashai-flowdeck-pilot/docs/flowdeck-pilot-2026-10-16/task-a.md`

**Exact instruction (also the owner's initial manual prompt):**

```text
Task ID: sashai-flowdeck-pilot-a-20261016
Worktree: /Users/test/Documents/work/sashai-flowdeck-pilot
Use Remote Desktop Commander on my MacBook. Follow this worktree's AGENTS.md and selected active plan. This is an approved documentation-only Flowdeck pilot, not product implementation or code review.

At the start of this turn, before file work, call Remote Desktop Commander begin_work with a fresh UUID requestKey, identify this task and worktree, and retain the returned workId. Each later continuation must begin a NEW work session and use its new workId. Use the actual installed tool schema; do not simulate tool calls.

Write only docs/flowdeck-pilot-2026-10-16/task-a.md in this worktree. Do not change code, dependencies, Git history, authority markers, or the plan checklist. Do not select another task.

Stage 1, on the initial turn: create the Markdown file with heading "Flowdeck Pilot A", the exact task ID, a "Checkpoint" section stating that stage 1 is done and stage 2 remains, and a "Remaining work" section requesting the final completion section. Intentionally stop after this checkpoint; do not perform stage 2 in the initial turn. Call finish_work once using this turn's workId, outcome partial, a factual checkpoint summary and this worktree as workingDirectory. Finish the answer with exactly this last line:
FLOWDECK_STATUS: continue

Stage 2, only when instructed to continue in this same conversation: read the existing checkpoint, preserve it, and append a "Completion" section stating that the second supervised turn completed the documentation task and that external review is still pending. Do not repeat stage 1. Call finish_work once using the NEW turn's workId, outcome success, a factual summary and this worktree as workingDirectory. Finish the answer with exactly this last line:
FLOWDECK_STATUS: implementation_done

If a required hook or the approved worktree is unavailable, do not silently work elsewhere. Report the blocker with final line FLOWDECK_STATUS: needs_attention.
```

## Pilot Task B

**ID:** `sashai-flowdeck-pilot-b-20261016`  
**Exact title:** `Flowdeck pilot B: independent status glossary`  
**Only output:** `/Users/test/Documents/work/sashai-flowdeck-pilot/docs/flowdeck-pilot-2026-10-16/task-b.md`  
**Dependencies:** none; does not read or depend on Task A's artifact.

**Exact approved-task instruction, sent by Flowdeck in a new chat:**

```text
Task ID: sashai-flowdeck-pilot-b-20261016
Worktree: /Users/test/Documents/work/sashai-flowdeck-pilot
Use Remote Desktop Commander on my MacBook. Follow this worktree's AGENTS.md and selected active plan. This independent documentation-only Flowdeck pilot does not depend on Task A and does not authorize product implementation or code review.

At the start of this turn, before file work, call Remote Desktop Commander begin_work with a fresh UUID requestKey, identify this task and worktree, and retain the returned workId. Use the actual installed tool schema; do not simulate tool calls.

Create only docs/flowdeck-pilot-2026-10-16/task-b.md in this worktree. Include heading "Flowdeck Pilot B", the exact task ID, and three short definitions: a work session ended is not necessarily task completion; implementation_done means implementation was reported finished; review_pending means a separate review system has not approved it. Do not read or modify Task A's artifact. Do not change code, dependencies, Git history, authority markers or the plan checklist, and do not select another task.

Call finish_work once with the returned workId, outcome success, a factual summary and this worktree as workingDirectory. Finish the answer with exactly this last line:
FLOWDECK_STATUS: implementation_done

If a required hook or the approved worktree is unavailable, do not silently work elsewhere. Report the blocker with final line FLOWDECK_STATUS: needs_attention.
```

## Approval reply

“Approve the two pilot tasks and isolated setup in FLOWDECK-LIVE-PILOT-APPROVAL.md.”

After approval I will establish the scope, validate enrollment, start components in order, and ask the owner to submit A once. **Do not submit A now**: there is no approved enrollment or ready follower yet.

## One copy-paste launch sequence — after approval and enrollment only

```sh
cd /Users/test/Documents/work/temporal-harness-mvp
npm run build && node scripts/flowdeck-launch.mjs sashai /Users/test/Documents/work/temporal-harness-mvp/.state/flowdeck-supervisor/pilot-events.json
```

The setup step after approval will create `pilot-events.json` using the installed plugin path, ledger path, rechecked owner/device, workflow ID `flowdeck-supervisor-sashai`, and private inbox `.state/flowdeck-supervisor/event-inbox`. It is deliberately not created/enrolled before approval.

Leave this foreground launcher running. It validates enrollment first, starts the worker, starts the workflow once, confirms the workflow is waiting for manual start, then starts the follower. It prints `ALL COMPONENTS READY MANUAL START NOW` only after the follower's initial snapshot/live drain and pending-delivery check complete. Until then do not submit a test message. An existing workflow, failed preflight or 30-second startup deadline blocks launch; never delete claims to relaunch. Ctrl-C stops the worker/follower but leaves the durable workflow for explicit inspection.

## Limits for this short demonstration

- Whole workflow: four hours from start. Start shortly before the owner is ready, not overnight in advance. No automatic restart after timeout.
- Waiting for the next live work-session event: 30 minutes. Missing hook/event pauses the project rather than continuing without it.
- Adoption: at most 20 observations, 500 ms intervals, 10-second deadline checked between observations; an in-flight browser read may add latency. Already-finished intended chat, multiple running chats or wrong binding pauses. Never resend the manual instruction.
- Final answer after `work_reported`: at most 60 reads with two-second sleeps, plus a three-minute elapsed scheduling budget. A final in-flight activity has the existing two-minute timeout, so the upper bound can approach five minutes rather than an exact two minutes.
- Browser side-effect activity: two-minute timeout and one activity attempt. Claim files stay sealed after uncertainty. Post-send hydration uses at most 20 observations at 250 ms spacing.
- Continuation budget: six per task; the planned healthy run uses exactly one for A and none for B. It is not an indefinite autonomous loop.

## Required live evidence — still pending

Record the Temporal workflow/run ID, both actual conversation URLs, the three work sessions' start/report event IDs, task-state transitions and actual send receipts. Expected healthy counts: owner A initial send 1; supervisor A continuation 1; supervisor B initial send 1; no duplicate submissions; A/B each implementation_done/review_pending. No turn is counted as a real MCP run without actual lifecycle events. Current no-send transport checks and fake-activity Temporal smoke do not satisfy this evidence gate.
