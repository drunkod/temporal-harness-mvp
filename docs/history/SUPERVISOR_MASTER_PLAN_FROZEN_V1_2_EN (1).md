# Autonomous ChatGPT Project Supervisor
## Immutable Product Master Plan — Version 1.2 (One-Day Automation Focus)

**Date:** October 15, 2026  
**Status:** Proposed successor to v1.1; v1.0 and v1.1 are preserved unchanged.  
**Purpose:** Fix the desired product behavior without imposing a code-review or comprehensive acceptance platform on the supervisor.

### Fixed product goal

The owner opens an existing ChatGPT.com Project, selects Remote Desktop Commander, writes and submits a task once, and leaves. The supervisor adopts that conversation without resending the task; it tracks work sessions, continues unfinished work in the **same chat**, and, when the task is reported finished, records its implementation status and starts the next **already approved** task in a **new chat inside the same ChatGPT Project**. It can repeat across enabled projects. **Code review and quality assessment are owned by separate systems, not this supervisor.**

### Required high-level flow

1. **Manual start.** Owner opens a chat inside a ChatGPT Project, selects Remote Desktop Commander, submits a task.
2. **Start trigger.** The customized Desktop Commander emits its existing MacBook `work_started` notification. The supervisor consumes the corresponding machine-readable start event (to be connected) and attaches to the owner's active project chat **without re-sending** the prompt.
3. **Observe.** The supervisor waits while Desktop Commander/ChatGPT is working, tracking only the minimum project, chat, and session identity required to avoid interfering with other work.
4. **Finish trigger.** The connector emits `work_finished`. This means the **work session**, not necessarily the task, ended. The supervisor reads the ChatGPT response or current task checkpoint.
5. **Continue or advance.** If work remains, send a clear continuation **in the same chat** with Desktop Commander selected. If the task's implementation is reported finished, record `implementation_done / review_pending` (or the repository's equivalent) and hand review to the separate review system; do not run a new code-review pipeline inside the supervisor.
6. **Next task.** Look up the next eligible **approved** task according to the repository's own task-routing instructions, create a new chat **inside the same ChatGPT Project**, select Desktop Commander, and submit the next task once.
7. **Repeat or pause.** Keep going without ordinary per-turn owner input. Pause the affected project only when the destination/approval is unclear, a send may already have happened, or the session is stuck.

### Minimal rules that remain non-negotiable

- Never duplicate a possibly submitted ChatGPT message.
- Do not confuse a Desktop Commander end-of-session notification with task completion.
- Preserve correct project/chat routing and avoid touching unrelated personal tabs or drafts.
- Use only tasks already authorized by the owner's repository workflow. A deferred idea is not automatically an approved task.
- Keep implementation completion distinct from external code-review approval; do not label unreviewed code as reviewed.
- Keep the existing stack: **Temporal** for the minimal durable loop, **Oracle + authenticated Helium Profile 4** for browser work, **Remote Desktop Commander** for MacBook operations, **Flowdeck** optionally for visibility. **Repo Harness** remains outside the active runtime.

### Out of scope for the one-day automation MVP

Independent code review, exhaustive artifact acceptance, extensive connector-forensics, new SQLite migration, additional agent frameworks, multi-project fairness optimization, and production-grade observability. Those may be implemented by other systems or scheduled later. Do not remove existing safety code simply to make the demo pass.

### One-day MVP acceptance demonstration

On one enabled, explicitly approved test project with two small tasks:

- The owner sends the first message once; the supervisor adopts it without resending.
- Desktop Commander's start/end hooks are consumed as work-session triggers.
- An unfinished response causes exactly one correct same-chat continuation.
- A finished implementation creates a review-pending status without a local code review.
- The next approved task opens in a **new chat inside the same project** with Desktop Commander selected and is sent once.
- When there is uncertainty about where to send, whether a send occurred, or whether the task is approved, the supervisor pauses rather than guessing.

A full cycle is the target for one focused workday, **not an assertion that these capabilities are already implemented or guaranteed to be finished in one day**. If the new-project-chat handoff cannot be made reliable during the timebox, report that as the remaining blocker and keep the demonstrated partial cycle usable.

### Evidence baseline and version policy

The October 15 source snapshot records **141 passing tests, 2 skipped**, historical browser adoption and same-chat continuation, and a fixture-tested new Temporal adapter. It does **not** demonstrate the full new live autonomous cycle. The owner's customized MacBook work-start and work-finish notifications are reported existing behavior; machine-readable supervision of those events is a new integration task.

Versions v1.0 and v1.1 remain historical immutable records. This v1.2 changes **product responsibilities** (automation versus external review), not the promise to use existing ChatGPT Projects. Working tasks/timeboxes belong in the editable execution plan below.
