import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePredecessorReadiness,readPredecessorRecords} from '../scripts/flowdeck-predecessor-readiness.mjs';
import {createHash} from 'node:crypto';

const projectUrl='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const chatUrl='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6ad0e53a-3544-83eb-a251-42d9266131a1';
const hash='a'.repeat(64);
function fixture() {
 const previous={projectId:'pilot',taskId:'A',workId:'work-A',tabId:'original',chatUrl};
 const project={id:'pilot',repo:'/fixture/worktree',projectUrl,tasks:[{id:'A'},{id:'B'}]};
 const record={binding:structuredClone(previous),ready:false,users:2,expectedPromptHash:hash,
  observation:{turn:'finished',decision:'implementation_done'}};
 const active=structuredClone(previous);
 const tab={id:'original',type:'page',url:chatUrl,webSocketDebuggerUrl:'ws://fixture'};
 const fresh={tabId:'original',chatUrl,turnState:'turn_finished',userTurns:2,
  lastAssistant:'Finished task A.\nFLOWDECK_STATUS: implementation_done',
  identity:{taskId:'A',worktree:'/fixture/worktree',projectUrl,latestUserTurns:2,
   originalUserHash:hash,latestUserHash:hash}};
 return {project,previous,record,active,tabs:[tab],fresh};
}
async function evaluate(f){
 let listed=0,inspected=0;
 const result=await evaluatePredecessorReadiness({project:f.project,previous:f.previous,
  record:f.record,active:f.active,readers:{
    listTabs:async()=>{listed++;return f.listFailure?Promise.reject(Error('CDP down')):f.tabs;},
    inspect:async()=>{inspected++;if(f.inspectFailure)throw Error('DOM gone');return f.fresh;}
  }});
 return {...result,listed,inspected};
}
test('exact predecessor identity with fresh sealed finished evidence is read-only',async()=>{
 const actual=await evaluate(fixture());
 assert.equal(actual.readyForPredecessor,true);
 assert.equal(actual.predecessorTabPresent,true);
 assert.equal(actual.predecessorEvidenceVerified,true);
 assert.equal(actual.writes,false);
 assert.equal(actual.inspected,1);
});
const failures=[
 ['original tab missing',f=>{f.tabs=[]},'original_predecessor_tab_missing',false],
 ['different target ID with same URL',f=>{f.tabs[0].id='replacement'},'original_predecessor_tab_missing',false],
 ['duplicate tab ID',f=>{f.tabs.push({...f.tabs[0]})},'predecessor_tab_ambiguous',false],
 ['mismatched conversation URL',f=>{f.tabs[0].url=chatUrl.replace('6ad0e53a','7ad0e53a')},'predecessor_tab_identity_mismatch',false],
 ['wrong CDP target type',f=>{f.tabs[0].type='other'},'predecessor_tab_identity_mismatch',false],
 ['target without debugger socket',f=>{delete f.tabs[0].webSocketDebuggerUrl},'predecessor_tab_identity_mismatch',false],
 ['active binding changed',f=>{f.active.workId='different'},'predecessor_binding_changed',false],
 ['recorded completion absent',f=>{f.record.observation.decision='unknown'},'predecessor_completion_record_unverified',false],
 ['recorded binding changed',f=>{f.record.binding.taskId='B'},'predecessor_binding_changed',false],
 ['fresh worktree mismatch',f=>{f.fresh.identity.worktree='/wrong'},'fresh_predecessor_completion_unverified',true],
 ['fresh task mismatch',f=>{f.fresh.identity.taskId='B'},'fresh_predecessor_completion_unverified',true],
 ['fresh project mismatch',f=>{f.fresh.identity.projectUrl='https://chatgpt.com/g/other/project'},'fresh_predecessor_completion_unverified',true],
 ['fresh running response',f=>{f.fresh.turnState='running'},'fresh_predecessor_completion_unverified',true],
 ['fresh completion marker absent',f=>{f.fresh.lastAssistant='Done'},'fresh_predecessor_completion_unverified',true],
 ['fresh user turn count changed',f=>{f.fresh.identity.latestUserTurns=3},'fresh_predecessor_completion_unverified',true],
 ['fresh user hash unavailable',f=>{f.fresh.identity.latestUserHash=null},'fresh_predecessor_completion_unverified',true],
 ['sealed prompt mismatch',f=>{f.record.expectedPromptHash='b'.repeat(64)},'fresh_predecessor_completion_unverified',true],
 ['missing sealed message proof',f=>{delete f.record.expectedPromptHash},'predecessor_message_unsealed',true],
 ['DOM inspection error',f=>{f.inspectFailure=true},'fresh_predecessor_completion_unverified',true],
 ['CDP enumeration error',f=>{f.listFailure=true},'predecessor_tab_inspection_unavailable',false],
 ['missing predecessor record',f=>{f.record=null},'predecessor_evidence_unavailable',false],
];
for(const [name,mutate,reason,present] of failures){
 test('readiness fails closed: '+name,async()=>{
  const f=fixture();mutate(f);
  const r=await evaluate(f);
  assert.equal(r.readyForPredecessor,false);
  assert.equal(r.predecessorEvidenceVerified,false);
  assert.equal(r.predecessorTabPresent,present);
  assert.deepEqual(r.blockers,[reason]);
  assert.equal(r.writes,false);
 });
}
test('read-only filesystem records accept injected JSON reader',async()=>{
 const f=fixture(), seen=[];
 const records=await readPredecessorRecords('/fixture',f.previous,async filename=>{
  seen.push(filename);return filename.includes('/binding-')?f.record:f.active;
 });
 assert.equal(seen.length,2);
 assert.deepEqual(records,{record:f.record,active:f.active});
});
