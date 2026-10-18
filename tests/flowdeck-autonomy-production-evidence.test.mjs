import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256} from '../dist/flowdeck-autonomy-policy.js';
import {initialDispatchKey} from '../dist/flowdeck-autonomy-initial-send.js';
import {composerPayloadFor} from '../dist/sashai-dispatch-evidence.js';
import {createAutonomySendProvenanceStore,autonomousSendPromptHash} from '../dist/flowdeck-autonomy-send-provenance.js';
import {autonomyPolicyDigest} from '../dist/flowdeck-autonomy-policy.js';
import {createProductionEvidenceSources,createFilesystemEvidenceReaders} from '../dist/flowdeck-autonomy-production-evidence.js';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'flowdeck-prod-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const p='a'.repeat(64),paths=Object.fromEntries(['claim','intent','archive','receipt','lock'].map(k=>[k,join(root,k)]));
 const manifest={schema:'flowdeck.autonomy-closeout-manifest/v1',workflowId:'auto-workflow-01',runId:'auto-run-0001',projectId:'sashai-autonomous-fixture-01',campaignId:'campaign-fixture-001',campaignRunId:'campaign-run-0001',policyDigest:p,
  terminalResult:{status:'completed',businessResult:'successfully_reconciled'},reservations:['initial_p1','continue_p1','initial_p2'].map((kind,i)=>({kind,id:`reservation-${i}`})),
  sessions:[0,1,2].map(i=>({workId:`work-${i}`,taskId:i<2?'fixture-p1':'fixture-p2'})),journals:[0,1,2].map(i=>({dispatchId:`dispatch-${i}`,promptHash:sha256(`prompt-${i}`),tabId:`TABIDENTITY000000000${i<2?0:2}`,chatUrl:`https://chatgpt.com/g/p/c/${i<2?0:2}`})),
  artifacts:[{path:join(root,'artifact-a'),sha256:sha256('A')},{path:join(root,'artifact-b'),sha256:sha256('B')}],ownerClaimPath:join(root,'claim'),ownerClaimSha256:sha256('claim'),paths,
  ownerId:'fixture-owner-001',deviceId:'fixture-device-001',taskIds:['fixture-p1','fixture-p2'],policyPath:join(root,'policy.json'),inboxDirectory:join(root,'inbox'),autonomyRoot:join(root,'autonomy'),supervisorRoot:join(root,'supervisor')};
 await writeFile(manifest.policyPath,'{}');await writeFile(manifest.artifacts[0].path,'A');await writeFile(manifest.artifacts[1].path,'B');await writeFile(manifest.ownerClaimPath,'claim');
 const temporal={describe:async(workflowId,runId)=>({status:'COMPLETED',runId}),result:async()=>({status:'completed',reason:'successfully_reconciled',submissions:3}),list:async()=>[{workflowId:manifest.workflowId,runId:manifest.runId,status:'COMPLETED'}]};
 const sourceReports=new Map();
 const readers=createFilesystemEvidenceReaders(temporal,async()=>[],{readExact:async q=>sourceReports.get(q.workId)??null});return{root,manifest,readers,sourceReports};
}
test('Temporal evidence binds describe, result, and list to the exact completed execution',async t=>{
 const x=await fixture(t),s=createProductionEvidenceSources(x.manifest,x.readers);
 assert.deepEqual(await s.temporal(),{workflowId:x.manifest.workflowId,runId:x.manifest.runId,status:'completed',businessResult:'successfully_reconciled'});
 const bad={...x.readers,temporal:{...x.readers.temporal,describe:async()=>({status:'FAILED',runId:x.manifest.runId})}};
 await assert.rejects(createProductionEvidenceSources(x.manifest,bad).temporal(),/not terminal completed/);
 const wrong={...x.readers,temporal:{...x.readers.temporal,describe:async()=>({status:'COMPLETED',runId:'another-run'})}};
 await assert.rejects(createProductionEvidenceSources(x.manifest,wrong).temporal(),/run mismatch/);
 const uncertain={...x.readers,temporal:{...x.readers.temporal,result:async()=>({status:'completed',reason:'successfully_reconciled',submissions:2})}};
 await assert.rejects(createProductionEvidenceSources(x.manifest,uncertain).temporal(),/business result/);
});
test('missing inbox and initial journal fail closed with explicit source reasons',async t=>{
 const x=await fixture(t),s=createProductionEvidenceSources(x.manifest,x.readers);
 await assert.rejects(s.events(),/ENOENT/);
 await assert.rejects(s.journals(),/initial P1 journal missing/);
});
test('strict manifest rejects unknown fields and noncanonical paths',async t=>{
 const x=await fixture(t);
 assert.throws(()=>createProductionEvidenceSources({...x.manifest,acceptUncertain:true},x.readers),/unknown or missing fields/);
 assert.throws(()=>createProductionEvidenceSources({...x.manifest,policyPath:x.root+'/../policy.json'},x.readers),/canonical/);
});
test('wrong policy fails before campaign claims can be accepted',async t=>{
 const x=await fixture(t),s=createProductionEvidenceSources(x.manifest,x.readers);
 await assert.rejects(s.campaign(),/blocked_policy/);
});
test('an active sender process is uncertain and blocks closeout',async t=>{
 const x=await fixture(t),r={...x.readers,processes:async()=>[{pid:77,command:'node flowdeck-autonomy-sender'}]};
 await assert.rejects(createProductionEvidenceSources(x.manifest,r).senderCount(),/sender process remains active/);
});
test('legacy subsequent send journal without exact execution provenance is rejected',async t=>{
 const x=await fixture(t),m=x.manifest;
 const initialScope={campaignId:m.campaignId,runId:m.runId,projectId:m.projectId,taskId:m.sessions[0].taskId,
  tabId:m.journals[0].tabId,chatUrl:m.journals[0].chatUrl,projectUrl:'https://chatgpt.com/g/p/project',worktree:'/tmp/work',promptHash:m.journals[0].promptHash,policyDigest:m.policyDigest};
 const dir=join(m.autonomyRoot,'initial-dispatches');await mkdir(dir,{recursive:true});
 const key=initialDispatchKey(initialScope),prompt='initial-p1-fixture';
 initialScope.promptHash=sha256(composerPayloadFor(prompt));
 m.journals[0].promptHash=initialScope.promptHash;
 m.journals[0].dispatchId=key;
 await writeFile(join(dir,key+'-reconciled.json'),JSON.stringify({schema:'flowdeck.autonomous-dispatch/v1',phase:'reconciled',scope:initialScope}));
 await mkdir(join(m.autonomyRoot,'initial-observations'),{recursive:true});
 await mkdir(join(m.autonomyRoot,'initial-prompts'),{recursive:true});
 await writeFile(join(m.autonomyRoot,'initial-observations',sha256(JSON.stringify([initialScope.campaignId,initialScope.runId,initialScope.taskId]))+'.json'),JSON.stringify({schema:'flowdeck.initial-observation/v1',scope:initialScope,chatUrl:initialScope.chatUrl,turnId:'sealed-turn-1',userPromptHash:initialScope.promptHash}));
 await writeFile(join(m.autonomyRoot,'initial-prompts',key+'.json'),JSON.stringify({schema:'flowdeck.initial-prompt/v1',scope:initialScope,prompt}));
 await mkdir(join(m.supervisorRoot,'send-recovery'),{recursive:true});
 await writeFile(join(m.supervisorRoot,'send-recovery','dispatch-dispatch-1-05-reconciled.json'),JSON.stringify({dispatchId:'dispatch-1',projectId:m.projectId,taskId:m.sessions[1].taskId,phase:'reconciled'}));
 await assert.rejects(createProductionEvidenceSources(m,x.readers).journals(),/ENOENT|send provenance|send intent absent/);
});

test('production collector joins subsequent sends only through verified provenance and manifest expectations',async t=>{
 const x=await fixture(t),m=x.manifest,projectUrl='https://chatgpt.com/g/g-p-fixture/project';
 const now=Date.now();const policy={schema:'flowdeck.autonomy-policy/v1',mode:'automatic-initial-send',interactive:false,environment:'synthetic',profile:'helium-profile-4',taskSource:'approved-active-plan',
  projectId:m.projectId,projectUrl,ownerId:m.ownerId,deviceId:m.deviceId,worktree:'/tmp/work',allowedRoot:'/tmp',planSha256:'1'.repeat(64),enabledTaskIds:m.taskIds,
  instructionHashes:['2'.repeat(64),'3'.repeat(64)],campaignId:m.campaignId,validFrom:new Date(now-1000).toISOString(),validUntil:new Date(now+3600000).toISOString(),
  maxTasksPerRun:2,maxContinuationsPerTask:1,p2Continuations:0,maxSubmissionsPerRun:3,maxCampaignRuns:2,maxCampaignSubmissions:6,maxRunDurationMinutes:60,
  automaticSuccessfulCloseout:true,uncertainSend:'quarantine',identityConflict:'quarantine',reviewRequiredBeforeDependentTask:true};
 m.policyDigest=autonomyPolicyDigest(policy);await writeFile(m.policyPath,JSON.stringify(policy));
 m.journals.forEach((j,i)=>{j.chatUrl=`https://chatgpt.com/g/g-p-fixture/c/chat-${i}`;j.tabId=`TABIDENTITY000000000${i}`;});
 // Continuation P1 stays in P1's original conversation; P2 is distinct.
 m.journals[1].chatUrl=m.journals[0].chatUrl;
 m.journals[1].tabId=m.journals[0].tabId;
 const initialScope={campaignId:m.campaignId,runId:m.runId,projectId:m.projectId,taskId:m.sessions[0].taskId,tabId:m.journals[0].tabId,chatUrl:m.journals[0].chatUrl,
  projectUrl,worktree:'/tmp/work',promptHash:autonomousSendPromptHash('initial p1'),policyDigest:m.policyDigest};
 const dir=join(m.autonomyRoot,'initial-dispatches');await mkdir(dir,{recursive:true});const key=initialDispatchKey(initialScope);
 m.journals[0].dispatchId=key;m.journals[0].promptHash=initialScope.promptHash;
 await writeFile(join(dir,key+'-reconciled.json'),JSON.stringify({schema:'flowdeck.autonomous-dispatch/v1',phase:'reconciled',scope:initialScope}));
 await mkdir(join(m.autonomyRoot,'initial-observations'),{recursive:true});await mkdir(join(m.autonomyRoot,'initial-prompts'),{recursive:true});
 await writeFile(join(m.autonomyRoot,'initial-observations',sha256(JSON.stringify([initialScope.campaignId,initialScope.runId,initialScope.taskId]))+'.json'),JSON.stringify({schema:'flowdeck.initial-observation/v1',scope:initialScope,chatUrl:initialScope.chatUrl,turnId:'turn-initial',userPromptHash:initialScope.promptHash}));
 await writeFile(join(m.autonomyRoot,'initial-prompts',key+'.json'),JSON.stringify({schema:'flowdeck.initial-prompt/v1',scope:initialScope,prompt:'initial p1'}));
 const store=createAutonomySendProvenanceStore(join(m.autonomyRoot,'send-provenance'));
 for(const i of [1,2]){
  const kind=i===1?'continue_p1':'initial_p2',dispatchId=m.journals[i].dispatchId,prompt=`prompt-${i}`;
  const priorChatUrl=i===1?m.journals[0].chatUrl:null,priorUserTurns=i===1?1:0;
  const intent={schema:'flowdeck.send-intent/v1',dispatchId,workflowId:m.workflowId,runId:m.runId,campaignId:m.campaignId,campaignRunId:m.campaignRunId,
   projectId:m.projectId,taskId:m.sessions[i].taskId,kind,policyDigest:m.policyDigest,reservationId:m.reservations[i].id,promptHash:autonomousSendPromptHash(prompt),
   tabId:m.journals[i].tabId,projectUrl,priorChatUrl,priorUserTurns};
  await store.putIntent(intent);await store.recordPhase(dispatchId,'staged');await store.recordPhase(dispatchId,'click_attempted');
  const intentBytes=await (await import('node:fs/promises')).readFile(join(store.root,dispatchId+'.intent.json'));
  await store.putObservation({schema:'flowdeck.send-observation/v1',dispatchId,intentSha256:sha256(intentBytes),observedPromptHash:intent.promptHash,tabId:intent.tabId,
   chatUrl:m.journals[i].chatUrl,userTurnId:`turn-${i}`,observedUserTurns:priorUserTurns+1});
  await store.recordPhase(dispatchId,'submitted');await store.reconcile(dispatchId);m.journals[i].promptHash=intent.promptHash;
 }
 const journals=await createProductionEvidenceSources(m,x.readers).journals();
 assert.deepEqual(journals.map(j=>j.dispatchId),m.journals.map(j=>j.dispatchId));
  const p2Tab=m.journals[2].tabId;m.journals[2].tabId=m.journals[1].tabId;
  await assert.rejects(createProductionEvidenceSources(m,x.readers).journals(),/distinct Project tab and chat|journal provenance seal mismatch/);m.journals[2].tabId=p2Tab;
  const continuedTab=m.journals[1].tabId;m.journals[1].tabId='TABIDENTITY0000000009';
  await assert.rejects(createProductionEvidenceSources(m,x.readers).journals(),/continuation changed its tab or chat|journal provenance seal mismatch/);m.journals[1].tabId=continuedTab;
 const p2Chat=m.journals[2].chatUrl;m.journals[2].chatUrl=m.journals[1].chatUrl;
 await assert.rejects(createProductionEvidenceSources(m,x.readers).journals(),/P2 did not use a distinct Project chat|journal provenance seal mismatch/);m.journals[2].chatUrl=p2Chat;
 const provenance=join(store.root,m.journals[1].dispatchId+'.intent.json');const changed=JSON.parse(await readFile(provenance));changed.campaignRunId='other-campaign-run';await writeFile(provenance,JSON.stringify(changed)+'\n');
 await assert.rejects(createProductionEvidenceSources(m,x.readers).journals(),/phase linkage|receipt hash linkage/);
});

test('session closeout compares inbox events with an independent upstream work-report ledger',async t=>{
 const x=await fixture(t),m=x.manifest;await mkdir(m.supervisorRoot,{recursive:true});await mkdir(m.inboxDirectory,{recursive:true});
 const events={};
 for(const [i,s] of m.sessions.entries()){
  await writeFile(join(m.supervisorRoot,`binding-${sha256(JSON.stringify([m.projectId,s.workId]))}.json`),JSON.stringify({binding:{projectId:m.projectId,workId:s.workId,taskId:s.taskId}}));
  const startedAt=new Date(1000+i*10000).toISOString(),reportedAt=new Date(2000+i*10000).toISOString();
  const base={schema:'remote-mcp.work-event/v1',source:'remote-mcp-jazz',workId:s.workId,ownerId:m.ownerId,deviceId:m.deviceId,startedAt,timestampEvidence:'recorded_in_source_transaction',executionVerified:false,backgroundProcesses:'unknown',origin:'event'};
  const start={...base,eventId:`start-${i}`,kind:'work_started',revision:1,sourceCommittedAt:startedAt,completionEvidence:'none'};
  const report={...base,eventId:`report-${i}`,kind:'work_reported',revision:2,sourceCommittedAt:reportedAt,reportedAt,completionEvidence:'agent_report_only',outcome:i===0?'partial':'success'};
  for(const event of [start,report])events[JSON.stringify([event.source,event.ownerId,event.deviceId,event.eventId])]={event,delivery:'delivered'};
  x.sourceReports.set(s.workId,{workId:s.workId,ownerId:m.ownerId,deviceId:m.deviceId,state:'reported',outcome:report.outcome,startedAt,reportedAt,eventIds:{started:start.eventId,reported:report.eventId}});
 }
 await writeFile(join(m.inboxDirectory,'inbox.json'),JSON.stringify({schema:'flowdeck.work-inbox/v1',ownerId:m.ownerId,deviceId:m.deviceId,events,snapshots:{}}));
 assert.deepEqual((await createProductionEvidenceSources(m,x.readers).sessions()).map(s=>s.outcome),['partial','success','success']);
 const original=x.sourceReports.get('work-1');
  for(const mutate of [r=>({...r,eventIds:{...r.eventIds,reported:'wrong-event'}}),r=>({...r,eventIds:{...r.eventIds,started:'wrong-event'}})]){
   x.sourceReports.set('work-1',mutate(original));await assert.rejects(createProductionEvidenceSources(m,x.readers).sessions(),/upstream source work report differs/);
  }
  const inboxPath=join(m.inboxDirectory,'inbox.json'),inbox=JSON.parse(await readFile(inboxPath));
  for(const mutate of [e=>({...e,eventId:'wrong-event'}),e=>({...e,revision:3}),e=>({...e,kind:'work_started'})]){
   const copy=structuredClone(inbox);const record=Object.values(copy.events).find(v=>v.event.workId==='work-1'&&v.event.kind==='work_reported');record.event=mutate(record.event);await writeFile(inboxPath,JSON.stringify(copy));await assert.rejects(createProductionEvidenceSources(m,x.readers).sessions(),/session lacks exact source inbox work\/session report|upstream source work report differs/);
  }
  await writeFile(inboxPath,JSON.stringify(inbox));
  x.sourceReports.set('work-1',{...original,state:'running',outcome:null,reportedAt:null});
 await assert.rejects(createProductionEvidenceSources(m,x.readers).sessions(),/upstream source work report differs/);
 x.sourceReports.delete('work-1');
 await assert.rejects(createProductionEvidenceSources(m,x.readers).sessions(),/upstream source work report differs|upstream source work report is missing/);
});

test('production finalizer denies mismatched or unavailable evidence and preserves the owner claim',async t=>{
 const x=await fixture(t);const {finalizeAutonomousCycle}=await import('../dist/flowdeck-autonomy-production-evidence.js');
 await assert.rejects(finalizeAutonomousCycle(x.manifest,x.readers),/ENOENT|upstream|inbox|binding|blocked_policy|journal tab\/chat independence/);
 assert.equal(await readFile(x.manifest.ownerClaimPath,'utf8'),'claim');
 await assert.rejects(readFile(x.manifest.paths.archive),{code:'ENOENT'});
});

test('Temporal SDK adapter extracts status.name and binds the exact run',async () => {
 const id='work-0001',run='run-0001';
 const sdk={workflow:{
  getHandle:(workflowId,runId)=>{assert.equal(workflowId,id);assert.equal(runId,run);return {
   describe:async()=>({runId:run,status:{name:'COMPLETED'}}),
   result:async()=>({status:'completed',reason:'successfully_reconciled',submissions:3})
  }},
  list:async function*(){yield {workflowId:id,runId:run,status:{name:'COMPLETED'}};yield {workflowId:id,runId:'different-run',status:{name:'RUNNING'}};}
 }};
 const {createTemporalEvidenceClient}=await import('../dist/flowdeck-autonomy-production-evidence.js');
 const adapter=createTemporalEvidenceClient(sdk);
 assert.deepEqual(await adapter.describe(id,run),{status:'COMPLETED',runId:run});
 assert.deepEqual(await adapter.list({workflowId:id,runId:run}),[{workflowId:id,runId:run,status:'COMPLETED'}]);
});

test('production closeout adapter exposes only strictly permitted collector manifest fields',async t => {
 const x=await fixture(t);
 const {closeoutManifestFromProduction}=await import('../dist/flowdeck-autonomy-production-evidence.js');
 const m=closeoutManifestFromProduction(x.manifest);
 assert.equal(m.workflowId,x.manifest.workflowId);
 assert.equal(m.ownerId,undefined);
 assert.equal(m.policyPath,undefined);
 assert.equal(Object.keys(m).length,14);
});
