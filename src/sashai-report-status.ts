import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';

const base=resolve(process.cwd());
const state=join(base,'.state','report-review-dispatch');
export const browserReportPath=join(base,'docs','SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md');
const expectedTask='sashai-architecture-report-2026-10-15';
const expectedChatPrefix='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d';

async function readJson(file: string): Promise<Record<string, unknown> | null> {
 try {const body=await readFile(file,'utf8');return JSON.parse(body) as Record<string,unknown>;}
 catch{return null;}
}
export async function readReportReviewStatus(){
 const [attempt,acceptance]=await Promise.all([
  readJson(join(state,'attempt.json')),
  readJson(join(state,'acceptance.json')),
 ]);
 if(!attempt||attempt.taskId!==expectedTask||attempt.approval!=='report-only')return null;
 const url=typeof attempt.conversationUrl==='string'&&
   attempt.conversationUrl.startsWith(expectedChatPrefix)?attempt.conversationUrl:null;
 let verified=false;
 let size=0;
 if(acceptance?.completed===true&&acceptance?.taskId===expectedTask&&
    acceptance?.chatUrl===url&&acceptance?.reportPath===browserReportPath&&
    acceptance?.connectorEvidenceValid===true&&acceptance?.sourceFilesVerified===true&&
    typeof acceptance.reportSha256==='string'){
  const info=await stat(browserReportPath).catch(()=>null);
  if(info?.isFile()&&info.size<524288){
   const file=await readFile(browserReportPath);
   size=file.length;
   verified=createHash('sha256').update(file).digest('hex')===acceptance.reportSha256;
  }
 }
 return {taskId:expectedTask,approval:'report-only',status:verified?'verified_report':
   acceptance?'verification_stale_or_incomplete':'submitted_unverified',
   conversationUrl:url,reportReady:verified,reportUrl:verified?'/api/sashai/report':null,
   reportBytes:size,verifiedAt:verified?acceptance?.verifiedAt??null:null,
   separateFromProductTask:true};
}
