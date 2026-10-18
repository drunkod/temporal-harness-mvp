/** Read-only production evidence readers. Every source is explicit and injectable. */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { initialDispatchKey } from './flowdeck-autonomy-initial-send.js';
import { composerPayloadFor } from './sashai-dispatch-evidence.js';
import { createAutonomyCampaignStore } from './flowdeck-autonomy-campaign.js';
import { autonomyPolicyDigest, sha256, validateAutonomyPolicy, type AutonomyPolicyV1 } from './flowdeck-autonomy-policy.js';
import { archiveCollectedAutonomousSuccess, type AutonomousCloseoutManifestV1, type AutonomousCloseoutSources } from './flowdeck-autonomy-evidence.js';
import { createAutonomySendProvenanceStore } from './flowdeck-autonomy-send-provenance.js';

type TemporalStatus = { status: string; runId: string };
export interface ProductionEvidenceManifest extends AutonomousCloseoutManifestV1 {
 ownerId: string; deviceId: string; taskIds: [string,string]; campaignRunId:string; policyPath: string;
 inboxDirectory: string; autonomyRoot: string; supervisorRoot: string;
}
export interface TemporalEvidenceClient {
 describe(workflowId:string,runId:string):Promise<TemporalStatus>;
 result(workflowId:string,runId:string):Promise<unknown>;
 list(options:{workflowId:string;runId:string}):Promise<Array<{workflowId:string;runId:string;status:string}>>;
}
export interface ProductionEvidenceReaders {
 temporal: TemporalEvidenceClient;
 processes():Promise<Array<{command:string;pid:number}>>;
 readText(path:string):Promise<string>;
 readNames(path:string):Promise<string[]>;
 /** Independent read-only adapter to the authoritative upstream work ledger. */
 sourceWorkReports: SourceWorkReportReader;
}
export interface SourceWorkReport {
 workId:string; ownerId:string; deviceId:string; state:'running'|'reported';
 outcome:'partial'|'success'|'failed'|null; startedAt:string; reportedAt:string|null; eventIds?:{started?:string;reported?:string};
}
export interface SourceWorkReportReader {
 readExact(query:{ownerId:string;deviceId:string;workId:string}):Promise<SourceWorkReport|null>;
}
const blocked=(why:string):never=>{throw Error('autonomous production evidence blocked: '+why)};
const exact=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const digest=/^[a-f0-9]{64}$/;
const object=(v:any)=>!!v&&typeof v==='object'&&!Array.isArray(v);
function strict(m:ProductionEvidenceManifest){
 const expected=['schema','workflowId','runId','projectId','campaignId','campaignRunId','policyDigest','terminalResult','reservations','sessions','journals','artifacts','ownerClaimPath','ownerClaimSha256','paths','ownerId','deviceId','taskIds','policyPath','inboxDirectory','autonomyRoot','supervisorRoot'];
 if(!object(m)||!exact(Object.keys(m).sort(),expected.sort()))blocked('manifest has unknown or missing fields');
 if(m.schema!=='flowdeck.autonomy-closeout-manifest/v1'||![m.workflowId,m.runId,m.projectId,m.campaignId,m.ownerId,m.deviceId].every(x=>typeof x==='string'&&x.length>1))blocked('manifest identity/schema invalid');
 if(!digest.test(m.policyDigest)||!digest.test(m.ownerClaimSha256)||!Array.isArray(m.taskIds)||m.taskIds.length!==2||typeof m.campaignRunId!=='string'||!/^[A-Za-z0-9._-]{8,128}$/.test(m.campaignRunId))blocked('manifest identity seals invalid');
 for(const p of [m.ownerClaimPath,m.policyPath,m.inboxDirectory,m.autonomyRoot,m.supervisorRoot,...m.artifacts.map(a=>a.path)])if(resolve(p)!==p)blocked('manifest paths must be absolute and canonical');
}
const json=async(r:ProductionEvidenceReaders,path:string)=>JSON.parse(await r.readText(path));
const missing=(e:any)=>e?.code==='ENOENT';

/** SDK adapter uses describe/result against the exact execution handle. */
export function createTemporalEvidenceClient(client:any):TemporalEvidenceClient {
 if(!client?.workflow?.getHandle||!client?.workflow?.list)throw Error('explicit Temporal Client is required');
 return {
  async describe(workflowId,runId){const d=await client.workflow.getHandle(workflowId,runId).describe();if(!d.runId||!d.status?.name)blocked('Temporal SDK describe omitted exact run/status');return{status:d.status.name,runId:d.runId};},
  async result(workflowId,runId){return await client.workflow.getHandle(workflowId,runId).result();},
  async list({workflowId,runId}){const out=[];for await(const x of client.workflow.list({query:`WorkflowId = "${workflowId}"`}))if(x.runId===runId)out.push({workflowId:String(x.workflowId),runId:String(x.runId),status:String(x.status?.name??'unknown')});return out;}
 };
}

export function createProductionEvidenceSources(m:ProductionEvidenceManifest, readers:ProductionEvidenceReaders):AutonomousCloseoutSources {
 strict(m);
 if(!readers?.temporal||typeof readers.processes!=='function'||typeof readers.readText!=='function'||typeof readers.readNames!=='function'||typeof readers.sourceWorkReports?.readExact!=='function')throw Error('explicit read-only Temporal, process, filesystem, and upstream source work-report readers are required');
 const ownerClaimPath=m.ownerClaimPath;
 return {
  async temporal(){
   const [d,result,list]=await Promise.all([readers.temporal.describe(m.workflowId,m.runId),readers.temporal.result(m.workflowId,m.runId),readers.temporal.list({workflowId:m.workflowId,runId:m.runId})]);
   if(d.runId!==m.runId||list.length!==1||list[0].workflowId!==m.workflowId||list[0].runId!==m.runId)blocked('Temporal execution list/describe run mismatch');
   const status=d.status.toLowerCase();
   if(status!=='completed')blocked('Temporal workflow is not terminal completed');
   const business:any=result;
   if(!object(business)||business.status!=='completed'||business.reason!=='successfully_reconciled'||business.submissions!==3)blocked('Temporal completed business result is not the exact autonomous success');
   return{workflowId:m.workflowId,runId:d.runId,status:'completed',businessResult:'successfully_reconciled'};
  },
  async campaign(){
   const raw=await json(readers,m.policyPath);const policy=validateAutonomyPolicy(raw,undefined,undefined);
   if(autonomyPolicyDigest(policy)!==m.policyDigest||policy.campaignId!==m.campaignId||policy.projectId!==m.projectId||policy.ownerId!==m.ownerId||policy.deviceId!==m.deviceId||!exact(policy.enabledTaskIds,m.taskIds))blocked('policy identity or digest does not match manifest');
   // Read through the existing store so its filename, schema and policy invariants apply.
   const store=createAutonomyCampaignStore(m.autonomyRoot);const records=await store.reservations(policy);
   if(records.length!==3||records.some(x=>x.runId!==m.runId||x.campaignId!==m.campaignId))blocked('campaign reservation set missing, extra, or out of run scope');
   return{projectId:m.projectId,campaignId:m.campaignId,policyDigest:m.policyDigest};
  },
  async reservations(){
   const policy=validateAutonomyPolicy(await json(readers,m.policyPath));const rows=await createAutonomyCampaignStore(m.autonomyRoot).reservations(policy);
   const expected=['initial_p1','continue_p1','initial_p2'];
   return rows.filter(x=>x.runId===m.runId).sort((a,b)=>expected.indexOf(a.kind)-expected.indexOf(b.kind)).map(x=>({id:sha256(JSON.stringify([x.runId,x.kind])),kind:x.kind,state:'spent',runId:x.runId,campaignId:x.campaignId,projectId:m.projectId}));
  },
  async sessions(){
   // Session identity must be represented by manifest work IDs and exact task binding records.
   const rows=[];
   for(const [i,s] of m.sessions.entries()){
    const bindingPath=join(m.supervisorRoot,`binding-${sha256(JSON.stringify([m.projectId,s.workId]))}.json`);
    const binding=await json(readers,bindingPath);
    if(binding?.binding?.projectId!==m.projectId||binding.binding.workId!==s.workId||binding.binding.taskId!==s.taskId||!m.taskIds.includes(s.taskId))blocked('session binding missing or identity mismatch');
    const inbox=await json(readers,join(m.inboxDirectory,'inbox.json'));
    const events=Object.values(inbox.events??{}).map((x:any)=>x.event).filter((e:any)=>e?.workId===s.workId&&e.ownerId===m.ownerId&&e.deviceId===m.deviceId);
    const start=events.find((e:any)=>e.kind==='work_started'), report=events.find((e:any)=>e.kind==='work_reported');
    if(!report||!start||events.length!==2||report.outcome!==(i===0?'partial':'success'))blocked('session lacks exact source inbox work/session report');
    const upstream=await readers.sourceWorkReports.readExact({ownerId:m.ownerId,deviceId:m.deviceId,workId:s.workId});
    if(!upstream)throw Error('autonomous production evidence blocked: upstream source work report is missing');
    if(upstream.workId!==s.workId||upstream.ownerId!==m.ownerId||upstream.deviceId!==m.deviceId||
       upstream.state!=='reported'||upstream.outcome!==report.outcome||(upstream.eventIds!==undefined&&(upstream.eventIds.started!==start.eventId||upstream.eventIds.reported!==report.eventId))||upstream.startedAt!==start.startedAt||upstream.reportedAt!==report.reportedAt||
       !start.eventId||!report.eventId||start.eventId===report.eventId||start.kind!=='work_started'||start.revision!==1||report.kind!=='work_reported'||report.revision!==2)
      blocked('upstream source work report differs from inbox/source binding');
    const outcome=upstream.outcome;
    if(outcome!=='partial'&&outcome!=='success')blocked('upstream source outcome is not an accepted session result');
    rows.push({workId:s.workId,taskId:s.taskId,state:'reported',outcome:outcome as 'partial'|'success'});
   }
   return rows;
  },
  async events(){
   const inbox=await json(readers,join(m.inboxDirectory,'inbox.json'));
   if(inbox.schema!=='flowdeck.work-inbox/v1'||inbox.ownerId!==m.ownerId||inbox.deviceId!==m.deviceId)blocked('event inbox owner/device/schema mismatch');
   return Object.values(inbox.events??{}).map((x:any)=>({event:x.event,delivery:x.delivery})).filter((x:any)=>m.sessions.some(s=>s.workId===x.event?.workId)).map((x:any)=>{
    if(x.delivery!=='delivered'||x.event.ownerId!==m.ownerId||x.event.deviceId!==m.deviceId||!x.event.eventId||
          (x.event.kind==='work_started'&&x.event.revision!==1)||(x.event.kind==='work_reported'&&x.event.revision!==2)||!['work_started','work_reported'].includes(x.event.kind))blocked('source inbox event is not delivered or exact owner/device/event provenance');
    const session=m.sessions.find(s=>s.workId===x.event.workId);if(!session)blocked('inbox event has unmanifested workId');
    return{workId:x.event.workId,kind:x.event.kind,delivery:x.delivery};
   });
  },
  async journals(){
   const out=[];
   for(const [i,expected] of m.journals.entries()){
    let scope:any;
    if(i===0){const dir=join(m.autonomyRoot,'initial-dispatches');const names=await readers.readNames(dir);const records=[];for(const n of names.filter(n=>n.endsWith('-reconciled.json')))records.push(await json(readers,join(dir,n)));
     const matches=records.filter(x=>x.schema==='flowdeck.autonomous-dispatch/v1'&&x.phase==='reconciled'&&x.scope?.runId===m.runId&&x.scope?.campaignId===m.campaignId&&x.scope?.taskId===m.sessions[0].taskId);
     if(matches.length!==1)blocked('sealed initial P1 journal missing or ambiguous');
     const initialScope=matches[0].scope;
     const key=initialDispatchKey(initialScope);
     // The production initial producer keys observations by campaign/run/task,
     // while its immutable prompt and journal are keyed by initialDispatchKey.
     const observedKey=sha256(JSON.stringify([initialScope.campaignId,initialScope.runId,initialScope.taskId]));
     const observation=await json(readers,join(m.autonomyRoot,'initial-observations',observedKey+'.json'));
     const sealedPrompt=await json(readers,join(m.autonomyRoot,'initial-prompts',key+'.json'));
     if(observation.schema!=='flowdeck.initial-observation/v1'||sealedPrompt.schema!=='flowdeck.initial-prompt/v1'||
        !exact(observation.scope,initialScope)||!exact(sealedPrompt.scope,initialScope)||
        observation.userPromptHash!==initialScope.promptHash||
        sha256(composerPayloadFor(sealedPrompt.prompt).normalize('NFC').replace(/\s+/gu,' ').trim())!==initialScope.promptHash||
        typeof observation.turnId!=='string'||!observation.turnId)
       blocked('initial journal observation or prompt provenance changed');
     scope={...initialScope,dispatchId:key,chatUrl:observation.chatUrl};
    } else {
     const verified=await createAutonomySendProvenanceStore(join(m.autonomyRoot,'send-provenance')).readExact(expected.dispatchId);
     const intent=verified.intent,observation=verified.observation;
     const policy=validateAutonomyPolicy(await json(readers,m.policyPath));
     const kind=i===1?'continue_p1':'initial_p2';
     const previous=i===1?m.journals[0].chatUrl:m.journals[1].chatUrl;
     const priorTurns=i===1?1:0;
     if(intent.workflowId!==m.workflowId||intent.runId!==m.runId||intent.campaignId!==m.campaignId||
      intent.campaignRunId!==m.campaignRunId||intent.projectId!==m.projectId||intent.taskId!==m.sessions[i].taskId||
      intent.kind!==kind||intent.policyDigest!==m.policyDigest||intent.reservationId!==m.reservations[i].id||
      intent.projectUrl!==policy.projectUrl||
      intent.priorChatUrl!==(i===1?previous:null)||intent.priorUserTurns!==priorTurns)
      blocked('subsequent send intent differs from independent run/campaign/task/policy/reservation expectations');
     if(i===2&&(observation.chatUrl===previous||observation.tabId===m.journals[1].tabId))blocked('P2 did not use a distinct Project tab and chat');
          if(i===1&&(observation.chatUrl!==m.journals[0].chatUrl||observation.tabId!==m.journals[0].tabId))blocked('P1 continuation changed its tab or chat');
     scope={...intent,dispatchId:intent.dispatchId,promptHash:intent.promptHash,tabId:intent.tabId,chatUrl:observation.chatUrl};
    }
    if(scope.runId!==m.runId||scope.campaignId!==m.campaignId||scope.projectId!==m.projectId||scope.taskId!==m.sessions[i].taskId||scope.promptHash!==expected.promptHash||scope.tabId!==expected.tabId||scope.chatUrl!==expected.chatUrl)blocked('journal provenance seal mismatch');
    if(scope.dispatchId!==expected.dispatchId)blocked('journal dispatch ID is absent or changed');
    out.push({dispatchId:scope.dispatchId,state:'reconciled',reconciled:true,durable:true,runId:m.runId,campaignId:m.campaignId,projectId:m.projectId,promptHash:scope.promptHash,tabId:scope.tabId,chatUrl:scope.chatUrl});
   }
   return out;
  },
  async senderCount(){
   const ps=await readers.processes();const active=ps.filter(p=>/flowdeck.*(?:sender|autonomy)|(?:sender|autonomy).*flowdeck/i.test(p.command));
   const workflows=await readers.temporal.list({workflowId:m.workflowId,runId:m.runId});
   if(workflows.some(x=>x.status.toLowerCase()==='running'))blocked('active Temporal lifecycle still listed');
   if(active.length)blocked('local sender process remains active');return 0;
  }
 };
}

export function createFilesystemEvidenceReaders(temporal:TemporalEvidenceClient,processes:ProductionEvidenceReaders['processes'],sourceWorkReports:SourceWorkReportReader):ProductionEvidenceReaders {
 if(typeof sourceWorkReports?.readExact!=='function')throw Error('explicit upstream source work-report reader is required');
 return {temporal,processes,sourceWorkReports,readText:async path=>readFile(path,'utf8'),readNames:async path=>{try{return await readdir(path)}catch(e){if(missing(e))return[];throw e;}}};
}


/** Keep the evidence collector's strict public manifest schema separate from
 * production-only source locations; never pass authority directories as extra
 * unvalidated fields into the successful-closeout transaction.
 */
export function closeoutManifestFromProduction(m:ProductionEvidenceManifest):AutonomousCloseoutManifestV1 {
 strict(m);
 const {schema,workflowId,runId,projectId,campaignId,policyDigest,terminalResult,
  reservations,sessions,journals,artifacts,ownerClaimPath,ownerClaimSha256,paths}=m;
 return {schema,workflowId,runId,projectId,campaignId,policyDigest,terminalResult,
  reservations,sessions,journals,artifacts,ownerClaimPath,ownerClaimSha256,paths};
}


/** Invoke only from the controller AFTER the exact Temporal run is COMPLETED.
 * The workflow's in-flight closeout activity is a readiness gate, never the
 * archival transaction (otherwise a circular completion dependency results).
 * This entrypoint inherits independent source checks and locked revalidation.
 */
export async function finalizeAutonomousCycle(
 manifest:ProductionEvidenceManifest,readers:ProductionEvidenceReaders,
 options:{resume?:boolean;afterPhase?:(phase:string)=>Promise<void>}={}
){
 const sources=createProductionEvidenceSources(manifest,readers);
 const evidence=closeoutManifestFromProduction(manifest);
 return archiveCollectedAutonomousSuccess(evidence,sources,options);
}
