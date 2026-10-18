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
const projectId='sashai-fresh-attended-20261018-08';
const workflowId='flowdeck-supervisor-'+projectId,runId='01a14c12-e1ac-73c4-b36b-b6ee9eeb7039';
const worktree='/Users/test/Documents/work/sashai-flowdeck-fresh-attended-20261018-08';
const projectUrl='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const chatRoot='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/';
const specs=[
 {taskId:'sashai-fresh-attended-p1-20261018-08',dispatch:'9c14629e-88f7-4032-9a99-b89e130ac957',phaseKind:'continue',
  tabId:'99E95EB2191D843134CB42554C52C870',chatUrl:chatRoot+'6ad3fce4-b550-83ed-8cbd-05e633f53d0e',
  beforeWorkId:'944ff439-4b10-4f74-823b-c490498c9039',userTurns:2,finalPhase:'reconciled',
  checkpoint:join(worktree,'docs/flowdeck-fresh-attended-2026-10-18-08/p1.md'),
  checkpointSha:'0de1c4b90d280e2211262a2f2a413c53ba677d2d40b0f75618e6d164df62fd97'},
 {taskId:'sashai-fresh-attended-p2-20261018-08',dispatch:'520e8d95-5e5e-469a-85a0-32214557cfb5',phaseKind:'next',
  tabId:'6635984CD381A0583C142821617E5026',chatUrl:chatRoot+'6ad3fde3-c060-83ed-b9c9-e94a9b80d35c',
  beforeWorkId:'7108754b-dec5-4e7c-a938-ae9d3d4e3cc8',userTurns:1,finalPhase:'reconciled',
  checkpoint:join(worktree,'docs/flowdeck-fresh-attended-2026-10-18-08/p2.md'),
  checkpointSha:'49c8c41d15d641037b73bf9482350463f839800699785413a8c4e43a06d8d486'}
];
const workIds=[specs[0].beforeWorkId,specs[1].beforeWorkId,'e5e1ee97-342c-4015-a570-2d60995797f4'];
const manualStart='.state/flowdeck-supervisor/manual-start-8fc7af0d71b77355c5efcb52ba5cd0b69544931929946117fcf27ad523bce19e.json';
const expectedInitialHash='7db786d81787d948009d007850454697ca5243aad87fe4560f8af0b223898afa';
const activityNames=new Set(['loadSupervisorProject','publishSupervisorState','adoptStartedWork','observeWorkResult',
 'sendContinuationOnce','reconcileSubmittedTurn','startNextTaskOnce']);
const check=(condition,msg)=>{if(!condition)throw Error('Successful-cycle closeout refused: '+msg)};
const digestFiles=async files=>{const out=[];for(const path of files){const content=await readFile(path);out.push({path:path.slice(root.length+1),sha256:hash(content)})}return out};

export function assessSuccessfulCycleCloseout(e){
 const blockers=[],require=(v,label)=>{if(!v)blockers.push(label)};
 require(e?.scopeValid===true,'wrong_scope');
 require(e?.terminal?.exact===true&&e.terminal.success===true&&e.terminal.budgetExact===true&&
  e.terminal.bothImplementationDone===true&&e.terminal.reviewPending===true,
  'unexpected_success_result');
 require(e?.history?.closed===true&&e.history.eventCount===977&&e.history.signals===6&&
  e.history.activityCount===98&&e.history.unresolved===0&&e.history.unknown===0&&
  e.history.p1SentActivities===1&&e.history.p2SentActivities===1&&e.history.recoveryActivities===0&&
  e.history.allDispatchesCompleted===true,'activity_history_not_reconciled');
 require(e?.journals?.dispatches===2&&e.journals.p1Reconciled===true&&e.journals.p2Reconciled===true&&
  e.journals.fullSealsMatch===true&&e.journals.noExtraAttemptDispatches===true&&
  e.journals.noExtraAttemptSendClaims===true,'send_journals_not_reconciled');
 require(e?.source?.count===3&&e.source.workIdsExact===true&&e.source.outcomesExact===true&&
  e.source.taskAndWorktreeMatch===true&&e.source.withinAttemptWindow===true,'source_work_sessions_not_reconciled');
 require(e?.inbox?.exactSix===true&&e.inbox.allSixDelivered===true&&e.inbox.outcomesMatch===true&&
  e.inbox.noPending===true,'event_inbox_not_reconciled');
 require(e?.browser?.bothExactTabs===true&&e.browser.taskAndWorktreeMatch===true&&
  e.browser.userCountsMatch===true&&e.browser.sealedPromptsMatch===true&&
  e.browser.initialManualSealMatch===true&&e.browser.distinctChats===true,
  'browser_and_prompt_seals_not_verified');
 require(e?.outputs?.bothHashesMatch===true&&e.outputs.contentsTaskMatched===true&&
  e.outputs.intendedStructure===true,'output_artifacts_changed');
 require(e?.operations?.runningWorkflows===0&&e.operations.localSenders===0,'active_workflow_or_local_sender');
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
 const firstHash=typeof identity?.originalUserText==='string'?hash(normalizeComposerText(identity.originalUserText)):null;
 const latestHash=typeof identity?.latestUserText==='string'?
   hash(normalizeComposerText(identity.latestUserText)):null;
 const path=(()=>{try{const u=new URL(identity?.projectUrl);return u.origin==='https://chatgpt.com'&&
   u.pathname.replace(/\/project\/?$/,'').replace(/-dr-sashai$/i,'')==='/g/g-p-6ab28bdd7fbc8191b581316ff09da79d'}catch{return false}})();
 return {tabId:matches[0].id,chatUrl:matches[0].url,taskMatch:identity?.taskId===spec.taskId,
  worktreeMatch:identity?.worktree===worktree,projectMatch:path,
  userTurns:identity?.latestUserTurns??null,promptDigest:latestHash,firstDigest:firstHash};
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
 const config=JSON.parse(await readFile(join(root,'.state/flowdeck-human-pilot-20261018-08-events.json'),'utf8'));
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
   success:result?.phase==='approved_cycle_finished'&&result?.status==='implementation_done_review_pending'&&result?.blocker===null,
   budgetExact:result?.pilotBudget?.usage?.p1Continuations===1&&result?.pilotBudget?.usage?.nextChatSubmissions===1&&result?.pilotBudget?.usage?.totalAutomatedSubmissions===2,
   bothImplementationDone:result?.tasks?.length===2&&result.tasks.every((x,i)=>x.id===specs[i].taskId&&x.implementationStatus==='implementation_done'),
   reviewPending:result?.tasks?.length===2&&result.tasks.every(x=>x.reviewStatus==='review_pending'),
   closeAt:desc.closeTime?.getTime()??null};
  const activities=new Map(),statuses={p1SentActivities:0,p2SentActivities:0,recoveryActivities:0,
    allDispatchesCompleted:false,unresolved:0,unknown:0,activityCount:0};
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
      if(status!=='completed')statuses.unknown++;

    }
   }
  }
  statuses.activityCount=activities.size;
  statuses.allDispatchesCompleted=[...activities.values()].filter(a=>a.name==='sendContinuationOnce'||a.name==='startNextTaskOnce').every(a=>a.terminal==='completed');
  statuses.unresolved=[...activities.values()].filter(a=>!a.terminal||a.terminal==='timeout'||a.terminal==='canceled').length;
  statuses.unknown+=[...activities.values()].filter(a=>a.terminal==='failed'&&a.name!=='reconcileSubmittedTurn').length;
  history={closed:events.some(e=>e.workflowExecutionCompletedEventAttributes),eventCount:events.length,signals:events.filter(e=>e.workflowExecutionSignaledEventAttributes).length,...statuses,
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
      specs[0].taskId+' — Fresh Attended Pilot P1':i===1?
      specs[0].taskId+' — continuation':p.tasks[1].title);
  }),
  withinAttemptWindow:rows.length===3&&rows.every(r=>r.started_at>=Date.parse(claim.claimedAt)&&
    r.reported_at>=r.started_at&&r.started_at<=(terminal.closeAt??0)+60000&&r.reported_at<=(terminal.closeAt??0)+60000)};
 const inboxJSON=await readFile(join(config.directory,'inbox.json')),entries=Object.values(JSON.parse(inboxJSON).events??{});
 const inbox={exactSix:entries.length===6&&workIds.every(id=>{
   const paired=entries.filter(e=>e.event?.workId===id);
   return paired.length===2&&paired.some(e=>e.event?.kind==='work_started')&&
    paired.some(e=>e.event?.kind==='work_reported');
  }),
  allSixDelivered:entries.length===6&&entries.every(e=>e.delivery==='delivered'),
  outcomesMatch:entries.filter(e=>e.event?.kind==='work_reported').length===3&&workIds.every((id,i)=>entries.some(e=>e.event?.workId===id&&e.event?.kind==='work_reported'&&e.event?.outcome===(i===0?'partial':'success'))),
  noPending:entries.length===6&&entries.every(e=>e.delivery==='delivered')&&
   (!('pending' in JSON.parse(inboxJSON))||JSON.parse(inboxJSON).pending===0)};
 const store=join(root,'.state/flowdeck-supervisor'),log=join(store,'send-recovery');
 const rootNames=await readdir(store),logNames=await readdir(log),fileProofs=[];
 const records=[],browserProof=[],artifactProof=[];
 const manualBytes=await readFile(join(root,manualStart));const manual=JSON.parse(manualBytes);
 const original=await domIdentity({...specs[0]});
 const manualMatches=manual.schema==='flowdeck.prepared-manual-start/v1'&&manual.projectId===projectId&&manual.taskId===specs[0].taskId&&
  manual.tabId===specs[0].tabId&&manual.worktree===worktree&&manual.projectUrl===projectUrl&&
  manual.ownerId===p.ownerId&&manual.deviceId===p.deviceId&&manual.expectedPromptHash===expectedInitialHash&&
  original.firstDigest===expectedInitialHash&&Array.isArray(manual.originalTargetIds)&&
  manual.originalTargetIds.length>0&&!manual.originalTargetIds.includes(manual.tabId);
 for(const spec of specs){
  const claimFile=join(log,'dispatch-'+spec.dispatch+'-00-claimed.json'),start=JSON.parse(await readFile(claimFile));
  const expected=['claimed','preparing','staged','click_attempted','submitted','reconciled'];
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
  const sealedMessage=(phase)=>{const t=p.tasks.find(x=>x.id===spec.taskId);const prefix=phase==='continue'?'Continue ONLY the current task in this same conversation.':'Implement ONLY this approved task in this new project conversation.';return `${prefix}\nRepository/worktree: ${p.repo}\nTask ID: ${t.id}\nTask title: ${t.title}\n${t.instruction}\nFollow AGENTS.md and the explicit active-plan/worktree routing. Do not select another task or change authority markers. This is implementation supervision, not acceptance or code review. At the start of EVERY supervised turn, including this turn and every continuation of the same task, call the existing Probe RemoteMCP2 begin_work tool before any implementation/device work. Start a NEW work session with a fresh UUID requestKey each turn; retain its returned workId and never reuse a previous turn's workId. At the end of this turn, call the existing Probe RemoteMCP2 finish_work tool exactly once with that workId and a factual summary and known workingDirectory. Use outcome partial for unfinished work (FLOWDECK_STATUS: continue), success only for implementation_done, or failed for a blocking failure (needs_attention); these are agent reports, not independent verification or acceptance. Call finish_work before the final answer's status marker, and put nothing after the marker. End your answer with exactly one last line: FLOWDECK_STATUS: continue, FLOWDECK_STATUS: implementation_done, or FLOWDECK_STATUS: needs_attention (choose one).`};
  const authoritativePromptHash=hash(normalizeComposerText('Probe RemoteMCP2 '+sealedMessage(spec.phaseKind)));
  const content=await readFile(spec.checkpoint),text=content.toString('utf8'),artifact={sha256:hash(content),
   taskPresent:text.includes(spec.taskId),structured:spec.phaseKind==='continue'?
    text.includes('## Checkpoint')&&text.includes('Stage 1: complete.')&&text.includes('## Completion')&&text.includes('Stage 2: finished.')&&text.includes('External review: pending.'):
    text.includes('## Glossary')&&text.includes('work session ended')&&text.includes('implementation_done')&&text.includes('review_pending')};
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
    record.binding.chatUrl===spec.chatUrl&&record.dispatchId===spec.dispatch&&record.ready===true&&record.pending===false&&
    record.expectedPromptHash===sent.promptHash&&record.users===spec.userTurns&&
    sent.promptHash===authoritativePromptHash&&latest.promptDigest===sent.promptHash&&
    (spec.phaseKind==='continue'?sent.binding.chatUrl===spec.chatUrl:sent.binding.chatUrl===projectUrl)&&
    sent.binding.tabId===spec.tabId&&sent.binding.taskId===spec.taskId&&
    sent.binding.workId===spec.beforeWorkId&&sent.previous.workId===spec.beforeWorkId,
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
  p2Reconciled:records[1].exactSteps&&records[1].phaseKind==='next',
  fullSealsMatch:records.every(v=>v.metadataMatch&&v.eventAndPhaseMatch&&v.sealAndBindingMatch),
  noExtraAttemptDispatches:unknownAttemptDispatches.length===0,noExtraAttemptSendClaims:extraRoot.length===0};
 const browser={bothExactTabs:browserProof.every(v=>v.tabId&&v.chatUrl),
  taskAndWorktreeMatch:browserProof.every(v=>v.taskMatch&&v.worktreeMatch&&v.projectMatch),
  userCountsMatch:browserProof.every((v,i)=>v.userTurns===specs[i].userTurns),
  sealedPromptsMatch:records.every(v=>v.sealAndBindingMatch),initialManualSealMatch:manualMatches,
  distinctChats:browserProof[0].chatUrl!==browserProof[1].chatUrl};
 const outputs={bothHashesMatch:records.every(v=>v.artifactMatch),contentsTaskMatched:artifactProof.every(a=>a.taskPresent),
 intendedStructure:artifactProof.every(a=>a.structured)};
 const operations={runningWorkflows,localSenders:await runningProcesses()};
 const evidence={scopeValid,terminal,history,journals,source,inbox,browser,outputs,operations};
 const assessment=assessSuccessfulCycleCloseout(evidence);
 const files=await digestFiles([...fileProofs,
   join(root,'.state/flowdeck-supervisor/projects.json'),
   join(root,'.state/flowdeck-human-pilot-20261018-08-events.json'),join(root,manualStart),
   join(root,'.state/verification-runs/fresh-manual-20261018-08-chMR84/LIVE-P1-P2-SUCCESS-AUDIT.md')]);
 const digest=hash(JSON.stringify({evidence,files,claimSha256:hash(claimBytes),inboxSha256:hash(inboxJSON),
   sourceRowsSha256:hash(JSON.stringify(rows)),temporalRunId:runId,historyEvents:history.events,manualStartSha256:hash(manualBytes)}));
 return {assessment,evidence,digest,claimSha256:hash(claimBytes),claimPath:scopePath,files};
}
/** Exact preview authorization and isolated archival primitive. The latter is
 * exercised only on temporary claim fixtures in tests; live apply is explicit.
 * A durable lock remains on any failure, so uncertain releases never retry.
 */
export function requireMatchingSuccessfulPreview(before,claimDigest,evidenceDigest){
 check(before?.assessment?.ready===true,'evidence not reconciled; no release');
 check(claimDigest===before.claimSha256&&evidenceDigest===before.digest,
  'claim/evidence differs from preview');
 return true;
}
export async function archiveValidatedSuccessfulClaim({
 claimPath,claimSha256,lock,folder,intent,archive,receipt,record,verifyLocked
}){
 const fd=await open(lock,'wx',0o600);
 try{await fd.writeFile(JSON.stringify({schema:'flowdeck.successful-cycle-lock/v1',
  workflowId:record.workflowId,runId:record.runId})+'\n');await fd.sync()}
 finally{await fd.close()}
 // Leave the lock after *any* failure. Never overwrite or retry uncertain retirement.
 check(await verifyLocked()===true,'evidence changed during locked validation');
 await mkdir(folder,{recursive:true,mode:0o700});
 async function exclusive(path,body){
  const f=await open(path,'wx',0o600);
  try{await f.writeFile(JSON.stringify(body,null,2)+'\n');await f.sync()}
  finally{await f.close()}
 }
 await exclusive(intent,{...record,state:'validated_before_archive'});
 check(hash(await readFile(claimPath))===claimSha256,'claim changed before rename');
 await rename(claimPath,archive);
 const dir=await open(folder,'r');try{await dir.sync()}finally{await dir.close()}
 await exclusive(receipt,{...record,state:'retired',retiredAt:new Date().toISOString()});
 return {state:'retired',claimArchive:archive,receipt};
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
  P2Reconciled:before.evidence.journals.p2Reconciled,
  browserSealsVerified:before.evidence.browser.sealedPromptsMatch,
  localSenders:before.evidence.operations.localSenders};
 if(mode==='preview'){console.log(JSON.stringify(result,null,2));return result;}
 requireMatchingSuccessfulPreview(before,args[0],args[1]);
 // Per-run writer lock: older completed pilots may retain other distinct lock files.
 const suffix=hash(JSON.stringify([workflowId,runId])).slice(0,20);
 const lock=before.claimPath+'.successful-cycle-'+suffix+'.lock';
 const folder=join(root,'.state/flowdeck-supervisor/completed-closeouts');
 const intent=join(folder,'successful-cycle-intent-'+suffix+'.json'),
  archive=join(folder,'successful-cycle-claim-'+suffix+'.json'),
  receipt=join(folder,'successful-cycle-retired-'+suffix+'.json');
 const record={schema:'flowdeck.successful-cycle-retirement/v1',projectId,workflowId,runId,
  claimSha256:before.claimSha256,evidenceDigest:before.digest,
  preservedTemporalResult:'COMPLETED / approved_cycle_finished / implementation_done_review_pending',usedAutomatedBudget:2,
  bothTasks:'implementation_done / review_pending',allThreeSourceSessionsReported:true,allSixEventsDelivered:true,
  preparedManualStart:manualStart,preparedManualStartSha256:hash(await readFile(join(root,manualStart))),
  dispatches:specs.map(s=>({id:s.dispatch,taskId:s.taskId,phase:s.finalPhase,tabId:s.tabId,chatUrl:s.chatUrl})),
  workIds,artifactProofs:specs.map(s=>({path:s.checkpoint,sha256:s.checkpointSha})),
  sourceWorkSessionCount:before.evidence.source.count,historyEventCount:before.evidence.history.events,
  claimArchive:archive,claimOriginalPath:before.claimPath,preparedAt:new Date().toISOString()};
 const done=await archiveValidatedSuccessfulClaim({
  claimPath:before.claimPath,claimSha256:before.claimSha256,
  lock,folder,intent,archive,receipt,record,
  verifyLocked:async()=>{const after=await collect();
   return after.assessment.ready&&after.claimSha256===before.claimSha256&&after.digest===before.digest;}
 });
 console.log(JSON.stringify({...result,mode:'release',...done},null,2));
 return {...result,...done};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href)
 main().catch(error=>{console.error(String(error?.message??error));process.exitCode=3});
