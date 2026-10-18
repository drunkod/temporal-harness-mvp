#!/usr/bin/env node
/** Exact-run audited closeout of a real, partial P1 whose initial tab showed
 * conflicting older task history. NEVER starts/replays a workflow or sends.
 * Preview is read-only; release requires exact preview claim/hash pair.
 */
import{readFile,readdir,stat,open,mkdir,rename}from'node:fs/promises';
import{resolve,join}from'node:path';
import{createHash}from'node:crypto';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{Connection,Client}from'@temporalio/client';
import{DatabaseSync}from'node:sqlite';
import{loadSupervisorProject}from'../dist/flowdeck-projects.js';
import{supervisorIdentityExpression}from'../dist/flowdeck-supervisor-activities.js';
import{browserPages,browserEvaluate}from'../dist/sashai-live-browser.js';
import{attemptScopePath}from'./flowdeck-attempt-scope.mjs';
const root=resolve(import.meta.dirname,'..'),exec=promisify(execFile);
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=(value,label)=>{if(!value)throw Error('Conflicted P1 closeout refused: '+label)};
const P='sashai-fresh-attended-20261018-06',W='flowdeck-supervisor-'+P;
const RUN='01a14bbe-92a0-70a0-a24c-4fe82daecd10';
const SESSION='572524a7-fb93-45e0-a6c5-8fb6da1288b0';
const TASK='sashai-fresh-attended-p1-20261018-06';
const OLD='sashai-fresh-attended-p1-20261017-05';
const OLDWORK='sashai-flowdeck-fresh-attended-20261017-05';
const REPO='/Users/test/Documents/work/sashai-flowdeck-fresh-attended-20261018-06';
const P1=join(REPO,'docs/flowdeck-fresh-attended-2026-10-18-06/p1.md');
const P2=join(REPO,'docs/flowdeck-fresh-attended-2026-10-18-06/p2.md');
const P1SHA='fe345af6e9a9db2d17ae8c7cbf22168dcb9b3e916c448f3f211393e798b79ddc';
const INCIDENT='.state/verification-runs/fresh-manual-20261018-06-ZmzNAI/LIVE-P1-IDENTITY-INCIDENT.md';
const INCIDENT_SHA='7e8c228b0a29a7170e1c1bc4c44740b3a865c4a1496396e0ce9e07518f96c9f4';
const TAB='333B7B9508008C3E80180DF0B0C60C5A';
const CHAT='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6ad3e75f-c360-83eb-a1d0-584ba44a0f6b';
const CONFIG='.state/flowdeck-human-pilot-20261018-06-events.json';
const allowed=new Set(['loadSupervisorProject','publishSupervisorState','adoptStartedWork']);
export function assessConflictedP1Closeout(e){
 const blockers=[],must=(yes,name)=>{if(!yes)blockers.push(name)};
 must(e?.claimValid===true,'exact_claim_ownership');
 must(e?.workflow?.closed===true&&e.workflow?.exact===true&&
  e.workflow?.paused===true&&e.workflow?.taskIsInitial===true&&
  e.workflow?.zeroBudget===true&&e.workflow?.tasksApproved===true,'historical_result_or_budget_mismatch');
 must(e?.history?.closed===true&&e.history?.eventCount===39&&e.history?.signals===1&&
  e.history?.activities===4&&e.history?.load===1&&e.history?.publish===2&&
  e.history?.adoptFailures===1&&e.history?.adoptMessageMatches===true&&
  e.history?.sendActivities===0&&e.history?.unknownOrPending===0,'temporal_events_not_reconciled');
 must(e?.source?.count===1&&e.source?.id===SESSION&&e.source?.reportedPartial===true&&
  e.source?.taskAndWorktreeMatch===true&&e.source?.timeMatch===true,'work_session_not_reconciled');
 must(e?.inbox?.twoEvents===true&&e.inbox?.startedDelivered===true&&
  e.inbox?.reportedTargetClosed===true,'work_event_inbox_not_reconciled');
 must(e?.artifact?.p1Hash===P1SHA&&e.artifact?.correctCheckpoint===true&&
  e.artifact?.p2Absent===true,'artifact_not_intact');
 must(e?.browser?.exactTabAndChat===true&&e.browser?.newProjectConversation===true&&
  e.browser?.archivedConflictReportMatches===true,'conflicting_browser_evidence_missing');
 must(e?.journals?.newSenderRecords===0&&e.journals?.changedSinceClaim===0,
  'new_send_journal_or_unreconciled_change');
 must(e?.running?.workflows===0&&e.running?.senderProcesses===0,'competing_execution_or_sender');
 return {ready:blockers.length===0,blockers};
}
async function collect(){
 const project=await loadSupervisorProject(P);
 fail(project.repo===REPO&&project.initialTaskId===TASK&&project.tasks.length===2,'project enrollment changed');
 const claimFile=attemptScopePath(root,project),claimBytes=await readFile(claimFile),
  claim=JSON.parse(claimBytes);
 const claimValid=claim.schema==='flowdeck.attempt-scope/v1'&&claim.projectId===P&&claim.workflowId===W&&
   claim.ownerId===project.ownerId&&claim.deviceId===project.deviceId&&
   claim.profile==='helium-profile-4'&&claim.disposition==='unresolved_until_audited_reconciliation';
 fail(claimValid,'claim changed');
 const cfg=JSON.parse(await readFile(join(root,CONFIG),'utf8'));
 fail(cfg['workflow-id']===W&&cfg['project-id']===P&&cfg.owner===project.ownerId&&cfg.device===project.deviceId,'event config changed');
 let conn,result,desc,events,running=0;
 try{
  conn=await Connection.connect({address:cfg.address,connectTimeout:'5 seconds'});
  const client=new Client({connection:conn,namespace:cfg.namespace});
  const h=client.workflow.getHandle(W,RUN);
  desc=await h.describe();events=(await h.fetchHistory()).events;
  result=desc.status.name==='COMPLETED'?await h.result():null;
  for await(const row of client.workflow.list({query:"ExecutionStatus = 'Running'"})){
   if(row.type==='flowdeckSupervisor'||row.type==='flowdeckRecoverSend'||row.workflowId?.startsWith('flowdeck-supervisor-'))running++;
  }
 }finally{await conn?.close()}
 const workflow={exact:desc.workflowId===W&&desc.runId===RUN&&desc.type==='flowdeckSupervisor',
  closed:desc.status.name==='COMPLETED',
  paused:result?.status==='paused'&&result?.phase==='needs_attention'&&
    result?.blocker==='Cannot uniquely correlate the work session with the intended project/chat/task.',
  taskIsInitial:result?.taskId===TASK&&result?.workId===null&&result?.chatUrl===null&&result?.tabId===null,
  zeroBudget:result?.pilotBudget?.usage?.totalAutomatedSubmissions===0&&
    result?.pilotBudget?.usage?.p1Continuations===0&&result?.pilotBudget?.usage?.nextChatSubmissions===0,
  tasksApproved:result?.tasks?.length===2&&result.tasks.every(t=>t.implementationStatus==='approved'&&t.reviewStatus==='not_started')};
 const activityMap=new Map();let signals=0,sendActivities=0,unknownOrPending=0;
 for(const x of events){
  if(x.workflowExecutionSignaledEventAttributes)signals++;
  if(x.activityTaskScheduledEventAttributes){
   const name=x.activityTaskScheduledEventAttributes.activityType?.name;
   activityMap.set(String(x.eventId),{name,done:false,failed:false,message:null});
   if(!allowed.has(name))sendActivities++;
  }
  for(const key of ['activityTaskCompletedEventAttributes','activityTaskFailedEventAttributes',
    'activityTaskTimedOutEventAttributes','activityTaskCanceledEventAttributes']){
   if(!x[key])continue;const a=activityMap.get(String(x[key].scheduledEventId));
   if(a){a.done=true;a.failed=key==='activityTaskFailedEventAttributes';
    a.message=x[key].failure?.message??null;
    if(key==='activityTaskTimedOutEventAttributes'||key==='activityTaskCanceledEventAttributes')unknownOrPending++}
  }
 }
 const arr=[...activityMap.values()];
 const history={closed:events.some(e=>e.workflowExecutionCompletedEventAttributes),
  eventCount:events.length,signals,activities:arr.length,
  load:arr.filter(x=>x.name==='loadSupervisorProject'&&x.done&&!x.failed).length,
  publish:arr.filter(x=>x.name==='publishSupervisorState'&&x.done&&!x.failed).length,
  adoptFailures:arr.filter(x=>x.name==='adoptStartedWork'&&x.failed).length,
  adoptMessageMatches:arr.some(x=>x.name==='adoptStartedWork'&&x.failed&&
    x.message==='Original visible task/worktree identity is missing or ambiguous'),
  sendActivities,unknownOrPending:unknownOrPending+arr.filter(x=>!x.done||x.failed&&x.name!=='adoptStartedWork').length};
 const db=new DatabaseSync(cfg.db,{readOnly:true});let rows;
 try{db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=0');
  rows=db.prepare('SELECT work_id,state,outcome,started_at,reported_at,begin_json,finish_json FROM control_work_reports WHERE owner_id=? AND device_id=? AND started_at>=? ORDER BY started_at')
    .all(project.ownerId,project.deviceId,Date.parse(claim.claimedAt));
 }finally{db.close()}
 const x=rows[0],b=x?JSON.parse(x.begin_json):{},f=x?.finish_json?JSON.parse(x.finish_json):{};
 const source={count:rows.length,id:x?.work_id??null,
  reportedPartial:x?.state==='reported'&&x?.outcome==='partial',
  taskAndWorktreeMatch:b.taskTitle==='Fresh Attended Pilot P1 — '+TASK&&f.workingDirectory===REPO,
  timeMatch:x?.started_at>=Date.parse(claim.claimedAt)&&
    x?.started_at<=desc.closeTime.getTime()&&
    x?.reported_at>desc.closeTime.getTime()&&x.reported_at>=x.started_at};
 const inboxBytes=await readFile(join(cfg.directory,'inbox.json'));
 const received=Object.values(JSON.parse(inboxBytes).events??{});
 const inbox={twoEvents:received.length===2&&received.every(z=>z.event?.workId===SESSION),
  startedDelivered:received.some(z=>z.event?.kind==='work_started'&&z.delivery==='delivered'),
  reportedTargetClosed:received.some(z=>z.event?.kind==='work_reported'&&z.delivery==='target_closed')};
 const bytes=await readFile(P1);let p2Absent=false;
 try{await stat(P2)}catch(e){if(e.code==='ENOENT')p2Absent=true;else throw e}
 const text=bytes.toString('utf8');
 const artifact={p1Hash:sha(bytes),
  correctCheckpoint:text.includes(TASK)&&text.includes('Stage 1: complete.')&&
   text.includes('Stage 2: pending.')&&!text.includes('\n## Completion\n'),p2Absent};
 const tabs=(await browserPages()).filter(t=>t.id===TAB),tab=tabs[0];
 fail(tabs.length===1&&tab.url===CHAT&&tab.webSocketDebuggerUrl,'original browser tab changed');
 const observed=await browserEvaluate(tab,supervisorIdentityExpression(CHAT));
 const incidentBytes=await readFile(join(root,INCIDENT)),incidentText=incidentBytes.toString('utf8');
 const browser={exactTabAndChat:tab.id===TAB&&tab.url===CHAT,
  newProjectConversation:CHAT.includes('/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/'),
  archivedConflictReportMatches:sha(incidentBytes)===INCIDENT_SHA&&
   [W,RUN,TASK,OLD,'old worktree',TAB,CHAT.split('/').at(-1)].every(s=>incidentText.includes(s)),
  liveTaskIdCurrentlyMatchesNew:observed?.taskId===TASK};
 const folder=join(root,'.state/flowdeck-supervisor');
 const allFiles=[...(await readdir(folder)).filter(x=>/^(send-event-|send-phase-|sent-).*\.json$/.test(x)).map(n=>join(folder,n)),
   ...(await readdir(join(folder,'send-recovery'))).filter(n=>n.endsWith('.json')).map(n=>join(folder,'send-recovery',n))];
 let newSenderRecords=0,changedSinceClaim=0;const fileProof=[];
 for(const file of allFiles){
  const data=await readFile(file),meta=await stat(file);
  if([P,SESSION,W].some(s=>data.includes(s)))newSenderRecords++;
  if(meta.mtimeMs>=Date.parse(claim.claimedAt))changedSinceClaim++;
  fileProof.push([file.slice(root.length+1),sha(data),meta.mtimeMs]);
 }
 const journals={newSenderRecords,changedSinceClaim};
 const {stdout}=await exec('/bin/ps',['-axo','pid=,command='],{timeout:8000,maxBuffer:4000000});
 const senderProcesses=stdout.split('\n').filter(s=>/^\s*\d+\s+(?:\/[^\s]+\/)?node\s+(?:\/[^\s]+\/)?scripts\/flowdeck-(?:launch|supervisor|work-events|resume-send)\.mjs\b/.test(s)&&
   /\b(worker|follow|start|release|--attempt)\b|flowdeck-launch\.mjs/.test(s)).length;
 const evidence={claimValid,workflow,history,source,inbox,artifact,browser,journals,
  running:{workflows:running,senderProcesses}};
 const assessment=assessConflictedP1Closeout(evidence);
 const evidenceDigest=sha(JSON.stringify({evidence,claimHash:sha(claimBytes),
  files:fileProof,incidentHash:sha(incidentBytes),inboxHash:sha(inboxBytes),sourceHash:sha(JSON.stringify(rows)),
  configHash:sha(await readFile(join(root,CONFIG))),
  enrollmentHash:sha(await readFile(join(root,'.state/flowdeck-supervisor/projects.json'))) }));
 return {assessment,evidence,evidenceDigest,claimSha256:sha(claimBytes),claimFile};
}
export async function main(args=process.argv.slice(2)){
 const [mode,...options]=args;
 fail(mode==='preview'||mode==='release','expected preview or release');
 if(mode==='preview')fail(options.length===0,'preview takes no parameters');
 else fail(options.length===2&&options.every(x=>/^[0-9a-f]{64}$/.test(x)),'release requires two preview digests');
 const a=await collect();
 const summary={mode,workflowId:W,runId:RUN,projectId:P,ready:a.assessment.ready,
  blockers:a.assessment.blockers,claimSha256:a.claimSha256,evidenceDigest:a.evidenceDigest,
  sourceSessions:a.evidence.source.count,historyEvents:a.evidence.history.eventCount,
  scheduledActivities:a.evidence.history.activities,automatedSends:a.evidence.history.sendActivities,
  workInboxEvents:2,checkpointSha256:a.evidence.artifact.p1Hash,
  artifactChecks:a.evidence.artifact,browserChecks:a.evidence.browser,
  activeSenders:a.evidence.running.senderProcesses};
 if(mode==='preview'){console.log(JSON.stringify(summary,null,2));return summary}
 fail(a.assessment.ready,'evidence incomplete');
 fail(options[0]===a.claimSha256&&options[1]===a.evidenceDigest,'evidence changed since preview');
 const suffix=sha(JSON.stringify([W,RUN])).slice(0,20);
 const lock=a.claimFile+'.conflicted-'+suffix+'.lock',fd=await open(lock,'wx',0o600);
 try{await fd.writeFile(JSON.stringify({schema:'flowdeck.conflicted-lock/v1',workflowId:W,runId:RUN})+'\n');await fd.sync()}finally{await fd.close()}
 // Never automatically clear failed locks.
 const second=await collect();
 fail(second.assessment.ready&&second.claimSha256===a.claimSha256&&
   second.evidenceDigest===a.evidenceDigest,'evidence changed under lock');
 const dir=join(root,'.state/flowdeck-supervisor/completed-closeouts');
 await mkdir(dir,{recursive:true,mode:0o700});
 const intent=join(dir,'conflicted-intent-'+suffix+'.json');
 const archive=join(dir,'conflicted-claim-'+suffix+'.json');
 const receipt=join(dir,'conflicted-retired-'+suffix+'.json');
 const record={schema:'flowdeck.conflicted-p1-retirement/v1',workflowId:W,runId:RUN,
  projectId:P,claimSha256:a.claimSha256,evidenceDigest:a.evidenceDigest,
  realPartialSession:SESSION,checkpointPath:P1,checkpointSha256:P1SHA,
  oldIdentityObserved:true,zeroAutomatedSends:true,
  historicalState:'COMPLETED / needs_attention / paused',
  archivedClaim:archive,originalClaim:a.claimFile,createdAt:new Date().toISOString()};
 async function exclusive(path,obj){const f=await open(path,'wx',0o600);
  try{await f.writeFile(JSON.stringify(obj,null,2)+'\n');await f.sync()}finally{await f.close()}}
 await exclusive(intent,{...record,state:'validated_before_archive'});
 fail(sha(await readFile(a.claimFile))===a.claimSha256,'claim bytes changed');
 await rename(a.claimFile,archive);
 const df=await open(dir,'r');try{await df.sync()}finally{await df.close()}
 await exclusive(receipt,{...record,state:'retired',retiredAt:new Date().toISOString()});
 console.log(JSON.stringify({...summary,mode:'release',state:'retired',archivedClaim:archive,receipt},null,2));
 return {...summary,state:'retired',receipt};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href)
 main().catch(e=>{console.error(String(e?.message??e));process.exitCode=3});
