import {condition,defineQuery,defineSignal,isCancellation,patched,proxyActivities,setHandler,sleep} from '@temporalio/workflow';
import type {SupervisorProject,ApprovedTask,WorkBinding,WorkObservation} from './flowdeck-supervisor-activities.js';
import type * as activityTypes from './flowdeck-supervisor-activities.js';
import type { SendRecoveryAuthorization } from './flowdeck-send-recovery.js';
import type {WorkEventV1} from './flowdeck-work-events.js';
import {initialPilotSendUsage,reservePilotSend,validatePilotProject} from './flowdeck-pilot-budget.js';
import type {PilotSendUsage} from './flowdeck-pilot-budget.js';

const a=proxyActivities<typeof activityTypes>({startToCloseTimeout:'2 minutes',retry:{maximumAttempts:1}});
export const supervisorWorkEvent=defineSignal<[WorkEventV1]>('supervisorWorkEvent');
export const supervisorStatus=defineQuery<SupervisorState>('flowdeckSupervisorStatus');
function sendFailureDiagnostic(error:unknown,label:string):string {
 let current=error as {message?:string;type?:string;cause?:unknown};let preClick=false;let message='Unknown activity failure';
 for(let i=0;current&&i<6;i++){
  preClick ||= current.type==='FlowdeckPreSendFailure';
  if(typeof current.message==='string')message=current.message;
  current=current.cause as typeof current;
 }
 message=message.replace(/bearer\s+\S+/gi,'bearer [redacted]').replace(/(?:token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi,'credential=[redacted]').slice(0,500);
 return preClick ? `${label} pre_send_failed before click: ${message}. Explicit scoped recovery required.` : `${label} may have been submitted; reconcile claims before any further send. Cause: ${message}`;
}
export interface FlowdeckRecoveryInput {
 projectId:string; taskId:string; completedTaskId:string; phase:'next'; previous:WorkBinding; event:WorkEventV1; authorization:SendRecoveryAuthorization;
}
export interface ProjectionHealth {
 status:'healthy'|'degraded';consecutiveFailures:number;lastPublishedAt:string|null;
}
export interface SupervisorState {
 projectId:string;phase:string;status:string;taskId:string|null;workId:string|null;
 chatUrl:string|null;tabId:string|null;updatedAt:string;blocker:string|null;
 tasks:Array<{id:string;title:string;implementationStatus:string;reviewStatus:string}>;
 lastEvent:{kind:string;eventId:string;workId:string}|null;
 projection?:ProjectionHealth;
 pilotBudget?:{usage:PilotSendUsage};
}
/** v1.2 implementation supervision only. No code-review or artifact acceptance lane. */
export const supervisorRecoveryReady=defineSignal("supervisorRecoveryReady");
export async function flowdeckRecoverSend(input:FlowdeckRecoveryInput):Promise<SupervisorState> {
 return flowdeckSupervisor(input.projectId,input);
}
export async function flowdeckSupervisor(projectId:string,recovery?:FlowdeckRecoveryInput):Promise<SupervisorState> {
 // Memoize once: histories without this marker retain their original publication semantics.
 const isolateProjection=patched('flowdeck-status-projection-isolation-v1');
 // Versioned at workflow start. Histories without the marker keep legacy send scheduling.
 const enforceAttendedBudget=patched('flowdeck-attended-pilot-send-budget-v1');
 const projection=isolateProjection?proxyActivities<Pick<typeof activityTypes,'publishSupervisorState'>>({
  startToCloseTimeout:'5 seconds',scheduleToCloseTimeout:'15 seconds',
  retry:{maximumAttempts:2,initialInterval:'1 second',maximumInterval:'2 seconds'},
 }):a;
 const state:SupervisorState={projectId,phase:'loading',status:'starting',taskId:null,workId:null,
  chatUrl:null,tabId:null,updatedAt:new Date().toISOString(),blocker:null,tasks:[],lastEvent:null};
 const pending:WorkEventV1[]=[],seen=new Set<string>(),handled=new Set<string>();
  const earlyReports=new Map<string,WorkEventV1>();
 let project:SupervisorProject;
 setHandler(supervisorStatus,()=>({...state,tasks:state.tasks.map(t=>({...t})),lastEvent:state.lastEvent?{...state.lastEvent}:null,
   ...(state.projection?{projection:{...state.projection}}:{}),
   ...(state.pilotBudget?{pilotBudget:{usage:{...state.pilotBudget.usage}}}:{})}));
 setHandler(supervisorWorkEvent,e=>{pending.push(e);});
 const publish=async(phase:string,status:string)=>{
  state.phase=phase;state.status=status;state.updatedAt=new Date().toISOString();
  if(!isolateProjection){await a.publishSupervisorState(state);return;}
  const health:ProjectionHealth={status:'healthy',consecutiveFailures:0,lastPublishedAt:state.updatedAt};
  try{
   await projection.publishSupervisorState({...state,projection:health});
   state.projection=health;
  }catch(error){
   if(isCancellation(error))throw error;
   // Projection is disposable; claims, journals and other activities remain authoritative.
   state.projection={status:'degraded',consecutiveFailures:(state.projection?.consecutiveFailures??0)+1,
    lastPublishedAt:state.projection?.lastPublishedAt??null};
  }
 };
 const pause=async(reason:string)=>{state.blocker=reason;await publish('needs_attention','paused');return state;};
 try{project=await a.loadSupervisorProject(projectId);}
 catch{return await pause('Project enrollment or approved task source is missing/ambiguous.');}
 // A scoped fresh pilot must never fall back to the historical six-continuation
 // behavior simply because its policy failed to load or validate.
 let bounded=false;
 if(enforceAttendedBudget){
  try{bounded=validatePilotProject(project);}
  catch{return await pause('Bounded attended pilot policy is invalid; no send allowed.');}
  if(project.id.startsWith('sashai-fresh-attended-')&&!bounded)
   return await pause('Bounded attended pilot policy missing; no send allowed.');
  if(bounded)state.pilotBudget={usage:initialPilotSendUsage()};
 }
 state.tasks=project.tasks.map(t=>({id:t.id,title:t.title,implementationStatus:'approved',reviewStatus:'not_started'}));
 let task=project.tasks.find(t=>t.id===project.initialTaskId);
 if(!task)return await pause('The manually started task is not explicitly identified.');
 if(task.dependsOn?.length)return await pause('Initial task has unresolved review dependencies.');
 state.taskId=task.id;
 let binding:WorkBinding|null=null,expected:WorkBinding|undefined;
 let pendingSubmitted:WorkBinding|null=null;
 let adoptionAttempts=0, adoptionDeadline=0, pendingSessionWorkId:string|null=null;
 const validBinding=(b:WorkBinding,t:ApprovedTask,workId:string)=>b&&b.projectId===project.id&&
  b.taskId===t.id&&b.workId===workId&&typeof b.chatUrl==='string'&&!!b.chatUrl.trim()&&
  typeof b.tabId==='string'&&!!b.tabId.trim();
 let continuations=0;
 if(recovery&&bounded)return await pause('Bounded attended pilot recovery is not authorized; no send allowed.');
 if(recovery){
  const completed=project.tasks.find(t=>t.id===recovery.completedTaskId);
  const resumed=project.tasks.find(t=>t.id===recovery.taskId);
  if(!completed||!resumed||completed.id===resumed.id||recovery.previous.projectId!==project.id||
   recovery.previous.taskId!==completed.id||recovery.event.workId!==recovery.previous.workId||recovery.phase!=='next')
   return await pause('Recovery predecessor/target binding is invalid.');
  let ready=false;setHandler(supervisorRecoveryReady,()=>{ready=true;});
  state.taskId=resumed.id;
  state.tasks.find(t=>t.id===completed.id)!.implementationStatus='implementation_done';
  state.tasks.find(t=>t.id===completed.id)!.reviewStatus='review_pending';
  await publish('waiting_for_manual_start','waiting');
  if(!await condition(()=>ready,'10 minutes'))return await pause('Recovery readiness release timed out; no send attempted.');
  task=resumed;
  try{
   await publish('recovering_pre_send','running');
   expected=await a.recoverPreSendOnce(project,recovery.previous,task,recovery.event,'next',recovery.authorization);
   if(!validBinding(expected,task,recovery.previous.workId)||expected.chatUrl===recovery.previous.chatUrl||expected.tabId===recovery.previous.tabId)
    throw Error('Recovered destination mismatch');
   await publish('waiting_for_submitted_turn','waiting');
   const deadline=Date.now()+10*60_000;let hydrated=false;
   for(let i=0;i<120&&Date.now()<deadline;i++){
    if(!expected)throw Error('Recovered target binding is missing');
    const result:Awaited<ReturnType<typeof a.reconcileSubmittedTurn>>=await a.reconcileSubmittedTurn(project,expected);expected=result.binding;
    if(result.status==='ready'){hydrated=true;break;}
    await sleep('5 seconds');
   }
   if(!hydrated)return await pause('Recovered submitted turn observation timed out; never retry click.');
   if(!expected)throw Error('Recovered target binding is missing');
   state.chatUrl=expected.chatUrl;state.tabId=expected.tabId;
  }catch(error){return await pause(sendFailureDiagnostic(error,'Recovery'));}
  await publish('waiting_for_work_start','waiting');
 }else await publish('waiting_for_manual_start','waiting');
 while(true){
  if(!pending.length&& !await condition(()=>pending.length>0,'30 minutes'))
   return await pause('No new work-session event within the bounded waiting period.');
  const event=pending.shift()!;
  if(!event||event.schema!=='remote-mcp.work-event/v1'||event.source!=='remote-mcp-jazz'||
   event.ownerId!==project.ownerId||event.deviceId!==project.deviceId||event.origin!=='event'||
   !['work_started','work_reported'].includes(event.kind)||event.executionVerified!==false||
   typeof event.eventId!=='string'||!event.eventId.trim()||typeof event.workId!=='string'||!event.workId.trim()||
   event.revision!==(event.kind==='work_started'?1:2))continue;
  const key=JSON.stringify([event.source,event.ownerId,event.deviceId,event.eventId]);
  const slot=JSON.stringify([event.workId,event.kind]);
  if(seen.has(key)||handled.has(slot))continue;
  if(event.kind==='work_reported'&&(!binding||binding.workId!==event.workId)){
   // Delivery can race the start signal or an in-flight send. Only adoption authorizes observation.
   if(!handled.has(JSON.stringify([event.workId,'work_started']))&&!earlyReports.has(event.workId))
    earlyReports.set(event.workId,event);
   continue;
  }
  if(event.kind!=='work_started'){seen.add(key);handled.add(slot);}
  state.lastEvent={kind:event.kind,eventId:event.eventId,workId:event.workId};
  if(event.kind==='work_started'){
   if(binding)
    return await pause('Another work session started before the current one was resolved.');
   if(pendingSessionWorkId && pendingSessionWorkId!==event.workId)
    return await pause('Another work session started while the intended session was still pending adoption.');
   try{
    const adopted=await a.adoptStartedWork(project,event,task,expected);
    if ('status' in adopted && adopted.status==='waiting') {
     if (!adoptionAttempts) {
      adoptionDeadline=Date.now()+10*60*1000; pendingSessionWorkId=event.workId; state.workId=event.workId;
      if (adopted.binding) {
       expected=adopted.binding;
       state.chatUrl=adopted.binding.chatUrl; state.tabId=adopted.binding.tabId;
      }
      await publish('pending_adoption','waiting');
     }
     if (++adoptionAttempts >= 120 || Date.now() >= adoptionDeadline)
      return await pause('Work-session adoption did not become observable within the bounded deadline.');
     pending.push(event);
     await sleep('5 seconds');
     continue;
    }
    const adoptedBinding=adopted as WorkBinding;
    if(!validBinding(adoptedBinding,task,event.workId)||expected&&
     (adoptedBinding.chatUrl!==expected.chatUrl||adoptedBinding.tabId!==expected.tabId))throw Error('Binding mismatch');
    binding=adoptedBinding;
    adoptionAttempts=0; adoptionDeadline=0; pendingSessionWorkId=null;
    seen.add(key);handled.add(slot);
   }catch{return await pause('Cannot uniquely correlate the work session with the intended project/chat/task.');}
   const report=earlyReports.get(event.workId);
   if(report){earlyReports.delete(event.workId);pending.unshift(report);}
   state.workId=binding.workId;state.chatUrl=binding.chatUrl;state.tabId=binding.tabId;
   expected=undefined;
   state.tasks.find(t=>t.id===task!.id)!.implementationStatus='working';
   await publish('working','running');
   continue;
  }
  if(!binding)continue;
  await publish('waiting_for_chat_response','running');
  let observed:WorkObservation={turn:'unknown',decision:'unknown',summary:''};
  try{
   // Bound elapsed observation time as well as poll count; reads may themselves be slow.
   const observationDeadline=Date.now()+3*60_000;
   for(let i=0;i<60&&Date.now()<observationDeadline;i++){
    observed=await a.observeWorkResult(project,binding,event);
    if(observed.turn==='finished')break;
    await sleep('2 seconds');
   }
  }catch{return await pause('Work-session report could not be reconciled with its ChatGPT response.');}
  if(observed.turn!=='finished')
   return await pause('observation_timeout: ChatGPT finished-turn evidence was not observable before the bounded deadline.');
  if(!['continue','implementation_done'].includes(observed.decision))
   return await pause('ChatGPT provided no unambiguous finished/continue decision, or needs owner input.');
  if(observed.decision==='continue'){
   if(bounded){
    const reservation=reservePilotSend(project.attendedPilotBudget!,state.pilotBudget!.usage,
      {kind:'continue',taskId:task.id});
    if(!reservation.allowed)return await pause(reservation.reason);
    state.pilotBudget!.usage=reservation.usage;
   }else if(++continuations>6)return await pause('Continuation budget reached.');
   await publish('sending_continuation','running');
   try{
       expected=await a.sendContinuationOnce(project,binding,task,event);
       if(!validBinding(expected,task,binding.workId)||expected.chatUrl!==binding.chatUrl||expected.tabId!==binding.tabId)
        throw Error('Continuation binding mismatch');
       pendingSubmitted=expected;
      }
   catch(error){return await pause(sendFailureDiagnostic(error,'Continuation'));}
   if(pendingSubmitted){
    state.workId=pendingSubmitted.workId; state.chatUrl=pendingSubmitted.chatUrl; state.tabId=pendingSubmitted.tabId;
    await publish('waiting_for_submitted_turn','waiting');
   }
   binding=null;state.workId=pendingSubmitted?.workId ?? null;
   if(pendingSubmitted){
    let reconciledBinding=pendingSubmitted, ready=false;
    const deadline=Date.now()+10*60*1000;
    try{
     for(let i=0;i<120 && Date.now()<deadline;i++){
      const reconciled: Awaited<ReturnType<typeof a.reconcileSubmittedTurn>> = await a.reconcileSubmittedTurn(project,reconciledBinding);
      reconciledBinding=reconciled.binding;
      if(reconciled.status==='ready'){ready=true;break;}
      await sleep('5 seconds');
     }
    }catch{return await pause('Submitted turn reconciliation found an identity or prompt mismatch.');}
    if(!ready)return await pause('Submitted turn reconciliation timed out before the bounded deadline.');
    expected=reconciledBinding; pendingSubmitted=null; state.workId=null;
   }
   await publish('waiting_for_work_start','waiting');
   continue;
  }
  const done=state.tasks.find(t=>t.id===task!.id)!;
  done.implementationStatus='implementation_done';done.reviewStatus='review_pending';
  await publish('implementation_done','review_pending');
  // No code review occurs here. Dependencies requiring review remain ineligible.
  const next=project.tasks.find(t=>state.tasks.find(s=>s.id===t.id)?.implementationStatus==='approved'&&
   !(t.dependsOn?.length));
  if(!next){
   const blocked=state.tasks.some(t=>t.implementationStatus==='approved');
   if(blocked)return await pause('Remaining approved work depends on external review.');
   await publish('approved_cycle_finished','implementation_done_review_pending');return state;
  }
  if(task.requiresReviewBeforeNext)return await pause('Repository requires external review before advancing.');
  if(bounded){
   const reservation=reservePilotSend(project.attendedPilotBudget!,state.pilotBudget!.usage,
     {kind:'next',previousTaskId:task.id,taskId:next.id});
   if(!reservation.allowed)return await pause(reservation.reason);
   state.pilotBudget!.usage=reservation.usage;
  }
  await publish('starting_next_project_chat','running');
  try{
     expected=await a.startNextTaskOnce(project,next,binding,event);
     if(!validBinding(expected,next,binding.workId)||expected.chatUrl===binding.chatUrl||expected.tabId===binding.tabId)
      throw Error('Next-task binding mismatch');
     pendingSubmitted=expected;
    }
  catch(error){return await pause(sendFailureDiagnostic(error,'Next-chat send may have occurred; reconcile without retrying.'));}
  task=next;state.taskId=next.id;continuations=0;
  if(pendingSubmitted){
   state.workId=pendingSubmitted.workId; state.chatUrl=pendingSubmitted.chatUrl; state.tabId=pendingSubmitted.tabId;
   await publish('waiting_for_submitted_turn','waiting');
  }
  binding=null;state.workId=pendingSubmitted?.workId ?? null;
  if(pendingSubmitted){
   let reconciledBinding=pendingSubmitted, ready=false;
   const deadline=Date.now()+10*60*1000;
   try{
    for(let i=0;i<120 && Date.now()<deadline;i++){
     const reconciled: Awaited<ReturnType<typeof a.reconcileSubmittedTurn>> = await a.reconcileSubmittedTurn(project,reconciledBinding);
     reconciledBinding=reconciled.binding;
     if(reconciled.status==='ready'){ready=true;break;}
     await sleep('5 seconds');
    }
   }catch{return await pause('Submitted turn reconciliation found an identity or prompt mismatch.');}
   if(!ready)return await pause('Submitted turn reconciliation timed out before the bounded deadline.');
   expected=reconciledBinding; pendingSubmitted=null; state.workId=null;
  }
  if(!expected)return await pause('Submitted target binding was not reconciled.');
  state.chatUrl=expected.chatUrl;state.tabId=expected.tabId;
  await publish('waiting_for_work_start','waiting');
 }
}
