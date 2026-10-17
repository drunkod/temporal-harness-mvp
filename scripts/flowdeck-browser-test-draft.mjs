/** Clean only a Flowdeck transport-test payload in the new tab we just created.
 * Never use this from the production sender or against an arbitrary user tab.
 * All other drafts are immutable obstacles, not permission to clear them.
 */
import {browserPages,browserEvaluate} from '../dist/sashai-live-browser.js';
import {composerPayloadFor} from '../dist/sashai-dispatch-evidence.js';

export async function reconcileTransportDraft(tab, project, prompt, deps={}) {
 const pages=deps.pages??browserPages, evaluate=deps.evaluate??browserEvaluate;
 const wait=deps.wait??(ms=>new Promise(r=>setTimeout(r,ms)));
 const tag=new URL(tab?.url??'about:blank').searchParams.get('flowdeckAttempt');
 if(!tag||!tab?.id||!tab?.webSocketDebuggerUrl)throw Error('Transport cleanup requires a freshly tagged owned test tab');
 const route=new URL(project);
 if(route.origin!=='https://chatgpt.com')throw Error('Transport cleanup project scope invalid');
 const expected=composerPayloadFor(prompt);
 const path=JSON.stringify(route.pathname);
 const read=String.raw`(() => {
  if(location.origin!=='https://chatgpt.com'||location.pathname!==${path})return 'not_ready';
  const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(e=>e.getClientRects().length);
  if(editors.length===0)return 'not_ready';
  if(editors.length!==1)return 'ambiguous_composer';
  const value=(editors[0].innerText||'').normalize('NFC').replace(/\s+/gu,' ').trim();
  if(!value)return 'empty';
  if(value===${JSON.stringify(expected)})return 'known_test_draft';
  return 'foreign_draft';
 })()`;
 const erase=String.raw`(() => {
  if(location.origin!=='https://chatgpt.com'||location.pathname!==${path})return 'not_ready';
  const editors=[...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter(e=>e.getClientRects().length);
  if(editors.length!==1)return 'ambiguous_composer';
  const editor=editors[0];
  const value=(editor.innerText||'').normalize('NFC').replace(/\s+/gu,' ').trim();
  if(value!==${JSON.stringify(expected)})return 'foreign_draft';
  if([...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.getAttribute('data-testid')==='stop-button'))return 'active';
  const selection=window.getSelection(),range=document.createRange();
  if(!selection||!range)return 'cleanup_unavailable';
  editor.focus();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
  if(document.execCommand('delete',false)===false)return 'cleanup_unavailable';
  return (editor.innerText||'').trim()===''?'cleared':'cleanup_unavailable';
 })()`;
 const deadline=Date.now()+12_000;
 let cleaned=false;
 const target=async()=>{
  const matches=(await pages()).filter(t=>t.id===tab.id);
  if(matches.length!==1||matches[0].type!=='page'||!matches[0].webSocketDebuggerUrl)
   throw Error('Owned transport tab missing/ambiguous; never select a replacement');
  const url=matches[0].url;
  if(url==='about:blank'||url==='https://chatgpt.com/')return null;
  let live;
  try{live=new URL(url)}catch{
   // CDP can briefly expose an unparsable navigation URL for this exact
   // owned target. Keep waiting for the SAME tab, never mutate a draft here.
   return null;
  }
  if(live.origin!==route.origin||live.pathname!==route.pathname||
    (live.searchParams.has('flowdeckAttempt')&&live.searchParams.get('flowdeckAttempt')!==tag))
   throw Error('Transport draft cleanup refused wrong project or ownership tag');
  return matches[0];
 };
 while(Date.now()<deadline){
  const current=await target();
  if(!current){await wait(250);continue}
  const status=await evaluate(current,read);
  if(status==='not_ready'){await wait(250);continue}
  if(status==='known_test_draft'){
   if(cleaned)throw Error('Transport test draft restored after exact cleanup; refuse repeat mutation');
   const result=await evaluate(current,erase);
   if(result!=='cleared')throw Error('Exact transport draft cleanup failed: '+String(result));
   cleaned=true;
   await wait(700);
   continue;
  }
  if(status==='empty')return {ready:true,cleaned};
  throw Error('Owned tab contains an unexpected draft or ambiguous composer: '+String(status));
 }
 throw Error('Transport composer was not observable before the read-only cleanup deadline');
}
