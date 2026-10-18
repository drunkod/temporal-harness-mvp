import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSentCloseout} from '../scripts/flowdeck-sent-attempt-closeout-20261017-05.mjs';
const good=()=>({
 scopeValid:true,
 terminal:{exact:true,paused:true,budgetExact:true,p1ReviewPending:true,p2HistoricallyUnstarted:true},
 history:{closed:true,activityCount:112,unresolved:0,unknown:0,
  p1SentActivities:1,p2SentActivities:1,recoveryActivities:0,
  failedReconciliations:1,failedReconciliationReason:true},
 journals:{dispatches:2,p1Reconciled:true,p2SubmittedNotReconciled:true,fullSealsMatch:true,
  noExtraAttemptDispatches:true,noExtraAttemptSendClaims:true},
 source:{count:3,workIdsExact:true,outcomesExact:true,taskAndWorktreeMatch:true,withinAttemptWindow:true},
 inbox:{exactSix:true,p1Delivered:true,p2TargetClosed:true},
 browser:{bothExactTabs:true,taskAndWorktreeMatch:true,userCountsMatch:true,sealedPromptsMatch:true,distinctChats:true},
 outputs:{bothHashesMatch:true,contentsTaskMatched:true},
 operations:{runningWorkflows:0,localSenders:0},
});
test('exact reconciled two-send terminal attempt can be archived without changing history',()=>{
 assert.deepEqual(assessSentCloseout(good()),{ready:true,blockers:[]});
});
test('the sent case rejects every altered evidence field independently',()=>{
 const categories={
  terminal:['exact','paused','budgetExact','p1ReviewPending','p2HistoricallyUnstarted'],
  history:['closed','activityCount','unresolved','unknown','p1SentActivities','p2SentActivities',
    'recoveryActivities','failedReconciliations','failedReconciliationReason'],
  journals:['dispatches','p1Reconciled','p2SubmittedNotReconciled','fullSealsMatch',
    'noExtraAttemptDispatches','noExtraAttemptSendClaims'],
  source:['count','workIdsExact','outcomesExact','taskAndWorktreeMatch','withinAttemptWindow'],
  inbox:['exactSix','p1Delivered','p2TargetClosed'],
  browser:['bothExactTabs','taskAndWorktreeMatch','userCountsMatch','sealedPromptsMatch','distinctChats'],
  outputs:['bothHashesMatch','contentsTaskMatched'],
  operations:['runningWorkflows','localSenders'],
 };
 for(const [family,fields] of Object.entries(categories)){
  for(const field of fields){
   const e=good(),v=e[family][field];
   e[family][field]=typeof v==='boolean'?!v:v+1;
   if(v===0)e[family][field]=1;
   if(field==='activityCount')e[family][field]=0;
   if(field==='dispatches'||field==='count')e[family][field]=v+1;
   const a=assessSentCloseout(e);
   assert.equal(a.ready,false,family+'.'+field);
   assert.ok(a.blockers.length>0,family+'.'+field);
  }
 }
 const e=good();e.scopeValid=false;
 assert.equal(assessSentCloseout(e).ready,false);
});
test('missing evidence never qualifies',()=>{
 for(const family of ['terminal','history','journals','source','inbox','browser','outputs','operations']){
  const x=good();delete x[family];
  const r=assessSentCloseout(x);assert.equal(r.ready,false,family);
 }
 assert.equal(assessSentCloseout(undefined).ready,false);
});
test('explicit duplicate send and unknown activity scenarios refuse',()=>{
 for(const change of [
  e=>e.history.p1SentActivities=2,
  e=>e.history.p2SentActivities=2,
  e=>e.history.recoveryActivities=1,
  e=>e.history.unresolved=1,
  e=>e.history.unknown=1,
  e=>e.journals.noExtraAttemptSendClaims=false,
  e=>e.journals.noExtraAttemptDispatches=false,
  e=>e.journals.p2SubmittedNotReconciled=false,
  e=>e.inbox.p2TargetClosed=false,
  e=>e.browser.sealedPromptsMatch=false,
  e=>e.operations.localSenders=1,
  e=>e.operations.runningWorkflows=1,
 ]){const e=good();change(e);assert.equal(assessSentCloseout(e).ready,false)}
});
