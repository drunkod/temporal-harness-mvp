#!/usr/bin/env node
/** Real local Temporal, synthetic activities only. No production activity/browser imports or file writes. */
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Client, Connection} from '@temporalio/client';
import {NativeConnection, Worker} from '@temporalio/worker';

const address = '127.0.0.1:7233', namespace = 'default';
const scenario=process.argv[2]??'happy';
if(!['happy','projection-transient','projection-persistent','projection-timeout','projection-timeout-exhausted','projection-and-send-failure','recovery-no-release','projection-cancellation','projection-cancellation-late','projection-final-failure','projection-missing-authority'].includes(scenario))
 throw Error('Unknown synthetic smoke scenario');
let publicationAttempts=0,cancellationBlockStarted=false;
const syntheticPublisherAbort=new AbortController();
const workflowsPath = fileURLToPath(new URL('../dist/flowdeck-supervisor-workflow.js', import.meta.url));
const nonce = randomUUID(), workflowId = `flowdeck-smoke-${nonce}`, taskQueue = `flowdeck-smoke-${nonce}`;
const project = {
  id: `smoke-${nonce}`, ownerId: 'smoke-owner', deviceId: 'smoke-device', repo: '/synthetic/not-accessed',
  projectUrl: 'https://example.invalid/project/smoke', initialTaskId: 'task-one',
  tasks: [
    {id: 'task-one', title: 'Synthetic first task', instruction: 'Synthetic only.'},
    {id: 'task-two', title: 'Synthetic second task', instruction: 'Synthetic only.'},
  ],
};
const chat = `${project.projectUrl}/chat/one`, nextChat = `${project.projectUrl}/chat/two`;
const snapshots = [], calls = [], signals = [], inFlight = [];
let connection, nativeConnection, worker, handle, completed = false;
const clone = value => structuredClone(value);
const counts = () => Object.fromEntries([...new Set(calls.map(c => c.name))].map(name =>
  [name, calls.filter(c => c.name === name).length]));
function event(workId, kind) {
  const reported = kind === 'work_reported', now = new Date().toISOString();
  return {
    schema: 'remote-mcp.work-event/v1', source: 'remote-mcp-jazz',
    eventId: `${nonce}:${workId}:${kind}`, workId, ownerId: project.ownerId, deviceId: project.deviceId,
    kind, revision: reported ? 2 : 1, startedAt: now, sourceCommittedAt: now,
    timestampEvidence: 'recorded_in_source_transaction', completionEvidence: reported ? 'agent_report_only' : 'none',
    executionVerified: false, backgroundProcesses: 'unknown', origin: 'event',
    ...(reported ? {reportedAt: now, outcome: 'success'} : {}),
  };
}
async function signalPair(workId) {
  for (const kind of ['work_started', 'work_reported']) {
    const value = event(workId, kind);
    await handle.signal('supervisorWorkEvent', value);
    signals.push(value);
  }
}
const activity = (name, fn) => async (...args) => {
  calls.push({name, args: clone(args)});
  return fn(...args);
};
async function signalDuringSend(workId, phase) {
  await signalPair(workId);
  const state = await handle.query('flowdeckSupervisorStatus');
  assert.equal(state.phase, phase, 'signals delivered while send activity remains in flight');
  assert.notEqual(state.workId, workId, 'new session must not be adopted before send returns');
  inFlight.push({workId, phase: state.phase, signalsAcknowledged: 2, adoptedBeforeSendReturned: false});
}
const activities = {
  loadSupervisorProject: activity('loadSupervisorProject', async id => {
    assert.equal(id, project.id);
    if(scenario==='projection-missing-authority')throw Error('Synthetic missing approved enrollment');
    return clone(project);
  }),
  publishSupervisorState: activity('publishSupervisorState', async state => {
    const count=++publicationAttempts;
    if(scenario==='projection-persistent'||scenario==='projection-and-send-failure'||scenario==='recovery-no-release'||scenario==='projection-missing-authority')
      throw Error('Synthetic projection outage');
    if(scenario==='projection-final-failure'&&state.phase==='approved_cycle_finished')
      throw Error('Synthetic final publication outage');
    if(scenario==='projection-transient'&&count===1)
      throw Error('Synthetic transient projection outage');
    if((scenario==='projection-cancellation'&&count===1)||
       (scenario==='projection-cancellation-late'&&state.phase==='sending_continuation'))
      await new Promise((_,reject)=>{
        cancellationBlockStarted=true;
        const fail=()=>reject(Error('Synthetic publisher canceled for fixture cleanup'));
        if(syntheticPublisherAbort.signal.aborted)fail();
        else syntheticPublisherAbort.signal.addEventListener('abort',fail,{once:true});
      });
    if((scenario==='projection-timeout'&&count===1)||
       (scenario==='projection-timeout-exhausted'&&count<=2)){
      await new Promise(resolve=>setTimeout(resolve,6000));
      throw Error('Synthetic projection exceeded the five-second activity deadline');
    }
    snapshots.push(clone(state));
  }),
  adoptStartedWork: activity('adoptStartedWork', async (p, e, task, expected) => {
    assert.deepEqual(p, project);
    const index = ['manual-work', 'continued-work', 'next-work'].indexOf(e.workId);
    assert.notEqual(index, -1);
    assert.equal(task.id, index === 2 ? 'task-two' : 'task-one');
    if (index === 0) assert.ok(expected == null, 'manual start has no expected binding');
    else assert.ok(expected, 'post-send adoption requires expected binding');
    return {...(expected ?? {projectId: p.id, taskId: task.id, chatUrl: chat, tabId: 'fake-tab-one'}), workId: e.workId};
  }),
  observeWorkResult: activity('observeWorkResult', async (p, binding, e) => {
    assert.equal(p.id, project.id);
    assert.equal(binding.workId, e.workId);
    return {turn: 'finished', decision: e.workId === 'manual-work' ? 'continue' : 'implementation_done', summary: 'Synthetic browser response only; no artifact acceptance.'};
  }),
  reconcileSubmittedTurn: activity('reconcileSubmittedTurn', async (_p, binding) => ({status: 'ready', binding})),
  sendContinuationOnce: activity('sendContinuationOnce', async (p, binding, task, e) => {
    assert.equal(p.id, project.id);
    assert.equal(task.id, 'task-one');
    assert.equal(e.workId, 'manual-work');
    assert.equal(binding.chatUrl, chat);
    if(scenario==='projection-and-send-failure')throw Error('Synthetic send journal failed before browser dispatch');
    await signalDuringSend('continued-work', 'sending_continuation');
    return {...binding};
  }),
  startNextTaskOnce: activity('startNextTaskOnce', async (p, task, binding, e) => {
    assert.equal(p.id, project.id);
    assert.equal(task.id, 'task-two');
    assert.equal(e.workId, 'continued-work');
    assert.equal(binding.chatUrl, chat);
    await signalDuringSend('next-work', 'starting_next_project_chat');
    return {...binding, taskId: task.id, chatUrl: nextChat, tabId: 'fake-tab-two'};
  }),
};

// Includes connection, bundling, execution, and cleanup; never leaves a hanging worker process.
const watchdog = setTimeout(() => {
  console.error(JSON.stringify({ok: false, error: '75-second hard deadline exceeded', workflowId, counts: counts()}));
  process.exit(1);
}, 75_000);
let scenarioTimer;
try {
  const workflowSha256 = createHash('sha256').update(await readFile(workflowsPath)).digest('hex');
  connection = await Connection.connect({address, connectTimeout: '5 seconds'});
  const client = new Client({connection, namespace});
  nativeConnection = await NativeConnection.connect({address});
  worker = await Worker.create({
    connection: nativeConnection, namespace, taskQueue, workflowsPath, activities,
    maxConcurrentActivityTaskExecutions: 1, maxConcurrentWorkflowTaskExecutions: 2,
    shutdownGraceTime: '2 seconds', shutdownForceTime: '5 seconds',
  });
  await worker.runUntil(async () => {
    try {
      await Promise.race([
        (async () => {
          if(scenario==='recovery-no-release'){
            const input={projectId:project.id,taskId:'task-two',completedTaskId:'task-one',phase:'next',
              previous:{projectId:project.id,taskId:'task-one',workId:'manual-work',
                chatUrl:chat,tabId:'fake-tab-one'},event:event('manual-work','work_reported'),
              authorization:{kind:'synthetic-authorization-not-consumable'}};
            handle=await client.workflow.start('flowdeckRecoverSend',{
              workflowId,taskQueue,args:[input],workflowExecutionTimeout:'7 seconds',retry:{maximumAttempts:1}
            });
            await assert.rejects(handle.result());
            const desc=await handle.describe();
            assert.equal(desc.status.name,'TIMED_OUT','missing readiness release must not dispatch');
            assert.equal(counts().recoverPreSendOnce??0,0);
            assert.equal(counts().sendContinuationOnce??0,0);
            assert.equal(counts().startNextTaskOnce??0,0);
            completed=true;
            console.log(JSON.stringify({ok:true,scenario,workflowId,runId:desc.runId,
              temporalStatus:desc.status.name,counts:counts(),
              safety:{realBrowserSends:0,productionActivitiesImported:false,workflowReleaseSignals:0}},null,2));
            return;
          }
          if(scenario==='projection-cancellation'||scenario==='projection-cancellation-late'){
            handle=await client.workflow.start('flowdeckSupervisor',{
              workflowId,taskQueue,args:[project.id],workflowExecutionTimeout:'30 seconds',retry:{maximumAttempts:1}
            });
            if(scenario==='projection-cancellation-late')await signalPair('manual-work');
            const limit=Date.now()+10000;
            while(!cancellationBlockStarted&&Date.now()<limit)
              await new Promise(resolve=>setTimeout(resolve,25));
            assert.equal(cancellationBlockStarted,true,'synthetic publisher must be in flight before cancellation');
            if(scenario==='projection-cancellation')assert.equal(publicationAttempts,1);
            await handle.cancel();
            // The synthetic publisher has no external I/O: end its in-flight fixture
            // promise before worker shutdown, independent of Temporal heartbeat policy.
            syntheticPublisherAbort.abort();
            await assert.rejects(handle.result());
            await new Promise(resolve=>setTimeout(resolve,250));
            const desc=await handle.describe();
            assert.equal(desc.status.name,'CANCELLED');
            assert.equal(counts().sendContinuationOnce??0,0);
            assert.equal(counts().startNextTaskOnce??0,0);
            completed=true;
            console.log(JSON.stringify({ok:true,scenario,workflowId,runId:desc.runId,
              temporalStatus:desc.status.name,counts:counts(),
              safety:{realBrowserSends:0,productionActivitiesImported:false,syntheticCancellation:true}},null,2));
            return;
          }
          handle = await client.workflow.start('flowdeckSupervisor', {
            workflowId, taskQueue, args: [project.id], workflowExecutionTimeout: '60 seconds', retry: {maximumAttempts: 1},
          });
          if(scenario!=='projection-missing-authority')await signalPair('manual-work');
          const result = await handle.result();
          completed = true;
          const description = await handle.describe();
          assert.equal(description.status.name, 'COMPLETED');
          if(scenario==='projection-and-send-failure'||scenario==='projection-missing-authority'){
            if(scenario==='projection-missing-authority'){
              assert.equal(counts().loadSupervisorProject,1);
              assert.equal(counts().sendContinuationOnce??0,0);
              assert.equal(counts().startNextTaskOnce??0,0);
            }
            assert.equal(result.phase,'needs_attention');
            assert.equal(result.status,'paused');
            assert.equal(result.projection?.status,'degraded');
            if(scenario==='projection-and-send-failure')assert.equal(counts().sendContinuationOnce,1);
            assert.equal(counts().startNextTaskOnce??0,0);
            assert.equal(signals.length,scenario==='projection-missing-authority'?0:2);
            assert.equal(snapshots.length,0);
            console.log(JSON.stringify({ok:true,scenario,workflowId,runId:description.runId,
              temporalStatus:description.status.name,counts:counts(),result,
              safety:{realBrowserSends:0,pluginEventsOrWrites:0,productionActivitiesImported:false}},null,2));
            return;
          }
          assert.equal(result.phase, 'approved_cycle_finished');
          assert.equal(result.status, 'implementation_done_review_pending');
          assert.equal(result.blocker, null);
          assert.equal(result.projectId, project.id);
          assert.equal(result.workId, 'next-work');
          assert.equal(result.chatUrl, nextChat);
          assert.equal(result.tasks.length, 2);
          assert.deepEqual(result.tasks.map(t => [t.id, t.implementationStatus, t.reviewStatus]), [
            ['task-one', 'implementation_done', 'review_pending'],
            ['task-two', 'implementation_done', 'review_pending'],
          ]);
          const expectedPublish=scenario==='projection-persistent'?32:scenario==='happy'?16:scenario==='projection-final-failure'?17:17;
          assert.deepEqual(counts(), {loadSupervisorProject: 1, publishSupervisorState: expectedPublish, adoptStartedWork: 3,
            observeWorkResult: 3, sendContinuationOnce: 1, reconcileSubmittedTurn: 2, startNextTaskOnce: 1});
          if(scenario==='projection-persistent'||scenario==='projection-final-failure'){
            assert.equal(result.projection?.status,'degraded');
            assert.equal(result.projection?.consecutiveFailures,scenario==='projection-persistent'?16:1);
            if(scenario==='projection-persistent')assert.equal(result.projection?.lastPublishedAt,null);
            else assert.ok(result.projection?.lastPublishedAt);
          }else if(scenario!=='happy'){
            assert.equal(result.projection?.status,'healthy');
          }
          assert.equal(signals.length, 6);
          assert.equal(inFlight.length, 2);
          const bindings = calls.filter(c => c.name === 'observeWorkResult').map(c => c.args[1]);
          assert.equal(bindings[0].chatUrl, bindings[1].chatUrl);
          assert.equal(bindings[0].tabId, bindings[1].tabId);
          assert.notEqual(bindings[1].chatUrl, bindings[2].chatUrl);
          assert.notEqual(bindings[1].tabId, bindings[2].tabId);
          assert.ok(bindings.every(b => b.projectId === project.id && b.chatUrl.startsWith(`${project.projectUrl}/chat/`)));
          if(!['projection-persistent','projection-final-failure'].includes(scenario)) assert.deepEqual(snapshots.at(-1), result);
          if(scenario==='projection-persistent')assert.equal(snapshots.length,0);
          else assert.deepEqual(snapshots.map(s => s.phase), [
            ...(scenario==='projection-timeout-exhausted'?[]:['waiting_for_manual_start']), 'working', 'waiting_for_chat_response', 'sending_continuation',
            'waiting_for_submitted_turn', 'waiting_for_work_start', 'working', 'waiting_for_chat_response', 'implementation_done',
            'starting_next_project_chat', 'waiting_for_submitted_turn', 'waiting_for_work_start', 'working', 'waiting_for_chat_response',
            'implementation_done', ...(scenario==='projection-final-failure'?[]:['approved_cycle_finished']),
          ]);
          const history = await handle.fetchHistory();
          const activityAttempts=history.events.filter(e=>e.activityTaskStartedEventAttributes).length;
          const activityTimeouts=history.events.filter(e=>e.activityTaskTimedOutEventAttributes).length;
          const activityFailures=history.events.filter(e=>e.activityTaskFailedEventAttributes).length;
          const maxHistoryAttempt=Math.max(0,...history.events.filter(e=>e.activityTaskStartedEventAttributes)
            .map(e=>Number(e.activityTaskStartedEventAttributes.attempt)||0));
          if(['projection-transient','projection-persistent','projection-timeout','projection-timeout-exhausted','projection-final-failure'].includes(scenario))
            assert.equal(maxHistoryAttempt,2,'real Temporal history must attest a publication retry');
          if(scenario==='projection-timeout-exhausted')
            assert.ok(activityTimeouts>=1,'real Temporal history must record exhausted publication timeout');
          if(scenario==='projection-persistent')
            assert.equal(activityFailures,16,'every exhausted optional publication must fail terminally');
          if(scenario==='projection-final-failure')
            assert.equal(activityFailures,1,'only final publication must fail terminally');
          const signalEvents = history.events.filter(e => e.workflowExecutionSignaledEventAttributes);
          assert.equal(signalEvents.length, 6);
          assert.ok(history.events.some(e => e.workflowExecutionCompletedEventAttributes));
          console.log(JSON.stringify({ok: true,scenario,address, namespace, workflowId, runId: description.runId, taskQueue,
            workflowsPath, workflowSha256, temporalStatus: description.status.name,
            counts: counts(), temporalSignalCount: signalEvents.length, historyEventCount: history.events.length,
            inFlight, bindings, publishedStates: snapshots, result,
            activityAttempts,activityTimeouts,activityFailures,maxHistoryAttempt,
            safety: {realBrowserSends: 0, pluginEventsOrWrites: 0, enrollmentChanges: 0, productionActivitiesImported: false},
          }, null, 2));
        })(),
        new Promise((_, reject) => { scenarioTimer = setTimeout(() => reject(Error('55-second scenario deadline exceeded')), 55_000); }),
      ]);
    } finally {
      clearTimeout(scenarioTimer);
      if (handle && !completed) {
        await handle.terminate('Bounded synthetic smoke cleanup').catch(error => console.error('Termination cleanup:', error.message));
      }
    }
  });
} catch (error) {
  console.error(JSON.stringify({ok: false, address, workflowId, error: error.stack ?? String(error), counts: counts(), publishedStates: snapshots}, null, 2));
  process.exitCode = 1;
} finally {
  try {
    // runUntil shuts down on success and failure; cover errors before it starts as well.
    if (worker && ['INITIALIZED', 'RUNNING'].includes(worker.getState())) worker.shutdown();
    if (nativeConnection) await nativeConnection.close();
    if (connection) await connection.close();
    console.error('Smoke cleanup complete: worker stopped and Temporal connections closed.');
  } finally {
    clearTimeout(watchdog);
  }
}
