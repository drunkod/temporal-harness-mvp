# 02 — Copy the exact initial prompt and Send once

**Goal:** manually submit the enrolled P1 exactly once. This starts real work and can enable automatic continuation/P2 without additional prompts.

Prerequisite: [01](01-start-engine.md) passes and A remains open. Read [03](03-observe-result.md), [05](05-test-continuation.md), [06](06-test-next-task.md) and [07](07-finish-and-unattended-test.md) first. This is not a single-send-only isolation mode.

## 1. Copy the current enrolled instruction

Do not run a historical date-specific `flowdeck-copy-fresh-p1-*` helper for a different project. The following complete inline clipboard helper is adapted to the current environment variables and existing APIs. It validates the initial waiting state and prepared surface; it does not Send. This inline procedure has been source-checked, not executed live as part of writing these docs.

In B:

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Connection,Client} from '@temporalio/client';
import {loadSupervisorProject} from './dist/flowdeck-projects.js';
import {readEventConfig} from './scripts/flowdeck-work-events.mjs';
import {verifyPreparedSurface} from './scripts/flowdeck-prepare-manual-start.mjs';
let connection;
try {
  const p=await loadSupervisorProject(process.env.PROJECT_ID);
  const c=await readEventConfig({config:process.env.EVENT_CONFIG});
  assert.equal(c.owner,p.ownerId);
  assert.equal(c.device,p.deviceId);
  assert.equal(c['workflow-id'],'flowdeck-supervisor-'+p.id);
  assert.equal(p.tasks.length,2);
  const task=p.tasks.find(t=>t.id===p.initialTaskId);
  assert.ok(task);
  assert.ok(task.instruction.startsWith('Task ID: '+task.id));
  assert.ok(task.instruction.includes(p.repo));
  connection=await Connection.connect({address:c.address??'127.0.0.1:7233',connectTimeout:'5 seconds'});
  const client=new Client({connection,namespace:c.namespace??'default'});
  const handle=client.workflow.getHandle(c['workflow-id']);
  const description=await handle.describe();
  assert.equal(description.status.name,'RUNNING');
  const state=await handle.query('flowdeckSupervisorStatus');
  assert.equal(state.projectId,p.id);
  assert.equal(state.taskId,task.id);
  assert.equal(state.phase,'waiting_for_manual_start');
  assert.equal(state.status,'waiting');
  assert.equal(state.lastEvent,null);
  assert.equal(state.workId,null);
  assert.equal(state.chatUrl,null);
  assert.equal(state.pilotBudget?.usage?.totalAutomatedSubmissions,0);
  const prepared=await verifyPreparedSurface(p);
  const copy=spawnSync('/usr/bin/pbcopy',[],{input:task.instruction,encoding:'utf8',timeout:5000});
  if(copy.error)throw copy.error;
  assert.equal(copy.status,0,'pbcopy failed');
  console.log(JSON.stringify({copied:true,submitted:false,taskId:task.id,repo:p.repo,tabId:prepared.tabId,runId:description.runId},null,2));
} catch(error) {
  console.error(error.message);
  process.exitCode=2;
} finally {
  await connection?.close();
}
NODE
```

Expected: `copied: true`, `submitted: false`, correct task/worktree/tab. If it fails, do not paste an old clipboard value.

## 2. Show the prepared empty tab

```sh
node scripts/flowdeck-prepare-manual-start.mjs show "$PROJECT_ID"
```

In that exact tab, select Probe RemoteMCP2, paste with Command+V, and check the visible task ID and worktree match the output. Do not prepend your own instructions or substitute a generic generated prompt: the full initial payload is sealed against the enrolled instruction.

## 3. Click Send once

This is the one manual initial Send for the attended test—not a confirmation dialog. Record the time and chat URL. Expected: one initial user message and a response starting in that chat. If the UI stalls, do not click again or refresh to retry submission; inspect the existing message/status.

## 4. Query status

```sh
node scripts/flowdeck-supervisor.mjs workflow-status "$PROJECT_ID"
```

PASS for this stage: one observed initial message in the prepared chat, with correct task identity. Adoption can lag behind the visible message and is checked in [03](03-observe-result.md). Automated budget excludes your manual initial Send; do not interpret an automated count of zero as evidence that no message was sent.

If the wrong prompt/tab was used, record FAIL and follow the stop procedure in 07. Do not send a correction as a second initial message.
