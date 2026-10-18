# 00 — Prepare your Mac and identify the test

**Goal:** know exactly which fresh project and runtime you will test. No browser Send occurs here.

## 1. Open Terminal and locate the checkout

```sh
cd /Users/test/Documents/work/temporal-harness-mvp
pwd
node --version
npm --version
git --no-pager log -1 --format='%h %s'
git --no-optional-locks status --short
```

Expected: the repository path, installed Node/npm versions and the current revision. Dirty files are not a reason to delete changes. Record that this is a working-tree test if dirty.

Check required files:

```sh
ls dist/flowdeck-projects.js dist/flowdeck-supervisor-workflow.js dist/flowdeck-supervisor-activities.js
ls .state/flowdeck-supervisor/projects.json
command -v temporal
```

Missing `dist` means you need a build. Do not run `npm ci` or `npm run build` in a directory used by an active worker. In a separate programmer-prepared test checkout, the build commands are `npm ci` then `npm run build`. Use that checkout's absolute path for the rest of the guide. Missing Temporal CLI is a setup issue; it does not necessarily mean the Temporal server is absent.

## 2. Inventory, without stopping anything

```sh
ps -axo pid,ppid,lstart,command | grep -E 'flowdeck|temporal|sashai|Helium'
lsof -nP -iTCP:7233 -sTCP:LISTEN
```

Expected: you can distinguish existing workers from your future test. Do not kill processes using old PIDs from previous reviews. If another sender owns this browser profile, record `BLOCKED: profile already in use`; the programmer must resolve that specific ownership before your fresh run.

For a configured server, its address and namespace come from the event config below. Do not start another server on its port. If a developer has explicitly provisioned a new local test environment and no server exists, `temporal server start-dev` is the development-server command; run it in a separate terminal and keep it open. It is not a production service. Do not use this to replace an existing server/database.

## 3. List enrolled projects and event configuration candidates

```sh
node --input-type=module <<'NODE'
import { readFile, readdir } from 'node:fs/promises';
const value = JSON.parse(await readFile('.state/flowdeck-supervisor/projects.json', 'utf8'));
for (const p of value.projects ?? []) {
  console.log(JSON.stringify({id:p.id,repo:p.repo,initialTaskId:p.initialTaskId,
    tasks:p.tasks?.map(t=>({id:t.id,title:t.title})),budget:p.attendedPilotBudget},null,2));
}
console.log('Root .state event-config candidates:');
for (const name of await readdir('.state')) {
  if (/events.*\.json$/.test(name)) console.log(name);
}
NODE
```

A listed project is **not necessarily fresh**. Historical 20261018-06/07/08 projects must not be reused just because they appear here. Obtain the new project's ID and matching event config from the programmer's current handoff. A new `--attempt` suffix alone does not reset prepared records, completed tasks or ownership.

If no fresh enrollment exists, stop here with `BLOCKED: fresh enrollment and event config missing`. Ask the programmer to provide those two concrete inputs, not another architecture plan. The project must have two actual approved pending tasks, a valid attended budget, and the source plugin/database corresponding to this Mac.

## 4. Set the two local values once

Replace the example values below with the actual handoff values before running. They are placeholders, not runnable project names. Repeat this block in Terminal A and B:

```sh
cd /Users/test/Documents/work/temporal-harness-mvp
export PROJECT_ID='REPLACE_WITH_FRESH_ENROLLED_PROJECT_ID'
export EVENT_CONFIG='/REPLACE/WITH/ABSOLUTE/EVENT-CONFIG.json'
```

Read the configuration and validate enrollment:

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readEventConfig } from './scripts/flowdeck-work-events.mjs';
import { loadSupervisorProject } from './dist/flowdeck-projects.js';
const p = await loadSupervisorProject(process.env.PROJECT_ID);
const c = await readEventConfig({config:process.env.EVENT_CONFIG});
assert.equal(c.owner,p.ownerId);
assert.equal(c.device,p.deviceId);
assert.equal(c['workflow-id'],'flowdeck-supervisor-'+p.id);
console.log(JSON.stringify({projectId:p.id,repo:p.repo,initialTaskId:p.initialTaskId,
  taskIds:p.tasks.map(t=>t.id),budget:p.attendedPilotBudget,
  address:c.address??'127.0.0.1:7233',namespace:c.namespace??'default',
  sourceRepo:c['plugin-repo'],sourceDb:c.db,inbox:c.directory},null,2));
NODE
```

Expected: two intended tasks, correct worktree, matching owner/device and no error. `Task authority blocked` or mismatched titles is a programmer enrollment/active-plan fix—not something to bypass.

Set `TEMPORAL_ADDRESS` and `TEMPORAL_NAMESPACE` in both terminals to the printed values. For the default local environment only:

```sh
export TEMPORAL_ADDRESS='127.0.0.1:7233'
export TEMPORAL_NAMESPACE='default'
node scripts/flowdeck-supervisor.mjs workflow-status "$PROJECT_ID"
```

Expected for a genuinely unused project: `exists: false`. Connection failure is not equivalent to absence. Any existing workflow means this is not a fresh test target.

## 5. Check the upstream reader and keep the Mac available

```sh
node scripts/flowdeck-work-events.mjs once --config "$EVENT_CONFIG"
```

Expected: source `head`, `snapshots`, inbox information and `readOnly: true`. No events may be normal; an import/database/identity error is a setup failure. Do not run `follow` separately—the launcher will start it.

Open configured Helium Profile 4, sign in once if needed, and verify Probe RemoteMCP2 is available in the intended Sashai Project. Keep the laptop plugged in, lid open and network connected. Optional, in Terminal C:

```sh
caffeinate -i
```

Stop this with Ctrl+C after testing. It inhibits idle sleep, not all lid-close/reboot/network failures.

## Pass / next

PASS means the fresh project validates, the workflow does not already exist, the source can be read and the intended browser is available. Record the values, then go to [01](01-start-engine.md). Do not launch merely to discover missing configuration during the 30-minute initial-start window.
