#!/usr/bin/env node
/**
 * Independent read-only verifier of the single approved Sashai report task.
 * Does not modify Sashai, inspect ChatGPT conversation content, or dispatch work.
 * Acceptance != a finished ChatGPT turn. Evidence is persisted locally.
 */
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
const repo='/Users/test/Documents/work/sashai';
const state=join(root,'.state','report-review-dispatch');
const attemptFile=join(state,'attempt.json');
const claimFile=join(state,'SEND_ATTEMPTED');
const evidenceFile=join(state,'acceptance.json');
const reportFile=join(root,'docs','SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md');
const contractFile=join(root,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md');
const sha=x=>createHash('sha256').update(x).digest('hex');
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:8000,maxBuffer:5_000_000});

export function assessReport(text,env) {
 const checks={};
 const normalized=text.toLowerCase();
 checks.nontrivial= text.length>=2500;
 checks.revision= text.includes(env.head);
 checks.date= /2026[-/]10[-/]15|October 15,? 2026/.test(text);
 checks.commitTimeline= env.commits.slice(0,8).every(c=>text.includes(c.slice(0,7)));
 const commitsEvidence=(text.match(/\b[0-9a-f]{7,40}\b/g)||[]);
 checks.commitRange= commitsEvidence.length>=10;
 checks.taskAuthority= /AGENTS\.md/.test(text) && /active.plan/i.test(text) && /active.worktree/i.test(text) &&
     /tasks\/current\.md/.test(text) && /tasks\/todos\.md/.test(text);
 checks.separatesResearch= /uncommitted|untracked/i.test(text) && /propos(?:ed|al)|future|not implemented/i.test(text) && /deliver(?:ed|y)|implemented|committed/i.test(text);
 checks.statusInventory= env.modified.every(p=>text.includes(p)) && (/untracked/i.test(text)) ;
 const diagrams=[...text.matchAll(/(?:```|~~~)mermaid\s*\n([\s\S]*?)(?:```|~~~)/g)].map(x=>x[1]);
 checks.diagrams=diagrams.length>=2 && diagrams.filter(x=>/^\s*flowchart\s+(?:TD|LR|TB|RL|BT)/m.test(x)).length>=2;
 checks.plainTextMermaid=diagrams.filter(x=>!/<\/?[a-z][^>]*>/i.test(x)).length>=2;
 checks.noRendererCss=!/<style|<script/i.test(text);
 checks.sourcePaths= [
    'apps/server/src/server.ts',
    'apps/app/src/lib/sashai-shell-routes.ts',
    'apps/app/src/views/SashAiShellView.tsx',
    'packages/host-daemon-contract/src/session.ts'
  ].filter(p=>text.includes(p)).length>=3;
 checks.milestone= /MVP-1/i.test(text) && /MVP-0/i.test(text) &&
    /Community/.test(text) && /Modules/.test(text);
 checks.validationBoundaries= /not run|not executed|not rerun|no build|not independently|not performed|not verified|not reproduced/i.test(text) &&
   /acceptance|limitation|blocker/i.test(text);
 checks.findings= /findings|recommendations|next decisions|priorit/i.test(text);
 checks.security= !/token[=:][A-Za-z0-9]{20,}/i.test(text);
 const failures=Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
 return {passed:failures.length===0,checks,missing:failures};
}
const pending=process.argv.includes('--preview');
await mkdir(state,{recursive:true,mode:0o700});
const attempt=JSON.parse(await readFile(attemptFile,'utf8'));
if(!existsSync(claimFile))throw Error('No dispatch send claim; report cannot be credited to browser task');
if(attempt.approval!=='report-only'||attempt.taskId!=='sashai-architecture-report-2026-10-15')throw Error('Wrong task binding');
const contract=await readFile(contractFile,'utf8');
if(sha(contract)!==attempt.taskContractSha256)throw Error('Task contract changed since dispatch');
const head=git('rev-parse','HEAD').trim();
const statusFingerprint=sha(git('status','--porcelain=v1','-z'));
const diffFingerprint=sha(git('diff','--binary'));
const revisionMatches=head===attempt.head;
const baselineUnchanged=statusFingerprint===attempt.preflightStatusSha256 &&
 diffFingerprint===attempt.preflightDiffSha256;
const info=await stat(reportFile).catch(()=>null);
const report=info&&info.isFile()&&info.size<524288?await readFile(reportFile,'utf8'):null;
const commits=git('log','-12','--format=%H').trim().split('\n');
const modified=git('diff','--name-only').trim().split('\n').filter(Boolean);
const check=report?assessReport(report,{head,commits,modified}):
 {passed:false,checks:{reportExists:false},missing:['reportExists']};
const toolEvidence=JSON.parse(await readFile(join(state,'tool-evidence.json'),'utf8').catch(()=>'null'));
const toolActions=toolEvidence?.toolActions||[];
const connectorEvidenceValid=Boolean(toolEvidence?.verified===true &&
  toolEvidence?.taskId===attempt.taskId && toolEvidence?.conversationUrl===attempt.conversationUrl &&
  toolEvidence?.reportPath===reportFile &&
  ['write_file','edit_block'].every(toolName=>toolActions.some(a=>
    a.toolName===toolName && a.file===reportFile && typeof a.localTime==='string')));
const sourceFilesVerified=[
  'apps/server/src/server.ts','apps/app/src/lib/sashai-shell-routes.ts',
  'apps/app/src/views/SashAiShellView.tsx','packages/host-daemon-contract/src/session.ts'
].every(path=>{try{git('cat-file','-e','HEAD:'+path);return true}catch{return false}});
const acceptance=Boolean(check.passed&&revisionMatches&&baselineUnchanged&&report&&
  connectorEvidenceValid&&sourceFilesVerified&&attempt.conversationUrl);
const result={
 taskId:attempt.taskId,chatUrl:attempt.conversationUrl??null,
 taskContractSha256:attempt.taskContractSha256,submissionAttempted:true,
 sourceHead:head,baselineHead:attempt.head,revisionMatches,baselineUnchanged,
 connectorEvidenceValid,sourceFilesVerified,bindingEvidence:attempt.bindingEvidence??'none',
 reportPath:reportFile,reportBytes:info?.size||0,reportSha256:report?sha(report):null,
 acceptanceStatus:acceptance?'verified_report':'incomplete_or_unverified',
 completed:acceptance,requirements:check.checks,
 unmet:[...check.missing,...(!revisionMatches?['source_revision_changed']:[]),...(!baselineUnchanged?['sashai_worktree_changed']:[]),
  ...(!connectorEvidenceValid?['connector_tool_history_evidence_missing']:[]),
  ...(!sourceFilesVerified?['expected_repository_sources_missing']:[])],
 verifiedAt:new Date().toISOString(),
 limitations:'Report-only verification combines Git and content checks with sanitized Remote Desktop Commander tool history. ChatGPT Work layout may hide original prompt, so same-tab/revision binding is weaker than exact prompt-marker evidence. Does not establish autonomous implementation acceptance.'
};
if(!pending)await writeFile(evidenceFile,JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(result,null,2));
if(!acceptance)process.exitCode=2;
