import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCompletedCloseout} from '../scripts/flowdeck-completed-closeout.mjs';

const scope={projectId:'fresh',ownerId:'owner',deviceId:'device',initialTaskId:'p1',
 workflowId:'flowdeck-supervisor-fresh'};
const runId='01a149a0-e652-796e-80c9-f8671efe0356';
function unstarted(){
 return {
  claim:{schema:'flowdeck.attempt-scope/v1',...scope,profile:'helium-profile-4',
   disposition:'unresolved_until_audited_reconciliation'},scope,runId,
  description:{workflowId:scope.workflowId,runId,type:'flowdeckSupervisor',status:{name:'COMPLETED'}},
  result:{projectId:scope.projectId,taskId:'p1',status:'paused',phase:'needs_attention',
   blocker:'No new work-session event within the bounded waiting period.',
   workId:null,lastEvent:null,chatUrl:null,tabId:null,
   pilotBudget:{usage:{p1Continuations:0,nextChatSubmissions:0,totalAutomatedSubmissions:0}}},
  events:[{workflowExecutionStartedEventAttributes:{}},
   {activityTaskScheduledEventAttributes:{activityType:{name:'loadSupervisorProject'}}},
   {activityTaskScheduledEventAttributes:{activityType:{name:'publishSupervisorState'}}},
   {timerStartedEventAttributes:{}},{timerFiredEventAttributes:{}},
   {workflowExecutionCompletedEventAttributes:{}}],
  journal:[{modifiedSinceClaim:false,referencesAttempt:false}],active:[],processes:[],sourceWorkSessionsSinceClaim:[]
 };
}
test('exact unstarted manual-start deadline with timer fired and zero signals may be closed',()=>{
 const p=assessCompletedCloseout(unstarted());
 assert.equal(p.ready,true,JSON.stringify(p.blockers));assert.equal(p.activityCount,2);
});
test('a signal, adoption, or any send activity blocks no-start closeout',()=>{
 for(const kind of ['signal','adoptStartedWork','sendContinuationOnce','startNextTaskOnce']){
  const p=unstarted();
  if(kind==='signal')p.events.splice(2,0,{workflowExecutionSignaledEventAttributes:{}});
  else p.events.splice(2,0,{activityTaskScheduledEventAttributes:{activityType:{name:kind}}});
  const result=assessCompletedCloseout(p);
  assert.equal(result.ready,false,kind);
 }
});
test('missing timer, alternate blocker or any previously seen chat/work evidence blocks',()=>{
 const baseline=unstarted();
 for(const mutate of [
  x=>x.events=x.events.filter(e=>!e.timerFiredEventAttributes),
  x=>x.result.blocker='Something else',
  x=>x.result.lastEvent={kind:'work_started'},
  x=>x.result.workId='known-work',
  x=>x.result.tabId='tab-one',
  x=>x.result.chatUrl='https://chatgpt.com/c/example'
 ]){
  const x=structuredClone(baseline);mutate(x);
  const r=assessCompletedCloseout(x);assert.equal(r.ready,false);
 }
});
test('source ledger work session blocks closeout even if follower sent zero signals',()=>{
 const x=unstarted();x.sourceWorkSessionsSinceClaim=[{workId:'session-1',state:'reported',outcome:'partial'}];
 const r=assessCompletedCloseout(x);
 assert.equal(r.ready,false);assert.ok(r.blockers.includes('source_work_sessions_not_reconciled'));
 assert.equal(assessCompletedCloseout({...unstarted(),sourceWorkSessionsSinceClaim:undefined}).ready,false);
});
test('never-started closeout still checks exact run, old claim and journal',()=>{
 for(const modify of [
  x=>x.description.runId='01b149a0-e652-796e-80c9-f8671efe0356',
  x=>x.claim.projectId='other',
  x=>x.journal=[{modifiedSinceClaim:true,referencesAttempt:false}],
  x=>x.active=[{workflowId:'other-flowdeck'}],
  x=>x.processes=['active-sender'],
  x=>x.result.pilotBudget.usage.totalAutomatedSubmissions=1
 ]){
  const x=unstarted();modify(x);
  assert.equal(assessCompletedCloseout(x).ready,false);
 }
});
