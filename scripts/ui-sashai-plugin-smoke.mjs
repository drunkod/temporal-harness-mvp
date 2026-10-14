#!/usr/bin/env node
/**
 * One-shot, harmless, browser-originated Sashai plugin smoke.
 * Requires Helium Profile 4 on CDP:9222 and a UNIQUE new Sashai project landing tab.
 * prepare stages a message without sending. send clicks exactly once, fail-closed.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';

const base=resolve(import.meta.dirname,'..');
const root=join(base,'.state','manual-plugin-smoke');
const project='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const file=join(root,'attempt.json');
const guard=join(root,'SEND_ATTEMPTED');
const action=process.argv[2]||'status';
const marker='SASHAI_MANUAL_CDP_PLUGIN_TEST_20261014';
const prompt=' This is a strictly READ-ONLY integration test inside project Sashai. Use the selected Remote Desktop Commander plugin to check whether the folder /Users/test/Documents/work/temporal-harness-mvp exists on my MacBook. Report only whether it exists and whether the plugin was invoked successfully. Do not create, change or delete files, settings, services or processes. If the plugin cannot be invoked, say so explicitly. Test marker: '+marker;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pages=async()=>await(await fetch('http://127.0.0.1:9222/json/list',{signal:AbortSignal.timeout(4000)})).json();
async function evaluate(page,expression){
 const socket=new WebSocket(page.webSocketDebuggerUrl);
 return await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{socket.close();reject(Error('CDP timeout'))},9000);
  socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})));
  socket.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data)}catch{return}
    if(m.id!==1)return;clearTimeout(timeout);socket.close();
    if(m.error||m.result?.exceptionDetails)reject(Error('CDP evaluate failed'));
    else resolve(m.result?.result?.value);
  });
  socket.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('CDP connection failed'))});
 });
}
await mkdir(root,{recursive:true,mode:0o700});
if(action==='prepare'){
 if(existsSync(file))throw Error('A manual browser smoke already exists; refuse to stage twice');
 const candidates=(await pages()).filter(t=>t.type==='page' && t.url?.split('?')[0]===project && t.webSocketDebuggerUrl);
 if(candidates.length!==1)throw Error('Open exactly one new Sashai project landing tab; found '+candidates.length);
 const tab=candidates[0];
 const before=await evaluate(tab,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');return {path:location.pathname,aria:e?.getAttribute('aria-label'),draft:e?.innerText?.trim()||''}})()`);
 if(before.path!==new URL(project).pathname || before.aria!=='New chat in dr/sashai' || before.draft)throw Error('Not a clean new project composer');
 const opened=await evaluate(tab,`(() => {const hasChoice=[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&(b.innerText||'').trim().startsWith('Remote Desktop Commander'));if(hasChoice)return true;const b=document.querySelector('button[aria-label="Add files and more"]');if(!b||!b.getClientRects().length)return false;b.click();return true})()`);
 if(!opened)throw Error('Cannot open app chooser');
 await sleep(400);
 const picked=await evaluate(tab,`(() => {const bs=[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length && (b.innerText||'').trim().startsWith('Remote Desktop Commander'));if(bs.length!==1)return {ok:false,count:bs.length};bs[0].click();return {ok:true,count:1}})()`);
 if(!picked.ok)throw Error('No unique Remote Desktop Commander plugin button');
 await sleep(300);
 const written=await evaluate(tab,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]');if(e?.getAttribute('aria-label')!=='New chat in dr/sashai'||e.innerText.trim()!=='Remote Desktop Commander')return {ok:false,reason:'unexpected draft before typing'};e.focus();document.execCommand('insertText',false,${JSON.stringify(prompt)});const v=e.innerText||'';return {ok:v.includes(${JSON.stringify(marker)})&&v.includes('Remote Desktop Commander')&&v.split(${JSON.stringify(marker)}).length===2,preview:v.slice(0,90),size:v.length,sendEnabled:!!document.querySelector('button[aria-label="Send"]:not([disabled])')}})()`);
 if(!written.ok)throw Error('Plugin selected but composing message could not be verified: '+JSON.stringify(written));
 await writeFile(file,JSON.stringify({tabId:tab.id,project,marker,at:new Date().toISOString(),state:'prepared'},null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:'prepared_no_submission',...written},null,2));
}else if(action==='send'){
 if(existsSync(guard))throw Error('SEND ALREADY ATTEMPTED; DO NOT RETRY');
 const attempt=JSON.parse(await readFile(file,'utf8'));
 if(attempt.state!=='prepared' || attempt.marker!==marker)throw Error('Invalid staged test');
 const tab=(await pages()).find(t=>t.id===attempt.tabId&&t.url?.split('?')[0]===project&&t.webSocketDebuggerUrl);
 if(!tab)throw Error('Staged tab changed or navigated; refusing send');
 const preflight=await evaluate(tab,`(() => {const e=document.querySelector('[contenteditable="true"][role="textbox"]'),b=document.querySelector('button[aria-label="Send"]:not([disabled])'),s=e?.innerText||'';return {correctProject:location.pathname===${JSON.stringify(new URL(project).pathname)},hasPlugin:s.includes('Remote Desktop Commander'),markerOnce:s.split(${JSON.stringify(marker)}).length===2,canSend:!!b}})()`);
 if(!preflight.correctProject||!preflight.hasPlugin||!preflight.markerOnce||!preflight.canSend)throw Error('Preflight failed; no send: '+JSON.stringify(preflight));
 // The write-ahead guard remains even if the network/CDP fails after this point.
 await writeFile(guard,JSON.stringify({at:new Date().toISOString(),tabId:tab.id,marker},null,2),{flag:'wx',mode:0o600});
 const click=await evaluate(tab,`(() => {const b=document.querySelector('button[aria-label="Send"]:not([disabled])');if(!b)return false;b.click();return true})()`);
 console.log(JSON.stringify({status:click?'send_clicked_once':'indeterminate_no_resend',marker},null,2));
}else if(action==='status'){
 const record=existsSync(file)?JSON.parse(await readFile(file,'utf8')):null;
 const sent=existsSync(guard);
 const tabs=(await pages()).filter(t=>t.type==='page'&&(t.url||'').includes('g-p-6ab28bdd7fbc8191b581316ff09da79d'));
 console.log(JSON.stringify({record,sendAttempted:sent,projectTabs:tabs.map(t=>({id:t.id,path:new URL(t.url).pathname}))},null,2));
}else throw Error('Usage: node scripts/ui-sashai-plugin-smoke.mjs prepare|send|status');
