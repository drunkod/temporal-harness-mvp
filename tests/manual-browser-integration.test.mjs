import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {sashaiOverview, observeSashaiConversation, readOracleSmokeEvidence} from '../dist/sashai-observer.js';

const root=resolve('.');
const state=join(root,'.state','manual-plugin-smoke');
const manualId='6acfca8f-34cc-83eb-aaa9-fbd1301247d4';
const expected='SASHAI_BROWSER_ORIGIN_ORACLE_FOLLOWUP_OK';
const url='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/'+manualId;
const metaPath=join(homedir(),'.oracle','sessions','sashai-manual-origin-v0215-followup','meta.json');

test('browser UI test used one persistent send guard and a project-only conversation',async(t)=>{
 if(!existsSync(join(state,'attempt.json'))){t.skip('Manual browser smoke not created');return;}
 const attempt=JSON.parse(await readFile(join(state,'attempt.json'),'utf8'));
 const sent=JSON.parse(await readFile(join(state,'SEND_ATTEMPTED'),'utf8'));
 assert.equal(attempt.project,'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project');
 assert.equal(attempt.marker,'SASHAI_MANUAL_CDP_PLUGIN_TEST_20261014');
 assert.equal(sent.marker,attempt.marker);
 assert.equal(typeof attempt.tabId,'string');
 assert.ok(existsSync(join(state,'ORACLE_FOLLOWUP_ATTEMPTED')));
});

test('refuses a duplicate browser-origin plugin test send without touching ChatGPT',async(t)=>{
 if(!existsSync(join(state,'SEND_ATTEMPTED'))){t.skip('Test not yet sent');return;}
 const retry=spawnSync(process.execPath,[join(root,'scripts','ui-sashai-plugin-smoke.mjs'),'send'],{
  cwd:root,encoding:'utf8',timeout:12000
 });
 assert.notEqual(retry.status,0);
 assert.match(retry.stderr,/SEND ALREADY ATTEMPTED/);
});

test('Oracle continued the browser-originated conversation in the same project without duplication',async(t)=>{
 if(!existsSync(metaPath)){t.skip('Oracle manual-origin followup not yet tested');return;}
 const meta=JSON.parse(await readFile(metaPath,'utf8'));
 const runtime=meta.browser?.runtime;
 assert.equal(meta.status,'completed');
 assert.equal(runtime?.promptSubmitted,true);
 assert.equal(runtime?.conversationId,manualId);
 assert.equal(runtime?.tabUrl,url);
 assert.equal((await readFile(join(state,'followup-response.txt'),'utf8')).trim(),expected);
 const evidence=await readOracleSmokeEvidence(url);
 assert.equal(evidence?.oracleStatus,'completed');
 assert.equal(evidence?.conversationUrl,url);
 assert.equal(evidence?.expectedAnswer,expected);
});

test('Flowdeck correlates Oracle native transcript but never exposes that transcript as metadata',async(t)=>{
 let overview;
 try{overview=await sashaiOverview();}
 catch(e){t.skip('Helium CDP not available: '+e.message);return;}
 if(overview.adopted?.conversationId!==manualId){t.skip('Manual Sashai chat is not currently adopted');return;}
 assert.equal(overview.oracle?.slug,'sashai-manual-origin-v0215-followup');
 assert.equal(overview.oracle?.oracleStatus,'completed');
 assert.equal(overview.independentlyObservedAnswer,true);
 assert.equal(overview.taskState,'unverified');
 assert.equal(Object.hasOwn(overview.oracle,'expectedAnswer'),false);
 const chat=await observeSashaiConversation(url);
 assert.equal(chat.turnState,'turn_finished');
 assert.equal(chat.userTurns,2);
 assert.equal(chat.assistantTurns,2);
 assert.equal(chat.lastAssistant.trim(),expected);
});
