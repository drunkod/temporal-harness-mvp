#!/usr/bin/env node
import { createSendRecoveryStore, sendEventHash, sendPhaseHash, verifyLegacyStageFailure, LEGACY_STAGE_ORDER_ATTESTATION } from '../dist/flowdeck-send-recovery.js';
import { createSupervisorProjectLoader } from '../dist/flowdeck-projects.js';
import { Connection, Client } from '@temporalio/client';
import { defaultPayloadConverter, fromPayloadsAtIndex } from '@temporalio/common';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {evaluatePredecessorReadiness, readPredecessorRecords, productionPredecessorReaders} from './flowdeck-predecessor-readiness.mjs';

const usage = `Usage: node scripts/flowdeck-reconcile-send.mjs --project ID --task ID --send-event-hash HASH --phase-hash HASH --recorded-attempt-id ID (legacy alias: --failed-attempt-id) --old-dispatch-id ID [--successor-recovery [--apply --approve-successor-recovery]] [--attest-legacy-stage-failure --workflow-id ID --run-id ID --scheduled-event-id N --source-attestation ${LEGACY_STAGE_ORDER_ATTESTATION}] [--apply --approve-pre-send-recovery]`;
const args = process.argv.slice(2);
const get = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help')) { console.log(usage); process.exit(0); }
const projectId = get('--project'), taskId = get('--task'), eventHash = get('--send-event-hash'), phaseHash = get('--phase-hash');
const attemptId = get('--recorded-attempt-id') ?? get('--failed-attempt-id'), oldDispatchId = get('--old-dispatch-id');
if (![projectId, taskId, eventHash, phaseHash, attemptId, oldDispatchId].every(v => typeof v === 'string' && v.length > 0)) throw Error(usage);
const base = resolve(process.cwd()), store = createSendRecoveryStore(base);
const supervisor = join(base, '.state', 'flowdeck-supervisor');
const fileHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const exists = async path => access(path).then(() => true).catch(() => false);
const exactEligibility = async () => {
  const entries = await store.readEntries(oldDispatchId);
  const claimed = entries.find(entry => entry.phase === 'claimed');
  const failed = entries.at(-1)?.phase === 'pre_send_failed';
  if(entries.some(entry=>['click_attempted','submitted','reconciled'].includes(entry.phase)))throw Error('A click boundary exists; pre-send recovery is forbidden');
  if (!claimed || !failed) return { entries, claimed, valid: false, reason: 'No complete durable claimed -> pre_send_failed journal' };
  if (claimed.projectId !== projectId || claimed.taskId !== taskId || claimed.eventHash !== eventHash || claimed.phaseHash !== phaseHash)
    return { entries, claimed, valid: false, reason: 'Journal keys do not match supplied project/task/claim hashes' };
  const receiptKey = [projectId, taskId, claimed.phaseKind, claimed.eventId];
  const receiptPresent = await exists(join(supervisor, `sent-${fileHash(receiptKey)}.json`));
  const taskBindingPresent = await exists(join(supervisor, `task-${fileHash([projectId, taskId])}.json`));
  return { entries, claimed, receiptPresent, taskBindingPresent, valid: !receiptPresent && !taskBindingPresent, reason: receiptPresent ? 'Exact sent receipt exists' : taskBindingPresent ? 'Exact task binding exists' : null };
};
const eligibility = await exactEligibility();
if(args.includes('--successor-recovery')){
 if(args.includes('--apply')&&!args.includes('--approve-successor-recovery'))throw Error('Successor issuance requires separate --approve-successor-recovery');
 if(args.includes('--approve-successor-recovery')&&!args.includes('--apply'))throw Error('Approval flag requires --apply');
 if(!eligibility.valid)throw Error('Successor is not eligible: '+eligibility.reason);
 const claimed=eligibility.claimed;
 const project=await createSupervisorProjectLoader({base})(projectId);
 if(claimed.phaseKind!=='next'||!claimed.previousBinding||!claimed.event||
  !project.tasks.some(task=>task.id===taskId)||!project.tasks.some(task=>task.id===claimed.previousBinding.taskId)||
  claimed.previousBinding.projectId!==projectId||claimed.event.workId!==claimed.previousBinding.workId||
  claimed.event.ownerId!==project.ownerId||claimed.event.deviceId!==project.deviceId||
  eventHash!==fileHash([projectId,taskId,'next',claimed.event.eventId])||phaseHash!==fileHash([projectId,taskId,'next','initial']))throw Error('Successor request is outside the approved B-only scope');
 const prior=await readJson(join(supervisor,`binding-${fileHash([projectId,claimed.previousBinding.workId])}.json`));
 if(JSON.stringify(prior.binding)!==JSON.stringify(claimed.previousBinding)||prior.observation?.decision!=='implementation_done')throw Error('Completed predecessor binding changed');
 let lineageEligible=false,lineageReason=null;
 try {
  const checked=await store.successorPreview({projectId,taskId,eventHash,phaseHash,failedParentDispatchId:oldDispatchId,failedAttemptId:attemptId});
  lineageEligible=checked.eligible===true;
 } catch(error) {
  const message=String(error?.message||'');
  lineageReason=/successor authorization already exists|successor authorization slot already exists|forks this lineage/i.test(message)
   ? 'successor_authorization_already_exists':'successor_lineage_unverified';
 }
 const records=await readPredecessorRecords(base,claimed.previousBinding);
 const predecessor=await evaluatePredecessorReadiness({project,previous:claimed.previousBinding,...records,
  readers:await productionPredecessorReaders()});
 const blockers=[...(lineageReason?[lineageReason]:[]),...predecessor.blockers];
 if(!predecessor.predecessorEvidenceVerified&&!blockers.includes('fresh_predecessor_completion_unverified'))
  blockers.push('fresh_predecessor_completion_unverified');
 const readyForExecution=lineageEligible&&predecessor.readyForPredecessor&&blockers.length===0;
 const preview={command:'flowdeck-reconcile-send',mode:'successor-preview',eligible:lineageEligible,
  lineageEligible,predecessorTabPresent:predecessor.predecessorTabPresent,
  predecessorEvidenceVerified:predecessor.predecessorEvidenceVerified,readyForExecution,blockers,
  recordedAttemptId:attemptId,failedDispatchId:oldDispatchId,projectId,taskId,eventHash,phaseHash,
  receiptPresent:eligibility.receiptPresent,taskBindingPresent:eligibility.taskBindingPresent,writes:false};
 if(!args.includes('--apply')){console.log(JSON.stringify(preview,null,2));process.exit(0);}
 if(!readyForExecution)throw Error('Successor recovery readiness refused: '+blockers.join(','));
 const authorization=await store.authorizeSuccessor({projectId,taskId,eventHash,phaseHash,failedParentDispatchId:oldDispatchId,failedAttemptId:attemptId});
 const requestPath=join(store.root,`resume-${authorization.authorizationId}.json`);
 const request={projectId,taskId,completedTaskId:claimed.previousBinding.taskId,phase:'next',previous:claimed.previousBinding,event:claimed.event,authorization};
 await writeFile(requestPath,JSON.stringify(request,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({...preview,mode:'successor-apply',writes:true,requestPath,authorization},null,2));process.exit(0);
}

let legacyProof, recoveryInput;
if(eligibility.valid){
 const claimed=eligibility.claimed;
 if(claimed.phaseKind!=='next'||!claimed.previousBinding||!claimed.event)throw Error('This recovery command requires a complete next-task dispatch scope');
 recoveryInput={projectId,taskId,completedTaskId:claimed.previousBinding.taskId,phase:'next',previous:claimed.previousBinding,event:claimed.event};
}
if (!eligibility.valid) {
  if (!args.includes('--attest-legacy-stage-failure')) throw Error(`Recovery preview is not eligible: ${eligibility.reason ?? 'legacy claim-only dispatch requires reviewed Temporal proof'}`);
  const workflowId = get('--workflow-id'), runId = get('--run-id'), scheduledEventId = get('--scheduled-event-id'), sourceAttestation = get('--source-attestation');
  if (![workflowId, runId, scheduledEventId, sourceAttestation].every(v => typeof v === 'string' && v.length > 0)) throw Error('Legacy attestation requires --workflow-id --run-id --scheduled-event-id --source-attestation');
  if (sourceAttestation !== LEGACY_STAGE_ORDER_ATTESTATION) throw Error('Source attestation does not match the reviewed stage-before-click implementation');
  const project = await createSupervisorProjectLoader({ base })(projectId);
  const eventClaim = await readJson(join(supervisor, `send-event-${eventHash}.json`));
  const phaseClaim = await readJson(join(supervisor, `send-phase-${phaseHash}.json`));
  const previousBinding = await readJson(join(supervisor, `binding-${fileHash([projectId, eventClaim.workId])}.json`));
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233' });
  try {
    const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' });
    const handle = client.workflow.getHandle(workflowId, runId);
    const described = await handle.describe();
    if (described.runId && described.runId !== runId) throw Error('Temporal describe returned a different run');
    const history = await handle.fetchHistory();
    const scheduled = history.events.find(event => event.activityTaskScheduledEventAttributes && String(event.eventId) === String(scheduledEventId));
    if (!scheduled) throw Error('Scheduled activity event is not present in the exact run history');
    const payloads = scheduled.activityTaskScheduledEventAttributes?.input?.payloads ?? [];
    const decoded = payloads.map((_, index) => fromPayloadsAtIndex(defaultPayloadConverter, index, payloads));
    const expectedInput = [project, project.tasks.find(task => task.id === taskId), previousBinding.binding, decoded[3]];
    if (!expectedInput[1] || decoded[3]?.eventId !== phaseClaim.eventId || decoded[3]?.workId !== eventClaim.workId)
      throw Error('Legacy scheduled input does not match exact task/event claim scope');
    const exactEventHash=fileHash([projectId,taskId,'next',decoded[3].eventId]);
    const exactPhaseHash=fileHash([projectId,taskId,'next','initial']);
    if(eventHash!==exactEventHash||phaseHash!==exactPhaseHash)throw Error('Legacy claim hashes do not match scheduled input');
    if(await exists(join(supervisor,`sent-${exactEventHash}.json`))||await exists(join(supervisor,`task-${fileHash([projectId,taskId])}.json`)))
      throw Error('Legacy recovery blocked by an existing receipt or task binding');
    scheduled.activityTaskScheduledEventAttributes.input.decoded = decoded;
    legacyProof = verifyLegacyStageFailure(history, expectedInput, scheduledEventId, sourceAttestation, { runId, workflowId });
    legacyProof = { ...legacyProof, workflowId, runId };
    recoveryInput={projectId,taskId,completedTaskId:previousBinding.binding.taskId,phase:'next',previous:previousBinding.binding,event:decoded[3]};
  } finally { await connection.close(); }
  eligibility.receiptPresent = false; eligibility.taskBindingPresent = false; eligibility.valid = true;
}
const preview = { command: 'flowdeck-reconcile-send', mode: args.includes('--apply') && args.includes('--approve-pre-send-recovery') ? 'apply' : 'preview', eligible: eligibility.valid, exact: { projectId, taskId, sendEventHash: eventHash, phaseHash, failedAttemptId: attemptId, oldDispatchId }, receiptPresent: eligibility.receiptPresent ?? false, taskBindingPresent: eligibility.taskBindingPresent ?? false, legacyProof: legacyProof ? { runId: legacyProof.runId, workflowId: legacyProof.workflowId, scheduledEventId: legacyProof.scheduledEventId, historySha256: legacyProof.historySha256 } : null };
if (!args.includes('--apply') || !args.includes('--approve-pre-send-recovery')) { console.log(JSON.stringify(preview, null, 2)); process.exit(0); }
const authorization = await store.authorize({ projectId, taskId, eventHash, phaseHash, oldDispatchId, attemptId, receiptPresent: eligibility.receiptPresent, taskBindingPresent: eligibility.taskBindingPresent, legacyProof });
let requestPath;
if(recoveryInput){
 requestPath=join(store.root,`resume-${authorization.authorizationId}.json`);
 await writeFile(requestPath,JSON.stringify({...recoveryInput,authorization},null,2)+'\n',{flag:'wx',mode:0o600});
}
console.log(JSON.stringify({ ...preview, requestPath, authorization: { authorizationId: authorization.authorizationId, newDispatchId: authorization.newDispatchId, oldDispatchId: authorization.oldDispatchId } }, null, 2));
