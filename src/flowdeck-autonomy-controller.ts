/** Durable, noninteractive orchestration boundary. All runtime effects are injected. */
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { autonomyPolicyDigest, type AutonomyPolicyV1 } from './flowdeck-autonomy-policy.js';

export interface ControllerConfigV1 {
  schema: 'flowdeck.autonomy-controller-config/v1';
  policy: AutonomyPolicyV1;
  workflowId: string;
  runId: string | null;
  ownerScope: { ownerId: string; deviceId: string; worktree: string };
  follower: { schema: 'flowdeck.event-follower/v1'; source: string; ownerId: string; deviceId: string; cursorPath: string };
  deadlineAt: string;
  stopGraceMs: number;
}

export type ControllerPhase = 'prepared' | 'starting' | 'active' | 'business_completed' |
  'stopping_senders' | 'shutdown_uncertain' | 'closeout_pending' | 'closeout_blocked' |
  'retired' | 'business_blocked' | 'cancelled';
export interface CloseoutReceipt { receiptPath: string; receiptSha256: string }
export interface ControllerManifestV2 {
  schema: 'flowdeck.autonomy-controller-manifest/v2'; version: 2; campaignId: string;
  policyDigest: string; workflowId: string; runId: string | null; ownerScopeDigest: string;
  startClaim: { workflowId: string; runId: string | null; inputDigest: string };
  followerConfigDigest: string; state: ControllerPhase;
  worker: 'not_started' | 'starting' | 'running' | 'stopping' | 'stopped' | 'unresponsive';
  follower: 'not_started' | 'starting' | 'running' | 'stopping' | 'stopped' | 'missing' | 'unresponsive';
  deadlineAt: string; stopGraceMs: number; checkpointedEventIds: string[]; retryCount: number;
  businessResult: null | { status: 'completed' | 'blocked' | 'cancelled'; reason: string; workflowId: string; runId: string | null; finishedAt: string };
  closeoutReceipt: CloseoutReceipt | null; failureReason: string | null; updatedAt: string;
}
export type ControllerManifestV1 = ControllerManifestV2;
export interface ControllerEffects {
  authorize(config: ControllerConfigV1): Promise<{ allowed: boolean; policyDigest: string; reason?: string }>;
  checkExisting(id: { workflowId: string; runId: string | null }): Promise<{ status: 'missing' | 'running' | 'completed' | 'cancelled' | 'unknown'; runId: string | null; policyDigest: string | null }>;
  startExistingIdentity(input: { workflowId: string; policyDigest: string }): Promise<{ runId: string; policyDigest: string }>;
  /** Each ensure operation adopts only the exact persisted identity. */
  ensureWorker(): Promise<void>; workerStatus(): Promise<'running' | 'stopped' | 'unresponsive'>; stopWorker(): Promise<void>;
  ensureFollower(config: ControllerConfigV1['follower'], onEvent: (id: string) => Promise<void>): Promise<void>;
  followerStatus(): Promise<'running' | 'stopped' | 'missing' | 'unresponsive'>; stopFollower(): Promise<void>;
  /** Must signal the exact run. Resolve only after the signal RPC acknowledges. */
  deliverEvent(id: string, target: { workflowId: string; runId: string }): Promise<void>;
  status(): Promise<unknown>;
  verify(): Promise<{ terminal: boolean; status: 'completed' | 'blocked' | 'cancelled'; reason: string }>;
  cancelWorkflow(id: { workflowId: string; runId: string }): Promise<void>;
  /** Independently prove that no sender, activity, or uncertain effect remains. */
  assertNoOutstandingEffects(target: { workflowId: string; runId: string }): Promise<void>;
  /** Must resume the same already-claimed archival transaction for this exact run. */
  finalizeOrResumeCloseout(target: { workflowId: string; runId: string; policyDigest: string }): Promise<CloseoutReceipt>;
  verifyCloseoutReceipt(receipt: CloseoutReceipt, target: { workflowId: string; runId: string; policyDigest: string }): Promise<void>;
  now?: () => number;
}
const digest = /^[a-f0-9]{64}$/; const ident = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const hash = (v: unknown) => autonomyPolicyDigest(v as AutonomyPolicyV1);
const exact = (x: unknown, keys: string[]) => !!x && typeof x === 'object' && !Array.isArray(x) && JSON.stringify(Object.keys(x as object).sort()) === JSON.stringify([...keys].sort());
const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const json = (v: unknown) => JSON.stringify(stable(v));
function validate(c: ControllerConfigV1) {
  if (!exact(c, ['schema','policy','workflowId','runId','ownerScope','follower','deadlineAt','stopGraceMs']) || c.schema !== 'flowdeck.autonomy-controller-config/v1') throw Error('invalid controller config');
  if (!ident.test(c.workflowId) || (c.runId !== null && !ident.test(c.runId)) || c.ownerScope?.ownerId !== c.policy.ownerId || c.ownerScope?.deviceId !== c.policy.deviceId || resolve(c.ownerScope?.worktree ?? '') !== c.policy.worktree) throw Error('owner or workflow identity mismatch');
  if (!exact(c.ownerScope,['ownerId','deviceId','worktree']) || !exact(c.follower,['schema','source','ownerId','deviceId','cursorPath']) || c.follower.schema !== 'flowdeck.event-follower/v1' || c.follower.ownerId !== c.policy.ownerId || c.follower.deviceId !== c.policy.deviceId || !resolve(c.follower.cursorPath).startsWith(c.policy.allowedRoot + '/')) throw Error('follower identity invalid');
  if (!Number.isSafeInteger(c.stopGraceMs) || c.stopGraceMs < 1 || !Number.isFinite(Date.parse(c.deadlineAt))) throw Error('invalid lifecycle deadline');
}
function strictManifest(m: any): asserts m is ControllerManifestV2 {
  const keys = ['schema','version','campaignId','policyDigest','workflowId','runId','ownerScopeDigest','startClaim','followerConfigDigest','state','worker','follower','deadlineAt','stopGraceMs','checkpointedEventIds','retryCount','businessResult','closeoutReceipt','failureReason','updatedAt'];
  if (!exact(m, keys) || m.schema !== 'flowdeck.autonomy-controller-manifest/v2' || m.version !== 2 || !digest.test(m.policyDigest) || !digest.test(m.ownerScopeDigest) || !digest.test(m.followerConfigDigest) || !exact(m.startClaim,['workflowId','runId','inputDigest']) || !digest.test(m.startClaim.inputDigest) || m.startClaim.workflowId !== m.workflowId || m.startClaim.runId !== m.runId || (m.runId !== null && !ident.test(m.runId)) || !Number.isSafeInteger(m.retryCount) || m.retryCount < 0) throw Error('invalid durable controller manifest');
  if (!ident.test(m.workflowId) || (m.runId !== null && !ident.test(m.runId)) || !ident.test(m.campaignId) || !['prepared','starting','active','business_completed','stopping_senders','shutdown_uncertain','closeout_pending','closeout_blocked','retired','business_blocked','cancelled'].includes(m.state) || !['not_started','starting','running','stopping','stopped','unresponsive'].includes(m.worker) || !['not_started','starting','running','stopping','stopped','missing','unresponsive'].includes(m.follower) || !Number.isFinite(Date.parse(m.deadlineAt)) || !Number.isSafeInteger(m.stopGraceMs) || m.stopGraceMs < 1 || !Array.isArray(m.checkpointedEventIds) || m.checkpointedEventIds.some((x: unknown) => typeof x !== 'string' || !x) || new Set(m.checkpointedEventIds).size !== m.checkpointedEventIds.length || !Number.isFinite(Date.parse(m.updatedAt))) throw Error('invalid controller lifecycle state');
  if (m.businessResult !== null && (!exact(m.businessResult,['status','reason','workflowId','runId','finishedAt']) || m.businessResult.workflowId !== m.workflowId || m.businessResult.runId !== m.runId || !['completed','blocked','cancelled'].includes(m.businessResult.status))) throw Error('invalid business result');
  if (m.closeoutReceipt !== null && (!exact(m.closeoutReceipt,['receiptPath','receiptSha256']) || typeof m.closeoutReceipt.receiptPath !== 'string' || !digest.test(m.closeoutReceipt.receiptSha256))) throw Error('invalid closeout receipt');
}
function migrateV1(old: any): ControllerManifestV2 {
  const keys = ['schema','version','campaignId','policyDigest','workflowId','runId','ownerScopeDigest','startClaim','followerConfigDigest','state','worker','follower','deadlineAt','stopGraceMs','lastEventId','retryCount','terminalResult','updatedAt'];
  if (!exact(old, keys) || old.schema !== 'flowdeck.autonomy-controller-manifest/v1' || old.version !== 1 || !digest.test(old.policyDigest) || !digest.test(old.ownerScopeDigest) || !digest.test(old.followerConfigDigest) || !exact(old.startClaim,['workflowId','runId','inputDigest']) || !digest.test(old.startClaim.inputDigest) || old.startClaim.workflowId !== old.workflowId || old.startClaim.runId !== old.runId || !Number.isSafeInteger(old.retryCount) || old.retryCount < 0) throw Error('unsupported controller manifest; explicit migration required');
  const businessResult = old.terminalResult ? { ...old.terminalResult } : null;
  const state: ControllerPhase = old.state === 'completed' || businessResult?.status === 'completed' ? 'business_completed' : old.state === 'cancelled' || businessResult?.status === 'cancelled' ? 'cancelled' : old.state === 'blocked' || businessResult?.status === 'blocked' ? 'business_blocked' : old.state === 'stopping' ? 'shutdown_uncertain' : old.state;
  const m: ControllerManifestV2 = { schema:'flowdeck.autonomy-controller-manifest/v2', version:2, campaignId:old.campaignId, policyDigest:old.policyDigest, workflowId:old.workflowId, runId:old.runId, ownerScopeDigest:old.ownerScopeDigest, startClaim:old.startClaim, followerConfigDigest:old.followerConfigDigest, state, worker:old.worker, follower:old.follower, deadlineAt:old.deadlineAt, stopGraceMs:old.stopGraceMs, checkpointedEventIds:old.lastEventId ? [old.lastEventId] : [], retryCount:old.retryCount, businessResult, closeoutReceipt:null, failureReason:null, updatedAt:old.updatedAt };
  strictManifest(m); return m;
}

export function createAutonomyController(path: string, effects: ControllerEffects, ownerRoot = join(homedir(),'Library','Application Support','Flowdeck','autonomy-v1','owners')) {
  const file = resolve(path), lock = file + '.lock';
  const now = () => effects.now?.() ?? Date.now();
  // Every external closeout/status call is bounded; the timeout is not proof
  // that a remote effect stopped. The durable phase stays uncertain on expiry.
  async function deadlineCall<T>(call:()=>Promise<T>,label:string,deadline:number):Promise<T> {
    if(now()>=deadline)throw Error(label+'_deadline_exceeded');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {return await Promise.race([
      Promise.resolve().then(call),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label+'_deadline_exceeded')),Math.max(1,deadline-now()));})
    ]);} finally {if(timer)clearTimeout(timer);}
  }
  async function persist(m: ControllerManifestV2) { strictManifest(m); const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2); const f = await open(tmp,'wx',0o600); try { await f.writeFile(json(m)+'\n'); await f.sync(); } finally { await f.close(); } await rename(tmp,file); const d = await open(dirname(file),'r'); try { await d.sync(); } finally { await d.close(); } }
  async function read() { const raw = JSON.parse(await readFile(file,'utf8')); if (raw?.schema === 'flowdeck.autonomy-controller-manifest/v1') { const m = migrateV1(raw); await persist(m); return m; } strictManifest(raw); return raw; }
  async function acquire(path: string) {
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    for (let attempt=0; attempt<2; attempt++) {
      try { const l=await open(path,'wx',0o600); await l.writeFile(String(process.pid)); await l.sync(); return l; }
      catch(e:any) {
        if(e?.code!=='EEXIST') throw e;
        const pid=Number(await readFile(path,'utf8').catch(()=>''));
        if(!Number.isSafeInteger(pid)||pid<1) throw Error('controller lock is unreadable; audited recovery required');
        try { process.kill(pid,0); throw Error('controller already owned by a live process'); }
        catch(check:any) { if(check?.code!=='ESRCH') throw check?.code==='EPERM'?Error('controller lock owner is inaccessible; audited recovery required'):check; }
        // Reclaim only the exact dead-owner lock observed above. The durable
        // owner .claim is a separate file and is never removed here.
        const stale=path+'.stale-'+pid+'-'+process.pid+'-'+Math.random().toString(16).slice(2);
        try {
          const before=await lstat(path);
          const current=await readFile(path,'utf8');
          if(current!==String(pid)) continue;
          await rename(path,stale);
          const movedStat=await lstat(stale);
          const moved=await readFile(stale,'utf8');
          if(moved===String(pid)&&movedStat.dev===before.dev&&movedStat.ino===before.ino) await rm(stale,{force:true});
          else { try { await rename(stale,path); } catch(restore:any) { if(restore?.code!=='EEXIST'&&restore?.code!=='ENOENT') throw restore; } }
        } catch(move:any) { if(move?.code!=='ENOENT') throw move; }
      }
    }
    throw Error('controller lock unavailable after stale-process recovery');
  }
  async function locked<T>(fn: () => Promise<T>, scopeDigest: string): Promise<T> {
    await mkdir(dirname(file),{recursive:true,mode:0o700}); await mkdir(resolve(ownerRoot),{recursive:true,mode:0o700}); const l = await acquire(lock); const ownerLockPath = join(resolve(ownerRoot),scopeDigest+'.lock'); let owner: any;
    try { owner = await acquire(ownerLockPath); return await fn(); }
    finally { if (owner) { await owner.close(); await rm(ownerLockPath,{force:true}); const od=await open(resolve(ownerRoot),'r'); try { await od.sync(); } finally { await od.close(); } } await l.close(); await rm(lock,{force:true}); const d=await open(dirname(file),'r'); try { await d.sync(); } finally { await d.close(); } }
  }
  async function execute(c: ControllerConfigV1) {
    validate(c); const scopeDigest = hash(c.ownerScope), policyDigest = autonomyPolicyDigest(c.policy);
    return locked(async () => {
      const followerConfigDigest = hash(c.follower), inputDigest = hash({workflowId:c.workflowId,policyDigest}); let m: ControllerManifestV2;
      try { m = await read(); if (m.campaignId !== c.policy.campaignId || m.policyDigest !== policyDigest || m.workflowId !== c.workflowId || (c.runId !== null && m.runId !== c.runId) || m.ownerScopeDigest !== scopeDigest || m.followerConfigDigest !== followerConfigDigest || m.startClaim.inputDigest !== inputDigest) throw Error('durable authority changed: fail closed'); }
      catch (e: any) { if (e?.code !== 'ENOENT') throw e; m = {schema:'flowdeck.autonomy-controller-manifest/v2',version:2,campaignId:c.policy.campaignId,policyDigest,workflowId:c.workflowId,runId:c.runId,ownerScopeDigest:scopeDigest,startClaim:{workflowId:c.workflowId,runId:c.runId,inputDigest},followerConfigDigest,state:'prepared',worker:'not_started',follower:'not_started',deadlineAt:c.deadlineAt,stopGraceMs:c.stopGraceMs,checkpointedEventIds:[],retryCount:0,businessResult:null,closeoutReceipt:null,failureReason:null,updatedAt:new Date(now()).toISOString()}; await persist(m); }
      const ownerClaimPath = join(resolve(ownerRoot),scopeDigest+'.claim');
      const claimRecord = {schema:'flowdeck.autonomy-owner-claim/v1',controllerPath:file,workflowId:m.workflowId,runId:m.runId,policyDigest:m.policyDigest,ownerScopeDigest:m.ownerScopeDigest};
      try { const f=await open(ownerClaimPath,'wx',0o600); try { await f.writeFile(json(claimRecord)+'\n'); await f.sync(); } finally { await f.close(); } const d=await open(resolve(ownerRoot),'r'); try { await d.sync(); } finally { await d.close(); } }
      catch(e:any) { if(e?.code!=='EEXIST') throw e; const held=JSON.parse(await readFile(ownerClaimPath,'utf8')); if(!exact(held,['schema','controllerPath','workflowId','runId','policyDigest','ownerScopeDigest'])||held.schema!=='flowdeck.autonomy-owner-claim/v1'||held.controllerPath!==file||held.workflowId!==m.workflowId||held.policyDigest!==m.policyDigest||held.ownerScopeDigest!==m.ownerScopeDigest||(held.runId!==null&&m.runId!==null&&held.runId!==m.runId)) throw Error('owner claim exists for another or uncertain execution; audited recovery required'); if(held.runId===null&&m.runId!==null) { const f=await open(ownerClaimPath,'r+'); try { await f.truncate(0); await f.writeFile(json({...claimRecord,runId:m.runId})+'\n'); await f.sync(); } finally { await f.close(); } } }
      const updateOwnerClaim = async () => { const f=await open(ownerClaimPath,'r+'); try { const held=JSON.parse(await readFile(ownerClaimPath,'utf8')); if(held.controllerPath!==file||held.workflowId!==m.workflowId||held.policyDigest!==m.policyDigest||held.ownerScopeDigest!==m.ownerScopeDigest||(held.runId!==null&&held.runId!==m.runId)) throw Error('owner claim identity changed'); await f.truncate(0); await f.writeFile(json({...claimRecord,runId:m.runId})+'\n'); await f.sync(); } finally { await f.close(); } };
      const update = async () => { m.updatedAt = new Date(now()).toISOString(); await persist(m); };
      const view = async () => ({manifest:m,status:await deadlineCall(()=>effects.status(),'controller_status',now()+Math.min(1000,m.stopGraceMs))
        .catch(()=>({unavailable:true,reason:'controller_status_unavailable'}))});
      const fail = async (state: 'shutdown_uncertain'|'closeout_blocked', reason: string) => { m.state=state; m.failureReason=reason; m.retryCount++; await update(); return view(); };
      const target = () => { if (!m.runId) throw Error('actual Temporal run ID is not bound'); return {workflowId:m.workflowId,runId:m.runId}; };
      const closeout = async () => {
        if (!m.businessResult || m.businessResult.status !== 'completed' || !m.runId) return fail('closeout_blocked','business_success_or_run_identity_missing');
        // Sender drain uses one shared stop-grace deadline. Evidence and
        // finalization get a separate finite cleanup deadline; neither timeout
        // can certify a stopped worker or release the durable browser claim.
        const finalDeadline=now()+Math.max(2_000,m.stopGraceMs);
        try {
          if (m.state === 'retired') {
            if (!m.closeoutReceipt) throw Error('retired receipt missing');
            await deadlineCall(()=>effects.verifyCloseoutReceipt(m.closeoutReceipt!,{...target(),policyDigest}),'receipt_verify',finalDeadline);
            await rm(ownerClaimPath,{force:true}); return view();
          }
          if (m.state === 'business_completed') { m.state='stopping_senders'; m.failureReason=null; await update(); }
          if (m.state === 'stopping_senders' || m.state === 'shutdown_uncertain') {
            const drainDeadline=now()+m.stopGraceMs;
            m.worker='stopping'; m.follower='stopping'; await update();
            // Start both drains even if one fails. A timeout leaves the active
            // operation uncertain and releases ONLY the controller process lock.
            await deadlineCall(async()=>{
              const results=await Promise.allSettled([
                Promise.resolve().then(()=>effects.stopWorker()),
                Promise.resolve().then(()=>effects.stopFollower())
              ]);
              const failed=results.find(result=>result.status==='rejected');
              if(failed?.status==='rejected')throw failed.reason;
            },'sender_drain',drainDeadline);
            const [ws,fs] = await deadlineCall(
              ()=>Promise.all([effects.workerStatus(),effects.followerStatus()]),
              'sender_status',drainDeadline);
            if (ws !== 'stopped' || fs !== 'stopped') throw Error('sender_or_follower_not_stopped');
            // Do not persist a certified sender stop until its independent
            // outstanding activities, CDP calls and dispatches are checked.
            await deadlineCall(()=>effects.assertNoOutstandingEffects(target()),'sender_effects',drainDeadline);
            m.worker='stopped'; m.follower='stopped'; m.state='closeout_pending'; m.failureReason=null; await update();
          }
          if (m.state === 'closeout_pending' || m.state === 'closeout_blocked') {
            const [ws,fs]=await deadlineCall(
              ()=>Promise.all([effects.workerStatus(),effects.followerStatus()]),
              'closeout_sender_status',finalDeadline);
            if(ws!=='stopped'||fs!=='stopped')throw Error('sender_drain_unproven');
            await deadlineCall(()=>effects.assertNoOutstandingEffects(target()),'closeout_sender_effects',finalDeadline);
            const receipt = await deadlineCall(
              ()=>effects.finalizeOrResumeCloseout({...target(),policyDigest}),'closeout_finalize',finalDeadline);
            if (!exact(receipt,['receiptPath','receiptSha256']) || typeof receipt.receiptPath !== 'string' || !receipt.receiptPath || !digest.test(receipt.receiptSha256)) throw Error('invalid_closeout_receipt');
            await deadlineCall(()=>effects.verifyCloseoutReceipt(receipt,{...target(),policyDigest}),'receipt_verify',finalDeadline);
            m.closeoutReceipt=receipt; m.state='retired'; m.failureReason=null; await update(); await rm(ownerClaimPath,{force:true}); return view();
          }
          throw Error('unexpected_closeout_phase:'+m.state);
        } catch (e) { return fail(m.state === 'stopping_senders' || m.state === 'shutdown_uncertain' ? 'shutdown_uncertain' : 'closeout_blocked', e instanceof Error ? e.message : 'closeout_failed'); }
      };
      if (m.state === 'retired') return closeout();
      if (m.state === 'business_completed' || m.state === 'stopping_senders' || m.state === 'shutdown_uncertain' || m.state === 'closeout_pending' || m.state === 'closeout_blocked') return closeout();
      if (m.state === 'business_blocked' || m.state === 'cancelled') return view();
      try {
        if (m.retryCount >= 3) { m.state='business_blocked'; m.businessResult={status:'blocked',reason:'lifecycle_retry_budget_exhausted',workflowId:m.workflowId,runId:m.runId,finishedAt:new Date(now()).toISOString()}; await update(); return view(); }
        const gate=await effects.authorize(c); if (!gate.allowed || gate.policyDigest !== policyDigest) { m.state='business_blocked'; m.businessResult={status:'blocked',reason:gate.reason??'standing_policy_or_safety_gate_failed',workflowId:m.workflowId,runId:m.runId,finishedAt:new Date(now()).toISOString()}; await update(); return view(); }
        if(now()>=Date.parse(m.deadlineAt)){m.state='business_blocked';m.businessResult={status:'blocked',reason:'deadline_exceeded',workflowId:m.workflowId,runId:m.runId,finishedAt:new Date(now()).toISOString()};await update();return view();}
        const existing=await effects.checkExisting({workflowId:m.workflowId,runId:m.runId});
        if(existing.status==='unknown') throw Error('workflow_identity_ambiguous');
        if(existing.status!=='missing'&&(existing.policyDigest!==policyDigest||!existing.runId||(m.runId!==null&&existing.runId!==m.runId))) throw Error('workflow_identity_mismatch');
        if(existing.status==='missing'&&m.runId!==null) throw Error('bound_workflow_missing');
        if(existing.status==='missing'){if(m.state!=='prepared')throw Error('unresolved_temporal_start_no_retry');m.state='starting';await update();const started=await effects.startExistingIdentity({workflowId:m.workflowId,policyDigest});if(!started||!ident.test(started.runId)||started.policyDigest!==policyDigest)throw Error('started_workflow_identity_mismatch');m.runId=started.runId;m.startClaim.runId=started.runId;await update();await updateOwnerClaim();}
        else if(m.runId===null){m.runId=existing.runId;m.startClaim.runId=existing.runId;await update();await updateOwnerClaim();}
        if(existing.status==='cancelled'){m.state='business_blocked';m.businessResult={status:'cancelled',reason:'historical_workflow_cancelled',workflowId:m.workflowId,runId:m.runId,finishedAt:new Date(now()).toISOString()};await update();return view();}
        // A terminal server execution is still a business result, not retirement.
        if(existing.status==='completed') { const result=await effects.verify(); if(!result.terminal)throw Error('completed_workflow_result_unavailable'); return finishBusiness(result); }
        m.state='active';await update();
        // The inbox follower is ready before the worker can poll and trigger a send.
        const currentFollower=await effects.followerStatus();
        if(m.follower==='not_started'||m.follower==='starting'||m.follower==='missing'||currentFollower!=='running'){
          m.follower='starting';await update();
          await effects.ensureFollower(c.follower,async id=>{if(!id||m.checkpointedEventIds.includes(id))return;await effects.deliverEvent(id,target());m.checkpointedEventIds.push(id);await update();});
          if(await effects.followerStatus()!=='running')throw Error('follower_readiness_not_proven');m.follower='running';await update();
        }
        const currentWorker=await effects.workerStatus();
        if(m.worker==='not_started'||m.worker==='starting'||currentWorker!=='running'){
          if(await effects.followerStatus()!=='running')throw Error('follower_not_ready_before_worker');
          m.worker='starting';await update();await effects.ensureWorker();if(await effects.workerStatus()!=='running')throw Error('worker_readiness_not_proven');m.worker='running';await update();
        }
        if(await effects.workerStatus()!=='running'||await effects.followerStatus()!=='running')throw Error('required_lifecycle_component_missing_or_unresponsive');
        const result=await effects.verify();if(!result.terminal)return view();return finishBusiness(result);
      } catch(e) { m.retryCount++; m.failureReason=e instanceof Error?e.message:'lifecycle_failed'; await update(); return view(); }
      async function finishBusiness(result: {status:'completed'|'blocked'|'cancelled';reason:string}) {
        m.businessResult={status:result.status,reason:result.reason,workflowId:m.workflowId,runId:m.runId,finishedAt:new Date(now()).toISOString()};
        if(result.status==='completed'){m.state='business_completed';await update();return closeout();}
        m.state=result.status==='cancelled'?'cancelled':'business_blocked';await update();return view();
      }
    },scopeDigest);
  }
  async function stop() {
    const m=await read(); return locked(async()=>{
      const current=await read(); if(current.state==='retired')return current;
      current.state='stopping_senders'; await persist(current);
      const uncertain=(reason:string)=>{current.state='shutdown_uncertain';current.failureReason=reason;return persist(current).then(()=>current);};
      if(!current.runId)return uncertain('cannot_cancel_unbound_workflow');
      const deadline=now()+current.stopGraceMs;
      const bounded=async<T>(operation:Promise<T>,label:string):Promise<T>=>{
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label+'_deadline_exceeded')),Math.max(1,deadline-now()));})]);}
        finally{if(timer)clearTimeout(timer);}
      };
      try {
        await bounded(effects.cancelWorkflow({workflowId:current.workflowId,runId:current.runId}),'workflow_cancel');
        const drains=Promise.allSettled([Promise.resolve().then(()=>effects.stopFollower()),Promise.resolve().then(()=>effects.stopWorker())]).then(results=>{const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;});
        await bounded(drains,'sender_drain');
        const [worker,follower]=await bounded(Promise.all([effects.workerStatus(),effects.followerStatus()]),'sender_status');
        if(worker!=='stopped'||follower!=='stopped')throw Error('sender_or_follower_not_stopped');
      } catch(error) { return uncertain(error instanceof Error?error.message:'shutdown_failed'); }
      current.worker='stopped';current.follower='stopped';current.state='cancelled';current.failureReason=null;
      current.businessResult={status:'cancelled',reason:'bounded_stop_completed',workflowId:current.workflowId,runId:current.runId,finishedAt:new Date(now()).toISOString()};
      await persist(current); return current;
    },m.ownerScopeDigest);
  }
  return {execute,stop,read,status:()=>effects.status()};
}
export async function readAutonomyControllerManifest(path:string):Promise<ControllerManifestV1>{const raw=JSON.parse(await readFile(resolve(path),'utf8'));if(raw?.schema==='flowdeck.autonomy-controller-manifest/v1')return migrateV1(raw);strictManifest(raw);return raw;}
