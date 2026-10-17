#!/usr/bin/env node
/** Runs the production create -> stage path immediately; never calls LiveBrowser.click(). */
import {randomUUID} from 'node:crypto';
import {createLiveBrowser} from '../dist/sashai-live-browser.js';
import {FLOWDECK_CONNECTOR_LABEL} from '../dist/sashai-dispatch-evidence.js';
import {reconcileTransportDraft} from './flowdeck-browser-test-draft.mjs';
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--repeat'&&/^(?:[1-9]|10)$/.test(args[1])))throw Error('Usage: node scripts/flowdeck-browser-check.mjs [--repeat 1..10]');
const count=args.length?Number(args[1]):1;
const project='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const prompt='FLOWDECK TRANSPORT CHECK ONLY. This draft must never be submitted.';
let passed=0;
for(let iteration=1;iteration<=count;iteration++){
 const browser=createLiveBrowser();let tab;const started=Date.now();
 const timer=setTimeout(()=>{console.error(JSON.stringify({iteration,error:'Bounded check exceeded 50 seconds',browserSubmissions:0,ownedTabId:tab?.id,diagnostics:browser.diagnostics?.()}));process.exit(1);},50000);
 try{
  tab=await browser.createOwnedProjectTab(randomUUID());
  // A prior no-send transport check may have left its exact test draft in
  // ChatGPT's Project draft persistence. Never clear a different owner draft.
  await reconcileTransportDraft(tab,project,prompt);
  await browser.stage(tab,project,prompt);
  if(!await browser.matches(tab,project,prompt))throw Error('Selected connector/full composer not matched');
  const cleanup=await reconcileTransportDraft(tab,project,prompt);
  if(!cleanup.cleaned)throw Error('Owned transport-test draft was not cleared after full match');
  passed++;
  console.log(JSON.stringify({check:'real_browser_connector_selection',iteration,ok:true,elapsedMs:Date.now()-started,projectUrl:project,ownedTabId:tab.id,profile:'Profile 4',connector:FLOWDECK_CONNECTOR_LABEL,fullComposerMatched:true,browserSubmissions:0,chatCreated:false,diagnostics:browser.diagnostics?.()},null,2));
 }catch(error){console.error(JSON.stringify({iteration,ok:false,error:error.message,elapsedMs:Date.now()-started,browserSubmissions:0,diagnostics:browser.diagnostics?.()},null,2));process.exitCode=1;}
 finally{
  if(tab){try{const r=await fetch('http://127.0.0.1:9222/json/close/'+encodeURIComponent(tab.id),{signal:AbortSignal.timeout(4500)});if(!r.ok)throw Error('Close failed');console.log('Closed only the newly owned transport-check tab.');}catch{console.error('Owned check tab may remain open; no send was attempted.');process.exitCode=1;}}
  clearTimeout(timer);
 }
 if(process.exitCode)break;
}
console.log(JSON.stringify({check:'repeated_immediate_staging',requested:count,passed,browserSubmissions:0}));
