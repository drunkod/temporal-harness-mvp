import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SupervisorProject } from './flowdeck-projects.js';
import type { WorkEventV1 } from './flowdeck-work-events.js';


export type ReconciliationConfig = {
  pluginRepo: string; db: string; owner: string; device: string; auditDirectory: string;
  flowdeckRoot: string; inboxDirectory: string;
  workflowId: string; projectId: string; taskId: string; workId: string; chatUrl: string;
  tabId: string; executionId: string; startEventId: string; reportEventId: string;
  worktree?: string;
};
export type SourceReader = { read(cursor: string | null, limit?: number): Promise<SourcePage> };
export type SourcePage = { events: unknown[]; nextCursor?: string | null; gap?: boolean };
export type TemporalPort = {
  describe(): Promise<{ status: string; runId?: string }>;
  query(): Promise<unknown>;
  history(): Promise<unknown>;
  signal(name: string, event: WorkEventV1): Promise<void>;
};
export type BrowserPort = { observe(chatUrl: string, tabId: string): Promise<BrowserObservation> };
export type BrowserObservation = {
  projectUrl?: string; taskId?: string | null; worktree?: string | null;
  latestUserHash?: string | null; turnState: string; lastAssistant?: string; userTurns?: number;
};
export type ReconciliationIO = {
  project: SupervisorProject;
  reader: SourceReader;
  temporal: TemporalPort;
  browser: BrowserPort;
  readFile?: (path: string) => Promise<string>;
  fileExists?: (path: string) => Promise<boolean>;
  writeAudit?: (path: string, value: unknown, exclusive?: boolean) => Promise<void>;
};
export type ReconciliationResult = {
  mode: 'preview' | 'apply'; projectId: string; taskId: string; workId: string;
  workflowId: string; runId: string; source: { start: WorkEventV1; report: WorkEventV1 };
  missing: Array<'work_started' | 'work_reported'>; signaled: string[]; alreadyPresent: string[];
  auditDirectory: string;
};

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = (value: unknown): unknown => {
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]));
  return value;
};
const same = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const canonicalProject = (value: string) => {
  const u = new URL(value);
  const path = u.pathname.replace(/\/project\/?$/, '').replace(/-dr-sashai$/i, '');
  return u.origin + path + '/project';
};
const parseSashaiChatUrl = (value: string) => {
  const u = new URL(value);
  if (u.origin !== 'https://chatgpt.com') throw Error('Chat must be hosted on chatgpt.com');
  const match = u.pathname.match(/^\/g\/(g-p-6ab28bdd7fbc8191b581316ff09da79d(?:-[a-z0-9-]+)?)\/c\/([0-9a-f-]{36})$/i);
  if (!match) throw Error('Chat must be a conversation INSIDE the Sashai project');
  return { url: u.origin + u.pathname, conversationId: match[2] };
};
const canonicalChat = (v: string) => parseSashaiChatUrl(v).url;
const normalizeComposerText = (value: string) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
const eventKey = (event: WorkEventV1) => JSON.stringify([event.source, event.ownerId, event.deviceId, event.eventId]);
const supervisorFile = (directory: string, kind: string, key: unknown) => join(directory, kind + '-' + sha(key) + '.json');

function assertEvent(value: unknown, expected: 'work_started' | 'work_reported', config: ReconciliationConfig): asserts value is WorkEventV1 {
  const event = value as Partial<WorkEventV1>;
  if (!event || event.schema !== 'remote-mcp.work-event/v1' || event.source !== 'remote-mcp-jazz' ||
      event.origin !== 'event' || event.ownerId !== config.owner || event.deviceId !== config.device ||
      event.workId !== config.workId || event.kind !== expected || typeof event.eventId !== 'string' ||
      event.executionVerified !== false || event.backgroundProcesses !== 'unknown' ||
      event.timestampEvidence !== 'recorded_in_source_transaction') throw Error('Source event scope or payload mismatch');
  if (expected === 'work_started' && (event.revision !== 1 || event.completionEvidence !== 'none' || event.eventId !== config.startEventId))
    throw Error('Start event ID or full payload mismatch');
  if (expected === 'work_reported' && (event.revision !== 2 || event.completionEvidence !== 'agent_report_only' ||
      !['success', 'partial', 'failed'].includes(event.outcome ?? '') || event.eventId !== config.reportEventId ||
      typeof event.reportedAt !== 'string')) throw Error('Report event ID or full payload mismatch');
  for (const timestamp of [event.startedAt, event.sourceCommittedAt]) if (!text(timestamp) || !Number.isFinite(Date.parse(timestamp)))
    throw Error('Source event timestamp is invalid');
}

export async function readAuthoritativePair(reader: SourceReader, config: ReconciliationConfig): Promise<{ start: WorkEventV1; report: WorkEventV1 }> {
  let cursor: string | null = null;
  const found = new Map<string, unknown>();
  const cursors = new Set<string>();
  for (let page = 0; page < 10_000 && found.size < 2; page++) {
    const result = await reader.read(cursor, 128);
    if (!result || result.gap) throw Error('Source ledger pagination gap; refuse reconciliation');
    for (const event of result.events ?? []) {
      const id = (event as { eventId?: unknown })?.eventId;
      if (id === config.startEventId || id === config.reportEventId) found.set(String(id), event);
    }
    const next = result.nextCursor ?? null;
    if (!next || next === cursor || cursors.has(next)) break;
    cursors.add(next); cursor = next;
  }
  if (!found.has(config.startEventId) || !found.has(config.reportEventId)) throw Error('Exact source event pair not found');
  const start = found.get(config.startEventId), report = found.get(config.reportEventId);
  assertEvent(start, 'work_started', config); assertEvent(report, 'work_reported', config);
  if (Date.parse(start.sourceCommittedAt) > Date.parse(report.sourceCommittedAt)) throw Error('Source event order is invalid');
  return { start, report };
}

function collectHistoryEvents(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) { for (const item of value) collectHistoryEvents(item, out); return out; }
  if (value instanceof Uint8Array) {
    try { collectHistoryEvents(JSON.parse(Buffer.from(value).toString('utf8')), out); } catch { /* non-JSON Temporal payload */ }
    return out;
  }
  if (typeof value === 'string') {
    try { collectHistoryEvents(JSON.parse(value), out); } catch { /* metadata string */ }
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (key === 'data' || /signal|payload|event/i.test(key)) collectHistoryEvents(child, out);
    else if (child && typeof child === 'object') collectHistoryEvents(child, out);
  }
  if (record.eventId || record.workId || record.kind) out.push(record);
  return out;
}
function decodePayload(value: unknown): unknown {
  if (value instanceof Uint8Array) { try { return JSON.parse(Buffer.from(value).toString('utf8')); } catch { return null; } }
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return null; } }
  return value;
}
function supervisorSignals(history: unknown): WorkEventV1[] {
  const events = Array.isArray(history) ? history : (history && typeof history === 'object' && Array.isArray((history as any).events) ? (history as any).events : []);
  const result: WorkEventV1[] = [];
  for (const item of events) {
    const attrs = (item as any)?.workflowExecutionSignaledEventAttributes;
    if (!attrs || attrs.signalName !== 'supervisorWorkEvent') continue;
    const payloads = attrs.input?.payloads ?? attrs.input?.payload ?? [];
    const values = Array.isArray(payloads) ? payloads : [payloads];
    const value = decodePayload(values[0]?.data ?? values[0]);
    if (!value || typeof value !== 'object') throw Error('Supervisor signal payload is unreadable');
    result.push(value as WorkEventV1);
  }
  return result;
}
function historyHas(history: unknown, event: WorkEventV1): boolean {
  const sameId = supervisorSignals(history).filter(candidate => candidate.eventId === event.eventId);
  if (sameId.some(candidate => !same(candidate, event))) throw Error('Supervisor signal eventId collision in workflow history');
  return sameId.some(candidate => same(candidate, event));
}
function assertHistoryCollisionFree(history: unknown, expected: WorkEventV1[]) {
  const signals = supervisorSignals(history), byId = new Map<string, WorkEventV1>();
  for (const signal of signals) {
    if (!text(signal.eventId)) throw Error('Supervisor signal without event ID');
    const prior = byId.get(signal.eventId);
    if (prior && !same(prior, signal)) throw Error('Supervisor signal eventId collision in workflow history');
    byId.set(signal.eventId, signal);
  }
  for (const event of expected) historyHas(history, event);
}
async function inboxEvent(inboxDirectory: string, event: WorkEventV1, read: (path: string) => Promise<string>): Promise<'absent' | 'same'> {
  let state: any;
  try { state = JSON.parse(await read(join(inboxDirectory, 'inbox.json'))); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'; throw e; }
  const key = eventKey(event), record = state?.events?.[key];
  for (const entry of Object.values(state?.events ?? {})) {
    const candidate = (entry as any)?.event;
    if (candidate?.eventId === event.eventId && !same(candidate, event)) throw Error('Inbox eventId collision with a different payload');
  }
  if (record?.event) return 'same';
  for (const snapshot of Object.values(state?.snapshots ?? {})) if ((snapshot as any)?.eventId === event.eventId && !same(snapshot, event))
    throw Error('Inbox eventId collision with a different snapshot payload');
  return 'absent';
}
function answerIsFinished(answer: string): boolean {
  const statuses = [...answer.matchAll(/^FLOWDECK_STATUS:\s*(continue|implementation_done|needs_attention)\s*$/gm)].map(m => m[1]);
  return statuses.length === 1 && (answer.match(/FLOWDECK_STATUS/g) ?? []).length === 1 &&
    /^FLOWDECK_STATUS:\s*(continue|implementation_done|needs_attention)$/.test(answer.trim().split(/\r?\n/).at(-1) ?? '');
}

async function defaultRead(path: string) { return readFile(path, 'utf8'); }
async function defaultExists(path: string) { try { await readFile(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
async function defaultAudit(path: string, value: unknown, exclusive = false) {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
}

export async function reconcileEvents(config: ReconciliationConfig, io: ReconciliationIO, apply = false): Promise<ReconciliationResult> {
  for (const path of [config.pluginRepo, config.db, config.auditDirectory, config.flowdeckRoot, config.inboxDirectory])
    if (!path.startsWith('/')) throw Error('Config paths must be absolute');
  if (io.project.id !== config.projectId || io.project.ownerId !== config.owner || io.project.deviceId !== config.device)
    throw Error('Project owner/device enrollment does not match the selected scope');
  if (!io.project.tasks.some(task => task.id === config.taskId)) throw Error('Project/task is not exactly enrolled');
  if (resolve(config.worktree ?? io.project.repo) !== resolve(io.project.repo)) throw Error('Approved worktree mismatch');
  const task = io.project.tasks.find(candidate => candidate.id === config.taskId)!;
  const chat = canonicalChat(config.chatUrl);
  const chatProject = canonicalProject(new URL(chat).origin + new URL(chat).pathname.split('/c/')[0] + '/project');
  if (chatProject !== canonicalProject(io.project.projectUrl) || chatProject !== canonicalProject('https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project'))
    throw Error('Chat/project is outside the enrolled Sashai allowlist');
  const pair = await readAuthoritativePair(io.reader, config);
  const described = await io.temporal.describe();
  if (described.status !== 'RUNNING' || described.runId !== config.executionId) throw Error('Temporal execution is not the selected RUNNING execution');
  const state = await io.temporal.query() as Record<string, unknown>;
  const phase = String(state.phase), allowed = new Set(['pending_adoption', 'waiting_for_work_start', 'working']);
  const workMatches = phase === 'waiting_for_work_start' ? state.workId === null : state.workId === config.workId;
  if (state.projectId !== config.projectId || state.taskId !== config.taskId || !workMatches || state.chatUrl !== chat ||
      state.tabId !== config.tabId || !allowed.has(phase) || !['running', 'waiting'].includes(String(state.status)))
    throw Error('Temporal target is wrong-scope or not in a reconciliable phase');
  const observed = await io.browser.observe(chat, config.tabId);
  if (observed.projectUrl && canonicalProject(observed.projectUrl) !== chatProject || observed.taskId !== config.taskId ||
      observed.worktree !== config.worktree && observed.worktree !== io.project.repo || !observed.latestUserHash ||
      observed.turnState !== 'turn_finished' || !text(observed.lastAssistant) || !answerIsFinished(observed.lastAssistant))
    throw Error('Finished browser task/worktree identity is not exact');
  const read = io.readFile ?? defaultRead, exists = io.fileExists ?? defaultExists;
  const store = join(config.flowdeckRoot, '.state', 'flowdeck-supervisor');
  const entries = await readdir(store).catch(error => { if (error.code === 'ENOENT') throw Error('Main Flowdeck supervisor store is missing'); throw error; });
  const readJson = async (name: string) => JSON.parse(await read(join(store, name))) as Record<string, any>;
  const taskBinding = await readJson('task-' + sha([config.projectId, config.taskId]) + '.json');
  const taskChat = taskBinding.chatUrl as string, previousWorkId = taskBinding.workId as string;
  const previousRecord = await readJson('binding-' + sha([config.projectId, previousWorkId]) + '.json');
  if (taskBinding.projectId !== config.projectId || taskBinding.taskId !== config.taskId || taskChat !== chat || taskBinding.tabId !== config.tabId ||
      !text(previousWorkId) || previousWorkId === config.workId) throw Error('Previous task/chat/tab binding is missing or changed');
  const sentFiles = entries.filter(name => name.startsWith('sent-') && name.endsWith('.json'));
  let receipt: Record<string, any> | undefined, receiptName = '', previousReportEventId = '';
  for (const name of sentFiles) {
    const candidate = await readJson(name).catch(() => null); if (!candidate) continue;
    const b = candidate.binding, previous = candidate.previous;
    if (b?.projectId === config.projectId && b.taskId === config.taskId && b.chatUrl === chat && b.tabId === config.tabId && b.workId === previousWorkId &&
        previous?.projectId === config.projectId && previous.taskId === config.taskId && previous.chatUrl === chat && previous.tabId === config.tabId && previous.workId === previousWorkId &&
        candidate.promptHash && (!receipt || name < receiptName)) { receipt = candidate; receiptName = name; }
  }
  if (!receipt) throw Error('Preceding sent receipt for the exact task/chat/tab/work is missing');
  const phaseName = 'send-phase-' + sha([config.projectId, config.taskId, 'continue', previousWorkId]) + '.json';
  const phaseFile = await (async () => {
    if (!entries.includes(phaseName)) return null;
    const value = await readJson(phaseName).catch(() => null);
    return value?.eventId ? { eventId: value.eventId, value } : null;
  })();
  const exactSentName = 'sent-' + sha([config.projectId, config.taskId, 'continue', phaseFile?.eventId ?? '']) + '.json';
  const exactEventName = 'send-event-' + sha([config.projectId, config.taskId, 'continue', phaseFile?.eventId ?? '']) + '.json';
  const exactPhaseName = 'send-phase-' + sha([config.projectId, config.taskId, 'continue', previousWorkId]) + '.json';
  const exactSent = phaseFile?.eventId ? await readJson(exactSentName).catch(() => null) : null;
  const exactEvent = phaseFile?.eventId ? await readJson(exactEventName).catch(() => null) : null;
  const exactPhase = phaseFile?.eventId ? await readJson(exactPhaseName).catch(() => null) : null;
  if (!phaseFile?.eventId || phaseFile.eventId === config.reportEventId || !exactSent || !same(exactSent, receipt) ||
      exactEvent?.workId !== previousWorkId || exactPhase?.eventId !== phaseFile.eventId)
    throw Error('Preceding send-event/send-phase/receipt claim proof is missing or keyed to the new event');
  const expectedPromptHash = receipt.promptHash as string;
  if (previousRecord.expectedPromptHash !== expectedPromptHash || observed.latestUserHash !== expectedPromptHash)
    throw Error('Latest browser user prompt hash does not match the sealed preceding send');
  const inboxPresence = new Map<string, 'absent' | 'same'>();
  for (const event of [pair.start, pair.report]) inboxPresence.set(event.eventId, await inboxEvent(config.inboxDirectory, event, read));
  const history = await io.temporal.history();
  assertHistoryCollisionFree(history, [pair.start, pair.report]);
  const missing: Array<'work_started' | 'work_reported'> = [];
  for (const event of [pair.start, pair.report]) if (!historyHas(history, event)) missing.push(event.kind);
  const result: ReconciliationResult = { mode: apply ? 'apply' : 'preview', projectId: config.projectId, taskId: task.id, workId: config.workId,
    workflowId: config.workflowId, runId: config.executionId, source: pair, missing, signaled: [], alreadyPresent: [pair.start.eventId, pair.report.eventId].filter(id => !missing.includes(id === pair.start.eventId ? 'work_started' : 'work_reported')), auditDirectory: config.auditDirectory };
  if (!apply || !missing.length) return result;
  await mkdir(config.auditDirectory, { recursive: true, mode: 0o700 });
  const lock = join(config.auditDirectory, 'reconciliation.lock');
  try { await writeFile(lock, JSON.stringify({ workflowId: config.workflowId, runId: config.executionId }) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch { throw Error('Another reconciliation owner exists; refuse concurrent apply'); }
  try {
    const audit = async (event: WorkEventV1) => {
      const name = join(config.auditDirectory, 'event-' + sha(event.eventId) + '.json');
      if (await exists(name)) {
        const prior = JSON.parse(await read(name));
        if (prior.workflowId !== config.workflowId || prior.runId !== config.executionId || !same(prior.event, event)) throw Error('Audit intent differs; refuse retry');
        if(prior.state==='receipt'){result.alreadyPresent.push(event.eventId);return;}
        if (!historyHas(await io.temporal.history(), event)) throw Error('Audit intent is sealed without a history receipt; no blind retry');
      } else await (io.writeAudit ?? defaultAudit)(name, { event, workflowId: config.workflowId, runId: config.executionId, state: 'intent' }, true);
      if (historyHas(await io.temporal.history(), event)) { await (io.writeAudit ?? defaultAudit)(name, { event, workflowId: config.workflowId, runId: config.executionId, state: 'receipt', receiptId: eventKey(event) }); result.signaled.push(event.eventId); return; }
      try { await io.temporal.signal('supervisorWorkEvent', event); }
      catch { if (historyHas(await io.temporal.history(), event)) { await (io.writeAudit ?? defaultAudit)(name, { event, workflowId: config.workflowId, runId: config.executionId, state: 'receipt', receiptId: eventKey(event) }); result.signaled.push(event.eventId); return; } throw Error('Signal outcome uncertain; reconcile via history before retry'); }
      await (io.writeAudit ?? defaultAudit)(name, { event, workflowId: config.workflowId, runId: config.executionId, state: 'receipt', receiptId: eventKey(event) }); result.signaled.push(event.eventId);
    };
    for (const event of [pair.start, pair.report]) if (missing.includes(event.kind)) await audit(event);
  } finally { await unlink(lock).catch(() => {}); }
  return result;
}

export { supervisorFile, sha };
