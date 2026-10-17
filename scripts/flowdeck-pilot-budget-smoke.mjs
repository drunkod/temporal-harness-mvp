#!/usr/bin/env node
/** Real Temporal SDK / disposable task queue / FAKE activities only.
 * No imports of browser, live supervisor activities, enrollment or event follower.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Client,Connection} from '@temporalio/client';
import {Worker,NativeConnection} from '@temporalio/worker';

const scenarios=['happy','second-continuation','p2-unfinished','p1-immediate',
 'publisher-offline','continuation-failure','next-failure','recovery-blocked','missing-policy'];
const scenario=process.argv[2]??'happy';
if(!scenarios.includes(scenario))throw Error('Unknown bounded synthetic scenario');
const nonce=randomUUID(),workflowId='flowdeck-budget-'+nonce,taskQueue=workflowId;
const workflowsPath=fileURLToPath(new URL('../dist/flowdeck-supervisor-workflow.js',import.meta.url));
const project={
 id:'sashai-fresh-attended-synthetic-'+nonce,ownerId:'fixture-owner',deviceId:'fixture-device',
 repo:'/synthetic/no-files-accessed',
 projectUrl:'https://example.invalid/synthetic-project',
 initialTaskId:'P1',tasks:[
  {id:'P1',title:'Synthetic task P1',instruction:'synthetic only'},
  {id:'P2',title:'Synthetic task P2',instruction:'synthetic only'},
 ],
 attendedPilotBudget:{schema:'flowdeck.attended-pilot-budget/v1',initialTaskId:'P1',nextTaskId:'P2'},
};
const chat='https://example.invalid/synthetic/chat/one',newChat='https://example.invalid/synthetic/chat/two';
const calls=[],signals=[];
const count=name=>calls.filter(c=>c===name).length;
const activity=(name,fn)=>async(...args)=>{calls.push(name);return fn(...args);};
let connection,nativeConnection,worker,handle,completed=false;
const event=(workId,kind)=>{
 const reported=kind==='work_reported',now=new Date().toISOString();
 return {schema:'remote-mcp.work-event/v1',source:'remote-mcp-jazz',
  ownerId:project.ownerId,deviceId:project.deviceId,origin:'event',
  eventId:nonce+'-'+workId+'-'+kind,workId,kind,revision:reported?2:1,
  sourceCommittedAt:now,startedAt:now,completionEvidence:reported?'agent_report_only':'none',
  timestampEvidence:'recorded_in_source_transaction',executionVerified:false,backgroundProcesses:'unknown',
  ...(reported?{reportedAt:now,outcome:'success'}:{})};
};
const signal=async(workId,kind)=>{const e=event(workId,kind);await handle.signal('supervisorWorkEvent',e);signals.push(e);};
const signalPair=async id=>{await signal(id,'work_started');await signal(id,'work_reported');};
const activities={
 loadSupervisorProject:activity('loadSupervisorProject',async id=>{
  assert.equal(id,project.id);
  if(scenario==='missing-policy')return {...project,attendedPilotBudget:undefined};
  return project;
 }),
 publishSupervisorState:activity('publishSupervisorState',async()=>{
  if(scenario==='publisher-offline')throw Error('Synthetic projection offline');
 }),
 adoptStartedWork:activity('adoptStartedWork',async(p,e,t,expected)=>{
  assert.equal(p.id,project.id);
  if(!expected)assert.equal(e.workId,'owner-work');
  else assert.ok(e.workId!=='owner-work');
  return {...(expected??{projectId:p.id,taskId:t.id,chatUrl:chat,tabId:'synthetic-tab-one'}),workId:e.workId};
 }),
 observeWorkResult:activity('observeWorkResult',async(_p,binding,e)=>{
  assert.equal(binding.workId,e.workId);
  let decision;
  if(scenario==='p1-immediate'||scenario==='next-failure')decision='implementation_done';
  else if(binding.taskId==='P2')decision=scenario==='p2-unfinished'?'continue':'implementation_done';
  else if(binding.workId==='owner-work')decision='continue';
  else decision=scenario==='second-continuation'?'continue':'implementation_done';
  return {turn:'finished',decision,summary:'Synthetic marker, no real chat'};
 }),
 sendContinuationOnce:activity('sendContinuationOnce',async(_p,binding,t,e)=>{
  assert.equal(t.id,'P1');assert.equal(e.workId,'owner-work');
  if(scenario==='continuation-failure')throw Error('Synthetic send result uncertain');
  await signalPair('continued-work');
  return {...binding};
 }),
 startNextTaskOnce:activity('startNextTaskOnce',async(_p,t,binding,e)=>{
  assert.equal(t.id,'P2');
  assert.ok(['owner-work','continued-work'].includes(e.workId));
  if(scenario==='next-failure')throw Error('Synthetic new-chat acknowledgement lost');
  await signalPair('next-work');
  return {...binding,taskId:'P2',chatUrl:newChat,tabId:'synthetic-tab-two'};
 }),
 reconcileSubmittedTurn:activity('reconcileSubmittedTurn',async(_p,binding)=>({status:'ready',binding})),
 recoverPreSendOnce:activity('recoverPreSendOnce',async()=>{throw Error('FORBIDDEN: pilot recovery called');}),
};
const deadline=setTimeout(()=>{console.error('Synthetic pilot hard deadline exceeded');process.exit(2)},75000);
try{
 const workflowSha256=createHash('sha256').update(await readFile(workflowsPath)).digest('hex');
 connection=await Connection.connect({address:'127.0.0.1:7233',connectTimeout:'5 seconds'});
 const client=new Client({connection,namespace:'default'});
 nativeConnection=await NativeConnection.connect({address:'127.0.0.1:7233'});
 worker=await Worker.create({connection:nativeConnection,namespace:'default',taskQueue,
  workflowsPath,activities,shutdownGraceTime:'2 seconds',shutdownForceTime:'5 seconds',
  maxConcurrentActivityTaskExecutions:1,maxConcurrentWorkflowTaskExecutions:2});
 await worker.runUntil(async()=>{
  try{
   const recovery=scenario==='recovery-blocked';
   const input={projectId:project.id,taskId:'P2',completedTaskId:'P1',phase:'next',
    previous:{projectId:project.id,taskId:'P1',chatUrl:chat,tabId:'synthetic-tab-one',workId:'owner-work'},
    event:event('owner-work','work_reported'),authorization:{kind:'synthetic-never-usable'}};
   handle=await client.workflow.start(recovery?'flowdeckRecoverSend':'flowdeckSupervisor',{
    workflowId,taskQueue,args:recovery?[input]:[project.id],
    workflowExecutionTimeout:'60 seconds',retry:{maximumAttempts:1},
   });
   if(!recovery&&scenario!=='missing-policy')await signalPair('owner-work');
   const result=await handle.result();
   completed=true;
   const description=await handle.describe();
   assert.equal(description.status.name,'COMPLETED');
   const expected={
    happy:{phase:'approved_cycle_finished',continuations:1,next:1,usage:2},
    'second-continuation':{phase:'needs_attention',continuations:1,next:0,usage:1},
    'p2-unfinished':{phase:'needs_attention',continuations:1,next:1,usage:2},
    'p1-immediate':{phase:'approved_cycle_finished',continuations:0,next:1,usage:1},
    'publisher-offline':{phase:'approved_cycle_finished',continuations:1,next:1,usage:2},
    'continuation-failure':{phase:'needs_attention',continuations:1,next:0,usage:1},
    'next-failure':{phase:'needs_attention',continuations:0,next:1,usage:1},
    'recovery-blocked':{phase:'needs_attention',continuations:0,next:0,usage:0},
    'missing-policy':{phase:'needs_attention',continuations:0,next:0,usage:0},
   }[scenario];
   assert.equal(result.phase,expected.phase);
   assert.equal(count('sendContinuationOnce'),expected.continuations);
   assert.equal(count('startNextTaskOnce'),expected.next);
   assert.equal(count('recoverPreSendOnce'),0);
   assert.equal(result.pilotBudget?.usage.totalAutomatedSubmissions??0,expected.usage);
   if(scenario==='publisher-offline')assert.equal(result.projection?.status,'degraded');
   const history=await handle.fetchHistory();
   const sendScheduled=history.events.filter(e=>['sendContinuationOnce','startNextTaskOnce','recoverPreSendOnce']
    .includes(e.activityTaskScheduledEventAttributes?.activityType?.name));
   assert.equal(sendScheduled.length,expected.continuations+expected.next);
   const patches=history.events.filter(e=>e.markerRecordedEventAttributes?.markerName==='core_patch')
    .map(e=>e.markerRecordedEventAttributes.details);
   assert.ok(patches.length>=2,'F4 and pilot-budget patch markers must be recorded');
   console.log(JSON.stringify({ok:true,scenario,workflowId,runId:description.runId,taskQueue,
    workflowSha256,temporalStatus:description.status.name,historyEventCount:history.events.length,
    patchMarkerCount:patches.length,scheduledSendActivities:sendScheduled.map(e=>e.activityTaskScheduledEventAttributes.activityType.name),
    counts:Object.fromEntries([...new Set(calls)].map(n=>[n,count(n)])),
    authoritativeResult:{phase:result.phase,status:result.status,blocker:result.blocker,
     usage:result.pilotBudget?.usage??null,projection:result.projection??null},
    safety:{realBrowserSends:0,productionActivitiesImported:false,workflowReleaseSignals:0}},null,2));
  }finally{if(handle&&!completed)await handle.terminate('Synthetic test cleanup').catch(()=>undefined);}
 });
}catch(e){console.error('PILOT_SMOKE_FAILURE',e);process.exitCode=1;}
finally{
 clearTimeout(deadline);
 if(worker&&['RUNNING','INITIALIZED'].includes(worker.getState()))worker.shutdown();
 await nativeConnection?.close().catch(()=>undefined);
 await connection?.close().catch(()=>undefined);
 console.error('Pilot smoke cleanup: worker and connections closed');
}
