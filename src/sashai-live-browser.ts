import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {composerPayloadFor,FLOWDECK_CONNECTOR_LABEL} from './sashai-dispatch-evidence.js';
import {parseSashaiChatUrl} from './sashai-observer.js';

export const PROJECT='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
export type BrowserTarget={id:string;type:string;url:string;webSocketDebuggerUrl?:string};
export interface ToolCallEvidence {id:string;connector:string;operation:string;path:string;completed:boolean}
export interface BrowserEvidence {tool:boolean;reply:boolean;marker:boolean;source:boolean;
 calls:ToolCallEvidence[];turnId:string|null;promptMatched:boolean;turnState:string}
export interface InitialFirstUserTurn {matched:boolean;turnId:string|null}
export type BrowserReadinessSnapshot={routeMatches:boolean;documentReadyState:string;visibleComposerCount:number;visibleButtonCount:number;pickerVisible:boolean;pickerExpanded:boolean;exactConnectorButtons:number;prefixConnectorButtons:number;otherRoleConnectorMatches:number;menuCount:number;dialogCount:number;selectedConnector:boolean;busy:boolean};
export type BrowserDiagnostic={check:string;reason:string;tabId:string;expected:string;observed?:string;elapsedMs?:number;readiness?:BrowserReadinessSnapshot};
export interface LiveBrowser {
 diagnostics?():BrowserDiagnostic[];
 createOwnedProjectTab(owner:string):Promise<BrowserTarget>;
 requireTab(id:string,url:string):Promise<BrowserTarget>;
 stage(tab:BrowserTarget,url:string,prompt:string):Promise<void>;
 matches(tab:BrowserTarget,url:string,prompt:string):Promise<boolean>;
 click(tab:BrowserTarget,url:string,prompt:string,deadline:number,check?:()=>void):Promise<boolean>;
 chat(id:string):Promise<{url:string;id:string}|null>;
 firstUserTurn?(id:string,url:string,prompt:string):Promise<InitialFirstUserTurn>;
 evidence(id:string,url:string,marker:string,output:string,prompt:string):Promise<BrowserEvidence>;
}
const wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const OWNED_TAB_WAIT_MS=20_000;
const COMPOSER_WAIT_MS=15_000;
const PICKER_WAIT_MS=5_000;
const CONNECTOR_WAIT_MS=8_000;
const SELECTED_LABEL_WAIT_MS=5_000;
const STAGE_WAIT_MS=30_000;
const POLL_MS=250;
export async function browserPages():Promise<BrowserTarget[]> {
 const r=await fetch('http://127.0.0.1:9222/json/list',{signal:AbortSignal.timeout(4500)});
 if(!r.ok)throw Error('Helium debugging port not available');
 return await r.json() as BrowserTarget[];
}
export async function browserEvaluate(tab:BrowserTarget,expression:string,checkBeforeDispatch?:()=>void):Promise<unknown> {
 if(!tab.webSocketDebuggerUrl)throw Error('No CDP WebSocket URL');
 const socket=new WebSocket(tab.webSocketDebuggerUrl);
 return await new Promise((resolve,reject)=>{
  let settled=false;
  const cleanup=()=>{
   clearTimeout(timer);
   socket.removeEventListener('open',onOpen);
   socket.removeEventListener('message',onMessage);
   socket.removeEventListener('error',onError);
   socket.removeEventListener('close',onClose);
   try{socket.close()}catch{/* An already closed socket needs no further cleanup. */}
  };
  const finish=(error?:Error,value?:unknown)=>{
   if(settled)return;
   settled=true;cleanup();
   if(error)reject(error);else resolve(value);
  };
  const onOpen=()=>{
   let authorized=false;
   try{
    // Recheck cancellation immediately before the Runtime.evaluate RPC.
    checkBeforeDispatch?.();
    authorized=true;
    socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
   }catch(error){finish(authorized?Error('CDP socket send failure'):(error instanceof Error?error:Error('CDP dispatch cancelled')))}
  };
  const onMessage=(ev:MessageEvent)=>{
   let m:Record<string,any>;
   try{m=JSON.parse(String(ev.data))}catch{return}
   if(m.id!==1)return;
   if(m.error||m.result?.exceptionDetails)finish(Error('CDP evaluation failed'));
   else finish(undefined,m.result?.result?.value);
  };
  const onError=()=>finish(Error('CDP socket failure'));
  const onClose=()=>finish(Error('CDP socket closed before evaluation result'));
  const timer=setTimeout(()=>finish(Error('CDP timeout; reconcile before retry')),9000);
  socket.addEventListener('open',onOpen);
  socket.addEventListener('message',onMessage);
  socket.addEventListener('error',onError);
  socket.addEventListener('close',onClose);
 });
}
interface BrowserDependencies {
 pages:typeof browserPages; evaluate:typeof browserEvaluate;
 openWindow:(url:string)=>Promise<void>; wait:(ms:number)=>Promise<void>;
}
async function openWindow(url:string) {
 // Refuse to start a competing profile instance. CDP availability alone does not
 // prove that the Helium application is running.
 await promisify(execFile)('/usr/bin/pgrep',['-f','^/Applications/Helium.app/Contents/MacOS/Helium( |$)'],{timeout:3000});
 await new Promise<void>((resolve,reject)=>{
  const child=spawn('/Applications/Helium.app/Contents/MacOS/Helium',
   ['--profile-directory=Profile 4','--new-window',url],{stdio:'ignore',timeout:10000});
  child.once('error',reject);
  child.once('close',code=>code===0?resolve():reject(Error('Helium window handoff failed')));
 });
}

/** Only structured, completed tool-call records can establish invocation.
 * Plain assistant/user text, including a selected connector mention, cannot. */
export function confirmedToolCalls(calls:ToolCallEvidence[],output:string):ToolCallEvidence[] {
 return calls.filter(c=>Boolean(c.id)&&/^(?:(?:remote[ _-]?)?desktop[ _-]?commander|probe[ _-]?remotemcp2)$/i.test(c.connector)&&
  /^(?:write_file|edit_block)$/.test(c.operation)&&c.path===output&&c.completed===true);
}
/** Pure matcher used by the initial-send DOM probe; webpage text never supplies authority. */
export function matchInitialFirstUserTurn(users:Array<{text:string;turnId?:string|null}>,prompt:string):InitialFirstUserTurn {
 const first=users.length===1?users[0]:undefined;
 const matched=Boolean(first&&first.turnId&&first.text.normalize('NFC').replace(/\s+/gu,' ').trim()===composerPayloadFor(prompt));
 return {matched,turnId:matched && first ? first.turnId ?? null : null};
}
export function createLiveBrowser(overrides:Partial<BrowserDependencies>={}):LiveBrowser {
 const d:BrowserDependencies={pages:browserPages,evaluate:browserEvaluate,openWindow,wait,...overrides};
 const trace:BrowserDiagnostic[]=[];
 const owned=new Map<string,{tag:string;url:string}>();
 const safeUrl=(value:string)=>{try{const u=new URL(value);return u.origin+u.pathname;}catch{return value==='about:blank'?value:'[unavailable]';}};
 const diagnostic=(check:string,reason:string,id:string,url:string,observed?:string,readiness?:BrowserReadinessSnapshot)=>{
  const entry={check,reason,tabId:id,expected:safeUrl(url),observed:observed?safeUrl(observed):undefined,readiness};
  if(JSON.stringify(trace.at(-1))!==JSON.stringify(entry)){trace.push(entry);if(trace.length>80)trace.shift();}
 };
 const requireTab=async(id:string,url:string)=>{
  const matches=(await d.pages()).filter(t=>t.id===id);
  const reason=matches.length===0?'tab_missing':matches.length!==1?'duplicate_tab_id':matches[0].type!=='page'?'not_page':!matches[0].webSocketDebuggerUrl?'websocket_missing':matches[0].url.split('?')[0]!==url?'cdp_url_mismatch':null;
  if(reason){diagnostic('requireTab',reason,id,url,matches[0]?.url);throw Error('Original owned ChatGPT tab changed: requireTab/'+reason+' expected='+safeUrl(url)+' observed='+safeUrl(matches[0]?.url||''));}
  return matches[0];
 };
 // Only a freshly created, tagged target may wait through pre-send navigation.
 // requireTab()/click() remain strict; no old tab can become an owned target here.
 const stagingTarget=async(tab:BrowserTarget,url:string,check:string):Promise<BrowserTarget|null>=>{
  const ownership=owned.get(tab.id);
  if(!ownership)return requireTab(tab.id,url);
  if(url!==ownership.url.split('?')[0])throw Error('Owned staging project changed');
  const matches=(await d.pages()).filter(t=>t.id===tab.id);
  if(matches.length>1||matches[0]&&matches[0].type!=='page')throw Error('Owned staging identity is ambiguous');
  const current=matches[0];
  if(!current||!current.webSocketDebuggerUrl){diagnostic(check,!current?'tab_missing':'websocket_missing',tab.id,url,current?.url);return null;}
  if(current.url==='about:blank'||!current.url){diagnostic(check,'cdp_bootstrap',tab.id,url,current.url);return null;}
  let actual:URL;try{actual=new URL(current.url);}catch{throw Error('Owned staging URL is invalid');}
  if(actual.origin!=='https://chatgpt.com')throw Error('Owned staging left ChatGPT origin');
  const tag=actual.searchParams.get('flowdeckAttempt');
  if(tag!==null&&tag!==ownership.tag)throw Error('Owned staging attempt tag changed');
  if(current.url.split('?')[0]!==url){diagnostic(check,'cdp_url_pending',tab.id,url,current.url);return null;}
  diagnostic(check,'cdp_target_ready',tab.id,url,current.url);return current;
 };
 const domDiagnostic=async(tab:BrowserTarget,url:string,check:string)=>{
  try{const info=await d.evaluate(tab,`(() => ({url:location.origin+location.pathname,ready:document.readyState}))()` ) as {url?:string;ready?:string};diagnostic(check,'dom_route_pending/'+(info?.ready||'unknown'),tab.id,url,info?.url);}catch{diagnostic(check,'dom_read_unavailable',tab.id,url);}
 };
 // Read-only structural diagnostics. No prompt, page text, cookies, or DOM dumps.
 const inspectReadiness=async(tab:BrowserTarget,url:string,check:string)=>{
  try{
   const state=await d.evaluate(tab,`(() => {
    const visible=x=>Boolean(x.getClientRects().length);
    const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(visible);
    const buttons=[...document.querySelectorAll('button')].filter(visible);
    const picker=buttons.find(b=>b.getAttribute('aria-label')==='Add files and more');
    const label=${JSON.stringify(FLOWDECK_CONNECTOR_LABEL)};
    const text=b=>(b.innerText||'').trim();
    const other=[...document.querySelectorAll('[role="menuitem"],[role="option"],[role="button"]')]
      .filter(x=>visible(x)&&x.tagName.toLowerCase()!=='button'&&text(x).startsWith(label));
    return {
     routeMatches:location.origin==='https://chatgpt.com'&&location.pathname===${JSON.stringify(new URL(url).pathname)},
     documentReadyState:document.readyState,
     visibleComposerCount:editors.length,
     visibleButtonCount:buttons.length,
     pickerVisible:Boolean(picker),
     pickerExpanded:picker?.getAttribute('aria-expanded')==='true'||picker?.getAttribute('data-state')==='open',
     exactConnectorButtons:buttons.filter(b=>text(b)===label).length,
     prefixConnectorButtons:buttons.filter(b=>text(b).startsWith(label)).length,
     otherRoleConnectorMatches:other.length,
     menuCount:[...document.querySelectorAll('[role="menu"],[role="listbox"]')].filter(visible).length,
     dialogCount:[...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
     selectedConnector:editors.length===1&&text(editors[0])===label,
     busy:buttons.some(b=>b.getAttribute('data-testid')==='stop-button')
    };
   })()`) as BrowserReadinessSnapshot;
   diagnostic(check,'readiness_snapshot',tab.id,url,tab.url,state);
  }catch{diagnostic(check,'readiness_snapshot_unavailable',tab.id,url);}
 };
 const idleCheck=`const visibleEditors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(x=>x.getClientRects().length);const ambiguousComposer=visibleEditors.length>1;const e=visibleEditors.length===1?visibleEditors[0]:document.querySelector('[contenteditable="true"][role="textbox"]');const stop=[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&(b.getAttribute('data-testid')==='stop-button'||/^Stop( generating| response)?$/i.test(b.getAttribute('aria-label')||'')));`;
 const payloadCheck=(url:string,prompt:string)=>`${idleCheck}const b=document.querySelector('button[aria-label="Send"]:not([disabled])');const value=(e?.innerText||'').normalize('NFC').replace(/\\s+/gu,' ').trim();const valid=location.origin==='https://chatgpt.com'&&location.pathname===${JSON.stringify(new URL(url).pathname)}&&!stop&&!ambiguousComposer&&!!e?.getClientRects().length&&value===${JSON.stringify(composerPayloadFor(prompt))}&&!!b;`;
 return {
  diagnostics:()=>trace.map(entry=>({...entry})),
  async createOwnedProjectTab(owner) {
   if(!/^[a-f0-9-]{36}$/i.test(owner))throw Error('Invalid browser ownership ID');
   // A durable autonomous owner fences every other new Flowdeck browser target.
   // The matching tab owner is the sole exception for its already claimed run.
   try{
    const claim=JSON.parse(await readFile(join(homedir(),'Library','Application Support','Flowdeck','autonomy-v1','browser-owner.lock'),'utf8'));
    if(claim?.schema!=='flowdeck.browser-owner/v1'||claim.tabOwnerId!==owner)
     throw Error('Machine-wide Flowdeck browser owner is claimed; reconcile before opening another target');
   }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   const before=new Set((await d.pages()).map(t=>t.id));
   const url=PROJECT+'?flowdeckAttempt='+encodeURIComponent(owner);
   await d.openWindow(url);
   const deadline=Date.now()+OWNED_TAB_WAIT_MS;
   let attempts=0;
   while(attempts++<80&&Date.now()<=deadline){
    const candidates=(await d.pages()).filter(t=>t.type==='page'&&!before.has(t.id)&&t.url===url&&t.webSocketDebuggerUrl);
    if(candidates.length>1)throw Error('Ambiguous owned browser targets');
    if(candidates.length===1){owned.set(candidates[0].id,{tag:owner,url});diagnostic('createOwnedProjectTab','tagged_target_found',candidates[0].id,PROJECT,candidates[0].url);return candidates[0];}
    await d.wait(POLL_MS);
   }
   throw Error('Owned project tab not found; existing tabs were not adopted');
  },
  requireTab,
  async stage(tab,url,prompt) {
   const targetPath=JSON.stringify(new URL(url).pathname);
   const stageDeadline=Date.now()+STAGE_WAIT_MS;
   const composerDeadline=Math.min(Date.now()+COMPOSER_WAIT_MS,stageDeadline);
   let composer:unknown='waiting',composerAttempts=0,composerWrongTarget=false;
   while(composerAttempts++<60&&Date.now()<=composerDeadline){
    const current=await stagingTarget(tab,url,'stage.composer');
    if(!current){await d.wait(POLL_MS);continue;}
    composer=await d.evaluate(current,`(() => {${idleCheck}
     if(location.origin!=='https://chatgpt.com'||location.pathname!==${targetPath})return 'wrong-target';
     if(stop)return 'active';
     if(ambiguousComposer)return 'duplicate_composer';
     if(!e)return 'composer_missing';
     if(!e.getClientRects().length)return 'composer_hidden';
     return (e.innerText||'').trim()?'draft':'ready';
    })()`);
    if(composer==='ready')break;
    if(composer==='duplicate_composer')throw Error('Ambiguous visible composers; staging refused');
    if(typeof composer==='string'&&composer!=='wrong-target')diagnostic('stage.composer',composer,tab.id,url,current.url);
    if(composer===false||composer==='draft')throw Error('Owned chat is active or contains an owner draft');
    if(composer==='active')throw Error('Owned chat is active or contains an owner draft');
    if(composer==='wrong-target'){composerWrongTarget=true;await domDiagnostic(current,url,'stage.composer');if(!owned.has(tab.id))throw Error('Original owned ChatGPT tab changed: stage.composer/dom_route_mismatch');await d.wait(POLL_MS);continue;}
    await d.wait(POLL_MS);
   }
   if(composer!=='ready')throw Error('Pre-send readiness timeout at stage.composer: '+(trace.at(-1)?.reason||(composerWrongTarget?'dom_route_pending':'composer_missing')));
   const pickerDeadline=Math.min(Date.now()+PICKER_WAIT_MS,stageDeadline);
   let menu=false,pickerAttempts=0;
   while(pickerAttempts++<20&&Date.now()<=pickerDeadline){
    const current=await stagingTarget(tab,url,'stage.picker');
    if(!current){await d.wait(POLL_MS);continue;}
    const picker=await d.evaluate(current,`(() => {${idleCheck}
     if(location.origin!=='https://chatgpt.com'||location.pathname!==${targetPath})return 'wrong-target';
     if(stop)return 'active';
     if(e&&(e.innerText||'').trim())return 'draft';
     const b=document.querySelector('button[aria-label="Add files and more"]');
     if(!b?.getClientRects().length)return 'waiting';
     b.click();return 'opened';
    })()`);
    if(picker==='opened'){menu=true;break;}
    if(picker==='waiting')diagnostic('stage.picker','picker_button_missing',tab.id,url,current.url);
    if(picker==='draft'||picker==='active')throw Error('Owned chat is active or contains an owner draft');
    if(picker==='wrong-target'){await domDiagnostic(current,url,'stage.picker');if(!owned.has(tab.id))throw Error('Original owned ChatGPT tab changed: stage.picker/dom_route_mismatch');}
    await d.wait(POLL_MS);
   }
   if(!menu)throw Error('Connector picker not available');
   // Selection gets its own budget; opening the picker may consume the entire
   // earlier deadline on a slow SPA route without implying a missing connector.
   const connectorDeadline=Math.min(Date.now()+CONNECTOR_WAIT_MS,stageDeadline);
   let chosen=false,pickerSelectionAttempts=0,pickerWrongTarget=false,missingConnectorReads=0,pickerReopened=false;
   let lastConnectorTarget:BrowserTarget|null=null;
   while(pickerSelectionAttempts++<32&&Date.now()<=connectorDeadline){
    const current=await stagingTarget(tab,url,'stage.connector');
    if(!current){await d.wait(POLL_MS);continue;}
    lastConnectorTarget=current;
    const selected=await d.evaluate(current,`(() => {${idleCheck}
     if(location.origin!=='https://chatgpt.com'||location.pathname!==${targetPath})return 'wrong-target';
     if(stop)return 'active';
     if(e&&((e.innerText||'').trim()))return 'draft';
     const bs=[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length&&(b.innerText||'').trim().startsWith(${JSON.stringify(FLOWDECK_CONNECTOR_LABEL)}));
     if(bs.length===0)return 'connector_missing';
     if(bs.length>1)return 'connector_ambiguous';
     bs[0].click();return 'selected';
    })()`);
    if(selected==='selected'){chosen=true;break;}
    if(selected==='connector_ambiguous')throw Error('Ambiguous connector choices; staging refused');
    if(selected==='connector_missing'){
     diagnostic('stage.connector','connector_missing',tab.id,url,current.url);
     if(++missingConnectorReads===3){
       await inspectReadiness(current,url,'stage.connector.early');
       // A picker click can be swallowed during React hydration. Retry the
       // picker itself ONCE only if no popup/menu is open and the exact empty,
       // uniquely visible composer and original owned target still agree.
       const reopened=await d.evaluate(current,`(() => {${idleCheck}
         if(location.origin!=='https://chatgpt.com'||location.pathname!==${targetPath})return 'wrong-target';
         if(stop||ambiguousComposer||!e?.getClientRects().length||(e.innerText||'').trim())return 'unsafe';
         const pickers=[...document.querySelectorAll('button[aria-label="Add files and more"]')]
           .filter(b=>b.getClientRects().length);
         if(pickers.length!==1)return 'picker_ambiguous';
         const b=pickers[0];
         if(b.getAttribute('aria-expanded')==='true'||b.getAttribute('data-state')==='open')return 'menu_open';
         if([...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"]')]
            .some(x=>x.getClientRects().length))return 'menu_open';
         b.click();return 'reopened';
       })()`);
       if(reopened==='reopened'){
         pickerReopened=true;
         diagnostic('stage.connector','picker_reopened_once_after_verified_closed',tab.id,url,current.url);
       }else if(reopened==='unsafe'||reopened==='picker_ambiguous'||reopened==='wrong-target')
         throw Error('Connector picker re-open refused unsafe/ambiguous state: '+reopened);
       else diagnostic('stage.connector','picker_reopen_skipped_'+String(reopened),tab.id,url,current.url);
     }
    }
    if(selected==='draft')throw Error('Owned chat is active or contains an owner draft');
    if(selected==='active')throw Error('Owned chat is active or contains an owner draft');
    if(selected==='wrong-target'){pickerWrongTarget=true;await domDiagnostic(current,url,'stage.connector');if(!owned.has(tab.id))throw Error('Original owned ChatGPT tab changed: stage.connector/dom_route_mismatch');await d.wait(POLL_MS);continue;}
    await d.wait(POLL_MS);
   }
   if(!chosen){
    if(lastConnectorTarget)await inspectReadiness(lastConnectorTarget,url,'stage.connector.final');
    throw Error('Pre-send readiness timeout at stage.connector: '+(pickerWrongTarget?'dom_route_pending':pickerReopened?'connector_missing_after_single_picker_reopen':'connector_missing'));
   }
   // The picker click can return before React hydrates the connector pill. Wait
   // for exactly the expected selection before touching the composer; never
   // click the connector a second time during this read-only wait.
   const labelDeadline=Math.min(Date.now()+SELECTED_LABEL_WAIT_MS,stageDeadline);
   let hydrated=false,hydrationAttempts=0;
   while(hydrationAttempts++<20&&Date.now()<=labelDeadline){
    const current=await stagingTarget(tab,url,'stage.selected_label');
    if(!current){await d.wait(POLL_MS);continue;}
    const state=await d.evaluate(current,`(() => {${idleCheck}
     if(location.origin!=='https://chatgpt.com'||location.pathname!==${targetPath})return 'wrong-target';
     if(stop||ambiguousComposer)return 'unsafe';
     if(!e?.getClientRects().length)return 'composer_missing';
     const value=(e.innerText||'').trim();
     if(value===${JSON.stringify(FLOWDECK_CONNECTOR_LABEL)})return 'ready';
     return value?'unexpected_selection':'pending';
    })()`);
    if(state==='ready'){hydrated=true;break;}
    if(state==='unsafe'||state==='unexpected_selection')throw Error('Connector selection is ambiguous; staging refused');
    diagnostic('stage.selected_label',String(state),tab.id,url,current.url);
    await d.wait(POLL_MS);
   }
   if(!hydrated)throw Error('Pre-send readiness timeout at stage.selected_label: '+(trace.at(-1)?.reason||'selected_label_pending'));
   const finalTarget=await stagingTarget(tab,url,'stage.insert');
   if(!finalTarget||Date.now()>stageDeadline)throw Error('Staging deadline/target expired before prompt insertion');
   const staged=await d.evaluate(finalTarget,`(() => {${idleCheck}if(location.origin!=='https://chatgpt.com'||location.pathname!==${targetPath}||stop||ambiguousComposer||!e?.getClientRects().length||e.innerText.trim()!==${JSON.stringify(FLOWDECK_CONNECTOR_LABEL)})return false;e.focus();document.execCommand('insertText',false,${JSON.stringify(' '+prompt)});return (e.innerText||'').normalize('NFC').replace(/\\s+/gu,' ').trim()===${JSON.stringify(composerPayloadFor(prompt))}})()`);
   if(staged!==true)throw Error('Full connector prompt could not be staged');
  },
  async matches(tab,url,prompt){await requireTab(tab.id,url);return await d.evaluate(tab,`(() => {${payloadCheck(url,prompt)}return valid})()` )===true;},
  async click(tab,url,prompt,deadline,check){await requireTab(tab.id,url);check?.();const result=await d.evaluate(tab,`(() => {${payloadCheck(url,prompt)}if(!valid||Date.now()>${JSON.stringify(deadline)})return false;b.click();return true})()` ,check);try{check?.();}catch{throw Error("CDP click outcome uncertain after cancellation: quarantine");}return result===true;},
  async chat(id){
   const tab=(await d.pages()).find(t=>t.type==='page'&&t.id===id);
   if(!tab)return null;
   try{const p=parseSashaiChatUrl(tab.url.split('?')[0]);return {url:p.url,id:p.conversationId}}catch{return null}
  },
  async firstUserTurn(id,url,prompt){
   const tab=await requireTab(id,url);
   const users=await d.evaluate(tab,`(() => {
    if(location.origin!=='https://chatgpt.com'||location.pathname!==${JSON.stringify(new URL(url).pathname)})throw Error('Chat changed');
    const normal=v=>v.normalize('NFC').replace(/\\s+/gu,' ').trim();
    return [...document.querySelectorAll('[data-message-author-role="user"]')].map(e=>({
     text:normal(e.innerText||''),turnId:e.getAttribute('data-message-id')||e.closest('[data-message-id]')?.getAttribute('data-message-id')||null
    }));
   })()`) as Array<{text:string;turnId:string|null}>;
   return matchInitialFirstUserTurn(users,prompt);
  },
  async evidence(id,url,marker,output,prompt){
   const tab=await requireTab(id,url);
   // Deliberately fail closed if this ChatGPT layout does not expose structured
   // tool activity. It must not be replaced by a regex over the whole chat.
   const raw=await d.evaluate(tab,`(() => {
    if(location.origin!=='https://chatgpt.com'||location.pathname!==${JSON.stringify(new URL(url).pathname)})throw Error('Chat changed');
    const normal=v=>v.normalize('NFC').replace(/\\s+/gu,' ').trim();
    const messages=[...document.querySelectorAll('[data-message-author-role]')];
    const users=messages.filter(e=>e.getAttribute('data-message-author-role')==='user'&&normal(e.innerText||'')===${JSON.stringify(composerPayloadFor(prompt))});
    const empty={calls:[],reply:false,marker:false,source:false,turnId:null,promptMatched:false,turnState:'unknown'};
    if(users.length!==1)return empty;
    const user=users[0],start=messages.indexOf(user);
    const turnId=user.getAttribute('data-message-id')||user.closest('[data-message-id]')?.getAttribute('data-message-id');
    if(!turnId)return empty;
    const later=messages.slice(start+1);
    if(later.some(e=>e.getAttribute('data-message-author-role')==='user'))return empty;
    const replies=later.filter(e=>e.getAttribute('data-message-author-role')==='assistant');
    const callNodes=replies.flatMap(e=>[...e.querySelectorAll('[data-tool-call-id]')]);
    const calls=callNodes.map(e=>({id:e.getAttribute('data-tool-call-id')||'',connector:e.getAttribute('data-connector-name')||'',operation:e.getAttribute('data-tool-name')||'',path:e.getAttribute('data-file-path')||'',completed:e.getAttribute('data-tool-status')==='completed'}));
    const text=replies.map(e=>e.innerText||'').join('\\n');
    const stop=[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&(b.getAttribute('data-testid')==='stop-button'||/^Stop( generating| response)?$/i.test(b.getAttribute('aria-label')||'')));
    return {calls,reply:replies.length>0,marker:(user.innerText||'').includes(${JSON.stringify(marker)}),source:text.includes('/Users/test/Documents/work/sashai'),turnId,promptMatched:true,turnState:stop?'running':text.trim()?'turn_finished':'awaiting_answer'};
   })()` ) as Omit<BrowserEvidence,'tool'>;
   const calls=confirmedToolCalls(raw.calls,output);
   return {...raw,calls,tool:calls.length>0};
  },
 };
}
export const liveBrowser=createLiveBrowser();
