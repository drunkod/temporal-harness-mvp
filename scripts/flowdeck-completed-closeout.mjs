#!/usr/bin/env node
/** One-time fail-closed closeout of an exact COMPLETED, zero-send Flowdeck attempt.
 * Default is READ ONLY. Never launches workflows, sends messages or deletes evidence.
 */
import {readFile,readdir,stat,mkdir,open,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {join,resolve,basename} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Connection,Client} from '@temporalio/client';
import {attemptScopePath,assertNoRunningFlowdeck} from './flowdeck-attempt-scope.mjs';

const root=resolve(import.meta.dirname,'..'), sha=x=>createHash('sha256').update(x).digest('hex');
const exec=promisify(execFile);
const usage='Usage: node scripts/flowdeck-completed-closeout.mjs preview|release --project-id ID --workflow-id ID --run-id UUID [--claim-sha256 SHA256]';
const activityAllow=new Set(['loadSupervisorProject','publishSupervisorState','adoptStartedWork']);
const part=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);

export function assessCompletedCloseout({claim,scope,runId,description,result,events,journal,active,processes,sourceWorkSessionsSinceClaim}){
 const faults=[];
 const deny=(test,code)=>{if(!test)faults.push(code);};
 deny(claim?.schema==='flowdeck.attempt-scope/v1'&&claim?.disposition==='unresolved_until_audited_reconciliation','invalid_claim');
 deny(claim?.workflowId===scope.workflowId&&claim?.projectId===scope.projectId&&
   claim?.deviceId===scope.deviceId&&claim?.ownerId===scope.ownerId&&claim?.profile==='helium-profile-4','claim_owner_mismatch');
 deny(description?.workflowId===scope.workflowId&&description?.runId===runId&&
   description?.type==='flowdeckSupervisor'&&description?.status?.name==='COMPLETED','execution_not_exact_completed_supervisor');
 const terminalBase=result?.projectId===scope.projectId&&result?.phase==='needs_attention'&&
   result?.status==='paused'&&result?.taskId===scope.initialTaskId;
 const previouslyStarted=result?.lastEvent?.kind==='work_started'&&
   typeof result?.workId==='string'&&result.workId.length>0;
 // A distinct failure shape: the exact manual-start timer elapsed before any P1
 // work-session event was observed. Do not generalize to arbitrary paused runs.
 const unstartedTimeout=result?.blocker==='No new work-session event within the bounded waiting period.'&&
   result?.lastEvent===null&&result?.workId===null&&result?.chatUrl===null&&result?.tabId===null;
 deny(terminalBase&&(previouslyStarted||unstartedTimeout),'unexpected_terminal_result');
 const usage=result?.pilotBudget?.usage;
 deny(usage?.p1Continuations===0&&usage?.nextChatSubmissions===0&&usage?.totalAutomatedSubmissions===0,'usage_not_zero');
 deny(Array.isArray(events)&&events.length>1&&events.some(e=>e.workflowExecutionCompletedEventAttributes),'history_not_completed');
 const scheduled=(events??[]).filter(e=>e.activityTaskScheduledEventAttributes).map(e=>e.activityTaskScheduledEventAttributes.activityType?.name);
 deny(scheduled.every(a=>activityAllow.has(a)),'send_or_unknown_activity_was_scheduled');
 if(unstartedTimeout){
  // A missing Temporal signal does not prove no real work happened while the follower was down.
  // Only an independently available, read-only source ledger with ZERO sessions can clear this case.
  deny(Array.isArray(sourceWorkSessionsSinceClaim)&&sourceWorkSessionsSinceClaim.length===0,
   'source_work_sessions_not_reconciled');
  // The only releaseable never-started shape has an observed timer expiry and
  // no signals/adoption/send/recovery activity, regardless of zero budget usage.
  deny((events??[]).some(e=>e.timerFiredEventAttributes),'missing_manual_start_timer_fired');
  deny(!(events??[]).some(e=>e.workflowExecutionSignaledEventAttributes),'unexpected_signal_in_unstarted_run');
  deny(scheduled.every(a=>a==='loadSupervisorProject'||a==='publishSupervisorState'),
   'unexpected_activity_in_unstarted_run');
 }
 deny(!journal?.some(j=>j.modifiedSinceClaim||j.referencesAttempt),'send_journal_unreconciled');
 deny(Array.isArray(journal),'journal_not_read');
 deny(Array.isArray(active)&&active.length===0,'competing_workflow_active');
 deny(Array.isArray(processes)&&processes.length===0,'competing_sender_active');
 return {ready:faults.length===0,blockers:faults,activityCount:scheduled.length,
  activityKinds:[...new Set(scheduled)],journalCount:journal?.length??null,
  journalTouchedSinceClaim:journal?.filter(x=>x.modifiedSinceClaim).length??null,
  journalReferencesAttempt:journal?.filter(x=>x.referencesAttempt).length??null,
  runningFlowdeck:active?.length??null,activeSenders:processes?.length??null,
  sourceWorkSessionsSinceClaim:sourceWorkSessionsSinceClaim?.length??null};
}
async function journals(base,claim,result){
 const store=join(base,'.state/flowdeck-supervisor');
 const direct=(await readdir(store)).filter(n=>/^(send-event-|send-phase-|sent-).*\.json$/.test(n)).map(n=>join(store,n));
 const recovery=join(store,'send-recovery');
 const names=(await readdir(recovery)).filter(n=>/\.(json|jsonl)$/.test(n)).map(n=>join(recovery,n));
 const claimedAt=Date.parse(claim.claimedAt);
 if(!Number.isFinite(claimedAt))throw Error('Invalid claim timestamp');
 const out=[];
 for(const path of [...direct,...names]){
  const [s,bytes]=await Promise.all([stat(path),readFile(path)]);
  const text=bytes.toString('utf8');
  out.push({name:basename(path),digest:sha(bytes),modifiedSinceClaim:s.mtimeMs>=claimedAt,
   referencesAttempt:[claim.projectId,claim.workflowId,result.workId,result.lastEvent?.eventId]
    .filter(x=>typeof x==='string'&&x.length>0).some(x=>text.includes(x))});
 }
 return out;
}
async function liveProcesses(){
 const {stdout}=await exec('/bin/ps',['-axo','pid=,command='],{timeout:8000,maxBuffer:4*1024*1024});
 return stdout.split('\n').filter(line=>
  /(?:^|[\s/])scripts\/(?:flowdeck-launch|flowdeck-supervisor|flowdeck-work-events|flowdeck-resume-send)\.mjs\b/.test(line)&&
  /\b(worker|follow|start|release|--attempt)\b|flowdeck-launch\.mjs/.test(line)).map(x=>x.trim().slice(0,160));
}
async function sourceSessionsAfterClaim(base,claim){
 const state=join(base,'.state');
 const options=(await readdir(state)).filter(n=>/^flowdeck-.*events\.json$/.test(n));
 const configs=[];
 for(const name of options){
  const config=JSON.parse(await readFile(join(state,name),'utf8'));
  if(config['workflow-id']===claim.workflowId&&config['project-id']===claim.projectId&&
    config.owner===claim.ownerId&&config.device===claim.deviceId) configs.push(config);
 }
 if(configs.length!==1)throw Error('Unstarted closeout requires a unique matching event-source config');
 const config=configs[0],timestamp=Date.parse(claim.claimedAt);
 if(!Number.isFinite(timestamp)||typeof config.db!=='string'||!config.db.startsWith('/'))
  throw Error('Invalid claim timestamp or source path');
 const db=new DatabaseSync(config.db,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=0;');
  return db.prepare('SELECT work_id, started_at, state, outcome FROM control_work_reports WHERE owner_id=? AND device_id=? AND started_at >= ? ORDER BY started_at')
   .all(claim.ownerId,claim.deviceId,timestamp).map(r=>({workId:String(r.work_id),
    startedAt:Number(r.started_at),state:String(r.state),outcome:r.outcome}));
 }finally{db.close()}
}
async function collect({base,scope,runId,connection}){
 const path=attemptScopePath(base,scope);
 const claimBytes=await readFile(path),claim=JSON.parse(claimBytes.toString('utf8'));
 const production=JSON.parse(await readFile(join(base,'.state/flowdeck-supervisor/projects.json'),'utf8'));
 const project=production.projects.find(p=>p.id===scope.projectId);
 if(!project||project.ownerId!==scope.ownerId||project.deviceId!==scope.deviceId||project.initialTaskId!==scope.initialTaskId)
  throw Error('Production enrollment differs from exact closeout owner or initial task');
 const client=new Client({connection,namespace:'default'}),handle=client.workflow.getHandle(scope.workflowId,runId);
 const desc=await handle.describe();
 const history=await handle.fetchHistory();
 const result=desc.status.name==='COMPLETED'?await handle.result():null;
 const active=[];
 for await(const info of client.workflow.list({query:"ExecutionStatus = 'Running'"})){
  if(info.status?.name==='RUNNING'&&
   (info.type==='flowdeckSupervisor'||info.type==='flowdeckRecoverSend'||info.workflowId?.startsWith('flowdeck-supervisor-')))
   active.push({id:info.workflowId,type:info.type});
 }
 const processList=await liveProcesses();
 const journal=await journals(base,claim,result);
 const sourceWorkSessionsSinceClaim=result?.workId===null&&result?.lastEvent===null?
  await sourceSessionsAfterClaim(base,claim):undefined;
 const assessment=assessCompletedCloseout({claim,scope,runId,description:desc,result,
  events:history.events,journal,active,processes:processList,sourceWorkSessionsSinceClaim});
 return {path,claimSha256:sha(claimBytes),claim,desc,result,assessment,
  digest:sha(JSON.stringify({workflowId:scope.workflowId,runId,history:history.events.length,
   lastEventId:String(history.events.at(-1)?.eventId),journal,sourceWorkSessionsSinceClaim})),journal};
}
export async function closeout({base=root,scope,runId,commit=false,expectedClaimSha256,connection,inspect=collect}){
 if(!part(scope?.projectId)||!part(scope?.ownerId)||!part(scope?.deviceId)||
  !part(scope?.initialTaskId)||!/^flowdeck-supervisor-[A-Za-z0-9_-]{1,180}$/.test(scope.workflowId)||
  !uuid(runId))throw Error('Invalid exact closeout identifiers');
 if(commit&&!/^[a-f0-9]{64}$/.test(expectedClaimSha256??''))
  throw Error('Release requires --claim-sha256 from the read-only preview');
 const file=attemptScopePath(base,scope);
 const lock=file+'.closeout-lock';
 if(commit){const fd=await open(lock,'wx',0o600);
  try{await fd.writeFile(JSON.stringify({schema:'flowdeck.closeout-lock/v1',workflowId:scope.workflowId,runId})+'\n');await fd.sync()}
  finally{await fd.close()}
 }
 // Lock is intentionally retained on any failure, not silently cleared.
 const data=await inspect({base,scope,runId,connection});
 if(commit&&data.claimSha256!==expectedClaimSha256)throw Error('Scope claim changed since preview');
 const answer={state:commit?'release_requested':'preview',workflowId:scope.workflowId,runId,
  projectId:scope.projectId,scopePath:file,claimSha256:data.claimSha256,
  historyAndJournalDigest:data.digest,...data.assessment};
 if(!commit||!data.assessment.ready)return answer;
 // The wx closeout lock guards multiple release operators. The original claim
 // continues blocking any new claimant until a single atomic filesystem rename.
 const dir=join(base,'.state/flowdeck-supervisor/completed-closeouts');
 await mkdir(dir,{recursive:true,mode:0o700});
 const suffix=sha(JSON.stringify([scope.workflowId,runId])).slice(0,20);
 const archive=join(dir,'claim-'+suffix+'.json');
 const intent=join(dir,'intent-'+suffix+'.json');
 const receipt=join(dir,'released-'+suffix+'.json');
 const original=await readFile(file);
 if(sha(original)!==data.claimSha256)throw Error('Claim changed before atomic release');
 // Recheck while the claim is still present; a new claimant cannot pass wx.
 const rerun=await inspect({base,scope,runId,connection});
 if(!rerun.assessment.ready||rerun.claimSha256!==data.claimSha256||rerun.digest!==data.digest)
  throw Error('Temporal, process, or journal evidence changed during closeout');
 const evidence={schema:'flowdeck.completed-closeout/v1',workflowId:scope.workflowId,runId,
   claimSha256:data.claimSha256,historyAndJournalDigest:data.digest,
   activityKinds:data.assessment.activityKinds,activityCount:data.assessment.activityCount,
   journalCount:data.assessment.journalCount,archive,scopePath:file,
   preparedAt:new Date().toISOString(),zeroAutomatedSendActivities:true};
 async function writeExclusive(p,obj){
  const fd=await open(p,'wx',0o600);
  try{await fd.writeFile(JSON.stringify(obj,null,2)+'\n');await fd.sync()}finally{await fd.close()}
 }
 await writeExclusive(intent,{...evidence,state:'validated_before_atomic_release'});
 await rename(file,archive);
 const parent=await open(dir,'r');try{await parent.sync()}finally{await parent.close()}
 await writeExclusive(receipt,{...evidence,state:'released',releasedAt:new Date().toISOString()});
 return {...answer,state:'released',ready:true,archivedClaim:archive,closeoutReceipt:receipt};
}
async function main(argv=process.argv.slice(2)){
 const [mode,...rest]=argv,flags={};
 if(!['preview','release'].includes(mode)||rest.length%2!==0)throw Error(usage);
 for(let i=0;i<rest.length;i+=2){if(!rest[i].startsWith('--')||flags[rest[i]])throw Error(usage);flags[rest[i]]=rest[i+1]}
 if(Object.keys(flags).some(k=>!['--project-id','--workflow-id','--run-id','--claim-sha256'].includes(k)))throw Error(usage);
 const projectId=flags['--project-id'],workflowId=flags['--workflow-id'],runId=flags['--run-id'];
 const projects=JSON.parse(await readFile(join(root,'.state/flowdeck-supervisor/projects.json'),'utf8'));
 const p=projects.projects.find(x=>x.id===projectId);
 if(!p||workflowId!=='flowdeck-supervisor-'+projectId)throw Error('Exact project/workflow mismatch');
 let connection;
 try{connection=await Connection.connect({address:'127.0.0.1:7233',connectTimeout:'5 seconds'});
  const r=await closeout({scope:{projectId,workflowId,ownerId:p.ownerId,deviceId:p.deviceId,initialTaskId:p.initialTaskId},
   runId,commit:mode==='release',expectedClaimSha256:flags['--claim-sha256'],connection});
  console.log(JSON.stringify(r,null,2));
  if(!r.ready)process.exitCode=2;
 }finally{await connection?.close()}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(e=>{console.error('Closeout refused:',String(e?.message??e));process.exitCode=3});
