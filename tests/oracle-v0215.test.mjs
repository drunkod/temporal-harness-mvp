import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const repo=resolve('.');
const local=join(repo,'.state','oracle-v0215');
const bin=join(local,'node_modules','.bin','oracle');
const state=join(homedir(),'.oracle','sessions');
const oldGlobal='/opt/homebrew/bin/oracle';

test('Oracle is pinned locally at 0.21.5 without modifying global Homebrew',async t=>{
  if(!existsSync(bin)){t.skip('Pristine Oracle not installed');return;}
  const a=spawnSync(bin,['--version'],{encoding:'utf8',timeout:10000});
  assert.equal(a.status,0);assert.equal(a.stdout.trim(),'0.21.5');
  const pkg=JSON.parse(await readFile(join(local,'node_modules','@steipete','oracle','package.json'),'utf8'));
  assert.equal(pkg.version,'0.21.5');
  if(existsSync(oldGlobal)){
    const b=spawnSync(oldGlobal,['--version'],{encoding:'utf8',timeout:10000});
    assert.equal(b.status,0);assert.equal(b.stdout.trim(),'0.21.3');
  }
});

test('first Oracle 0.21.5 Sashai chat and its followup both completed on same conversation',async t=>{
  const first=join(state,'sashai-pristine-v0215-smoke','meta.json');
  const follow=join(state,'sashai-pristine-v0215-followup','meta.json');
  if(!existsSync(first)||!existsSync(follow)){t.skip('Signed-in smoke session records unavailable');return;}
  const a=JSON.parse(await readFile(first,'utf8'));
  const b=JSON.parse(await readFile(follow,'utf8'));
  assert.equal(a.status,'completed');assert.equal(b.status,'completed');
  assert.equal(a.browser.runtime.promptSubmitted,true);assert.equal(b.browser.runtime.promptSubmitted,true);
  assert.equal(a.browser.runtime.conversationId,b.browser.runtime.conversationId);
  assert.match(a.browser.runtime.tabUrl,/^https:\/\/chatgpt\.com\/g\/g-p-6ab28bdd7fbc8191b581316ff09da79d[^/]*\/c\//);
  assert.equal(b.browser.runtime.tabUrl,a.browser.runtime.tabUrl);
  const firstAnswer=await readFile(join(repo,'.state','oracle-v0215-smoke','answer.txt'),'utf8');
  const secondAnswer=await readFile(join(repo,'.state','oracle-v0215-followup','answer.txt'),'utf8');
  assert.equal(firstAnswer.trim(),'SASHAI_ORACLE_0215_OK');
  assert.equal(secondAnswer.trim(),'SASHAI_ORACLE_0215_FOLLOWUP_OK');
});

test('new Oracle 0.21.5 selector sees exchange and assistant role in saved Sashai chat',async t=>{
  const mod=await import(join(local,'node_modules','@steipete','oracle','dist','src','browser','conversationTurns.js'));
  assert.match(mod.buildConversationTurnListExpression(),/data-turn-key/);
  const {sashaiOverview}=await import('../dist/sashai-observer.js');
  let observed;
  try {observed=await sashaiOverview();}
  catch(err){t.skip('Helium CDP unavailable: '+err.message);return;}
  if(observed.adopted?.conversationId==='6acfc4f3-2cdc-83eb-8e4a-c8a955ce7fb0' &&
     observed.observation?.browser==='attached_read_only'){
    assert.equal(observed.observation.userTurns,2);
    assert.equal(observed.observation.assistantTurns,2);
    assert.equal(observed.independentlyObservedAnswer,true);
    assert.equal(observed.oracle.oracleStatus,'completed');
    assert.equal(observed.taskState,'unverified');
  }
});
