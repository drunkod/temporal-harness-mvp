# Flowdeck Probe RemoteMCP2 — Live P0 incident and architect handoff

**Date:** 2026-10-15
**Main repository:** `/Users/test/Documents/work/temporal-harness-mvp`
**Isolated pilot worktree:** `/Users/test/Documents/work/sashai-flowdeck-probe-pilot`
**Scope:** Approved, documentation-only two-task Sashai Project pilot; no plugin changes, code review, or deployment.

## Ground-truth outcome

- Task A Stage 1 and its same-chat Stage 2 continuation **both executed** in the actual Sashai ChatGPT conversation. The second turn reported `finish_work(success)` and `FLOWDECK_STATUS: implementation_done`.
- The expected `## Completion` section exists in `docs/flowdeck-probe-pilot-2026-10-15/task-a.md`. This is assistant-reported implementation, **not external review**.
- Recovery Temporal workflow `flowdeck-supervisor-sashai-probe-pilot--indent-recovery-20261015` eventually marked Task A `implementation_done / review_pending`.
- Task B **was not submitted**. It is still `approved / not_started`; no `task-b.md` exists. The new owned Helium tab is on the correct Sashai Project URL with an empty composer.
- The recovery workflow ended `COMPLETED / needs_attention`: `Next-chat send may have occurred; reconcile without retrying.`
- All previous workflow histories, documents and original send claims were preserved. No blind resend was made.

## P0-1 — Recovery loses matching start when follower begins after the event

Stage 2 source ledger workId: `62370a89-634f-45ec-b169-6a19482a1826`.
The **actual installed RemoteMCP-Jazz `SqliteWorkEventReader.read()`**, using read-only SQLite, yielded:

- `work_started`: eventId `699901ae-2b31-417c-bc2b-c9648428bd32`, committed `2026-10-15T14:52:14.522Z`
- `work_reported`: eventId `08b0e37a-f1de-4b06-bdac-e36c3aa6f26a`, `outcome=success`, committed `2026-10-15T14:53:29.783Z`

The new recovery follower's inbox had the **finish** as delivered but lacked the start. The workflow remained `waiting_for_work_start` even though the Stage 2 chat answer and artifact were complete. This follows from the intended live-boundary policy: bootstrapping does **not** promote historical source events to actionable signals. A new attempt therefore needs a separate, explicit reconciliation path.

**Controlled recovery performed:** verified the exact source reader pair, matching owner/device, recorded delivered report, existing approved Task A/chat send claim, completed Stage 2 artifact, and running workflow phase. Signaled **only the preserved original start event** into the running Temporal workflow using the existing `supervisorWorkEvent` signal. Did not generate a synthetic event or send any ChatGPT message. The workflow then processed the buffered report and marked A `implementation_done / review_pending`.

**Architect fix:** add a minimal operator-scoped recovery command for **one explicitly selected approved task/workId/chat/attempt**, reading actual `origin:event` records from the existing plugin reader; check exact event IDs, source scope, approved worktree/task and last message; deduplicate against current inbox/workflow history; then restore the missing start/report relationship. Never turn arbitrary historical snapshots into new task triggers or replay unrelated sessions.

## P0-2 — New-chat pre-send DOM route race and sealed claim

When Flowdeck attempted Task B, the real Temporal `ActivityTaskFailed` history reported:

`Error: Original owned ChatGPT tab changed`

Stack: `Object.stage` in `dist/sashai-live-browser.js:109` → `send` in `dist/flowdeck-supervisor-activities.js:368`.

A new owned tab exists (CDP tab `46A840418E7A9B5A8A8A5616EACE7DF4`) at the exact configured Sashai Project, with an empty composer. WebMCP screenshot confirms this. No Task B chat or artifact was created.

For Task B's exact event/phase key:

- `send-event` claim: **exists**
- `send-phase` claim: **exists**
- `sent` receipt: **absent**
- `task` binding for B: **absent**

Thus, the failure occurred **before a verified send** but the claims still prevent a normal retry. Preserve these claims until a scoped, human-reviewed reconciliation proves no physical click happened.

**Small patch already made locally:** `src/sashai-live-browser.ts` now tolerates a transient `wrong-target` response from the Work-style DOM during the existing **bounded pre-send** composer/connector selection loops. The CDP tab ID, project URL, full composer hash and single-click checks remain unchanged. Persistent route drift still fails. Added a transient-route regression test to `tests/sashai-live-browser.test.mjs`.

**Architect fix:** distinguish durable phases `claimed / pre-send staging / staged / click-attempted / submitted / reconciled`, preserve exactly-once click constraints, and provide an explicit, evidenced method for retiring a proven pre-click failure without unlocking uncertain post-click sends. Improve operator status to include safe, redacted actual cause rather than only a generic uncertain-send message.

## Evidence and validation

- Read-only WebMCP Skill: `/Users/test/.codex/skills/webmcp-browser/SKILL.md`.
- WebMCP tool `chatgpt_read_chat` confirmed ordered original Task A and Stage 2 turns, including `FLOWDECK_STATUS: implementation_done`.
- Screenshot files under `.state/flowdeck-supervisor/pilot-screenshots/`:
  - `probe-task-a-after-pause.png`
  - `probe-task-a-followup.png`
  - `probe-task-b-empty-owned-tab.png`
- Automated build and full suite after local route patch: **245 passed, 2 skipped, 0 failed**, `npm run build` passed, `git diff --check` clean.
- Bounded live Helium Profile 4 **no-send** test: selected **Probe RemoteMCP2**, entire draft matched, **zero submissions**.
- No full autonomous A→B success can be claimed.

## Immediate next action

1. Review and test the small pre-send route patch; preserve existing dirty/uncommitted work and previous histories.
2. Implement and test the scoped missed-start-event recovery and proven pre-click claim reconciliation. Use synthetic Temporal/workflow tests and a real **no-send** Helium check.
3. Require explicit new named attempt and unchanged two-task authorization before resuming B; never resubmit A or clear claims wholesale.
4. Demonstrate B exactly once in a new chat with Probe RemoteMCP2, then verify real `begin_work`/`finish_work`, the task-b.md artifact and `review_pending` projection.

**Priority:** finish a working live two-task cycle, not Jazz embedding, new orchestration infrastructure, or deferred Deep Research.
