#!/usr/bin/env node
/** Read-only exact-target diagnostics. No scrolling, focus, refresh, navigation, writes, or send. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { browserPages, browserEvaluate } from '../dist/sashai-live-browser.js';
import { parseSashaiChatUrl } from '../dist/sashai-observer.js';
import { supervisorAnswerExpression, supervisorIdentityExpression } from '../dist/flowdeck-supervisor-activities.js';

export const usage = 'Usage: node scripts/flowdeck-observation-probe.mjs --tab EXACT_TAB_ID --url EXACT_PROJECT_CHAT_URL [--samples 1..10] [--interval-ms 250..5000]';
export function parseOptions(args) {
  const options = { samples: 3, intervalMs: 1000 };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--tab', '--url', '--samples', '--interval-ms'].includes(key) || seen.has(key) || !value) throw Error(usage);
    seen.add(key);
    if (key === '--tab') options.tabId = value;
    if (key === '--url') options.url = value;
    if (key === '--samples' || key === '--interval-ms') {
      if (!/^\d+$/.test(value)) throw Error(usage);
      options[key === '--samples' ? 'samples' : 'intervalMs'] = Number(value);
    }
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.tabId ?? '') || !options.url ||
      options.samples < 1 || options.samples > 10 || options.intervalMs < 250 || options.intervalMs > 5000) throw Error(usage);
  if (parseSashaiChatUrl(options.url).url !== options.url) throw Error('Use the exact canonical conversation URL without query/fragment');
  return options;
}

export function observationProbeExpression(url) {
  return `(() => {
    if(location.origin + location.pathname !== ${JSON.stringify(url)})throw Error('Pinned route changed');
    const main=document.querySelector('main');
    const roles=[...document.querySelectorAll('[data-message-author-role]')];
    const headings=[...document.querySelectorAll('main h4.sr-only')].map(h=>(h.textContent||'').trim());
    const assistants=roles.filter(n=>n.getAttribute('data-message-author-role')==='assistant');
    const last=assistants.at(-1);
    const visible=n=>Boolean(n?.getClientRects().length);
    const size=(n,key)=>(n?.[key]||'').length;
    const answer=${supervisorAnswerExpression(url)};
    const identity=${supervisorIdentityExpression(url)};
    const scrollers=[...document.querySelectorAll('.thread-scroll-container')];
    const busyElements=[...document.querySelectorAll('[aria-busy=true]')];
    const lastStyle=last?getComputedStyle(last):null;
    return {
      schema:'flowdeck.observation-probe/v1',
      observedAt:new Date().toISOString(),
      documentReadyState:document.readyState,
      visibilityState:document.visibilityState,
      documentFocused:document.hasFocus(),
      mainPresent:Boolean(main), mainVisible:visible(main),
      mainInnerTextLength:size(main,'innerText'), mainTextContentLength:size(main,'textContent'),
      userRoleCount:roles.filter(n=>n.getAttribute('data-message-author-role')==='user').length,
      assistantRoleCount:assistants.length,
      userHeadingCount:headings.filter(h=>h==='You said:').length,
      assistantHeadingCount:headings.filter(h=>h==='ChatGPT said:').length,
      lastAssistantVisible:visible(last),
      lastAssistantInnerTextLength:size(last,'innerText'),
      lastAssistantTextContentLength:size(last,'textContent'),
      lastAssistantContentVisibility:lastStyle?.contentVisibility||null,
      lastAssistantDisplay:lastStyle?.display||null,
      parsedAssistantLength:typeof answer==='string'?answer.length:0,
      taskIdPresent:Boolean(identity?.taskId), worktreePresent:Boolean(identity?.worktree),
      identityUserTurns:identity?.latestUserTurns??0,
      originalUserTextLength:identity?.originalUserText?.length??0,
      latestUserTextLength:identity?.latestUserText?.length??0,
      generationStopVisible:[...document.querySelectorAll('button')].some(b=>visible(b)&&
        (b.getAttribute('data-testid')==='stop-button'||/^stop( generating| response)?$/i.test((b.getAttribute('aria-label')||'').trim()))),
      pageBusy:Boolean(document.querySelector('[aria-busy=true]')),
      busyElementCount:busyElements.length,
      visibleBusyElementCount:busyElements.filter(visible).length,
      scrollContainerCount:scrollers.length,
      scrollContainers:scrollers.slice(0,4).map(n=>({visible:visible(n),scrollTop:n.scrollTop,
        scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,
        contentVisibility:getComputedStyle(n).contentVisibility||null})),
      browserSubmissions:0, writes:false
    };
  })()`;
}

export async function collectObservation(options, deps = {}) {
  const pages = await (deps.pages ?? browserPages)();
  const matches = pages.filter(p => p.type === 'page' && p.id === options.tabId);
  if (matches.length !== 1 || matches[0].url.split('?')[0].split('#')[0] !== options.url) {
    throw Error('Original pinned tab/URL unavailable or ambiguous; no replacement selected');
  }
  return (deps.evaluate ?? browserEvaluate)(matches[0], observationProbeExpression(options.url));
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const options = parseOptions(args);
  for (let sample = 1; sample <= options.samples; sample++) {
    const observation = await collectObservation(options);
    console.log(JSON.stringify({ sample, tabId: options.tabId, ...observation }));
    if (sample < options.samples) await delay(options.intervalMs);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
