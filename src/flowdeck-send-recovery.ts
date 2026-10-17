import { mkdir, readFile, readdir, writeFile, open, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {SupervisorProject} from './flowdeck-projects.js';
import { createHash, randomUUID } from 'node:crypto';

export const SEND_PHASES = ['claimed', 'preparing', 'staged', 'click_attempted', 'submitted', 'reconciled', 'pre_send_failed'] as const;
export type SendPhase = typeof SEND_PHASES[number];
export type SendKeys = { projectId: string; taskId: string; eventHash: string; phaseHash: string };
export type SendJournalEntry = SendKeys & {
  dispatchId: string; phase: SendPhase; at: string; cause?: string; attemptId?: string;
  oldDispatchId?: string; generation?: string; eventId?: string; phaseKind?: 'continue' | 'next';
  previousBinding?: unknown; event?: unknown;
};
export type RecoveryAuthorization = SendKeys & {
  authorizationId: string; attemptId: string; oldDispatchId: string; newDispatchId: string; issuedAt: string;
};
export type SuccessorRecoveryAuthorization = RecoveryAuthorization & {
  kind: 'successor'; parentAuthorizationId: string; failedParentDispatchId: string;
};
export type SuccessorRecoveryInput = SendKeys & {
  failedParentDispatchId: string; failedAttemptId: string;
};
export type LegacyStageFailureProof = {
  kind: 'temporal-activity-stage-failure-v1'; verified: true; runId: string; workflowId: string;
  scheduledEventId: string; activityId?: string; historySha256: string; sourceAttestation: string;
};

const MAX_CAUSE = 600;
const MAX_AUDIT_BYTES = 128 * 1024;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sendEventHash = (value: unknown) => digest(value);
export const sendPhaseHash = (value: unknown) => digest(value);
export const LEGACY_STAGE_ORDER_ATTESTATION = digest('flowdeck legacy send review: stage and full composer match complete before click; click marker is durable before click; no timeout/cancellation proof accepted');

export function sanitizeSendCause(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw.replace(/bearer\s+[^\s]+/gi, 'bearer [redacted]')
    .replace(/(?:sk|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/:\/\/[^\s/]+@/g, '://[redacted]@').replace(/\s+/g, ' ').trim().slice(0, MAX_CAUSE);
}

const phaseOrder = new Map(SEND_PHASES.map((phase, index) => [phase, index]));
const phaseFileName = (dispatchId: string, phase: SendPhase) => `dispatch-${dispatchId}-${String(phaseOrder.get(phase)).padStart(2, '0')}-${phase}.json`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createSendRecoveryStore(base: string) {
  const root = join(resolve(base), '.state', 'flowdeck-supervisor', 'send-recovery');
  const phaseFile = (dispatchId: string, phase: SendPhase) => join(root, phaseFileName(dispatchId, phase));
  const claim = (kind: string, hash: string) => join(root, `claim-${kind}-${hash}.json`);
  const authorization = (id: string) => join(root, `authorization-${id}.json`);
  const authorizationSlot = (id: string) => join(root, `authorization-slot-${id}.json`);
  const consumed = (id: string) => join(root, `authorization-${id}.consumed`);
  const audit = join(root, 'audit.jsonl');
  const ensure = () => mkdir(root, { recursive: true, mode: 0o700 });
  const syncDirectory=async()=>{const directory=await open(root,'r');try{await directory.sync();}finally{await directory.close();}};
  const fsyncAppend = async (file: string, value: unknown) => {
    await ensure();
    let target = file;
    const size = await stat(file).then(info => info.size).catch((e: any) => e?.code === 'ENOENT' ? 0 : Promise.reject(e));
    if (size >= MAX_AUDIT_BYTES) target = `${file}.${Date.now()}-${randomUUID()}.rotated`;
    const handle = await open(target, 'a', 0o600);
    try { await handle.write(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
  };
  const readEntries = async (dispatchId: string): Promise<SendJournalEntry[]> => {
    const files = await readdir(root).catch((e: any) => e?.code === 'ENOENT' ? [] : Promise.reject(e));
    const selected = files.filter(name => name.startsWith(`dispatch-${dispatchId}-`) && name.endsWith('.json')).sort();
    return Promise.all(selected.map(name => readFile(join(root, name), 'utf8').then(text => JSON.parse(text) as SendJournalEntry)));
  };
  const latest = async (dispatchId: string) => (await readEntries(dispatchId)).at(-1) ?? null;
  const record = async (entry: Omit<SendJournalEntry, 'at'>) => {
    await ensure();
    const full = { ...entry, at: new Date().toISOString() };
    const target = phaseFile(entry.dispatchId, entry.phase);
    try {
      const handle = await open(target, 'wx', 0o600);
      try { await handle.write(JSON.stringify(full, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
      const prior = JSON.parse(await readFile(target, 'utf8')) as SendJournalEntry;
      if (!same({ ...prior, at: undefined }, { ...full, at: undefined })) throw Error('Immutable send phase differs; refuse retry');
      return prior;
    }
    await syncDirectory();
    await fsyncAppend(audit, { ...full, audit: true });
    return full;
  };
  const createClaim = async (kind: 'send-event' | 'send-phase', hash: string, value: unknown) => {
    await ensure();
    try {
      const handle = await open(claim(kind, hash), 'wx', 0o600);
      try { await handle.write(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
    } catch (e: any) { if (e?.code === 'EEXIST') throw Error('Already claimed; reconcile, never retry an uncertain send'); throw e; }
  };
  const authorizationFiles = async () => {
    const files = await readdir(root).catch((e: any) => e?.code === 'ENOENT' ? [] : Promise.reject(e));
    return Promise.all(files.filter(name => /^authorization-[0-9a-f-]+\.json$/.test(name))
      .map(name => readFile(join(root, name), 'utf8').then(text => JSON.parse(text))));
  };
  const hasConsumed = async (id: string) => readFile(consumed(id), 'utf8').then(() => true)
    .catch((e: any) => e?.code === 'ENOENT' ? false : Promise.reject(e));
  const clickPhases = new Set<SendPhase>(['click_attempted', 'submitted', 'reconciled']);
  const validateDispatch = async (dispatchId: string, keys: SendKeys, requireParent?: string) => {
    const entries = await readEntries(dispatchId);
    if (!entries.length || entries.some(e => clickPhases.has(e.phase))) throw Error('Successor lineage contains a click-attempted or later phase');
    if (entries.some(e => e.projectId !== keys.projectId || e.taskId !== keys.taskId || e.eventHash !== keys.eventHash || e.phaseHash !== keys.phaseHash))
      throw Error('Successor lineage keys do not match');
    const claimed = entries.find(e => e.phase === 'claimed');
    if (!claimed || entries.find(e => e.phase === 'preparing') === undefined || entries.at(-1)?.phase !== 'pre_send_failed')
      throw Error('Successor lineage requires claimed -> preparing -> pre_send_failed');
    if (requireParent !== undefined && claimed.oldDispatchId !== requireParent) throw Error('Successor claimed record does not link to its parent authorization');
    return entries;
  };
  const lineage = async (input: SuccessorRecoveryInput, ignoreAuthorizationId?: string) => {
    const auths = await authorizationFiles();
    const keysMatch=(value:SendKeys)=>value.projectId===input.projectId&&value.taskId===input.taskId&&value.eventHash===input.eventHash&&value.phaseHash===input.phaseHash;
    const owners=auths.filter(auth=>auth.newDispatchId===input.failedParentDispatchId);
    if(owners.length!==1)throw Error('Successor parent authorization is missing or duplicated');
    const parent=owners[0] as RecoveryAuthorization;
    const targetEntries=await validateDispatch(input.failedParentDispatchId,input,parent.oldDispatchId);
    const claimed=targetEntries.find(entry=>entry.phase==='claimed')!;
    if(claimed.attemptId!==input.failedAttemptId)throw Error('Recorded attempt ID does not exactly match the failed dispatch journal');
    const visited=new Set<string>(), ancestors=new Set<string>();
    let current:any=parent, child=input.failedParentDispatchId, complete=false;
    for(let depth=0;depth<8;depth++){
      if(visited.has(child))throw Error('Successor authorization lineage contains a cycle');
      visited.add(child);ancestors.add(current.authorizationId);
      if(!keysMatch(current))throw Error('Successor lineage authorization keys do not match');
      if(!await hasConsumed(current.authorizationId))throw Error('An ancestor authorization is not consumed');
      await validateDispatch(child,input,current.oldDispatchId);
      const slotPath=current.kind==='successor'?join(root,`successor-slot-${current.oldDispatchId}.json`):authorizationSlot(input.phaseHash);
      const slot=JSON.parse(await readFile(slotPath,'utf8').catch((error:any)=>{if(error.code==='ENOENT')throw Error('Ancestor authorization slot is missing');throw error;}));
      if(slot.authorizationId!==current.authorizationId||!keysMatch(slot))throw Error('Ancestor authorization slot changed');
      const older=auths.filter(auth=>auth.newDispatchId===current.oldDispatchId);
      if(older.length>1)throw Error('Successor ancestry is ambiguous');
      if(older.length===1){
        if(current.kind==='successor'&&current.parentAuthorizationId!==older[0].authorizationId)throw Error('Successor parent authorization link changed');
        child=current.oldDispatchId;current=older[0];continue;
      }
      const rootEntries=await readEntries(current.oldDispatchId);
      if(rootEntries.length)await validateDispatch(current.oldDispatchId,input);
      else {
        const proof=current.legacyProof;
        if(current.kind==='successor'||!proof||proof.verified!==true||proof.kind!=='temporal-activity-stage-failure-v1'||proof.sourceAttestation!==LEGACY_STAGE_ORDER_ATTESTATION||!proof.runId||!proof.workflowId||!proof.scheduledEventId||!/^[a-f0-9]{64}$/.test(proof.historySha256||''))
          throw Error('Missing root journal requires the recorded verified legacy Temporal proof');
      }
      complete=true;break;
    }
    if(!complete)throw Error('Successor lineage exceeds maximum depth');
    for(const auth of auths.filter(auth=>auth.phaseHash===input.phaseHash)){
      if(!keysMatch(auth))throw Error('Related authorization keys changed');
      if((await readEntries(auth.newDispatchId)).some(entry=>clickPhases.has(entry.phase)))throw Error('Related lineage contains a click-attempted or later phase');
      if(!ancestors.has(auth.authorizationId)&&auth.authorizationId!==ignoreAuthorizationId)throw Error('A successor authorization already exists or forks this lineage');
    }
    const successorSlot=await readFile(join(root,`successor-slot-${input.failedParentDispatchId}.json`),'utf8').then(JSON.parse).catch((error:any)=>error.code==='ENOENT'?null:Promise.reject(error));
    if(successorSlot&&successorSlot.authorizationId!==ignoreAuthorizationId)throw Error('Successor authorization slot already exists');
    if(ignoreAuthorizationId&&successorSlot?.authorizationId!==ignoreAuthorizationId)throw Error('Successor authorization slot is missing or changed');
    return {parent,targetEntries,auths};
  };
  const successorPreview = async (input: SuccessorRecoveryInput) => {
    await lineage(input);
    return { eligible: true, failedParentDispatchId: input.failedParentDispatchId, failedAttemptId: input.failedAttemptId, slot: `successor-slot-${input.failedParentDispatchId}.json` };
  };
  const authorize = async (input: SendKeys & { oldDispatchId: string; attemptId: string; receiptPresent?: boolean; taskBindingPresent?: boolean; legacyProof?: LegacyStageFailureProof }) => {
    const entries = await readEntries(input.oldDispatchId);
    if (entries.some(e => e.phase === 'click_attempted' || e.phase === 'submitted' || e.phase === 'reconciled')) throw Error('Recovery forbidden after click-attempted or later phase');
    const old = entries.at(-1);
    const legacy = Boolean(input.legacyProof);
    if (!old && !legacy) throw Error('Recovery requires a durable pre_send_failed phase');
    if (old && old.phase !== 'pre_send_failed') throw Error('Recovery requires a durable pre_send_failed phase');
    if (old && (old.projectId !== input.projectId || old.taskId !== input.taskId || old.eventHash !== input.eventHash || old.phaseHash !== input.phaseHash)) throw Error('Recovery keys do not match the failed dispatch');
    if (input.receiptPresent || input.taskBindingPresent) throw Error('Recovery requires absent sent receipt and task binding');
    if (input.legacyProof && (!input.legacyProof.verified || input.legacyProof.kind !== 'temporal-activity-stage-failure-v1' || input.legacyProof.sourceAttestation !== LEGACY_STAGE_ORDER_ATTESTATION || !input.legacyProof.runId || !input.legacyProof.scheduledEventId)) throw Error('Legacy proof is not a verified exact Temporal stage failure');
    const auth: RecoveryAuthorization = { ...input, authorizationId: randomUUID(), newDispatchId: randomUUID(), issuedAt: new Date().toISOString() };
    await ensure();
    try { const handle = await open(authorizationSlot(input.phaseHash), 'wx', 0o600); try { await handle.write(JSON.stringify({ ...auth, slot: 'one-use-old-dispatch' }) + '\n'); await handle.sync(); } finally { await handle.close(); } }
    catch (e: any) { if (e?.code === 'EEXIST') throw Error('Recovery authorization already issued for this old dispatch'); throw e; }
    const authHandle = await open(authorization(auth.authorizationId), 'wx', 0o600); try { await authHandle.write(JSON.stringify(auth) + '\n'); await authHandle.sync(); } finally { await authHandle.close(); }
    await syncDirectory(); await fsyncAppend(audit, { ...auth, phase: 'authorization_issued' }); return auth;
  };
  const authorizeSuccessor = async (input: SuccessorRecoveryInput) => {
    const checked = await lineage(input);
    const auth: SuccessorRecoveryAuthorization = { ...input, oldDispatchId: input.failedParentDispatchId, attemptId: input.failedAttemptId, authorizationId: randomUUID(), newDispatchId: randomUUID(), issuedAt: new Date().toISOString(), kind: 'successor', parentAuthorizationId: checked.parent.authorizationId, failedParentDispatchId: input.failedParentDispatchId };
    await ensure();
    const slot = join(root, `successor-slot-${input.failedParentDispatchId}.json`);
    try { const handle = await open(slot, 'wx', 0o600); try { await handle.write(JSON.stringify(auth) + '\n'); await handle.sync(); } finally { await handle.close(); } }
    catch (e: any) { if (e?.code === 'EEXIST') throw Error('Successor authorization already issued for this failed parent'); throw e; }
    const handle = await open(authorization(auth.authorizationId), 'wx', 0o600); try { await handle.write(JSON.stringify(auth) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(); await fsyncAppend(audit, { ...auth, phase: 'successor_authorization_issued' }); return auth;
  };
  const consume = async (auth: RecoveryAuthorization) => {
    const stored = JSON.parse(await readFile(authorization(auth.authorizationId), 'utf8')) as RecoveryAuthorization;
    const slot=JSON.parse(await readFile(authorizationSlot(stored.phaseHash),'utf8')) as RecoveryAuthorization;
    if(slot.authorizationId!==stored.authorizationId)throw Error('Recovery slot does not match authorization');
    const fields: (keyof RecoveryAuthorization)[] = ['projectId', 'taskId', 'eventHash', 'phaseHash', 'authorizationId', 'attemptId', 'oldDispatchId', 'newDispatchId', 'issuedAt'];
    if (fields.some(field => stored[field] !== auth[field])) throw Error('Recovery authorization fields mismatch');
    if (await hasConsumed(stored.authorizationId)) throw Error('Recovery authorization already consumed exclusively');
    try { const marker=await open(consumed(stored.authorizationId),'wx',0o600);try{await marker.writeFile(JSON.stringify({...stored,consumedAt:new Date().toISOString()})+'\n');await marker.sync();}finally{await marker.close();}await syncDirectory(); } catch (e: any) { if (e?.code === 'EEXIST') throw Error('Recovery authorization already consumed exclusively'); throw e; }
    return stored;
  };
  const consumeSuccessor = async (auth: SuccessorRecoveryAuthorization) => {
    const stored = JSON.parse(await readFile(authorization(auth.authorizationId), 'utf8')) as SuccessorRecoveryAuthorization;
    if (JSON.stringify(stored) !== JSON.stringify(auth)) throw Error('Successor authorization fields mismatch');
    await lineage({ projectId: stored.projectId, taskId: stored.taskId, eventHash: stored.eventHash, phaseHash: stored.phaseHash, failedParentDispatchId: stored.failedParentDispatchId, failedAttemptId: stored.attemptId }, stored.authorizationId);
    if (await hasConsumed(stored.authorizationId)) throw Error('Successor authorization already consumed exclusively');
    try { const marker=await open(consumed(stored.authorizationId),'wx',0o600);try{await marker.writeFile(JSON.stringify({...stored,consumedAt:new Date().toISOString()})+'\n');await marker.sync();}finally{await marker.close();}await syncDirectory(); } catch (e: any) { if (e?.code === 'EEXIST') throw Error('Successor authorization already consumed exclusively'); throw e; }
    return stored;
  };
  return { root, audit, record, latest, readEntries, createClaim, authorize, consume, successorPreview, authorizeSuccessor, consumeSuccessor };
}

function eventName(event: any): string { return String(event?.eventType ?? event?.event_type ?? ''); }
function jsonOf(value: unknown): string { try { return JSON.stringify(value); } catch { return ''; } }
export function verifyLegacyStageFailure(history: any, expectedInput: unknown, scheduledEventId: string, sourceAttestation: string, execution?: { runId: string; workflowId: string }): LegacyStageFailureProof {
  if (execution && ((history?.runId && history.runId !== execution.runId) || (history?.workflowId && history.workflowId !== execution.workflowId))) throw Error('Temporal history execution does not match the exact requested run');
  const events = Array.isArray(history?.events) ? history.events : [];
  const scheduled = events.find((event: any) => event.activityTaskScheduledEventAttributes && String(event.eventId) === String(scheduledEventId));
  const failed = events.filter((event: any) => event.activityTaskFailedEventAttributes && String(event.activityTaskFailedEventAttributes.scheduledEventId) === String(scheduledEventId));
  if (!scheduled || failed.length !== 1) throw Error('Exact scheduled activity and one ActivityTaskFailed event are required');
  if (events.some((event: any) => /TIMEOUT|TIMED_OUT|CANCELED|CANCELLED/i.test(eventName(event)) && jsonOf(event).includes(String(scheduledEventId)))) throw Error('Timeout/cancellation history cannot prove pre-click failure');
  const attempts=scheduled.activityTaskScheduledEventAttributes?.retryPolicy?.maximumAttempts;
  if(attempts!==1)throw Error('Legacy proof requires an activity with maximumAttempts 1');
  const started=events.filter((event:any)=>event.activityTaskStartedEventAttributes&&String(event.activityTaskStartedEventAttributes.scheduledEventId)===String(scheduledEventId));
  if(started.some((event:any)=>Number(event.activityTaskStartedEventAttributes.attempt)>1))throw Error('Legacy activity was retried; pre-click proof is insufficient');
  const failure = failed[0].activityTaskFailedEventAttributes?.failure ?? failed[0].failure ?? {};
  const failureText = jsonOf(failure);
  if (/TIMEOUT|CANCELED|CANCELLED/i.test(failureText) || !/Object\.stage/.test(failureText) || !/\bsend\b/.test(failureText)) throw Error('Failure must identify a non-timeout Object.stage failure in send');
  if (sourceAttestation !== LEGACY_STAGE_ORDER_ATTESTATION) throw Error('Current send ordering attestation is required');
  const input = scheduled.activityTaskScheduledEventAttributes?.input ?? scheduled.input;
  if (!same(input.decoded ?? input, expectedInput)) throw Error('Scheduled activity input does not exactly match the reviewed recovery scope');
  const historySha256 = createHash('sha256').update(jsonOf(history)).digest('hex');
  return { kind: 'temporal-activity-stage-failure-v1', verified: true, runId: String(history.runId ?? ''), workflowId: String(history.workflowId ?? ''), scheduledEventId: String(scheduledEventId), activityId: String(scheduled.activityTaskScheduledEventAttributes?.activityId ?? ''), historySha256, sourceAttestation };
}

export type SendRecoveryAuthorization = RecoveryAuthorization | SuccessorRecoveryAuthorization;

/** One release opportunity per exact Temporal execution; an uncertain RPC stays sealed. */
export async function claimRecoveryRelease(base:string,workflowId:string,runId:string,authorizationId:string){
 if(!workflowId||!runId||!authorizationId)throw Error('Exact readiness release identity is required');
 const root=join(resolve(base),'.state/flowdeck-supervisor/send-recovery');
 const key=digest([workflowId,runId]);
 let handle;try{handle=await open(join(root,`release-${key}.json`),'wx',0o600);}catch(error:any){if(error.code==='EEXIST')throw Error('Readiness release already claimed; inspect exact run history before retrying');throw error;}
 try{await handle.writeFile(JSON.stringify({workflowId,runId,authorizationId,at:new Date().toISOString()})+'\n');await handle.sync();}finally{await handle.close();}
 const directory=await open(root,'r');try{await directory.sync();}finally{await directory.close();}
}

/** Validate the exact immutable request emitted by the recovery CLI, without consuming it. */
export async function readRecoveryResumeRequest(base:string,path:string,project:SupervisorProject){
 const input=JSON.parse(await readFile(path,'utf8'));
 const auth=input.authorization as SendRecoveryAuthorization;
 if(!auth||!/^[a-f0-9-]{36}$/i.test(auth.authorizationId))throw Error('Invalid recovery authorization identity');
 const root=join(resolve(base),'.state/flowdeck-supervisor/send-recovery');
 if(resolve(path)!==join(root,`resume-${auth.authorizationId}.json`))throw Error('Recovery request is not the immutable issued path');
 const stored=JSON.parse(await readFile(join(root,`authorization-${auth.authorizationId}.json`),'utf8'));
 if(!same(stored,auth))throw Error('Stored recovery authorization differs');
 if(input.phase!=='next'||input.projectId!==project.id||auth.projectId!==project.id||auth.taskId!==input.taskId||
  !project.tasks.some(task=>task.id===input.taskId)||!project.tasks.some(task=>task.id===input.completedTaskId)||input.taskId===input.completedTaskId||
  input.previous?.projectId!==project.id||input.previous.taskId!==input.completedTaskId||input.event?.workId!==input.previous.workId||
  input.event.ownerId!==project.ownerId||input.event.deviceId!==project.deviceId||input.event.kind!=='work_reported'||input.event.origin!=='event'||
  auth.eventHash!==sendEventHash([project.id,input.taskId,'next',input.event.eventId])||auth.phaseHash!==sendPhaseHash([project.id,input.taskId,'next','initial']))throw Error('Recovery request scope mismatch');
 const slotPath='kind' in auth&&auth.kind==='successor'?join(root,`successor-slot-${auth.oldDispatchId}.json`):join(root,`authorization-slot-${auth.phaseHash}.json`);
 const slot=JSON.parse(await readFile(slotPath,'utf8'));
 if(slot.authorizationId!==auth.authorizationId)throw Error('Recovery request slot changed');
 try{await readFile(join(root,`authorization-${auth.authorizationId}.consumed`));throw Error('Recovery request authorization is already consumed');}catch(error:any){if(error.code!=='ENOENT')throw error;}
 return input as {projectId:string;taskId:string;completedTaskId:string;phase:'next';previous:{projectId:string;taskId:string;workId:string;chatUrl:string;tabId:string};event:import('./flowdeck-work-events.js').WorkEventV1;authorization:SendRecoveryAuthorization};
}
