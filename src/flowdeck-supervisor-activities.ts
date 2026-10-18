import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createLiveBrowser, browserEvaluate, type LiveBrowser } from './sashai-live-browser.js';
import { composerPayloadFor, normalizeComposerText } from './sashai-dispatch-evidence.js';
import { listSashaiTabs, observeSashaiConversation, parseSashaiChatUrl } from './sashai-observer.js';
import { createSupervisorProjectLoader, type ApprovedTask, type SupervisorProject } from './flowdeck-projects.js';
import type { WorkEventV1 } from './flowdeck-work-events.js';
import { ApplicationFailure, Context } from '@temporalio/activity';
import { createSendRecoveryStore, sanitizeSendCause, sendEventHash, sendPhaseHash, type SendRecoveryAuthorization } from './flowdeck-send-recovery.js';
import {readPreparedManualStart,inspectPreparedFirstMessage} from './flowdeck-manual-start.js';
export { loadSupervisorProject } from './flowdeck-projects.js';
export type { ApprovedTask, SupervisorProject } from './flowdeck-projects.js';

/** Canonical attended/autonomous task prompt. The phase controls only the first sentence. */
export function supervisedTaskPrompt(p: SupervisorProject, t: ApprovedTask, phase: 'initial' | 'continue') {
  return `${phase === 'continue' ? 'Continue ONLY the current task in this same conversation.' : 'Implement ONLY this approved task in this new project conversation.'}\nRepository/worktree: ${p.repo}\nTask ID: ${t.id}\nTask title: ${t.title}\n${t.instruction}\nFollow AGENTS.md and the explicit active-plan/worktree routing. Do not select another task or change authority markers. This is implementation supervision, not acceptance or code review. At the start of EVERY supervised turn, including this turn and every continuation of the same task, call the existing Probe RemoteMCP2 begin_work tool before any implementation/device work. Start a NEW work session with a fresh UUID requestKey each turn; retain its returned workId and never reuse a previous turn's workId. At the end of this turn, call the existing Probe RemoteMCP2 finish_work tool exactly once with that workId and a factual summary and known workingDirectory. Use outcome partial for unfinished work (FLOWDECK_STATUS: continue), success only for implementation_done, or failed for a blocking failure (needs_attention); these are agent reports, not independent verification or acceptance. Call finish_work before the final answer's status marker, and put nothing after the marker. End your answer with exactly one last line: FLOWDECK_STATUS: continue, FLOWDECK_STATUS: implementation_done, or FLOWDECK_STATUS: needs_attention (choose one).`;
}

export type WorkBinding = { projectId: string; taskId: string; chatUrl: string; tabId: string; workId: string };
export type WorkObservation = { turn: 'running' | 'finished' | 'unknown';
  decision: 'continue' | 'implementation_done' | 'needs_attention' | 'unknown'; summary: string };
export type AdoptionWaiting = { status: 'waiting'; reason: 'not_hydrated' | 'answer_pending'; binding?: WorkBinding };
export type SubmittedTurnPending = { status: 'pending'; binding: WorkBinding; expectedUserTurns: number; promptHash: string };
export type SubmittedTurnReady = { status: 'ready'; binding: WorkBinding };
export type SupervisorEvent = WorkEventV1;
export class SupervisorAmbiguityError extends Error { readonly code = 'SUPERVISOR_AMBIGUITY'; }
type PageIdentity = { taskId: string | null; worktree: string | null; projectUrl: string; tabId: string;
  originalUserHash: string | null; latestUserHash: string | null; latestUserTurns: number };
type PageObservation = { browser: string; tabId?: string; turnState: string; lastAssistant: string;
  userTurns: number; assistantTurns: number; pageBusyHint?: boolean; identity?: PageIdentity };
type RecordBinding = { binding: WorkBinding; users: number; ready: boolean; observation?: WorkObservation; expectedPromptHash?: string };
export interface SupervisorActivityOptions {
  base?: string;
  browserFactory?: () => LiveBrowser;
  loadProject?: (id: string) => Promise<SupervisorProject>;
  list?: typeof listSashaiTabs;
  observe?: (url: string) => Promise<PageObservation>;
  /** Test seam for the same read-only identity data extracted by the default DOM reader. */
  readIdentity?: (url: string, tabId: string) => Promise<PageIdentity | null>;
  wait?: (ms: number) => Promise<void>;
  /** Injected guard for tests; the production guard uses Temporal's cancellation signal. */
  dispatchGuard?: () => { deadline: number; check: () => void };
}
const normalizeUserText = (v: string) => v.normalize('NFC').replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim();
const textHash = (v: string) => createHash('sha256').update(normalizeComposerText(v)).digest('hex');
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same = (a: unknown, b: unknown) => hash(a) === hash(b);
const canonicalProjectUrl = (value: string) => {
  const u = new URL(value); const path = u.pathname.replace(/\/project\/?$/, '').replace(/-dr-sashai$/i, '');
  return u.origin + path + '/project';
};
const sameProject = (a: string, b: string) => { try { return canonicalProjectUrl(a) === canonicalProjectUrl(b); } catch { return false; } };

/** Report interpretation only, never artifact acceptance or code review. */
export function interpretSupervisorResult(text: string): WorkObservation['decision'] {
  const statuses = [...text.matchAll(/^FLOWDECK_STATUS:\s*(continue|implementation_done|needs_attention)\s*$/gm)].map(m => m[1]);
  if (/FLOWDECK_STATUS/.test(text)) return statuses.length === 1 &&
    (text.match(/FLOWDECK_STATUS/g) ?? []).length === 1 &&
    /^FLOWDECK_STATUS:\s*(continue|implementation_done|needs_attention)$/.test(text.trim().split(/\r?\n/).at(-1) ?? '')
    ? statuses[0] as WorkObservation['decision'] : 'unknown';
  // Supervised turns explicitly require one final marker. Plain prose is never
  // dispatch authority, even when it resembles a completion claim.
  return 'unknown';
}

/** Read-only DOM expression, shared with fixture tests; retains plain full-answer text. */
export function supervisorAnswerExpression(url: string): string {
  return `(() => {
    if(location.origin + location.pathname !== ${JSON.stringify(url)})throw Error('Chat changed');
    const messages=[...document.querySelectorAll('[data-message-author-role]')];
    const headings=[...document.querySelectorAll('main h4.sr-only')]
      .map(h=>(h.textContent||'').trim()).filter(s=>s==='You said:'||s==='ChatGPT said:');
    // ChatGPT Work sometimes appends this UI survey below the assistant response.
    // Strip only the exact footer when it appears on a separate terminal line.
    const clean=v=>{
      const t=(v||'').trim(), footer='\\nIs this conversation helpful so far?';
      return (t.endsWith(footer)?t.slice(0,-footer.length):t).trim();
    };
    const lastHeading=headings.at(-1);
    if(lastHeading==='You said:')return null;
    const last=messages.at(-1);
    const role=last?.getAttribute('data-message-author-role');
    if(role==='assistant'&&(!headings.length||messages.length===headings.length))
      return clean(last.innerText||'')||null;
    if(lastHeading!=='ChatGPT said:')return null;
    const main=document.querySelector('main')?.innerText||'';
    const marker='ChatGPT said:', i=main.lastIndexOf(marker);
    if(i<0)return null;
    return clean(main.slice(i+marker.length).split('ChatGPT can make mistakes.')[0]
      .split('Latest response')[0])||null;
  })()`;
}

/** Read-only identity read. It uses message roles or explicit Work-layout article/heading pairs only. */
export function supervisorIdentityExpression(url: string): string {
  return `(() => {
    if(location.origin + location.pathname !== ${JSON.stringify(url)})throw Error('Chat changed');
    const raw=v=>(v||'').normalize('NFC').replace(/\\r\\n?/g,'\\n').split('\\n').map(x=>x.trimEnd()).join('\\n').trim().replace(/\\s*…\\s*Show more\\s*$/u,'');
    let users=[...document.querySelectorAll('[data-message-author-role]')]
      .filter(n=>n.getAttribute('data-message-author-role')==='user').map(n=>raw(n.innerText));
    if(!users.length){
      const hs=[...document.querySelectorAll('main h4.sr-only')];
      users=hs.filter(h=>raw(h.textContent)==='You said:').map(h=>{
        const parent=h.parentElement;
        const message=parent ? [...(parent.children||[])].find(x=>String(x.className||'').split(/\\s+/).includes('group/user-message')) : null;
        const siblingHeadings=parent ? [...parent.querySelectorAll('h4.sr-only')].map(x=>raw(x.textContent)) : [];
        if(!message || siblingHeadings.some(x=>x!=='You said:'))return null;
        return raw(message.innerText);
      }).filter(Boolean);
    }
    const first=users[0]||null, latest=users.at(-1)||null;
    const task=first?.match(/(?:^|\\n)[ \\t]*Task ID[ \\t]*:[ \\t]*([^\\n]+)/i)?.[1]?.trim()||null;
    const worktree=first?.match(/(?:^|\\n)(?:Repository\\/worktree|Worktree)\\s*:\\s*([^\\n]+)/i)?.[1]?.trim()||null;
    const projectUrl=location.origin+location.pathname.split('/c/')[0].replace(/\\/$/,'')+'/project';
    return {taskId:task,worktree,projectUrl,tabId:null,originalUserText:first,latestUserText:latest,latestUserTurns:users.length};
  })()`;
}

export function createSupervisorActivities(options: SupervisorActivityOptions = {}) {
  const base = resolve(options.base ?? process.cwd()), store = join(base, '.state/flowdeck-supervisor');
  const sendRecovery = createSendRecoveryStore(base);
  const loadProject = options.loadProject ?? createSupervisorProjectLoader({ base });
  const list = options.list ?? listSashaiTabs;
  const wait = options.wait ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const makeDispatchGuard = options.dispatchGuard ?? (() => {
    const activity = Context.current();
    const deadline = Date.now() + 90_000;
    return { deadline, check: () => {
      if (activity.cancellationSignal.aborted) throw Error('Activity cancelled; browser send prohibited');
      if (Date.now() >= deadline) throw Error('Dispatch deadline elapsed; browser send prohibited');
    } };
  });
  let browserInstance: LiveBrowser | undefined;
  const browser = () => browserInstance ??= (options.browserFactory ?? createLiveBrowser)();
  const observe = options.observe ?? (async (url: string): Promise<PageObservation> => {
    const state = await observeSashaiConversation(url);
    if (state.browser !== 'attached_read_only' || !('tabId' in state)) return state;
    const tab = await browser().requireTab(String(state.tabId), url);
    // The shared observer truncates to 400 characters. Read the full latest answer for status parsing.
    const text = await browserEvaluate(tab, supervisorAnswerExpression(url));
    const rawIdentity = await browserEvaluate(tab, supervisorIdentityExpression(url)) as Record<string, unknown> | null;
    const identity = rawIdentity ? { taskId: typeof rawIdentity.taskId === 'string' ? rawIdentity.taskId : null,
      worktree: typeof rawIdentity.worktree === 'string' ? rawIdentity.worktree : null,
      projectUrl: typeof rawIdentity.projectUrl === 'string' ? rawIdentity.projectUrl : '', tabId: String(state.tabId),
      originalUserHash: typeof rawIdentity.originalUserText === 'string' ? textHash(rawIdentity.originalUserText) : null,
      latestUserHash: typeof rawIdentity.latestUserText === 'string' ? textHash(rawIdentity.latestUserText) : null,
      latestUserTurns: typeof rawIdentity.latestUserTurns === 'number' ? rawIdentity.latestUserTurns : 0 } : undefined;
    return { ...state, lastAssistant: typeof text === 'string' ? text : '', identity,
      turnState: typeof text === 'string' || state.turnState === 'running' || state.turnState === 'awaiting_answer'
              ? state.turnState : 'unknown' };
  });
  const file = (kind: string, key: unknown) => join(store, kind + '-' + hash(key) + '.json');
  const read = async <T>(path: string): Promise<T | null> => {
    try { return JSON.parse(await readFile(path, 'utf8')) as T; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  };
  async function atomic(path: string, value: unknown) {
    await mkdir(store, { recursive: true, mode: 0o700 });
    const temp = path + '.' + randomUUID() + '.tmp';
    try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temp, path); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async function claim(kind: string, key: unknown, value: unknown) {
    await mkdir(store, { recursive: true, mode: 0o700 });
    try { await writeFile(file(kind, key), JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw Error('Already claimed; reconcile, never retry an uncertain send'); throw e; }
  }
  async function authorized(p: SupervisorProject, t?: ApprovedTask) {
    const current = await loadProject(p.id);
    if (!same(current, p)) throw Error('Project enrollment changed or caller is not enrolled');
    if (t && !current.tasks.some(candidate => same(candidate, t))) throw Error('Task is not explicitly approved');
  }
  function eventScope(p: SupervisorProject, e: SupervisorEvent, kind: SupervisorEvent['kind']) {
    if (!e || e.schema !== 'remote-mcp.work-event/v1' || e.source !== 'remote-mcp-jazz' ||
        e.ownerId !== p.ownerId || e.deviceId !== p.deviceId || e.kind !== kind ||
        typeof e.eventId !== 'string' || !e.eventId.trim() || typeof e.workId !== 'string' || !e.workId.trim() ||
        !['event', 'snapshot'].includes(e.origin) || e.executionVerified !== false || e.backgroundProcesses !== 'unknown' ||
        e.timestampEvidence !== 'recorded_in_source_transaction' ||
        ![e.startedAt, e.sourceCommittedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value))) ||
        (kind === 'work_started' ? e.revision !== 1 || e.completionEvidence !== 'none'
          : e.revision !== 2 || e.completionEvidence !== 'agent_report_only' ||
                      typeof e.reportedAt !== 'string' || !Number.isFinite(Date.parse(e.reportedAt)) ||
                      !['success', 'partial', 'failed'].includes(e.outcome ?? '')))
      throw Error('Event scope/kind mismatch');
  }
  const bindingFile = (b: WorkBinding) => file('binding', [b.projectId, b.workId]);
  async function record(p: SupervisorProject, b: WorkBinding) {
    if (b.projectId !== p.id || !p.tasks.some(t => t.id === b.taskId) || parseSashaiChatUrl(b.chatUrl).url !== b.chatUrl)
      throw Error('Invalid project/task/chat binding');
    const r = await read<RecordBinding>(bindingFile(b));
    if (!r || !same(r.binding, b) || !r.ready) throw Error('Binding missing or send unresolved; reconcile manually');
    await browser().requireTab(b.tabId, b.chatUrl);
    return r;
  }
  async function probe(b: WorkBinding, r: RecordBinding): Promise<WorkObservation> {
    const s = await observe(b.chatUrl);
    if (s.browser !== 'attached_read_only' || s.tabId !== b.tabId || s.userTurns !== r.users)
      return { turn: 'unknown', decision: 'unknown', summary: 'Chat/turn binding changed or not observable' };
    // ChatGPT can leave aria-busy set after completion; it is not a generation signal.
    if (s.turnState === 'running' || s.turnState === 'awaiting_answer')
      return { turn: 'running', decision: 'unknown', summary: 'ChatGPT turn is running or awaiting its answer' };
    if (s.turnState !== 'turn_finished' || !s.lastAssistant.trim())
      return { turn: 'unknown', decision: 'unknown', summary: 'Waiting for the actual ChatGPT finished answer' };
    return { turn: 'finished', decision: interpretSupervisorResult(s.lastAssistant),
      summary: 'Latest bound ChatGPT answer: ' + interpretSupervisorResult(s.lastAssistant) + ' (not independently accepted)' };
  }
  async function adoptStartedWork(p: SupervisorProject, e: SupervisorEvent, t: ApprovedTask, expectedBinding?: WorkBinding): Promise<WorkBinding | AdoptionWaiting> {
    await authorized(p, t); eventScope(p, e, 'work_started');
    // Only fresh, owner-started P1 requires a pre-approved empty tab and first-message
    // seal. Other tasks use the existing post-send journal/binding reconciliation.
    const preparedInitial = p.id.startsWith('sashai-fresh-attended-') && t.id === p.initialTaskId &&
      (!expectedBinding || expectedBinding.workId === e.workId)
      ? await readPreparedManualStart(base, p, t) : null;
    if (expectedBinding && (expectedBinding.projectId !== p.id || expectedBinding.taskId !== t.id ||
        !expectedBinding.tabId || parseSashaiChatUrl(expectedBinding.chatUrl).url !== expectedBinding.chatUrl))
      throw new SupervisorAmbiguityError('Expected binding project/task/chat mismatch');
    const matchesExpected = (b: WorkBinding) => !expectedBinding ||
      b.tabId === expectedBinding.tabId && b.chatUrl === expectedBinding.chatUrl && b.taskId === expectedBinding.taskId;
    const existing = await read<RecordBinding>(file('binding', [p.id, e.workId]));
    if (existing) {
      if (preparedInitial && existing.binding.tabId !== preparedInitial.tabId)
        throw new SupervisorAmbiguityError('Previously bound P1 differs from prepared new tab');
      if (existing.binding.taskId !== t.id) throw new SupervisorAmbiguityError('Work already bound to another task');
      if (!matchesExpected(existing.binding)) throw new SupervisorAmbiguityError('Running work does not match expected binding');
      await record(p, existing.binding); return existing.binding;
    }
    const active = await read<WorkBinding>(file('task', [p.id, t.id]));
    if (active && !matchesExpected(active)) throw new SupervisorAmbiguityError('Task does not match expected binding');
    const intended = expectedBinding ?? active;
    if (preparedInitial && intended && intended.tabId !== preparedInitial.tabId)
      throw new SupervisorAmbiguityError('Initial P1 pinned binding differs from prepared tab');
    if (!active && !expectedBinding && t.id !== p.initialTaskId)
      throw new SupervisorAmbiguityError('Initial adoption must use configured initialTaskId');
    const initialPinned = Boolean(expectedBinding && expectedBinding.workId === e.workId && t.id === p.initialTaskId);
    const expectedRecord = !initialPinned && expectedBinding
      ? await read<RecordBinding>(bindingFile(expectedBinding)) : null;
    if (expectedBinding && !initialPinned &&
        (!expectedRecord || !same(expectedRecord.binding, expectedBinding) ||
         !Number.isInteger(expectedRecord.users) || expectedRecord.users < 1 ||
         !/^[a-f0-9]{64}$/.test(expectedRecord.expectedPromptHash ?? '')))
      throw new SupervisorAmbiguityError('Post-send expected binding lacks exact sealed prompt proof');
    const tabs = await list();
    const running: Array<{ tab: Awaited<ReturnType<typeof list>>[number]; s: PageObservation }> = [];
    const finished: Array<{ tab: Awaited<ReturnType<typeof list>>[number]; s: PageObservation }> = [];
    let pendingIdentity = false;
    const identityOf = async (tab: Awaited<ReturnType<typeof list>>[number], s: PageObservation) =>
      options.readIdentity ? await options.readIdentity(tab.url, tab.id) : s.identity;
    for (const tab of tabs) {
      const url = parseSashaiChatUrl(tab.url).url;
      if (intended && (tab.id === intended.tabId || url === intended.chatUrl) &&
          (tab.id !== intended.tabId || url !== intended.chatUrl))
        throw new SupervisorAmbiguityError('Observed chat does not match expected binding');
      const s = await observe(tab.url);
      if (s.tabId !== undefined && s.tabId !== tab.id)
        throw new SupervisorAmbiguityError('Observed tab does not match expected binding');
      if (s.turnState === 'running') running.push({ tab, s });
      if (s.turnState === 'turn_finished') finished.push({ tab, s });
    }
    if (running.length > 1) throw new SupervisorAmbiguityError('Adoption requires exactly one running Sashai project chat');
    let selected: { tab: Awaited<ReturnType<typeof list>>[number]; s: PageObservation } | undefined;
    const candidate = running[0];
    if (candidate) {
      const url = parseSashaiChatUrl(candidate.tab.url).url;
      if (preparedInitial && candidate.tab.id !== preparedInitial.tabId)
        throw new SupervisorAmbiguityError('Running P1 is on an unprepared browser tab');
      if (intended && (candidate.tab.id !== intended.tabId || url !== intended.chatUrl))
        throw new SupervisorAmbiguityError('Running work does not match expected binding');
      const identity = await identityOf(candidate.tab, candidate.s);
      if (candidate.s.browser !== 'attached_read_only' || candidate.s.tabId !== candidate.tab.id ||
          candidate.s.userTurns <= 0 || !Number.isFinite(candidate.s.userTurns)) {
        const pinned: WorkBinding = { projectId: p.id, taskId: t.id, chatUrl: url, tabId: candidate.tab.id, workId: e.workId };
        return { status: 'waiting', reason: identity ? 'answer_pending' : 'not_hydrated', binding: intended ?? pinned };
      }
      if (!identity) return { status: 'waiting', reason: 'answer_pending', binding: intended ?? { projectId: p.id, taskId: t.id, chatUrl: url, tabId: candidate.tab.id, workId: e.workId } };
      if (preparedInitial) {
        const verdict = inspectPreparedFirstMessage(preparedInitial,p,t,{
          tabId:candidate.tab.id,chatUrl:url,projectUrl:identity.projectUrl,
          taskId:identity.taskId,worktree:identity.worktree,userTurns:identity.latestUserTurns,
          firstUserHash:identity.originalUserHash,observedUserTurns:candidate.s.userTurns});
        if (verdict==='pending')return {status:'waiting',reason:'not_hydrated',...(intended ? {binding:intended} : {})};
      }
      if (identity.taskId !== t.id || identity.worktree === null || !identity.worktree.startsWith('/') || resolve(identity.worktree) !== resolve(p.repo) || !sameProject(identity.projectUrl, p.projectUrl) || identity.tabId !== candidate.tab.id)
        throw new SupervisorAmbiguityError('Original visible task/worktree identity is missing or ambiguous');
      if (!initialPinned && expectedBinding && (identity.latestUserHash !== expectedRecord!.expectedPromptHash || identity.latestUserTurns !== expectedRecord!.users || candidate.s.userTurns !== expectedRecord!.users))
        return { status: 'waiting', reason: 'answer_pending', binding: expectedBinding };
      selected = candidate;
    }
    if (!candidate) {
      const validFinished: Array<{ tab: Awaited<ReturnType<typeof list>>[number]; s: PageObservation }> = [];
      for (const item of finished) {
        if (preparedInitial && item.tab.id !== preparedInitial.tabId)continue;
        const identity = await identityOf(item.tab, item.s);
        if (intended && (item.tab.id !== intended.tabId || parseSashaiChatUrl(item.tab.url).url !== intended.chatUrl)) continue;
        if (intended) {
          // Redacted identity/hydration diagnostics only. Do not log messages, URLs, IDs or hashes.
          console.info(JSON.stringify({event:'flowdeck.pinned_identity_observation',observedAt:new Date().toISOString(),
            task:!identity||identity.taskId===null?'missing':identity.taskId===t.id?'matches':'conflicts',
            tab:!identity?'unavailable':identity.tabId===item.tab.id?'matches':'conflicts',
            project:!identity?'unavailable':sameProject(identity.projectUrl,p.projectUrl)?'matches':'conflicts',
            worktree:!identity||identity.worktree===null?'missing':identity.worktree.startsWith('/')&&
              resolve(identity.worktree)===resolve(p.repo)?'matches':'conflicts'}));
        }
        if (!identity) { if (intended || item.s.userTurns > 0) pendingIdentity = true; continue; }
        if (preparedInitial) {
          const verdict = inspectPreparedFirstMessage(preparedInitial,p,t,{
            tabId:item.tab.id,chatUrl:parseSashaiChatUrl(item.tab.url).url,
            projectUrl:identity.projectUrl,taskId:identity.taskId,worktree:identity.worktree,
            userTurns:identity.latestUserTurns,firstUserHash:identity.originalUserHash,
            observedUserTurns:item.s.userTurns});
          if (verdict==='pending'){pendingIdentity=true;continue;}
        }
        if (intended && item.tab.id === intended.tabId && parseSashaiChatUrl(item.tab.url).url === intended.chatUrl) {
          // A DOM identity object can exist before its task line is readable.
          // Missing evidence may wait, but an observed conflict must never be retried as hydration.
          if (identity.tabId !== item.tab.id || !sameProject(identity.projectUrl, p.projectUrl) ||
              (identity.worktree !== null && (!identity.worktree.startsWith('/') || resolve(identity.worktree) !== resolve(p.repo))))
            throw new SupervisorAmbiguityError('Pinned chat has conflicting tab/project/worktree identity');
          if (identity.taskId === null) continue;
          if (identity.taskId !== t.id)
            throw new SupervisorAmbiguityError('Pinned chat has the wrong approved task identity');
        }
        if (identity.taskId !== t.id) continue;
        if (identity.worktree === null || !identity.worktree.startsWith('/') || resolve(identity.worktree) !== resolve(p.repo) || !sameProject(identity.projectUrl, p.projectUrl))
          throw new SupervisorAmbiguityError('Finished chat has the wrong task/worktree identity');
        if (!initialPinned && expectedBinding) {
          if (identity.tabId !== expectedBinding.tabId || identity.latestUserHash !== expectedRecord!.expectedPromptHash || identity.latestUserTurns !== expectedRecord!.users || item.s.userTurns !== expectedRecord!.users)
            return { status: 'waiting', reason: 'answer_pending', binding: expectedBinding };
        }
        validFinished.push(item);
      }
      if (validFinished.length > 1) throw new SupervisorAmbiguityError('Adoption found multiple matching finished project chats');
      if (validFinished.length === 1) selected = validFinished[0];
    }
    if (!selected) return intended
      ? { status: 'waiting', reason: pendingIdentity ? 'answer_pending' : 'not_hydrated', binding: intended }
      : { status: 'waiting', reason: pendingIdentity ? 'answer_pending' : 'not_hydrated' };
    const { tab, s } = selected;
    const url = parseSashaiChatUrl(tab.url).url;
    if (!matchesExpected({ projectId: p.id, taskId: t.id, chatUrl: url, tabId: tab.id, workId: e.workId }))
      throw new SupervisorAmbiguityError('Running work does not match expected binding');
    if (active && (active.tabId !== tab.id || active.chatUrl !== url)) throw new SupervisorAmbiguityError('Task already owns a different chat');
    const chatOwner = await read<{ taskId: string }>(file('chat-owner', [p.id, url]));
    if (chatOwner && chatOwner.taskId !== t.id) throw new SupervisorAmbiguityError('Chat already belongs to another task');
    if (!chatOwner) await claim('chat-owner', [p.id, url], { taskId: t.id });
    const b: WorkBinding = { projectId: p.id, taskId: t.id, chatUrl: url, tabId: tab.id, workId: e.workId };
    await browser().requireTab(b.tabId, b.chatUrl);
    // Carry forward only the existing send seal validated against this adopted turn.
    // Manual adoption must not manufacture a historical expected-message hash.
    await claim('binding', [p.id, e.workId], { binding: b, users: s.userTurns, ready: true,
      ...(expectedRecord?.expectedPromptHash ? { expectedPromptHash: expectedRecord.expectedPromptHash } : {}) });
    await atomic(file('task', [p.id, t.id]), b);
    return b;
  }
  async function observeWorkResult(p: SupervisorProject, b: WorkBinding, e: SupervisorEvent): Promise<WorkObservation> {
    await authorized(p); eventScope(p, e, 'work_reported');
    if (e.workId !== b.workId) throw Error('Report workId does not match bound work');
    const r = await record(p, b), result = await probe(b, r);
    if (e.outcome === 'failed' && result.turn === 'finished') result.decision = 'needs_attention';
    // A plugin success/partial report never substitutes for answer text or a finished turn.
    await atomic(bindingFile(b), { ...r, observation: result });
    return result;
  }
  function prompt(p: SupervisorProject, t: ApprovedTask, phase: string) {
    return supervisedTaskPrompt(p, t, phase === 'continue' ? 'continue' : 'initial');
  }
  async function send(p: SupervisorProject, t: ApprovedTask, e: SupervisorEvent, phase: 'continue' | 'next', previous: WorkBinding, recovery?: SendRecoveryAuthorization): Promise<WorkBinding> {
    await authorized(p, t); eventScope(p, e, 'work_reported');
    if (e.workId !== previous.workId) throw Error('Send event does not match previous work');
    const key = [p.id, t.id, phase, e.eventId];
    const receipt = await read<{ binding: WorkBinding; previous: WorkBinding; expectedUserTurns?: number; promptHash?: string }>(file('sent', key));
    if (receipt) {
      if (!same(receipt.previous, previous)) throw Error('Receipt belongs to another binding');
      return receipt.binding;
    }
    const dispatch = makeDispatchGuard();
    dispatch.check();
    const r = recovery ? await read<RecordBinding>(bindingFile(previous)) : await record(p, previous);
    if (!r || !same(r.binding, previous)) throw Error('Previous recovery binding changed');
    await browser().requireTab(previous.tabId, previous.chatUrl);
    dispatch.check();
    const active = await read<WorkBinding>(file('task', [p.id, previous.taskId]));
    if (!same(active, previous)) throw Error('Previous work binding is no longer current');
    if (phase === 'continue' && t.id !== previous.taskId) throw Error('Continuation cannot change task');
    if (phase === 'next') {
      if (await read<WorkBinding>(file('task', [p.id, t.id]))) throw Error('Next task already has an adopted or pending chat');
      const index = p.tasks.findIndex(task => task.id === previous.taskId);
      if (t.dependsOn?.length) throw Error('Next task has dependencies; dependency review is outside these activities');
      if (p.tasks[index].requiresReviewBeforeNext) throw Error('Operator review boundary; no review is performed by these activities');
    }
    const result = await probe(previous, r);
    dispatch.check();
    const expected = phase === 'continue' ? 'continue' : 'implementation_done';
    if (e.outcome === 'failed' || r.observation?.decision !== expected || result.turn !== 'finished' || result.decision !== expected)
      throw Error('Fresh finished-turn decision required before sending');

    const eventHash = sendEventHash(key);
    const phaseKey = [p.id, t.id, phase, phase === 'continue' ? previous.workId : 'initial'];
    const phaseHash = sendPhaseHash(phaseKey);
    const dispatchId = recovery?.newDispatchId ?? randomUUID();
    dispatch.check();
    if (recovery) {
      if (recovery.projectId !== p.id || recovery.taskId !== t.id || recovery.eventHash !== eventHash || recovery.phaseHash !== phaseHash)
        throw Error('Recovery authorization does not match this exact logical send');
      const oldEvent = await read<{workId:string}>(file('send-event', key));
      const oldPhase = await read<{eventId:string}>(file('send-phase', phaseKey));
      if (oldEvent?.workId !== e.workId || oldPhase?.eventId !== e.eventId) throw Error('Original send claims are missing or changed');
      dispatch.check();
      if('kind' in recovery&&recovery.kind==='successor')await sendRecovery.consumeSuccessor(recovery);
      else await sendRecovery.consume(recovery);
      await sendRecovery.createClaim('send-event', hash([eventHash, dispatchId]), { workId: e.workId, dispatchId });
      await sendRecovery.createClaim('send-phase', hash([phaseHash, dispatchId]), { eventId: e.eventId, dispatchId });
    } else {
      // Preserve the original single-host claim authority, including all legacy claims.
      dispatch.check();
      await claim('send-event', key, { workId: e.workId, dispatchId });
      await claim('send-phase', phaseKey, { eventId: e.eventId, dispatchId });
    }
    // Original claims and the new generation's phase journal are never released or deleted.
    await sendRecovery.record({ dispatchId, projectId: p.id, taskId: t.id, eventHash, phaseHash, phase: 'claimed', oldDispatchId: recovery?.oldDispatchId, attemptId: recovery?.attemptId, generation: recovery?.newDispatchId, eventId: e.eventId, phaseKind: phase, previousBinding: previous, event: e });
    const b = { ...previous, taskId: t.id };
    await atomic(bindingFile(previous), { ...r, ready: false });
    const live = browser();
    let tab: Awaited<ReturnType<LiveBrowser['requireTab']>>;
    try {
      await sendRecovery.record({ dispatchId, projectId: p.id, taskId: t.id, eventHash, phaseHash, phase: 'preparing' });
      dispatch.check();
      tab = phase === 'continue' ? await live.requireTab(b.tabId, b.chatUrl) : await live.createOwnedProjectTab(randomUUID());
      dispatch.check();
      const targetUrl = phase === 'continue' ? b.chatUrl : p.projectUrl;
      if (phase === 'next' && tab.url.split('?')[0] !== p.projectUrl) throw Error('New target is not the configured project');
      const message = prompt(p, t, phase);
      try {
        dispatch.check();
        await live.stage(tab, targetUrl, message);
        dispatch.check();
        if (!await live.matches(tab, targetUrl, message)) throw Error('Full connector composer mismatch');
        dispatch.check();
      } catch (cause) {
        const actual = sanitizeSendCause(cause);
        await sendRecovery.record({ dispatchId, projectId: p.id, taskId: t.id, eventHash, phaseHash, phase: 'pre_send_failed', cause: actual });
        throw ApplicationFailure.create({ message: actual, type: 'FlowdeckPreSendFailure', nonRetryable: true, details: [{ outcome: 'pre_send_failed', dispatchId, cause: actual }] });
      }
      await sendRecovery.record({ dispatchId, projectId: p.id, taskId: t.id, eventHash, phaseHash, phase: 'staged' });
      dispatch.check();
      await authorized(p, t);
      dispatch.check();
      await sendRecovery.record({ dispatchId, projectId: p.id, taskId: t.id, eventHash, phaseHash, phase: 'click_attempted' });
      if (!await live.click(tab, targetUrl, message, Math.min(dispatch.deadline, Date.now() + 10_000), dispatch.check))
        throw Error('Send uncertain; reconcile without retry');
      await sendRecovery.record({ dispatchId, projectId: p.id, taskId: t.id, eventHash, phaseHash, phase: 'submitted' });
      const expectedUserTurns = phase === 'continue' ? r.users + 1 : 1;
      const promptHash = textHash(composerPayloadFor(message));
      b.tabId = tab.id; b.chatUrl = phase === 'continue' ? previous.chatUrl : targetUrl;
      await atomic(file('task', [p.id, t.id]), b);
      await atomic(bindingFile(b), { binding: b, users: expectedUserTurns, ready: false, pending: true,
        expectedPromptHash: promptHash, previous, targetUrl, dispatchId });
      const chat = await live.chat(tab.id);
      if (chat) {
        b.chatUrl = parseSashaiChatUrl(chat.url).url;
        if (phase === 'continue' && b.chatUrl !== previous.chatUrl || phase === 'next' && b.chatUrl === previous.chatUrl)
          throw new SupervisorAmbiguityError('Wrong conversation after send; reconcile without retry');
        if (phase === 'next') await claim('chat-owner', [p.id, b.chatUrl], { taskId: t.id });
        await atomic(file('task', [p.id, t.id]), b);
        await atomic(bindingFile(b), { binding: b, users: expectedUserTurns, ready: false, pending: true,
          expectedPromptHash: promptHash, previous, targetUrl, dispatchId });
      }
      const pending: SubmittedTurnPending = { status: 'pending', binding: b, expectedUserTurns, promptHash };
      await atomic(file('sent', key), { binding: b, previous, expectedUserTurns, promptHash });
      return b;
    } catch (cause) {
      const actual = sanitizeSendCause(cause);
      const latest = await sendRecovery.latest(dispatchId);
      if (latest?.phase === 'preparing' || latest?.phase === 'staged') {
        await sendRecovery.record({ dispatchId, projectId: p.id, taskId: t.id, eventHash, phaseHash, phase: 'pre_send_failed', cause: actual });
        throw ApplicationFailure.create({ message: actual, type: 'FlowdeckPreSendFailure', nonRetryable: true, details: [{ outcome: 'pre_send_failed', dispatchId, cause: actual }] });
      }
      throw cause;
    }
  }

  async function reconcileSubmittedTurn(p: SupervisorProject, b: WorkBinding): Promise<SubmittedTurnPending | SubmittedTurnReady> {
    await authorized(p);
    const r = await read<RecordBinding & { pending?: boolean; expectedPromptHash?: string; previous?: WorkBinding; targetUrl?: string; dispatchId?: string }>(bindingFile(b));
    if (!r || (!same(r.binding, b) && !(b.chatUrl === p.projectUrl && r.binding.projectId === b.projectId &&
      r.binding.taskId === b.taskId && r.binding.tabId === b.tabId && r.binding.workId === b.workId)))
      throw new SupervisorAmbiguityError('Submitted target binding is missing or changed');
    if (r.ready) return { status: 'ready', binding: r.binding };
    let current = r.binding;
    if (current.chatUrl === p.projectUrl || !/^https:\/\/chatgpt\.com\/g\//.test(current.chatUrl)) {
      const discovered = await browser().chat(current.tabId);
      if (discovered) {
        const discoveredUrl = parseSashaiChatUrl(discovered.url).url;
        if (r.previous && discoveredUrl === r.previous.chatUrl) throw new SupervisorAmbiguityError('Submitted navigation returned to the previous conversation');
        current = { ...current, chatUrl: discoveredUrl };
        await atomic(file('task', [p.id, current.taskId]), current);
        if (current.taskId !== r.previous?.taskId) await claim('chat-owner', [p.id, discoveredUrl], { taskId: current.taskId });
        await atomic(bindingFile(current), { ...r, binding: current });
      }
    }
    if (current.chatUrl === p.projectUrl || !/^https:\/\/chatgpt\.com\/g\//.test(current.chatUrl))
      return { status: 'pending', binding: current, expectedUserTurns: r.users, promptHash: r.expectedPromptHash ?? '' };
    const s = await observe(current.chatUrl);
    const identity = options.readIdentity ? await options.readIdentity(current.chatUrl, current.tabId) : s.identity;
    if (identity) {
      // A newly submitted Project chat can expose its tab and URL before the user
      // message has hydrated. Missing task/worktree/Project evidence is not a
      // conflicting identity and must NOT finish the bounded reconciliation.
      // Real non-null mismatches still fail closed, without another browser Send.
      if (identity.tabId !== current.tabId ||
          (identity.projectUrl !== '' && !sameProject(identity.projectUrl, p.projectUrl)) ||
          (identity.worktree !== null && (!identity.worktree.startsWith('/') || resolve(identity.worktree) !== resolve(p.repo))) ||
          (identity.taskId !== null && identity.taskId !== current.taskId))
        throw new SupervisorAmbiguityError('Submitted target identity changed');
    }
    // Positive evidence of an extra user turn is a conflict even if the
    // remaining identity fields have not hydrated yet. Do not wait it away.
    if ((identity?.latestUserTurns ?? 0) > r.users || s.userTurns > r.users)
      throw new SupervisorAmbiguityError('Submitted target has an extra user turn');
    if (!identity || identity.taskId === null || identity.worktree === null || !identity.projectUrl || !identity.latestUserHash)
      return { status: 'pending', binding: current, expectedUserTurns: r.users, promptHash: r.expectedPromptHash ?? '' };
    if (identity.latestUserTurns < r.users || s.browser !== 'attached_read_only' || s.tabId !== current.tabId || s.userTurns !== r.users)
      return { status: 'pending', binding: current, expectedUserTurns: r.users, promptHash: r.expectedPromptHash ?? '' };
    if (!r.expectedPromptHash || identity.latestUserHash !== r.expectedPromptHash)
      throw new SupervisorAmbiguityError('Submitted user message does not match the sealed prompt');
    if (r.dispatchId) {
      const claimed = (await sendRecovery.readEntries(r.dispatchId)).find(entry => entry.phase === 'claimed');
      if (!claimed) throw Error('Submitted dispatch journal is missing');
      await sendRecovery.record({ ...claimed, phase: 'reconciled' });
    }
    await atomic(bindingFile(current), { ...r, binding: current, ready: true, pending: false });
    return { status: 'ready', binding: current };
  }
  const sendContinuationOnce = (p: SupervisorProject, b: WorkBinding, t: ApprovedTask, e: SupervisorEvent) => send(p, t, e, 'continue', b);
  const startNextTaskOnce = (p: SupervisorProject, t: ApprovedTask, b: WorkBinding, e: SupervisorEvent) => send(p, t, e, 'next', b);
  const recoverPreSendOnce = (p: SupervisorProject, b: WorkBinding, t: ApprovedTask, e: SupervisorEvent, phase: 'continue' | 'next', authorization: SendRecoveryAuthorization) => send(p, t, e, phase, b, authorization);
  async function publishSupervisorState(state: unknown): Promise<void> {
    // Status is an operational projection, never a dump of events, prompts, tokens or config.
    const allowed = new Set([
          'projectId', 'taskId', 'workId', 'chatUrl', 'tabId', 'turn', 'decision', 'phase', 'status', 'updatedAt',
          'requiresReviewBeforeNext', 'stage', 'projects', 'tasks', 'id', 'title', 'initialTaskId', 'dependsOn',
          'implementationStatus', 'reviewStatus', 'blocker', 'lastEvent', 'binding', 'observation',
          'projection', 'consecutiveFailures', 'lastPublishedAt',
          'eventId', 'kind', 'revision', 'outcome', 'origin', 'startedAt', 'reportedAt', 'sourceCommittedAt',
        ]);
    const clean = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(clean);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => allowed.has(k)).map(([k, value]) => [k, clean(value)]));
      if (typeof v === 'string') {
        if (/(?:bearer\s|sk-[\w-]+|(?:token|secret|password|api[_-]?key)\s*[:=]|:\/\/[^/]*@)/i.test(v)) return '[redacted]';
        return v.replace(/https?:\/\/\S+/g, url => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return '[redacted URL]'; } }).slice(0, 1000);
      }
      return typeof v === 'boolean' || typeof v === 'number' || v === null ? v : null;
    };
    if (!state || typeof state !== 'object') throw Error('Status must be an object or array of operational projections');
    await atomic(join(store, 'status.json'), clean(state));
  }
  return { loadSupervisorProject: loadProject, adoptStartedWork, observeWorkResult, reconcileSubmittedTurn, sendContinuationOnce, startNextTaskOnce, recoverPreSendOnce, publishSupervisorState, authorizePreSendRecovery: sendRecovery.authorize };
}
const activities = createSupervisorActivities();
export const { adoptStartedWork, observeWorkResult, reconcileSubmittedTurn, sendContinuationOnce, startNextTaskOnce, recoverPreSendOnce, publishSupervisorState, authorizePreSendRecovery } = activities;
