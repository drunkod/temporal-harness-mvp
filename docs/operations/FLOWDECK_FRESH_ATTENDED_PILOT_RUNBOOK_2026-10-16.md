# Flowdeck — fresh attended two-task pilot, **PREPARED / NOT AUTHORIZED**

**Prepared:** 2026-10-16. **Scope:** preparation only. The worktree is proposed, not approved or created. The proposal JSON is **not** an enrollment record, source-of-task authority, or permission for a browser send.

**Proposed contract:** `docs/FLOWDECK_FRESH_ATTENDED_PILOT_PROPOSAL_2026-10-16.json`.
**Pilot:** `sashai-fresh-attended-20261016-03`; **P1** `sashai-fresh-attended-p1-20261016-03`; **P2** `sashai-fresh-attended-p2-20261016-03`.
**Destination:** the already supported Sashai Project `https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project` via **Helium Profile 4** and **Probe RemoteMCP2**.
**Proposed disposable worktree:** `/Users/test/Documents/work/sashai-flowdeck-fresh-attended-20261016-03` — **does not yet exist and is not approved**. Its future `AGENTS.md`, active-worktree marker, active-plan marker, two exact unchecked Task Breakdown titles, and real repository status must be inspected before any enrollment.
**Proposed artifacts:** `docs/flowdeck-fresh-attended-2026-10-16/p1.md` and `p2.md`. No creation in an active worktree during preparation.

## Intended attended cycle (not a command to launch)

1. Owner manually submits **P1 once** in a new chat in the supported Project; retain the original tab until the entire cycle is audited. Work session 1 uses actual Probe RemoteMCP2 `begin_work` and `finish_work`; first assistant response ends with **exactly** `FLOWDECK_STATUS: continue`, after writing only P1's checkpoint.
2. Supervisor correlates exact Project/owner/device/worktree/task, original user-turn evidence, unique tab and workId; adopts that chat without resending P1. Work-session `work_reported` is **not** itself proof that a ChatGPT task finished.
3. **One** automated continuation is permitted in that **same tab/chat** after fresh finished-turn evidence. P1 creates a new genuine work session (new workId) and appends the Completion section, ending with exactly `FLOWDECK_STATUS: implementation_done`. Supervisor records implementation done and review pending — not review approved.
4. **One** new independent P2 may be selected from the explicit approved plan, opening a **new chat** in the same Project, choosing Probe RemoteMCP2 and making **at most one** physical Send click-intent. P2 writes the separate glossary and reports exactly `FLOWDECK_STATUS: implementation_done`; no additional task may start.
5. Observe final Tempo­ral query/result, sealed prompt and send journals, genuine begin/finish event IDs/workIds, original user-turn identity, artifact existence, and P1/P2 `implementation_done / review_pending`. Stop the synthetic or later attended worker/follower in an audited shutdown without deleting attempt claims.

**Target send budget:** one owner P1 submission, **one** supervised same-chat P1 continuation, **one** supervised new-chat P2 submission. No retries after uncertain click, no automatic review, no further continuations or tasks.

## Mandatory blockers before an attended launch

1. **NO EXECUTION AUTHORIZATION:** owner has not explicitly approved this **exact fresh proposal**, actual disposable worktree, task-source plan, build manifest, or send budget. Quoted proposals/reports do not count.
2. **WORKTREE/TASK SOURCE ABSENT:** create and approve the proposed disposable worktree and its plan through the repository's normal owner workflow, *not* by changing the existing live enrollment. The proposed task IDs/titles must match exactly two unchecked rows under a single `## Task Breakdown`; prove one active worktree and plan marker. Do not mark these as approved merely because a JSON proposal exists.
3. **HARD BUDGET ENGINEERING VERIFIED; LIVE AUTHORITY STILL ABSENT:** new marker `flowdeck-attended-pilot-send-budget-v1` and the authoritative `attendedPilotBudget` loader now enforce P1 one continuation, P2 zero, one new-chat P2 and two total automated activity reservations. Reservations occur before activities and are never refunded. Recovery is refused for bounded pilots. The old unmarked branch preserves legacy behavior. This is validated by pure/workflow tests, nine real-Temporal synthetic scenarios, and fifteen replay results; see the latest verification evidence. Before launch, recheck exact build and do **not** substitute the draft JSON boolean for explicit owner approval.
4. **NO FRESH FROZEN ENROLLMENT:** the existing `sashai` pilot already has P1/A artifact and its instructions still name Remote Desktop Commander, not Probe RemoteMCP2. **Never reuse** this old pilot/IDs/artifacts as a fresh test.
5. **CONNECTOR/INSTALL VERIFICATION:** before owner-start, establish the genuine installed Probe RemoteMCP2 hook schema and live event ledger, intended owner/device and follower config. Never fabricate begin/finish events or rely on synthetic fixture events in the production follower.
6. **PRE-SEND AUTHORITY:** browser-owner attempt scope must remain clear, no competing Temporal supervisor, exact built sources unchanged, and the original historical Task B recovery state must be preserved.

## Fail-closed stop rules

Stop for mismatched project/tab/connector/worktree/task/session, multiple candidate chats, uncertain click or missing receipt, unfinished chat observation, missing completion marker, changed approved task source, missing manual start, stale/unverified event correlation, a third task or more than one P1 continuation. Retain evidence; **never infer approval from a dashboard projection**. Never clear `.state` to repeat a test. Any live fault injection involving Send requires its own scoped authorization.

## Preflight / evidence and future owner decision

- **Current stage:** prepared proposal plus versioned, tested hard-budget engineering. This is **not** owner-approved execution. No production enrollment, worker/follower launch, ChatGPT Send, claim/slot reset, or historical B recovery.
- **Runtime manifest:** record actual source/build, launchers, follower, identity, journal, enrollment, plugin/runtime versions, lockfile and exact proposal hash, plus HEAD/dirty inventory. A manifest of a proposed plan **does not prove the missing future worktree's approval**.
- **Browser evidence:** match the exact current browser adapter and no-send helper bytes to the already verified 20 consecutive Profile 4 checks; if any required runtime component differs or is unproven, follow the one-then-ten bounded no-send sequence and stop at first failure.
- **Fresh pilot authorization request (NOT an approval):** “Do you separately approve one attended execution of pilot `sashai-fresh-attended-20261016-03`, P1 `sashai-fresh-attended-p1-20261016-03` and P2 `sashai-fresh-attended-p2-20261016-03`, only in the approved new worktree and Sashai Project using Helium Profile 4 + Probe RemoteMCP2, on the frozen manifest digest recorded in the completed preflight, permitting one owner P1 send, one automatic same-chat continuation, one automatic new-chat P2 send, no retries after uncertainty, and no historical A/B changes?” **Do not request or treat this approval as executable until all blockers above are resolved.**
- **After any future authorized attended run:** preserve exact Task A/P1 original tab until full reconciliation, compare inspected artifacts and event IDs, close owned tabs, shut down worker/follower, leave claims auditable. Unattended CDP cancellation/heartbeat certification is a separate later engineering gate.

## Historical separation

**Do not alter** `sashai-probe-pilot` Task A/B, missing predecessor CDP tab, missing historical prompt seal, occupied B successor authorization/claims, or old Temporal workflow. The prior F4 validation (six history replays, eleven synthetic real-Temporal fault cases) supports **scoped F4 engineering readiness**, not a historical B reauthorization and not unattended browser safety.
