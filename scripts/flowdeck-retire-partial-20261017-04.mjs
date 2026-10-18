#!/usr/bin/env node
/** Exact one-time, preview-first retirement of the real P1 partial attempt.
 * Never starts a workflow, runs a worker/follower, changes an artifact or sends.
 * Exits fail-closed on missing/changed/browser/ledger/Temporal evidence.
 */
import {readFile,readdir,stat,open,mkdir,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Connection,Client} from '@temporalio/client';
import {loadSupervisorProject} from '../dist/flowdeck-projects.js';
import {supervisorIdentityExpression} from '../dist/flowdeck-supervisor-activities.js';
import {attemptScopePath,assertNoRunningFlowdeck} from './flowdeck-attempt-scope.mjs';
import {DatabaseSync} from 'node:sqlite';

const root=resolve(import.meta.dirname,'..');
const PROJECT='sashai-fresh-attended-20261017-04';
const WORKFLOW='flowdeck-supervisor-'+PROJECT;
const RUN='01a149a0-e652-796e-80c9-f8671efe0356';
const SESSION='5f2adbcc-60e4-4c55-b471-0242d5aea064';
const TASK='sashai-fresh-attended-p1-20261017-04';
const WORKTREE='/Users/test/Documents/work/sashai-flowdeck-fresh-attended-20261017-04';
const TAB='333B7B9508008C3E80180DF0B0C60C5A';
const CHAT='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6ad35f55-104c-83ed-93e9-ddf4e8e70c98';
const CHECKPOINT=join(WORKTREE,'docs/flowdeck-fresh-attended-2026-10-17-04/p1.md');
const CHECKPOINT_SHA='0faf3840c4d5329c6804893513bfd9c841cb4b67d17061a5928daf599d8789af';
const configPath=join(root,'.state/flowdeck-human-pilot-20261017-04-events.json');
const sha=v=>createHash('sha256').update(v).digest('hex');
const exec=promisify(execFile);
const fail=(ok,why)=>{if(!ok)throw Error('Retirement refused: '+why)};
const data={PROJECT,WORKFLOW,RUN,SESSION,TASK,WORKTREE,TAB,CHAT,CHECKPOINT};
const expectedActivities=new Set(['loadSupervisorProject','publishSupervisorState']);

export function evaluateRetirementEvidence(e){
 const blockers=[];
 const require=(c,msg)=>{if(!c)blockers.push(msg)};
 require(e?.workflow?.status==='COMPLETED'&&e?.workflow?.runId===RUN&&e?.workflow?.workflowId===WORKFLOW,'workflow_not_exact_completed');
 require(e?.workflow?.phase==='needs_attention'&&e?.workflow?.businessStatus==='paused'&&e?.workflow?.blocker==='No new work-session event within the bounded waiting period.','wrong_terminal_reason');
 require(e?.workflow?.taskId===TASK&&e?.workflow?.workId===null&&e?.workflow?.lastEvent===null&&e?.workflow?.chatUrl===null&&e?.workflow?.tabId===null,'adoption_was_not_absent');
 require(e?.workflow?.p1Sends===0&&e?.workflow?.p2Sends===0&&e?.workflow?.totalSends===0,'budget_not_zero');
 require(e?.history?.completed===true&&e?.history?.timerFired===true&&e?.history?.signals===0,'history_not_exact_timeout');
 require(Array.isArray(e?.history?.activityKinds)&&e.history.activityKinds.every(x=>expectedActivities.has(x)),'history_sends_or_unknown_activities');
 require(e?.claim?.projectId===PROJECT&&e?.claim?.workflowId===WORKFLOW&&e?.claim?.disposition==='unresolved_until_audited_reconciliation','wrong_claim');
 require(e?.source?.totalSessions===1&&e?.source?.workId===SESSION&&e?.source?.state==='reported'&&e?.source?.outcome==='partial'&&
  e?.source?.beginTaskMatch===true&&e?.source?.beginWorktreeMatch===true&&e?.source?.finishWorktreeMatch===true,'source_session_not_reconciled');
 require(e?.source?.startedAfterClaim===true&&e?.source?.endedBeforeWorkflowClose===true,'source_times_outside_attempt');
 require(e?.checkpoint?.sha256===CHECKPOINT_SHA&&e?.checkpoint?.contentsCorrect===true&&e?.checkpoint?.p2Absent===true,'checkpoint_not_intact');
 require(e?.chat?.tabId===TAB&&e?.chat?.chatUrl===CHAT&&e?.chat?.taskMatch===true&&
  e?.chat?.worktreeMatch===true&&e?.chat?.projectMatch===true&&e?.chat?.userTurns===1&&e?.chat?.originalTaskPresent===true,'pinned_chat_not_verified');
 require(e?.journal?.total>=0&&e?.journal?.touched===0&&e?.journal?.referencesAttempt===0,'send_journal_unreconciled');
 require(e?.running?.temporal===0&&e?.running?.processes===0,'active_sender_or_workflow');
 return {ready:blockers.length===0,blockers};
}

async function probeOriginalTab(){
 const r=await fetch('http://127.0.0.1:9222/json/list',{signal:AbortSignal.timeout(4500)});
 fail(r.ok,'CDP unavailable');
 const tabs=await r.json(),tab=tabs.find(t=>t.id===TAB);
 fail(tab?.url===CHAT&&typeof tab?.webSocketDebuggerUrl==='string','original P1 tab missing/changed');
 const ws=new WebSocket(tab.webSocketDebuggerUrl);
 const identity=await new Promise((res,rej)=>{
  const stop=setTimeout(()=>{ws.close();rej(Error('Pinned browser identity timed out'))},7000);
  ws.addEventListener('open',()=>ws.send(JSON.stringify({id:77,method:'Runtime.evaluate',
   params:{expression:supervisorIdentityExpression(CHAT),returnByValue:true,awaitPromise:false}})));
  ws.addEventListener('message',m=>{const packet=JSON.parse(String(m.data));
   if(packet.id!==77)return;clearTimeout(stop);ws.close();
   if(packet.error||packet.result?.exceptionDetails)rej(Error('Browser identity unavailable'));
   else res(packet.result?.result?.value);
  });
  ws.addEventListener('error',()=>{clearTimeout(stop);rej(Error('CDP disconnected'))});
 });
 return {tabId:tab.id,chatUrl:tab.url,taskMatch:identity?.taskId===TASK,
  worktreeMatch:identity?.worktree===WORKTREE,
  projectMatch:(()=>{try{const u=new URL(identity?.projectUrl);const path=u.pathname.endsWith('/project')?u.pathname.slice(0,-8):u.pathname;return u.origin==='https://chatgpt.com'&&path.replace(/-dr-sashai$/i,'')==='/g/g-p-6ab28bdd7fbc8191b581316ff09da79d';}catch{return false}})(),
  userTurns:identity?.latestUserTurns??null,
  originalTaskPresent:identity?.originalUserText?.includes(TASK)??false};
}

async function collect(){
 const p=await loadSupervisorProject(PROJECT);
 fail(p.id===PROJECT&&p.repo===WORKTREE&&p.initialTaskId===TASK&&p.tasks.length===2,'production enrollment changed');
 const scope={projectId:p.id,ownerId:p.ownerId,deviceId:p.deviceId,workflowId:WORKFLOW};
 const claimFile=attemptScopePath(root,scope);
 const claimBytes=await readFile(claimFile),claim=JSON.parse(claimBytes);
 fail(claim.schema==='flowdeck.attempt-scope/v1'&&claim.ownerId===scope.ownerId&&claim.deviceId===scope.deviceId&&claim.profile==='helium-profile-4','claim mismatch');
 const sourceConfig=JSON.parse(await readFile(configPath,'utf8'));
 fail(sourceConfig['workflow-id']===WORKFLOW&&sourceConfig['project-id']===PROJECT&&
  sourceConfig.owner===p.ownerId&&sourceConfig.device===p.deviceId,'event config mismatch');
 const db=new DatabaseSync(sourceConfig.db,{readOnly:true});
 let sessions;
 try{
  db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 0;');
  sessions=db.prepare('SELECT work_id,state,outcome,started_at,reported_at,begin_json,finish_json FROM control_work_reports WHERE owner_id=? AND device_id=? AND started_at>=? ORDER BY started_at')
   .all(p.ownerId,p.deviceId,Date.parse(claim.claimedAt));
 }finally{db.close()}
 const row=sessions.length===1?sessions[0]:null;
 const begin=row?JSON.parse(row.begin_json):null,finish=row?.finish_json?JSON.parse(row.finish_json):null;
 const source={totalSessions:sessions.length,workId:row?.work_id??null,state:row?.state??null,
  outcome:row?.outcome??null,beginTaskMatch:typeof begin?.taskTitle==='string'&&begin.taskTitle.startsWith(TASK+' —'),
  beginWorktreeMatch:typeof begin?.taskDescription==='string'&&begin.taskDescription.includes(WORKTREE),
  finishWorktreeMatch:finish?.workingDirectory===WORKTREE,
  startedAfterClaim:row?row.started_at>=Date.parse(claim.claimedAt):false,
  endedBeforeWorkflowClose:false};
 const c=await Connection.connect({address:'127.0.0.1:7233',connectTimeout:'5 seconds'});
 let workflow,history,running;
 try{
  const client=new Client({connection:c,namespace:'default'});
  const h=client.workflow.getHandle(WORKFLOW,RUN),desc=await h.describe();
  const hist=await h.fetchHistory();
  const result=desc.status.name==='COMPLETED'?await h.result():null;
  source.endedBeforeWorkflowClose=!!(row&&Number.isFinite(row.reported_at)&&row.reported_at>=row.started_at&&
   Number.isFinite(desc.closeTime?.getTime())&&row.reported_at<=desc.closeTime.getTime());
  workflow={workflowId:desc.workflowId,runId:desc.runId,status:desc.status.name,
   phase:result?.phase,businessStatus:result?.status,blocker:result?.blocker,
   taskId:result?.taskId,workId:result?.workId,lastEvent:result?.lastEvent,
   chatUrl:result?.chatUrl,tabId:result?.tabId,
   p1Sends:result?.pilotBudget?.usage?.p1Continuations,
   p2Sends:result?.pilotBudget?.usage?.nextChatSubmissions,
   totalSends:result?.pilotBudget?.usage?.totalAutomatedSubmissions};
  history={completed:hist.events.some(e=>e.workflowExecutionCompletedEventAttributes),
   timerFired:hist.events.some(e=>e.timerFiredEventAttributes),
   signals:hist.events.filter(e=>e.workflowExecutionSignaledEventAttributes).length,
   eventCount:hist.events.length,
   activityKinds:hist.events.filter(e=>e.activityTaskScheduledEventAttributes)
    .map(e=>e.activityTaskScheduledEventAttributes.activityType?.name)};
  running={temporal:0,processes:0};
  await assertNoRunningFlowdeck(client.workflow.list.bind(client.workflow));
 }finally{await c.close()}
 const {stdout}=await exec('/bin/ps',['-axo','pid=,command='],{timeout:8000,maxBuffer:4*1024*1024});
 const lines=stdout.split('\n').filter(s=>/(?:^|[\s/])scripts\/(?:flowdeck-launch|flowdeck-supervisor|flowdeck-work-events|flowdeck-resume-send)\.mjs\b/.test(s)&&
  /\b(worker|follow|start|release|--attempt)\b|flowdeck-launch\.mjs/.test(s));
 running.processes=lines.length;
 const checkpointBytes=await readFile(CHECKPOINT),checkpointText=checkpointBytes.toString('utf8');
 const checkpoint={sha256:sha(checkpointBytes),contentsCorrect:
  checkpointText.startsWith('# Fresh Attended Pilot P1')&&checkpointText.includes(TASK)&&
  checkpointText.includes('Stage 1 complete')&&checkpointText.includes('Stage 2 pending')&&
  checkpointText.includes('## Remaining work')&&!checkpointText.includes('## Completion'),p2Absent:false};
 try{await stat(join(WORKTREE,'docs/flowdeck-fresh-attended-2026-10-17-04/p2.md'));}
 catch(e){if(e.code==='ENOENT')checkpoint.p2Absent=true;else throw e}
 const store=join(root,'.state/flowdeck-supervisor');
 const direct=(await readdir(store)).filter(n=>/^(send-event-|send-phase-|sent-).*\.json$/.test(n)).map(n=>join(store,n));
 const rec=join(store,'send-recovery'),old=(await readdir(rec)).filter(n=>/\.(json|jsonl)$/.test(n)).map(n=>join(rec,n));
 let touched=0,referenced=0;const journals=[];
 for(const file of [...direct,...old]){
  const [meta,bytes]=await Promise.all([stat(file),readFile(file)]);
  if(meta.mtimeMs>=Date.parse(claim.claimedAt))touched++;
  if([WORKFLOW,PROJECT,SESSION].some(term=>bytes.includes(term)))referenced++;
  journals.push({name:file.slice(root.length+1),digest:sha(bytes),mtime:meta.mtimeMs});
 }
 const journal={total:journals.length,touched,referencesAttempt:referenced};
 const chat=await probeOriginalTab();
 const evidence={claim:{projectId:claim.projectId,workflowId:claim.workflowId,disposition:claim.disposition},source,
  checkpoint,chat,journal,running,workflow,history};
 const assessment=evaluateRetirementEvidence(evidence);
 const digest=sha(JSON.stringify({evidence,journals}));
 return {assessment,evidence,claimSha256:sha(claimBytes),digest,claimFile,claim,checkpointFile:CHECKPOINT};
}
export async function main(args=process.argv.slice(2)){
 const [mode,...flags]=args;
 fail(mode==='preview'||mode==='release','Use preview or release');
 const expectedSha=flags[0],expectedDigest=flags[1];
 if(mode==='release')fail(flags.length===2&&/^[0-9a-f]{64}$/.test(expectedSha)&&/^[0-9a-f]{64}$/.test(expectedDigest),
  'Release requires preview claim SHA and evidence digest');
 else fail(flags.length===0,'Preview takes no extra arguments');
 const base=await collect();
 const display={mode,projectId:PROJECT,workflowId:WORKFLOW,runId:RUN,
  ready:base.assessment.ready,blockers:base.assessment.blockers,
  claimSha256:base.claimSha256,evidenceDigest:base.digest,
  partialWorkId:base.evidence.source.workId,partialOutcome:base.evidence.source.outcome,
  p1Sha256:base.evidence.checkpoint.sha256,tabId:base.evidence.chat.tabId,
  historyEvents:base.evidence.history.eventCount,historyActivityKinds:[...new Set(base.evidence.history.activityKinds)],
  journalRecords:base.evidence.journal.total,automatedSubmissions:base.evidence.workflow.totalSends,
  sourceChecks:{beginTaskMatch:base.evidence.source.beginTaskMatch,beginWorktreeMatch:base.evidence.source.beginWorktreeMatch,finishWorktreeMatch:base.evidence.source.finishWorktreeMatch,startedAfterClaim:base.evidence.source.startedAfterClaim,endedBeforeWorkflowClose:base.evidence.source.endedBeforeWorkflowClose},
  chatChecks:{taskMatch:base.evidence.chat.taskMatch,worktreeMatch:base.evidence.chat.worktreeMatch,projectMatch:base.evidence.chat.projectMatch,userTurns:base.evidence.chat.userTurns,originalTaskPresent:base.evidence.chat.originalTaskPresent},
  activeSenders:base.evidence.running.processes};
 if(mode==='preview'){console.log(JSON.stringify(display,null,2));return display;}
 fail(base.assessment.ready,'evidence not completely reconciled');
 fail(base.claimSha256===expectedSha&&base.digest===expectedDigest,'claim/evidence changed since preview');
 // The previous completed attempt used this same physical owner-scope path.
 // Its historical closeout-lock is immutable; this run receives its OWN exact lock.
 const lock=base.claimFile+'.retire-'+sha(JSON.stringify([WORKFLOW,RUN])).slice(0,20)+'.lock',fd=await open(lock,'wx',0o600);
 try{await fd.writeFile(JSON.stringify({schema:'flowdeck.partial-retire-lock/v1',workflowId:WORKFLOW,runId:RUN})+'\n');await fd.sync()}
 finally{await fd.close()}
 // Durable lock intentionally remains after failure, to prevent blind retries.
 const second=await collect();
 fail(second.assessment.ready&&second.claimSha256===expectedSha&&second.digest===expectedDigest,
  'live evidence changed before archive');
 const folder=join(root,'.state/flowdeck-supervisor/completed-closeouts');
 await mkdir(folder,{recursive:true,mode:0o700});
 const suffix=sha(JSON.stringify([WORKFLOW,RUN])).slice(0,20);
 const intent=join(folder,'partial-intent-'+suffix+'.json');
 const archived=join(folder,'partial-claim-'+suffix+'.json');
 const receipt=join(folder,'partial-retired-'+suffix+'.json');
 const record={schema:'flowdeck.partial-retirement/v1',workflowId:WORKFLOW,runId:RUN,
  claimSha256:base.claimSha256,evidenceDigest:base.digest,
  sourceSession:SESSION,sourceOutcome:'partial',originalChat:CHAT,
  originalTabId:TAB,checkpointPath:CHECKPOINT,checkpointSha256:CHECKPOINT_SHA,
  zeroAutomatedSubmissions:true,retiredForNewPilotOnly:true,
  archivedClaim:archived,originalClaim:base.claimFile,recordedAt:new Date().toISOString()};
 async function writeNew(file,obj){const f=await open(file,'wx',0o600);
  try{await f.writeFile(JSON.stringify(obj,null,2)+'\n');await f.sync()}finally{await f.close()}}
 await writeNew(intent,{...record,state:'validated_before_archive'});
 fail(sha(await readFile(base.claimFile))===expectedSha,'claim bytes changed before atomic archive');
 await rename(base.claimFile,archived);
 const folderFd=await open(folder,'r');try{await folderFd.sync()}finally{await folderFd.close()}
 await writeNew(receipt,{...record,state:'retired',retiredAt:new Date().toISOString()});
 console.log(JSON.stringify({...display,mode:'release',state:'retired',archivedClaim:archived,receipt},null,2));
 return {...display,state:'retired',receipt};
}
if(import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(e=>{console.error(String(e?.message??e));process.exitCode=3});
