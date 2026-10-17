import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { composerPayloadFor, normalizeComposerText } from '../dist/sashai-dispatch-evidence.js';
const dist = process.env.FLOWDECK_TEST_DIST;
const moduleUrl = name => dist ? pathToFileURL(join(dist, name + '.js')).href : new URL('../dist/' + name + '.js', import.meta.url).href;
const { createSupervisorActivities, interpretSupervisorResult, supervisorAnswerExpression, supervisorIdentityExpression } = await import(moduleUrl('flowdeck-supervisor-activities'));
const { createSupervisorProjectLoader } = await import(moduleUrl('flowdeck-projects'));
const { PROJECT } = await import(moduleUrl('sashai-live-browser'));
const chat = n => PROJECT.replace('/project', '/c/00000000-0000-0000-0000-' + String(n).padStart(12, '0'));
function event(kind = 'work_reported', workId = 'work-1', eventId = kind + '-' + workId, outcome = 'success') {
  return { schema: 'remote-mcp.work-event/v1', source: 'remote-mcp-jazz', eventId, workId,
    ownerId: 'owner', deviceId: 'device', kind, revision: kind === 'work_started' ? 1 : 2,
    completionEvidence: kind === 'work_started' ? 'none' : 'agent_report_only',
    ...(kind === 'work_reported' ? { outcome, reportedAt: '2026-10-15T12:00:01Z' } : {}),
    sourceCommittedAt: '2026-10-15T12:00:01Z', startedAt: '2026-10-15T12:00:00Z',
    timestampEvidence: 'recorded_in_source_transaction', executionVerified: false, backgroundProcesses: 'unknown', origin: 'event' };
}
async function fixture(t) {
  // Child processes canonicalize cwd on macOS (/var is an alias of /private/var).
  const base = await realpath(await mkdtemp(join(tmpdir(), 'flowdeck-supervisor-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  await mkdir(join(repo, '.ai/harness'), { recursive: true });
  await mkdir(join(repo, 'plans'), { recursive: true });
  await mkdir(join(base, '.state/flowdeck-supervisor'), { recursive: true });
  await writeFile(join(repo, 'AGENTS.md'), 'Task authority is active-plan Task Breakdown.');
  await writeFile(join(repo, '.ai/harness/active-plan'), 'plans/approved.md');
  await writeFile(join(repo, '.ai/harness/active-worktree'), repo);
  const plan = '# Approved\n## Task Breakdown\n- [ ] First task\n- [ ] Second task\n## Deferred\n- [ ] Deferred task\n';
  await writeFile(join(repo, 'plans/approved.md'), plan);
  const project = { id: 'sashai', ownerId: 'owner', deviceId: 'device', repo, projectUrl: PROJECT, initialTaskId: 'one',
    tasks: [{ id: 'one', title: 'First task', instruction: 'Implement first only.' },
      { id: 'two', title: 'Second task', instruction: 'Implement second only.' }] };
  const enroll = () => writeFile(join(base, '.state/flowdeck-supervisor/projects.json'), JSON.stringify({ projects: [project] }));
  await enroll();
  const pages = new Map([['original', { id: 'original', type: 'page', url: chat(1) }]]);
  const states = new Map([[chat(1), { browser: 'attached_read_only', tabId: 'original', turnState: 'running',
    lastAssistant: '', userTurns: 1, assistantTurns: 1 }]]);
  const effects = { creates: 0, stages: [], clicks: 0, matches: true, uncertain: false,
      hydrationDelays: 0, hydrationProbes: 0, navigationDelays: 0, latestIdentityText: null, waits: [], listDelays: 0, adoptionObservations: [], identityOverrides: {},
    dispatchCancelled: false, dispatchExpired: false, cancelDuringStage: false, cancelBeforeClick: false,
    dispatchGuardChecks: 0, clickDeadline: null };
  const browser = {
    async requireTab(id, url) { const tab = pages.get(id); assert.equal(tab?.url.split('?')[0], url); return tab; },
    async createOwnedProjectTab(owner) { assert.match(owner, /^[0-9a-f-]{36}$/); effects.creates++;
      const tab = { id: 'new', type: 'page', url: PROJECT }; pages.set(tab.id, tab); return tab; },
    async stage(tab, url, prompt) { effects.stages.push({ id: tab.id, url, prompt });
      if (effects.cancelDuringStage) effects.dispatchCancelled = true; },
    async matches() { return effects.matches; },
    async click(tab, url, prompt, deadline, check) {
      effects.clickDeadline = deadline;
      if (effects.cancelBeforeClick) effects.dispatchCancelled = true;
      check?.();
      effects.clicks++; if (effects.uncertain) throw Error('CDP timeout');
      assert.equal(prompt, effects.stages.at(-1).prompt);
      const target = tab.id === 'new' ? chat(2) : chat(1);
      const previous = states.get(target);
      tab.url = target;
      states.set(target, { browser: 'attached_read_only', tabId: tab.id, turnState: 'running', lastAssistant: '',
        userTurns: (previous?.userTurns ?? 0) + 1, assistantTurns: previous?.assistantTurns ?? 0 }); return true; },
    async chat(id) { const tab = pages.get(id); if (effects.navigationDelays > 0) { effects.navigationDelays--; return null; }
      return tab && tab.url !== PROJECT ? { url: tab.url, id: 'conversation' } : null; },
    async evidence() { throw Error('Acceptance/tool provenance must not be requested'); },
  };
  const api = createSupervisorActivities({ base, browserFactory: () => browser,
    dispatchGuard: () => {
      const deadline = Date.now() + 90_000;
      return { deadline, check: () => {
        effects.dispatchGuardChecks++;
        if (effects.dispatchCancelled) throw Error('Activity cancelled; browser send prohibited');
        if (effects.dispatchExpired || Date.now() >= deadline) throw Error('Dispatch deadline elapsed; browser send prohibited');
      } };
    },
    list: async () => {
      if (effects.listDelays > 0) { effects.listDelays--; return []; }
      return [...pages.values()].filter(p => p.url !== PROJECT).map(p => ({ ...p, conversationId: 'fixture' }));
    },
    observe: async url => {
      const state = { ...states.get(url) };
      if (effects.adoptionObservations.length) return { ...state, ...effects.adoptionObservations.shift() };
      if (effects.clicks > 0 && effects.hydrationDelays > 0) {
        effects.hydrationDelays--; effects.hydrationProbes++;
        return { ...state, userTurns: state.userTurns - 1 };
      }
      return state;
    }, readIdentity: async (url, tabId) => {
      const latest = effects.stages.at(-1)?.prompt ?? null;
      const observedLatest = effects.latestIdentityText ?? latest;
      const digest = observedLatest === null ? null : createHash('sha256').update(normalizeComposerText(composerPayloadFor(observedLatest))).digest('hex');
      return { taskId: url === chat(2) ? (latest?.match(/Task ID: ([^\n]+)/)?.[1] ?? 'two') : (latest?.match(/Task ID: ([^\n]+)/)?.[1] ?? project.initialTaskId),
        worktree: repo, projectUrl: PROJECT, tabId, originalUserHash: digest, latestUserHash: digest,
        latestUserTurns: effects.clicks > 0 ? (url === chat(1) ? 2 : 1) : 1, ...effects.identityOverrides };
    },
    wait: async ms => { effects.waits.push(ms); } });
  const adopt = () => api.adoptStartedWork(project, event('work_started'), project.tasks[0]);
  const finish = (text = 'FLOWDECK_STATUS: continue', url = chat(1)) => Object.assign(states.get(url), { turnState: 'turn_finished', lastAssistant: text });
  return { base, repo, project, enroll, api, effects, pages, states, adopt, finish, plan };
}

test('loader requires explicit enrollment and active worktree/plan; never selects deferred/snapshot tasks', async t => {
  const f = await fixture(t), load = createSupervisorProjectLoader({ base: f.base });
  assert.deepEqual(await load('sashai'), f.project);
  await assert.rejects(load('not-enrolled'), /enrolled/);
  await rm(join(f.repo, '.ai/harness/active-plan'));
  await mkdir(join(f.repo, 'tasks'));
  await writeFile(join(f.repo, 'tasks/current.md'), '- [ ] First task');
  await assert.rejects(load('sashai'), /no_active_plan/);
  await writeFile(join(f.repo, '.ai/harness/active-plan'), 'plans/approved.md');
  await rm(join(f.repo, '.ai/harness/active-worktree'));
  await assert.rejects(load('sashai'), /missing_worktree_owner/);
  await writeFile(join(f.repo, '.ai/harness/active-worktree'), f.repo);
  f.project.tasks[0].title = 'Deferred task'; await f.enroll();
  await assert.rejects(load('sashai'), /unchecked active-plan/);
  f.project.projectUrl = 'https://chatgpt.com/c/not-a-project'; await f.enroll();
  await assert.rejects(load('sashai'), /unsupported/);
});

test('adopts one running project chat without sends; persists work mapping and rejects ambiguity/scope/task changes', async t => {
  const f = await fixture(t), b = await f.adopt();
  assert.deepEqual(b, { projectId: 'sashai', taskId: 'one', workId: 'work-1', chatUrl: chat(1), tabId: 'original' });
  assert.deepEqual(await f.adopt(), b);
  assert.equal(f.effects.clicks, 0); assert.equal(f.effects.creates, 0);
  assert.equal(Object.hasOwn(await bindingRecord(f, b.workId), 'expectedPromptHash'), false,
    'Manual adoption must not fabricate a previously sealed message hash');
  await assert.rejects(f.api.adoptStartedWork(f.project, event('work_started'), f.project.tasks[1]), /another task/);
  await assert.rejects(f.api.adoptStartedWork(f.project, { ...event('work_started'), ownerId: 'wrong' }, f.project.tasks[0]), /scope/);
  f.pages.set('other', { id: 'other', type: 'page', url: chat(3) });
  f.states.set(chat(3), { ...f.states.get(chat(1)), tabId: 'other' });
  await assert.rejects(f.api.adoptStartedWork(f.project, event('work_started', 'other-work'), f.project.tasks[0]), /exactly one/);
});

async function bindingRecord(f, workId) {
  const key = createHash('sha256').update(JSON.stringify([f.project.id, workId])).digest('hex');
  return JSON.parse(await readFile(join(f.base, '.state/flowdeck-supervisor', `binding-${key}.json`), 'utf8'));
}

function assertNoSends(f) {
  assert.equal(f.effects.creates, 0);
  assert.deepEqual(f.effects.stages, []);
  assert.equal(f.effects.clicks, 0);
}

function assertWorkSessionHooks(prompt) {
  assert.match(prompt, /At the start of EVERY supervised turn/);
  assert.match(prompt, /existing Probe RemoteMCP2 begin_work tool before any implementation\/device work/);
  assert.match(prompt, /NEW work session with a fresh UUID requestKey each turn/);
  assert.match(prompt, /never reuse a previous turn's workId/);
  assert.match(prompt, /At the end of this turn, call the existing Probe RemoteMCP2 finish_work tool exactly once with that workId/);
  assert.match(prompt, /outcome partial for unfinished work/);
  assert.match(prompt, /success only for implementation_done/);
  assert.match(prompt, /Call finish_work before the final answer's status marker, and put nothing after the marker/);
  assert.match(prompt, /exactly one last line: FLOWDECK_STATUS: continue, FLOWDECK_STATUS: implementation_done, or FLOWDECK_STATUS: needs_attention/);
}

for (const expected of [false, true]) test(`adoption polls zero-running and normal hydration lag without sends (${expected ? 'expected binding' : 'initial adoption'})`, async t => {
  const f = await fixture(t);
  f.effects.listDelays = 2;
  f.effects.adoptionObservations = [
    { turnState: 'unknown', userTurns: 0 },
    { turnState: 'awaiting_answer', userTurns: 0 },
    { turnState: 'running', userTurns: 0 },
  ];
  const binding = expected ? { projectId: f.project.id, taskId: 'one', workId: 'work-1', tabId: 'original', chatUrl: chat(1) } : undefined;
  const b = await f.api.adoptStartedWork(f.project, event('work_started'), f.project.tasks[0], binding);
  assert.equal(b.status, 'waiting');
  assert.equal(b.binding?.chatUrl ?? chat(1), chat(1));
  assert.deepEqual(f.effects.waits, []);
  assertNoSends(f);
  f.effects.adoptionObservations = [];
  f.effects.listDelays = 0;
  Object.assign(f.states.get(chat(1)), { turnState: 'running', userTurns: 1 });
  if (!expected) {
    const adopted = await f.api.adoptStartedWork(f.project, event('work_started'), f.project.tasks[0], binding);
    assert.equal(adopted.workId, 'work-1');
  } else {
    const adopted = await f.api.adoptStartedWork(f.project, event('work_started'), f.project.tasks[0], binding);
    assert.equal(adopted.workId, 'work-1');
  }
});

for (const lag of ['zero-running', 'unhydrated']) test(`adoption exhausts bounded ${lag} polling without claims or sends`, async t => {
  const f = await fixture(t);
  if (lag === 'zero-running') f.effects.listDelays = 20;
  else Object.assign(f.states.get(chat(1)), { turnState: 'unknown', userTurns: 0 });
  assert.deepEqual(await f.adopt(), { status: 'waiting', reason: 'not_hydrated' });
  assert.deepEqual(f.effects.waits, []);
  assertNoSends(f);
  f.effects.listDelays = 0;
  Object.assign(f.states.get(chat(1)), { turnState: 'running', userTurns: 1 });
  assert.equal((await f.adopt()).workId, 'work-1');
  assertNoSends(f);
});

test('finished initial adoption is allowed only with the exact visible task/worktree identity', async t => {
  const f = await fixture(t); f.finish();
  const b = await f.adopt();
  assert.equal(b.workId, 'work-1');
  assertNoSends(f);
});

test('pinned finished adoption waits for a missing task ID without claims, then adopts the same tab', async t => {
  const f = await fixture(t); f.finish();
  const pinned = { projectId: f.project.id, taskId: 'one', workId: 'work-1', tabId: 'original', chatUrl: chat(1) };
  f.effects.identityOverrides = { taskId: null };
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await f.api.adoptStartedWork(f.project, event('work_started'), f.project.tasks[0], pinned),
      { status: 'waiting', reason: 'not_hydrated', binding: pinned });
  }
  assert.deepEqual(await readdir(join(f.base, '.state/flowdeck-supervisor')), ['projects.json']);
  assertNoSends(f);
  f.effects.identityOverrides = {};
  assert.deepEqual(await f.api.adoptStartedWork(f.project, event('work_started'), f.project.tasks[0], pinned), pinned);
  assertNoSends(f);
});

for (const conflict of [
  { taskId: 'different-task' },
  { taskId: null, worktree: '/wrong-worktree' },
  { taskId: null, projectUrl: 'https://chatgpt.com/g/wrong/project' },
  { taskId: null, tabId: 'replacement' },
]) test(`pinned finished identity conflict still rejects: ${JSON.stringify(conflict)}`, async t => {
  const f = await fixture(t); f.finish();
  const pinned = { projectId: f.project.id, taskId: 'one', workId: 'work-1', tabId: 'original', chatUrl: chat(1) };
  f.effects.identityOverrides = conflict;
  await assert.rejects(f.api.adoptStartedWork(f.project, event('work_started'), f.project.tasks[0], pinned), /identity/);
  assert.deepEqual(await readdir(join(f.base, '.state/flowdeck-supervisor')), ['projects.json']);
  assertNoSends(f);
});

test('finished expected binding is allowed only after persisted prompt/user proof', async t => {
  const f = await fixture(t), b = await f.adopt();
  f.finish('FLOWDECK_STATUS: continue'); await f.api.observeWorkResult(f.project, b, event());
  const sent = await f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], event());
  f.finish('FLOWDECK_STATUS: continue');
  const adopted = await f.api.adoptStartedWork(f.project, event('work_started', 'finished-work'), f.project.tasks[0], sent);
  assert.equal(adopted.workId, 'finished-work');
  assert.equal(adopted.chatUrl, chat(1));
});

test('hydration that reveals an already finished intended chat stops polling without sends', async t => {
  const f = await fixture(t);
  f.effects.adoptionObservations = [{ turnState: 'unknown', userTurns: 0 }, { turnState: 'turn_finished' }];
  const b = await f.adopt();
  assert.equal(b.status, 'waiting');
  assert.equal(b.reason, 'not_hydrated');
  assert.deepEqual(f.effects.waits, []);
  assertNoSends(f);
});

test('adoption rejects multiple running chats immediately even while one is unhydrated', async t => {
  const f = await fixture(t);
  f.pages.set('other', { id: 'other', type: 'page', url: chat(3) });
  f.states.set(chat(3), { ...f.states.get(chat(1)), tabId: 'other', userTurns: 0 });
  await assert.rejects(f.adopt(), /exactly one/);
  assert.deepEqual(f.effects.waits, []);
  assertNoSends(f);
});

test('wrong expected tab/chat identity and mismatched observer identity reject without retry or send', async t => {
  const f = await fixture(t);
  const binding = { projectId: f.project.id, taskId: 'one', workId: 'previous', tabId: 'original', chatUrl: chat(1) };
  for (const changed of [{ tabId: 'other' }, { chatUrl: chat(3) }, { tabId: 'other', chatUrl: chat(3) }])
    await assert.rejects(f.api.adoptStartedWork(f.project, event('work_started'), f.project.tasks[0], { ...binding, ...changed }), /expected binding/);
  f.states.get(chat(1)).tabId = 'wrong-observer-tab';
  await assert.rejects(f.adopt(), /expected binding/);
  assert.deepEqual(f.effects.waits, []);
  assertNoSends(f);
});

test('report success cannot finish a running turn or infer completion; partial requires actual continuation text', async t => {
  const f = await fixture(t), b = await f.adopt();
  assert.equal((await f.api.observeWorkResult(f.project, b, event())).turn, 'running');
  f.finish('The tool returned success.');
  assert.equal((await f.api.observeWorkResult(f.project, b, event())).decision, 'unknown');
  f.finish('More progress so far.');
  assert.equal((await f.api.observeWorkResult(f.project, b, event('work_reported', 'work-1', 'partial', 'partial'))).decision, 'unknown');
  f.finish('FLOWDECK_STATUS: continue');
  assert.equal((await f.api.observeWorkResult(f.project, b, event('work_reported', 'work-1', 'partial', 'partial'))).decision, 'continue');
  f.finish('FLOWDECK_STATUS: implementation_done');
  assert.equal((await f.api.observeWorkResult(f.project, b, event())).decision, 'implementation_done');
  assert.equal((await f.api.observeWorkResult(f.project, b, event('work_reported', 'work-1', 'failed-report', 'failed'))).decision, 'needs_attention');
  f.states.get(chat(1)).pageBusyHint = true;
  const busyFinished = await f.api.observeWorkResult(f.project, b, event());
  assert.equal(busyFinished.turn, 'finished');
  assert.equal(busyFinished.decision, 'implementation_done');
  f.states.get(chat(1)).turnState = 'awaiting_answer';
  assert.equal((await f.api.observeWorkResult(f.project, b, event())).turn, 'running');
  f.states.get(chat(1)).turnState = 'turn_finished';
  f.states.get(chat(1)).pageBusyHint = false;
  await assert.rejects(f.api.observeWorkResult(f.project, b, event('work_reported', 'wrong')), /workId/);
  f.states.get(chat(1)).userTurns++;
  assert.equal((await f.api.observeWorkResult(f.project, b, event())).turn, 'unknown');
});

test('continuation sends exactly once in original chat, then new work_started maps the new workId', async t => {
  const f = await fixture(t), b = await f.adopt(), e = event();
  f.finish(); await f.api.observeWorkResult(f.project, b, e);
  const sent = await f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], e);
  assert.equal(sent.chatUrl, b.chatUrl); assert.equal(f.effects.creates, 0);
  assert.equal(f.effects.stages[0].id, 'original'); assert.match(f.effects.stages[0].prompt, /Task ID: one/);
  assertWorkSessionHooks(f.effects.stages[0].prompt);
  assert.deepEqual(await f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], e), sent);
  assert.equal(f.effects.clicks, 1);
  assert.ok(f.effects.dispatchGuardChecks >= 6, 'send path checked cancellation repeatedly');
  assert.ok(Number.isFinite(f.effects.clickDeadline), 'browser click received an explicit deadline');
  assert.ok(f.effects.clickDeadline <= Date.now()+10_000, 'click deadline never exceeds ten seconds from now');
  const restarted = createSupervisorActivities({ base: f.base, browserFactory: () => { throw Error('Receipt retry must not touch browser'); } });
  assert.deepEqual(await restarted.sendContinuationOnce(f.project, b, f.project.tasks[0], e), sent);
  await assert.rejects(f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], { ...e, eventId: 'snapshot-redelivery' }), /unresolved/);
  const sealed = (await bindingRecord(f, sent.workId)).expectedPromptHash;
  assert.match(sealed, /^[a-f0-9]{64}$/);
  const nextWork = await f.api.adoptStartedWork(f.project, event('work_started', 'work-2'), f.project.tasks[0], sent);
  assert.equal(nextWork.workId, 'work-2'); assert.equal(nextWork.chatUrl, chat(1));
  assert.equal((await bindingRecord(f, nextWork.workId)).expectedPromptHash, sealed);
  f.finish('FLOWDECK_STATUS: implementation_done');
  await f.api.observeWorkResult(f.project, nextWork, event('work_reported', 'work-2'));
  assert.equal((await bindingRecord(f, nextWork.workId)).expectedPromptHash, sealed,
    'Completion observation must retain the validated send seal');
});

test('next task starts in a NEW owned project chat only after text completion, with no acceptance/tool evidence', async t => {
  const f = await fixture(t), b = await f.adopt(), e = event();
  f.finish('FLOWDECK_STATUS: implementation_done'); await f.api.observeWorkResult(f.project, b, e);
  const next = await f.api.startNextTaskOnce(f.project, f.project.tasks[1], b, e);
  assert.equal(next.taskId, 'two'); assert.equal(next.chatUrl, chat(2)); assert.equal(next.tabId, 'new');
  assert.equal(f.effects.creates, 1); assert.equal(f.effects.stages[0].url, PROJECT);
  assert.match(f.effects.stages[0].prompt, /Task ID: two/);
  assertWorkSessionHooks(f.effects.stages[0].prompt);
  assert.doesNotMatch(f.effects.stages[0].prompt, /Implement first only/);
  assert.deepEqual(await f.api.startNextTaskOnce(f.project, f.project.tasks[1], b, e), next);
  assert.equal(f.effects.clicks, 1);
  const sealed = (await bindingRecord(f, next.workId)).expectedPromptHash;
  assert.match(sealed, /^[a-f0-9]{64}$/);
  const bound = await f.api.adoptStartedWork(f.project, event('work_started', 'next-work'), f.project.tasks[1], next);
  assert.equal(bound.chatUrl, chat(2)); assert.equal(bound.workId, 'next-work');
  assert.equal((await bindingRecord(f, bound.workId)).expectedPromptHash, sealed);
});

test('next task skips a review-dependent successor for an independent configured task and publishes completion', async t => {
  const f = await fixture(t);
  f.project.tasks[1].dependsOn = ['one'];
  f.project.tasks.push({ id: 'three', title: 'Third task', instruction: 'Implement third only.', dependsOn: [] });
  await writeFile(join(f.repo, 'plans/approved.md'), f.plan.replace('## Deferred', '- [ ] Third task\n## Deferred'));
  await f.enroll();
  const b = await f.adopt(), e = event();
  f.finish('FLOWDECK_STATUS: implementation_done'); await f.api.observeWorkResult(f.project, b, e);
  const next = await f.api.startNextTaskOnce(f.project, f.project.tasks[2], b, e);
  assert.equal(next.taskId, 'three'); assert.equal(next.chatUrl, chat(2));
  assert.match(f.effects.stages[0].prompt, /Task ID: three/);
  assert.doesNotMatch(f.effects.stages[0].prompt, /Implement second only/);
  assert.deepEqual(await f.api.startNextTaskOnce(f.project, f.project.tasks[2], b, e), next);
  assert.equal(f.effects.clicks, 1);
  const bound = await f.api.adoptStartedWork(f.project, event('work_started', 'third-work'), f.project.tasks[2], next);
  f.finish('FLOWDECK_STATUS: implementation_done', chat(2));
  const observed = await f.api.observeWorkResult(f.project, bound, event('work_reported', 'third-work'));
  await f.api.publishSupervisorState({ stage: 'completed', tasks: [{ id: 'three',
    implementationStatus: observed.decision, reviewStatus: 'not_reviewed' }] });
  assert.deepEqual(JSON.parse(await readFile(join(f.base, '.state/flowdeck-supervisor/status.json'), 'utf8')),
    { stage: 'completed', tasks: [{ id: 'three', implementationStatus: 'implementation_done', reviewStatus: 'not_reviewed' }] });
});

test('next task refuses configured dependencies before claims or browser sends', async t => {
  const f = await fixture(t); f.project.tasks[1].dependsOn = ['one']; await f.enroll();
  const b = await f.adopt(); f.finish('FLOWDECK_STATUS: implementation_done');
  await f.api.observeWorkResult(f.project, b, event());
  await assert.rejects(f.api.startNextTaskOnce(f.project, f.project.tasks[1], b, event()), /Next task has dependencies/);
  assert.equal(f.effects.creates, 0); assert.equal(f.effects.stages.length, 0); assert.equal(f.effects.clicks, 0);
  assert.equal((await f.api.observeWorkResult(f.project, b, event())).decision, 'implementation_done');
});

test('review boundary blocks next task; changed authority blocks all sends', async t => {
  const f = await fixture(t); f.project.tasks[0].requiresReviewBeforeNext = true; await f.enroll();
  const b = await f.adopt(); f.finish('FLOWDECK_STATUS: implementation_done');
  await f.api.observeWorkResult(f.project, b, event());
  await assert.rejects(f.api.startNextTaskOnce(f.project, f.project.tasks[1], b, event()), /review boundary/);
  await rm(join(f.repo, '.ai/harness/active-plan'));
  await assert.rejects(f.api.startNextTaskOnce(f.project, f.project.tasks[1], b, event()), /no_active_plan/);
  assert.equal(f.effects.clicks, 0);
});

test('uncertain send is never retried, including concurrent calls and a fresh activity instance', async t => {
  const f = await fixture(t), b = await f.adopt(); f.finish();
  await f.api.observeWorkResult(f.project, b, event()); f.effects.uncertain = true;
  const results = await Promise.allSettled([1, 2].map(() => f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], event())));
  assert.ok(results.every(r => r.status === 'rejected')); assert.equal(f.effects.clicks, 1);
  const restarted = createSupervisorActivities({ base: f.base, browserFactory: () => { throw Error('Must not touch browser'); } });
  await assert.rejects(restarted.sendContinuationOnce(f.project, b, f.project.tasks[0], event()));
  assert.equal(f.effects.clicks, 1);
});

test('full composer mismatch blocks click permanently; continuation cannot change tasks', async t => {
  const f = await fixture(t), b = await f.adopt(); f.finish();
  await f.api.observeWorkResult(f.project, b, event());
  await assert.rejects(f.api.sendContinuationOnce(f.project, b, f.project.tasks[1], event()), /cannot change task/);
  f.effects.matches = false;
  await assert.rejects(f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], event()), /composer mismatch/);
  f.effects.matches = true;
  await assert.rejects(f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], event()), /unresolved/);
  assert.equal(f.effects.clicks, 0);
});

test('status projection drops secrets/prompts and atomically writes operational fields', async t => {
  const f = await fixture(t);
  await f.api.publishSupervisorState({ projectId: 'sashai', taskId: 'one', status: 'running', stage: 'implementing', token: 'private',
    tasks: [{ id: 'one', title: 'First task', implementationStatus: 'running', reviewStatus: 'not_reviewed',
      blocker: null, phase: 'continue', instruction: 'private task prompt', prompt: 'private composer' }],
    lastEvent: { eventId: 'reported', kind: 'work_reported', outcome: 'partial', raw: 'private event', token: 'private' },
    projection: {status:'healthy', consecutiveFailures:0, lastPublishedAt:'2026-10-16T00:00:00.000Z', raw:'private error'},
    instruction: 'private prompt', chatUrl: chat(1) + '?token=private', summary: 'private transcript' });
  const text = await readFile(join(f.base, '.state/flowdeck-supervisor/status.json'), 'utf8');
  assert.doesNotMatch(text, /private|instruction|summary|token/);
  const published = JSON.parse(text);
  assert.equal(published.projectId, 'sashai');
  assert.equal(published.stage, 'implementing');
  assert.deepEqual(published.projection, {status:'healthy', consecutiveFailures:0, lastPublishedAt:'2026-10-16T00:00:00.000Z'});
  assert.deepEqual(published.tasks, [{ id: 'one', title: 'First task', implementationStatus: 'running',
    reviewStatus: 'not_reviewed', blocker: null, phase: 'continue' }]);
  assert.deepEqual(published.lastEvent, { eventId: 'reported', kind: 'work_reported', outcome: 'partial' });
});

test('loader requires an explicit initial task for multiple tasks and defaults only a sole task', async t => {
  const f = await fixture(t), load = createSupervisorProjectLoader({ base: f.base });
  f.project.initialTaskId = undefined; await f.enroll();
  await assert.rejects(load('sashai'), /initialTaskId/);
  f.project.initialTaskId = 'unknown'; await f.enroll();
  await assert.rejects(load('sashai'), /initialTaskId/);
  f.project.initialTaskId = 'two'; await f.enroll();
  assert.equal((await load('sashai')).initialTaskId, 'two');
  await assert.rejects(f.adopt(), /Initial adoption must use configured initialTaskId/);
  const b = await f.api.adoptStartedWork(f.project, event('work_started'), f.project.tasks[1]);
  assert.equal(b.taskId, 'two'); assert.equal(f.effects.clicks, 0);
  f.project.tasks = [f.project.tasks[1]];
  f.project.initialTaskId = undefined; await f.enroll();
  assert.equal((await load('sashai')).initialTaskId, 'two');
  f.project.initialTaskId = 'one'; await f.enroll();
  await assert.rejects(load('sashai'), /initialTaskId/);
});

test('loader preserves dependencies and rejects self, unknown, duplicate and malformed dependency IDs', async t => {
  const f = await fixture(t), load = createSupervisorProjectLoader({ base: f.base });
  f.project.tasks[1].dependsOn = ['one']; await f.enroll();
  assert.deepEqual((await load('sashai')).tasks[1].dependsOn, ['one']);
  for (const dependsOn of [['two'], ['unknown'], ['one', 'one'], [null], 'one']) {
    f.project.tasks[1].dependsOn = dependsOn; await f.enroll();
    await assert.rejects(load('sashai'), /dependency/);
  }
});

test('expected adoption binding pins project, task, tab and chat, including replayed work events', async t => {
  const f = await fixture(t), b = await f.adopt();
  f.finish(); await f.api.observeWorkResult(f.project, b, event());
  const sent = await f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], event());
  const nextEvent = event('work_started', 'work-2');
  for (const changed of [{ tabId: 'other' }, { chatUrl: chat(3) }, { taskId: 'two' }, { projectId: 'other' }])
    await assert.rejects(f.api.adoptStartedWork(f.project, nextEvent, f.project.tasks[0], { ...sent, ...changed }), /[Ee]xpected binding/);
  const next = await f.api.adoptStartedWork(f.project, nextEvent, f.project.tasks[0], sent);
  assert.equal(next.workId, 'work-2');
  await assert.rejects(f.api.adoptStartedWork(f.project, nextEvent, f.project.tasks[0], { ...sent, tabId: 'other' }), /expected binding/);
  assert.deepEqual(await f.api.adoptStartedWork(f.project, nextEvent, f.project.tasks[0], sent), next);
  f.finish();
  f.pages.set('other', { id: 'other', type: 'page', url: chat(3) });
  f.states.set(chat(3), { ...f.states.get(chat(1)), tabId: 'other', turnState: 'running' });
  await assert.rejects(f.api.adoptStartedWork(f.project, event('work_started', 'work-3'), f.project.tasks[0], sent), /expected binding/);
  assert.equal(f.effects.clicks, 1);
});

for (const phase of ['continue', 'next']) test(`${phase} polls delayed send hydration without repeating the click`, async t => {
  const f = await fixture(t), b = await f.adopt();
  f.finish(phase === 'continue' ? 'FLOWDECK_STATUS: continue' : 'FLOWDECK_STATUS: implementation_done');
  await f.api.observeWorkResult(f.project, b, event());
  f.effects.hydrationDelays = 3;
  const send = () => phase === 'continue'
    ? f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], event())
    : f.api.startNextTaskOnce(f.project, f.project.tasks[1], b, event());
  const sent = await send();
  assert.equal(f.effects.hydrationProbes, 0);
  assert.deepEqual(f.effects.waits, []);
  for (let i = 0; i < 4; i++) await f.api.reconcileSubmittedTurn(f.project, sent);
  assert.equal(f.effects.clicks, 1);
  assert.deepEqual(await send(), sent);
  assert.equal(f.effects.clicks, 1);
});

test('exhausted hydration polling leaves the original send claim unresolved and cannot re-click', async t => {
  const f = await fixture(t), b = await f.adopt(); f.finish();
  await f.api.observeWorkResult(f.project, b, event());
  f.effects.hydrationDelays = 25;
  const sent = await f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], event());
  assert.equal(f.effects.hydrationProbes, 0); assert.equal(f.effects.waits.length, 0);
  assert.equal((await f.api.reconcileSubmittedTurn(f.project, sent)).status, 'pending');
  f.effects.hydrationDelays = 0;
  assert.equal((await f.api.reconcileSubmittedTurn(f.project, sent)).status, 'ready');
  assert.deepEqual(await f.api.sendContinuationOnce(f.project, b, f.project.tasks[0], event()), sent);
  assert.equal(f.effects.clicks, 1);
});

test('identity DOM read preserves multiline original-user boundaries and never falls back to assistant/main text', () => {
  const location = new URL(chat(1));
  const user = { innerText: 'Remote Desktop Commander\n\nProbe RemoteMCP2\nRepository/worktree: /tmp/approved repo\nTask ID: exact-task\nTask title: Multiline task', getAttribute: name => name === 'data-message-author-role' ? 'user' : null };
  const assistant = { innerText: 'Repository/worktree: /tmp/assistant-echo\nTask ID: wrong-task', getAttribute: name => name === 'data-message-author-role' ? 'assistant' : null };
  const document = { querySelectorAll(selector) {
    if (selector === '[data-message-author-role]') return [user, assistant];
    if (selector === 'main h4.sr-only') return [];
    throw Error('unexpected selector ' + selector);
  } };
  const roleRead = runInNewContext(supervisorIdentityExpression(chat(1)), { location, document });
  assert.equal(roleRead.taskId, 'exact-task');
  assert.equal(roleRead.worktree, '/tmp/approved repo');
  assert.equal(roleRead.originalUserText, user.innerText);
  assert.equal(roleRead.latestUserText, user.innerText);

  const userMessage = { innerText: 'Remote Desktop Commander  \n\nProbe RemoteMCP2\nWorktree: /tmp/work-layout\nTask ID: work-task\nUse...', className: 'group/user-message flex flex-col items-end gap-2' };
  let heading;
  const parent = { children: [], querySelectorAll: selector => selector === 'h4.sr-only' ? [heading] : [] };
  heading = { textContent: 'You said:', parentElement: parent };
  parent.children.push(heading, userMessage);
  const workDocument = { querySelectorAll(selector) {
    if (selector === '[data-message-author-role]') return [];
    if (selector === 'main h4.sr-only') return [heading];
    throw Error('unexpected selector ' + selector);
  } };
  const workRead = runInNewContext(supervisorIdentityExpression(chat(1)), { location, document: workDocument });
  assert.equal(workRead.taskId, 'work-task');
  assert.equal(workRead.worktree, '/tmp/work-layout');
  // Live Helium Work UI indents Task ID after the selected Probe connector label.
  const previousText = userMessage.innerText;
  userMessage.innerText = 'Probe RemoteMCP2\n  Task ID: probe-live-task\nWorktree: /tmp/work-layout\nRead-only task';
  const indented = runInNewContext(supervisorIdentityExpression(chat(1)), { location, document: workDocument });
  assert.equal(indented.taskId, 'probe-live-task');
  assert.equal(indented.worktree, '/tmp/work-layout');
  userMessage.innerText = previousText;
  userMessage.innerText += ' … Show more';
  const expandedDecorated = runInNewContext(supervisorIdentityExpression(chat(1)), { location, document: workDocument });
  assert.equal(expandedDecorated.latestUserText, workRead.latestUserText);
  userMessage.innerText += ' Do something else';
  const tampered = runInNewContext(supervisorIdentityExpression(chat(1)), { location, document: workDocument });
  assert.notEqual(tampered.latestUserText, workRead.latestUserText);


  const assistantOnly = { querySelectorAll(selector) {
    if (selector === '[data-message-author-role]') return [assistant];
    if (selector === 'main h4.sr-only') return [];
    throw Error('unexpected selector ' + selector);
  } };
  const denied = runInNewContext(supervisorIdentityExpression(chat(1)), { location, document: assistantOnly });
  assert.equal(denied.originalUserText, null);
  assert.equal(denied.taskId, null);
  assert.equal(denied.worktree, null);
});

test('delayed post-click navigation persists the owned tab, reconciles the URL, and never clicks again', async t => {
  const f = await fixture(t), b = await f.adopt();
  f.finish('FLOWDECK_STATUS: implementation_done');
  await f.api.observeWorkResult(f.project, b, event());
  f.effects.navigationDelays = 2;
  const sent = await f.api.startNextTaskOnce(f.project, f.project.tasks[1], b, event());
  assert.equal(sent.tabId, 'new');
  assert.equal(sent.chatUrl, PROJECT, 'pending next-chat binding retains the owned project tab target');
  assert.equal(f.effects.clicks, 1);
  assert.equal((await f.api.reconcileSubmittedTurn(f.project, sent)).status, 'pending');
  const updated = await f.api.reconcileSubmittedTurn(f.project, sent);
  assert.equal(updated.status, 'ready');
  assert.equal(updated.binding.chatUrl, chat(2));
  assert.equal(f.effects.clicks, 1);
  assert.deepEqual(await f.api.startNextTaskOnce(f.project, f.project.tasks[1], b, event()), sent);
  assert.equal(f.effects.clicks, 1);
});

test('different connector-prefixed latest user text rejects the sealed submitted prompt without reclick', async t => {
  const f = await fixture(t), b = await f.adopt();
  f.finish('FLOWDECK_STATUS: implementation_done'); await f.api.observeWorkResult(f.project, b, event());
  f.effects.navigationDelays = 2;
  const sent = await f.api.startNextTaskOnce(f.project, f.project.tasks[1], b, event());
  assert.equal((await f.api.reconcileSubmittedTurn(f.project, sent)).status, 'pending');
  f.effects.latestIdentityText = 'Remote Desktop Commander\\n\\nDifferent task\\nWorktree: ' + f.repo + '\\nTask ID: two';
  await assert.rejects(f.api.reconcileSubmittedTurn(f.project, sent), /sealed prompt/);
  assert.equal(f.effects.clicks, 1);
});

test('full answer DOM probe falls back to role headings without truncating plain task/table replies', () => {
  const answer = '| Task | Result |\n| First | Implemented |\n' + 'Implementation details. '.repeat(40) + '\nFLOWDECK_STATUS: implementation_done';
  assert.ok(answer.indexOf('FLOWDECK_STATUS') > 400);
  const extract = ({ headings = [], messages = [], main = '', url = chat(1) } = {}) => {
    const location = new URL(url);
    const document = {
      querySelectorAll(selector) {
        if (selector === 'main h4.sr-only') return headings.map(textContent => ({ textContent }));
        assert.equal(selector, '[data-message-author-role]');
        return messages.map(([role, innerText]) => ({ innerText, getAttribute: name => {
          assert.equal(name, 'data-message-author-role'); return role;
        } }));
      },
      querySelector(selector) { assert.equal(selector, 'main'); return { innerText: main }; },
    };
    return runInNewContext(supervisorAnswerExpression(chat(1)), { location, document });
  };
  const fallback = { headings: ['You said:', 'ChatGPT said:', 'You said:', 'ChatGPT said:'],
    main: 'You said:\nEarlier task\nChatGPT said:\nOld answer\nYou said:\nCurrent task\nChatGPT said:\n' + answer +
      '\nChatGPT can make mistakes. Check important info.\nLatest response' };
  assert.equal(extract(fallback), answer);
  assert.equal(interpretSupervisorResult(extract(fallback)), 'implementation_done');
  const chromeFooter='\n\nIs this conversation helpful so far?';
  assert.equal(extract({ headings: fallback.headings, main: 'ChatGPT said:\n' + answer + chromeFooter }), answer);
  assert.equal(extract({ messages: [['user','Task'],['assistant',answer + chromeFooter]] }), answer);
  assert.equal(interpretSupervisorResult(extract({ headings: fallback.headings, main: 'ChatGPT said:\n' + answer + chromeFooter })), 'implementation_done');
  assert.equal(interpretSupervisorResult(extract({ messages: [['user','Task'],['assistant',answer + chromeFooter + '\nChanged instructions']] })), 'unknown');
  // Partial role attributes must not return an older assistant or mistake an old user for the latest role.
  assert.equal(extract({ ...fallback, messages: [['user', 'Earlier task'], ['assistant', 'Old answer']] }), answer);
  assert.equal(extract({ ...fallback, messages: [['user', 'Current task']] }), answer);
  assert.equal(extract({ messages: [['user', 'Task'], ['assistant', answer]] }), answer);
  assert.equal(extract({ ...fallback, headings: [...fallback.headings, 'You said:'],
    main: fallback.main + '\nYou said:\nNew pending task', messages: [['assistant', answer]] }), null);
  assert.equal(extract({ messages: [['user', 'New pending task']] }), null);
  assert.equal(extract({ main: 'ChatGPT said:\n' + answer }), null);
  assert.throws(() => extract({ ...fallback, url: chat(2) }), /Chat changed/);
});

test('status parser is conservative and rejects conflicting/quoted/invalid status text', () => {
  assert.equal(interpretSupervisorResult('Implementation complete.'), 'unknown');
  assert.equal(interpretSupervisorResult('The implementation is complete.'), 'unknown');
  assert.equal(interpretSupervisorResult('Implementation is incomplete; continue.'), 'unknown');
  assert.equal(interpretSupervisorResult('Work completed.\nFLOWDECK_STATUS: implementation_done'), 'implementation_done');
  for (const text of ['Success', 'I will finish implementation.', '> FLOWDECK_STATUS: implementation_done',
    'FLOWDECK_STATUS: done', '```\nFLOWDECK_STATUS: implementation_done\n```',
        'FLOWDECK_STATUS: continue\nFLOWDECK_STATUS: implementation_done',
    'FLOWDECK_STATUS: done\nFLOWDECK_STATUS: implementation_done', 'FLOWDECK_STATUS: implementation_done\nBut there is more work.'])
    assert.equal(interpretSupervisorResult(text), 'unknown');
});

test('scoped pre-click recovery preserves legacy claims and sends B only once',async t=>{
 const f=await fixture(t),binding=await f.adopt(),report=event();
 f.finish('FLOWDECK_STATUS: implementation_done');await f.api.observeWorkResult(f.project,binding,report);
 f.effects.matches=false;let failure;
 try{await f.api.startNextTaskOnce(f.project,f.project.tasks[1],binding,report);}catch(e){failure=e;}
 assert.equal(failure.type,'FlowdeckPreSendFailure');assert.equal(f.effects.clicks,0);
 const {createSendRecoveryStore,sendEventHash,sendPhaseHash}=await import(moduleUrl('flowdeck-send-recovery'));
 const eventHash=sendEventHash([f.project.id,'two','next',report.eventId]);
 const phaseHash=sendPhaseHash([f.project.id,'two','next','initial']);
 const auth=await f.api.authorizePreSendRecovery({projectId:f.project.id,taskId:'two',eventHash,phaseHash,oldDispatchId:failure.details[0].dispatchId,attemptId:'fixture-recovery',receiptPresent:false,taskBindingPresent:false});
 f.effects.matches=true;
 const resumed=await f.api.recoverPreSendOnce(f.project,binding,f.project.tasks[1],report,'next',auth);
 assert.equal(resumed.taskId,'two');assert.equal(f.effects.clicks,1);
 await f.api.recoverPreSendOnce(f.project,binding,f.project.tasks[1],report,'next',auth);
 assert.equal(f.effects.clicks,1,'receipt reconciliation never repeats a click');
 const store=createSendRecoveryStore(f.base);assert.ok((await store.readEntries(auth.newDispatchId)).some(e=>e.phase==='click_attempted'));
 const originalClaim=JSON.parse(await readFile(join(f.base,'.state/flowdeck-supervisor','send-event-'+eventHash+'.json'),'utf8'));assert.equal(originalClaim.dispatchId,failure.details[0].dispatchId);
});

test('actual legacy-root structure follows successor CLI request into the B-only workflow with one fake click',async t=>{
 const f=await fixture(t),binding=await f.adopt(),report=event();
 f.finish('FLOWDECK_STATUS: implementation_done');await f.api.observeWorkResult(f.project,binding,report);
 const {createSendRecoveryStore,sendEventHash,sendPhaseHash,LEGACY_STAGE_ORDER_ATTESTATION,readRecoveryResumeRequest,claimRecoveryRelease}=await import(moduleUrl('flowdeck-send-recovery'));
 const store=createSendRecoveryStore(f.base);
 const eventHash=sendEventHash([f.project.id,'two','next',report.eventId]),phaseHash=sendPhaseHash([f.project.id,'two','next','initial']);
 await writeFile(join(f.base,'.state/flowdeck-supervisor',`send-event-${eventHash}.json`),JSON.stringify({workId:report.workId}));
 await writeFile(join(f.base,'.state/flowdeck-supervisor',`send-phase-${phaseHash}.json`),JSON.stringify({eventId:report.eventId}));
 const parent=await store.authorize({projectId:f.project.id,taskId:'two',eventHash,phaseHash,oldDispatchId:'legacy-b-stage-126',attemptId:'original-failed-workflow',receiptPresent:false,taskBindingPresent:false,
  legacyProof:{kind:'temporal-activity-stage-failure-v1',verified:true,runId:'legacy-run',workflowId:'legacy-workflow',scheduledEventId:'126',historySha256:'a'.repeat(64),sourceAttestation:LEGACY_STAGE_ORDER_ATTESTATION}});
 f.effects.matches=false;
 await assert.rejects(f.api.recoverPreSendOnce(f.project,binding,f.project.tasks[1],report,'next',parent),e=>e.type==='FlowdeckPreSendFailure');
 assert.deepEqual(await store.readEntries('legacy-b-stage-126'),[],'never fabricate a root journal');
 const rootSlotPath=join(store.root,`authorization-slot-${phaseHash}.json`),rootBefore=await readFile(rootSlotPath,'utf8');
 const {execFileSync}=await import('node:child_process');
 const cli=new URL('../scripts/flowdeck-reconcile-send.mjs',import.meta.url).pathname;
 const cliArgs=[cli,'--project',f.project.id,'--task','two','--send-event-hash',eventHash,'--phase-hash',phaseHash,'--recorded-attempt-id','original-failed-workflow','--old-dispatch-id',parent.newDispatchId,'--successor-recovery'];
 const snapshot=async()=>Promise.all((await readdir(store.root)).sort().map(async name=>[name,await readFile(join(store.root,name),'utf8')]));
 const beforePreview=await snapshot(),effectBefore={...f.effects,stages:[...f.effects.stages]};
 const preview=JSON.parse(execFileSync(process.execPath,cliArgs,{cwd:f.base,encoding:'utf8',timeout:10000}));
 assert.equal(preview.eligible,true,'lineage is eligible in the disposable fixture');
 assert.equal(preview.readyForExecution,false,'missing historical CDP tab must block execution');
 assert.equal(preview.predecessorTabPresent,false);
 assert.equal(preview.writes,false);
 assert.deepEqual(await snapshot(),beforePreview,'CLI preview did not write any authorization, journal or consumption markers');
 assert.deepEqual(f.effects,effectBefore,'preview did not create a tab, stage or click');
 assert.throws(()=>execFileSync(process.execPath,[...cliArgs,'--apply','--approve-successor-recovery'],{cwd:f.base,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}),/Successor recovery readiness refused/);
 assert.deepEqual(await snapshot(),beforePreview,'even explicit fixture apply is fail-closed without a predecessor');
 // The rest of this disposable Temporal fake-browser regression uses a directly issued
 // fixture authorization, NOT the production CLI. This never touches the live project.
 const authorization=await store.authorizeSuccessor({projectId:f.project.id,taskId:'two',eventHash,phaseHash,failedParentDispatchId:parent.newDispatchId,failedAttemptId:'original-failed-workflow'});
 const requestPath=join(store.root,'resume-'+authorization.authorizationId+'.json');
 await writeFile(requestPath,JSON.stringify({projectId:f.project.id,taskId:'two',completedTaskId:'one',
  phase:'next',previous:binding,event:report,authorization},null,2)+'\n');
 const issued={requestPath};
 const requestBytes=await readFile(issued.requestPath,'utf8');
 const input=await readRecoveryResumeRequest(f.base,issued.requestPath,f.project);
 assert.equal(input.authorization.kind,'successor');assert.equal(input.authorization.oldDispatchId,parent.newDispatchId);
 const workflowId=`flowdeck-supervisor-${f.project.id}--fixture-successor-2`;
 await claimRecoveryRelease(f.base,workflowId,'fixture-run-2',input.authorization.authorizationId);
 await assert.rejects(claimRecoveryRelease(f.base,workflowId,'fixture-run-2',input.authorization.authorizationId),/already claimed/);
 await assert.rejects(readRecoveryResumeRequest(f.base,issued.requestPath,{...f.project,id:'wrong-project'}),/scope/);
 assert.equal(await readFile(rootSlotPath,'utf8'),rootBefore);
 const handlers=new Map();let recovered=0;
 f.effects.matches=true;
 const activities={...f.api,
  publishSupervisorState:async state=>{await f.api.publishSupervisorState(state);if(state.phase==='waiting_for_manual_start'){handlers.get('supervisorRecoveryReady')();handlers.get('supervisorRecoveryReady')();}},
  recoverPreSendOnce:async(...args)=>{recovered++;const result=await f.api.recoverPreSendOnce(...args);f.finish('FLOWDECK_STATUS: implementation_done',chat(2));handlers.get('supervisorWorkEvent')(event('work_reported','B-work'));handlers.get('supervisorWorkEvent')(event('work_started','B-work'));return result;}
 };
 const ts=await import('typescript');
 const source=await readFile(new URL('../src/flowdeck-supervisor-workflow.ts',import.meta.url),'utf8');
 const compiled=ts.default.transpileModule(source,{compilerOptions:{module:ts.default.ModuleKind.CommonJS,target:ts.default.ScriptTarget.ES2022}}).outputText;
 const budgetModule=await import('../dist/flowdeck-pilot-budget.js');
 const exports={};runInNewContext(compiled,{exports,require:name=>{if(name==='./flowdeck-pilot-budget.js')return budgetModule;assert.equal(name,'@temporalio/workflow');return{defineSignal:n=>n,defineQuery:n=>n,setHandler:(n,fn)=>handlers.set(n,fn),
  patched:id=>{assert.ok(['flowdeck-status-projection-isolation-v1','flowdeck-attended-pilot-send-budget-v1'].includes(id));return true;},
  isCancellation:()=>false,proxyActivities:()=>activities,condition:async fn=>fn(),sleep:async()=>{}};}});
 const state=await exports.flowdeckRecoverSend(input);
 assert.equal(state.phase,'approved_cycle_finished');assert.equal(recovered,1);assert.equal(f.effects.clicks,1);
 assert.ok(state.tasks.every(task=>task.implementationStatus==='implementation_done'&&task.reviewStatus==='review_pending'));
 await assert.rejects(store.consumeSuccessor(input.authorization),/consumed|click/);
 assert.equal(await readFile(rootSlotPath,'utf8'),rootBefore);assert.equal(await readFile(issued.requestPath,'utf8'),requestBytes);
 await assert.rejects(readRecoveryResumeRequest(f.base,issued.requestPath,f.project),/consumed/);
});


test('post-send adoption refuses a mismatched persisted binding even when its hash is present', async t => {
  const f = await fixture(t), first = await f.adopt(), report = event();
  f.finish('FLOWDECK_STATUS: implementation_done');
  await f.api.observeWorkResult(f.project, first, report);
  const sent = await f.api.startNextTaskOnce(f.project, f.project.tasks[1], first, report);
  const path = join(f.base, '.state/flowdeck-supervisor', 'binding-' +
    createHash('sha256').update(JSON.stringify([f.project.id, sent.workId])).digest('hex') + '.json');
  const prior = await bindingRecord(f, sent.workId);
  assert.match(prior.expectedPromptHash, /^[a-f0-9]{64}$/);
  for (const mutation of [
    { ...prior, binding: { ...prior.binding, workId: 'other-work' } },
    { ...prior, expectedPromptHash: 'not-a-sealed-hash' },
    { ...prior, users: 0 }
  ]) {
    await writeFile(path, JSON.stringify(mutation));
    await assert.rejects(f.api.adoptStartedWork(f.project, event('work_started', 'new-B-work'), f.project.tasks[1], sent),
      /exact sealed prompt proof/);
    const name = 'binding-' + createHash('sha256').update(JSON.stringify([f.project.id, 'new-B-work'])).digest('hex') + '.json';
    assert.ok(!(await readdir(join(f.base, '.state/flowdeck-supervisor'))).includes(name));
    assert.equal(f.effects.clicks, 1, 'adoption never resends');
  }
});

test('real fixture send -> adoption -> completion retains verifiable seal without further sends', async t => {
  const f = await fixture(t), first = await f.adopt(), report = event();
  f.finish('FLOWDECK_STATUS: implementation_done');
  await f.api.observeWorkResult(f.project, first, report);
  const sent = await f.api.startNextTaskOnce(f.project, f.project.tasks[1], first, report);
  const successor = await f.api.adoptStartedWork(f.project, event('work_started', 'successor-work'), f.project.tasks[1], sent);
  f.finish('FLOWDECK_STATUS: implementation_done', chat(2));
  await f.api.observeWorkResult(f.project, successor, event('work_reported', 'successor-work'));
  const {evaluatePredecessorReadiness,readPredecessorRecords} =
    await import('../scripts/flowdeck-predecessor-readiness.mjs');
  const records=await readPredecessorRecords(f.base,successor);
  const stored=records.record;
  assert.equal(stored.users,1);
  assert.match(stored.expectedPromptHash,/^[a-f0-9]{64}$/);
  const before=await readdir(join(f.base,'.state/flowdeck-supervisor'));
  const actual=await evaluatePredecessorReadiness({
    project:f.project,previous:successor,...records,
    readers:{
      listTabs:async()=>[{...f.pages.get('new'),webSocketDebuggerUrl:'ws://fixture'}],
      inspect:async()=>({
        tabId:successor.tabId,chatUrl:successor.chatUrl,turnState:'turn_finished',
        userTurns:stored.users,lastAssistant:f.states.get(chat(2)).lastAssistant,
        identity:{taskId:successor.taskId,worktree:f.repo,projectUrl:f.project.projectUrl,
          latestUserTurns:stored.users,originalUserHash:stored.expectedPromptHash,
          latestUserHash:stored.expectedPromptHash}
      })
    }
  });
  assert.equal(actual.readyForPredecessor,true);
  assert.equal(actual.predecessorEvidenceVerified,true);
  assert.equal(actual.writes,false);
  assert.equal(f.effects.clicks,1);
  assert.deepEqual(await readdir(join(f.base,'.state/flowdeck-supervisor')),before);
});

test('dispatch cancellation before authority claim prevents browser mutation and send claims', async t => {
  const f=await fixture(t), binding=await f.adopt(), report=event();
  f.finish();await f.api.observeWorkResult(f.project,binding,report);
  f.effects.dispatchCancelled=true;
  await assert.rejects(f.api.sendContinuationOnce(f.project,binding,f.project.tasks[0],report),/Activity cancelled/);
  assert.equal(f.effects.creates,0);
  assert.equal(f.effects.stages.length,0);
  assert.equal(f.effects.clicks,0);
  assert.ok(f.effects.dispatchGuardChecks>=1);
  const files=await readdir(join(f.base,'.state/flowdeck-supervisor'));
  assert.ok(!files.some(v=>/^(?:send-event|send-phase|sent)-/.test(v)), 'no new send claims or receipts');
});

test('dispatch deadline expiration before send claims has no browser or authorization side effects', async t => {
  const f=await fixture(t), binding=await f.adopt(), report=event();
  f.finish();await f.api.observeWorkResult(f.project,binding,report);
  f.effects.dispatchExpired=true;
  await assert.rejects(f.api.sendContinuationOnce(f.project,binding,f.project.tasks[0],report),/Dispatch deadline elapsed/);
  assert.equal(f.effects.creates,0);
  assert.equal(f.effects.stages.length,0);
  assert.equal(f.effects.clicks,0);
  const files=await readdir(join(f.base,'.state/flowdeck-supervisor'));
  assert.ok(!files.some(v=>/^(?:send-event|send-phase|sent)-/.test(v)));
});

test('cancellation during async staging records pre_send_failed and never reaches click_attempted', async t => {
  const f=await fixture(t),binding=await f.adopt(),report=event();
  f.finish('FLOWDECK_STATUS: implementation_done');
  await f.api.observeWorkResult(f.project,binding,report);
  f.effects.cancelDuringStage=true;
  await assert.rejects(f.api.startNextTaskOnce(f.project,f.project.tasks[1],binding,report),
    /Activity cancelled/);
  assert.equal(f.effects.creates,1);
  assert.equal(f.effects.stages.length,1);
  assert.equal(f.effects.clicks,0);
  const names=await readdir(join(f.base,'.state/flowdeck-supervisor/send-recovery'));
  assert.ok(names.some(n=>n.includes('pre_send_failed')),'durable pre_send_failed');
  assert.ok(!names.some(n=>n.includes('click_attempted')),'no durable click intent');
  await assert.rejects(f.api.startNextTaskOnce(f.project,f.project.tasks[1],binding,report),/unresolved|Activity cancelled/);
  assert.equal(f.effects.clicks,0);
});

test('cancellation between durable click intent and browser evaluation remains uncertain', async t => {
  const f=await fixture(t),binding=await f.adopt(),report=event();
  f.finish();await f.api.observeWorkResult(f.project,binding,report);
  f.effects.cancelBeforeClick=true;
  await assert.rejects(f.api.sendContinuationOnce(f.project,binding,f.project.tasks[0],report),/Activity cancelled/);
  assert.equal(f.effects.clicks,0,'guard stopped click before mock side effect');
  assert.ok(Number.isFinite(f.effects.clickDeadline),'explicit deadline passed to browser');
  const names=await readdir(join(f.base,'.state/flowdeck-supervisor/send-recovery'));
  assert.ok(names.some(n=>n.includes('click_attempted')),'durable click attempt retained');
  assert.ok(!names.some(n=>n.includes('pre_send_failed')),'after click intent cannot be misclassified as safe pre-send failure');
  f.effects.dispatchCancelled=false;f.effects.cancelBeforeClick=false;
  await assert.rejects(f.api.sendContinuationOnce(f.project,binding,f.project.tasks[0],report),/unresolved/);
  assert.equal(f.effects.clicks,0,'no retry after uncertain send');
});

test('marker-less completion report cannot authorize the next task',async t=>{
 const f=await fixture(t), b=await f.adopt(), report=event();
 f.finish('Implementation complete.');
 const observed=await f.api.observeWorkResult(f.project,b,report);
 assert.equal(observed.decision,'unknown');
 await assert.rejects(f.api.startNextTaskOnce(f.project,f.project.tasks[1],b,report),/Fresh finished-turn decision required/);
 assert.equal(f.effects.creates,0);
 assert.equal(f.effects.stages.length,0);
 assert.equal(f.effects.clicks,0);
});
