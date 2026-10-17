import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as budgetModule from '../dist/flowdeck-pilot-budget.js';

// Only execute the workflow: no activity implementation, browser, or Temporal client.
const filename = new URL('../src/flowdeck-supervisor-workflow.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  fileName: filename.pathname,
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const CHAT = 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111';
const NEXT_CHAT = 'https://chatgpt.com/c/22222222-2222-4222-8222-222222222222';

function fixtureProject() {
  return {
    id: 'supervisor-fixture', ownerId: 'fixture-owner', deviceId: 'fixture-device',
    repo: '/fixture/repo',
    projectUrl: 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project',
    initialTaskId: 'task-one',
    tasks: [
      {id: 'task-one', title: 'First implementation', instruction: 'Implement the first task.'},
      {id: 'task-two', title: 'Second implementation', instruction: 'Implement the second task.'},
    ],
  };
}

function workEvent(workId, kind, patch = {}) {
  const reported = kind === 'work_reported';
  return {
    schema: 'remote-mcp.work-event/v1', source: 'remote-mcp-jazz',
    eventId: `${workId}:${kind}`, workId, ownerId: 'fixture-owner', deviceId: 'fixture-device',
    kind, revision: reported ? 2 : 1,
    startedAt: '2026-10-15T00:00:00.000Z',
    sourceCommittedAt: reported ? '2026-10-15T00:01:00.000Z' : '2026-10-15T00:00:00.000Z',
    timestampEvidence: 'recorded_in_source_transaction',
    completionEvidence: reported ? 'agent_report_only' : 'none',
    executionVerified: false, backgroundProcesses: 'unknown', origin: 'event',
    ...(reported ? {reportedAt: '2026-10-15T00:01:00.000Z', outcome: 'success'} : {}),
    ...patch,
  };
}

const started = id => workEvent(id, 'work_started');
const reported = id => workEvent(id, 'work_reported');
const cycle = () => [
  started('manual-work'), reported('manual-work'),
  started('continued-work'), reported('continued-work'),
  started('next-work'), reported('next-work'),
];
const finished = decision => ({turn: 'finished', decision, summary: 'Bound ChatGPT answer (not acceptance).'});

async function run({project = fixtureProject(), events = [], overrides = {}, onActivity = () => {}, recovery, releaseRecovery = false, projectionPatch = true, budgetPatch = true} = {}) {
  const calls = [], sleeps = [], waits = [], snapshots = [], proxyOptions = [], unexpected = [], patches = [], proxyCalls = [];
  const handlers = new Map();
  const emit = event => handlers.get('supervisorWorkEvent')(plain(event));
  const defaults = {
    loadSupervisorProject: async id => {
      assert.equal(id, project.id);
      assert.equal(handlers.size, 2, 'query and signal handlers precede the first activity');
      for (const event of events) emit(event);
      return project;
    },
    publishSupervisorState: async state => {
      const {projection: publishedHealth, ...published} = plain(state);
      const {projection: queryHealth, ...queried} = plain(handlers.get('flowdeckSupervisorStatus')());
      assert.deepEqual(queried, published);
      snapshots.push(plain(state));
      if(releaseRecovery&&state.phase==='waiting_for_manual_start')handlers.get('supervisorRecoveryReady')?.();
    },
    adoptStartedWork: async (p, event, task, expectedBinding) => ({
      ...(expectedBinding ?? {projectId: p.id, taskId: task.id, chatUrl: CHAT, tabId: 'manual-tab'}),
      workId: event.workId,
    }),
    observeWorkResult: async (p, binding) => finished(binding.workId === 'manual-work' ? 'continue' : 'implementation_done'),
    // Sends retain the preceding workId until a subsequent work_started is adopted.
    sendContinuationOnce: async (p, binding) => ({...binding}),
    startNextTaskOnce: async (p, task, binding) => ({
      ...binding, taskId: task.id, chatUrl: NEXT_CHAT, tabId: 'next-tab',
    }),
    reconcileSubmittedTurn: async (p, binding) => ({status: 'ready', binding}),
    recoverPreSendOnce: async (p,binding,task) => ({...binding,taskId:task.id,chatUrl:NEXT_CHAT,tabId:'next-tab'}),
  };
  const activities = new Proxy(Object.fromEntries(Object.keys(defaults).map(name => [name, async (...args) => {
    calls.push({name, args: plain(args)});
    await onActivity(name, args, emit, () => handlers.get('flowdeckSupervisorStatus')());
    return (overrides[name] ?? defaults[name])(...args);
  }])), {
    get(target, name) {
      if (Object.hasOwn(target, name)) return target[name];
      return async () => {
        unexpected.push(String(name));
        throw new Error(`Unexpected activity: ${String(name)}`);
      };
    },
  });
  const shim = {
    defineSignal: name => name,
    defineQuery: name => name,
    setHandler: (name, callback) => {
      assert.ok(['supervisorWorkEvent', 'flowdeckSupervisorStatus', 'supervisorRecoveryReady'].includes(name));
      assert.equal(handlers.has(name), false);
      handlers.set(name, callback);
    },
    patched: id => { patches.push(id); return id==='flowdeck-status-projection-isolation-v1'?projectionPatch:budgetPatch; },
    isCancellation: error => error?.name === 'CancelledFailure',
    proxyActivities: options => {
      proxyOptions.push(plain(options));
      return new Proxy(activities, {get(target, name) {
        return (...args) => {
          proxyCalls.push({name, options:plain(options)});
          return target[name](...args);
        };
      }});
    },
    condition: async (predicate, timeout) => {
      waits.push(timeout);
      assert.ok(waits.length <= 2, 'waiting must be bounded, not a busy loop');
      return predicate();
    },
    sleep: async duration => { sleeps.push(duration); },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: name => {
      if(name==='./flowdeck-pilot-budget.js')return budgetModule;
      assert.equal(name, '@temporalio/workflow', 'runtime imports fail closed');
      return shim;
    },
  }, {filename: filename.pathname, timeout: 1000});
  const state = plain(await (recovery ? exports.flowdeckRecoverSend(recovery) : exports.flowdeckSupervisor(project.id)));
  assert.equal(exports.supervisorWorkEvent, 'supervisorWorkEvent');
  assert.equal(exports.supervisorStatus, 'flowdeckSupervisorStatus');
  assert.deepEqual(plain(handlers.get('flowdeckSupervisorStatus')()), state);
  const originalPolicy = {startToCloseTimeout: '2 minutes', retry: {maximumAttempts: 1}};
  const projectionPolicy = {startToCloseTimeout: '5 seconds', scheduleToCloseTimeout: '15 seconds',
    retry: {maximumAttempts: 2, initialInterval: '1 second', maximumInterval: '2 seconds'}};
  assert.deepEqual(proxyOptions, projectionPatch ? [originalPolicy, projectionPolicy] : [originalPolicy]);
  assert.deepEqual(patches, ['flowdeck-status-projection-isolation-v1','flowdeck-attended-pilot-send-budget-v1']);
  for (const call of proxyCalls) assert.deepEqual(call.options,
    projectionPatch && call.name === 'publishSupervisorState' ? projectionPolicy : originalPolicy);
  assert.deepEqual(unexpected, [], 'no generic initial dispatch, acceptance, or code-review activities');
  for (const timeout of waits) assert.ok(['30 minutes','10 minutes'].includes(timeout));
  for (const duration of sleeps) assert.ok(['2 seconds', '5 seconds'].includes(duration));
  const named = name => calls.filter(call => call.name === name);
  return {state, calls, named, sleeps, waits, snapshots, query:handlers.get('flowdeckSupervisorStatus')};
}

test('projection outage does not prevent a complete authorized synthetic cycle', async () => {
  const result = await run({events:cycle(), overrides:{publishSupervisorState:async()=>{
    throw Error('Disk unavailable; secret=must-not-appear');
  }}});
  assert.equal(result.state.phase, 'approved_cycle_finished');
  assert.equal(result.named('sendContinuationOnce').length, 1);
  assert.equal(result.named('startNextTaskOnce').length, 1);
  assert.equal(result.state.projection.status, 'degraded');
  assert.equal(result.state.projection.lastPublishedAt, null);
  assert.equal(result.state.projection.consecutiveFailures, result.named('publishSupervisorState').length);
  assert.doesNotMatch(JSON.stringify(result.state), /must-not-appear|Disk unavailable/);
  const query = result.query();
  query.projection.status = 'healthy';
  assert.equal(result.query().projection.status, 'degraded', 'query cannot mutate authoritative health');
});

test('successful publication clears degraded health and records the published snapshot time', async () => {
  let count = 0;
  const result = await run({events:cycle(), overrides:{publishSupervisorState:async()=>{
    if (++count === 1) throw Error('Temporary projection failure');
  }}});
  assert.equal(result.state.phase, 'approved_cycle_finished');
  assert.deepEqual(result.state.projection, {status:'healthy',consecutiveFailures:0,lastPublishedAt:result.state.updatedAt});
});

test('a failed final publication preserves the last confirmed publication time', async () => {
  let lastPublishedAt;
  const result = await run({events:cycle(), overrides:{publishSupervisorState:async state=>{
    if (state.phase === 'approved_cycle_finished') throw Error('Final write failed');
    lastPublishedAt = state.updatedAt;
  }}});
  assert.equal(result.state.phase, 'approved_cycle_finished');
  assert.deepEqual(result.state.projection, {status:'degraded',consecutiveFailures:1,lastPublishedAt});
});

test('send or journal failure still pauses when projection is unavailable', async () => {
  const result = await run({events:cycle(), overrides:{
    publishSupervisorState:async()=>{throw Error('Projection down');},
    sendContinuationOnce:async()=>{throw Error('Journal unavailable');},
  }});
  paused(result, /reconcile/);
  assert.equal(result.named('sendContinuationOnce').length, 1);
  assert.equal(result.named('startNextTaskOnce').length, 0);
  assert.equal(result.state.projection.status, 'degraded');
});

test('projection outage cannot turn failed enrollment into dispatch authority', async () => {
  const result = await run({overrides:{
    loadSupervisorProject:async()=>{throw Error('Enrollment unavailable');},
    publishSupervisorState:async()=>{throw Error('Projection down');},
  }});
  paused(result, /enrollment/);
  noSends(result);
  assert.equal(result.state.projection.status, 'degraded');
});

test('projection failure does not bypass a missing recovery release', async () => {
  const result = await run({recovery:recoveryFixture(), overrides:{publishSupervisorState:async()=>{throw Error('Projection down');}}});
  paused(result, /readiness release timed out/);
  assert.equal(result.named('recoverPreSendOnce').length, 0);
});

test('projection cancellation propagates instead of allowing dispatch', async () => {
  let sends = 0;
  const cancelled = Object.assign(Error('cancelled'), {name:'CancelledFailure'});
  await assert.rejects(run({events:cycle(), overrides:{publishSupervisorState:async()=>{throw cancelled;}},
    onActivity:name=>{if(name==='sendContinuationOnce'||name==='startNextTaskOnce')sends++;}}),
    error=>error===cancelled);
  assert.equal(sends, 0);
});

test('unpatched history retains original publication behavior and payload shape', async () => {
  const result = await run({events:cycle(), projectionPatch:false});
  assertCompleteCycle(result, fixtureProject(), cycle());
  assert.equal(Object.hasOwn(result.state, 'projection'), false);
  assert.ok(result.snapshots.every(state=>!Object.hasOwn(state, 'projection')));
  const failure = Error('Legacy projection failure');
  await assert.rejects(run({projectionPatch:false,overrides:{publishSupervisorState:async()=>{throw failure;}}}),
    error=>error===failure);
});

function paused(result, reason) {
  assert.equal(result.state.phase, 'needs_attention');
  assert.equal(result.state.status, 'paused');
  assert.match(result.state.blocker, reason);
}

function noSends(result) {
  assert.equal(result.named('sendContinuationOnce').length, 0);
  assert.equal(result.named('startNextTaskOnce').length, 0);
}

function assertCompleteCycle(result, project, events) {
  assert.equal(result.state.phase, 'approved_cycle_finished');
  assert.equal(result.state.status, 'implementation_done_review_pending');
  assert.equal(result.state.blocker, null);
  assert.equal(result.state.taskId, 'task-two');
  assert.equal(result.state.workId, 'next-work');
  assert.equal(result.state.chatUrl, NEXT_CHAT);
  assert.equal(result.state.tabId, 'next-tab');
  assert.deepEqual(result.state.lastEvent, {kind: 'work_reported', eventId: events[5].eventId, workId: 'next-work'});
  for (const task of result.state.tasks) {
    assert.equal(task.implementationStatus, 'implementation_done');
    assert.equal(task.reviewStatus, 'review_pending');
  }
  assert.equal(result.state.tasks.length, 2);
  const first = project.tasks.find(t => t.id === project.initialTaskId);
  const next = project.tasks.find(t => t.id === 'task-two');
  const manual = {projectId: project.id, taskId: first.id, chatUrl: CHAT, tabId: 'manual-tab', workId: 'manual-work'};
  const continued = {...manual, workId: 'continued-work'};
  const expectedNext = {...continued, taskId: next.id, chatUrl: NEXT_CHAT, tabId: 'next-tab'};
  const adoptedNext = {...expectedNext, workId: 'next-work'};
  assert.deepEqual(result.named('adoptStartedWork').map(call => call.args), [
    [project, events[0], first, null],
    [project, events[2], first, manual],
    [project, events[4], next, expectedNext],
  ]);
  assert.deepEqual(result.named('sendContinuationOnce').map(call => call.args), [[project, manual, first, events[1]]]);
  assert.deepEqual(result.named('startNextTaskOnce').map(call => call.args), [[project, next, continued, events[3]]]);
  assert.deepEqual(result.named('observeWorkResult').map(call => call.args), [
    [project, manual, events[1]], [project, continued, events[3]], [project, adoptedNext, events[5]],
  ]);
  assert.deepEqual(result.calls.filter(call => call.name !== 'publishSupervisorState').map(call => call.name), [
    'loadSupervisorProject', 'adoptStartedWork', 'observeWorkResult', 'sendContinuationOnce', 'reconcileSubmittedTurn',
    'adoptStartedWork', 'observeWorkResult', 'startNextTaskOnce', 'reconcileSubmittedTurn', 'adoptStartedWork', 'observeWorkResult',
  ]);
  assert.deepEqual(result.snapshots.map(state => state.phase), [
    'waiting_for_manual_start', 'working', 'waiting_for_chat_response', 'sending_continuation',
    'waiting_for_submitted_turn', 'waiting_for_work_start', 'working', 'waiting_for_chat_response', 'implementation_done',
    'starting_next_project_chat', 'waiting_for_submitted_turn', 'waiting_for_work_start', 'working', 'waiting_for_chat_response',
    'implementation_done', 'approved_cycle_finished',
  ]);
  assert.deepEqual(result.waits, []);
  assert.deepEqual(result.sleeps, []);
}

test('pending adoption publishes its workId, buffers matching reports, and is bounded', async () => {
  const project = fixtureProject(), events = [started('manual-work'), reported('manual-work')];
  let attempts = 0;
  const result = await run({project, events, overrides: {
    adoptStartedWork: async (p, event, task, expected) => {
      if (++attempts === 1) return {status: 'waiting', reason: 'not_hydrated', binding: expected};
      return {...(expected ?? {projectId: p.id, taskId: task.id, chatUrl: CHAT, tabId: 'manual-tab'}), workId: event.workId};
    },
  }});
  assert.equal(result.state.phase, 'needs_attention', 'the fixture stops after the matching report is reconciled only when adoption succeeds');
  assert.ok(result.snapshots.some(s => s.phase === 'pending_adoption' && s.workId === 'manual-work'));
  assert.ok(result.sleeps.includes('5 seconds'));
});

test('a different work session cannot alternate into a pending adoption slot', async () => {
  const other = started('other-work');
  const result = await run({events: [started('manual-work')], overrides: {
    adoptStartedWork: async () => ({status: 'waiting', reason: 'not_hydrated'}),
  }, onActivity: async (name, args, emit) => {
    if (name === 'adoptStartedWork') emit(other);
  }});
  paused(result, /different work session|pending adoption/);
});

test('adoption waiting has an explicit attempt cap instead of requeueing forever', async () => {
  const result = await run({events: [started('manual-work')], overrides: {
    adoptStartedWork: async () => ({status: 'waiting', reason: 'not_hydrated'}),
  }});
  paused(result, /bounded deadline/);
  assert.equal(result.named('adoptStartedWork').length, 120);
  assert.equal(result.named('sendContinuationOnce').length, 0);
});

test('reconcile activity errors pause the workflow instead of failing it', async () => {
  const result = await run({events: cycle(), overrides: {
    reconcileSubmittedTurn: async () => { throw new Error('prompt mismatch'); },
  }});
  paused(result, /reconciliation found an identity or prompt mismatch/);
});

test('two-task cycle adopts one manual original, continues same chat once, then starts one new chat; review stays pending', async () => {
  const project = fixtureProject();
  // The explicit initialTaskId, not array order, identifies the manual original.
  project.tasks.reverse();
  const events = cycle();
  assert.equal(new Set(events.map(event => event.eventId)).size, 6);
  assertCompleteCycle(await run({project, events}), project, events);
});

test('duplicate signals and same-revision redelivery cannot repeat adoption or either send', async () => {
  const project = fixtureProject(), events = cycle();
  const delivered = events.flatMap(event => [event, {...event}, {...event, eventId: `${event.eventId}:redelivery`}]);
  assertCompleteCycle(await run({project, events: delivered}), project, events);
});

test('start/report signals queued during both sends are adopted only after their send resolves', async () => {
  const project = fixtureProject(), events = cycle();
  const result = await run({project, events: events.slice(0, 2), onActivity: async (name, args, emit) => {
    const offset = name === 'sendContinuationOnce' ? 2 : name === 'startNextTaskOnce' ? 4 : null;
    if (offset === null) return;
    emit(events[offset]);
    await Promise.resolve();
    emit(events[offset + 1]);
    emit({...events[offset + 1], eventId: `${events[offset + 1].eventId}:redelivery`});
  }});
  assertCompleteCycle(result, project, events);
  for (const snapshot of result.snapshots.filter(s => s.phase === 'waiting_for_work_start')) {
    assert.equal(snapshot.workId, null, 'the preceding work must not be bound to the next turn/task');
  }
});

test('reports delivered before starts, including during sends, do not suppress adoption', async () => {
  const project = fixtureProject(), events = cycle();
  assertCompleteCycle(await run({project, events: [events[1], events[0]], onActivity: (name, args, emit) => {
    const offset = name === 'sendContinuationOnce' ? 2 : name === 'startNextTaskOnce' ? 4 : null;
    if (offset === null) return;
    emit(events[offset + 1]);
    emit({...events[offset + 1], eventId: `${events[offset + 1].eventId}:redelivery`});
    emit(events[offset]);
  }}), project, events);
});

test('stale reports and invalid revisions cannot resend the preceding turn or poison dedup', async () => {
  const project = fixtureProject(), events = cycle();
  const result = await run({project, events: [
    {...events[0], revision: 99},
    events[0], events[1],
    {...events[1], eventId: 'stale-report', revision: 3},
    {...events[1], eventId: 'redelivered-report'},
    ...events.slice(2),
  ]});
  assertCompleteCycle(result, project, events);
});

test('an unrelated report cannot authorize observation or consume a live event identity', async () => {
  const project = fixtureProject(), events = cycle();
  const result = await run({project, events: [
    reported('unrelated-work'), {...events[1], workId: 'unrelated-work'}, ...events,
  ]});
  assertCompleteCycle(result, project, events);
});

test('a report without its start remains unauthorized and times out without a busy loop', async () => {
  const result = await run({events: [reported('manual-work'), reported('manual-work')]});
  paused(result, /No new work-session event/);
  noSends(result);
  assert.equal(result.named('adoptStartedWork').length, 0);
  assert.equal(result.named('observeWorkResult').length, 0);
  assert.equal(result.state.lastEvent, null);
  assert.deepEqual(result.waits, ['30 minutes']);
});

test('a different work start while the current work is unresolved pauses without sending', async () => {
  const result = await run({events: [started('manual-work'), started('unrelated-work'), reported('manual-work')]});
  paused(result, /Another work session started/);
  noSends(result);
  assert.equal(result.named('adoptStartedWork').length, 1);
  assert.equal(result.named('observeWorkResult').length, 0);
});

test('snapshots are ignored without consuming the corresponding live event identity/revision', async () => {
  const project = fixtureProject(), events = cycle();
  const delivered = events.flatMap(event => [{...event, origin: 'snapshot'}, event]);
  assertCompleteCycle(await run({project, events: delivered}), project, events);
  const snapshotsOnly = await run({events: events.map(event => ({...event, origin: 'snapshot'}))});
  noSends(snapshotsOnly);
  assert.equal(snapshotsOnly.named('adoptStartedWork').length, 0);
  assert.equal(snapshotsOnly.named('observeWorkResult').length, 0);
  assert.equal(snapshotsOnly.state.lastEvent, null);
  paused(snapshotsOnly, /No new work-session event/);
});

for (const turn of ['finished', 'unknown']) {
  test(`work_reported success alone with ${turn}/unknown observation pauses without sending`, async () => {
    const result = await run({
      events: cycle().slice(0, 2),
      overrides: {observeWorkResult: async () => ({turn, decision: 'unknown', summary: 'Plugin success only.'})},
    });
    paused(result, /observation_timeout|no unambiguous finished\/continue decision/);
    noSends(result);
    assert.equal(result.named('observeWorkResult').length, turn === 'finished' ? 1 : 60);
    assert.equal(result.sleeps.length, turn === 'finished' ? 0 : 60);
    assert.equal(result.state.tasks[0].implementationStatus, 'working');
    assert.equal(result.state.tasks[0].reviewStatus, 'not_started');
  });
}

test('failed adoption pauses once without dispatching or observing', async () => {
  const result = await run({events: cycle(), overrides: {
    adoptStartedWork: async () => { throw new Error('Ambiguous chat correlation'); },
  }});
  paused(result, /Cannot uniquely correlate/);
  noSends(result);
  assert.equal(result.named('adoptStartedWork').length, 1);
  assert.equal(result.named('observeWorkResult').length, 0);
});

for (const activity of ['sendContinuationOnce', 'startNextTaskOnce']) {
  test(`uncertain ${activity} pauses without retry, even with more queued signals`, async () => {
    const events = cycle();
    const result = await run({events: [...events, ...events], overrides: {
      [activity]: async () => { throw new Error('Click may have happened; receipt unavailable'); },
    }});
    paused(result, activity === 'sendContinuationOnce' ? /Continuation may have been submitted/ : /Next-chat send may have occurred/);
    assert.equal(result.named(activity).length, 1);
    assert.equal(result.named('adoptStartedWork').length, activity === 'sendContinuationOnce' ? 1 : 2);
    assert.equal(result.named('startNextTaskOnce').length, activity === 'sendContinuationOnce' ? 0 : 1);
    assert.equal(result.named('sendContinuationOnce').length, 1);
    assert.deepEqual(result.waits, []);
  });
}

for (const activity of ['sendContinuationOnce', 'startNextTaskOnce']) {
  test(`signals during uncertain ${activity} cannot authorize adoption or another send`, async () => {
    const events = cycle();
    const result = await run({events: events.slice(0, 2), onActivity: (name, args, emit) => {
      if (name === 'sendContinuationOnce') events.slice(2, 4).forEach(emit);
      if (name === 'startNextTaskOnce') events.slice(4).forEach(emit);
    }, overrides: {
      [activity]: async () => { throw new Error('Send outcome uncertain'); },
    }});
    paused(result, /may have/);
    assert.equal(result.named('adoptStartedWork').length, activity === 'sendContinuationOnce' ? 1 : 2);
    assert.equal(result.named('sendContinuationOnce').length, 1);
    assert.equal(result.named('startNextTaskOnce').length, activity === 'sendContinuationOnce' ? 0 : 1);
  });
}

for (const patch of [
  {projectId: 'other-project'}, {taskId: 'task-two'}, {workId: 'other-work'}, {chatUrl: ''}, {tabId: ''},
]) {
  test(`adoption rejects a mismatched ${Object.keys(patch)[0]} before observing or sending`, async () => {
    const result = await run({events: cycle(), overrides: {
      adoptStartedWork: async (p, event, task) => ({
        projectId: p.id, taskId: task.id, workId: event.workId, chatUrl: CHAT, tabId: 'manual-tab', ...patch,
      }),
    }});
    paused(result, /Cannot uniquely correlate/);
    noSends(result);
    assert.equal(result.named('observeWorkResult').length, 0);
  });
}

for (const activity of ['sendContinuationOnce', 'startNextTaskOnce']) {
  test(`${activity} rejects a wrong destination receipt without adopting queued work`, async () => {
    const result = await run({events: cycle(), overrides: {
      [activity]: async (p, taskOrBinding, binding) => activity === 'sendContinuationOnce'
        ? {...taskOrBinding, chatUrl: NEXT_CHAT}
        : {...binding, taskId: taskOrBinding.id},
    }});
    paused(result, /may have/);
    assert.equal(result.named(activity).length, 1);
    assert.equal(result.named('adoptStartedWork').length, activity === 'sendContinuationOnce' ? 1 : 2);
  });
}

test('post-send adoption must retain the expected task/chat/tab', async () => {
  const result = await run({events: cycle(), overrides: {
    adoptStartedWork: async (p, event, task, expected) => ({
      ...(expected ?? {projectId: p.id, taskId: task.id, chatUrl: CHAT, tabId: 'manual-tab'}),
      workId: event.workId, ...(expected ? {tabId: 'unrelated-tab'} : {}),
    }),
  }});
  paused(result, /Cannot uniquely correlate/);
  assert.equal(result.named('observeWorkResult').length, 1);
  assert.equal(result.named('sendContinuationOnce').length, 1);
  assert.equal(result.named('startNextTaskOnce').length, 0);
});

test('the next eligible independent approved task is selected past a review-blocked task', async () => {
  const project = fixtureProject(), events = cycle();
  project.tasks.splice(1, 0, {id: 'blocked-task', title: 'Needs review', instruction: 'Do not start yet.', dependsOn: ['task-one']});
  const result = await run({project, events});
  paused(result, /depends on external review/);
  assert.equal(result.named('startNextTaskOnce').length, 1);
  assert.equal(result.named('startNextTaskOnce')[0].args[1].id, 'task-two');
  assert.deepEqual(result.state.tasks.map(t => [t.id, t.implementationStatus, t.reviewStatus]), [
    ['task-one', 'implementation_done', 'review_pending'],
    ['blocked-task', 'approved', 'not_started'],
    ['task-two', 'implementation_done', 'review_pending'],
  ]);
});

test('implementation_done does not satisfy the next task dependency on external review', async () => {
  const project = fixtureProject();
  project.tasks[1].dependsOn = [project.initialTaskId];
  const result = await run({project, events: cycle().slice(0, 4)});
  paused(result, /depends on external review/);
  assert.equal(result.named('sendContinuationOnce').length, 1);
  assert.equal(result.named('startNextTaskOnce').length, 0);
  assert.deepEqual(result.state.tasks.map(t => [t.implementationStatus, t.reviewStatus]), [
    ['implementation_done', 'review_pending'], ['approved', 'not_started'],
  ]);
});

test('requiresReviewBeforeNext blocks even an otherwise independent next task', async () => {
  const project = fixtureProject();
  project.tasks[0].requiresReviewBeforeNext = true;
  const result = await run({project, events: cycle().slice(0, 4)});
  paused(result, /requires external review before advancing/);
  assert.equal(result.named('startNextTaskOnce').length, 0);
  assert.equal(result.state.tasks[0].reviewStatus, 'review_pending');
  assert.equal(result.state.tasks[1].implementationStatus, 'approved');
});

test('no event performs no sends or adoption and times out via one bounded condition', async () => {
  const result = await run();
  paused(result, /No new work-session event within the bounded waiting period/);
  noSends(result);
  assert.equal(result.named('adoptStartedWork').length, 0);
  assert.equal(result.named('observeWorkResult').length, 0);
  assert.deepEqual(result.waits, ['30 minutes']);
  assert.deepEqual(result.sleeps, []);
  assert.equal(result.state.lastEvent, null);
});

for (const patch of [{ownerId: 'other-owner'}, {deviceId: 'other-device'}]) {
  test(`events outside enrolled ${Object.keys(patch)[0]} cannot adopt or send`, async () => {
    const result = await run({events: cycle().map(event => ({...event, ...patch}))});
    paused(result, /No new work-session event/);
    noSends(result);
    assert.equal(result.named('adoptStartedWork').length, 0);
    assert.equal(result.state.lastEvent, null);
  });
}

function recoveryFixture(){const project=fixtureProject();return {projectId:project.id,taskId:'task-two',completedTaskId:'task-one',phase:'next',previous:{projectId:project.id,taskId:'task-one',chatUrl:CHAT,tabId:'manual-tab',workId:'continued-work'},event:reported('continued-work'),authorization:{authorizationId:'fixture-auth'}};}
test('B-only recovery waits for follower readiness then handles report-before-start without replaying A',async()=>{
 const r=await run({recovery:recoveryFixture(),releaseRecovery:true,events:[reported('next-work'),started('next-work')]});
 assert.equal(r.state.phase,'approved_cycle_finished');
 assert.equal(r.named('recoverPreSendOnce').length,1);
 assert.equal(r.named('sendContinuationOnce').length,0);assert.equal(r.named('startNextTaskOnce').length,0);
 assert.equal(r.named('adoptStartedWork').length,1);
 assert.deepEqual(r.state.tasks.map(t=>t.implementationStatus),['implementation_done','implementation_done']);
 assert.ok(r.state.tasks.every(t=>t.reviewStatus==='review_pending'));
});
test('B recovery without explicit readiness release performs no send',async()=>{
 const r=await run({recovery:recoveryFixture()});paused(r,/readiness release timed out/);assert.equal(r.named('recoverPreSendOnce').length,0);
});

const boundedProject=()=>({...fixtureProject(),id:'sashai-fresh-attended-fixture',
 attendedPilotBudget:{schema:'flowdeck.attended-pilot-budget/v1',initialTaskId:'task-one',nextTaskId:'task-two'}});

test('bounded pilot reserves exactly one continuation and one independent next-chat send',async()=>{
 const result=await run({project:boundedProject(),events:cycle()});
 assert.equal(result.state.phase,'approved_cycle_finished');
 assert.equal(result.named('sendContinuationOnce').length,1);
 assert.equal(result.named('startNextTaskOnce').length,1);
 assert.deepEqual(result.state.pilotBudget.usage,{p1Continuations:1,nextChatSubmissions:1,totalAutomatedSubmissions:2});
 assert.deepEqual(plain(result.query().pilotBudget.usage),result.state.pilotBudget.usage);
});
test('a second unfinished P1 report pauses before another continuation activity',async()=>{
 const result=await run({project:boundedProject(),events:[
  started('manual-work'),reported('manual-work'),started('continued-work'),reported('continued-work')],
  overrides:{observeWorkResult:async()=>finished('continue')}});
 assert.equal(result.state.phase,'needs_attention');
 assert.match(result.state.blocker,/p1_continuation_budget_exhausted/);
 assert.equal(result.named('sendContinuationOnce').length,1);
 assert.equal(result.named('startNextTaskOnce').length,0);
 assert.equal(result.state.pilotBudget.usage.totalAutomatedSubmissions,1);
});
test('P2 unfinished cannot be continued and never dispatches another chat',async()=>{
 const result=await run({project:boundedProject(),events:[
  started('manual-work'),reported('manual-work'),started('next-work'),reported('next-work')],
  overrides:{observeWorkResult:async(_p,binding)=>finished(binding.taskId==='task-two'?'continue':'implementation_done')}});
 assert.equal(result.state.phase,'needs_attention');
 assert.match(result.state.blocker,/continuation_not_allowed_for_task/);
 assert.equal(result.named('sendContinuationOnce').length,0);
 assert.equal(result.named('startNextTaskOnce').length,1);
 assert.equal(result.state.pilotBudget.usage.totalAutomatedSubmissions,1);
});
test('P1 completion can advance P2 with zero P1 continuations',async()=>{
 const result=await run({project:boundedProject(),events:[
  started('manual-work'),reported('manual-work'),started('next-work'),reported('next-work')],
  overrides:{observeWorkResult:async()=>finished('implementation_done')}});
 assert.equal(result.state.phase,'approved_cycle_finished');
 assert.equal(result.named('sendContinuationOnce').length,0);
 assert.equal(result.named('startNextTaskOnce').length,1);
 assert.deepEqual(result.state.pilotBudget.usage,{p1Continuations:0,nextChatSubmissions:1,totalAutomatedSubmissions:1});
});
test('a failed P1 continuation never refunds its reservation or schedules P2',async()=>{
 const result=await run({project:boundedProject(),events:[started('manual-work'),reported('manual-work')],
  overrides:{sendContinuationOnce:async()=>{throw Error('fake uncertain submission')}}});
 assert.equal(result.state.phase,'needs_attention');
 assert.equal(result.named('sendContinuationOnce').length,1);
 assert.equal(result.named('startNextTaskOnce').length,0);
 assert.equal(result.state.pilotBudget.usage.totalAutomatedSubmissions,1);
});
test('a failed P2 new-chat send never retries after consuming its reservation',async()=>{
 const result=await run({project:boundedProject(),events:[started('manual-work'),reported('manual-work')],
  overrides:{
   observeWorkResult:async()=>finished('implementation_done'),
   startNextTaskOnce:async()=>{throw Error('fake click acknowledgement lost');}
  }});
 assert.equal(result.state.phase,'needs_attention');
 assert.equal(result.named('startNextTaskOnce').length,1);
 assert.equal(result.state.pilotBudget.usage.totalAutomatedSubmissions,1);
});
test('optional dashboard outage cannot bypass bounded pilot send counter',async()=>{
 const result=await run({project:boundedProject(),events:cycle(),overrides:{
  publishSupervisorState:async()=>{throw Error('fake offline dashboard')}
 }});
 assert.equal(result.state.phase,'approved_cycle_finished');
 assert.equal(result.state.projection.status,'degraded');
 assert.equal(result.named('sendContinuationOnce').length,1);
 assert.equal(result.named('startNextTaskOnce').length,1);
 assert.equal(result.state.pilotBudget.usage.totalAutomatedSubmissions,2);
});
test('fresh pilot missing or invalid authoritative policy pauses before any activity send',async()=>{
 for(const project of [
  {...boundedProject(),attendedPilotBudget:undefined},
  {...boundedProject(),attendedPilotBudget:{schema:'broken',initialTaskId:'task-one',nextTaskId:'task-two'}},
  {...boundedProject(),tasks:[...boundedProject().tasks,{id:'task-three',title:'Third',instruction:'no'}]},
 ]){
  const result=await run({project,events:cycle()});
  assert.equal(result.state.phase,'needs_attention');
  assert.equal(result.named('sendContinuationOnce').length,0);
  assert.equal(result.named('startNextTaskOnce').length,0);
  assert.equal(result.named('adoptStartedWork').length,0);
 }
});
test('bounded pilot recovery refuses release before any recovery send or dispatch',async()=>{
 const project=boundedProject(),previous={projectId:project.id,taskId:'task-one',
  workId:'manual-work',chatUrl:CHAT,tabId:'manual-tab'};
 const result=await run({project,recovery:{projectId:project.id,taskId:'task-two',
  completedTaskId:'task-one',phase:'next',previous,event:reported('manual-work'),
  authorization:{kind:'fixture',authorizationId:'none'}},releaseRecovery:true});
 assert.equal(result.state.phase,'needs_attention');
 assert.match(result.state.blocker,/recovery is not authorized/);
 assert.equal(result.named('recoverPreSendOnce').length,0);
 assert.equal(result.named('startNextTaskOnce').length,0);
});
test('legacy history patch branch retains the six-continuation logic',async()=>{
 const project=boundedProject();
 const result=await run({project,events:[
  started('manual-work'),reported('manual-work'),started('continued-work'),reported('continued-work')],
  budgetPatch:false,overrides:{observeWorkResult:async()=>finished('continue')}});
 assert.equal(result.named('sendContinuationOnce').length,2);
 assert.equal(result.state.pilotBudget,undefined);
});

test('pilot reservations are visible in authoritative query before fake send activities are invoked',async()=>{
 const atSend=[];
 const result=await run({project:boundedProject(),events:cycle(),onActivity:(name,_args,_emit,query)=>{
  if(name==='sendContinuationOnce'||name==='startNextTaskOnce'){
   atSend.push({activity:name,usage:plain(query().pilotBudget.usage)});
  }
 }});
 assert.equal(result.state.phase,'approved_cycle_finished');
 assert.deepEqual(atSend,[
  {activity:'sendContinuationOnce',usage:{p1Continuations:1,nextChatSubmissions:0,totalAutomatedSubmissions:1}},
  {activity:'startNextTaskOnce',usage:{p1Continuations:1,nextChatSubmissions:1,totalAutomatedSubmissions:2}}
 ]);
});
test('duplicate report events cannot reserve a second pilot send',async()=>{
 const duplicate=reported('manual-work');
 const duplicateNext=reported('next-work');
 const events=[started('manual-work'),reported('manual-work'),duplicate,
  started('continued-work'),reported('continued-work'),
  started('next-work'),reported('next-work'),duplicateNext];
 const result=await run({project:boundedProject(),events});
 assert.equal(result.state.phase,'approved_cycle_finished');
 assert.equal(result.named('sendContinuationOnce').length,1);
 assert.equal(result.named('startNextTaskOnce').length,1);
 assert.equal(result.state.pilotBudget.usage.totalAutomatedSubmissions,2);
});
test('cancellation at optional publication after P1 reservation prevents scheduling the continuation',async()=>{
 const attempted=[];
 const cancelled=Object.assign(Error('synthetic cancellation before browser dispatch'),{name:'CancelledFailure'});
 await assert.rejects(run({project:boundedProject(),
  events:[started('manual-work'),reported('manual-work')],
  onActivity:(name,_args,_emit,query)=>{
   attempted.push(name);
   if(name==='publishSupervisorState'&&query().phase==='sending_continuation'){
    assert.equal(query().pilotBudget.usage.totalAutomatedSubmissions,1);
    throw cancelled;
   }
  }}),/synthetic cancellation before browser dispatch/);
 assert.equal(attempted.filter(x=>x==='sendContinuationOnce').length,0);
 assert.equal(attempted.filter(x=>x==='startNextTaskOnce').length,0);
});
