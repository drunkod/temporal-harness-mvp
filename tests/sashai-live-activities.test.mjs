import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,appendFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createLiveReportActivities} from '../dist/sashai-live-report-activities.js';
import {PROJECT} from '../dist/sashai-live-browser.js';

const head='7d2cc6818afe837119e0c171928506b1c4967269';
const task='sashai-task-routing-report-live-v1';
const chat='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6acfe3ee-ad30-83eb-b92e-fa069ac9ee6e';
const sha=x=>createHash('sha256').update(x).digest('hex');
const paths=['AGENTS.md','.ai/harness/policy.json','.ai/harness/active-plan','.ai/harness/active-worktree','tasks/current.md','tasks/todos.md'];
const index='\n\n## Evidence Index\n'+paths.map(p=>'- '+p+' — inspected source supports the routing findings described above.').join('\n')+'\n';
function report(a){return '# Sashai task-routing report\n'+head+'\n'+task+'\n'+a.attemptId+'\n'+a.marker+'\n'+
 '## Routing Facts\nActive plan marker: absent\nActive worktree marker: absent\nCurrent execution authority: active plan Task Breakdown\nCurrent snapshot role: derived\nTODO role: deferred\nImplementation task selected: no\n'+
 paths.map(p=>'- '+p+'\n').join('')+'## Validation and Limits\nSource inspection was read-only; builds were not run. Current snapshots are derived and to-dos deferred. No approved implementation task is selected. This is structural report acceptance, not complete semantic proof.\n';}
async function fixture() {
 const base=await mkdtemp(join(tmpdir(),'sashai-live-adapter-')),repo=join(base,'source');
 const folder=join(base,'.state','sashai-live-temporal-report');
 const output=join(base,'docs','SASHAI-BROWSER-TASK-ROUTING-REVIEW-2026-10-15.md');
 await mkdir(join(base,'docs'),{recursive:true});
 await mkdir(join(repo,'.ai/harness'),{recursive:true});
 await mkdir(join(repo,'tasks'),{recursive:true});
 for(const p of ['AGENTS.md','.ai/harness/policy.json','tasks/current.md','tasks/todos.md'])await writeFile(join(repo,p),'Fixture source '+p+'\n');
 const contract='Approval: APPROVED, report-only\nScope: ONE initial\nTask ID: `'+task+'`\nExpected Sashai HEAD at approval: `'+head+'`\nAuthorized connector-created output ONLY: `'+output+'`\n';
 const contractPath=join(base,'docs','SASHAI-LIVE-TEMPORAL-REPORT-TASK.md');await writeFile(contractPath,contract);
 const state={created:0,staged:0,clicked:0,prompt:'',lastPrompt:'',fingerprint:'a'.repeat(64),
  calls:[],onStage:null,onClick:null,cancelled:false,turnId:'initial-user',wrongPrompt:false};
 const tab={id:'owned-tab',type:'page',url:PROJECT,webSocketDebuggerUrl:'mock://owned'};
 const browser={
  async createOwnedProjectTab(){state.created++;return tab;},
  async requireTab(id,url){assert.equal(id,tab.id);assert.equal(url,state.clicked?chat:PROJECT);return tab;},
  async stage(t,url,prompt){state.staged++;state.prompt=prompt;if(state.onStage)await state.onStage();},
  async matches(){return !state.wrongPrompt;},
  async click(t,url,prompt,deadline){
   assert.ok(deadline>Date.now());assert.equal(prompt,state.prompt);state.clicked++;
   state.lastPrompt=prompt;state.turnId=state.clicked===1?'initial-user':'correction-user';
   if(state.onClick)return await state.onClick();
   const a=JSON.parse(await readFile(join(folder,'attempt.json'),'utf8'));
   if(state.clicked===1)await writeFile(output,report(a),{flag:'wx'});else await appendFile(output,index);
   state.calls=[{id:'call-'+state.clicked,connector:'Remote Desktop Commander',operation:state.clicked===1?'write_file':'edit_block',path:output,completed:true}];
   return true;
  },
  async chat(){return state.clicked?{url:chat,id:'conversation-id'}:null;},
  async evidence(id,url,marker,path,prompt){
   assert.equal(id,tab.id);assert.equal(url,chat);assert.equal(path,output);
   const matched=prompt===state.lastPrompt;
   return {tool:matched&&state.calls.length>0,reply:matched,marker:matched&&state.lastPrompt.includes(marker),source:true,
    calls:matched?state.calls:[],turnId:matched?state.turnId:null,promptMatched:matched,turnState:matched?'turn_finished':'unknown'};
  },
 };
 const snapshot=async()=>({version:2,head,statusSha256:'1'.repeat(64),unstagedDiffSha256:'2'.repeat(64),
  stagedDiffSha256:'3'.repeat(64),dirtyFileContentSha256:'4'.repeat(64),dirtyFileCount:0,fingerprintSha256:state.fingerprint});
 const api=createLiveReportActivities({base,repo,browser,snapshot,checkDispatch:()=>{if(state.cancelled)throw Error('cancelled');}});
 return {base,repo,folder,output,contractPath,contractHash:sha(contract),api,state,
  async close(){await rm(base,{recursive:true,force:true});}};
}
const has=async path=>stat(path).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e});
async function started(f){const a=await f.api.prepareLiveAttempt(f.contractHash);const sent=await f.api.submitLiveOnce(a);
 const claims={initial:sent.claimSha256};return {a,claims};}

test('fresh isolated live adapter lifecycle verifies, corrects once in same chat and seals acceptance',async()=>{
 const f=await fixture();try{
  const a=await f.api.prepareLiveAttempt(f.contractHash);
  assert.equal((await f.api.prepareLiveAttempt(f.contractHash)).attemptId,a.attemptId);assert.equal(f.state.created,1);
  const sent=await f.api.submitLiveOnce(a),claims={initial:sent.claimSha256};
  await assert.rejects(f.api.prepareLiveAttempt(f.contractHash),/reconciliation required/);
  assert.equal((await f.api.observeLive(a,claims)).stable,false);
  assert.equal((await f.api.observeLive(a,claims)).stable,true);
  const failed=await f.api.verifyLiveReport(a,claims);
  assert.deepEqual(failed.missing,['evidence_index_missing']);assert.equal(failed.observedConnector,true);
  const original=await readFile(f.output);
  const corrected=await f.api.correctLiveOnce(a,failed,claims);claims.correction=corrected.claimSha256;
  assert.equal((await f.api.observeLive(a,claims)).stable,false);
  assert.equal((await f.api.observeLive(a,claims)).stable,true);
  const accepted=await f.api.verifyLiveReport(a,claims);assert.equal(accepted.accepted,true);
  assert.equal(accepted.initialArtifactSha256,sha(original));assert.equal(accepted.chat,chat);
  assert.ok((await readFile(f.output)).subarray(0,original.length).equals(original));
  await f.api.recordLiveAcceptance(a,accepted,claims);
  const seal=JSON.parse(await readFile(join(f.folder,'acceptance.json'),'utf8'));
  assert.equal(seal.nextTaskPermitted,false);assert.equal(seal.dispatchPermitted,false);
  assert.equal(f.state.clicked,2);
  await assert.rejects(f.api.submitLiveOnce(a),/already claimed|artifact exists/);
  await assert.rejects(f.api.correctLiveOnce(a,failed,claims),/Incorrect initial|already claimed/);
 }finally{await f.close();}
});

for(const change of ['source','contract','attempt','draft','cancel'])test('post-staging '+change+' drift prevents initial claim and click',async()=>{
 const f=await fixture();try{
  const a=await f.api.prepareLiveAttempt(f.contractHash);
  f.state.onStage=async()=>{
   if(change==='source')f.state.fingerprint='b'.repeat(64);
   if(change==='contract')await appendFile(f.contractPath,'Changed');
   if(change==='attempt'){const other={...a,tabId:'other'};await writeFile(join(f.folder,'attempt.json'),JSON.stringify(other));}
   if(change==='draft')f.state.wrongPrompt=true;
   if(change==='cancel')f.state.cancelled=true;
  };
  await assert.rejects(f.api.submitLiveOnce(a));
  assert.equal(f.state.clicked,0);assert.equal(await has(join(f.folder,'SEND_ATTEMPTED')),false);
 }finally{await f.close();}
});

test('timeout after actual fake click seals initial claim and cannot replay',async()=>{
 const f=await fixture();try{
  const a=await f.api.prepareLiveAttempt(f.contractHash);
  f.state.onClick=async()=>{throw Error('simulated lost response');};
  await assert.rejects(f.api.submitLiveOnce(a),/lost response/);
  const result=await f.api.reconcileLiveSend(a,'initial');assert.equal(result.claimed,true);assert.equal(result.claimMatched,true);
  await assert.rejects(f.api.submitLiveOnce(a),/already claimed/);
  assert.equal(f.state.clicked,1);
 }finally{await f.close();}
});

test('changed claim cannot be accepted during observation or verification',async()=>{
 const f=await fixture();try{
  const {a,claims}=await started(f);
  const path=join(f.folder,'SEND_ATTEMPTED');const j=JSON.parse(await readFile(path,'utf8'));j.at='changed';await writeFile(path,JSON.stringify(j));
  await assert.rejects(f.api.observeLive(a,claims),/claim identity/);
  await assert.rejects(f.api.verifyLiveReport(a,claims),/claim identity/);
 }finally{await f.close();}
});

test('selected connector without a completed tool call cannot enable correction',async()=>{
 const f=await fixture();try{
  const {a,claims}=await started(f);f.state.calls=[];
  const failed=await f.api.verifyLiveReport(a,claims);assert.equal(failed.observedConnector,false);
  assert.ok(failed.missing.includes('connector_invocation_unconfirmed'));
  await assert.rejects(f.api.correctLiveOnce(a,failed,claims),/exact approved failure/);
  assert.equal(f.state.clicked,1);
 }finally{await f.close();}
});

test('different submitted user prompt cannot establish initial conversation binding',async()=>{
 const f=await fixture();try{
  const {a,claims}=await started(f);f.state.lastPrompt='Unrelated conversation instruction';
  assert.equal((await f.api.observeLive(a,claims)).chat,null);
  assert.equal(await has(join(f.folder,'conversation.json')),false);
  await assert.rejects(f.api.verifyLiveReport(a,claims),/No bound/);
 }finally{await f.close();}
});

test('incorrect source-fact conclusions block the controlled correction gate',async()=>{
 const f=await fixture();try{
  const {a,claims}=await started(f);
  await writeFile(f.output,(await readFile(f.output,'utf8')).replace('Active plan marker: absent','Active plan marker: present'));
  const failed=await f.api.verifyLiveReport(a,claims);
  assert.ok(failed.missing.includes('routing_facts_missing_or_incorrect'));
  await assert.rejects(f.api.correctLiveOnce(a,failed,claims),/exact approved failure/);
 }finally{await f.close();}
});

test('correction rejects original-byte edits and stale claim replacement',async()=>{
 const f=await fixture();try{
  const {a,claims}=await started(f),failed=await f.api.verifyLiveReport(a,claims);
  const sent=await f.api.correctLiveOnce(a,failed,claims);claims.correction=sent.claimSha256;
  await writeFile(f.output,(await readFile(f.output,'utf8')).replace('# Sashai','# Changed Sashai'));
  const rejected=await f.api.verifyLiveReport(a,claims);
  assert.ok(rejected.missing.includes('original_report_not_preserved'));
  await assert.rejects(f.api.recordLiveAcceptance(a,rejected,claims));
  const path=join(f.folder,'CORRECTION_ATTEMPTED');const j=JSON.parse(await readFile(path,'utf8'));j.priorCallIds=[];j.at='changed';await writeFile(path,JSON.stringify(j));
  await assert.rejects(f.api.observeLive(a,claims),/claim identity/);
 }finally{await f.close();}
});

test('correction cannot replace the original submitted-turn binding',async()=>{
 const f=await fixture();try{
  const {a,claims}=await started(f),failed=await f.api.verifyLiveReport(a,claims);
  const sent=await f.api.correctLiveOnce(a,failed,claims);claims.correction=sent.claimSha256;
  const path=join(f.folder,'conversation.json');
  const binding=JSON.parse(await readFile(path,'utf8'));
  await writeFile(path,JSON.stringify({...binding,turnId:'unrelated-original-turn'}));
  await assert.rejects(f.api.observeLive(a,claims),/original turn changed/);
  await assert.rejects(f.api.verifyLiveReport(a,claims),/original turn changed/);
 }finally{await f.close();}
});

test('malformed UTF-8 report is rejected rather than normalized into acceptance',async()=>{
 const f=await fixture();try{
  const {a,claims}=await started(f);
  await appendFile(f.output,Buffer.from([0xff]));
  await assert.rejects(f.api.verifyLiveReport(a,claims));
 }finally{await f.close();}
});

test('failed preparation remains sealed and does not open another target',async()=>{
 const f=await fixture();try{
  f.state.cancelled=true;
  await assert.rejects(f.api.prepareLiveAttempt(f.contractHash),/cancelled/);
  f.state.cancelled=false;
  await assert.rejects(f.api.prepareLiveAttempt(f.contractHash),e=>e.code==='EEXIST');
  assert.equal(f.state.created,0);
 }finally{await f.close();}
});
