import test from 'node:test';
import {createHash} from 'node:crypto';
import {normalizeComposerText} from '../dist/sashai-dispatch-evidence.js';
import assert from 'node:assert/strict';
import {evaluateEmptySurface,emptySurfaceExpression,prepare} from '../scripts/flowdeck-prepare-manual-start.mjs';
import{createSupervisorProjectLoader}from'../dist/flowdeck-projects.js';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import{approvedFirstPromptHash,validatePreparedManualStart,inspectPreparedFirstMessage}from'../dist/flowdeck-manual-start.js';
const id='sashai-fresh-attended-20261018-06';
const ready={route:'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project',
 documentReadyState:'complete',mainPresent:true,mainLength:47,visibleComposerCount:1,
 composerDraftPresent:false,roleMessages:0,workMessageHeadings:0,oldTaskVisible:false,
 mainBusy:false,visibleDialog:false};
/** Generated sanitized enrollment; never reads the developer's .state directory. */
async function manualStartFixture(t){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'flowdeck-attended-fixture-')));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const p1='approved-fixture-p1-01',p2='approved-fixture-p2-01';
 const project={
  id,ownerId:'fixture-owner-01',deviceId:'fixture-device-01',
  repo:join(dir,'worktree'),projectUrl:ready.route,initialTaskId:p1,
  tasks:[{id:p1,title:'Approved First Task',instruction:'Implement only the fixture first task.'},
   {id:p2,title:'Approved Second Task',instruction:'Verify only the fixture second task.'}],
  attendedPilotBudget:{schema:'flowdeck.attended-pilot-budget/v1',initialTaskId:p1,nextTaskId:p2}
 };
 const location=join(dir,'.state','flowdeck-supervisor');
 await mkdir(location,{recursive:true});
 await writeFile(join(location,'projects.json'),JSON.stringify({projects:[project]}));
 const load=createSupervisorProjectLoader({base:dir,
  inspect:async()=>({status:'approved_plan_has_pending_tasks',
   tasks:project.tasks.map(x=>x.title)})});
 return {p:await load(id),load,base:dir,inspect:async()=>({occupied:true})};
}
test('Project preparation refuses loading, stale content, old tabs, hidden drafts and dialogs',()=>{
 assert.deepEqual(evaluateEmptySurface(ready,ready.route),{ready:true,reason:'verified_empty'});
 for(const [key,value,reason]of [
  ['documentReadyState','loading','not_hydrated'],['mainPresent',false,'not_hydrated'],
  ['visibleComposerCount',0,'not_hydrated'],['composerDraftPresent',true,'existing_draft'],
  ['roleMessages',1,'existing_or_stale_messages'],['workMessageHeadings',2,'existing_or_stale_messages'],
  ['oldTaskVisible',true,'existing_or_stale_messages'],
  ['route','https://chatgpt.com/g/other/project','wrong_project_route'],
  ['mainBusy',true,'page_not_idle'],['visibleDialog',true,'page_not_idle']
 ]){const s={...ready,[key]:value};assert.equal(evaluateEmptySurface(s,ready.route).reason,reason,key)}
 assert.match(emptySurfaceExpression(ready.route),/contenteditable/);
 assert.doesNotMatch(emptySurfaceExpression(ready.route),/\.click\(|\.focus\(|\.scrollTo\(|\.reload\(/);
});
test('read-only diagnostic creates a distinct tab but never writes authority, Send, or navigates an existing tab',async t=>{
 const {p,load,base,inspect}=await manualStartFixture(t);
 const baseline=[{type:'page',id:'PREVIOUS-TAB',url:'https://chatgpt.com/g/previous/c/xx',webSocketDebuggerUrl:'ws://test/previous'}];
 const newTab={type:'page',id:'ABCDEF1234567890ABCDEF1234567890',
  url:p.projectUrl,webSocketDebuggerUrl:'ws://test/new'};
 let created=0,observed=0,waited=0;
 const result=await prepare(p.id,{diagnose:true,load,base,inspect,
  pages:async()=>created?[...baseline,newTab]:baseline,
  create:async(method,args)=>{created++;assert.equal(method,'Target.createTarget');assert.deepEqual(args,{url:p.projectUrl,background:true});return{targetId:newTab.id}},
  evaluate:async tab=>{assert.equal(tab.id,newTab.id);observed++;return ready},
  wait:async()=>{waited++}
 });
 assert.equal(result.ready,true);assert.equal(result.prepared,false);
 assert.equal(result.browserSubmissions,0);assert.equal(result.writes,false);
 assert.equal(typeof result.originalScopeOccupied,'boolean');
 assert.equal(created,1);assert.ok(observed>=3);assert.ok(waited>=2);
});
test('initial prepared prompt is sealed to exact owner, task, worktree, target and first user turn',async fixtureTest=>{
 const {p}=await manualStartFixture(fixtureTest),t=p.tasks[0],target='ABCDEF1234567890ABCDEF1234567890';
 const rec={schema:'flowdeck.prepared-manual-start/v1',
  projectId:p.id,ownerId:p.ownerId,deviceId:p.deviceId,projectUrl:p.projectUrl,worktree:p.repo,
  taskId:t.id,tabId:target,originalTargetIds:['OLD-TAB'],hydratedEmpty:true,
  expectedPromptHash:approvedFirstPromptHash(t.instruction),readyAt:'2026-10-18T00:00:00Z'};
 assert.deepEqual(validatePreparedManualStart(p,t,rec),rec);
 for(const modify of [
  x=>x.tabId='OLD-TAB',x=>x.projectId='previous',x=>x.worktree='/wrong',
  x=>x.expectedPromptHash='0'.repeat(64),x=>x.hydratedEmpty=false,
  x=>x.originalTargetIds=['OLD-TAB','OLD-TAB']
 ]){const x=structuredClone(rec);modify(x);assert.throws(()=>validatePreparedManualStart(p,t,x))}
 const chat='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6ad37cb8-30b4-83ed-a88e-2acce9293ead';
 const evidence={tabId:target,chatUrl:chat,projectUrl:p.projectUrl,taskId:t.id,
  worktree:p.repo,userTurns:1,observedUserTurns:1,firstUserHash:rec.expectedPromptHash};
 assert.equal(inspectPreparedFirstMessage(rec,p,t,evidence),'matched');
 assert.equal(inspectPreparedFirstMessage(rec,p,t,{...evidence,taskId:null,firstUserHash:null}),'pending');
 for(const patch of [{tabId:'OTHER'},{taskId:'old-task'}, {worktree:'/wrong'},
  {userTurns:2},{observedUserTurns:2},{firstUserHash:'x'.repeat(64)},
  {projectUrl:'https://chatgpt.com/g/other/project'}]){
  assert.throws(()=>inspectPreparedFirstMessage(rec,p,t,{...evidence,...patch}),undefined,JSON.stringify(patch))}
});

test('show prepared tab activates only its exact verified target; never navigates, types or sends',async()=>{
 const{showPrepared}=await import('../scripts/flowdeck-prepare-manual-start.mjs');
 const calls=[];
 const r=await showPrepared('fresh',{
  load:async()=>({id:'fresh'}),
  verify:async p=>{assert.equal(p.id,'fresh');return{ready:true,tabId:'NEW-PREPARED-TAB'}},
  send:async(method,args)=>{calls.push({method,args});return{}}
 });
 assert.equal(r.ready,true);assert.equal(r.browserSubmissions,0);assert.equal(r.composerWrites,0);
 assert.deepEqual(calls,[{method:'Target.activateTarget',args:{targetId:'NEW-PREPARED-TAB'}}]);
});

test('initial P1 seal hashes the full literal Probe RemoteMCP2 composer payload and rejects altered prefixes',()=>{
 const hash=text=>createHash('sha256').update(normalizeComposerText(text)).digest('hex');
 const instruction='Task ID: example-p1\\nWorktree: /tmp/example\\nDo approved work.';
 const full='Probe RemoteMCP2 '+instruction;
 assert.equal(approvedFirstPromptHash(instruction),hash(full));
 assert.notEqual(approvedFirstPromptHash(instruction),hash(instruction),
   'bare instruction does not represent what ChatGPT displays after connector selection');
 assert.notEqual(approvedFirstPromptHash(instruction),hash('Other Connector '+instruction));
 assert.notEqual(approvedFirstPromptHash(instruction),hash('Probe RemoteMCP2 altered '+instruction));
});
