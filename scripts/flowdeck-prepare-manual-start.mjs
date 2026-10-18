#!/usr/bin/env node
/** New-tab-only, no-Send attended initial P1 preparation.
 * 'diagnose' may create one disposable tab when a previous claim is occupied,
 * but NEVER writes a preparation record. 'prepare' requires a FREE owner scope.
 * The browser operation is Target.createTarget ONLY, never a navigation of an existing tab.
 */
import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {loadSupervisorProject} from '../dist/flowdeck-projects.js';
import {manualStartPath,approvedFirstPromptHash,validatePreparedManualStart,readPreparedManualStart} from '../dist/flowdeck-manual-start.js';
import {inspectAttemptScope} from './flowdeck-attempt-scope.mjs';
import {browserPages,browserEvaluate} from '../dist/sashai-live-browser.js';
const root=resolve(import.meta.dirname,'..');
const refuse=(condition,reason)=>{if(!condition)throw Error('Manual-start preparation refused: '+reason)};
const safeProject=url=>{try{const u=new URL(url);return u.origin==='https://chatgpt.com'&&
 /^\/g\/g-p-6ab28bdd7fbc8191b581316ff09da79d(?:-dr-sashai)?\/project\/?$/.test(u.pathname)}catch{return false}};
export function emptySurfaceExpression(projectUrl){
 return `(()=>{const m=document.querySelector('main');const visible=e=>Boolean(e?.getClientRects?.().length);
 const editors=[...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
 const heads=[...(m?.querySelectorAll('h4.sr-only')||[])].map(n=>(n.textContent||'').trim());
 const roles=[...(m?.querySelectorAll('[data-message-author-role]')||[])];
 const text=(m?.innerText||'');
 const route=location.origin+location.pathname;
 const drafts=editors.map(n=>(n.innerText||n.textContent||'').trim());
 // Project overview contains historic chat titles/previews; those are not
 // transcript messages. Inspect only actual role/Work message containers.
 const messageBodies=[...document.querySelectorAll('[data-message-author-role]'),
   ...[...(m?.querySelectorAll('[class]')||[])].filter(n=>String(n.className||'').split(/\\s+/).includes('group/user-message'))];
 return {route,documentReadyState:document.readyState,mainPresent:visible(m),
  mainLength:text.length,visibleComposerCount:editors.length,
  composerDraftPresent:drafts.some(s=>s.length>0),
  roleMessages:roles.filter(n=>['user','assistant'].includes(n.getAttribute('data-message-author-role'))).length,
  workMessageHeadings:heads.filter(s=>s==='You said:'||s==='ChatGPT said:').length,
  oldTaskVisible:messageBodies.some(n=>/sashai-fresh-attended-p[12]-\\d{8}-\\d{2}|Task ID\\s*:/i.test(n.innerText||n.textContent||'')),
  mainBusy:Boolean(m?.querySelector('[aria-busy="true"]')),
  visibleDialog:Boolean([...document.querySelectorAll('[role="dialog"]')].some(visible))}})()`;
}
export function evaluateEmptySurface(sample,expectedProjectUrl){
 if(!sample||typeof sample!=='object')return {ready:false,reason:'unreadable'};
 let routeValid=false;try{routeValid=safeProject(sample.route)&&
   new URL(sample.route).pathname.replace(/-dr-sashai(?=\/project)/,'')===
   new URL(expectedProjectUrl).pathname}catch{}
 if(!routeValid)return {ready:false,reason:'wrong_project_route'};
 if(sample.documentReadyState!=='complete'||!sample.mainPresent||
    sample.mainLength<10||sample.visibleComposerCount<1)
  return {ready:false,reason:'not_hydrated'};
 if(sample.visibleDialog||sample.mainBusy)return {ready:false,reason:'page_not_idle'};
 if(sample.composerDraftPresent)return {ready:false,reason:'existing_draft'};
 if(sample.roleMessages!==0||sample.workMessageHeadings!==0||sample.oldTaskVisible)
  return {ready:false,reason:'existing_or_stale_messages'};
 return {ready:true,reason:'verified_empty'};
}
async function sendBrowserCommand(method,params){
 const v=await fetch('http://127.0.0.1:9222/json/version',{signal:AbortSignal.timeout(5000)});
 refuse(v.ok,'CDP unavailable');
 const j=await v.json();refuse(typeof j.webSocketDebuggerUrl==='string','browser endpoint unavailable');
 const ws=new WebSocket(j.webSocketDebuggerUrl);
 return await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{ws.close();reject(Error('CDP command timed out'))},7000);
  ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method,params})));
  ws.addEventListener('message',e=>{const r=JSON.parse(String(e.data));if(r.id!==1)return;
   clearTimeout(timeout);ws.close();if(r.error)reject(Error('Browser target creation refused'));
   else resolve(r.result)});
  ws.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Browser command socket error'))});
 });
}
export async function prepare(projectId,{diagnose=false,pages=browserPages,evaluate=browserEvaluate,
 create=sendBrowserCommand,wait=delay,load=loadSupervisorProject,
 inspect=inspectAttemptScope,base=root}={}){
 const p=await load(projectId);
 refuse(/^sashai-fresh-attended-[0-9]{8}-[0-9]{2}$/.test(p.id),'not an attended pilot');
 refuse(p.tasks.length===2&&p.initialTaskId===p.tasks[0].id,'task enrollment changed');
 const scope=await inspect(base,p);
 if(!diagnose)refuse(!scope.occupied,'owner scope claimed; reconcile previous run first');
 const path=manualStartPath(base,p.id);
 if(!diagnose){
  try{await readFile(path);throw Error('Manual-start record already exists; do not open another tab')}
  catch(e){if(e.code!=='ENOENT')throw e}
 }
 const original=(await pages()).filter(t=>t.type==='page');
 const baselineIds=original.map(t=>t.id);
 refuse(baselineIds.length>0&&new Set(baselineIds).size===baselineIds.length,'baseline tabs unavailable');
 const response=await create('Target.createTarget',{url:p.projectUrl,background:true});
 const id=response?.targetId;
 refuse(typeof id==='string'&&id.length>12&&!baselineIds.includes(id),'fresh target ID not unique');
 let current=null,observations=[],result={ready:false,reason:'not_hydrated'};
 for(let n=0;n<20;n++){
  const found=(await pages()).filter(t=>t.id===id);
  if(found.length===1&&found[0].type==='page'&&found[0].webSocketDebuggerUrl&&safeProject(found[0].url)){
   current=found[0];
   try{const state=await evaluate(current,emptySurfaceExpression(p.projectUrl));
    result=evaluateEmptySurface(state,p.projectUrl);
    observations.push({state,result});
    if(result.reason==='existing_draft'||result.reason==='existing_or_stale_messages')break;
    if(result.ready&&observations.slice(-3).length===3&&observations.slice(-3).every(s=>s.result.ready))break;
   }catch{result={ready:false,reason:'page_unreadable'}}
  }else if(found.length>1||found[0]&&found[0].url.startsWith('https://')&&!safeProject(found[0].url)){
   result={ready:false,reason:'target_left_project'};break;
  }
  await wait(400);
 }
 const diagnostic={projectId:p.id,mode:diagnose?'diagnose':'prepare',targetId:id,
  baselineTabCount:baselineIds.length,uniqueTab:!baselineIds.includes(id),
  observations:observations.length,lastReason:result.reason,
  ready:result.ready,writes:false,browserSubmissions:0,
  originalScopeOccupied:scope.occupied};
 if(!result.ready)return diagnostic;
 if(diagnose)return {...diagnostic,prepared:false};
 // Revalidate after observation, before durable authority record.
 refuse(!(await inspect(base,p)).occupied,'scope changed during readiness');
 const matches=(await pages()).filter(t=>t.id===id);
 refuse(matches.length===1&&matches[0].url===current?.url,'target changed after readiness');
 const last=await evaluate(matches[0],emptySurfaceExpression(p.projectUrl));
 refuse(evaluateEmptySurface(last,p.projectUrl).ready,'surface changed before write');
 const record={schema:'flowdeck.prepared-manual-start/v1',projectId:p.id,ownerId:p.ownerId,
  deviceId:p.deviceId,projectUrl:p.projectUrl,worktree:p.repo,taskId:p.initialTaskId,
  tabId:id,originalTargetIds:baselineIds,hydratedEmpty:true,
  expectedPromptHash:approvedFirstPromptHash(p.tasks[0].instruction),
  readyAt:new Date().toISOString()};
 validatePreparedManualStart(p,p.tasks[0],record);
 const f=await open(path,'wx',0o600);
 try{await f.writeFile(JSON.stringify(record,null,2)+'\n');await f.sync()}finally{await f.close()}
 return {...diagnostic,prepared:true,writes:true,recordPath:path};
}
/** Read-only recheck before opening the timed workflow or copying the manual P1. */
export async function verifyPreparedSurface(project,{pages=browserPages,evaluate=browserEvaluate}={}){
 const rec=await readPreparedManualStart(root,project,project.tasks[0]);
 const match=(await pages()).filter(t=>t.id===rec.tabId);
 refuse(match.length===1&&match[0].type==='page'&&
  match[0].url===project.projectUrl&&match[0].webSocketDebuggerUrl,
  'prepared tab no longer shows the exact empty Project route');
 const sample=await evaluate(match[0],emptySurfaceExpression(project.projectUrl));
 const verdict=evaluateEmptySurface(sample,project.projectUrl);
 refuse(verdict.ready,'prepared tab not still empty: '+verdict.reason);
 return {projectId:project.id,tabId:rec.tabId,ready:true,expectedPromptHash:rec.expectedPromptHash};
}
/** Only foregrounds the exact prepared empty tab; never changes its route or composer. */
export async function showPrepared(projectId,{send=sendBrowserCommand,load=loadSupervisorProject,verify=verifyPreparedSurface}={}){
 const project=await load(projectId);
 const state=await verify(project);
 const result=await send('Target.activateTarget',{targetId:state.tabId});
 refuse(result!==null,'browser refused to activate prepared tab');
 return {projectId,tabId:state.tabId,ready:true,verifiedEmpty:true,activated:true,
  browserSubmissions:0,composerWrites:0};
}
export async function main(args=process.argv.slice(2)){
 if(args.length!==2||!['prepare','diagnose','show'].includes(args[0]))throw Error('Usage: node scripts/flowdeck-prepare-manual-start.mjs prepare|diagnose|show PROJECT_ID');
 const result=args[0]==='show'
  ?await showPrepared(args[1])
  :await prepare(args[1],{diagnose:args[0]==='diagnose'});
 console.log(JSON.stringify(result,null,2));
 if(!result.ready)process.exitCode=2;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(e=>{console.error(String(e.message||e));process.exitCode=3});
