import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256} from '../dist/flowdeck-autonomy-policy.js';
import {collectAutonomousCloseoutEvidence,archiveCollectedAutonomousSuccess} from '../dist/flowdeck-autonomy-evidence.js';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'flowdeck-independent-closeout-')); t.after(()=>rm(dir,{recursive:true,force:true}));
 const data={claim:'machine owner claim',a:'approved artifact A',b:'approved artifact B'};
 for(const [k,v] of Object.entries(data))await writeFile(join(dir,k),v);
 const manifest={schema:'flowdeck.autonomy-closeout-manifest/v1',workflowId:'flowdeck-autonomous-fixture',runId:'run-fixture-001',projectId:'project-fixture',campaignId:'campaign-fixture',policyDigest:sha256('policy'),
  terminalResult:{status:'completed',businessResult:'successfully_reconciled'},
  reservations:['initial_p1','continue_p1','initial_p2'].map((kind,i)=>({kind,id:`reservation-${i}`})),
  sessions:[0,1,2].map(i=>({workId:`work-${i}`,taskId:i<2?'task-p1':'task-p2'})),
  journals:[0,1,2].map(i=>({dispatchId:`dispatch-${i}`,promptHash:sha256(`prompt-${i}`),tabId:i<2?'tab-p1':'tab-p2',chatUrl:i<2?'https://example.test/chat/p1':'https://example.test/chat/p2'})),
  artifacts:['a','b'].map(k=>({path:join(dir,k),sha256:sha256(data[k])})),ownerClaimPath:join(dir,'claim'),ownerClaimSha256:sha256(data.claim),
  paths:Object.fromEntries(['claim','intent','archive','receipt','lock'].map(k=>[k,join(dir,k)]))};
 const raw={temporal:{workflowId:manifest.workflowId,runId:manifest.runId,status:'completed',businessResult:'successfully_reconciled'},
  campaign:{projectId:manifest.projectId,campaignId:manifest.campaignId,policyDigest:manifest.policyDigest},
  reservations:manifest.reservations.map(x=>({...x,state:'spent',runId:manifest.runId,campaignId:manifest.campaignId,projectId:manifest.projectId})),sessions:manifest.sessions.map((x,i)=>({...x,state:'reported',outcome:i===0?'partial':'success'})),
  events:manifest.sessions.flatMap(x=>['work_started','work_reported'].map(kind=>({workId:x.workId,kind,delivery:'delivered'}))),
  journals:manifest.journals.map(x=>({...x,state:'reconciled',reconciled:true,durable:true,runId:manifest.runId,campaignId:manifest.campaignId,projectId:manifest.projectId})),senderCount:0};
 const sources=Object.fromEntries(Object.keys(raw).filter(k=>k!=='events').map(k=>[k,async()=>structuredClone(raw[k])]));
 sources.events=async()=>structuredClone(raw.events); return {dir,manifest,raw,sources};
}
const exists=async p=>{try{await stat(p);return true}catch(e){if(e.code==='ENOENT')return false;throw e}};
test('collects raw independent facts and derives deterministic receipt evidence',async t=>{
 const x=await fixture(t),a=await collectAutonomousCloseoutEvidence(x.manifest,x.sources),b=await collectAutonomousCloseoutEvidence(x.manifest,x.sources);
 assert.deepEqual(a,b);assert.equal(a.terminalSuccess,true);assert.equal(a.allEventsDelivered,true);
});
test('does not accept boolean claimant evidence; rejects changed receipt, wrong run, missing session/event, journal, artifact, sender',async t=>{
 const x=await fixture(t); await assert.rejects(collectAutonomousCloseoutEvidence(x.manifest,{...x.sources,temporal:async()=>({workflowId:x.manifest.workflowId,runId:'wrong',status:'completed',businessResult:'successfully_reconciled'})}),/terminal workflow/);
 for(const [mutate,pattern] of [
  [()=>x.raw.sessions.pop(),/session mismatch/], [()=>{x.raw.events.pop();x.raw.sessions=x.manifest.sessions.map((y,i)=>({...y,state:'reported',outcome:i===0?'partial':'success'}))},/event set/],
  [()=>{x.raw.journals[0].promptHash='wrong'},/journal/], [()=>{x.raw.senderCount=1},/active sender/]
 ]){mutate();await assert.rejects(collectAutonomousCloseoutEvidence(x.manifest,x.sources),pattern);const fresh=await fixture(t);x.raw.sessions=fresh.raw.sessions;x.raw.events=fresh.raw.events;x.raw.journals=fresh.raw.journals;x.raw.senderCount=0;}
 await writeFile(x.manifest.artifacts[0].path,'changed');await assert.rejects(collectAutonomousCloseoutEvidence(x.manifest,x.sources),/artifact changed/);
 const altered={...x.manifest,ownerClaimSha256:sha256('fabricated')};await assert.rejects(collectAutonomousCloseoutEvidence(altered,x.sources),/owner claim changed/);
});
test('rejects colluding manifest and observed journals with incorrect tab/chat routing and preserves claim',async t=>{
 const x=await fixture(t);
 for(const change of [j=>{j[1].tabId='wrong-tab'},j=>{j[1].chatUrl='https://wrong.test/chat'},j=>{j[2].tabId=j[0].tabId},j=>{j[2].chatUrl=j[0].chatUrl}]){
  const journals=structuredClone(x.manifest.journals);change(journals);x.manifest.journals=journals;x.raw.journals=journals.map(y=>({...y,state:'reconciled',reconciled:true,durable:true,runId:x.manifest.runId,campaignId:x.manifest.campaignId,projectId:x.manifest.projectId}));
  await assert.rejects(collectAutonomousCloseoutEvidence(x.manifest,x.sources),/tab\/chat independence/);
  assert.equal(await readFile(x.manifest.ownerClaimPath,'utf8'),'machine owner claim');
 }
});
test('archive path revalidates independent sources under lock and recovers crashes after intent or archive',async t=>{
 for(const phase of ['intent','archive']){
  const x=await fixture(t),archiveClaim=await readFile(x.manifest.paths.claim);
  await assert.rejects(archiveCollectedAutonomousSuccess(x.manifest,x.sources,{afterPhase:async p=>{if(p===phase)throw Error('crash')}}),/crash/);
  assert.equal(await exists(x.manifest.paths.receipt),false);
  if(phase==='intent')assert.equal(await exists(x.manifest.paths.claim),true);else assert.deepEqual(await readFile(x.manifest.paths.archive),archiveClaim);
  assert.deepEqual(await archiveCollectedAutonomousSuccess(x.manifest,x.sources,{resume:true}),{state:'retired',recovered:true});
  assert.equal(await exists(x.manifest.paths.receipt),true);
 }
 const x=await fixture(t);await archiveCollectedAutonomousSuccess(x.manifest,x.sources);
 await writeFile(x.manifest.paths.receipt,'{}');
 await assert.rejects(archiveCollectedAutonomousSuccess(x.manifest,x.sources,{resume:true}),/another run/);
});
