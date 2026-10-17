import test from 'node:test';
import assert from 'node:assert/strict';
import {initialPilotSendUsage,reservePilotSend,validatePilotProject} from '../dist/flowdeck-pilot-budget.js';

const policy={schema:'flowdeck.attended-pilot-budget/v1',initialTaskId:'P1',nextTaskId:'P2'};
const cont={kind:'continue',taskId:'P1'};
const next={kind:'next',previousTaskId:'P1',taskId:'P2'};
const reserve=(usage,request,p=policy)=>reservePilotSend(p,usage,request);
const initial=()=>initialPilotSendUsage();
test('one P1 continuation then P2 sends exactly two reservations',()=>{
 const first=reserve(initial(),cont);
 assert.equal(first.allowed,true);
 const second=reserve(first.usage,next);
 assert.equal(second.allowed,true);
 assert.deepEqual(second.usage,{p1Continuations:1,nextChatSubmissions:1,totalAutomatedSubmissions:2});
 assert.equal(reserve(second.usage,next).allowed,false);
 assert.equal(reserve(second.usage,cont).allowed,false);
});
test('optional zero-continuation path can start P2 without spending unused allowance',()=>{
 const send=reserve(initial(),next);
 assert.equal(send.allowed,true);
 assert.deepEqual(send.usage,{p1Continuations:0,nextChatSubmissions:1,totalAutomatedSubmissions:1});
});
test('repeat P1 continuation is prohibited and reservations cannot be refunded by a failure',()=>{
 const first=reserve(initial(),cont);
 const repeat=reserve(first.usage,cont);
 assert.deepEqual(repeat,{allowed:false,reason:'p1_continuation_budget_exhausted'});
 assert.deepEqual(first.usage,{p1Continuations:1,nextChatSubmissions:0,totalAutomatedSubmissions:1});
});
test('P2 continuation and third-task/reversed next submission never reserve',()=>{
 for(const request of [
  {kind:'continue',taskId:'P2'},
  {kind:'continue',taskId:'P3'},
  {kind:'next',previousTaskId:'P2',taskId:'P1'},
  {kind:'next',previousTaskId:'P1',taskId:'P3'},
 ]){
  const result=reserve(initial(),request);
  assert.equal(result.allowed,false);
 }
});
test('cannot continue P1 after advancing to P2',()=>{
 const p2=reserve(initial(),next);
 assert.deepEqual(reserve(p2.usage,cont),{allowed:false,reason:'pilot_already_advanced'});
 assert.deepEqual(reserve(p2.usage,next),{allowed:false,reason:'next_chat_budget_exhausted'});
});
test('invalid or inconsistent usage and malformed policies never grant reservations',()=>{
 for(const bad of [
  {...initial(),p1Continuations:-1}, {...initial(),p1Continuations:1},
  {...initial(),p1Continuations:2,totalAutomatedSubmissions:2},
  {...initial(),nextChatSubmissions:2,totalAutomatedSubmissions:2},
  {...initial(),totalAutomatedSubmissions:NaN}, {...initial(),totalAutomatedSubmissions:1.5},
  {...initial(),totalAutomatedSubmissions:3}
 ])assert.deepEqual(reserve(bad,cont),{allowed:false,reason:'invalid_pilot_usage'});
 for(const malformed of [
  null,{}, {...policy,schema:'unknown'}, {...policy,nextTaskId:'P1'},
  {...policy,nextTaskId:''},{...policy,surprise:1}
 ])assert.deepEqual(reserve(initial(),cont,malformed),{allowed:false,reason:'invalid_pilot_policy'});
});
test('typed project policy verifies exact two-task order and independent tasks',()=>{
 const project={id:'fresh',initialTaskId:'P1',
  tasks:[{id:'P1',requiresReviewBeforeNext:false},{id:'P2',requiresReviewBeforeNext:false}],
  attendedPilotBudget:policy};
 assert.equal(validatePilotProject(project),true);
 assert.equal(validatePilotProject({...project,attendedPilotBudget:undefined}),false);
 for(const change of [
  {tasks:[...project.tasks,{id:'P3'}]},
  {initialTaskId:'P2'},
  {tasks:[project.tasks[1],project.tasks[0]]},
  {tasks:[project.tasks[0],{...project.tasks[1],dependsOn:['P1']}]},
  {tasks:[{...project.tasks[0],requiresReviewBeforeNext:true},project.tasks[1]]},
  {attendedPilotBudget:{...policy,nextTaskId:'P3'}}
 ])assert.throws(()=>validatePilotProject({...project,...change}),/Invalid bounded attended pilot/);
});

test('production project loader refuses fresh ID with missing/partial budget before task authority inspection',async t=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {createSupervisorProjectLoader}=await import('../dist/flowdeck-projects.js');
 const base=await mkdtemp(join(tmpdir(),'flowdeck-project-budget-'));
 t.after(()=>rm(base,{recursive:true,force:true}));
 await mkdir(join(base,'.state/flowdeck-supervisor'),{recursive:true});
 const project={id:'sashai-fresh-attended-test',ownerId:'owner',deviceId:'device',repo:'/fixture',
  projectUrl:'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project',
  initialTaskId:'P1',tasks:[
   {id:'P1',title:'P1 title',instruction:'P1 instructions'},
   {id:'P2',title:'P2 title',instruction:'P2 instructions'}]};
 const source=join(base,'.state/flowdeck-supervisor/projects.json');
 const inspect=async()=>({status:'approved_plan_has_pending_tasks',tasks:['P1 title','P2 title']});
 const load=createSupervisorProjectLoader({base,inspect});
 for(const bad of [undefined,null,{}, {...policy,nextTaskId:'P3'}]){
  await writeFile(source,JSON.stringify({projects:[{...project,attendedPilotBudget:bad}]}));
  await assert.rejects(load(project.id),/hard send budget|bounded attended pilot/i);
 }
 await writeFile(source,JSON.stringify({projects:[{...project,attendedPilotBudget:policy}]}));
 const loaded=await load(project.id);
 assert.deepEqual(loaded.attendedPilotBudget,policy);
 assert.deepEqual(loaded.tasks,project.tasks);
});
