import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { inspectSashaiTaskSource } from './sashai-task-source.js';

export const SASHAI_PROJECT_ID = 'g-p-6ab28bdd7fbc8191b581316ff09da79d';
export const SASHAI_PROJECT_URL = 'https://chatgpt.com/g/' + SASHAI_PROJECT_ID + '/project';
export const ORACLE_SMOKE_SLUG = 'flowdeck-sashai-oracle-live-cdp';
const store = join(resolve(process.cwd()), '.state', 'oracle-sashai');
const adoptedFile = join(store, 'adopted.json');
const observedOracleSmokes = [
  // Prefer the most recent matching session when several turns share one conversation.
  { slug: 'sashai-pristine-v0215-followup', expected: 'SASHAI_ORACLE_0215_FOLLOWUP_OK' },
  { slug: 'sashai-pristine-v0215-smoke', expected: 'SASHAI_ORACLE_0215_OK' },
  { slug: 'oracle-sashai-local-patched-smoke', expected: 'ORACLE_SASHAI_PATCH_OK_20261014B' },
  { slug: ORACLE_SMOKE_SLUG, expected: 'ORACLE_SASHAI_SMOKE_OK' },
];

export function parseSashaiChatUrl(value: string): { url: string; conversationId: string } {
  const url = new URL(value);
  if (url.origin !== 'https://chatgpt.com') throw new Error('Chat must be hosted on chatgpt.com');
  const match = url.pathname.match(/^\/g\/(g-p-6ab28bdd7fbc8191b581316ff09da79d(?:-[a-z0-9-]+)?)\/c\/([0-9a-f-]{36})$/i);
  if (!match) throw new Error('Chat must be a conversation INSIDE the Sashai project');
  return { url: url.origin + url.pathname, conversationId: match[2] };
}

type PageTarget = { id: string; type: string; url: string; webSocketDebuggerUrl?: string };
export async function listSashaiTabs(): Promise<Array<{id: string; url: string; conversationId: string}>> {
  const response = await fetch('http://127.0.0.1:9222/json/list', { signal: AbortSignal.timeout(3500) });
  if (!response.ok) throw new Error('Helium CDP tabs unavailable: HTTP ' + response.status);
  const pages = await response.json() as PageTarget[];
  return pages.flatMap(page => {
    if (page.type !== 'page' || !page.webSocketDebuggerUrl) return [];
    try {
      return [{ id: page.id, ...parseSashaiChatUrl(page.url) }];
    } catch { return []; }
  });
}

// Pure parser: useful in tests and deliberately refuses to certify a project task from a chat turn.
export function classifyReadOnlyPage(raw: {
  title?: string; path?: string; userTurns?: number; assistantTurns?: number;
  stopVisible?: boolean; busy?: boolean; lastAssistant?: string; mainLength?: number;
}) {
  const running = Boolean(raw.stopVisible);
  const userTurns = Math.max(0, raw.userTurns ?? 0);
  const assistantTurns = Math.max(0, raw.assistantTurns ?? 0);
  const lastAssistant = String(raw.lastAssistant ?? '').trim().slice(0, 400);
  const turnState = running ? 'running'
    : assistantTurns > 0 ? 'turn_finished'
    : userTurns > 0 ? 'awaiting_answer' : 'unknown';
  return {
    turnState, taskState: 'unverified',
    userTurns, assistantTurns, lastAssistant,
    generationStopVisible: running, pageBusyHint: Boolean(raw.busy),
    title: String(raw.title ?? '').slice(0, 110), mainLength: raw.mainLength ?? 0,
  };
}

async function evaluateTarget(webSocketUrl: string) {
  // Restricted read-only DOM probe; never submits, selects a connector, or changes page location.
  const expression = `(() => {
    const main = document.querySelector('main')?.innerText || '';
    const stop = [...document.querySelectorAll('button')].some(b =>
      b.getClientRects().length > 0 && (/^stop( generating| response)?$/i.test(
      (b.getAttribute('aria-label') || '').trim()) || b.getAttribute('data-testid') === 'stop-button'));
    const n = re => (main.match(re) || []).length;
    const assistantMarker = 'ChatGPT said:';
    const i = main.lastIndexOf(assistantMarker);
    let last = i < 0 ? '' : main.slice(i + assistantMarker.length);
    last = last.split('ChatGPT can make mistakes.')[0]
      .split('Latest response')[0].trim();
    return {
      title: document.title, path: location.pathname,
      userTurns: n(/You said:/g), assistantTurns: n(/ChatGPT said:/g),
      stopVisible: stop, busy: Boolean(document.querySelector('[aria-busy=true]')),
      lastAssistant: last.slice(0,400), mainLength: main.length
    };
  })()`;
  const socket = new WebSocket(webSocketUrl);
  return await new Promise<Record<string, unknown>>((resolvePromise, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('CDP timeout')); }, 8000);
    socket.addEventListener('open', () =>
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: false } })));
    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id !== 1) return;
        clearTimeout(timeout); socket.close();
        if (msg.error || msg.result?.exceptionDetails)
          reject(new Error('CDP evaluation failed'));
        else resolvePromise(msg.result?.result?.value ?? {});
      } catch (err) { clearTimeout(timeout); socket.close(); reject(err); }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout); reject(new Error('CDP WebSocket connection failed'));
    });
  });
}

export async function observeSashaiConversation(value: string) {
  const chat = parseSashaiChatUrl(value);
  const response = await fetch('http://127.0.0.1:9222/json/list', { signal: AbortSignal.timeout(3500) });
  if (!response.ok) throw new Error('Helium CDP HTTP ' + response.status);
  const pages = await response.json() as PageTarget[];
  const target = pages.find(page => page.type === 'page' && page.url.split('?')[0] === chat.url && !!page.webSocketDebuggerUrl);
  if (!target?.webSocketDebuggerUrl) {
    return { ...chat, browser: 'tab_not_open', turnState: 'not_observable',
      taskState: 'unverified', lastAssistant: '', userTurns: 0, assistantTurns: 0,
      generationStopVisible: false, observedAt: new Date().toISOString() };
  }
  const result = await evaluateTarget(target.webSocketDebuggerUrl);
  if (result.path !== new URL(chat.url).pathname) throw new Error('Tab changed while being observed');
  return { ...chat, browser: 'attached_read_only', tabId: target.id,
    observedAt: new Date().toISOString(),
    ...classifyReadOnlyPage(result as Parameters<typeof classifyReadOnlyPage>[0]) };
}
export async function adoptSashaiConversation(value: string) {
  const chat = parseSashaiChatUrl(value);
  const state = await observeSashaiConversation(chat.url);
  if (state.browser !== 'attached_read_only')
    throw new Error('Target Sashai chat must be open in Helium Profile 4 before adoption');
  // A just-opened ChatGPT conversation can briefly display the correct URL
  // before its turns hydrate. Never persist that transient empty/unknown state.
  if (state.userTurns === 0 && state.assistantTurns === 0 && !state.generationStopVisible)
    throw new Error('Sashai chat not hydrated yet; wait for a visible turn before adoption');
  await mkdir(store, { recursive: true });
  await writeFile(adoptedFile, JSON.stringify({ ...chat, adoptedAt: new Date().toISOString() }, null, 2));
  return state;
}
export async function readAdoptedSashai() {
  try { return JSON.parse(await readFile(adoptedFile, 'utf8')) as {url: string; conversationId: string; adoptedAt: string}; }
  catch { return null; }
}
/**
 * Choose exactly one safely identifiable manually-started ChatGPT task.
 * No send/navigate side-effects. A single active generation wins; ties
 * remain ambiguous. Never switch an adopted idle chat to another idle chat.
 */
export function chooseAutoAdoptCandidate(
  candidates: Array<{ url: string; turnState: string }>,
  adoptedUrl: string | null
): { url: string; reason: string } | null {
  const running = candidates.filter(x => x.turnState === 'running');
  if (running.length === 1) return { url: running[0].url, reason: 'single_running_chat' };
  if (running.length > 1) return null;
  const awaiting = candidates.filter(x => x.turnState === 'awaiting_answer');
  if (awaiting.length === 1) return { url: awaiting[0].url, reason: 'single_pending_response' };
  if (awaiting.length > 1) return null;
  if (!adoptedUrl && candidates.length === 1 && candidates[0].turnState === 'turn_finished')
    return { url: candidates[0].url, reason: 'sole_finished_chat' };
  return null;
}

export async function autoAdoptSashai() {
  const existing = await readAdoptedSashai();
  const tabs = await listSashaiTabs();
  // The same chat can be open in multiple Helium windows; count it only once.
  const uniqueTabs = [...new Map(tabs.map(tab => [tab.url, tab])).values()];
  const states = await Promise.all(uniqueTabs.map(async tab => {
    try {
      const state = await observeSashaiConversation(tab.url);
      return { url: tab.url, turnState: state.turnState, conversationId: tab.conversationId };
    } catch { return { url: tab.url, turnState: 'not_observable', conversationId: tab.conversationId }; }
  }));
  const chosen = chooseAutoAdoptCandidate(states, existing?.url ?? null);
  if (!chosen) return { status: 'no_change', monitoredTabs: states.length,
    runningChats: states.filter(s => s.turnState === 'running').length,
    adoptedChat: existing?.conversationId ?? null };
  if (existing?.url === chosen.url)
    return { status: 'already_adopted', reason: chosen.reason,
      conversationId: existing.conversationId };
  const observation = await adoptSashaiConversation(chosen.url);
  return { status: 'adopted', reason: chosen.reason, conversationId: observation.conversationId,
    turnState: observation.turnState };
}

export async function readOracleSmokeEvidence(conversationUrl?: string | null) {
  // Read-only correlation of all relevant saved Oracle sessions, NOT merely a list of
  // smoke-test slugs. Never inspect sessions outside the Sashai project or log prompts.
  const root = join(homedir(), '.oracle', 'sessions');
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const knownExpected = new Map(observedOracleSmokes.map(x => [x.slug, x.expected]));
  const sessions = await Promise.all(entries.filter(x =>
    x.isDirectory() && /^[a-z0-9_-]{5,110}$/i.test(x.name) &&
    /sashai/i.test(x.name)).slice(0, 100).map(async entry => {
    try {
      const meta = JSON.parse(await readFile(join(root, entry.name, 'meta.json'), 'utf8')) as {
        status?: string; errorMessage?: string; completedAt?: string; startedAt?: string; createdAt?: string;
        browser?: {runtime?: {tabUrl?: string; conversationId?: string; promptSubmitted?: boolean}};
        error?: {details?: {code?: string}};
      };
      const runtime = meta.browser?.runtime;
      if (!runtime?.tabUrl) return null;
      const chat = parseSashaiChatUrl(runtime.tabUrl);
      if (runtime.conversationId && runtime.conversationId !== chat.conversationId) return null;
      if (conversationUrl && chat.url !== conversationUrl) return null;
      let expectedAnswer: string | null = knownExpected.get(entry.name) ?? null;
      // The native transcript is Oracle's capture evidence, not proof of task completion.
      // Limit file size and do not expose the saved transcript to the status API.
      if (meta.status === 'completed' && runtime.promptSubmitted) {
        const transcriptPath = join(root, entry.name, 'artifacts', 'transcript.md');
        const info = await stat(transcriptPath).catch(() => null);
        if (info && info.size <= 262144) {
          const text = await readFile(transcriptPath, 'utf8');
          const marker = '\n## Answer\n';
          const pos = text.lastIndexOf(marker);
          if (pos >= 0) {
            const captured = text.slice(pos + marker.length).trim();
            if (captured && captured.length <= 8000) expectedAnswer = captured;
          }
        }
      }
      return {
        slug: entry.name,
        expectedAnswer,
        oracleStatus: meta.status || 'unknown',
        promptSubmitted: Boolean(runtime.promptSubmitted),
        conversationUrl: chat.url,
        captureError: meta.error?.details?.code || (meta.errorMessage || '').slice(0, 115) || null,
        recordedAt: meta.completedAt || meta.startedAt || meta.createdAt || '',
      };
    } catch { return null; }
  }));
  const valid = sessions.filter((s): s is NonNullable<typeof s> => s !== null);
  valid.sort((a,b) => b.recordedAt.localeCompare(a.recordedAt));
  return valid[0] || null;
}
export async function sashaiOverview() {
  const adopted = await readAdoptedSashai();
  const [tabList, taskSource] = await Promise.all([listSashaiTabs(), inspectSashaiTaskSource()]);
  const selected = adopted?.url || tabList[0]?.url || null;
  const oracle = await readOracleSmokeEvidence(selected);
  const observation = selected ? await observeSashaiConversation(selected) : null;
  const independentlyObservedAnswer = Boolean(
    observation?.browser === 'attached_read_only' &&
    observation?.turnState === 'turn_finished' &&
    typeof observation.lastAssistant === 'string' &&
    observation.lastAssistant.trim() === oracle?.expectedAnswer &&
    oracle?.promptSubmitted && oracle.conversationUrl === selected
  );
  // Return only metadata: the full saved Oracle transcript must not leak into
  // Flowdeck's JSON response. The backend uses it solely for exact equality.
  const oraclePublic = oracle ? {
    slug: oracle.slug, oracleStatus: oracle.oracleStatus,
    promptSubmitted: oracle.promptSubmitted, conversationUrl: oracle.conversationUrl,
    captureError: oracle.captureError, recordedAt: oracle.recordedAt,
  } : null;
  return { project: 'dr/sashai', oracle: oraclePublic, adopted: adopted ?? null,
    observation, independentlyObservedAnswer, tabCount: tabList.length,
    status: observation?.turnState || 'no_adopted_chat',
    taskState: 'unverified', taskSource, checkedAt: new Date().toISOString() };
}
