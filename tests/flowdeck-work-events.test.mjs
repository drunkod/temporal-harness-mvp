import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { createWorkEventInbox } from '../src/flowdeck-work-events.ts';
import { parseOptions, workflowProjectId, classifySignalFailure } from '../scripts/flowdeck-work-events.mjs';
import { WorkflowNotFoundError } from '@temporalio/client';

const event = (overrides = {}) => ({
  schema: 'remote-mcp.work-event/v1', source: 'remote-mcp-jazz',
  eventId: 'event-1', workId: 'work-1', ownerId: 'owner', deviceId: 'device',
  kind: 'work_started', revision: 1, sourceCommittedAt: '2026-10-15T00:00:00.000Z',
  startedAt: '2026-10-15T00:00:00.000Z', timestampEvidence: 'recorded_in_source_transaction',
  completionEvidence: 'none', executionVerified: false, backgroundProcesses: 'unknown', origin: 'event', ...overrides,
});
const reported = (overrides = {}) => event({ eventId: 'event-2', kind: 'work_reported', revision: 2,
  completionEvidence: 'agent_report_only', outcome: 'success', reportedAt: '2026-10-15T00:00:01.000Z', ...overrides });
async function fixture(t, wake = async () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'flowdeck-work-events-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, ownerId: 'owner', deviceId: 'device', wake };
  return { directory, options, inbox: createWorkEventInbox(options) };
}

test('persists pending before wake, deduplicates event identity, and admits rev 2 independently', async t => {
  const wakes = [];
  const { inbox, directory } = await fixture(t, async value => {
    const disk = JSON.parse(await readFile(join(directory, 'inbox.json'), 'utf8'));
    assert.equal(Object.values(disk.events).at(-1).delivery, 'pending');
    wakes.push(value);
  });
  assert.equal((await inbox.ingest(event(), { live: true })).delivery, 'delivered');
  assert.equal((await inbox.ingest(event(), { live: true })).disposition, 'duplicate');
  await inbox.ingest(reported(), { live: true });
  assert.deepEqual(wakes, [event(), reported()]);
  assert.equal(Object.keys((await inbox.status()).events).length, 2);
});

test('confirmed closed target is retained terminally and never retried after restart', async t => {
  let calls = 0;
  const { inbox, options } = await fixture(t, async () => { calls++; const error = Error('closed'); error.code = 'FLOWDECK_TARGET_CLOSED'; throw error; });
  assert.equal((await inbox.ingest(event(), { live: true })).delivery, 'target_closed');
  const restarted = createWorkEventInbox({ ...options, wake: async () => { calls++; } });
  assert.equal((await restarted.status()).pending, 0);
  assert.equal((await restarted.status()).events[Object.keys((await restarted.status()).events)[0]].delivery, 'target_closed');
  await restarted.retryPending();
  assert.equal(calls, 1);
});

test('connectivity failure remains pending and an explicit retry can deliver after restart', async t => {
  let calls = 0;
  const { inbox, options } = await fixture(t, async () => { calls++; throw Error('offline'); });
  assert.equal((await inbox.ingest(event(), { live: true })).delivery, 'pending');
  const pending = Object.values((await inbox.status()).events)[0];
  assert.equal(pending.attempts, 1);
  assert.match(pending.lastError, /offline/);
  const wakes = [];
  const restarted = createWorkEventInbox({ ...options, wake: async value => { wakes.push(value); } });
  assert.equal((await restarted.ingest(event(), { live: true })).delivery, 'pending');
  assert.equal((await restarted.status()).pending, 1);
  assert.deepEqual(await restarted.retryPending(), { pending: 0, blocked: 0 });
  await restarted.retryPending();
  assert.equal(calls, 1);
  assert.deepEqual(wakes, [event()]);
});

test('loads legacy inbox attempt counts above the old arbitrary cap without rewriting them', async t => {
  const { directory, options } = await fixture(t);
  const id = JSON.stringify(['remote-mcp-jazz', 'owner', 'device', 'event-1']);
  await writeFile(join(directory, 'inbox.json'), JSON.stringify({ schema: 'flowdeck.work-inbox/v1', ownerId: 'owner', deviceId: 'device',
    events: { [id]: { event: event(), delivery: 'pending', attempts: 27, lastError: 'offline' } }, snapshots: {} }));
  const status = await createWorkEventInbox(options).status();
  assert.equal(status.events[id].attempts, 27);
});

test('attempt workflow parsing is unambiguous and enforces explicit project scope', () => {
  assert.equal(workflowProjectId('flowdeck-supervisor-sashai--pilot2'), 'sashai');
  assert.equal(workflowProjectId('flowdeck-supervisor-sashai--pilot2', 'sashai'), 'sashai');
  assert.throws(() => workflowProjectId('flowdeck-supervisor-sashai--pilot2', 'sashai--pilot2'), /project-id/);
});

test('signal classification uses the SDK WorkflowNotFoundError and describe result', async () => {
  const missing = new WorkflowNotFoundError('missing');
  assert.equal(await classifySignalFailure(missing, { describe: async () => { throw new WorkflowNotFoundError('missing'); } }), true);
  assert.equal(await classifySignalFailure(missing, { describe: async () => ({ status: { name: 'COMPLETED' } }) }), true);
  assert.equal(await classifySignalFailure(missing, { describe: async () => ({ status: { name: 'RUNNING' } }) }), false);
  await assert.rejects(classifySignalFailure(missing, { describe: async () => { throw Error('network'); } }), /network/);
  assert.equal(await classifySignalFailure(Error('generic'), { describe: async () => ({ status: { name: 'COMPLETED' } }) }), false);
});

test('snapshots reconcile repeated synthetic IDs with later revisions, never wake or occupy dedup keys', async t => {
  const wakes = [];
  const { inbox } = await fixture(t, async value => { wakes.push(value); });
  const id = 'snapshot:work-1';
  await inbox.ingest(event({ origin: 'snapshot', eventId: id }), { live: true });
  await inbox.ingest(reported({ origin: 'snapshot', eventId: id }), { live: true });
  await inbox.ingest(event({ origin: 'snapshot', eventId: id }), { live: true });
  const status = await inbox.status();
  assert.equal(Object.values(status.snapshots)[0].revision, 2);
  assert.equal(Object.keys(status.events).length, 0);
  assert.deepEqual(wakes, []);
  await inbox.ingest(reported({ eventId: id }), { live: true });
  assert.equal(wakes.length, 1);
});

test('historical events require explicit live admission and are never promoted by replay', async t => {
  let calls = 0;
  const { inbox } = await fixture(t, async () => { calls++; });
  assert.equal((await inbox.ingest(event())).delivery, 'historical');
  await inbox.ingest(event(), { live: true });
  await inbox.retryPending();
  assert.equal(calls, 0);
});

test('rejects wrong owner/device/source and inconsistent revisions/evidence', async t => {
  const { inbox, options } = await fixture(t);
  for (const change of [{ ownerId: 'other' }, { deviceId: 'other' }, { source: 'other' },
    { revision: 2 }, { executionVerified: true }, { eventId: '' }]) {
    await assert.rejects(inbox.ingest(event(change), { live: true }));
  }
  await inbox.ingest(event());
  await assert.rejects(createWorkEventInbox({ ...options, deviceId: 'other' }).status(), /scope/);
  assert.throws(() => createWorkEventInbox({ ...options, ownerId: '' }), /Explicit/);
});

test('persistence failure cannot wake or acknowledge ingest', async t => {
  let calls = 0;
  const { directory, options } = await fixture(t);
  const blocked = join(directory, 'not-a-directory');
  await writeFile(blocked, 'blocked');
  const inbox = createWorkEventInbox({ ...options, directory: blocked, wake: async () => { calls++; } });
  await assert.rejects(inbox.ingest(event(), { live: true }));
  assert.equal(calls, 0);
});

test('concurrent ingest serializes dedup and status is read-only for a fresh directory', async t => {
  let calls = 0;
  const { inbox, directory } = await fixture(t, async () => { calls++; });
  assert.equal((await inbox.status()).pending, 0);
  await assert.rejects(readFile(join(directory, 'inbox.json')), { code: 'ENOENT' });
  await Promise.all(Array.from({ length: 10 }, () => inbox.ingest(event(), { live: true })));
  assert.equal(calls, 1);
});

test('actual plugin pump uses startup head barrier and awaits inbox before checkpoint acknowledgement', {
  skip: !process.env.FLOWDECK_TEST_PLUGIN_REPO && 'Set FLOWDECK_TEST_PLUGIN_REPO for installed-plugin pump contract test',
}, async t => {
  const repo = process.env.FLOWDECK_TEST_PLUGIN_REPO;
  const runtime = createRequire(join(repo, 'package.json'))('tsx/cjs/api');
  const { WorkStatusPump } = runtime.require(join(repo,
    'control-plane/packages/work-events/src/pump.ts'), import.meta.url);
  const wakes = [];
  const { inbox, directory } = await fixture(t, async value => { wakes.push(value); throw Error('offline'); });
  let state = { cursor: 'old-checkpoint', snapshot: null, reconciledAt: 0 };
  let acknowledged = false;
  const reader = {
    async head() { return 'bootstrap-head'; },
    async snapshots() { return { events: [event({ origin: 'snapshot' })], nextWorkId: null }; },
    async read(cursor) {
      assert.equal(cursor, 'bootstrap-head', 'startup must not replay old checkpoint history');
      return { events: [reported()], nextCursor: 'live-head', gap: false };
    },
  };
  const checkpoint = {
    get() { return structuredClone(state); },
    set(next) { state = structuredClone(next); if (next.cursor === 'live-head') acknowledged = true; },
  };
  const pump = new WorkStatusPump(reader, { async publish(value) {
    assert.equal(acknowledged, false);
    await inbox.ingest(value, { live: value.origin === 'event' });
    await readFile(join(directory, 'inbox.json'), 'utf8');
  } }, checkpoint);
  await pump.drainOnce();
  assert.equal(acknowledged, true);
  assert.equal((await inbox.status()).pending, 1, 'delivery failure stays durable despite source acknowledgement');
  assert.deepEqual(wakes, [reported()]);
});

test('CLI defaults read-only and rejects ambiguous actions/options', () => {
  assert.equal(parseOptions([]).action, 'status');
  assert.equal(parseOptions(['once']).action, 'once');
  assert.throws(() => parseOptions(['start']));
  assert.throws(() => parseOptions(['follow', '--owner']));
  assert.throws(() => parseOptions(['--owner', 'a', '--owner', 'b']));
});
