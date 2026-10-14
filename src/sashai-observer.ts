import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const SASHAI_PROJECT_ID = 'g-p-6ab28bdd7fbc8191b581316ff09da79d';
export const SASHAI_PROJECT_URL = 'https://chatgpt.com/g/' + SASHAI_PROJECT_ID + '/project';
export const ORACLE_SMOKE_SLUG = 'flowdeck-sashai-oracle-live-cdp';
const store = join(resolve(process.cwd()), '.state', 'oracle-sashai');
const adoptedFile = join(store, 'adopted.json');
const observedOracleSmokes = [
  { slug: ORACLE_SMOKE_SLUG, expected: 'ORACLE_SASHAI_SMOKE_OK' },
  { slug: 'oracle-sashai-local-patched-smoke', expected: 'ORACLE_SASHAI_PATCH_OK_20261014B' },
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
      taskState: 'unverified', lastAssistant: '', observedAt: new Date().toISOString() };
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
  await mkdir(store, { recursive: true });
  await writeFile(adoptedFile, JSON.stringify({ ...chat, adoptedAt: new Date().toISOString() }, null, 2));
  return state;
}
export async function readAdoptedSashai() {
  try { return JSON.parse(await readFile(adoptedFile, 'utf8')) as {url: string; conversationId: string; adoptedAt: string}; }
  catch { return null; }
}
export async function readOracleSmokeEvidence(conversationUrl?: string | null) {
  const sessions = [];
  for (const known of observedOracleSmokes) {
    try {
      const path = join(homedir(), '.oracle', 'sessions', known.slug, 'meta.json');
      const meta = JSON.parse(await readFile(path, 'utf8')) as {
        status?: string; errorMessage?: string;
        browser?: {runtime?: {tabUrl?: string; promptSubmitted?: boolean}};
        error?: {details?: {code?: string}};
      };
      const runtime = meta.browser?.runtime;
      sessions.push({
        slug: known.slug, expectedAnswer: known.expected,
        oracleStatus: meta.status || 'unknown',
        promptSubmitted: Boolean(runtime?.promptSubmitted),
        conversationUrl: runtime?.tabUrl || null,
        captureError: meta.error?.details?.code || (meta.errorMessage || '').slice(0, 115) || null,
      });
    } catch { /* absent session */ }
  }
  return sessions.find(s => s.conversationUrl === conversationUrl)
    || sessions[0] || null;
}
export async function sashaiOverview() {
  const adopted = await readAdoptedSashai();
  const tabList = await listSashaiTabs();
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
  return { project: 'dr/sashai', oracle, adopted: adopted ?? null,
    observation, independentlyObservedAnswer, tabCount: tabList.length,
    status: observation?.turnState || 'no_adopted_chat',
    taskState: 'unverified', checkedAt: new Date().toISOString() };
}
