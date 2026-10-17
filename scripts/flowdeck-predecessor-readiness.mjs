/** Read-only predecessor readiness evaluation. All external readers are injectable. */
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const eq = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const unique = values => [...new Set(values)];
const canonicalProject = value => {
 try {const u=new URL(value);return u.origin+u.pathname.replace(/\/c\/[0-9a-f-]{36}$/i,'').replace(/\/project\/?$/,'').replace(/-dr-sashai$/i,'')+'/project';}
 catch{return null;}
};
const safeReason = value => typeof value==='string'&&/^[a-z_]{3,72}$/.test(value)?value:'fresh_predecessor_completion_unverified';

/** No side effects: consumes *only* injected read-only tab and observation readers. */
export async function evaluatePredecessorReadiness({project,previous,record,active,readers}) {
 const result={predecessorTabPresent:false,predecessorEvidenceVerified:false,readyForPredecessor:false,blockers:[],writes:false};
 const fail=(code,present=false)=>({...result,predecessorTabPresent:present,blockers:[code]});
 if(!project||!previous||!record||!active||!readers?.listTabs||!readers?.inspect)
   return fail('predecessor_evidence_unavailable');
 if(previous.projectId!==project.id||!project.tasks?.some(t=>t.id===previous.taskId)||
    typeof previous.chatUrl!=='string'||typeof previous.tabId!=='string'||!previous.tabId||
    canonicalProject(previous.chatUrl)!==canonicalProject(project.projectUrl))
   return fail('predecessor_scope_mismatch');
 if(!eq(record.binding,previous)||!eq(active,previous))
   return fail('predecessor_binding_changed');
 if(!Number.isInteger(record.users)||record.users<1||
    record.observation?.turn!=='finished'||record.observation?.decision!=='implementation_done')
   return fail('predecessor_completion_record_unverified');
 let targets;
 try {targets=await readers.listTabs();}
 catch{return fail('predecessor_tab_inspection_unavailable');}
 if(!Array.isArray(targets))return fail('predecessor_tab_inspection_unavailable');
 const matches=targets.filter(t=>t?.id===previous.tabId);
 if(matches.length===0)return fail('original_predecessor_tab_missing');
 if(matches.length!==1)return fail('predecessor_tab_ambiguous');
 const tab=matches[0];
 if(tab.type!=='page'||!tab.webSocketDebuggerUrl||
    tab.url?.split('?')[0]!==previous.chatUrl)return fail('predecessor_tab_identity_mismatch');
 // A fresh page alone cannot certify a historical user message without a sealed hash.
 if(typeof record.expectedPromptHash!=='string'||!/^[a-f0-9]{64}$/.test(record.expectedPromptHash))
   return fail('predecessor_message_unsealed',true);
 let fresh;
 try{fresh=await readers.inspect(tab,previous);}
 catch{return fail('fresh_predecessor_completion_unverified',true);}
 if(!fresh||fresh.tabId!==previous.tabId||fresh.chatUrl!==previous.chatUrl||
    fresh.turnState!=='turn_finished'||fresh.userTurns!==record.users||
    fresh.identity?.latestUserTurns!==record.users||
    fresh.identity?.taskId!==previous.taskId||
    resolve(fresh.identity?.worktree||'/')!==resolve(project.repo)||
    canonicalProject(fresh.identity?.projectUrl)!==canonicalProject(project.projectUrl)||
    typeof fresh.identity?.originalUserHash!=='string'||
    !/^[a-f0-9]{64}$/.test(fresh.identity.originalUserHash)||
    typeof fresh.identity?.latestUserHash!=='string'||
    !/^[a-f0-9]{64}$/.test(fresh.identity.latestUserHash)||
    (record.expectedPromptHash&&fresh.identity.latestUserHash!==record.expectedPromptHash)||
    typeof fresh.lastAssistant!=='string'||
    !/^FLOWDECK_STATUS: implementation_done$/.test(fresh.lastAssistant.trim().split(/\r?\n/).at(-1)||'')||
    (fresh.lastAssistant.match(/FLOWDECK_STATUS/g)||[]).length!==1)
   return fail('fresh_predecessor_completion_unverified',true);
 return {...result,predecessorTabPresent:true,predecessorEvidenceVerified:true,readyForPredecessor:true};
}
/** Filesystem reads for the exact immutable predecessor binding and task. */
export async function readPredecessorRecords(base,previous,readJson=async file=>JSON.parse(await readFile(file,'utf8'))) {
 const folder=join(resolve(base),'.state/flowdeck-supervisor');
 const read=async file=>{try{return await readJson(file)}catch(e){if(e?.code==='ENOENT')return null;throw e}};
 return {
  record:await read(join(folder,'binding-'+digest([previous.projectId,previous.workId])+'.json')),
  active:await read(join(folder,'task-'+digest([previous.projectId,previous.taskId])+'.json'))
 };
}

/** Live readers inspect existing CDP pages; never open tabs or invoke stage/click. */
export async function productionPredecessorReaders() {
 const {browserPages,browserEvaluate,createLiveBrowser}=await import('../dist/sashai-live-browser.js');
 const {observeSashaiConversation}=await import('../dist/sashai-observer.js');
 const {supervisorAnswerExpression,supervisorIdentityExpression}=await import('../dist/flowdeck-supervisor-activities.js');
 const {normalizeComposerText}=await import('../dist/sashai-dispatch-evidence.js');
 const browser=createLiveBrowser();
 return {
  listTabs:browserPages,
  inspect:async (tab,previous)=>{
   await browser.requireTab(previous.tabId,previous.chatUrl);
   const observation=await observeSashaiConversation(previous.chatUrl);
   if(observation.browser!=='attached_read_only'||observation.tabId!==previous.tabId)
    throw Error('Predecessor observation selected another tab');
   const answer=await browserEvaluate(tab,supervisorAnswerExpression(previous.chatUrl));
   const identity=await browserEvaluate(tab,supervisorIdentityExpression(previous.chatUrl));
   await browser.requireTab(previous.tabId,previous.chatUrl);
   const textHash=value=>createHash('sha256').update(normalizeComposerText(value)).digest('hex');
   return {
    tabId:observation.tabId,chatUrl:previous.chatUrl,
    turnState:observation.turnState,userTurns:observation.userTurns,
    lastAssistant:answer,
    identity:identity&&{
     taskId:identity.taskId,worktree:identity.worktree,projectUrl:identity.projectUrl,
     latestUserTurns:identity.latestUserTurns,
     originalUserHash:typeof identity.originalUserText==='string'?textHash(identity.originalUserText):null,
     latestUserHash:typeof identity.latestUserText==='string'?textHash(identity.latestUserText):null
    }
   };
  }
 };
}
