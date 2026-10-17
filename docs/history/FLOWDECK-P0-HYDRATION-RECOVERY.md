# Flowdeck P0 — delayed hydration and pilot recovery

Date: 2026-10-15. Reliability patch, not an architectural redesign. **Live recovery is proposed and has not been authorized or executed.** Jazz, RemoteMCP-Jazz execution, authentication and external-review boundaries are unchanged.

## Actual failure confirmed read-only

- Original workflow: `flowdeck-supervisor-sashai`, COMPLETED with `needs_attention`.
- Conversation: `https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6ad0cbed-8560-83ed-ad0c-7c12f1037d04`.
- Work session: `4cb52bbf-7566-42fa-aa70-f430ac251afb`.
- Start event: `fb4ff091-04e9-425e-be90-924c0b4dca7f`, delivered to old workflow once.
- Report event: `2d367526-6d72-425d-a171-029464e55931`, preserved in the original inbox as pending; historical attempt count observed: 212.
- Pilot enrollment exists for `/Users/test/Documents/work/sashai-flowdeck-pilot` and both approved pilot task IDs. The original Sashai worktree remains separate.
- Checkpoint: `docs/flowdeck-pilot-2026-10-16/task-a.md` in that pilot worktree. Observed SHA-256: `e85f07866273a3366588d2446f8cd1a589ef3c0296e5988e2ca123e900c59032`.
- Read-only extraction from the actual original browser tab now returns the exact A task ID, exact pilot worktree, one original user turn and decision `continue`.
- Original Work-layout DOM is a `You said:` heading and immediate parent DIV with a `group/user-message` body, not an article. Reading an assistant's echoed task text or whole `main` is not accepted as original-user identity.
- No Flowdeck launcher/worker/follower process was running at the operational check. The historical inbox was not rewritten, signaled or reset by this patch. Its old pending record has not been falsely relabeled as newly delivered.

## Patch behavior

### Initial adoption

`adoptStartedWork` performs a short scan and returns a typed waiting state for hydration lag. Temporal retains the pending workId and pinned candidate tab/chat, publishes `pending_adoption`, buffers early reports, and waits durably. A second distinct start while adoption is unresolved pauses.

Initial adoption requires the original user message's task ID and absolute worktree, the allowlisted Sashai project, tab/chat identity, and event scope. A sole open tab or owner/device scope is insufficient. A finished first turn can be adopted once that same proof is visible. A pending initial pin is distinguished from an automatically submitted turn; it does not require a nonexistent previous-send receipt.

Missing original message means wait/timeout. Conflicting identity or multiple matching candidates means pause. No initial prompt is resent.

### Post-send hydration

The original send-event and semantic claims remain the one-send boundary. After the single physical click, a pending target stores the owned tab, expected turn count and SHA-256 of the full normalized connector-plus-prompt payload. A conversation URL need not already exist.

`reconcileSubmittedTurn` performs read-only checks. Temporal waits in `waiting_for_submitted_turn`, allows delayed navigation and message hydration, and carries the newly observed conversation binding forward. Wrong or extra user messages, changed tab identity, or mismatched prompt hashes pause; there is no second click. Then the workflow waits for the real new `work_started`, rather than inventing a new workId.

A crash around the physical click remains uncertain: a claim is not proof of delivery. No browser transaction or exactly-once send guarantee is claimed.

### Closed target delivery

Known Temporal `WorkflowNotFoundError` is checked against `describe()` before classifying a closed/missing execution. Confirmed terminal records become durable `target_closed`, remain inspectable, and are excluded from automatic retries across restarts. Transient connectivity failures remain pending. Legacy retry counts above 8 are accepted unchanged rather than invalidating the original inbox. Counters are not silently saturated.

Follower status exposes blocked records and emits a specific terminal-target diagnostic. Blocked records cannot satisfy startup readiness. The old closed workflow cannot be restarted through normal follower preflight.

### Fresh attempt identity

Explicit `--attempt NAME` creates workflow `flowdeck-supervisor-PROJECT--NAME`. The launcher uses a distinct `<configured-directory>/attempt-NAME` inbox/checkpoint, preserving old records. Existing execution IDs are rejected, whether running or terminal. Sender claims remain shared and are never deleted or bypassed by changing attempt name. No implicit timestamp/suffix or fresh attempt is generated.

## Bounds

| Boundary | Behavior |
|---|---|
| Adoption hydration | Up to 120 short observations, five-second Temporal sleeps, ten-minute elapsed scheduling deadline; final in-flight activity may add up to its two-minute limit |
| Submitted user turn | Up to 120 reads, five-second Temporal sleeps, ten-minute elapsed scheduling deadline; no repeated click |
| Answer after finish hook | Existing 60 reads, two-second durable sleeps, three-minute elapsed scheduling budget plus an in-flight activity; explicit `observation_timeout` if unresolved |
| Owned tab creation | 20-second pre-send search budget |
| Empty composer hydration | 15-second pre-send budget; drafts/active generation/wrong targets stop immediately |
| Connector picker | Shared five-second pre-send budget |
| Activities | Existing two-minute start-to-close, one attempt; no unbounded activity polling |
| Lifecycle event absence | 30 minutes then explicit no-event pause; not labeled completed or proven failed |
| Workflow | Four-hour lifetime; begin shortly before the test |
| Launcher | Existing 30-second startup budget retained; child logs identify worker versus follower, workflow phase is queried, follower readiness reports pending/blocked counts |

Browser pre-send budgets are checked between bounded CDP reads, so they are scheduling budgets, not a guarantee that every slow in-flight read finishes exactly at that millisecond.

## Regression validation

- Final `npm test`: **244 passed, 2 skipped, 0 failed**; TypeScript build included.
- `git diff --check`: passed.
- Covered zero-user-turn hydration, report before hydration, finished delayed adoption, pinned initial identity, wrong task/worktree/tab, multiple matching candidates, report/start reordering, in-flight send signals, delayed navigation/submitted user observation without reclick, closed target persistence, legacy retry counts and explicit attempt isolation.
- Real no-send Profile 4 check: opened a new owned Sashai Project window, selected Remote Desktop Commander, matched the entire staged draft, zero submissions, and closed only that owned check tab.
- Read-only original-chat check: exact task/worktree visible, original user count 1, interpreted answer `continue`, zero submissions.
- Updated bounded real Temporal smoke with fake activities passed on `flowdeck-smoke-a6580df8-a95a-42ec-bf4a-091fce93c620`; worker shut down and connections closed. This is integration regression evidence, **not** completion of the real pilot.

## Smallest proposed recovery — no repeat of Stage 1

**Not executed. Requires explicit owner authorization.**

1. Preserve the original workflow history, old inbox/checkpoint, claim files and A checkpoint. Keep the original chat open, without another user turn.
2. Recheck the existing approved enrollment, worktree and checkpoint; confirm there is no sealed/uncertain A continuation claim. Stop if a continuation might already have been sent.
3. Start a fresh named attempt with the patched worker and an isolated inbox:

```sh
cd /Users/test/Documents/work/temporal-harness-mvp
npm run build && node scripts/flowdeck-launch.mjs sashai /Users/test/Documents/work/temporal-harness-mvp/.state/flowdeck-supervisor/pilot-events.json --attempt hydration-recovery-20261016
```

This starts `flowdeck-supervisor-sashai--hydration-recovery-20261016`. It does not resend the owner's task. Do not run it before recovery authorization, and do not reuse that attempt name if an execution already exists.

4. Wait for all-component readiness. **Do not manually submit Task A again.**
5. Under that same explicit recovery authorization, validate and import only the preserved start/report pair listed above into the new attempt through the existing `supervisorWorkEvent` Temporal signal. These are the actual `origin: event` records, not synthetic events or snapshots. The normal startup history barrier remains in place; this is a scoped operator reconciliation, not general automatic historical replay. The new inbox is not redirected to the old workflow and the old records are not removed or marked newly delivered.
6. The new workflow will adopt the already finished A Stage 1 conversation using original-user identity, read `continue`, and claim/send the Stage 2 continuation exactly once. Then it should start B once in a new Sashai conversation and retain review_pending statuses.
7. Capture actual conversation URLs, new work-session IDs/events, send receipts and task transitions. Pause without replay if any outcome is uncertain.

The fresh-attempt CLI is implemented. The preserved-event import is intentionally an explicitly authorized operator action using the existing Temporal signal API, not an auto-recovery service. No recovery signals have been sent in this patch.

### Owner participation

The next required participation is one explicit reply authorizing **recovery of the existing Stage 1 chat into the named new attempt**, including its A continuation and approved B handoff. After that, no repeated initial prompt is needed. The owner should leave the original chat/tab intact and avoid concurrent Sashai task chats during recovery; only genuine plugin consent/input or ambiguity would require further intervention.
