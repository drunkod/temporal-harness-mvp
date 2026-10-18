# Flowdeck supervisor reference

For step-by-step operation use [Manual Mac testing](operations/manual-mac-testing/README.md). This stable path is retained because the supervisor CLI names it in setup guidance.

## MVP behavior

The attended path starts one worker, workflow and event follower. The owner submits the exact enrolled initial task once in the prepared Project tab. Flowdeck adopts the matching work session, observes the actual finished answer, can continue the same task in the same chat, and starts the next eligible approved task in a separate chat.

Completion means `implementation_done / review_pending`, not independent review, merge or release. The configured attended scenario permits at most one automatic P1 continuation and one P2 submission, with no P2 continuation. The manual first Send is outside that two-send automated budget.

## Enrollment

The loader reads `.state/flowdeck-supervisor/projects.json`. Each project binds its ID, owner/device, absolute worktree, supported Project URL, initial task ID and approved task entries. Task IDs/titles must be unique, and titles must match the active plan's pending Task Breakdown rows. Fresh-attended projects also require a valid `attendedPilotBudget`.

Use actual provisioned configuration, not a dated JSON proposal copied into live enrollment. See [examples](../examples/README.md) for non-executable shapes and [stage 00](operations/manual-mac-testing/00-prepare-mac.md) for configuration checks.

## Entry points

Commands below show argument shapes; uppercase names must be replaced with actual configured values.

```text
node scripts/flowdeck-supervisor.mjs --help
node scripts/flowdeck-supervisor.mjs status
node scripts/flowdeck-supervisor.mjs workflow-status PROJECT_ID
node scripts/flowdeck-prepare-manual-start.mjs prepare PROJECT_ID
node scripts/flowdeck-prepare-manual-start.mjs show PROJECT_ID
node scripts/flowdeck-launch.mjs PROJECT_ID /absolute/event-config.json
```

`status` is a potentially stale saved projection. `workflow-status` queries the specified Temporal execution. The preparation helper opens a new empty Project target and persists its record; `show` verifies and foregrounds that exact prepared target. Prepare before launch. The launcher uses the existing `dist/`, owns its worker/follower children, and must reach `ALL COMPONENTS READY MANUAL START NOW` before initial Send.

Do not run independent worker/start/follow commands beside the coordinated launcher. Ctrl+C requests launcher child shutdown but does not cancel the Temporal execution or prove an external browser action stopped. Preserve the current run and journals rather than retry an uncertain Send.

## Event and decision boundary

A real `work_started` event binds the task/chat/tab/work identity. A `work_reported` event is a session report, not independent artifact acceptance. The supervisor also observes the actual finished assistant answer; supported final lines are:

```text
FLOWDECK_STATUS: continue
FLOWDECK_STATUS: implementation_done
FLOWDECK_STATUS: needs_attention
```

Missing observations can lead to bounded waiting; conflicts or unresolved sends lead to a recorded blocker. No manual confirmation is required for a valid configured continuation or next task. See [event contract](operations/FLOWDECK-WORK-EVENTS.md) and [browser diagnostics](operations/browser-observation-diagnostics.md).

## Development path

Use the [single MVP plan](plans/FLOWDECK_AUTONOMOUS_MVP_PROGRAMMER_GUIDE.md) for automatic initial Send and unattended composition work. Historical recovery commands are deliberately not included in the fresh-run procedure. Existing recovery tools and their fixtures remain in the repository, but are not normal restart buttons.
