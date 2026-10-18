import test from 'node:test';
import assert from 'node:assert/strict';
import{assessConflictedP1Closeout}from'../scripts/flowdeck-retire-conflicted-p1-20261018-06.mjs';
const good=()=>({
 claimValid:true,workflow:{closed:true,exact:true,paused:true,taskIsInitial:true,zeroBudget:true,tasksApproved:true},
 history:{closed:true,eventCount:39,signals:1,activities:4,load:1,publish:2,
  adoptFailures:1,adoptMessageMatches:true,sendActivities:0,unknownOrPending:0},
 source:{count:1,id:'572524a7-fb93-45e0-a6c5-8fb6da1288b0',reportedPartial:true,taskAndWorktreeMatch:true,timeMatch:true},
 inbox:{twoEvents:true,startedDelivered:true,reportedTargetClosed:true},
 artifact:{p1Hash:'fe345af6e9a9db2d17ae8c7cbf22168dcb9b3e916c448f3f211393e798b79ddc',
 correctCheckpoint:true,p2Absent:true},
 browser:{exactTabAndChat:true,newProjectConversation:true,archivedConflictReportMatches:true},
 journals:{newSenderRecords:0,changedSinceClaim:0},running:{workflows:0,senderProcesses:0}
});
test('exact conflicted partial can be operationally retired without rewriting history',()=>{
 assert.deepEqual(assessConflictedP1Closeout(good()),{ready:true,blockers:[]});
});
test('every independently checked evidence category refuses if changed',()=>{
 const mutations=[
  ['claimValid',null,false],
  ['workflow','closed',false],['workflow','exact',false],['workflow','paused',false],
  ['workflow','taskIsInitial',false],['workflow','zeroBudget',false],['workflow','tasksApproved',false],
  ['history','closed',false],['history','eventCount',40],['history','signals',2],
  ['history','activities',5],['history','load',0],['history','publish',1],
  ['history','adoptFailures',2],['history','adoptMessageMatches',false],
  ['history','sendActivities',1],['history','unknownOrPending',1],
  ['source','count',2],['source','id','different'],['source','reportedPartial',false],
  ['source','taskAndWorktreeMatch',false],['source','timeMatch',false],
  ['inbox','twoEvents',false],['inbox','startedDelivered',false],
  ['inbox','reportedTargetClosed',false],
  ['artifact','p1Hash','changed'],['artifact','correctCheckpoint',false],['artifact','p2Absent',false],
  ['browser','exactTabAndChat',false],['browser','newProjectConversation',false],
  ['browser','archivedConflictReportMatches',false],
  ['journals','newSenderRecords',1],['journals','changedSinceClaim',1],
  ['running','workflows',1],['running','senderProcesses',1],
 ];
 for(const [family,key,v]of mutations){
  const x=good();
  if(key===null)x[family]=v;else x[family][key]=v;
  const out=assessConflictedP1Closeout(x);
  assert.equal(out.ready,false,family+'.'+key);
  assert.ok(out.blockers.length);
 }
});
test('missing evidence fails closed',()=>{
 for(const family of Object.keys(good())){const x=good();delete x[family];
  assert.equal(assessConflictedP1Closeout(x).ready,false,family)}
 assert.equal(assessConflictedP1Closeout(null).ready,false);
});
