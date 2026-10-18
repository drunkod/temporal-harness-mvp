# Flowdeck MVP: one delivery plan

## Objective

Launch one configured application that performs approved work without repeated confirmations: submit a task, observe its real result, continue unfinished work, advance to the next eligible task, and report completion or a precise blocker.

Deliver this in two milestones, not as an all-day production system in one jump:

1. **Attended MVP:** one manual initial Send; automatic observation, one P1 continuation when needed, and one independent P2 in another chat.
2. **Bounded autonomous MVP:** automatic initial Send as well, followed by the configured sequence and verified automatic closeout, without human browser intervention.

A recorded October 18 attended demonstration completed with external review pending. That is historical evidence, not a fresh validation of current working-tree bytes. The ordinary autonomous live entrypoint remains blocked without a fully registered production runtime. Many implementations exist in the working tree; this documentation cleanup is not a commit or release of those runtime changes.

## What to do next

Use the [manual Mac runbooks](../operations/manual-mac-testing/README.md) as the single operator procedure. Fix the first failing boundary, rerun that stage, and record its actual result. Do not respond to a browser or source integration failure by designing another framework.

| Stage | Deliverable | Observable completion |
|---|---|---|
| Start | Existing attended launcher with a fresh configured project | Combined worker/workflow/follower readiness |
| First task | Prepared exact tab and one initial prompt | One correct user turn and matching real work session |
| Observation | Source reports plus finished browser response | Correct task/chat/work binding and recognized result |
| Continuation | Existing bounded continuation path | One extra turn in the same chat, fresh work session |
| Next task | Existing eligible-task transition | P2 once in a distinct chat, no P2 continuation |
| Automatic startup | Wire the automatic initial-send implementation to the supported entrypoint | Zero manual Send; initial turn reconciled |
| Bounded autonomy | Complete concrete worker/source/browser/cursor/fence/closeout composition | Configured campaign completes without intervention and records receipts |

The attended launcher has no manual pause between observation, continuation and P2. Those are checkpoints in one run. An isolated one-task automatic test needs an explicit enforced boundary; do not depend on the operator stopping a full campaign fast enough.

## Scope to retain

- Temporal TypeScript workflows, existing activities, Helium/Probe integration and upstream source ledger.
- Exact project/task/worktree/chat identity and full prompt matching.
- Durable reservation and dispatch journals; reconcile an uncertain Send instead of clicking again.
- Standing configured policy instead of per-step confirmation questions.
- Bounded waiting, clear failure output and same-run recovery.
- Implementation completion distinct from external review/acceptance.

Do not add dashboards, multi-project scheduling, a new database, a new agent framework or broad legacy refactors. Defer packaging, background service installation and workday reliability claims until the bounded executable path works. A sleeping/offline Mac cannot operate its browser even if Temporal retains workflow state.

## Concrete integration work, not another architecture

### 1. Executable registration

Wire `scripts/flowdeck-run.mjs` through the real activity registry and `createProductionRuntimeComposition()` in `src/flowdeck-autonomy-production-runtime.ts`. Supply concrete pinned Temporal worker, browser, source, inbox, cursor, predecessor, evidence and outstanding-effect ports. Do not replace absent functions with readiness booleans or fall back to the attended launcher.

Use `createProductionSourceCursorStore()` from `src/flowdeck-autonomy-production-cursor.ts` and `createSenderProcessFence()` from `src/flowdeck-autonomy-production-process.ts` in the executable path. Their existence and separate tests do not establish production registration.

- Bind the checkpoint to exact source/owner/device/workflow/run; preserve its original seed on restart.
- Enforce exclusive follower ownership for its lifetime. The cursor's per-update lock is not that ownership mechanism.
- Demonstrate upstream cursor ordering/continuation semantics; rejection of repeated tokens does not order distinct opaque tokens.
- Register actual send-capable process identities before activation. An SDK shutdown promise alone does not prove all senders are drained.
- Unknown existing browser ownership blocks activation rather than silently adopting or terminating another process.

### 2. Test the same composition

Extend `tests/flowdeck-autonomy-production-composition.test.mjs` rather than create another toy runtime. Use the real Temporal workflow/controller/registry/finalizer with the actual disk cursor and process fence together, controlled fake browser/source effects, temporary state and isolated queues.

Required assertions:

- Three-send synthetic success, correct chat split and real retirement receipt.
- Lost click acknowledgement produces no second click or speculative next task.
- Restart after checkpoint preserves source/run identity without event loss.
- Overlapping followers cannot both admit/checkpoint; stale owners remain fenced.
- Cursor does not advance beyond durable event admission; lost signal acknowledgement is replay-safe.
- Real owned child disappearance, injected PID reuse, unknown visibility and missing/corrupt witness are distinguished.
- Outstanding browser calls or unresolved dispatches prevent retirement despite business completion.
- Restart after receipt preserves the same run/receipt and adds no sends.
- Source/session conflicts, cancellation and deadlines produce explicit outcomes and cleanup evidence.

Do not count a skipped integration test as a pass. Assert actual factory calls and persisted records, not a string claiming the implementation was used. Replace unavailable private fixture prerequisites with sanitized versioned fixtures or deterministic generators.

### 3. Keep the runner noninteractive

Extend `scripts/flowdeck-check.mjs`: explicit profile, closed stdin, bounded child lifetimes, isolated resources, stage results and aggregate failure evidence. Add the same-composition suite to explicit acceptance selection; the existing synthetic smoke selection alone is not equivalent.

Offline/synthetic modes must not construct live send adapters. Never promote a blocked test to live mode. Authentication is setup; an expired login produces a blocker, not an infinite confirmation loop.

### 4. Validate the real browser and bounded campaign

First prove the real owned-tab no-send boundary: exact profile/tab detection, ownership exclusion, cancellation and zero irreversible Send actions. Draft staging is a browser mutation even without Send.

For the configured partial-P1 acceptance fixture, each autonomous cycle permits initial P1 + one P1 continuation + one P2: **three** automated reservations. Two cycles permit **six** total. Persist reservations before effects; restart must not reset usage or refund ambiguity. The attended workflow's two-automated-send semantics remain unchanged.

Only start cycle two after verified cycle-one closeout. Capture task/session/event evidence, reconciled dispatches, source/artifact hashes, terminal history, sender drain and receipt. A completed business workflow is not automatically proof of cleanup.

## Development commands and build boundary

See the [runner reference](../operations/flowdeck-autonomy-runner.md) for existing commands and their prerequisites. Build in an isolated candidate; do not overwrite `dist/` used by an existing worker. Keep filesystem/process/browser I/O outside workflow code. Replay historical and new histories after scheduling/bundle changes; replay does not validate activity effects.

No routine confirmation is needed inside the configured scope. Invalid configuration, exhausted budget, unknown identity or unresolved external effects produce a durable blocked outcome and one report.

## Definition of done

**Attended prototype:** fresh configured run, one manual first Send, real adoption/result observation, automatic allowed continuation/P2, honest task/review status, recorded cleanup state. This can be delivered before background packaging or full restart hardening.

**Autonomous MVP:** two configured fresh cycles complete with zero human rescue, required composition/fault checks and replays pass, no duplicate sends, verified automatic closeout, one supported start/status/stop procedure, and an exact identified tested build. Freeze and version the runtime source/artifacts separately; a documentation-only commit is not that release.

**Later operational milestone:** same-campaign recovery under process restart, network interruption and authentication loss, supervised background hosting, health notifications and a workday soak. Do not claim this from a single bounded pass.

## Work allocation and stop rule

- Runtime lane: concrete entrypoint/ports and ownership lifecycle.
- Test lane: same-composition cases and reproducible fixtures, with disjoint write scope.
- Runner lane: profile selection and result/evidence output.
- Integrator: demonstrate the actual executable path; build/test after parallel edits settle.

Each handoff gives exact commands, observed results, failures/skips and the next smallest fix. Stop expanding scope when the milestone's observable criteria pass. Do not create another overlapping plan or repeat historical live attempts to demonstrate progress.
