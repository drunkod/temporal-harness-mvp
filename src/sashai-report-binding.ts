import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
export interface ReportBinding {
 taskId:string;attemptId:string;chat:string;contractSha256:string;
 artifactPath:string;artifactSha256:string;sendClaimSha256:string;
 approval:'report-only';
}
export interface BindingComparison {matches:boolean;differences:string[]}
export function compareReportBindings(expected:ReportBinding,actual:ReportBinding):BindingComparison {
 const keys:(keyof ReportBinding)[]=['taskId','attemptId','chat','contractSha256',
  'artifactPath','artifactSha256','sendClaimSha256','approval'];
 const differences=keys.filter(k=>expected[k]!==actual[k]);
 return {matches:differences.length===0,differences};
}
export interface VerifierReceiptIdentity {
 taskId:string;attemptId:string;chatUrl:string|null;taskContractSha256:string;
 reportPath:string;reportSha256:string|null;
}
export function receiptMatchesBinding(binding:ReportBinding,receipt:VerifierReceiptIdentity):BindingComparison {
 const differences:string[]=[];
 if(binding.taskId!==receipt.taskId)differences.push('taskId');
 if(binding.attemptId!==receipt.attemptId)differences.push('attemptId');
 if(binding.chat!==receipt.chatUrl)differences.push('chat');
 if(binding.contractSha256!==receipt.taskContractSha256)differences.push('contractSha256');
 if(binding.artifactPath!==receipt.reportPath)differences.push('artifactPath');
 if(binding.artifactSha256!==receipt.reportSha256)differences.push('artifactSha256');
 return {matches:!differences.length,differences};
}
/** Read-only, fail-closed snapshot. Capture again after any Temporal wait and
 *  at acceptance; immutable attempt nonce and write-ahead send guard must match.
 */
export async function captureReportBinding(base:string):Promise<ReportBinding> {
 const root=resolve(base),folder=join(root,'.state','report-review-dispatch');
 const [attemptBytes,claimBytes,contractBytes]=await Promise.all([
  readFile(join(folder,'attempt.json')),
  readFile(join(folder,'SEND_ATTEMPTED')),
  readFile(join(root,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md')),
 ]);
 const attempt=JSON.parse(attemptBytes.toString('utf8')) as Record<string,unknown>;
 const claim=JSON.parse(claimBytes.toString('utf8')) as Record<string,unknown>;
 const taskId='sashai-architecture-report-2026-10-15';
 const expectedPath=join(root,'docs','SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md');
 const expectedPrefix='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/';
 if(attempt.taskId!==taskId||attempt.approval!=='report-only'||
  typeof attempt.nonce!=='string'||!/^[-0-9a-f]{36}$/.test(attempt.nonce)||
  typeof attempt.conversationUrl!=='string'||!attempt.conversationUrl.startsWith(expectedPrefix)||
  attempt.destination!==expectedPath||
  claim.marker!==attempt.marker||claim.tabId!==attempt.tabId||
  claim.promptSha256!==attempt.promptSha256||
  attempt.taskContractSha256!==sha(contractBytes))
  throw Error('Original report approval, attempt, chat, or send claim binding changed');
 const content=await readFile(expectedPath);
 return {taskId,attemptId:attempt.nonce,chat:attempt.conversationUrl,
  contractSha256:sha(contractBytes),artifactPath:expectedPath,
  artifactSha256:sha(content),sendClaimSha256:sha(claimBytes),approval:'report-only'};
}
