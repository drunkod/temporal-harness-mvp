import test from 'node:test';
import assert from 'node:assert/strict';
import{assessPromptSealP1Closeout}from'../scripts/flowdeck-retire-prompt-seal-20261018-07.mjs';

const good=()=>({
 claimValid:true,
 workflow:{closed:true,exact:true,paused:true,taskIsInitial:true,zeroBudget:true,tasksApproved:true},
 history:{closed:true,eventCount:313,signals:2,activities:29,load:1,publish:3,
  adoptCompleted:24,adoptFailures:1,adoptMessageMatches:true,sendActivities:0,unknownOrPending:0},
 source:{count:1,id:'d703be6c-0766-45f3-ad3e-cc2d2549e62c',reportedPartial:true,
  taskAndWorktreeMatch:true,timeMatch:true},
 inbox:{twoEvents:true,startedDelivered:true,reportedDelivered:true},
 artifact:{p1Hash:'814370c71dd5a2b8b7bede1752d48b17930936501e5f79ea25d8fa475d2baf7c',
  correctCheckpoint:true,p2Absent:true},
 browser:{exactTabAndChat:true,newProjectConversation:true,archivedIncidentMatches:true,
  historicalSealMismatch:true,correctedSealMatchesFirstMessage:true,firstUserIdentityMatches:true},
 journals:{newSenderRecords:0,changedSinceClaim:0},
 running:{workflows:0,senderProcesses:0}
});
test('exact historical partial P1 with connector-prefix sealing mismatch may be retired',()=>{
 assert.deepEqual(assessPromptSealP1Closeout(good()),{ready:true,blockers:[]});
});
test('every independent evidence dimension fails closed before release',()=>{
 const changes=[
  ['claimValid',null,false],
  ['workflow','closed',false],['workflow','exact',false],['workflow','paused',false],
  ['workflow','taskIsInitial',false],['workflow','zeroBudget',false],['workflow','tasksApproved',false],
  ['history','closed',false],['history','eventCount',312],['history','signals',1],
  ['history','activities',30],['history','load',0],['history','publish',4],
  ['history','adoptCompleted',23],['history','adoptFailures',2],
  ['history','adoptMessageMatches',false],['history','sendActivities',1],
  ['history','unknownOrPending',1],
  ['source','count',2],['source','id','foreign-work'],['source','reportedPartial',false],
  ['source','taskAndWorktreeMatch',false],['source','timeMatch',false],
  ['inbox','twoEvents',false],['inbox','startedDelivered',false],['inbox','reportedDelivered',false],
  ['artifact','p1Hash','altered'],['artifact','correctCheckpoint',false],['artifact','p2Absent',false],
  ['browser','exactTabAndChat',false],['browser','newProjectConversation',false],
  ['browser','archivedIncidentMatches',false],['browser','historicalSealMismatch',false],
  ['browser','correctedSealMatchesFirstMessage',false],['browser','firstUserIdentityMatches',false],
  ['journals','newSenderRecords',1],['journals','changedSinceClaim',1],
  ['running','workflows',1],['running','senderProcesses',1]
 ];
 for(const [family,key,value]of changes){
  const e=good();if(key===null)e[family]=value;else e[family][key]=value;
  const out=assessPromptSealP1Closeout(e);
  assert.equal(out.ready,false,family+'.'+key);
  assert.ok(out.blockers.length>0,family+'.'+key);
 }
});
test('incomplete evidence fails closed',()=>{
 for(const family of Object.keys(good())){
  const e=good();delete e[family];assert.equal(assessPromptSealP1Closeout(e).ready,false,family);
 }
 assert.equal(assessPromptSealP1Closeout(null).ready,false);
});
