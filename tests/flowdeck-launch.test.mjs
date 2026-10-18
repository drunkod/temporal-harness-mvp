import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { launch, main } from '../scripts/flowdeck-launch.mjs';
import { drainForReadiness, preflightWorkflow, readEventConfig } from '../scripts/flowdeck-work-events.mjs';

const config = { 'plugin-repo': '/plugin', db: '/ledger.sqlite', directory: '/inbox',
  owner: 'owner', device: 'device', 'workflow-id': 'flowdeck-supervisor-demo' };
const waiting = { workflowId: config['workflow-id'], temporal: 'RUNNING',
  state: { projectId: 'demo', phase: 'waiting_for_manual_start' } };
const ready = { type: 'flowdeck.work-events.ready', workflowId: config['workflow-id'],
  ownerId: 'owner', deviceId: 'device', pending: 0, snapshot: null };
function harness(options = {}) {
  const active = { ...config, ...options.config };
  const runtimeWorkflowId = options.attempt ? `${active['workflow-id']}--${options.attempt}` : active['workflow-id'];
  const activeWaiting = { ...waiting, workflowId: runtimeWorkflowId, state: { ...waiting.state } };
  const activeReady = { ...ready, workflowId: runtimeWorkflowId, blocked: 0 };
  const calls = [], childArgs = [], children = [], messages = [], signals = new EventEmitter();
  let statuses = 0;
  const deps = {
    signals, stderr: { write() {} },
    readConfig: async () => active,
    inspectScope: async () => ({occupied:false,writes:false}),
    loadProject: async () => { calls.push('load'); return { id: 'demo', ownerId: 'owner', deviceId: 'device', ...options.project }; },
    delay: async () => {},
    exec: async (exe, args, opts) => {
      const action = args.includes('start') ? 'start' : args.includes('workflow-status') ? 'workflow-status' : args.at(-2);
      calls.push(action);
      assert.ok(opts.timeout > 0 && opts.timeout <= 5000);
      assert.equal(opts.env.TEMPORAL_ADDRESS, '127.0.0.1:7233');
      if (action === 'start') {
        if (options.startError) throw Error('uncertain start');
        return { stdout: '{}' };
      }
      const result = statuses++ === 0 ? (options.existing ?? { exists: false, workflowId: runtimeWorkflowId }) :
        (options.status ?? activeWaiting);
      return { stdout: JSON.stringify(result) };
    },
    spawn: (exe, args) => {
      childArgs.push(args);
      const name = args.includes('worker') ? 'worker' : 'follower';
      calls.push(name);
      const proc = new EventEmitter();
      proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
      proc.kills = [];
      proc.kill = signal => { proc.kills.push(signal); queueMicrotask(() => proc.emit('exit', 0, signal)); };
      children.push(proc);
      queueMicrotask(() => {
        if (options.exit === name) { proc.emit('exit', 7, null); return; }
        if (options.interrupt === name) { signals.emit('SIGINT'); return; }
        if (options.hold === name) return;
        if (name === 'worker') proc.stdout.write('REA');
        proc.stdout.write(name === 'worker' ? 'DY: worker\n' : JSON.stringify(activeReady) + '\n');
      });
      return proc;
    },
    log: line => {
      messages.push(line);
      if (line === 'ALL COMPONENTS READY MANUAL START NOW') {
        if (options.afterReadyExit) queueMicrotask(() => children[0].emit('exit', 0, null));
        else queueMicrotask(() => signals.emit(options.signal ?? 'SIGTERM'));
      }
    },
  };
  return { deps, calls, childArgs, children, messages, signals };
}

test('foreground sequence uses CLI once, waits for worker and follower, then cleans both on TERM', async () => {
  const h = harness();
  await launch('demo', '/events.json', h.deps);
  assert.deepEqual(h.calls, ['load', 'workflow-status', 'worker', 'start', 'workflow-status', 'follower']);
  assert.equal(h.messages.at(-1), 'ALL COMPONENTS READY MANUAL START NOW');
  assert.deepEqual(h.children.map(c => c.kills), [['SIGTERM'], ['SIGTERM']]);
  assert.equal(h.signals.listenerCount('SIGINT'), 0);
});

test('approved attempt uses a distinct workflow ID and isolated inbox without clearing the legacy config', async () => {
  const h = harness({ attempt: 'pilot' });
  await launch('demo', '/events.json', h.deps, 'pilot');
  assert.equal(h.calls.filter(call => call === 'start').length, 1);
  assert.ok(h.messages.some(message => message.includes('ALL COMPONENTS READY')));
  const followerArgs = h.childArgs.find(args => args.some(value => value.endsWith('flowdeck-work-events.mjs')));
  assert.ok(followerArgs.includes('flowdeck-supervisor-demo--pilot'));
  assert.ok(followerArgs.includes('/inbox/attempt-pilot'));
});

test('follower readiness must be machine-readable and match validated scope with no pending snapshot/delivery', async () => {
  const h = harness({ hold: 'follower' });
  const result = launch('demo', '/events.json', h.deps);
  await new Promise(resolve => setImmediate(resolve));
  const follower = h.children[1];
  for (const record of ['READY', { ...ready, ownerId: 'other' }, { ...ready, deviceId: 'other' },
    { ...ready, workflowId: 'other' }, { ...ready, pending: 1 }, { ...ready, snapshot: {} }]) {
    follower.stdout.write(typeof record === 'string' ? record + '\n' : JSON.stringify(record) + '\n');
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!h.messages.includes('ALL COMPONENTS READY MANUAL START NOW'));
  follower.stdout.write(JSON.stringify(ready) + '\n');
  await result;
  assert.equal(h.messages.at(-1), 'ALL COMPONENTS READY MANUAL START NOW');
});

test('scope, workflow ID and enrollment fail before any child or CLI', async () => {
  for (const options of [{ config: { 'workflow-id': 'other' } }, { config: { owner: 'other' } },
    { config: { device: 'other' } }, { project: { id: 'other' } }]) {
    const h = harness(options);
    await assert.rejects(launch('demo', '/events.json', h.deps), /match/);
    assert.equal(h.children.length, 0);
    assert.ok(!h.calls.includes('workflow-status'));
  }
  await assert.rejects(launch('demo', 'relative.json'), /Usage/);
  await assert.rejects(main([]), /Usage/);
  await assert.rejects(readEventConfig({ config: 'relative.json' }), /absolute/);
});

test('any existing workflow, including a closed execution, is rejected without spawning', async () => {
  const h = harness({ existing: { ...waiting, temporal: 'COMPLETED' } });
  await assert.rejects(launch('demo', '/events.json', h.deps), /already exists/);
  assert.equal(h.children.length, 0);
  assert.ok(!h.calls.includes('start'));
});

test('uncertain start is never retried and worker is cleaned', async () => {
  const h = harness({ startError: true });
  await assert.rejects(launch('demo', '/events.json', h.deps), /uncertain start/);
  assert.equal(h.calls.filter(c => c === 'start').length, 1);
  assert.deepEqual(h.children[0].kills, ['SIGTERM']);
});

test('wrong query project, non-running or non-manual phase cannot start follower', async () => {
  for (const status of [{ ...waiting, temporal: 'FAILED' }, { ...waiting, state: { projectId: 'other' } },
    { ...waiting, state: { projectId: 'demo', phase: 'paused' } }]) {
    const h = harness({ status });
    await assert.rejects(launch('demo', '/events.json', h.deps));
    assert.ok(!h.calls.includes('follower'));
    assert.ok(!h.messages.includes('ALL COMPONENTS READY MANUAL START NOW'));
  }
});

test('child exits fail clearly before or after readiness; no restart', async () => {
  for (const options of [{ exit: 'worker' }, { exit: 'follower' }, { afterReadyExit: true }]) {
    const h = harness(options);
    await assert.rejects(launch('demo', '/events.json', h.deps), /exited.*no automatic restart/);
    assert.ok(h.children.length <= 2);
    if (!options.afterReadyExit) assert.ok(!h.messages.includes('ALL COMPONENTS READY MANUAL START NOW'));
  }
});

test('SIGINT during startup cleans existing children without announcing readiness', async () => {
  const h = harness({ interrupt: 'follower' });
  await launch('demo', '/events.json', h.deps);
  assert.deepEqual(h.children.map(c => c.kills), [['SIGTERM'], ['SIGTERM']]);
  assert.ok(!h.messages.includes('ALL COMPONENTS READY MANUAL START NOW'));
});

test('readiness waits for complete snapshot, initial live drain, successful pending check, and no blocked terminal events', async () => {
  const order = [];
  let state = { cursor: 'head', snapshot: { nextWorkId: 'page-2' } }, more = false, pending = 0, blocked = 0;
  const pump = { drainOnce: async () => { order.push('drain'); return more; } };
  const checkpoint = { get: () => { order.push('checkpoint'); return state; } };
  const inbox = { retryPending: async () => { order.push('pending'); return { pending, blocked }; } };
  const check = () => drainForReadiness(pump, checkpoint, inbox);
  assert.equal((await check()).ready, false);
  state.snapshot = null; more = true;
  assert.equal((await check()).ready, false);
  more = false; pending = 1;
  assert.equal((await check()).ready, false);
  pending = 0;
  assert.equal((await check()).ready, true);
  blocked = 1;
  assert.equal((await check()).ready, false);
  state.cursor = null;
  assert.equal((await check()).ready, false);
  assert.deepEqual(order.slice(0, 3), ['drain', 'pending', 'checkpoint']);
  await assert.rejects(drainForReadiness({ drainOnce: async () => { throw Error('source failure'); } }, checkpoint, inbox), /source failure/);
  await assert.rejects(drainForReadiness(pump, checkpoint, { retryPending: async () => { throw Error('disk failure'); } }), /disk failure/);
});

test('launcher CLI rejects malformed explicit attempt arguments before reading or starting', async () => {
  await assert.rejects(main(['demo', 'relative.json', '--attempt', 'pilot']), /Usage/);
  await assert.rejects(main(['demo', '/events.json', '--attempt', 'bad/name']), /Usage/);
});

test('worker and follower startup stalls hit the single 30-second deadline and clean up', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  for (const name of ['worker', 'follower']) {
    const h = harness({ hold: name });
    const result = launch('demo', '/events.json', h.deps);
    const rejected = assert.rejects(result, /Startup exceeded 30 seconds/);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(h.calls.includes(name));
    t.mock.timers.tick(30_000);
    await rejected;
    assert.ok(!h.messages.includes('ALL COMPONENTS READY MANUAL START NOW'));
    assert.ok(h.children.every(child => child.kills.includes('SIGTERM')));
  }
});

test('loading query polling stops at 30 seconds without spawning follower or retrying start', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = harness({ status: { ...waiting, state: { projectId: 'demo', phase: 'loading' } } });
  h.deps.delay = () => new Promise(resolve => setTimeout(resolve, 200));
  const result = launch('demo', '/events.json', h.deps);
  const rejected = assert.rejects(result, /Startup exceeded 30 seconds/);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(30_000);
  await rejected;
  assert.ok(!h.calls.includes('follower'));
  assert.equal(h.calls.filter(call => call === 'start').length, 1);
});

test('follower preflight checks describe before query, validates project/manual wait and closes connection', async () => {
  for (const change of [{}, { status: 'COMPLETED' }, { phase: 'working' }, { projectId: 'other' }, { missing: true }]) {
    const calls = [];
    const connect = async () => ({
      connection: {
        withDeadline: async (deadline, fn) => { assert.ok(deadline - Date.now() <= 5000); return fn(); },
        close: async () => calls.push('close'),
      },
      client: { workflow: { getHandle: id => {
        assert.equal(id, config['workflow-id']);
        return {
          describe: async () => { calls.push('describe'); if (change.missing) throw Error('not found'); return { status: { name: change.status ?? 'RUNNING' } }; },
          query: async name => { calls.push('query'); assert.equal(name, 'flowdeckSupervisorStatus'); return { ...waiting.state, ...change }; },
        };
      } } },
    });
    if (Object.keys(change).length) await assert.rejects(preflightWorkflow(config, connect));
    else await preflightWorkflow(config, connect);
    assert.equal(calls[0], 'describe');
    assert.equal(calls.at(-1), 'close');
    if (change.status || change.missing) assert.ok(!calls.includes('query'));
  }
});

test('launcher rejects occupied device/profile before spawning a worker or running CLI',async()=>{
 const h=harness();
 h.deps.inspectScope=async()=>({occupied:true,writes:false});
 await assert.rejects(launch('demo','/events.json',h.deps,'different-attempt'),/browser-owner scope already claimed/i);
 assert.deepEqual(h.calls,['load']);
 assert.equal(h.children.length,0);
 assert.equal(h.signals.listenerCount('SIGINT'),0);
});

test('fresh attended launcher must pass the prepared-empty-tab guard before even querying or spawning',async()=>{
 const id='sashai-fresh-attended-20261020-07';
 const config={'workflow-id':'flowdeck-supervisor-'+id,'project-id':id};
 const h=harness({config,project:{id}});
 let checks=0;
 h.deps.verifyPrepared=async p=>{checks++;assert.equal(p.id,id);throw Error('prepared empty tab missing')};
 await assert.rejects(launch(id,'/events.json',h.deps),/prepared empty tab missing/);
 assert.equal(checks,1);
 assert.deepEqual(h.calls,['load']);
 assert.equal(h.children.length,0);
 assert.ok(!h.messages.some(s=>s.includes('ALL COMPONENTS READY')));
 const pass=harness({config,project:{id},status:{
  workflowId:'flowdeck-supervisor-'+id,temporal:'RUNNING',
  state:{projectId:id,phase:'waiting_for_manual_start'}
 }});
 let ready=0;
 pass.deps.verifyPrepared=async p=>{ready++;assert.equal(p.id,id);return{ready:true}};
 await launch(id,'/events.json',pass.deps);
 assert.equal(ready,1);
 assert.equal(pass.calls.filter(s=>s==='start').length,1);
 assert.ok(pass.messages.includes('ALL COMPONENTS READY MANUAL START NOW'));
});
