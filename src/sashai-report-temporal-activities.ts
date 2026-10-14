import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readReportReviewStatus} from './sashai-report-status.js';

const root=resolve(process.cwd());
const state=join(root,'.state','report-review-dispatch');
const taskId='sashai-architecture-report-2026-10-15';
const h=(s:string)=>createHash('sha256').update(s).digest('hex');
export interface ReviewEvidence {
  ready:boolean;status:string;taskId:string;chat:string|null;contractSha256:string|null;
  sendClaim:boolean;correctionClaim:boolean;reportStatus:string|null;blockers:string[];
}
export async function inspectReportEvidence(expectedContractSha256:string):Promise<ReviewEvidence>{
 const problems:string[]=[];
 const attempt=JSON.parse(await readFile(join(state,'attempt.json'),'utf8')) as Record<string,unknown>;
 const contract=await readFile(join(root,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md'),'utf8');
 if(attempt.taskId!==taskId||attempt.approval!=='report-only')problems.push('unapproved_task');
 if(attempt.taskContractSha256!==expectedContractSha256||h(contract)!==expectedContractSha256)
   problems.push('contract_or_attempt_changed');
 if(!existsSync(join(state,'SEND_ATTEMPTED')))problems.push('missing_persisted_send_claim');
 const review=await readReportReviewStatus();
 if(!review?.conversationUrl||review.taskId!==taskId)problems.push('unbound_conversation');
 return {ready:problems.length===0,status:problems.length?'blocked':'observed_existing_submission',
   taskId,chat:review?.conversationUrl??null,contractSha256:expectedContractSha256,
   sendClaim:existsSync(join(state,'SEND_ATTEMPTED')),
   correctionClaim:existsSync(join(state,'FIX_SEND_ATTEMPTED')),
   reportStatus:review?.status??null,blockers:problems};
}
export interface ReviewAcceptance {
 verified:boolean; reportStatus:string; unmet:string[]; evidenceScope:string;
}
export async function reverifyReportEvidence():Promise<ReviewAcceptance>{
 // Preview is read-only; does not overwrite the previous acceptance record.
 const run=spawnSync(process.execPath,[join(root,'scripts','verify-sashai-browser-report.mjs'),'--preview'],
  {cwd:root,encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
 if(run.error)throw run.error;
 let parsed:{acceptanceStatus?:string;unmet?:string[];baselineEvidenceScope?:string}={};
 try{parsed=JSON.parse(run.stdout||'{}')}catch{throw Error('Verifier returned non-JSON output');}
 if(!Array.isArray(parsed.unmet))throw Error('Verifier emitted incomplete receipt');
 return {verified:run.status===0&&parsed.acceptanceStatus==='verified_report'&&parsed.unmet.length===0,
  reportStatus:parsed.acceptanceStatus||'unknown',unmet:parsed.unmet,
  evidenceScope:parsed.baselineEvidenceScope||'unknown'};
}
