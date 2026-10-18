#!/usr/bin/env node
/** Exact one-time, read-only-preview-first archival of the completed two-send pilot.
 * No activity, browser interaction beyond read-only CDP, workflow signal/start or Send.
 * A failure retains the original claim; a successful release atomically archives it.
 */
import {readFile,readdir,stat,open,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Connection,Client} from '@temporalio/client';
import {DatabaseSync} from 'node:sqlite';
import {loadSupervisorProject} from '../dist/flowdeck-projects.js';
import {supervisorIdentityExpression} from '../dist/flowdeck-supervisor-activities.js';
import {normalizeComposerText} from '../dist/sashai-dispatch-evidence.js';
import {attemptScopePath} from './flowdeck-attempt-scope.mjs';

const root=resolve(import.meta.dirname,'..'), hash=x=>createHash('sha256').update(x).digest('hex');
const exec=promisify(execFile);
const projectId='sashai-fresh-attended-20261017-05';
const workflowId='flowdeck-supervisor-'+projectId,runId='01a14a1d-f9ee-7582-88ad-80ab387a96b3';
const worktree='/Users/test/Documents/work/sashai-flowdeck-fresh-attended-20261017-05';
const projectUrl='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const chatRoot='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/';
const specs=[
 {taskId:'sashai-fresh-attended-p1-20261017-05',dispatch:'afebcd7f-b314-4ba4-83b0-99c0c40e196e',phaseKind:'continue',
  tabId:'333B7B9508008C3E80180DF0B0C60C5A',chatUrl:chatRoot+'6ad37cb8-30b4-83ed-a88e-2acce9293ead',
  beforeWorkId:'eb97969d-7dd2-40bd-a3d0-3fb12e7938cc',userTurns:2,finalPhase:'reconciled',
  checkpoint:join(worktree,'docs/flowdeck-fresh-attended-2026-10-17-05/p1.md'),
  checkpointSha:'22b03ec81393167b5c184af002a47b89392da18744c940f76bbed795faa910f2'},
 {taskId:'sashai-fresh-attended-p2-20261017-05',dispatch:'5949b7e1-d8f1-4ffd-962c-98adfcf6d3fd',phaseKind:'next',
  tabId:'E7FD36E3297075770A47E0F0562799F7',chatUrl:chatRoot+'6ad37ed5-d918-83ed-a3a4-74b7055c17ba',
  beforeWorkId:'4df62349-12bc-4850-90b4-31df4eb531fc',userTurns:1,finalPhase:'submitted',
  checkpoint:join(worktree,'docs/flowdeck-fresh-attended-2026-10-17-05/p2.md'),
  checkpointSha:'a1076fc2ffbf758518a1324b5fc11ffa645ced3e96b525bcdbcb1d71fb514e68'}
];
const workIds=[specs[0].beforeWorkId,specs[1].beforeWorkId,'cbde20cf-e87e-4789-bd93-f03790b10ddb'];
const activityNames=new Set(['loadSupervisorProject','publishSupervisorState','adoptStartedWork','observeWorkResult',
 'sendContinuationOnce','reconcileSubmittedTurn','startNextTaskOnce']);
const check=(condition,msg)=>{if(!condition)throw Error('Sent-closeout refused: '+msg)};
const digestFiles=async files=>{const out=[];for(const path of files){const content=await readFile(path);out.push({path:path.slice(root.length+1),sha256:hash(content)})}return out};

export function assessSentCloseout(e){
 const blockers=[],require=(v,label)=>{if(!v)blockers.push(label)};
 require(e?.scopeValid===true,'wrong_scope');
 require(e?.terminal?.exact===true&&e.terminal.paused===true&&e.terminal.budgetExact===true&&e.terminal.p1ReviewPending===true&&e.terminal.p2HistoricallyUnstarted===true,
  'unexpected_terminal_result');
 require(e?.history?.closed===true&&e.history?.activityCount>0&&e.history?.unresolved===0&&e.history?.unknown===0&&
  e.history?.p1SentActivities===1&&e.history?.p2SentActivities===1&&e.history?.recoveryActivities===0&&
  e.history?.failedReconciliations===1&&e.history?.failedReconciliationReason===true,
  'activity_history_not_reconciled');
 require(e?.journals?.dispatches===2&&e.journals?.p1Reconciled===true&&e.journals?.p2SubmittedNotReconciled===true&&
  e.journals?.fullSealsMatch===true&&e.journals?.noExtraAttemptDispatches===true&&e.journals?.noExtraAttemptSendClaims===true,
  'send_journals_not_reconciled');
 require(e?.source?.count===3&&e.source?.workIdsExact===true&&e.source?.outcomesExact===true&&
  e.source?.taskAndWorktreeMatch===true&&e.source?.withinAttemptWindow===true,'source_work_sessions_not_reconciled');
 require(e?.inbox?.exactSix===true&&e.inbox?.p1Delivered===true&&e.inbox?.p2TargetClosed===true,'event_inbox_not_reconciled');
 require(e?.browser?.bothExactTabs===true&&e.browser?.taskAndWorktreeMatch===true&&e.browser?.userCountsMatch===true&&
  e.browser?.sealedPromptsMatch===true&&e.browser?.distinctChats===true,'browser_and_prompt_seals_not_verified');
 require(e?.outputs?.bothHashesMatch===true&&e.outputs?.contentsTaskMatched===true,'output_artifacts_changed');
 require(e?.operations?.runningWorkflows===0&&e.operations?.localSenders===0,'active_workflow_or_local_sender');
 return {ready:blockers.length===0,blockers};
}
async function domIdentity(spec){
 const response=await fetch('http://127.0.0.1:9222/json/list',{signal:AbortSignal.timeout(5000)});
 check(response.ok,'browser CDP not reachable');
 const matches=(await response.json()).filter(t=>t.id===spec.tabId);
 check(matches.length===1&&matches[0].url===spec.chatUrl&&matches[0].webSocketDebuggerUrl,
  'exact original chat tab missing/changed');
 const ws=new WebSocket(matches[0].webSocketDebuggerUrl);
 const identity=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{ws.close();reject(Error('Read-only browser identity timed out'))},7000);
  ws.addEventListener('open',()=>ws.send(JSON.stringify({id:19,method:'Runtime.evaluate',
    params:{expression:supervisorIdentityExpression(spec.chatUrl),returnByValue:true}})));
  ws.addEventListener('message',m=>{const v=JSON.parse(String(m.data));if(v.id!==19)return;
    clearTimeout(timeout);ws.close();
    if(v.error||v.result?.exceptionDetails)reject(Error('Read-only DOM identity unavailable'));
    else resolve(v.result?.result?.value);
  });
  ws.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Read-only browser socket error'))});
 });
 const latestHash=typeof identity?.latestUserText==='string'?
   hash(normalizeComposerText(identity.latestUserText)):null;
 const path=(()=>{try{const u=new URL(identity?.projectUrl);return u.origin==='https://chatgpt.com'&&
   u.pathname.replace(/\/project\/?$/,'').replace(/-dr-sashai$/i,'')==='/g/g-p-6ab28bdd7fbc8191b581316ff09da79d'}catch{return false}})();
 return {tabId:matches[0].id,chatUrl:matches[0].url,taskMatch:identity?.taskId===spec.taskId,
  worktreeMatch:identity?.worktree===worktree,projectMatch:path,
  userTurns:identity?.latestUserTurns??null,promptDigest:latestHash};
}
async function runningProcesses(){
 const {stdout}=await exec('/bin/ps',['-axo','pid=,command='],{timeout:8000,maxBuffer:4194304});
 // Match the executable itself, not the parent shell containing an audit command.
 return stdout.split('\n').filter(s=>/^\s*\d+\s+(?:\/[^\s]+\/)?node\s+(?:\/[^\s]+\/)?scripts\/flowdeck-(?:launch|supervisor|work-events|resume-send)\.mjs\b/.test(s)&&
  /\b(worker|follow|start|release|--attempt)\b|flowdeck-launch\.mjs/.test(s)).length;
}
async function collect(){
 const p=await loadSupervisorProject(projectId);
 check(p.id===projectId&&p.repo===worktree&&p.projectUrl===projectUrl&&p.initialTaskId===specs[0].taskId&&
  p.tasks.length===2&&p.tasks[1].id===specs[1].taskId,'production task enrollment changed');
 const scopePath=attemptScopePath(root,p),claimBytes=await readFile(scopePath),claim=JSON.parse(claimBytes);
 const scopeValid=claim.schema==='flowdeck.attempt-scope/v1'&&claim.workflowId===workflowId&&
  claim.projectId===projectId&&claim.ownerId===p.ownerId&&claim.deviceId===p.deviceId&&
  claim.profile==='helium-profile-4'&&claim.disposition==='unresolved_until_audited_reconciliation';
 check(scopeValid,'owner-scope claim mismatch');
 const config=JSON.parse(await readFile(join(root,'.state/flowdeck-human-pilot-20261017-05-events.json'),'utf8'));
 check(config['workflow-id']===workflowId&&config['project-id']===projectId&&config.owner===p.ownerId&&config.device===p.deviceId,
   'event config ownership changed');
 let c;let terminal,history,runningWorkflows=0;
 try{
  c=await Connection.connect({address:config.address,connectTimeout:'5 seconds'});
  const client=new Client({connection:c,namespace:config.namespace});
  const handle=client.workflow.getHandle(workflowId,runId),desc=await handle.describe();
  const events=(await handle.fetchHistory()).events;
  const result=desc.status.name==='COMPLETED'?await handle.result():null;
  terminal={exact:desc.workflowId===workflowId&&desc.runId===runId&&desc.type==='flowdeckSupervisor'&&desc.status.name==='COMPLETED',
   paused:result?.phase==='needs_attention'&&result?.status==='paused'&&result?.blocker==='Submitted turn reconciliation found an identity or prompt mismatch.',
   budgetExact:result?.pilotBudget?.usage?.p1Continuations===1&&result?.pilotBudget?.usage?.nextChatSubmissions===1&&result?.pilotBudget?.usage?.totalAutomatedSubmissions===2,
   p1ReviewPending:result?.tasks?.[0]?.id===specs[0].taskId&&result?.tasks?.[0]?.implementationStatus==='implementation_done'&&result?.tasks?.[0]?.reviewStatus==='review_pending',
   p2HistoricallyUnstarted:result?.tasks?.[1]?.id===specs[1].taskId&&result?.tasks?.[1]?.implementationStatus==='approved'&&result?.tasks?.[1]?.reviewStatus==='not_started',
   closeAt:desc.closeTime?.getTime()??null};
  const activities=new Map(),statuses={p1SentActivities:0,p2SentActivities:0,recoveryActivities:0,
    failedReconciliations:0,failedReconciliationReason:false,unresolved:0,unknown:0,activityCount:0};
  for(const e of events){
   if(e.activityTaskScheduledEventAttributes){
    const name=e.activityTaskScheduledEventAttributes.activityType?.name;
    activities.set(String(e.eventId),{name,terminal:null});
    if(!activityNames.has(name))statuses.unknown++;
    if(name==='sendContinuationOnce')statuses.p1SentActivities++;
    if(name==='startNextTaskOnce')statuses.p2SentActivities++;
    if(name==='recoverPreSendOnce')statuses.recoveryActivities++;
   }
   for(const [key,status]of [['activityTaskCompletedEventAttributes','completed'],['activityTaskFailedEventAttributes','failed'],
     ['activityTaskTimedOutEventAttributes','timeout'],['activityTaskCanceledEventAttributes','canceled']]){
    if(!e[key])continue;
    const a=activities.get(String(e[key].scheduledEventId));
    if(a){
      a.terminal=status;
      if(a.name==='reconcileSubmittedTurn'&&status==='failed'){
       statuses.failedReconciliations++;
       if(String(e[key].failure?.message??'').includes('Submitted target identity changed'))
        statuses.failedReconciliationReason=true;
      }
    }
   }
  }
  statuses.activityCount=activities.size;
  statuses.unresolved=[...activities.values()].filter(a=>!a.terminal||a.terminal==='timeout'||a.terminal==='canceled').length;
  statuses.unknown+=[...activities.values()].filter(a=>a.terminal==='failed'&&a.name!=='reconcileSubmittedTurn').length;
  history={closed:events.some(e=>e.workflowExecutionCompletedEventAttributes),...statuses,
    events:events.length,lastEventId:String(events.at(-1)?.eventId)};
  for await(const row of client.workflow.list({query:"ExecutionStatus = 'Running'"})){
   if(row.type==='flowdeckSupervisor'||row.type==='flowdeckRecoverSend'||row.workflowId?.startsWith('flowdeck-supervisor-'))runningWorkflows++;
  }
 }finally{await c?.close()}
 const db=new DatabaseSync(config.db,{readOnly:true});
 let rows;try{
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=0');
  rows=db.prepare('SELECT work_id,state,outcome,started_at,reported_at,begin_json,finish_json FROM control_work_reports WHERE owner_id=? AND device_id=? AND started_at>=? ORDER BY started_at')
   .all(p.ownerId,p.deviceId,Date.parse(claim.claimedAt));
 }finally{db.close()}
 const source={count:rows.length,workIdsExact:rows.length===3&&rows.every((r,i)=>r.work_id===workIds[i]),
  outcomesExact:rows.length===3&&rows.every((r,i)=>r.state==='reported'&&r.outcome===(i===0?'partial':'success')),
  taskAndWorktreeMatch:rows.length===3&&rows.every((r,i)=>{
   const b=JSON.parse(r.begin_json),f=JSON.parse(r.finish_json);
   return f?.workingDirectory===worktree&&b?.taskTitle===(i===0?
      specs[0].taskId+' — Fresh Attended Pilot P1':p.tasks[i===1?0:1].title);
  }),
  withinAttemptWindow:rows.length===3&&rows.every(r=>r.started_at>=Date.parse(claim.claimedAt)&&
    r.reported_at>=r.started_at&&r.started_at<=(terminal.closeAt??0)+60000&&r.reported_at<=(terminal.closeAt??0)+20*60000)&&
    rows[2].started_at>(terminal.closeAt??Infinity)};
 const inboxJSON=await readFile(join(config.directory,'inbox.json')),entries=Object.values(JSON.parse(inboxJSON).events??{});
 const inbox={exactSix:entries.length===6&&workIds.every(id=>{
   const paired=entries.filter(e=>e.event?.workId===id);
   return paired.length===2&&paired.some(e=>e.event?.kind==='work_started')&&
    paired.some(e=>e.event?.kind==='work_reported');
  }),
  p1Delivered:entries.filter(e=>workIds.slice(0,2).includes(e.event?.workId)).length===4&&
    entries.filter(e=>workIds.slice(0,2).includes(e.event?.workId)).every(e=>e.delivery==='delivered'),
  p2TargetClosed:entries.filter(e=>e.event?.workId===workIds[2]).length===2&&
    entries.filter(e=>e.event?.workId===workIds[2]).every(e=>e.delivery==='target_closed')};
 const store=join(root,'.state/flowdeck-supervisor'),log=join(store,'send-recovery');
 const rootNames=await readdir(store),logNames=await readdir(log),fileProofs=[];
 const records=[],browserProof=[],artifactProof=[];
 for(const spec of specs){
  const claimFile=join(log,'dispatch-'+spec.dispatch+'-00-claimed.json'),start=JSON.parse(await readFile(claimFile));
  const expected=spec.finalPhase==='reconciled'?['claimed','preparing','staged','click_attempted','submitted','reconciled']:
   ['claimed','preparing','staged','click_attempted','submitted'];
  const found=logNames.filter(n=>n.startsWith('dispatch-'+spec.dispatch+'-')).sort();
  const required=expected.map((phase,i)=>'dispatch-'+spec.dispatch+'-'+String(i).padStart(2,'0')+'-'+phase+'.json');
  const steps=required.map(n=>join(log,n)),entriesJson=await Promise.all(steps.map(async path=>JSON.parse(await readFile(path))));
  const eventHash=start.eventHash,phaseHash=start.phaseHash;
  const rootFiles=[
   join(store,'send-event-'+eventHash+'.json'),join(store,'send-phase-'+phaseHash+'.json'),
   join(store,'sent-'+eventHash+'.json'),
   join(store,'binding-'+hash(JSON.stringify([projectId,spec.beforeWorkId]))+'.json')];
  const [sendEvent,sendPhase,sent,record]=await Promise.all(rootFiles.map(async f=>JSON.parse(await readFile(f))));
  const latest=await domIdentity(spec);
  const content=await readFile(spec.checkpoint),artifact={sha256:hash(content),
   taskPresent:content.toString('utf8').includes(spec.taskId)};
  fileProofs.push(...steps,...rootFiles,spec.checkpoint);
  records.push({taskId:spec.taskId,phaseKind:start.phaseKind,
   exactSteps:JSON.stringify(found)===JSON.stringify(required),
   metadataMatch:entriesJson.every((e,i)=>e.dispatchId===spec.dispatch&&e.projectId===projectId&&
    e.taskId===spec.taskId&&e.eventHash===eventHash&&e.phaseHash===phaseHash&&e.phase===expected[i]),
   eventAndPhaseMatch:start.event?.workId===spec.beforeWorkId&&
    start.eventId===sendPhase.eventId&&sendPhase.dispatchId===spec.dispatch&&
    sendEvent.dispatchId===spec.dispatch&&sendEvent.workId===spec.beforeWorkId,
   sealAndBindingMatch:sent.promptHash===record.expectedPromptHash&&
    sent.expectedUserTurns===spec.userTurns&&record.users===spec.userTurns&&
    record.binding.taskId===spec.taskId&&record.binding.tabId===spec.tabId&&
    record.binding.chatUrl===spec.chatUrl&&record.dispatchId===spec.dispatch&&
    record.ready===(spec.finalPhase==='reconciled')&&record.pending===(spec.finalPhase!=='reconciled')&&
    latest.promptDigest===sent.promptHash,
   tabMatch:latest.tabId===spec.tabId&&latest.chatUrl===spec.chatUrl&&latest.taskMatch&&
    latest.worktreeMatch&&latest.projectMatch&&latest.userTurns===spec.userTurns,
   artifactMatch:artifact.sha256===spec.checkpointSha&&artifact.taskPresent});
  browserProof.push(latest);
  artifactProof.push(artifact);
 }
 const remainingDispatches=logNames.filter(n=>n.startsWith('dispatch-')&&n.endsWith('.json')&&
  !specs.some(s=>n.startsWith('dispatch-'+s.dispatch+'-')));
 const unknownAttemptDispatches=[];
 for(const name of remainingDispatches){
  const v=JSON.parse(await readFile(join(log,name)));
  if(v.projectId===projectId)unknownAttemptDispatches.push(name);
 }
 const sendFiles=rootNames.filter(n=>/^(send-event-|send-phase-|sent-).*\.json$/.test(n));
 const extraRoot=[];
 for(const name of sendFiles){
  const path=join(store,name),v=JSON.parse(await readFile(path)),raw=JSON.stringify(v);
  if(raw.includes(projectId)||specs.some(s=>raw.includes(s.dispatch))){
   if(!fileProofs.includes(path))extraRoot.push(name);
  }
 }
 const journals={dispatches:records.length,p1Reconciled:records[0].exactSteps&&records[0].phaseKind==='continue',
  p2SubmittedNotReconciled:records[1].exactSteps&&records[1].phaseKind==='next',
  fullSealsMatch:records.every(v=>v.metadataMatch&&v.eventAndPhaseMatch&&v.sealAndBindingMatch),
  noExtraAttemptDispatches:unknownAttemptDispatches.length===0,noExtraAttemptSendClaims:extraRoot.length===0};
 const browser={bothExactTabs:browserProof.every(v=>v.tabId&&v.chatUrl),
  taskAndWorktreeMatch:browserProof.every(v=>v.taskMatch&&v.worktreeMatch&&v.projectMatch),
  userCountsMatch:browserProof.every((v,i)=>v.userTurns===specs[i].userTurns),
  sealedPromptsMatch:records.every(v=>v.sealAndBindingMatch),
  distinctChats:browserProof[0].chatUrl!==browserProof[1].chatUrl};
 const outputs={bothHashesMatch:records.every(v=>v.artifactMatch),contentsTaskMatched:artifactProof.every(a=>a.taskPresent)};
 const operations={runningWorkflows,localSenders:await runningProcesses()};
 const evidence={scopeValid,terminal,history,journals,source,inbox,browser,outputs,operations};
 const assessment=assessSentCloseout(evidence);
 const files=await digestFiles([...fileProofs,
   join(root,'.state/flowdeck-supervisor/projects.json'),
   join(root,'.state/flowdeck-human-pilot-20261017-05-events.json')]);
 const digest=hash(JSON.stringify({evidence,files,claimSha256:hash(claimBytes),inboxSha256:hash(inboxJSON),
   sourceRowsSha256:hash(JSON.stringify(rows)),temporalRunId:runId}));
 return {assessment,evidence,digest,claimSha256:hash(claimBytes),claimPath:scopePath,files};
}
export async function main(argv=process.argv.slice(2)){
 const [mode,...args]=argv;
 check(mode==='preview'||mode==='release','expected preview or release');
 if(mode==='preview')check(args.length===0,'preview takes no arguments');
 else check(args.length===2&&args.every(x=>/^[a-f0-9]{64}$/.test(x)),'release requires exact claim SHA and evidence digest');
 const before=await collect();
 const result={mode,projectId,workflowId,runId,ready:before.assessment.ready,
  blockers:before.assessment.blockers,claimSha256:before.claimSha256,evidenceDigest:before.digest,
  historyEventCount:before.evidence.history.events,historyActivityCount:before.evidence.history.activityCount,
  sourceWorkSessions:before.evidence.source.count,dispatches:before.evidence.journals.dispatches,
  P1Reconciled:before.evidence.journals.p1Reconciled,
  P2SubmittedButHistoricallyUnreconciled:before.evidence.journals.p2SubmittedNotReconciled,
  browserSealsVerified:before.evidence.browser.sealedPromptsMatch,
  localSenders:before.evidence.operations.localSenders};
 if(mode==='preview'){console.log(JSON.stringify(result,null,2));return result;}
 check(before.assessment.ready,'evidence not reconciled; no release');
 check(args[0]===before.claimSha256&&args[1]===before.digest,'claim/evidence differs from preview');
 // Per-run writer lock: older completed pilots may retain other distinct lock files.
 const suffix=hash(JSON.stringify([workflowId,runId])).slice(0,20);
 const lock=before.claimPath+'.sent-retirement-'+suffix+'.lock',fd=await open(lock,'wx',0o600);
 try{await fd.writeFile(JSON.stringify({schema:'flowdeck.sent-closeout-lock/v1',workflowId,runId})+'\n');await fd.sync()}
 finally{await fd.close()}
 // On any failure, leave lock as a durable stop; never retry blindly.
 const after=await collect();
 check(after.assessment.ready&&after.claimSha256===before.claimSha256&&after.digest===before.digest,
   'evidence changed during locked validation');
 const folder=join(root,'.state/flowdeck-supervisor/completed-closeouts');
 await mkdir(folder,{recursive:true,mode:0o700});
 const intent=join(folder,'sent-intent-'+suffix+'.json'),
  archive=join(folder,'sent-claim-'+suffix+'.json'),
  receipt=join(folder,'sent-retired-'+suffix+'.json');
 const record={schema:'flowdeck.sent-retirement/v1',projectId,workflowId,runId,
  claimSha256:before.claimSha256,evidenceDigest:before.digest,
  preservedTemporalResult:'needs_attention / paused',usedAutomatedBudget:2,
  P1Implementation:'implementation_done / review_pending',
  P2HistoricalSupervisorStatus:'approved / not_started',
  P2ActualSourceSessionAfterSupervisorClosed:true,
  dispatches:specs.map(s=>({id:s.dispatch,taskId:s.taskId,phase:s.finalPhase,tabId:s.tabId,chatUrl:s.chatUrl})),
  workIds,artifactProofs:specs.map(s=>({path:s.checkpoint,sha256:s.checkpointSha})),
  sourceWorkSessionCount:before.evidence.source.count,historyEventCount:before.evidence.history.events,
  claimArchive:archive,claimOriginalPath:before.claimPath,preparedAt:new Date().toISOString()};
 async function exclusive(path,body){const f=await open(path,'wx',0o600);
  try{await f.writeFile(JSON.stringify(body,null,2)+'\n');await f.sync()}finally{await f.close()}}
 await exclusive(intent,{...record,state:'validated_before_archive'});
 check(hash(await readFile(before.claimPath))===before.claimSha256,'claim changed before rename');
 await rename(before.claimPath,archive);
 const dir=await open(folder,'r');try{await dir.sync()}finally{await dir.close()}
 await exclusive(receipt,{...record,state:'retired',retiredAt:new Date().toISOString()});
 console.log(JSON.stringify({...result,mode:'release',state:'retired',claimArchive:archive,receipt},null,2));
 return {...result,state:'retired',receipt};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href)
 main().catch(error=>{console.error(String(error?.message??error));process.exitCode=3});
