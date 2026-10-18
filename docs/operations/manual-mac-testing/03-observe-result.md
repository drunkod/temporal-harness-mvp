# 03 — Observe task adoption and the first result

**Goal:** prove the application observes the work it started, not just a successful browser click. Continue the SAME run from 02; do not launch another workflow.

## 1. Watch without intervening

Leave A and the browser open. In B, repeat this read-only command every 10–15 seconds while the agent starts:

```sh
node scripts/flowdeck-supervisor.mjs workflow-status "$PROJECT_ID"
```

Expected progression may include `pending_adoption`, `working` and `waiting_for_chat_response`. Short-lived phases can be missed between polls; that is not itself a failure.

Record the first populated `taskId`, `workId`, `chatUrl`, and `tabId`. They must refer to P1 and the prepared conversation. A populated `workId` establishes a work-session binding, not proof of completion.

If after about two minutes there is no adoption, use this as a diagnostic checkpoint, not permission to resend:

```sh
node scripts/flowdeck-work-events.mjs status --config "$EVENT_CONFIG"
node scripts/flowdeck-work-events.mjs once --config "$EVENT_CONFIG"
```

`status` reads the inbox; `once` reads a source head/snapshot page. Look for matching work IDs and delivery failures. These commands do not repair or signal the run. A snapshot alone is not proof that the corresponding live event was delivered. Save the A output as well.

## 2. Wait for the first actual response

Observe the final assistant answer in P1. Its last line should be exactly one supported marker:

```text
FLOWDECK_STATUS: continue
FLOWDECK_STATUS: implementation_done
FLOWDECK_STATUS: needs_attention
```

Only one marker should appear as the final line. A connector/tool log or a partial streamed answer is not the final answer. The enrolled prompt instructs the agent to report through `finish_work`; the browser marker and source report must agree sufficiently for the supervisor to act.

Do not manually type “continue,” send P2 or edit the plan during this run. The supervisor may already be acting on the first report.

## 3. Classify the result

- **PASS adoption:** P1 has the correct bound task/work/chat/tab.
- **PASS result observation:** the actual answer finishes and the supervisor recognizes its report/decision.
- **Continue requested:** proceed to [05](05-test-continuation.md).
- **P1 done immediately:** continuation is NOT EXERCISED, not passed; observe [06](06-test-next-task.md).
- **Needs attention/paused:** record `blocker` and the final response. This is a completed diagnostic outcome, not successful task completion.

## Diagnose only the failing boundary

| Symptom | Likely boundary to investigate |
|---|---|
| Browser working, no source session | Connector `begin_work`/source integration |
| Source event exists, inbox does not reflect it | Follower/checkpoint/delivery |
| Inbox has event, adoption remains pending | Prompt seal/task/worktree/chat binding |
| Browser answer complete, no report | `finish_work` reporting |
| Report exists, supervisor waits | Browser observation/marker/session reconciliation |

These are hypotheses, not confirmed diagnoses. Give the programmer the exact source/inbox/status outputs. Do not reset checkpoints or synthesize a work event to make the stage green.
