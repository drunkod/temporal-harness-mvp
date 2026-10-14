import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readReportReviewStatus} from './sashai-report-status.js';
import {captureReportBinding,compareReportBindings,receiptMatchesBinding} from './sashai-report-binding.js';
import type {ReportBinding,VerifierReceiptIdentity} from './sashai-report-binding.js';

const root=resolve(process.cwd());
const state=join(root,'.state','report-review-dispatch');
const taskId='sashai-architecture-report-2026-10-15';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export interface ReviewEvidence {
 ready:boolean;status:string;taskId:string;chat:string|null;contractSha256:string|null;
 sendClaim:boolean;correctionClaim:boolean;reportStatus:string|null;blockers:string[];
 binding:ReportBinding|null;
}
export async function inspectReportEvidence(expectedContractSha256:string):Promise<ReviewEvidence>{
 const problems:string[]=[];
 const attempt=JSON.parse(await readFile(join(state,'attempt.json'),'utf8')) as Record<string,unknown>;
 const contract=await readFile(join(root,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md'),'utf8');
 if(attempt.taskId!==taskId||attempt.approval!=='report-only')problems.push('unapproved_task');
 if(attempt.taskContractSha256!==expectedContractSha256||hash(contract)!==expectedContractSha256)
   problems.push('contract_or_attempt_changed');
 if(!existsSync(join(state,'SEND_ATTEMPTED')))problems.push('missing_persisted_send_claim');
 const review=await readReportReviewStatus();
 if(!review?.conversationUrl||review.taskId!==taskId)problems.push('unbound_conversation');
 let binding:ReportBinding|null=null;
 try {binding=await captureReportBinding(root);}catch{problems.push('immutable_attempt_binding_invalid');}
 if(binding?.contractSha256!==expectedContractSha256)problems.push('immutable_contract_identity_mismatch');
 return {ready:problems.length===0,status:problems.length?'blocked':'observed_existing_submission',
  taskId,chat:review?.conversationUrl??null,contractSha256:expectedContractSha256,
  sendClaim:existsSync(join(state,'SEND_ATTEMPTED')),
  correctionClaim:existsSync(join(state,'FIX_SEND_ATTEMPTED')),
  reportStatus:review?.status??null,blockers:problems,binding};
}
export interface ReviewAcceptance {
 verified:boolean;reportStatus:string;unmet:string[];evidenceScope:string;
 identity:VerifierReceiptIdentity|null;binding:ReportBinding|null;identityMatched:boolean;
}
export async function reverifyReportEvidence(expectedBinding:ReportBinding):Promise<ReviewAcceptance>{
 // Re-read all persisted identities AFTER the wait, before trusting any verifier.
 let current:ReportBinding|null=null;
 const mismatches:string[]=[];
 try{
  current=await captureReportBinding(root);
  mismatches.push(...compareReportBindings(expectedBinding,current).differences.map(x=>'binding_changed_'+x));
 }catch{mismatches.push('persisted_binding_invalid');}
 // Preview is read-only and never rewrites the historical acceptance record.
 const run=spawnSync(process.execPath,[join(root,'scripts','verify-sashai-browser-report.mjs'),'--preview'],
  {cwd:root,encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
 if(run.error)throw run.error;
 let parsed:{
  acceptanceStatus?:string;unmet?:string[];baselineEvidenceScope?:string;
  taskId?:string;attemptId?:string;chatUrl?:string|null;taskContractSha256?:string;
  reportPath?:string;reportSha256?:string|null;
 }={};
 try{parsed=JSON.parse(run.stdout||'{}');}catch{throw Error('Verifier returned non-JSON output');}
 if(!Array.isArray(parsed.unmet))throw Error('Verifier emitted incomplete receipt');
 let identity:VerifierReceiptIdentity|null=null;
 if(typeof parsed.taskId==='string'&&typeof parsed.attemptId==='string'&&
    typeof parsed.taskContractSha256==='string'&&
    typeof parsed.reportPath==='string'&&typeof parsed.reportSha256==='string'&&
    typeof parsed.chatUrl==='string') {
   identity={taskId:parsed.taskId,attemptId:parsed.attemptId,chatUrl:parsed.chatUrl,
    taskContractSha256:parsed.taskContractSha256,reportPath:parsed.reportPath,
    reportSha256:parsed.reportSha256};
   mismatches.push(...receiptMatchesBinding(expectedBinding,identity).differences.map(x=>'receipt_changed_'+x));
 }else mismatches.push('verifier_receipt_missing_identity');
 // Re-read even after the verifier exits: do not accept a concurrent replacement.
 try {
  const after=await captureReportBinding(root);
  mismatches.push(...compareReportBindings(expectedBinding,after).differences.map(x=>'post_verification_changed_'+x));
 }catch{mismatches.push('post_verification_binding_invalid');}
 const unique=[...new Set([...parsed.unmet,...mismatches])];
 const verified=run.status===0&&parsed.acceptanceStatus==='verified_report'&&unique.length===0;
 return {verified,reportStatus:parsed.acceptanceStatus||'unknown',unmet:unique,
  evidenceScope:parsed.baselineEvidenceScope||'unknown',identity,
  binding:current,identityMatched:!mismatches.length};
}
