import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductionPredecessorReader} from '../dist/flowdeck-autonomy-production-predecessor.js';
import {createInitialScopeStore} from '../dist/flowdeck-autonomy-production-activities.js';
import {createAutonomousInitialJournal,initialDispatchKey} from '../dist/flowdeck-autonomy-initial-send.js';
import {createAutonomySendProvenanceStore} from '../dist/flowdeck-autonomy-send-provenance.js';
import {sha256,autonomyPolicyDigest} from '../dist/flowdeck-autonomy-policy.js';
import {normalizeComposerText,composerPayloadFor} from '../dist/sashai-dispatch-evidence.js';
import {PROJECT} from '../dist/sashai-live-browser.js';

async function scenario(t){
 const root=await mkdtemp(join(tmpdir(),'flowdeck-predecessor-independent-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const now='2026-10-18T08:00:00.000Z';
 const p={campaignId:'campaign-predecessor-001',projectId:'project-predecessor-001',ownerId:'owner-predecessor-001',deviceId:'device-predecessor-001',projectUrl:PROJECT,enabledTaskIds:['task-p1-000001','task-p2-000001'],worktree:root};
 const context={schema:'flowdeck.autonomous-input/v1',workflowId:'workflow-predecessor-001',runId:'run-predecessor-001',campaignRunId:'campaign-run-0001',projectId:p.projectId,policy:p,policyDigest:autonomyPolicyDigest(p)};
 const prompt='approved first P1 task',tabId='PREDECESSORTAB00001',chatUrl=PROJECT.replace(/\/project$/,'/c/11111111-1111-4111-8111-111111111111');
 const scope={campaignId:p.campaignId,runId:context.runId,projectId:p.projectId,taskId:p.enabledTaskIds[0],tabId,projectUrl:PROJECT,worktree:root,promptHash:sha256(normalizeComposerText(composerPayloadFor(prompt))),policyDigest:context.policyDigest};
 await mkdir(root,{recursive:true});
 await writeFile(join(root,'browser-owner.lock'),JSON.stringify({schema:'flowdeck.browser-owner/v1',campaignId:p.campaignId,runId:context.runId,deviceId:p.deviceId,profile:'helium-profile-4',tabOwnerId:'tab-owner-predecessor'}));
 const scopes=createInitialScopeStore(root);
 await scopes.claimExact(context);
 const journal=createAutonomousInitialJournal(join(root,'initial-dispatches'));
 await journal.reserve(scope);
 for(const phase of ['staged','click_attempted','submitted','reconciled'])await journal.next(scope,phase);
 await scopes.persistExact(context,scope);
 const promptPath=join(root,'initial-prompts',initialDispatchKey(scope)+'.json');
 const observationPath=join(root,'initial-observations',sha256(JSON.stringify([p.campaignId,context.runId,scope.taskId]))+'.json');
 await mkdir(join(root,'initial-prompts'),{recursive:true});await mkdir(join(root,'initial-observations'),{recursive:true});
 await writeFile(promptPath,JSON.stringify({schema:'flowdeck.initial-prompt/v1',scope,prompt}));
 await writeFile(observationPath,JSON.stringify({schema:'flowdeck.initial-observation/v1',scope,chatUrl,turnId:'user-first-01',userPromptHash:scope.promptHash}));
 const stage='initial_p1',workId='work-predecessor-001';
 const values={
  source:{workId,ownerId:p.ownerId,deviceId:p.deviceId,state:'reported',outcome:'partial',startedAt:now,reportedAt:now},
  binding:{workflowId:context.workflowId,runId:context.runId,campaignRunId:context.campaignRunId,projectId:p.projectId,campaignId:p.campaignId,taskId:scope.taskId,stage,dispatchId:sha256(JSON.stringify([p.campaignId,context.runId,p.projectId,scope.taskId])),workId,ownerId:p.ownerId,deviceId:p.deviceId,tabId,chatUrl,dispatchReconciled:true},
  observation:{workId,taskId:scope.taskId,ownerId:p.ownerId,deviceId:p.deviceId,tabId,chatUrl,userTurns:1,turn:'finished',decision:'continue',strictCompletionMarker:false}
 };
 const event=(kind,rev)=>({schema:'remote-mcp.work-event/v1',source:'remote-mcp-jazz',eventId:'event-'+kind,workId,ownerId:p.ownerId,deviceId:p.deviceId,kind,revision:rev,sourceCommittedAt:now,startedAt:now,timestampEvidence:'recorded_in_source_transaction',completionEvidence:rev===1?'none':'agent_report_only',...(rev===2?{outcome:'partial',reportedAt:now}:{}),executionVerified:false,backgroundProcesses:'unknown',origin:'event'});
 values.inbox=[{event:event('work_started',1),delivery:'delivered'},{event:event('work_reported',2),delivery:'delivered'}];
 const ports={readSourceReport:async()=>values.source,readBinding:async()=>values.binding,readInboxEvents:async()=>values.inbox,observeResponse:async()=>values.observation};
 const reader=createProductionPredecessorReader({root,sessions:ports});
 return {root,context,p,scope,values,reader,promptPath,observationPath,tabId,chatUrl,now,ports};
}

test('independent persisted P1 evidence yields followup authority; every critical mutation refuses it',async t=>{
 const x=await scenario(t);
 const valid=await x.reader('initial_p1',x.context);
 assert.equal(valid.exactSession,true);assert.equal(valid.exactDispatch,true);assert.equal(valid.dispatchId,x.values.binding.dispatchId);
 const cases=[
  ['upstream failure',()=>x.values.source.outcome='failed',()=>x.values.source.outcome='partial'],
  ['missing source',()=>x.values.source=null,()=>x.values.source={...goodSource}],
  ['binding tab conflict',()=>x.values.binding.tabId='WRONGTAB000000001',()=>x.values.binding.tabId=x.tabId],
  ['wrong observed chat',()=>x.values.observation.chatUrl='https://chatgpt.com/g/foreign/c/other',()=>x.values.observation.chatUrl=x.chatUrl],
  ['extra user turn',()=>x.values.observation.userTurns=2,()=>x.values.observation.userTurns=1],
  ['report not delivered',()=>x.values.inbox[1].delivery='pending',()=>x.values.inbox[1].delivery='delivered'],
  ['report revision',()=>x.values.inbox[1].event.revision=3,()=>x.values.inbox[1].event.revision=2],
 ];
 const goodSource={...x.values.source};
 for(const [label,mutate,restore] of cases){mutate();const candidate=await x.reader('initial_p1',x.context);assert.equal(candidate,null,label);restore();}
 await writeFile(x.promptPath,JSON.stringify({schema:'flowdeck.initial-prompt/v1',scope:x.scope,prompt:'tampered'}));
 assert.equal(await x.reader('initial_p1',x.context),null,'prompt mismatch');
});

test('verified continuation source/provenance inherits exact original P1 tab/chat and refuses forged session join',async t=>{
 const x=await scenario(t),kind='continue_p1';
 const dispatchId='followup-'+sha256(JSON.stringify([x.context.workflowId,x.context.runId,x.context.campaignRunId,kind]));
 const provenance=createAutonomySendProvenanceStore(join(x.root,'send-provenance'));
 const intent={schema:'flowdeck.send-intent/v1',dispatchId,workflowId:x.context.workflowId,runId:x.context.runId,campaignId:x.p.campaignId,campaignRunId:x.context.campaignRunId,projectId:x.p.projectId,taskId:x.scope.taskId,kind,policyDigest:x.context.policyDigest,reservationId:sha256(JSON.stringify([x.context.runId,kind])),promptHash:sha256('approved-continuation-payload'),tabId:x.tabId,projectUrl:PROJECT,priorChatUrl:x.chatUrl,priorUserTurns:1};
 await provenance.putIntent(intent);
 for(const phase of ['staged','click_attempted'])await provenance.recordPhase(dispatchId,phase);
 const partial=await import('../dist/flowdeck-autonomy-send-provenance.js');
 // The sealed observation must use the exact hash of immutable intent bytes.
 const fs=await import('node:fs/promises');
 const crypto=await import('node:crypto');
 const bytes=await fs.readFile(join(x.root,'send-provenance',dispatchId+'.intent.json'));
 await provenance.putObservation({schema:'flowdeck.send-observation/v1',dispatchId,intentSha256:crypto.createHash('sha256').update(bytes).digest('hex'),observedPromptHash:intent.promptHash,tabId:x.tabId,chatUrl:x.chatUrl,userTurnId:'user-second-02',observedUserTurns:2});
 await provenance.recordPhase(dispatchId,'submitted');await provenance.reconcile(dispatchId);
 const v=x.values;v.binding={...v.binding,stage:kind,workId:'work-predecessor-002',dispatchId};v.source={...v.source,workId:v.binding.workId,outcome:'success'};v.observation={...v.observation,workId:v.binding.workId,userTurns:2,decision:'implementation_done',strictCompletionMarker:true};
 v.inbox=v.inbox.map(row=>({event:{...row.event,eventId:'second-'+row.event.eventId,workId:v.binding.workId,...(row.event.kind==='work_reported'?{outcome:'success'}:{})},delivery:'delivered'}));
 const proven=await x.reader(kind,x.context);
 assert.equal(proven?.userTurnId,'user-second-02');assert.equal(proven?.exactSession,true);
 v.binding.tabId='FORGEDTAB000000001';
 assert.equal(await x.reader(kind,x.context),null,'wrong binding prevents followup');
});