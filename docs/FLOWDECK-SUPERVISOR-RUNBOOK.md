# Flowdeck minimum v1.2 task supervision

## Current successor recovery procedure

Use [the corrected successor integration procedure](history/FLOWDECK-SUCCESSOR-INTEGRATION-FIX-2026-10-15.md), superseding the earlier first-generation B recovery commands below. `--recorded-attempt-id` identifies the historical dispatch audit label, not the newer Temporal run. Preview is read-only; apply requires a separately approved successor generation and emits the immutable request used by the existing B-only workflow. No authorization or send was issued by this patch.

## Current Probe pilot: resume B only

A is already implementation_done/review_pending; never resubmit it. Use [the current Probe P0 recovery procedure](history/FLOWDECK-PROBE-P0-RECOVERY-PATCH.md), which supersedes the older initial-pilot recovery notes below. Commands are preview-first. A scoped authorization for the proven legacy stage failure, a distinct B-only execution, and follower readiness release are required; original claims/history are preserved. No live recovery has been executed as part of this patch.

**Current ChatGPT connector label (2026-10-15):** The Flowdeck supervisor selects **Probe RemoteMCP2**, not **Remote Desktop Commander**, for newly staged messages. The browser picker label, complete composer-payload equality check, generated `begin_work`/`finish_work` instructions, and no-send transport test use the same `FLOWDECK_CONNECTOR_LABEL` constant from `src/sashai-dispatch-evidence.ts`. Earlier pilot screenshots, approved task text, and recorded send claims may still contain the historical plugin label; do not rewrite them or replay those sends. ChatGPT's trailing `… Show more` on a rendered user turn and `Is this conversation helpful so far?` after an assistant response are treated as exact UI decorations in read-only extraction, not as user/assistant-authored instructions.


Implementation supervision only. **No artifact acceptance, code review, independent execution verification, marker creation, or automatic task authorization.** The minimal Temporal workflow, explicit worker/start CLI, independent event follower, and SSE dashboard projection are integrated. No plugin registration or automatic enrollment is performed. Browser actions are fixture-tested; a real Temporal smoke uses fake browser activities, with no live sends.

## Current P0 recovery status

The first real pilot completed A Stage 1 but its workflow closed after delayed user-message hydration prevented adoption. The pilot is now enrolled in its dedicated worktree. **Do not resubmit A Stage 1.** See [P0 hydration patch and recovery procedure](history/FLOWDECK-P0-HYDRATION-RECOVERY.md) for the preserved event IDs, fresh-attempt CLI, current bounds and explicit recovery authorization gate. That record supersedes older pre-enrollment status and 10-second adoption/polling descriptions below.

## Historical pre-enrollment blockers

- Read-only `inspectSashaiTaskSource()` inspection on 2026-10-15 returned `no_active_plan` for `/Users/test/Documents/work/sashai`. There is no approved executable task to select. Do not infer one from `tasks/current.md`, deferred TODOs, recent plans, or a generated snapshot.
- At the initial implementation baseline enrollment was absent. It now exists for the approved dedicated pilot worktree; do not replace it with the empty example. The example remains non-dispatchable.
- The operator must separately establish an approved active execution plan and correct worktree ownership under Sashai's own routing contract. These activities do not create or choose `.ai/harness/active-plan` or `.ai/harness/active-worktree`.
- A bounded real-browser no-send check on 2026-10-15 opened a newly owned Sashai Project window using `createLiveBrowser`, selected Remote Desktop Commander, and matched the full draft before closing only that tab. Zero prompts were sent. The real continuation/new-conversation handoff remains unproven until approval and manual start. Transport is Helium Profile 4/CDP on localhost:9222; only the exact Sashai ChatGPT Project is supported.

## Enrollment and authority

Use the shape in `examples/flowdeck-supervisor.example.json` for `.state/flowdeck-supervisor/projects.json` in the main harness repo. Do not put credentials in it. Replace owner/device IDs with the enrolled event scope. Supply task entries only after explicit approval:

```ts
type ApprovedTask = {
  id: string;
  title: string;
  instruction: string;
  requiresReviewBeforeNext?: boolean;
  dependsOn?: string[]; // approved task IDs; dependency-review scheduling belongs to the parent
};
type SupervisorProject = {
  id: string;
  ownerId: string;
  deviceId: string;
  repo: string;        // absolute path to the explicitly owned execution worktree
  projectUrl: string;  // exact Sashai /g/<project-id>/project URL
  initialTaskId: string; // required in multi-task config; defaults to the sole task otherwise
  tasks: ApprovedTask[]; // explicitly enrolled tasks; no inferred or generated tasks
};
```

Each configured title must exactly match one unique **unchecked** row in the active plan's `## Task Breakdown`. IDs and titles must be unique and instructions nonempty. Enrollment requires at least one task. Multi-task enrollment must explicitly name `initialTaskId`; a sole task defaults only when the field is omitted. An explicit value must always name an enrolled task. Optional `dependsOn` arrays must contain unique known task IDs, with no self references. Dependency review/scheduling remains the parent's responsibility; these activities perform no review. The existing inspector resolves real paths, validates plan/worktree markers and rejects archived/nonexecution plans. Its 20-row/250-character bounds also apply: configurations outside those observable bounds fail closed, not via a fallback task source.

The loader rechecks authority on every activity and before clicking Send. Caller project/task objects must still equal enrollment. If a task is checked off, authority markers disappear, or config changes mid-run, the current run stops for operator reconciliation; do not silently rewrite enrollment to bypass this. The inspector's `dispatchAllowed: false` remains unchanged: this adapter supplies an explicit enrolled binding, not a blanket authorization derived from the inspector.

## Exact parent-facing API

Exports from `src/flowdeck-supervisor-activities.ts` (loader also exported from `src/flowdeck-projects.ts`):

```ts
loadSupervisorProject(projectId: string): Promise<SupervisorProject>
adoptStartedWork(project: SupervisorProject, event: SupervisorEvent, task: ApprovedTask, expectedBinding?: WorkBinding): Promise<WorkBinding>
observeWorkResult(project: SupervisorProject, binding: WorkBinding, event: SupervisorEvent): Promise<WorkObservation>
sendContinuationOnce(project: SupervisorProject, binding: WorkBinding, task: ApprovedTask, event: SupervisorEvent): Promise<WorkBinding>
startNextTaskOnce(project: SupervisorProject, task: ApprovedTask, previousBinding: WorkBinding, event: SupervisorEvent): Promise<WorkBinding>
publishSupervisorState(state: unknown): Promise<void>

type WorkBinding = {
  projectId: string; taskId: string; chatUrl: string; tabId: string; workId: string;
};
type WorkObservation = {
  turn: 'running' | 'finished' | 'unknown';
  decision: 'continue' | 'implementation_done' | 'needs_attention' | 'unknown';
  summary: string;
};
// SupervisorEvent is the existing WorkEventV1 from flowdeck-work-events.ts.
```

`adoptStartedWork` requires a scoped `work_started` event (revision 1). Observation and send activities require a scoped `work_reported` event (revision 2, `agent_report_only`) for the binding's exact `workId`. Owner/device/schema/source are checked; `origin: snapshot` is allowed but does not gain extra authority. Do not replace a WorkEventV1 with `{workId, outcome}` or a fabricated provenance record.

For fixture tests, `createSupervisorActivities(options)` returns all six methods. Options are `base`, `browserFactory: () => LiveBrowser`, `loadProject`, `list`, `observe`, and `wait`. `createSupervisorProjectLoader({base, inspect})` provides loader isolation. The default browser factory is the existing connector-preserving `createLiveBrowser`. Injecting a loader is a trusted testing seam, not an alternate runtime authorization path.

### Parent lifecycle

1. Load the explicitly enrolled project. For initial manual work use `project.initialTaskId`, not array position or an inferred task. Initial adoption without an existing/expected binding is restricted to this configured task. The event's owner/device must match project enrollment. The parent schedules only tasks without unreviewed dependencies; the activities never choose tasks from the repository or perform dependency review.
2. On `work_started`, call `adoptStartedWork(project, event, task)`. A bounded hydration window permits at most 20 observations at 500 ms spacing, with a 10-second deadline between observations. Exactly one running project chat must become observable and hydrated; ambiguity, a wrong expected identity, or an already-finished intended chat pauses without sending. Adoption lists/observes and persists only; it never stages or sends. An existing task/chat association cannot be replaced with another chat, and a chat cannot be reused for a different task.
3. On `work_reported`, call `observeWorkResult(project, binding, event)`. Poll this activity with the same report if the answer is still running/unknown. It does not block a worker indefinitely. A plugin success or partial result alone does not finish a task. In particular, connector `finish_work`/the corresponding `work_reported` can arrive before ChatGPT finishes its answer; keep polling the same binding and report. Only the observed running/awaiting turn controls waiting: `pageBusyHint` is not a generation signal and may remain true after completion.
4. A finished answer must end with exactly one clear status line:
   - `FLOWDECK_STATUS: continue`
   - `FLOWDECK_STATUS: implementation_done`
   - `FLOWDECK_STATUS: needs_attention`

   Conflicting/invalid/quoted markers are unknown. A marker inside a fenced code block followed by a closing fence is also unknown: the exact final status line is intentional, and the parent pauses rather than inferring completion. A very small set of whole-answer unambiguous natural-language completion/continuation statements is also recognized. No arbitrary "success", plan, promise, or partial-progress text is sufficient. A failed report becomes `needs_attention` once the ChatGPT turn finishes. Decisions describe what ChatGPT reported, **not accepted implementation quality**.
5. A stored observation plus a fresh finished-turn observation are required before sending. `continue` may call `sendContinuationOnce` for the **same task, tab and conversation**. `implementation_done` may call `startNextTaskOnce` for **any unstarted configured task with no dependencies** (`dependsOn` absent or empty), allowing the parent to skip a review-dependent successor for independent work. Nonempty dependencies are refused rather than reviewed here. The activity creates a new owned project tab, sends in the project, then binds the navigated in-project conversation. No review activity is performed. `requiresReviewBeforeNext: true` blocks this transition for an operator/parent boundary; there is no built-in approval bypass.
6. **Important workId handoff:** a send cannot know the workId that the plugin will allocate. Its return value identifies the resulting chat/task but retains the triggering/previous workId. It is a pending target, not a new observable work binding. The previous work record is deliberately marked unresolved before the send. Wait for the next real `work_started` event, then call `adoptStartedWork(project, event, task, pendingBinding)` for the same task (continuation) or selected independent task (next task). The optional fourth argument is the pending binding returned by the send. Adoption still requires exactly one running project chat and now requires its task/tab/chat to match that expected target, even on event replay; it never switches to a different running chat. The old workId in the expected binding is deliberately not compared to the new event's workId. Use that returned binding, with its new workId, for the next `work_reported`. Do not feed the pending send target into `observeWorkResult`, fabricate a new workId, or retry a send to obtain one. If work finishes before adoption can observe it running, stop for operator reconciliation rather than guessing.
7. Publish an operational status projection. After the selected task's actual finished answer reports `implementation_done`, the parent may publish its `implementationStatus` while leaving `reviewStatus: 'not_reviewed'`; this is local status, not acceptance or code review. `src/flowdeck-supervisor-workflow.ts` implements this bounded next-task loop. The explicit CLI below registers the activities; no worker is started automatically.

## Send safety and recovery

- Claims are mode-0600 `wx` files keyed by project/task/phase/event, with a second semantic phase guard (continuation workId or task initial-send slot). Redelivery/snapshots cannot repeat a send, including across concurrent calls or process restarts.
- Completed receipts return the same pending target on an identical activity retry. A claim without a completed receipt is **uncertain**, even if a timeout occurred before clicking. Never automatically remove claims or retry.
- Before staging or clicking, the original tab must still match the expected URL. The shared browser helper chooses the connector, verifies the **entire normalized connector+instruction composer**, checks idle state, and rechecks it atomically with the click. It does not send into an owner draft. Next-task sends never reuse the old chat.
- After the single click and navigation binding, hydration is polled up to 20 times at 250 ms intervals for the exact expected user-turn count and tab/chat. Polling reuses the original immutable send claims and never stages/clicks again. Exhaustion leaves the send unresolved.
- A timeout, missing target, failed full-composer match, uncertain click, or unbound post-send navigation leaves durable claims and the previous work record unresolved. Inspect the original chat and local claims/receipts manually. Do not clear the claims as an automated recovery mechanism. A claim is an at-most-once barrier, not proof that a send occurred.
- The filesystem state is the single-host coordination authority. Do not delete it between retries or run multiple hosts with independent state directories for the same project. Claim writes use exclusive creation; status/record updates use same-directory temporary files plus atomic rename. This is not a distributed transactional queue or a power-loss-proof browser transaction.
- Manual extra user turns, closed/moved tabs, multiple running project chats, changed enrollment/authority, or missing hydration block progression. The adapter cannot prove that a concurrent connector work event originated in a particular ChatGPT turn beyond owner/device scope and the unique running-chat binding; require exclusive project use and reconcile ambiguous events.

## Status and data handling

`publishSupervisorState` atomically writes `.state/flowdeck-supervisor/status.json` with mode 0600. It recursively projects a minimal operational allowlist, including parent UI structure: `projectId`, `taskId`, `workId`, `chatUrl`, `tabId`, `turn`, `decision`, `phase`, `status`, `updatedAt`, `requiresReviewBeforeNext`, `stage`, `projects`, `tasks`, `id`, `title`, `initialTaskId`, `dependsOn`, `implementationStatus`, `reviewStatus`, `blocker`, `lastEvent`, `binding`, `observation`. The last-event projection may retain only operational fields such as `eventId`, `kind`, `revision`, `outcome`, `origin`, `startedAt`, `reportedAt`, and `sourceCommittedAt`. Other keys, including raw instructions/prompts, transcripts, summaries and token fields, are omitted. URL queries/fragments and recognizable credential strings are stripped/redacted. Supply operational values only: this is not a general-purpose secret scanner; never embed credentials in IDs/status strings. Local claims/bindings contain IDs/URLs/counts/decisions, not prompts or raw assistant transcripts. The observation summary is a fixed operational description, not captured response text.

## Pilot approval and one-command startup

The exact proposed task IDs, prompts, output files, detached execution worktree, setup authorization and launch sequence are in [FLOWDECK-LIVE-PILOT-APPROVAL.md](history/FLOWDECK-LIVE-PILOT-APPROVAL.md). They remain unapproved and unenrolled until the owner replies explicitly. Do not start the pilot early.

After that approval and enrollment, one foreground command is:

```sh
npm run build && node scripts/flowdeck-launch.mjs sashai /Users/test/Documents/work/temporal-harness-mvp/.state/flowdeck-supervisor/pilot-events.json
```

Readiness is only established when `ALL COMPONENTS READY MANUAL START NOW` appears. The launcher checks authoritative enrollment, rejects any existing workflow, starts the worker, starts the workflow once, queries `waiting_for_manual_start`, and waits for the follower's initial snapshot/live drain with zero pending deliveries. Startup is bounded to 30 seconds after configuration validation; no automatic relaunch. Ctrl-C stops local worker/follower, not the durable workflow. Inspect an interrupted workflow before another launch. The standalone follower also checks that the workflow is running and waiting for manual start before establishing its live boundary.

### Demonstration limits

Keep four-hour workflow lifetime and 30-minute event wait. Launch only shortly before manual submission; an absent hook causes a bounded pause. After a report, final-answer observation is capped at 60 reads separated by two-second sleeps and a three-minute elapsed scheduling budget; an in-flight read can use the existing two-minute activity timeout, so worst case approaches five minutes. Side-effect activities have one attempt; uncertain claims are never replayed. A normal pilot has exactly one continuation, within the six-per-task ceiling.

Every generated continuation and next-task prompt explicitly requests a fresh `begin_work` session and fresh UUID requestKey, retains that turn's workId, calls `finish_work` once before the final marker, and reports partial/continue versus success/implementation_done accurately. The owner's initial prompt in the pilot document requests those hooks too. No new plugin API or executor change is required.

## Operator commands

Read-only local status and help do not dispatch:

```sh
npm run supervisor:status
node scripts/flowdeck-supervisor.mjs --help
node scripts/flowdeck-work-events.mjs --help
```

After approved active-plan enrollment is complete, use separate terminals (these are explicit long-running operator processes, not background services installed by this change):

```sh
npm run supervisor:worker
npm run supervisor:start -- sashai
npm run supervisor:events -- follow --config /absolute/path/to/approved-event-config.json
```

Start the follower before the owner submits the initial ChatGPT task. Its startup barrier admits only subsequent live events; historical snapshots are reconciliation, never new sends. Use the keys documented in [FLOWDECK-WORK-EVENTS.md](operations/FLOWDECK-WORK-EVENTS.md), and bind `workflow-id` to `flowdeck-supervisor-sashai`. Do not use notice-lease APIs. Read-only source inspection uses `once` instead of `follow` and does not signal Temporal.

```sh
npm run supervisor:workflow-status -- sashai
npm run supervisor:smoke
npm run jazz:build -- --reuse-from /Users/test/Documents/RemoteMCP-Jazz/repositories/RemoteMCP-Jazz
```

`supervisor:smoke` starts a bounded disposable real Temporal execution with fake activities, requires the local Temporal server, and submits **zero real ChatGPT messages**. It is not proof of live connector operation. The production workflow ID is deliberately non-reusable; a paused or completed run requires reconciliation rather than casually starting a second sender under the same enrollment.

The dashboard at `http://127.0.0.1:4319/` shows the atomic supervisor projection over SSE. It does not start a worker, authorize tasks or infer a task from Jazz. Localhost Jazz uses the authorized plugin-panel link because its session bootstrap is same-origin. On 2026-10-15 the authenticated plugin panel was observed with 30 scoped work rows and a projector signal updating between observations; a stale open tab needed reloading first. This demonstrates the fallback panel, not authenticated embedding of the new island or a fresh active-to-reported task transition.

## Validation

Fixture suite: `tests/flowdeck-supervisor-activities.test.mjs`. It covers missing authority/enrollment, deferred-task rejection, explicit initial-task selection, dependency validation, unique adoption and expected-binding pinning, scope/binding safety, busy-hint-independent report-vs-turn completion, delayed/exhausted send hydration, continuation/next-chat targeting, successor skipping and dependency refusal, next-task completion status without review, no duplicate sends, concurrent/uncertain claims, composer mismatch, review boundaries, status redaction and conservative parsing. Browser `evidence()` deliberately throws in fixtures, demonstrating that no fabricated structured tool provenance or artifact acceptance is required.

Normal project convention is build then `node --test tests/flowdeck-supervisor-activities.test.mjs`. To avoid updating repo build output, compile with `tsc -p tsconfig.json --outDir <temporary-directory> --sourceMap false` and run `FLOWDECK_TEST_DIST=<temporary-directory> node --test tests/flowdeck-supervisor-activities.test.mjs`. No new package or bundling configuration is needed. Do not run a live worker or live send as part of validation.
