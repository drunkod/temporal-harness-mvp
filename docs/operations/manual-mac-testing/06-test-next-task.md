# 06 — Observe automatic P2 in a distinct chat

**Goal:** after eligible P1 completion, the supervisor starts the enrolled second task once. Continue the same run; do not launch P2 manually.

## Entry condition

P1 must have a recognized implementation-done result and the configured dependency/review rules must allow P2. If review is required before advancement, a blocked P2 is expected behavior. Record BLOCKED BY REVIEW rather than bypassing it or changing task dependencies mid-run.

## 1. Observe progression

In B:

```sh
node scripts/flowdeck-supervisor.mjs workflow-status "$PROJECT_ID"
```

Look for `starting_next_project_chat`, then a submitted-turn/work-start wait and P2 working state. Exact intermediate phases may be missed between polls.

## 2. Check P2's identity

In Helium, without creating or submitting another conversation yourself:

1. Find the automatically created P2 conversation.
2. Record its URL and tab ID.
3. Verify these identify a distinct conversation from P1.
4. Check the submitted instruction names the enrolled P2 task and correct worktree.
5. Confirm one initial user message, not duplicate attempts.
6. Check that status/source evidence binds a new P2 work ID to that chat.

Do not close P1 as part of this test. Keeping it available helps distinguish cross-chat mistakes.

## 3. Check budget and completion

The attended scenario allows one automatic P2 submission and zero P2 continuations. If P1 used one continuation, total automated submissions should be two; if it needed none, a smaller total can be valid. Count actual messages and per-stage evidence as well as the reported aggregate.

Let P2 finish. Do not manually request more work if it reports partial or needs attention. Query status and record the final answer marker and source outcome.

PASS next-task transition: exactly one P2 start in the intended distinct conversation with matching task/work/session evidence.

PASS P2 completion: recognized implementation-done result. A partial/failed P2 is a useful observed outcome but not successful completion of the two-task MVP.

## Troubleshooting

- P2 never starts: inspect P1's final marker/report, review dependency and remaining budget.
- P2 starts in P1's chat: FAIL; record tab/chat evidence and stop the launcher as described in 07.
- Another P2 user turn appears: investigate duplicate send versus an allowed operation; this attended scenario allows no P2 continuation.
- Browser has finished but workflow waits: follow the source/inbox/observation checks in 03.

Next: [07 — finish and unattended test](07-finish-and-unattended-test.md).
