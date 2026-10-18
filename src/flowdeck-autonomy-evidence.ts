/** Independent, success-only closeout evidence collection. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { archiveAutonomousSuccess, type AutonomousCloseoutEvidence, type AutonomousCloseoutPaths } from './flowdeck-autonomy-closeout.js';
import { sha256 } from './flowdeck-autonomy-policy.js';

export interface AutonomousCloseoutManifestV1 {
 schema:'flowdeck.autonomy-closeout-manifest/v1'; workflowId:string; runId:string; projectId:string;
 campaignId:string; policyDigest:string; terminalResult:{status:'completed';businessResult:string};
 reservations:[{kind:'initial_p1'|'continue_p1'|'initial_p2';id:string}, {kind:'initial_p1'|'continue_p1'|'initial_p2';id:string}, {kind:'initial_p1'|'continue_p1'|'initial_p2';id:string}];
 sessions:[{workId:string;taskId:string},{workId:string;taskId:string},{workId:string;taskId:string}];
 journals:[{dispatchId:string;promptHash:string;tabId:string;chatUrl:string},{dispatchId:string;promptHash:string;tabId:string;chatUrl:string},{dispatchId:string;promptHash:string;tabId:string;chatUrl:string}];
 artifacts:[{path:string;sha256:string},{path:string;sha256:string}]; ownerClaimPath:string; ownerClaimSha256:string;
 paths:AutonomousCloseoutPaths;
}
export interface AutonomousCloseoutSources {
 temporal():Promise<{workflowId:string;runId:string;status:string;businessResult:string}>;
 campaign():Promise<{projectId:string;campaignId:string;policyDigest:string}>;
 reservations():Promise<Array<{kind:string;id:string;state:string;runId:string;campaignId:string;projectId:string}>>;
 sessions():Promise<Array<{workId:string;taskId:string;state:string;outcome:string}>>;
 events():Promise<Array<{workId:string;kind:string;delivery:string}>>;
 journals():Promise<Array<{dispatchId:string;state:string;promptHash:string;tabId:string;chatUrl:string;reconciled:boolean;durable:boolean;runId:string;campaignId:string;projectId:string}>>;
 senderCount():Promise<number>;
}
const digest=/^[a-f0-9]{64}$/;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const need=(v:unknown,msg:string)=>{if(!v)throw Error('autonomous evidence blocked: '+msg)};
const exactKeys=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&same(Object.keys(v).sort(),[...keys].sort());
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
function strictManifest(m:AutonomousCloseoutManifestV1){
 need(exactKeys(m,['schema','workflowId','runId','projectId','campaignId','policyDigest','terminalResult','reservations','sessions','journals','artifacts','ownerClaimPath','ownerClaimSha256','paths']),'unknown or missing manifest fields');
 need(m?.schema==='flowdeck.autonomy-closeout-manifest/v1','unsupported manifest schema');
 need([m.workflowId,m.runId,m.projectId,m.campaignId].every(x=>typeof x==='string'&&x.length>=2),'manifest identity missing');
 need(digest.test(m.policyDigest)&&digest.test(m.ownerClaimSha256),'manifest digest invalid');
 need(m.terminalResult?.status==='completed'&&m.terminalResult.businessResult==='successfully_reconciled','autonomous terminal result missing or not successful');
 need(exactKeys(m.terminalResult,['status','businessResult']),'terminal result fields invalid');
 need(m.reservations?.every(x=>exactKeys(x,['kind','id']))&&m.sessions?.every(x=>exactKeys(x,['workId','taskId']))&&m.journals?.every(x=>exactKeys(x,['dispatchId','promptHash','tabId','chatUrl']))&&m.artifacts?.every(x=>exactKeys(x,['path','sha256'])),'manifest row fields invalid');
 need(m.reservations?.length===3&&same(m.reservations.map(x=>x.kind),['initial_p1','continue_p1','initial_p2'])&&new Set(m.reservations.map(x=>x.id)).size===3,'reservation manifest invalid');
 need(m.sessions?.length===3&&new Set(m.sessions.map(x=>x.workId)).size===3&&m.sessions[0].taskId===m.sessions[1].taskId&&m.sessions[2].taskId!==m.sessions[0].taskId,'session manifest invalid');
 need(m.journals?.length===3&&new Set(m.journals.map(x=>x.dispatchId)).size===3&&m.journals.every(x=>digest.test(x.promptHash)&&x.tabId&&x.chatUrl),'journal seals invalid');
 need(m.journals[0].tabId===m.journals[1].tabId&&m.journals[0].chatUrl===m.journals[1].chatUrl&&m.journals[2].tabId!==m.journals[0].tabId&&m.journals[2].chatUrl!==m.journals[0].chatUrl,'journal tab/chat independence invalid');
 need(m.journals[0].tabId===m.journals[1].tabId&&m.journals[0].chatUrl===m.journals[1].chatUrl&&m.journals[2].tabId!==m.journals[0].tabId&&m.journals[2].chatUrl!==m.journals[0].chatUrl,'journal tab/chat independence invalid');
 need(m.artifacts?.length===2&&m.artifacts.every(x=>resolve(x.path)===x.path&&digest.test(x.sha256)),'artifact manifest invalid');
 need(resolve(m.ownerClaimPath)===m.ownerClaimPath,'owner claim path invalid');
 need(exactKeys(m.paths,['claim','intent','archive','receipt','lock']),'closeout paths invalid');
}
export async function collectAutonomousCloseoutEvidence(m:AutonomousCloseoutManifestV1,s:AutonomousCloseoutSources,{allowArchivedOwnerClaim=false}:{allowArchivedOwnerClaim?:boolean}={}):Promise<AutonomousCloseoutEvidence>{
 strictManifest(m);
 const [t,c,r,ss,ev,j,sender,claim]=await Promise.all([s.temporal(),s.campaign(),s.reservations(),s.sessions(),s.events(),s.journals(),s.senderCount(),readFile(m.ownerClaimPath).catch(async e=>{
  if(e?.code==='ENOENT'&&allowArchivedOwnerClaim&&m.paths.claim===m.ownerClaimPath)
   return readFile(m.paths.archive);
  throw e;
 })]);
 need(t.workflowId===m.workflowId&&t.runId===m.runId&&t.status==='completed'&&t.businessResult===m.terminalResult.businessResult,'exact terminal workflow result mismatch');
 need(c.projectId===m.projectId&&c.campaignId===m.campaignId&&c.policyDigest===m.policyDigest,'policy or campaign identity mismatch');
 need(r.length===3&&r.every((x,i)=>x.id===m.reservations[i].id&&x.kind===m.reservations[i].kind&&x.state==='spent'&&x.runId===m.runId&&x.campaignId===m.campaignId&&x.projectId===m.projectId),'reservations missing, reordered, unspent, or out of scope');
 need(ss.length===3&&ss.every((x,i)=>x.workId===m.sessions[i].workId&&x.taskId===m.sessions[i].taskId&&x.state==='reported'&&x.outcome===(i===0?'partial':'success')),'work session mismatch');
 need(ev.length===6&&m.sessions.every(x=>['work_started','work_reported'].every(k=>ev.filter(e=>e.workId===x.workId&&e.kind===k&&e.delivery==='delivered').length===1))&&ev.every(e=>m.sessions.some(x=>x.workId===e.workId)),'work event set is incomplete or conflicting');
 need(j.length===3&&j[0].tabId===j[1].tabId&&j[0].chatUrl===j[1].chatUrl&&j[2].tabId!==j[0].tabId&&j[2].chatUrl!==j[0].chatUrl,'observed journal tab/chat independence invalid');
 need(j.length===3&&j.every((x,i)=>x.dispatchId===m.journals[i].dispatchId&&x.state==='reconciled'&&x.reconciled&&x.durable&&x.runId===m.runId&&x.campaignId===m.campaignId&&x.projectId===m.projectId&&x.promptHash===m.journals[i].promptHash&&x.tabId===m.journals[i].tabId&&x.chatUrl===m.journals[i].chatUrl),'send journal or prompt/tab/chat seal mismatch');
 need(sender===0,'active sender exists');
 need(sha256(claim)===m.ownerClaimSha256,'machine-wide owner claim changed');
 for(const a of m.artifacts)need(sha256(await readFile(a.path))===a.sha256,'approved artifact changed: '+a.path);
 const facts={schema:m.schema,workflowId:t.workflowId,runId:t.runId,projectId:c.projectId,campaignId:c.campaignId,policyDigest:c.policyDigest,
  reservations:r,sessions:ss,events:ev,journals:j,senderCount:sender,ownerClaimSha256:m.ownerClaimSha256,artifacts:m.artifacts};
 return {workflowId:m.workflowId,runId:m.runId,projectId:m.projectId,claimSha256:m.ownerClaimSha256,evidenceDigest:sha256(JSON.stringify(stable(facts))),
  terminalSuccess:true,allSendsReconciled:true,allSessionsReported:true,allEventsDelivered:true,promptSealsMatch:true,artifactsVerified:true,noSenders:true};
}
export async function archiveCollectedAutonomousSuccess(m:AutonomousCloseoutManifestV1,s:AutonomousCloseoutSources,options:{resume?:boolean;afterPhase?:(phase:string)=>Promise<void>}={}){
 const evidence=await collectAutonomousCloseoutEvidence(m,s,{allowArchivedOwnerClaim:options.resume===true});
 return archiveAutonomousSuccess(evidence,m.paths,{verify:()=>collectAutonomousCloseoutEvidence(m,s,{allowArchivedOwnerClaim:options.resume===true}),resume:options.resume,afterPhase:options.afterPhase});
}
