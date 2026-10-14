#!/usr/bin/env node
/**
 * Guarded, report-only Sashai browser sender. The selected connector is a
 * ChatGPT composer token, so Oracle MUST NOT submit tool-using first turns.
 * This sender deliberately has no general-purpose task or prompt arguments.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const base=resolve(import.meta.dirname,'..');
const state=join(base,'.state','report-review-dispatch');
const taskFile=join(base,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md');
const output=join(base,'docs','SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md');
const repo='/Users/test/Documents/work/sashai';
const project='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const recordFile=join(state,'attempt.json');
const sendGuard=join(state,'SEND_ATTEMPTED');
const marker='SASHAI_ARCHITECTURE_BROWSER_REPORT_'+new Date().toISOString().slice(0,10).replaceAll('-','');
const action=process.argv[2]||'status';
const sha=s=>createHash('sha256').update(s).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:8000,maxBuffer:5_000_000});
const projectPath=new URL(project).pathname;
const pages=async()=>{const r=await fetch('http://127.0.0.1:9222/json/list',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('CDP '+r.status);return await r.json()};
async function evalTab(tab,expression){
 const ws=new WebSocket(tab.webSocketDebuggerUrl);
 return await new Promise((yes,no)=>{
  const tm=setTimeout(()=>{ws.close();no(Error('CDP timeout, do not retry a sent prompt'))},8000);
  ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})));
  ws.addEventListener('message',e=>{
   const m=JSON.parse(String(e.data));if(m.id!==1)return;clearTimeout(tm);ws.close();
   if(m.error||m.result?.exceptionDetails)no(Error('CDP script failed'));
   else yes(m.result?.result?.value);
  });
  ws.addEventListener('error',()=>{clearTimeout(tm);no(Error('CDP error'))});
 });
}
async function getTask(){
 const task=await readFile(taskFile,'utf8');
 if(!task.includes('Scope status: APPROVED, report-only.') ||
    !task.includes('Execution status: NOT DISPATCHED through the browser supervisor.') ||
    !task.includes('## Initial Prompt for the Verified Sender') ||
    !task.includes('## Independent Acceptance'))throw Error('Explicit report-only approval or contract sections missing');
 const expected=task.match(/One-time baseline from preflight:\s*([0-9a-f]{40})/i)?.[1];
 if(!expected)throw Error('Contract lacks exact baseline SHA');
 const actual=git('rev-parse','HEAD').trim();
 if(actual!==expected)throw Error('Sashai HEAD changed; reconcile task contract before dispatch');
 if(existsSync(join(repo,'.ai','harness','active-plan')))throw Error('Active plan appeared; reconcile before one-off dispatch');
 if(existsSync(join(repo,'.ai','harness','active-worktree')))throw Error('Active worktree appeared; reconcile before one-off dispatch');
 if(existsSync(output))throw Error('Report output already exists; refuse overwriting');
 const promptMatch=task.match(/## Initial Prompt for the Verified Sender\s+>\s*([^\n]+)/);
 if(!promptMatch)throw Error('Prepared prompt not present in contract');
 const prompt=promptMatch[1].trim()+' Task marker: '+marker+'. Be precise and perform only read-only Git/Codegraph/file inspection in Sashai. You may create ONLY the report at the explicitly approved MVP documentation output. If a plugin is unavailable, stop and report the blocker.';
 return {task,expected,actual,prompt};
}
const status=async()=>{
 const attempt=existsSync(recordFile)?JSON.parse(await readFile(recordFile,'utf8')):null;
 const sent=existsSync(sendGuard);
 let current=null;
 if(attempt){const t=(await pages()).find(x=>x.id===attempt.tabId);current=t?{url:t.url,tabId:t.id}:null;}
 return {attempt,sent,tab:current,outputExists:existsSync(output)};
};
await mkdir(state,{recursive:true,mode:0o700});
if(action==='prepare'){
 if(existsSync(recordFile)||existsSync(sendGuard))throw Error('One report attempt already exists; do not stage again');
 const {task,expected,prompt}=await getTask();
 const list=(await pages()).filter(t=>t.type==='page'&&t.url?.split('?')[0]===project&&t.webSocketDebuggerUrl);
 if(list.length!==1)throw Error('Open exactly one clean Sashai project landing tab (found '+list.length+')');
 const tab=list[0];
 const clean=await evalTab(tab,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');return {path:location.pathname,aria:e?.getAttribute('aria-label'),draft:e?.innerText?.trim()||''}})()`);
 if(clean.path!==projectPath||clean.aria!=='New chat in dr/sashai'||clean.draft)throw Error('Sashai project composer not clean');
 const opened=await evalTab(tab,`(() => {const chosen=[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&(b.innerText||'').trim().startsWith('Remote Desktop Commander'));if(chosen)return true;const b=document.querySelector('button[aria-label="Add files and more"]');if(!b||!b.getClientRects().length)return false;b.click();return true})()`);
 if(!opened)throw Error('Could not open ChatGPT plugin picker');
 await pause(350);
 const selected=await evalTab(tab,`(() => {const b=[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length&&(b.innerText||'').trim().startsWith('Remote Desktop Commander'));if(b.length!==1)return false;b[0].click();return true})()`);
 if(!selected)throw Error('Remote Desktop Commander plugin is not uniquely available');
 await pause(350);
 const composed=await evalTab(tab,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');if(e?.getAttribute('aria-label')!=='New chat in dr/sashai'||e.innerText.trim()!=='Remote Desktop Commander')return {ok:false};e.focus();document.execCommand('insertText',false,${JSON.stringify(' '+prompt)});const v=e.innerText||'';return {ok:v.startsWith('Remote Desktop Commander')&&v.includes(${JSON.stringify(marker)})&&v.split(${JSON.stringify(marker)}).length===2,chars:v.length,sendEnabled:!!document.querySelector('button[aria-label="Send"]:not([disabled])')}})()`);
 if(!composed.ok||!composed.sendEnabled)throw Error('Composer mismatch; do not dispatch');
 const attempt={taskId:'sashai-architecture-report-2026-10-15',approval:'report-only',
  taskContractSha256:sha(task),promptSha256:sha(prompt),marker,
  head:expected,preflightStatusSha256:sha(git('status','--porcelain=v1','-z')),
  preflightDiffSha256:sha(git('diff','--binary')),destination:output,
  project,tabId:tab.id,createdAt:new Date().toISOString(),status:'prepared',
  nonce:randomUUID()};
 await writeFile(recordFile,JSON.stringify(attempt,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:'prepared_without_submission',taskId:attempt.taskId,tabId:tab.id,
   marker,head:expected,contractSha256:attempt.taskContractSha256,chars:composed.chars},null,2));
}else if(action==='send'){
 if(existsSync(sendGuard))throw Error('SEND ALREADY ATTEMPTED, NEVER RETRY');
 const a=JSON.parse(await readFile(recordFile,'utf8'));
 if(a.status!=='prepared'||a.approval!=='report-only'||a.project!==project)throw Error('Invalid attempt record');
 const {task,actual,prompt}=await getTask();
 if(actual!==a.head||sha(task)!==a.taskContractSha256||sha(prompt)!==a.promptSha256||
   sha(git('status','--porcelain=v1','-z'))!==a.preflightStatusSha256||
   sha(git('diff','--binary'))!==a.preflightDiffSha256)throw Error('Source/contract changed since prepare');
 const tab=(await pages()).find(t=>t.id===a.tabId&&t.url?.split('?')[0]===project&&t.webSocketDebuggerUrl);
 if(!tab)throw Error('Staged project tab is no longer clean');
 const ready=await evalTab(tab,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');const text=e?.innerText||'';return {project:location.pathname===${JSON.stringify(projectPath)},connector:text.startsWith('Remote Desktop Commander'),markerOnce:text.split(${JSON.stringify(marker)}).length===2,send:!!document.querySelector('button[aria-label="Send"]:not([disabled])')}})()`);
 if(!ready.project||!ready.connector||!ready.markerOnce||!ready.send)throw Error('Send preflight failed');
 // Persist BEFORE clicking. Any timeout after this point is indeterminate, never retry.
 await writeFile(sendGuard,JSON.stringify({at:new Date().toISOString(),tabId:a.tabId,
   marker:a.marker,promptSha256:a.promptSha256},null,2)+'\n',{flag:'wx',mode:0o600});
 const clicked=await evalTab(tab,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');if(!e?.innerText?.startsWith('Remote Desktop Commander')||!e.innerText.includes(${JSON.stringify(marker)})||location.pathname!==${JSON.stringify(projectPath)})return false;const b=document.querySelector('button[aria-label="Send"]:not([disabled])');if(!b)return false;b.click();return true})()`);
 console.log(JSON.stringify({status:clicked?'clicked_send_once':'indeterminate_no_retry',taskId:a.taskId,marker:a.marker},null,2));
}else if(action==='bind'){
 if(!existsSync(sendGuard))throw Error('Cannot bind chat before send claim');
 const a=JSON.parse(await readFile(recordFile,'utf8'));
 if(a.conversationUrl) {
  console.log(JSON.stringify({status:'already_bound',conversationUrl:a.conversationUrl,taskId:a.taskId}));
 } else {
  const tab=(await pages()).find(t=>t.id===a.tabId&&t.webSocketDebuggerUrl);
  if(!tab)throw Error('Original browser tab closed; cannot bind');
  const url=new URL(tab.url);
  if(url.origin!=='https://chatgpt.com' ||
     !new RegExp('^/g/g-p-6ab28bdd7fbc8191b581316ff09da79d(?:-[a-z0-9-]+)?/c/[0-9a-f-]{36}$','i').test(url.pathname))
   throw Error('Original tab is not a Sashai project conversation');
  const provenance=await evalTab(tab,`(() => {const main=document.querySelector('main')?.innerText||'';return {marker:main.includes(${JSON.stringify(a.marker)}),review:/Sashai architecture review|Review Sashai Architecture/i.test(document.title+' '+main),repository:main.includes('/Users/test/Documents/work/sashai'),head:main.includes(${JSON.stringify(a.head)})}})()`);
  // ChatGPT Work-style views may omit the initiating user turn entirely.
  // Require the same CDP target (above), one-time send claim, project URL,
  // review context, repository and exact source HEAD; record weaker evidence.
  if(!provenance.marker && !(provenance.review&&provenance.repository&&provenance.head))
   throw Error('No matching prompt marker or read-only repository/revision evidence; leave attempt unbound');
  a.bindingEvidence=provenance.marker?'exact_prompt_marker':'same_tab_project_and_revised_repository_evidence';
  a.conversationUrl=url.origin+url.pathname;
  a.conversationId=url.pathname.split('/c/')[1];
  a.status='submitted';
  a.boundAt=new Date().toISOString();
  await writeFile(recordFile,JSON.stringify(a,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({status:'bound_to_existing_chat',chatUrl:a.conversationUrl,
    taskId:a.taskId,marker:a.marker},null,2));
 }
}else if(action==='status'){
 const s=await status();
 console.log(JSON.stringify({taskId:s.attempt?.taskId||null,marker:s.attempt?.marker,
  sendAttempted:s.sent,tab:s.tab,outputExists:s.outputExists,head:s.attempt?.head},null,2));
}else throw Error('Usage: node scripts/sashai-report-dispatch.mjs prepare|send|status');
