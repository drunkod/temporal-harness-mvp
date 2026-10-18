# 01 — Prepare the browser and start the engine

**Goal:** reach the exact combined readiness message without sending a browser message.

Prerequisite: [00](00-prepare-mac.md) passes; PROJECT_ID, EVENT_CONFIG and Temporal variables are set in A and B. Read the later observation files before launch. The initial manual-start window is bounded; prepare promptly rather than leaving a waiting workflow overnight.

## 1. Prepare the exact tab BEFORE launching

In B:

```sh
node scripts/flowdeck-prepare-manual-start.mjs prepare "$PROJECT_ID"
```

This creates a fresh background Project tab, checks that it is hydrated and empty, and writes a prepared-manual-start record. It does not Send. Current helper supports the `sashai-fresh-attended-YYYYMMDD-NN` enrollment format.

Expected JSON: `ready: true`, `prepared: true`, `writes: true`, `browserSubmissions: 0`. Record `targetId` and `recordPath`.

If a preparation record already exists, do not delete it or run prepare repeatedly. Check its current tab:

```sh
node scripts/flowdeck-prepare-manual-start.mjs show "$PROJECT_ID"
```

Expected: `ready: true`, `verifiedEmpty: true`, `activated: true`, `browserSubmissions: 0`. This also foregrounds the exact recorded tab. If it fails, capture the reason and stop before launch. The `diagnose` action creates another tab, so it is not a harmless substitute for `show`.

## 2. Launch once in A

```sh
node scripts/flowdeck-launch.mjs "$PROJECT_ID" "$EVENT_CONFIG"
```

Leave this process running. Do not run the separate worker/start/follow commands alongside it.

Expected progression:

1. Worker readiness.
2. One new workflow enters `waiting_for_manual_start`.
3. Follower drains initial source/inbox state and reports readiness.
4. Exact final line:

```text
ALL COMPONENTS READY MANUAL START NOW
```

Only the last line establishes combined readiness. Startup has a 30-second bound. If it fails, do not relaunch: the workflow/claim may already have been created.

## 3. Independently check status in B

```sh
node scripts/flowdeck-supervisor.mjs workflow-status "$PROJECT_ID"
```

Expected: `temporal: RUNNING`, matching project ID, `state.phase: waiting_for_manual_start`, `state.status: waiting`. No initial work/chat should have been adopted yet.

## Troubleshooting

| Result | Next action |
|---|---|
| Workflow already exists | Inspect that exact workflow; do not create a new suffix to get past it. |
| Browser-owner scope already claimed | Hand off the claim error and process inventory; do not remove `.state`. |
| Initial manual-start preparation absent/wrong/changed | Fix the prepared target/enrollment before another launch is considered. |
| Startup exceeded 30 seconds | Save A output and B status; worker/follower/source initialization is the failing stage. |
| READY worker but no combined readiness | Do not Send; source/inbox readiness is incomplete. |

PASS: combined readiness plus matching queried state. Continue immediately to [02](02-send-first-task.md). If you stop A now, the workflow and claim can remain; do not expect a fresh rerun to work automatically.
