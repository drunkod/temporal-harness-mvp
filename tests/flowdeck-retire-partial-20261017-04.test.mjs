import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRetirementEvidence} from '../scripts/flowdeck-retire-partial-20261017-04.mjs';
const original={
 workflow:{status:'COMPLETED',runId:'01a149a0-e652-796e-80c9-f8671efe0356',workflowId:'flowdeck-supervisor-sashai-fresh-attended-20261017-04',phase:'needs_attention',businessStatus:'paused',blocker:'No new work-session event within the bounded waiting period.',taskId:'sashai-fresh-attended-p1-20261017-04',workId:null,lastEvent:null,chatUrl:null,tabId:null,p1Sends:0,p2Sends:0,totalSends:0},
 history:{completed:true,timerFired:true,signals:0,activityKinds:['loadSupervisorProject','publishSupervisorState']},
 claim:{projectId:'sashai-fresh-attended-20261017-04',workflowId:'flowdeck-supervisor-sashai-fresh-attended-20261017-04',disposition:'unresolved_until_audited_reconciliation'},
 source:{totalSessions:1,workId:'5f2adbcc-60e4-4c55-b471-0242d5aea064',state:'reported',outcome:'partial',beginTaskMatch:true,beginWorktreeMatch:true,finishWorktreeMatch:true,startedAfterClaim:true,endedBeforeWorkflowClose:true},
 checkpoint:{sha256:'0faf3840c4d5329c6804893513bfd9c841cb4b67d17061a5928daf599d8789af',contentsCorrect:true,p2Absent:true},
 chat:{tabId:'333B7B9508008C3E80180DF0B0C60C5A',chatUrl:'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6ad35f55-104c-83ed-93e9-ddf4e8e70c98',taskMatch:true,worktreeMatch:true,projectMatch:true,userTurns:1,originalTaskPresent:true},
 journal:{total:21,touched:0,referencesAttempt:0},running:{temporal:0,processes:0}
};
test('verified exact P1 partial can be archived with no automatic send',()=>assert.equal(evaluateRetirementEvidence(original).ready,true));
test('changed or incomplete evidence refuses',()=>{
 const overrides=[
  ['workflow','status','RUNNING'],['workflow','totalSends',1],['workflow','workId','already adopted'],
  ['workflow','runId','different'],['history','timerFired',false],['history','signals',1],
  ['source','totalSessions',2],['source','outcome','success'],['source','beginTaskMatch',false],
  ['source','finishWorktreeMatch',false],['checkpoint','contentsCorrect',false],
  ['checkpoint','p2Absent',false],['chat','userTurns',2],['chat','taskMatch',false],
  ['chat','projectMatch',false],['journal','touched',1],['running','processes',1]
 ];
 for(const [group,k,value] of overrides){
  const v=structuredClone(original);v[group][k]=value;
  assert.equal(evaluateRetirementEvidence(v).ready,false,group+'.'+k);
 }
 const v=structuredClone(original);v.history.activityKinds.push('startNextTaskOnce');
 assert.equal(evaluateRetirementEvidence(v).ready,false);
});
