# One-Day Execution Plan — ChatGPT Project Supervisor MVP

**Date:** October 15, 2026  
**Reference:** Immutable Master Plan v1.2  
**Objective:** Show one owner-started ChatGPT Project task being autonomously observed, continued, and followed by the next approved project task. Code review is external.

| Timebox | Work | Visible pass condition |
|---|---|---|
| Hours 1–2 | Link the Desktop Commander `begin_work` / `finish_work` (or actual installed equivalent) notification hooks to simple local machine-readable `work_started` / `work_finished` events; retain project/chat/session identity where available. | One manual invocation produces the two events; no need to parse macOS notification banners. |
| Hours 2–3 | Attach the existing Oracle/Helium watcher to the active, owner-started project chat without submitting anything. | Supervisor records the correct project and chat while initial prompt appears only once. |
| Hours 3–5 | Implement the simple decision loop: running → wait; session ended + unfinished → same-chat follow-up; implementation done → status `review_pending`. | A deliberately unfinished task receives a relevant continuation in its original chat; no built-in code review is invoked. |
| Hours 5–7 | Read the next task from the repository's approved active task list; create a new chat within the same ChatGPT Project; select Desktop Commander; submit once. | Next approved task appears in a new in-project chat with the intended connector. |
| Hour 8 | Run one end-to-end demonstration and capture a concise status log, known limitations, and blockers. | Record actual observed steps and any failed/unproven ones without treating fixture passes as live results. |

**Reuse; do not rewrite:** existing Temporal, Oracle 0.21.5 browser adapter, Helium Profile 4, Desktop Commander notification hooks, passive observer, and current JSON claim log. Keep existing protections against duplicate sends and wrong destinations. No new orchestration engine, journal migration, generic agent framework, or separate acceptance subsystem during this timebox.

**External review boundary:** Mark coding effort as `implementation_done / review_pending` after a recognizable completion report. A separate review system owns approval, defects, merging, or release. If a repository prohibits starting dependent work before review, respect that dependency and schedule only another eligible independent task.

**Critical unknowns to test early:** Is the existing Desktop Commander notification produced at the local work hook (not merely a visual OS banner)? Can a manual chat be uniquely matched to its project with the current browser surface? Can the browser create a new chat inside that specific project and reselect Desktop Commander? If any answer is no, document the blocker and demonstrate the working subset rather than fabricating success.

**Not run:** This is a plan, not permission to dispatch ChatGPT messages, modify a live repository, or launch workers. No live execution is claimed.
