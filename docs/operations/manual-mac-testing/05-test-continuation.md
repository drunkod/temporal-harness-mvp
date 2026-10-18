# 05 — Observe one automatic P1 continuation

**Goal:** after a genuine partial P1 result, the existing attended supervisor sends one continuation in the SAME conversation. This is an observation checkpoint in the run started in 01, not a new launch.

## Entry condition

The first P1 answer/report genuinely indicates unfinished work and `FLOWDECK_STATUS: continue`. If P1 completed immediately, record NOT EXERCISED. Do not edit the answer, manufacture a partial report, or type “continue” yourself. A repeatable continuation scenario requires the programmer to enroll an appropriate controlled task for a future fresh test.

## 1. Observe the transition

In B:

```sh
node scripts/flowdeck-supervisor.mjs workflow-status "$PROJECT_ID"
```

Repeat while observing P1. Possible phases include `sending_continuation`, `waiting_for_submitted_turn`, `waiting_for_work_start`, `working` and `waiting_for_chat_response`. These phases can pass faster than your polling.

## 2. Check the browser and binding

Record:

- Original P1 chat URL/tab ID.
- Continued P1 chat URL/tab ID: both must be unchanged.
- One additional user turn, not two repeated prompts.
- Same task ID/worktree.
- New work session ID for the continuation; each supervised turn should call `begin_work` anew.
- Automated submission usage from status.

The attended scenario allows at most one automatic P1 continuation. Its manual initial Send is not included in that automated counter. If P2 has already started by the time you poll, total automated usage may already include P2; do not infer a duplicate continuation from the total alone.

## 3. Observe the continued result

Do not provide another manual continuation. Wait for the finished answer and matching report, then query status again.

PASS: one automatic continuation, correct same conversation/task, distinct session, and a recognized result. Record whether P1 completed or paused. A correctly enforced exhausted budget is not proof the task completed.

FAIL: repeated continuation clicks, new chat for P1, reused/wrong session, wrong task, or unresolved dispatch claimed as success. Record the first discrepancy and use the stop procedure in 07.

## Troubleshooting

- Finished answer but no new Send: inspect status `blocker`, review dependencies and budget. Do not assume the supervisor is stuck merely because it refuses an invalid transition.
- Visible new message but status waiting: capture chat, source and inbox evidence using 03; do not click again.
- P1 still partial after its allowed continuation: record a bounded incomplete result. Do not enlarge the budget during the test.

Next: [06](06-test-next-task.md), which may already be progressing automatically.
