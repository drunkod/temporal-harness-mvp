import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {snapshotSashaiTree} from './sashai-dispatch-evidence.js';
import type {TreeEvidence} from './sashai-dispatch-evidence.js';
import {PROJECT,liveBrowser} from './sashai-live-browser.js';
import type {LiveBrowser,ToolCallEvidence} from './sashai-live-browser.js';
import {parseSashaiChatUrl} from './sashai-observer.js';
import {Context} from '@temporalio/activity';

export const LIVE_TASK_ID='sashai-task-routing-report-live-v1';
const HEAD='7d2cc6818afe837119e0c171928506b1c4967269';
const hash=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
const uuid=(s:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const sources=['AGENTS.md','.ai/harness/policy.json','.ai/harness/active-plan',
 '.ai/harness/active-worktree','tasks/current.md','tasks/todos.md'];
export interface LiveAttempt {
 taskId:string;attemptId:string;project:string;tabId:string;chatUrl:null;
 approval:'report-only';contractSha256:string;source:TreeEvidence;sourceFactsSha256:string;
 output:string;marker:string;prompt:string;promptSha256:string;preparedAt:string;
}
export interface LiveClaims {initial:string;correction?:string}
export interface LiveSendReceipt {state:'clicked';claimSha256:string}
export interface LiveReceipt {
 taskId:string;attemptId:string;chat:string;contractSha256:string;artifactPath:string;
 artifactSha256:string;sourceFingerprint:string;accepted:boolean;missing:string[];
 evidence:'structural_only';observedConnector:boolean;
 initialClaimSha256:string;correctionClaimSha256:string|null;initialArtifactSha256:string|null;
}
export interface LiveObserved {
 chat:string|null;turn:string;artifactExists:boolean;artifactSha256:string|null;
 toolVisible:boolean;replyVisible:boolean;sourceVisible:boolean;markerVisible:boolean;stable:boolean;
}
interface Claim {
 phase:'initial'|'correction';taskId:string;attemptId:string;tabId:string;chat:string|null;
 contractSha256:string;promptSha256:string;failedArtifactSha256:string|null;
 priorCallIds:string[];initialTurnId:string|null;at:string;
}
interface Conversation {attemptId:string;url:string;turnId:string;bindingEvidence:'exact_user_prompt_and_owned_tab'}
export interface LiveActivityOptions {
 base?:string;repo?:string;browser?:LiveBrowser;
 snapshot?:(repo:string)=>Promise<TreeEvidence>;
 checkDispatch?:()=>void;
}
const absent=async(file:string)=>{try{await lstat(file);return false}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return true;throw e}};
const semanticText=(text:string)=>text.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1[^\n]*$/gm,'');

/** Structural report checks, never a claim of complete semantic architectural proof. */
export function assessLiveRoutingReport(text:string,a:LiveAttempt,
 facts:{activePlanPresent:boolean;worktreePresent:boolean}):string[] {
 const body=semanticText(text),missing:string[]=[];
 if(text.length<500)missing.push('report_too_short');
 if(!body.includes(HEAD))missing.push('source_revision_missing');
 if(!body.includes(a.taskId)||!body.includes(a.attemptId)||!body.includes(a.marker))missing.push('artifact_identity_missing');
 if(!/^#\s+\S/m.test(body))missing.push('title_missing');
 if(!/^## Validation and Limits\s*$/m.test(body))missing.push('validation_limits_missing');
 if(!/Task Breakdown/.test(body)||!/(derived|snapshot)/i.test(body)||!/(deferred|backlog)/i.test(body))missing.push('task_authority_explanation_missing');
 if(!sources.every(p=>body.includes(p)))missing.push('required_source_paths_missing');
 const requiredFacts=[
  'Active plan marker: '+(facts.activePlanPresent?'present':'absent'),
  'Active worktree marker: '+(facts.worktreePresent?'present':'absent'),
  'Current execution authority: active plan Task Breakdown',
  'Current snapshot role: derived', 'TODO role: deferred',
  'Implementation task selected: '+(!facts.activePlanPresent||!facts.worktreePresent?'no':'not verified'),
 ];
 if(!requiredFacts.every(line=>body.split('\n').some(value=>value.replace(/^[-*]\s*/, '').trim()===line)))
  missing.push('routing_facts_missing_or_incorrect');
 const indices=[...body.matchAll(/^## Evidence Index\s*$/gm)];
 if(indices.length!==1)missing.push(indices.length?'evidence_index_ambiguous':'evidence_index_missing');
 else {
  const section=body.slice(indices[0].index!+indices[0][0].length).split(/^##\s+/m)[0];
  if(!sources.every(p=>section.split('\n').some(line=>line.includes(p)&&line.replace(p,'').replace(/[|`*\s-]/g,'').length>=15)))
   missing.push('evidence_index_source_mappings_missing');
 }
 return missing;
}

/** Dependencies isolate tests from the signed-in browser and real repository.
 * Only the fixed default instance is registered with the live worker. */
export function createLiveReportActivities(options:LiveActivityOptions={}) {
 const base=resolve(options.base??process.cwd()),repo=resolve(options.repo??'/Users/test/Documents/work/sashai');
 const store=join(base,'.state','sashai-live-temporal-report');
 const taskDoc=join(base,'docs','SASHAI-LIVE-TEMPORAL-REPORT-TASK.md');
 const output=join(base,'docs','SASHAI-BROWSER-TASK-ROUTING-REVIEW-2026-10-15.md');
 const browser=options.browser??liveBrowser,snapshot=options.snapshot??snapshotSashaiTree;
 const checkDispatch=options.checkDispatch??(()=>{
  if(Context.current().cancellationSignal.aborted)throw Error('Activity cancelled; no browser send');
 });
 const dispatchGuard=()=>{
  const deadline=Date.now()+45000;
  return {deadline,check:()=>{checkDispatch();if(Date.now()>deadline)throw Error('Local dispatch deadline elapsed');}};
 };
 const path=(file:string)=>join(store,file);
 const read=async<T>(file:string):Promise<T>=>JSON.parse(await readFile(path(file),'utf8')) as T;
 const save=async(file:string,data:unknown)=>writeFile(path(file),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
 const decode=(bytes:Buffer)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 const correctionPrompt=(a:LiveAttempt)=>`Continue ONLY task ${a.taskId}, attempt ${a.attemptId}, marker ${a.marker}, in this SAME Sashai conversation using Remote Desktop Commander. The independent verifier rejected only evidence_index_missing. Append a new section "## Evidence Index" to ${output}, listing each actual inspected source path and the finding it supports: ${sources.join(', ')}. Preserve every existing report byte exactly; append only this section. Do not modify Sashai or any other file, and do not start another task. Return the report path and actual edit outcome.`;
 const initial=(a:Pick<LiveAttempt,'attemptId'|'marker'>)=>`READ-ONLY Sashai routing report using the selected Remote Desktop Commander connector. Inspect repository ${repo} and HEAD ${HEAD}, AGENTS.md, .ai/harness/policy.json, absence/presence of .ai/harness/active-plan and .ai/harness/active-worktree, tasks/current.md and tasks/todos.md. Create exactly one Markdown report at ${output}. Include source paths, clear title, full HEAD, task ID ${LIVE_TASK_ID}, attempt ID ${a.attemptId}, marker ${a.marker}, Task Breakdown authority, a section "## Validation and Limits", and current readiness conclusions. Include a Routing Facts section with exact lines (after checking reality): Active plan marker: absent OR present; Active worktree marker: absent OR present; Current execution authority: active plan Task Breakdown; Current snapshot role: derived; TODO role: deferred; Implementation task selected: no (if either authority marker is absent), otherwise not verified. Use one actual value, not the alternatives. For the disclosed controlled test OMIT the heading "## Evidence Index" only on this initial turn. Do not modify Sashai files, repo metadata, services or any other file. Report-only; no Codex/Repo Harness or implementation.`;
 async function approval(expected?:string) {
  const content=await readFile(taskDoc,'utf8');
  for(const field of ['Approval: APPROVED, report-only','Scope: ONE initial',
   'Task ID: `'+LIVE_TASK_ID+'`','Expected Sashai HEAD at approval: `'+HEAD+'`',
   'Authorized connector-created output ONLY: `'+output+'`'])
   if(!content.includes(field))throw Error('Live report approval contract mismatch');
  const digest=hash(content);
  if(expected!==undefined&&digest!==expected)throw Error('Approval contract changed');
  return digest;
 }
 async function sourceFacts() {
  const facts:Record<string,string|null>={};
  for(const name of sources){
   const file=join(repo,name);
   if(await absent(file)){facts[name]=null;continue;}
   const s=await lstat(file);
   if(!s.isFile()||s.size>256000)throw Error('Invalid routing source file: '+name);
   facts[name]=hash(await readFile(file));
  }
  for(const name of ['AGENTS.md','.ai/harness/policy.json','tasks/current.md','tasks/todos.md'])
   if(facts[name]===null)throw Error('Required routing source missing: '+name);
  return hash(JSON.stringify(facts));
 }
 async function current(a:LiveAttempt) {
  const saved=await read<LiveAttempt>('attempt.json');
  if(JSON.stringify(saved)!==JSON.stringify(a))throw Error('Durable attempt identity changed');
  const preparation=await read<{attemptId:string;contractSha256:string}>('PREPARATION_ATTEMPTED');
  if(preparation.attemptId!==a.attemptId||preparation.contractSha256!==a.contractSha256)throw Error('Owned target preparation changed');
  if(a.approval!=='report-only'||a.taskId!==LIVE_TASK_ID||a.project!==PROJECT||!uuid(a.attemptId)||
   a.chatUrl!==null||a.output!==output||!a.tabId||a.marker!=='SASHAI_ROUTING_LIVE_V1_'+a.attemptId||
   a.prompt!==initial(a)||a.promptSha256!==hash(initial(a)))throw Error('Live attempt not authorized');
  await approval(a.contractSha256);
  const tree=await snapshot(repo);
  if(tree.head!==HEAD||tree.fingerprintSha256!==a.source.fingerprintSha256||await sourceFacts()!==a.sourceFactsSha256)
   throw Error('Sashai source or routing authority changed');
 }
 async function reportBytes():Promise<Buffer|null> {
  if(await absent(output))return null;
  const s=await lstat(output);
  if(!s.isFile()||s.size>256000)throw Error('Invalid report artifact');
  return await readFile(output);
 }

 function claimMatches(a:LiveAttempt,c:Claim,phase:'initial'|'correction') {
  return c.phase===phase&&c.taskId===a.taskId&&c.attemptId===a.attemptId&&c.tabId===a.tabId&&
   c.contractSha256===a.contractSha256&&
   (phase==='initial'?c.promptSha256===a.promptSha256&&c.chat===null&&c.initialTurnId===null:
    typeof c.chat==='string'&&/^[a-f0-9]{64}$/.test(c.failedArtifactSha256??'')&&
    typeof c.initialTurnId==='string'&&Boolean(c.initialTurnId)&&
    c.promptSha256===hash(correctionPrompt(a))&&Array.isArray(c.priorCallIds)&&c.priorCallIds.every(x=>typeof x==='string'));
 }
 async function requireClaim(a:LiveAttempt,phase:'initial'|'correction',expected?:string) {
  const bytes=await readFile(path(phase==='initial'?'SEND_ATTEMPTED':'CORRECTION_ATTEMPTED'));
  const c=JSON.parse(decode(bytes)) as Claim;
  if(!claimMatches(a,c,phase)||expected!==undefined&&hash(bytes)!==expected)throw Error('Send claim identity mismatch');
  return c;
 }
 async function claimsMatch(a:LiveAttempt,claims:LiveClaims){
  if(!/^[a-f0-9]{64}$/.test(claims.initial))throw Error('Immutable initial claim digest missing');
  await requireClaim(a,'initial',claims.initial);
  if(claims.correction){
   if(!/^[a-f0-9]{64}$/.test(claims.correction))throw Error('Immutable correction claim digest missing');
   await requireClaim(a,'correction',claims.correction);
  }else if(!await absent(path('CORRECTION_ATTEMPTED')))throw Error('Unexpected unbound correction claim');
 }
 async function conversation(a:LiveAttempt,claims:LiveClaims) {
  await claimsMatch(a,claims);
  const chat=await browser.chat(a.tabId);
  if(!chat)return null;
  const url=parseSashaiChatUrl(chat.url).url;
  // Once bound, never replace the original target/turn. A corrective turn has
  // its own exact prompt binding below, but preserves this original identity.

  const prompt=claims.correction?correctionPrompt(a):a.prompt;
  const ev=await browser.evidence(a.tabId,url,a.marker,output,prompt);
  if(!ev.promptMatched||!ev.marker||!ev.turnId)return null;
  if(!await absent(path('conversation.json'))){
   const bound=await read<Conversation>('conversation.json');
   if(bound.attemptId!==a.attemptId||bound.url!==url||!bound.turnId||
    (!claims.correction&&bound.turnId!==ev.turnId))throw Error('Original conversation binding changed');
  }else{
   if(claims.correction)throw Error('Correction cannot establish initial conversation');
   try{await save('conversation.json',{attemptId:a.attemptId,url,turnId:ev.turnId,bindingEvidence:'exact_user_prompt_and_owned_tab'});}
   catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    const bound=await read<Conversation>('conversation.json');
    if(bound.attemptId!==a.attemptId||bound.url!==url||bound.turnId!==ev.turnId)throw Error('Concurrent conversation binding differs');}
  }
  if(claims.correction){
   const correction=await requireClaim(a,'correction',claims.correction);
   const original=await read<Conversation>('conversation.json');
   if(correction.chat!==url||original.turnId!==correction.initialTurnId)throw Error('Correction chat or original turn changed');
   if(!await absent(path('correction-turn.json'))){
    const bound=await read<{turnId:string}>('correction-turn.json');
    if(bound.turnId!==ev.turnId)throw Error('Correction turn changed');
   }else await save('correction-turn.json',{turnId:ev.turnId});
  }
  return url;
 }
 async function evidence(a:LiveAttempt,chat:string,claims:LiveClaims) {
  return await browser.evidence(a.tabId,chat,a.marker,output,claims.correction?correctionPrompt(a):a.prompt);
 }
 function receiptIdentity(a:LiveAttempt,r:LiveReceipt,chat:string,sha:string) {
  return r.taskId===a.taskId&&r.attemptId===a.attemptId&&r.chat===chat&&r.contractSha256===a.contractSha256&&
   r.artifactPath===output&&r.artifactSha256===sha&&r.sourceFingerprint===a.source.fingerprintSha256;
 }
 async function verifyLiveReport(a:LiveAttempt,claims:LiveClaims):Promise<LiveReceipt> {
  await current(a);
  const chat=await conversation(a,claims);
  if(!chat)throw Error('No bound task conversation');
  const bytes=await reportBytes();
  if(bytes===null)throw Error('Report not yet created');
  const body=decode(bytes),digest=hash(bytes),missing=assessLiveRoutingReport(body,a,{
   activePlanPresent:!await absent(join(repo,'.ai/harness/active-plan')),
   worktreePresent:!await absent(join(repo,'.ai/harness/active-worktree')),
  });
  const ev=await evidence(a,chat,claims),p=claims.correction?'correction':'initial';
  let calls:ToolCallEvidence[]=ev.calls;
  let initialArtifactSha256:string|null=null;
  if(!ev.promptMatched||!ev.turnId||!ev.marker)missing.push('submitted_turn_unconfirmed');
  if(p==='correction'){
   const claim=await requireClaim(a,'correction',claims.correction);
   if(claim.chat!==chat)throw Error('Correction chat mismatch');
   calls=calls.filter(c=>!claim.priorCallIds.includes(c.id));
   const original=await readFile(path('initial-report.md'));
   const actual=(await reportBytes())!;
   initialArtifactSha256=hash(original);
   if(initialArtifactSha256!==claim.failedArtifactSha256||actual.length<=original.length||!actual.subarray(0,original.length).equals(original))
    missing.push('original_report_not_preserved');
   const appended=decode(actual.subarray(original.length));
   if(!/^\s*## Evidence Index\s*\n/.test(appended)||/^#{1,2}\s+(?!Evidence Index\s*$)/m.test(appended))
    missing.push('correction_exceeded_evidence_index_scope');
  }
  const observedConnector=calls.some(c=>c.completed&&c.path===output&&
   (p==='initial'?c.operation==='write_file':c.operation==='edit_block'||c.operation==='write_file'));
  if(!observedConnector)missing.push('connector_invocation_unconfirmed');
  // Recheck both identities and bytes after independently checking content/evidence.
  await current(a);
  if(await conversation(a,claims)!==chat||hash((await reportBytes())??Buffer.alloc(0))!==digest)throw Error('Artifact or chat changed during verification');
  return {taskId:a.taskId,attemptId:a.attemptId,chat,contractSha256:a.contractSha256,
   artifactPath:output,artifactSha256:digest,sourceFingerprint:a.source.fingerprintSha256,
   accepted:missing.length===0,missing:[...new Set(missing)],evidence:'structural_only',observedConnector,
   initialClaimSha256:claims.initial,correctionClaimSha256:claims.correction??null,initialArtifactSha256};
 }
 async function prepareLiveAttempt(expected:string):Promise<LiveAttempt> {
  await mkdir(store,{recursive:true,mode:0o700});
  await approval(expected);
  if(!await absent(path('attempt.json'))){
   const a=await read<LiveAttempt>('attempt.json');
   await current(a);
   if(a.contractSha256!==expected)throw Error('Attempt contract mismatch');
   if(!await absent(path('SEND_ATTEMPTED')))throw Error('Existing send claim: reconciliation required, not preparation');
   if(!await absent(output))throw Error('Unclaimed output already exists');
   await browser.requireTab(a.tabId,PROJECT);
   return a;
  }
  if(!await absent(output))throw Error('New report output already exists');
  if(!await absent(path('SEND_ATTEMPTED'))||!await absent(path('CORRECTION_ATTEMPTED')))
   throw Error('Orphaned send claim: reconcile, never create a new attempt');
  const source=await snapshot(repo),sourceFactsSha256=await sourceFacts();
  if(source.head!==HEAD)throw Error('Sashai baseline differs from contract');
  const attemptId=randomUUID();
  // A crashed preparation cannot silently open another window on retry.
  await save('PREPARATION_ATTEMPTED',{attemptId,contractSha256:expected});
  const guard=dispatchGuard();guard.check();
  const tab=await browser.createOwnedProjectTab(attemptId);guard.check();
  const a:LiveAttempt={taskId:LIVE_TASK_ID,attemptId,project:PROJECT,tabId:tab.id,chatUrl:null,
   approval:'report-only',contractSha256:expected,source,sourceFactsSha256,output,
   marker:'SASHAI_ROUTING_LIVE_V1_'+attemptId,prompt:'',promptSha256:'',preparedAt:new Date().toISOString()};
  a.prompt=initial(a);a.promptSha256=hash(a.prompt);
  await save('attempt.json',a);await current(a);
  return a;
 }
 async function submitLiveOnce(a:LiveAttempt):Promise<LiveSendReceipt> {
  const guard=dispatchGuard();guard.check();
  await current(a);
  if(!await absent(output)||!await absent(path('SEND_ATTEMPTED')))throw Error('Initial send already claimed or artifact exists');
  const tab=await browser.requireTab(a.tabId,PROJECT);
  await browser.stage(tab,PROJECT,a.prompt);
  guard.check();await current(a);
  if(!await absent(output)||!await browser.matches(tab,PROJECT,a.prompt))throw Error('Post-staging preflight failed');
  guard.check();
  await save('SEND_ATTEMPTED',{phase:'initial',taskId:a.taskId,attemptId:a.attemptId,tabId:a.tabId,
   chat:null,contractSha256:a.contractSha256,promptSha256:a.promptSha256,
   failedArtifactSha256:null,priorCallIds:[],initialTurnId:null,at:new Date().toISOString()});
  await current(a);guard.check();
  const claimSha256=hash(await readFile(path('SEND_ATTEMPTED')));
  if(!await browser.click(tab,PROJECT,a.prompt,guard.deadline,guard.check))throw Error('Send indeterminate: reconcile, never retry');
  return {state:'clicked',claimSha256};
 }
 async function observeLive(a:LiveAttempt,claims:LiveClaims):Promise<LiveObserved> {
  await current(a);
  const chat=await conversation(a,claims),bytes=await reportBytes();
  if(bytes!==null)decode(bytes);
  const result:LiveObserved={chat,turn:'not_observable',artifactExists:bytes!==null,
   artifactSha256:bytes!==null?hash(bytes):null,toolVisible:false,replyVisible:false,
   sourceVisible:false,markerVisible:false,stable:false};
  if(!chat)return result;
  const ev=await evidence(a,chat,claims);
  Object.assign(result,{turn:ev.turnState,toolVisible:ev.tool,replyVisible:ev.reply,
   sourceVisible:ev.source,markerVisible:ev.marker});
  // Require two separately persisted probes of the same finished artifact and
  // phase; an old finished response cannot satisfy the corrective phase.
  const p=claims.correction?'correction':'initial',key=hash(JSON.stringify({chat,phase:p,turn:ev.turnState,turnId:ev.turnId,artifact:result.artifactSha256}));
  const file='observation-'+p+'.json';
  const previous=await read<{key:string}>(file).catch(()=>null);
  let phaseReady=true;
  if(p==='correction')phaseReady=result.artifactSha256!==(await requireClaim(a,'correction',claims.correction)).failedArtifactSha256;
  result.stable=ev.turnState==='turn_finished'&&previous?.key===key&&phaseReady;
  await writeFile(path(file),JSON.stringify({key})+'\n',{mode:0o600});
  return result;
 }
 async function correctLiveOnce(a:LiveAttempt,failed:LiveReceipt,claims:LiveClaims):Promise<LiveSendReceipt> {
  const guard=dispatchGuard();guard.check();
  await current(a);await claimsMatch(a,claims);
  if(claims.correction||failed.initialClaimSha256!==claims.initial)throw Error('Incorrect initial failure claim binding');
  if(!await absent(path('CORRECTION_ATTEMPTED')))throw Error('Correction already claimed; reconcile');
  const fresh=await verifyLiveReport(a,claims);
  if(fresh.accepted||fresh.missing.length!==1||fresh.missing[0]!=='evidence_index_missing'||
   !fresh.observedConnector||!receiptIdentity(a,failed,fresh.chat,fresh.artifactSha256)||
   failed.accepted||failed.missing.length!==1||failed.missing[0]!=='evidence_index_missing')
   throw Error('Correction receipt not the exact approved failure');
  const original=(await reportBytes())!;
  await writeFile(path('initial-report.md'),original,{flag:'wx',mode:0o600});
  const prompt=correctionPrompt(a);
  const tab=await browser.requireTab(a.tabId,fresh.chat);
  const before=await evidence(a,fresh.chat,claims);
  await browser.stage(tab,fresh.chat,prompt);
  guard.check();await current(a);await claimsMatch(a,claims);
  if(await conversation(a,claims)!==fresh.chat||hash((await reportBytes())??Buffer.alloc(0))!==fresh.artifactSha256||
   !await browser.matches(tab,fresh.chat,prompt))throw Error('Post-staging correction binding changed');
  guard.check();
  const originalTurn=await read<Conversation>('conversation.json');
  await save('CORRECTION_ATTEMPTED',{phase:'correction',taskId:a.taskId,attemptId:a.attemptId,
   tabId:a.tabId,chat:fresh.chat,contractSha256:a.contractSha256,promptSha256:hash(prompt),
   failedArtifactSha256:fresh.artifactSha256,priorCallIds:before.calls.map(c=>c.id),initialTurnId:originalTurn.turnId,at:new Date().toISOString()});
  await current(a);guard.check();
  const claimSha256=hash(await readFile(path('CORRECTION_ATTEMPTED')));
  if(hash((await reportBytes())??Buffer.alloc(0))!==fresh.artifactSha256||!await browser.click(tab,fresh.chat,prompt,guard.deadline,guard.check))
   throw Error('Correction indeterminate: reconcile, never retry');
  return {state:'clicked',claimSha256};
 }
 async function reconcileLiveSend(a:LiveAttempt,p:'initial'|'correction') {
  await current(a);
  const file=p==='initial'?'SEND_ATTEMPTED':'CORRECTION_ATTEMPTED';
  if(await absent(path(file)))return {claimed:false,claimMatched:false,chat:null};
  const c=await read<Claim>(file),bound=await browser.chat(a.tabId);
  return {claimed:true,claimMatched:claimMatches(a,c,p),chat:bound?.url??null};
 }
 async function recordLiveAcceptance(a:LiveAttempt,receipt:LiveReceipt,claims:LiveClaims) {
  await current(a);await claimsMatch(a,claims);
  if(!claims.correction||receipt.initialClaimSha256!==claims.initial||receipt.correctionClaimSha256!==claims.correction)
   throw Error('Acceptance lacks immutable send claims');
  const verified=await verifyLiveReport(a,claims);
  if(!verified.accepted||verified.missing.length||!verified.observedConnector||!receipt.accepted||receipt.missing.length||
   !receiptIdentity(a,receipt,verified.chat,verified.artifactSha256)||
   receipt.initialArtifactSha256!==verified.initialArtifactSha256)throw Error('Acceptance receipt changed or incomplete');
  await save('acceptance.json',{...verified,acceptanceStatus:'verified_report',
   dispatchPermitted:false,nextTaskPermitted:false,verifiedAt:new Date().toISOString()});
 }
 return {prepareLiveAttempt,submitLiveOnce,observeLive,verifyLiveReport,correctLiveOnce,reconcileLiveSend,recordLiveAcceptance};
}
export const liveReportActivities=createLiveReportActivities();
export const {prepareLiveAttempt,submitLiveOnce,observeLive,verifyLiveReport,correctLiveOnce,
 reconcileLiveSend,recordLiveAcceptance}=liveReportActivities;
