#!/usr/bin/env node
/** One corrective UI turn in the SAME approved browser-report chat, never general-purpose. */
import {readFile,writeFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {composerPayloadFor,snapshotSashaiTree} from '../dist/sashai-dispatch-evidence.js';
const base=resolve(import.meta.dirname,'..');
const dir=join(base,'.state','report-review-dispatch');
const attemptFile=join(dir,'attempt.json');
const fixFile=join(dir,'fix-attempt.json');
const guard=join(dir,'FIX_SEND_ATTEMPTED');
const report=join(base,'docs','SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md');
const repo='/Users/test/Documents/work/sashai';
const sha=s=>createHash('sha256').update(s).digest('hex');
const action=process.argv[2]||'status';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const marker='SASHAI_REVIEW_DIAGRAM_REPAIR_ONCE_20261015';
const prompt=' Continue this SAME already-approved Sashai architecture REPORT task. The independently checked report is complete except for diagram format: diagrams A and B in /Users/test/Documents/work/temporal-harness-mvp/docs/SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md contain HTML <br/> tokens inside Mermaid node labels, violating the report-only contract requiring HTML-free diagrams. Use Remote Desktop Commander to edit ONLY that report file: replace inline HTML line-break tokens in its Mermaid labels with plain text separators (for example, em dashes or colons), preserving all diagrams, citations, content, headings, task marker, and Git/Codegraph evidence. Do NOT edit any Sashai files, task contract, source code, configuration or other MVP artifacts; do not run builds or change services. Confirm at least 2 Mermaid graphs are valid plain-text-only and report exactly which file you corrected. No new tasks. Repair marker: '+marker;
const tabs=async()=>await(await fetch('http://127.0.0.1:9222/json/list',{signal:AbortSignal.timeout(5000)})).json();
async function run(tab,expression){
 const ws=new WebSocket(tab.webSocketDebuggerUrl);
 return await new Promise((yes,no)=>{
  const tm=setTimeout(()=>{ws.close();no(Error('CDP timeout; do not retry if send claimed'))},8500);
  ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})));
  ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id!==1)return;clearTimeout(tm);ws.close();if(m.error||m.result?.exceptionDetails)no(Error('CDP evaluation failed'));else yes(m.result?.result?.value)});
  ws.addEventListener('error',()=>{clearTimeout(tm);no(Error('CDP disconnection'))});
 });
}
const source=JSON.parse(await readFile(attemptFile,'utf8'));
if(source.status!=='submitted'||source.approval!=='report-only'||!source.conversationUrl||
  !existsSync(join(dir,'SEND_ATTEMPTED')))throw Error('Original approved report was not safely bound');
const gitHead=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const reportBody=await readFile(report,'utf8');
if(gitHead!==source.head)throw Error('Sashai revision drift; refuse fix');
const page=(await tabs()).find(t=>t.id===source.tabId && t.url?.split('?')[0]===source.conversationUrl&&t.webSocketDebuggerUrl);
if(action==='prepare'){
 if(existsSync(fixFile)||existsSync(guard))throw Error('Fix attempt already exists; refuse prepare again');
 if(!page)throw Error('Original Sashai chat not open in its original browser tab');
 if(!reportBody.includes(source.marker)||!reportBody.includes('<br/>'))throw Error('Original browser report already changed or not eligible');
 const pre=await run(page,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');return {path:location.pathname,editor:e?.innerText?.trim()||'',stop:[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&/stop/i.test(b.getAttribute('aria-label')||''))}})()`);
 if(pre.path!==new URL(source.conversationUrl).pathname||pre.stop||pre.editor)throw Error('Conversation is active or composer not empty');
 const opened=await run(page,`(() => {const choices=[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length&&(b.innerText||'').trim().startsWith('Remote Desktop Commander'));if(choices.length===1)return true;const b=document.querySelector('button[aria-label="Add files and more"]');if(!b||!b.getClientRects().length)return false;b.click();return true})()`);
 if(!opened)throw Error('Plugin chooser not available');await sleep(650);
 const selected=await run(page,`(() => {const c=[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length&&(b.innerText||'').trim().startsWith('Remote Desktop Commander'));if(c.length!==1)return false;c[0].click();return true})()`);
 if(!selected)throw Error('Connector not selectable yet; no fix staged');
 await sleep(300);
 const staged=await run(page,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');if(e?.innerText?.trim()!=='Remote Desktop Commander')return false;e.focus();document.execCommand('insertText',false,${JSON.stringify(prompt)});return e.innerText.normalize('NFC').replace(/\\s+/gu,' ').trim()===${JSON.stringify(composerPayloadFor(prompt))}&&!!document.querySelector('button[aria-label="Send"]:not([disabled])')})()`);
 if(!staged)throw Error('Fix prompt not safely staged');
 await writeFile(fixFile,JSON.stringify({chatUrl:source.conversationUrl,tabId:page.id,
   reportBeforeSha256:sha(reportBody),sourceHead:gitHead,marker,promptSha256:sha(prompt),
   composerSha256:sha(composerPayloadFor(prompt)),preflightTreeEvidence:await snapshotSashaiTree(repo),
   state:'prepared',createdAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:'fix_prepared_no_send',chat:source.conversationUrl,marker}));
}else if(action==='send'){
 if(existsSync(guard))throw Error('FIX ALREADY ATTEMPTED; NO RESEND');
 const fix=JSON.parse(await readFile(fixFile,'utf8'));
 if(fix.state!=='prepared'||fix.tabId!==source.tabId||fix.chatUrl!==source.conversationUrl||
   fix.sourceHead!==gitHead||fix.reportBeforeSha256!==sha(reportBody)||fix.promptSha256!==sha(prompt)||
   fix.composerSha256!==sha(composerPayloadFor(prompt))||
   fix.preflightTreeEvidence?.version!==2||
   (await snapshotSashaiTree(repo)).fingerprintSha256!==fix.preflightTreeEvidence.fingerprintSha256)
  throw Error('Fix source changed; refuse send');
 if(!page)throw Error('Original chat changed; refuse send');
 const ready=await run(page,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');return location.pathname===${JSON.stringify(new URL(source.conversationUrl).pathname)}&&(e?.innerText||'').normalize('NFC').replace(/\\s+/gu,' ').trim()===${JSON.stringify(composerPayloadFor(prompt))}&&!!document.querySelector('button[aria-label="Send"]:not([disabled])')})()`);
 if(!ready)throw Error('Missing connector or marker; refuse send');
 await writeFile(guard,JSON.stringify({at:new Date().toISOString(),chat:source.conversationUrl,marker},null,2)+'\n',{flag:'wx',mode:0o600});
 const click=await run(page,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');if(location.pathname!==${JSON.stringify(new URL(source.conversationUrl).pathname)}||(e?.innerText||'').normalize('NFC').replace(/\\s+/gu,' ').trim()!==${JSON.stringify(composerPayloadFor(prompt))})return false;const b=document.querySelector('button[aria-label="Send"]:not([disabled])');if(!b)return false;b.click();return true})()`);
 console.log(JSON.stringify({status:click?'fix_clicked_once':'fix_indeterminate_never_retry',marker}));
}else if(action==='status')console.log(JSON.stringify({fixPrepared:existsSync(fixFile),fixSent:existsSync(guard),
  reportBytes:(await stat(report)).size,reportHash:sha(reportBody),hasHtmlBreaks:reportBody.includes('<br/>'),chat:source.conversationUrl},null,2));
else throw Error('Usage: fix prepare|send|status');
