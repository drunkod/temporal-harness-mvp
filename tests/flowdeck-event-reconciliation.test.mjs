import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconcileEvents, readAuthoritativePair, supervisorFile, sha } from '../src/flowdeck-event-reconciliation.ts';

const projectUrl = 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const chat = 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/11111111-1111-1111-1111-111111111111';
const normalize = value => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
const prompt = 'Probe RemoteMCP2 Continue this same approved task.';
const promptHash = createHash('sha256').update(normalize(prompt)).digest('hex');
const project = { id: 'pilot', ownerId: 'owner', deviceId: 'device', repo: '', projectUrl,
  initialTaskId: 'task-a', tasks: [{ id: 'task-a', title: 'A', instruction: 'do A' }] };
const base = { schema: 'remote-mcp.work-event/v1', source: 'remote-mcp-jazz', workId: 'new-work', ownerId: 'owner', deviceId: 'device',
  startedAt: '2026-10-15T14:52:14.522Z', sourceCommittedAt: '2026-10-15T14:52:14.522Z', timestampEvidence: 'recorded_in_source_transaction',
  executionVerified: false, backgroundProcesses: 'unknown', origin: 'event' };
const events = () => ({ start: { ...base, eventId: 'start-1', kind: 'work_started', revision: 1, completionEvidence: 'none' },
  report: { ...base, eventId: 'report-1', kind: 'work_reported', revision: 2, completionEvidence: 'agent_report_only', reportedAt: '2026-10-15T14:53:29.783Z', outcome: 'success' } });
const signalHistory = (...values) => ({ events: values.map(event => ({ workflowExecutionSignaledEventAttributes: {
  signalName: 'supervisorWorkEvent', input: { payloads: [{ data: Buffer.from(JSON.stringify(event)) }] },
} })) });

async function fixture(t, opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flowdeck-reconcile-')); t.after(() => rm(root, { recursive: true, force: true }));
  project.repo = root;
  const cfg = { pluginRepo: '/plugin', db: '/db.sqlite', owner: 'owner', device: 'device', auditDirectory: join(root, 'audit'),
    flowdeckRoot: root, inboxDirectory: join(root, '.state', 'flowdeck-supervisor'), workflowId: 'flowdeck-supervisor-pilot--x', projectId: 'pilot', taskId: 'task-a',
    workId: 'new-work', chatUrl: chat, tabId: 'tab-1', executionId: 'run-1', startEventId: 'start-1', reportEventId: 'report-1', worktree: root };
  const e = events();
  const store = join(root, '.state', 'flowdeck-supervisor'); await mkdir(store, { recursive: true });
  await writeFile(join(root, '.state', 'flowdeck-supervisor', 'inbox.json'), JSON.stringify({ schema: 'flowdeck.work-inbox/v1', ownerId: 'owner', deviceId: 'device', events: {}, snapshots: {} }));
  const previous = { projectId: 'pilot', taskId: 'task-a', workId: 'old-work', chatUrl: chat, tabId: 'tab-1' };
  const pending = { projectId: 'pilot', taskId: 'task-a', workId: 'old-work', chatUrl: chat, tabId: 'tab-1', expectedPromptHash: promptHash };
  const receipt = { binding: pending, previous, expectedUserTurns: 2, promptHash };
  for (const [kind, key, value] of [['task', ['pilot', 'task-a'], previous], ['binding', ['pilot', 'old-work'], { binding: pending, ready: false, pending: true, expectedPromptHash: promptHash, previous }],
    ['sent', ['pilot', 'task-a', 'continue', 'old-report'], receipt], ['send-event', ['pilot', 'task-a', 'continue', 'old-report'], { workId: 'old-work' }],
    ['send-phase', ['pilot', 'task-a', 'continue', 'old-work'], { eventId: 'old-report' }]]) await writeFile(supervisorFile(store, kind, key), JSON.stringify(value));
  const history = opts.history ?? signalHistory(); const signals = [];
  const io = { project: { ...project, repo: root }, reader: { async read(cursor) { return cursor ? { events: [], nextCursor: null } : { events: [e.start, e.report], nextCursor: null }; } },
    temporal: { async describe() { return { status: opts.closed ? 'COMPLETED' : 'RUNNING', runId: 'run-1' }; }, async query() { return { projectId: 'pilot', taskId: 'task-a', workId: opts.waiting ? null : 'new-work', chatUrl: chat, tabId: 'tab-1', phase: opts.waiting ? 'waiting_for_work_start' : 'working', status: opts.waiting ? 'waiting' : 'running' }; },
      async history() { return history; }, async signal(name, event) { signals.push(event); if (opts.uncertain) throw Error('connection lost'); } },
    browser: { async observe() { return { projectUrl: projectUrl, taskId: 'task-a', worktree: root, latestUserHash: promptHash, turnState: 'turn_finished', lastAssistant: 'FLOWDECK_STATUS: implementation_done' }; } } };
  return { cfg, e, io, signals };
}

test('preview handles waiting_for_work_start with null state workId and never signals', async t => { const f = await fixture(t, { waiting: true }); const r = await reconcileEvents(f.cfg, f.io); assert.equal(r.mode, 'preview'); assert.deepEqual(r.missing, ['work_started', 'work_reported']); assert.equal(f.signals.length, 0); });
test('dedup history scans only supervisorWorkEvent payloads', async t => { const f = await fixture(t, { history: signalHistory(events().start, events().report, { eventId: 'unrelated', workId: 'new-work' }) }); const r = await reconcileEvents(f.cfg, f.io, true); assert.deepEqual(r.missing, []); assert.equal(f.signals.length, 0); });
test('only missing start is eligible when report is already in history', async t => { const f = await fixture(t, { waiting: true, history: signalHistory(events().report) }); const r = await reconcileEvents(f.cfg, f.io, true); assert.deepEqual(r.missing, ['work_started']); assert.deepEqual(f.signals.map(x => x.eventId), ['start-1']); });
test('snapshot, gap, wrong scope, changed task and closed execution reject', async t => {
  const f = await fixture(t); const snapshot = { ...f.e.start, origin: 'snapshot' }; f.io.reader = { async read() { return { events: [snapshot, f.e.report], nextCursor: null }; } }; await assert.rejects(readAuthoritativePair(f.io.reader, f.cfg), /payload|pair/);
  const g = await fixture(t); g.io.reader = { async read() { return { events: [], gap: true }; } }; await assert.rejects(readAuthoritativePair(g.io.reader, g.cfg), /gap/);
  const w = await fixture(t); w.io.project = { ...w.io.project, ownerId: 'other' }; await assert.rejects(reconcileEvents(w.cfg, w.io), /owner/);
  const c = await fixture(t, { closed: true }); await assert.rejects(reconcileEvents(c.cfg, c.io), /RUNNING/);
});
test('history eventId payload collision blocks reconciliation', async t => { const f = await fixture(t, { history: signalHistory({ ...events().start, workId: 'collision' }) }); await assert.rejects(reconcileEvents(f.cfg, f.io), /collision/); });
test('uncertain signal remains sealed and is not retried', async t => { const f = await fixture(t, { waiting: true, uncertain: true }); await assert.rejects(reconcileEvents(f.cfg, f.io, true), /uncertain/); assert.equal(f.signals.length, 1); });
test('changed source work identity rejects', async t => { const f = await fixture(t); f.io.reader = { async read() { return { events: [{ ...f.e.start, workId: 'other' }, f.e.report], nextCursor: null }; } }; await assert.rejects(reconcileEvents(f.cfg, f.io), /payload|scope/); });
