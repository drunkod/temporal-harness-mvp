/** Production lifecycle composition. All process, source, inbox, and Temporal capabilities are explicit ports. */
import type { ControllerEffects, ControllerConfigV1, CloseoutReceipt } from './flowdeck-autonomy-controller.js';
import { createAutonomyController } from './flowdeck-autonomy-controller.js';
import { createWorkEventInbox, type WorkEventV1 } from './flowdeck-work-events.js';
import { finalizeAutonomousCycle, type ProductionEvidenceManifest, type ProductionEvidenceReaders } from './flowdeck-autonomy-production-evidence.js';
import { access, readFile } from 'node:fs/promises';
import { sha256 } from './flowdeck-autonomy-policy.js';
import type {FollowerOwnership,FollowerLease} from './flowdeck-autonomy-production-ownership.js';

export interface ProductionActor {
  /** Adopt or start only the actor pinned to the exact workflow/run. */
  startOrAdoptExact(target:{workflowId:string;runId:string},config?:ControllerConfigV1['follower']):Promise<void>;
  /** Must prove process/SDK completion for this run, including a predecessor actor after restart. */
  status():Promise<'running'|'stopped'|'unresponsive'>;
  /** Must cancel the underlying adapter and await its bounded drain, not just race a timeout. */
  stopAndDrain():Promise<void>;
}
export interface ProductionInbox {
  ingest(event:WorkEventV1, admission:{live?:boolean}):Promise<{disposition:string;delivery?:string}>;
  retryPending():Promise<{pending:number;blocked:number}>;
  status():Promise<{events:Record<string,{event:WorkEventV1;delivery:string}>;pending:number}>;
}
export interface SourceCursorStore {
  /** Must durably bind identity or reject any prior different identity before source access. */
  bindExact(identity:{source:string;ownerId:string;deviceId:string;workflowId:string;runId:string}):Promise<void>;
  readExact(identity:{source:string;ownerId:string;deviceId:string;workflowId:string;runId:string}):Promise<{cursor:string|null}>;
  /** Monotonic source cursor update, after inbox admission is durable. */
  advanceExact(identity:{source:string;ownerId:string;deviceId:string;workflowId:string;runId:string},cursor:string):Promise<void>;
}
export interface LiveSourceEvent { event:WorkEventV1; cursor:string }
export interface ProductionWorkSource {
  /** A bounded upstream snapshot complete through the current source checkpoint.
   * Required: a started stream is NOT evidence that the follower is ready.
   * The follow() cursor resumes from the last admitted snapshot event, preventing
   * a gap between catch-up and long-polling for future source records. */
  catchUp(input:{after:string|null;signal:AbortSignal}):Promise<{complete:true;events:LiveSourceEvent[]}>;
  /** Open after the initial backlog has been durably ingested and its inbox drained. */
  follow(input:{after:string|null;signal:AbortSignal}):AsyncIterable<LiveSourceEvent>;
}
export interface ProductionRuntimePorts {
  effects:Omit<ControllerEffects,'ensureWorker'|'workerStatus'|'stopWorker'|'ensureFollower'|'followerStatus'|'stopFollower'|'deliverEvent'|'assertNoOutstandingEffects'|'finalizeOrResumeCloseout'|'verifyCloseoutReceipt'> &
    Pick<ControllerEffects,'assertNoOutstandingEffects'|'verifyCloseoutReceipt'>;
  worker:ProductionActor;
  /** Independently verify every registered predecessor sender has exited.
   * Missing/ambiguous process witnesses must throw, never return an empty set. */
  predecessors:{assertStoppedExact(target:{workflowId:string;runId:string}):Promise<void>};
  /** Optional only for injected tests; production defaults to the pinned source/inbox follower below. */
  follower?:ProductionActor;
  signalEvent(target:{workflowId:string;runId:string},event:WorkEventV1):Promise<void>;
  source:ProductionWorkSource;
  inbox:ProductionInbox;
  cursor:SourceCursorStore;
  /** Lifetime cross-process ownership for the default production follower. */
  ownership?:FollowerOwnership;
  evidence(target:{workflowId:string;runId:string}):Promise<{manifest:ProductionEvidenceManifest;readers:ProductionEvidenceReaders}>;
  inspectExactRun(target:{workflowId:string;runId:string}):Promise<{activeActivities:number;browserCallsInFlight:number;unresolvedDispatches:string[]}>;
}

/** Inbox wake owns only the exact Temporal signal; inbox itself records delivery after ACK. */
export function createPinnedProductionInbox(input:{directory:string;ownerId:string;deviceId:string;workflowId:string;runId:string;signal:(target:{workflowId:string;runId:string},event:WorkEventV1)=>Promise<void>}):ProductionInbox {
 return createWorkEventInbox({directory:input.directory,ownerId:input.ownerId,deviceId:input.deviceId,
  wake:event=>input.signal({workflowId:input.workflowId,runId:input.runId},event)});
}

/** Wire a pinned source stream through the durable inbox. Wake only signals the exact run. */
export function createProductionSourceFollower(p:{source:ProductionWorkSource;inbox:ProductionInbox;cursor:SourceCursorStore;ownership?:FollowerOwnership;signalExact:(target:{workflowId:string;runId:string},event:WorkEventV1)=>Promise<void>}) {
 let task:Promise<void>|null=null, aborter:AbortController|null=null, run:{workflowId:string;runId:string}|null=null;
 let state:'running'|'stopped'|'unresponsive'='stopped';
 let failureReason:string|null=null;
 // A settled task is not a proved drain when lease release or source cleanup failed.
 let terminalFault:string|null=null;
 const stop=async()=>{
  aborter?.abort();
  const pending=task;
  if(pending){
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('source_follower_drain_deadline_exceeded')),10_000);})]);}
   catch(error){state='unresponsive';failureReason=error instanceof Error?error.message:String(error);throw error;}
   finally{if(timer)clearTimeout(timer);}
   // The operation catches errors to settle readiness, so awaiting it alone
   // cannot prove ownership release. Retain the task and quarantine on faults.
   if(terminalFault){
    state='unresponsive';failureReason=terminalFault;
    throw Error('source_follower_shutdown_unproven:'+terminalFault);
   }
   // If the deadline elapsed the task stays pinned and cannot be adopted.
   if(task===pending){task=null;aborter=null;}
  }
  state='stopped';failureReason=null;
 };
 const admit=async(scope:{source:string;ownerId:string;deviceId:string;workflowId:string;runId:string},row:LiveSourceEvent,signal:AbortSignal,lease:FollowerLease|null)=>{
  const active=()=>{if(signal.aborted)throw Error('source_follower_cancelled');};
  active();
  if(!row||typeof row.cursor!=='string'||!row.cursor||!row.event)throw Error('source event/cursor missing: quarantine');
  if(row.event.source!==scope.source||row.event.ownerId!==scope.ownerId||row.event.deviceId!==scope.deviceId)
   throw Error('source event scope differs from pinned follower: quarantine');
  active();await lease?.assertHeldExact();
  const admitted=await p.inbox.ingest(row.event,{live:true});
  // Admission already in flight when cancellation begins is not certified
  // stopped until it settles; never initiate another effect after cancellation.
  active();await lease?.assertHeldExact();
  const retried=await p.inbox.retryPending();
  active();
  const status=await p.inbox.status();
  active();
  const id=JSON.stringify([row.event.source,row.event.ownerId,row.event.deviceId,row.event.eventId]);
  if(status.events[id]?.delivery==='target_closed'||retried.blocked>0)
   throw Object.assign(Error('Temporal target closed'),{code:'FLOWDECK_TARGET_CLOSED'});
  if(admitted.disposition!=='accepted'&&admitted.disposition!=='duplicate')
   throw Error('unexpected upstream event disposition: quarantine');
  // Pending signal delivery remains durable independently of the source cursor.
  active();await lease?.assertHeldExact();
  await p.cursor.advanceExact(scope,row.cursor);
 };
 return {
  async startOrAdoptExact(target:{workflowId:string;runId:string},identity:{source:string;ownerId:string;deviceId:string}) {
   if(run&&(run.workflowId!==target.workflowId||run.runId!==target.runId))throw Error('source follower target identity mismatch');
   if(task){if(state!=='running')throw Error('source follower existing task is not proven running: '+(failureReason??'startup_or_shutdown_in_progress'));return;}
   if(typeof p.source.catchUp!=='function')throw Error('source catch-up readiness port missing: quarantine');
   run=target;const scope={source:identity.source,ownerId:identity.ownerId,deviceId:identity.deviceId,...target};
   // Readiness is not implied by a scheduled source task.
   state='unresponsive';failureReason='source_follower_starting';
   const controller=new AbortController();aborter=controller;
   const signal=controller.signal;
   let ready!:()=>void,notReady!:(reason:unknown)=>void;
   const readiness=new Promise<void>((resolve,reject)=>{ready=resolve;notReady=reject;});
   // The task is installed before the first async cursor/source operation.
   // stopAndDrain must observe and await the ENTIRE startup, not just follow().
   const operation=Promise.resolve().then(async()=>{
    let lease:FollowerLease|null=null;
    try {
    if(p.ownership)lease=await p.ownership.acquireExact(scope);
    const active=()=>{if(signal.aborted)throw Error('source_follower_cancelled');};
    active();await lease?.assertHeldExact();await p.cursor.bindExact(scope);
    active();const checkpoint=await p.cursor.readExact(scope);
    active();let last=checkpoint.cursor;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
     // The timer requests cancellation; it NEVER abandons an in-flight
     // catchUp() and certifies a drain while its source promise is unresolved.
     // A non-cooperative adapter remains unresponsive until it really exits.
     let expired=false;
     timer=setTimeout(()=>{expired=true;controller.abort();},10_000);
     const snapshot=await p.source.catchUp({after:last,signal});
     if(expired)throw Error('source_catchup_deadline_exceeded');
     active();
     if(!snapshot||snapshot.complete!==true||!Array.isArray(snapshot.events))
      throw Error('source initial catch-up is not independently complete: quarantine');
     for(const row of snapshot.events){active();await admit(scope,row,signal,lease);last=row.cursor;}
     active();const retried=await p.inbox.retryPending();
     active();const status=await p.inbox.status();
     active();
     if(retried.blocked>0||status.pending!==0)
      throw Error('follower initial inbox drain not acknowledged: quarantine');
     state='running';failureReason=null;ready();
    }finally{if(timer)clearTimeout(timer);}
    // Only now can a worker poll. No future source report is preloaded.
    for await(const row of p.source.follow({after:last,signal})){
     if(signal.aborted)break;
     await admit(scope,row,signal,lease);
    }
    if(!signal.aborted)state='stopped';
    } finally {await lease?.releaseExact();}
   }).catch(error=>{
    const message=error instanceof Error?error.message:String(error);
    const cooperativeCancellation=signal.aborted&&message==='source_follower_cancelled';
    if(!cooperativeCancellation){
     terminalFault=message;
     state='unresponsive';failureReason=message;
    }
    notReady(error);
    // The task settles only when startup/follow has actually terminated.
    // Cancellation during startup rejects readiness without reopening a sender.
   });
   task=operation;
   operation.catch(()=>undefined);
   await readiness;
  },
  status:async()=>state,
  stopAndDrain:stop,
 };
}

/** Builds ControllerEffects while retaining controller v2's fail-closed lifecycle and claim handling. */
export function createProductionRuntimeEffects(p:ProductionRuntimePorts):ControllerEffects {
 if(typeof p?.predecessors?.assertStoppedExact!=='function')throw Error('production predecessor termination proof port is required');
 if(!p.follower&&!p.ownership)throw Error('production source follower lifetime ownership port is required');
 const follower=p.follower??createProductionSourceFollower({source:p.source,inbox:p.inbox,cursor:p.cursor,ownership:p.ownership,signalExact:p.signalEvent});
 let target:{workflowId:string;runId:string}|null=null;
 const bound=()=>{if(!target)throw Error('exact Temporal run identity is not bound');return target;};
 // Controller V2 deliberately skips start/checkExisting when resuming
 // business_completed/shutdown_uncertain/closeout_pending. Adopt only after
 // independently proving the completed exact Temporal history; never start.
 const adoptCompleted=async(t:{workflowId:string;runId:string})=>{
  if(!target){
   const existing=await p.effects.checkExisting(t);
   if(existing.status!=='completed'||existing.runId!==t.runId||!existing.policyDigest)
    throw Error('cannot adopt closeout without exact completed Temporal identity: quarantine');
   target={workflowId:t.workflowId,runId:t.runId};
  }
  if(target.workflowId!==t.workflowId||target.runId!==t.runId)
   throw Error('closeout target differs from pinned Temporal run');
 };
 return {
  ...p.effects,
  async startExistingIdentity(input){const result=await p.effects.startExistingIdentity(input);target={workflowId:input.workflowId,runId:result.runId};return result;},
  async checkExisting(input){const r=await p.effects.checkExisting(input);if(r.runId)target={workflowId:input.workflowId,runId:r.runId};return r;},
  async ensureFollower(config,_onEvent){const t=bound();await follower.startOrAdoptExact(t,config);},
  followerStatus:()=>follower.status(),
  stopFollower:()=>follower.stopAndDrain(),
  async ensureWorker(){await p.worker.startOrAdoptExact(bound());},
  workerStatus:()=>p.worker.status(),
  stopWorker:()=>p.worker.stopAndDrain(),
  async deliverEvent(_id,t){if(t.workflowId!==bound().workflowId||t.runId!==bound().runId)throw Error('event target differs from pinned Temporal run');},
  async assertNoOutstandingEffects(t){
   await adoptCompleted(t);
   const [w,f,e]=await Promise.all([p.worker.status(),follower.status(),p.inspectExactRun(t)]);
   if(w!=='stopped'||f!=='stopped'||e.activeActivities!==0||e.browserCallsInFlight!==0||e.unresolvedDispatches.length)throw Error('sender_drain_unproven');
   await p.predecessors.assertStoppedExact(t);
   await p.effects.assertNoOutstandingEffects(t);
  },
  async finalizeOrResumeCloseout(t):Promise<CloseoutReceipt>{
   await adoptCompleted(t);
   if(await p.worker.status()!=='stopped'||await follower.status()!=='stopped')throw Error('sender_drain_unproven');
   await p.predecessors.assertStoppedExact(t);
   const {manifest,readers}=await p.evidence(t);
   if(manifest.workflowId!==t.workflowId||manifest.runId!==t.runId||manifest.policyDigest!==t.policyDigest)throw Error('production evidence manifest identity mismatch');
   const hasPriorTransaction=await access(manifest.paths.lock).then(()=>true,()=>false);
   await finalizeAutonomousCycle(manifest,readers,{resume:hasPriorTransaction});
   const receiptBytes=await readFile(manifest.paths.receipt);
   return {receiptPath:manifest.paths.receipt,receiptSha256:sha256(receiptBytes)};
  },
 };
}

export function createProductionRuntimeComposition(controllerPath:string,ports:ProductionRuntimePorts,ownerRoot?:string){
 const effects=createProductionRuntimeEffects(ports);
 const controller=ownerRoot?createAutonomyController(controllerPath,effects,ownerRoot):createAutonomyController(controllerPath,effects);
 return {controller,effects};
}
