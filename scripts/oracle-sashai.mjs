#!/usr/bin/env node
/**
 * Oracle-only Sashai MVP. No Repo Harness dependency or imports.
 * Attach to the already running Helium Profile 4 using its CDP endpoint.
 *
 * Commands:
 *   node scripts/oracle-sashai.mjs doctor
 *   node scripts/oracle-sashai.mjs preview "Prompt"
 *   node scripts/oracle-sashai.mjs start "Prompt"
 *   node scripts/oracle-sashai.mjs status
 *   node scripts/oracle-sashai.mjs followup "Continue in same conversation"
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { observeSashaiConversation, parseSashaiChatUrl } from '../dist/sashai-observer.js';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const base=resolve(import.meta.dirname,'..');
const dir=join(base,'.state','oracle-sashai');
const metadata=join(dir,'latest.json');
const project='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const marker=join(os.homedir(),'Library','Application Support','net.imput.helium','DevToolsActivePort');
const pinnedOracle=join(base,'.state','oracle-local','node_modules','.bin','oracle');
const cli=process.env.ORACLE_BIN || (existsSync(pinnedOracle) ? pinnedOracle : '/opt/homebrew/bin/oracle');
const cmd=process.argv[2]??'status';
const prompt=process.argv.slice(3).join(' ').trim();
await mkdir(dir,{recursive:true});
const now=()=>new Date().toISOString();
async function save(record){await writeFile(metadata,JSON.stringify(record,null,2)+'\n');}
function assertOracle(){
 const r=spawnSync(cli,['--version'],{encoding:'utf8',timeout:10000});
 if(r.status!==0)throw Error('Oracle CLI not available: '+(r.stderr||r.error?.message||''));
 return r.stdout.trim();
}
async function liveCDP(){
 const response=await fetch('http://127.0.0.1:9222/json/version',{signal:AbortSignal.timeout(3500)});
 if(!response.ok)throw Error('Helium CDP HTTP '+response.status);
 const doc=await response.json();
 const ws=String(doc.webSocketDebuggerUrl||'');
 if(!/^ws:\/\/127\.0\.0\.1:9222\/devtools\/browser\/[\w-]+$/.test(ws))
  throw Error('Unexpected live browser WS endpoint');
 return ws;
}
async function synchronizeCDP(){
 const ws=await liveCDP();
 const expected=ws.slice('ws://127.0.0.1:9222'.length);
 const lines=existsSync(marker)?(await readFile(marker,'utf8')).trim().split(/\r?\n/):[];
 const changed=lines[0]!=='9222'||lines[1]!==expected;
 if(changed){
   if(existsSync(marker))await copyFile(marker,join(dir,'DevToolsActivePort.previous'));
   await writeFile(marker,'9222\n'+expected+'\n');
 }
 return {live:true,refreshedMarker:changed};
}
const flags=[
 '--engine','browser','--browser-attach-running','--chatgpt-url',project,
 '--browser-model-strategy','current','--browser-archive','never',
 '--browser-approval-wait','90s','--browser-timeout','4m'
];
async function run(args,type,session){
 const slug='oracle-sashai-'+Date.now()+'-'+randomUUID().slice(0,5);
 const output=join(dir,slug+'.txt');
 const record={slug,type,project,started:now(),status:'starting',session:session??null,output,error:null};
 await save(record);
 const p=spawn(cli,[...flags,'--slug',slug,'--write-output',output,'--wait',...args],{
  cwd:base,env:process.env,stdio:['ignore','pipe','pipe']});
 let recent='';
 for(const s of [p.stdout,p.stderr]){
   s.setEncoding('utf8');
   s.on('data',chunk=>{recent=(recent+chunk).slice(-7000);process.stdout.write(chunk);});
 }
 record.status='running';record.pid=p.pid;await save(record);
 const exitCode=await new Promise(resolve=>p.on('close',resolve));
 record.finished=now();record.exitCode=exitCode;
 record.status=exitCode===0&&existsSync(output)?'completed':'failed';
 record.error=record.status==='failed'?recent.slice(-900):null;
 if(existsSync(output))record.response=(await readFile(output,'utf8')).slice(0,1200);
 // Oracle 0.21.3 can incorrectly fail prompt commitment AFTER ChatGPT accepted it.
 // Inspect the saved Oracle session, and NEVER mark an uncertain submission as safe to retry.
 const oracleMeta=join(homedir(),'.oracle','sessions',slug,'meta.json');
 if(existsSync(oracleMeta)){
   try{
     const saved=JSON.parse(await readFile(oracleMeta,'utf8'));
     const runtime=saved.browser?.runtime;
     if(runtime?.promptSubmitted && record.status==='failed'){
       record.status='submitted_unverified';
       record.conversationUrl=runtime.tabUrl||null;
       try {
         if(record.conversationUrl){
           parseSashaiChatUrl(record.conversationUrl);
           const observed=await observeSashaiConversation(record.conversationUrl);
           if(observed.turnState==='turn_finished' && observed.lastAssistant){
             record.status='answer_observed';
             record.answerPreview=observed.lastAssistant;
           }
         }
       }catch { /* absence of browser proof is not a reason to replay */ }
     }
   }catch { /* retain the original error without making optimistic claims */ }
 }
 await save(record);
 console.log('\nORACLE_MVP_STATUS='+record.status+' SESSION='+slug);
 if(record.status!=='completed')process.exitCode=1;
}
if(cmd==='doctor'){
 const version=assertOracle();
 const cdp=await synchronizeCDP();
 console.log(JSON.stringify({oracle:version,cdp,project,profile:'Helium Profile 4',repoHarness:false},null,2));
}else if(cmd==='status'){
 const record=existsSync(metadata)?JSON.parse(await readFile(metadata,'utf8')):{status:'not_started'};
 console.log(JSON.stringify(record,null,2));
}else if(cmd==='preview'){
 assertOracle();
 if(!prompt)throw Error('Usage: preview "Prompt"');
 const p=spawnSync(cli,[...flags,'--dry-run','json','-p',prompt],{cwd:base,encoding:'utf8',timeout:20000});
 process.stdout.write(p.stdout||'');process.stderr.write(p.stderr||'');process.exitCode=p.status??1;
}else if(cmd==='start'){
 assertOracle();
 if(!prompt)throw Error('Usage: start "Prompt"');
 const last=existsSync(metadata)?JSON.parse(await readFile(metadata,'utf8')):null;
 if(['running','submitted_unverified','answer_observed'].includes(last?.status))
   throw Error('Previous Oracle submission may already exist; inspect its chat and reconcile before starting another');
 const cdp=await synchronizeCDP();
 console.log('Oracle direct / Helium Profile 4 / CDP metadata refreshed:',cdp.refreshedMarker);
 await run(['-p',prompt],'start');
}else if(cmd==='followup'){
 assertOracle();
 if(!prompt)throw Error('Usage: followup "Continuation prompt"');
 const last=existsSync(metadata)?JSON.parse(await readFile(metadata,'utf8')):null;
 if(last?.status!=='completed')throw Error('No confirmed completed Oracle session to resume');
 const prior=last.slug;
 await synchronizeCDP();
 await run(['--followup',prior,'-p',prompt],'followup',prior);
}else{
 console.error('Usage: node scripts/oracle-sashai.mjs doctor|preview|start|status|followup [prompt]');
 process.exitCode=2;
}
