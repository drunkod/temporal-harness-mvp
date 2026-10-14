#!/usr/bin/env node
/**
 * Read-only Oracle / Helium CDP diagnostic. Never navigates, clicks, sends, or
 * reads message text into output. Writes safe counts and state to .state/.
 */
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import os from 'node:os';
import {existsSync} from 'node:fs';
const root=resolve(import.meta.dirname,'..');
const slug=process.argv[2]||'flowdeck-sashai-oracle-live-cdp';
if(!/^[a-z0-9_-]{1,100}$/i.test(slug)) throw Error('Invalid session slug');
const home=join(os.homedir(),'.oracle','sessions',slug);
const sourceMeta=join(home,'meta.json');
if(!existsSync(sourceMeta)) throw Error('Oracle session metadata not found for '+slug);
const meta=JSON.parse(await readFile(sourceMeta,'utf8'));
const runtime=meta.browser?.runtime??{};
const tabUrl=String(runtime.tabUrl||'');
if(!/^https:\/\/chatgpt\.com\/g\/g-p-6ab28bdd7fbc8191b581316ff09da79d[a-z0-9-]*\/c\/[0-9a-f-]{36}$/i.test(tabUrl))
 throw Error('Refusing non-Sashai conversation URL');
const pages=await (await fetch('http://127.0.0.1:9222/json/list',{signal:AbortSignal.timeout(4000)})).json();
const target=pages.find(x=>x.type==='page' && x.url?.split('?')[0]===tabUrl && x.webSocketDebuggerUrl);
const localSrc=join(root,'.state','oracle-local','node_modules','@steipete','oracle','dist','src','browser');
const baseSrc='/opt/homebrew/Cellar/oracle/0.21.3/libexec/lib/node_modules/@steipete/oracle/dist/src/browser';
const originalSrc=existsSync(join(baseSrc,'conversationTurns.js'))?baseSrc:localSrc;
const modernSrc=join(root,'.state','oracle-v0215','node_modules','@steipete','oracle','dist','src','browser');
const {buildConversationTurnListExpression:originalTurns}=await import(join(originalSrc,'conversationTurns.js'));
// Retain the historical patched 0.21.3 comparison only when that old local
// installation exists. Fresh 0.21.5 setups must not depend on monkey-patches.
const patchedTurns = existsSync(join(localSrc,'conversationTurns.js'))
  ? (await import(join(localSrc,'conversationTurns.js'))).buildConversationTurnListExpression
  : () => '([])';
const {buildConversationTurnListExpression:modernTurns}=await import(join(modernSrc,'conversationTurns.js'));
const expression=`(() => {
 const original = ${originalTurns()};
 const patched = ${patchedTurns()};
 const modern = ${modernTurns()};
 const heads=[...document.querySelectorAll('h4.sr-only')];
 const marker=h=>String(h.textContent||'').trim();
 const visible = n=>Boolean(n?.getBoundingClientRect?.().height);
 const stop=[...document.querySelectorAll('button')].some(b=>visible(b)&&/^(stop|stop generating|stop response)$/i.test(String(b.getAttribute('aria-label')||'')));
 const legacyAssistant=patched.filter(n=>Boolean(n.querySelector('[data-message-author-role="assistant"],[data-turn="assistant"],[data-testid*="assistant"]'))).length;
 const newAssistant=patched.filter(n=>marker(n.querySelector('h4.sr-only'))==='ChatGPT said:').length;
 return {
   hrefMatchesExpected:location.href.split('?')[0]===${JSON.stringify(tabUrl)},
   loading:document.readyState,
   oldTurnCount:original.length, patchedTurnCount:patched.length, modernTurnCount:modern.length,
   modernRoleAttrs:modern.map(n=>String(n.getAttribute('data-content-search-unit-key') || n.getAttribute('data-chatgpt-search-unit-key') || n.getAttribute('data-message-author-role') || n.getAttribute('data-turn') || 'exchange').split(':').at(-1)),
   modernAssistantChildren:modern.map(n=>n.querySelectorAll(':is([data-message-author-role="assistant"],[data-content-search-unit-key$=":assistant"],[data-chatgpt-search-unit-key$=":assistant"]),[data-turn="assistant"]').length),
   modernUserChildren:modern.map(n=>n.querySelectorAll(':is([data-message-author-role="user"],[data-content-search-unit-key$=":user"],[data-chatgpt-search-unit-key$=":user"]),[data-turn="user"]').length),
   oldAssistantCount:legacyAssistant,
   headingCounts:{user:heads.filter(h=>marker(h)==='You said:').length,
       assistant:heads.filter(h=>marker(h)==='ChatGPT said:').length},
   newAssistantCount:newAssistant,
   busyHint:!!document.querySelector('[aria-busy="true"]'),
   stopVisible:stop,
   composerPresent:!!document.querySelector('#prompt-textarea,[contenteditable="true"]'),
   // Never record page HTML or transcript text.
   pageTitlePresent:document.title.length>0
 };
})()`;
async function evaluate(wsUrl){
 const s=new WebSocket(wsUrl);let timer;return await new Promise((resolve,reject)=>{
  timer=setTimeout(()=>{s.close();reject(new Error('CDP evaluate timeout'));},8500);
  s.addEventListener('open',()=>s.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})));
  s.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id!==1)return;clearTimeout(timer);s.close();if(m.error||m.result?.exceptionDetails)reject(Error('Runtime.evaluate failed'));else resolve(m.result?.result?.value)});
  s.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP socket error'))});
 });
}
const evidence={
 version:1, at:new Date().toISOString(),session:slug,oracleStatus:meta.status||'unknown',
 oracleErrorCode:meta.error?.details?.code||null,
 promptSubmitted:runtime.promptSubmitted===true,
 conversationId:runtime.conversationId||null,
 sourceErrorProbe:meta.error?.details?.commitProbe??null,
 tabOpen:Boolean(target),
 ...(target?{cdp:await evaluate(target.webSocketDebuggerUrl)}:{cdp:null})
};
const dir=join(root,'.state','oracle-debug');
await mkdir(dir,{recursive:true,mode:0o700});
const out=join(dir,slug+'.diagnostics.json');
await writeFile(out,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({evidenceFile:out,...evidence},null,2));
