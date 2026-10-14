import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root=resolve('.');
const work=join(root,'.state','report-review-dispatch');
const attemptFile=join(work,'attempt.json');
const sha=x=>createHash('sha256').update(x).digest('hex');

test('report-specific browser dispatcher uses explicit report-only approval and one-send claim',async(t)=>{
 if(!existsSync(attemptFile)){t.skip('Report-specific browser task has not been prepared');return;}
 const a=JSON.parse(await readFile(attemptFile,'utf8'));
 const contract=await readFile(join(root,'docs','SASHAI-ARCHITECTURE-REVIEW-TASK.md'),'utf8');
 assert.equal(a.approval,'report-only');
 assert.equal(a.taskId,'sashai-architecture-report-2026-10-15');
 assert.equal(a.head,'7d2cc6818afe837119e0c171928506b1c4967269');
 assert.equal(a.taskContractSha256,sha(contract));
 assert.equal(a.destination,join(root,'docs','SASHAI-BROWSER-ARCHITECTURE-REVIEW-2026-10-15.md'));
 assert.match(a.conversationUrl||'',/^https:\/\/chatgpt\.com\/g\/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai\/c\//);
 assert.ok(['exact_prompt_marker','same_tab_project_and_revised_repository_evidence'].includes(a.bindingEvidence));
 assert.ok(existsSync(join(work,'SEND_ATTEMPTED')));
});

test('once submitted, report browser sender refuses repeat click before contacting CDP',async t=>{
 if(!existsSync(join(work,'SEND_ATTEMPTED'))){t.skip('No report task submitted');return;}
 const again=spawnSync(process.execPath,[join(root,'scripts','sashai-report-dispatch.mjs'),'send'],{cwd:root,encoding:'utf8',timeout:13000});
 assert.notEqual(again.status,0);
 assert.match(again.stderr,/SEND ALREADY ATTEMPTED/);
});

test('guarded task sender exposes no generic prompt or task dispatch command',async()=>{
 const text=await readFile(join(root,'scripts','sashai-report-dispatch.mjs'),'utf8');
 assert.match(text,/report-only/);
 assert.match(text,/taskContractSha256/);
 assert.match(text,/preflightStatusSha256/);
 assert.match(text,/SEND_ATTEMPTED/);
 assert.match(text,/Remote Desktop Commander/);
 assert.doesNotMatch(text,/--prompt|--task|--force|retry.*send/i);
});

test('report acceptance verifier remains read-only and persists checks separately',async()=>{
 const text=await readFile(join(root,'scripts','verify-sashai-browser-report.mjs'),'utf8');
 assert.match(text,/baselineUnchanged/);
 assert.match(text,/sourceHead/);
 assert.match(text,/mermaid/);
 assert.match(text,/acceptanceStatus/);
 assert.match(text,/taskContractSha256/);
});
