import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readReportReviewStatus, browserReportPath} from '../dist/sashai-report-status.js';

const root=resolve('.');
test('read-only report task has independent verification separate from product-task state',async t=>{
 if(!existsSync(browserReportPath)){t.skip('Live browser report unavailable');return;}
 const report=await readReportReviewStatus();
 assert.equal(report?.taskId,'sashai-architecture-report-2026-10-15');
 assert.equal(report?.status,'verified_report');
 assert.equal(report?.approval,'report-only');
 assert.equal(report?.reportReady,true);
 assert.equal(report?.reportUrl,'/api/sashai/report');
 assert.equal(report?.separateFromProductTask,true);
 assert.match(report?.conversationUrl||'',/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai\/c\//);
});

test('dashboard serves only verified report markdown on fixed read-only URL',async t=>{
 if(!existsSync(browserReportPath)){t.skip('No generated report');return;}
 let response;
 try{response=await fetch('http://127.0.0.1:4319/api/sashai/report');}
 catch(e){t.skip('Flowdeck unavailable: '+e.message);return;}
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type')||'',/text\/markdown/);
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 const body=await response.text();
 assert.match(body,/7d2cc6818afe837119e0c171928506b1c4967269/);
 assert.ok((body.match(/~~~mermaid/g)||[]).length>=2);
 const overview=await(await fetch('http://127.0.0.1:4319/api/sashai/status')).json();
 assert.equal(overview.taskSource?.status,'no_active_plan');
 assert.equal(overview.taskSource?.dispatchAllowed,false);
 assert.equal(overview.taskState,'unverified');
 assert.equal(overview.reportTask?.status,'verified_report');
});

test('diagram repair transport guard refuses a repeated correction send',async t=>{
 const guard=join(root,'.state','report-review-dispatch','FIX_SEND_ATTEMPTED');
 if(!existsSync(guard)){t.skip('Correction not sent');return;}
 const p=spawnSync(process.execPath,[join(root,'scripts','sashai-report-fix.mjs'),'send'],{
  encoding:'utf8',timeout:10000,cwd:root
 });
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/FIX ALREADY ATTEMPTED/);
});
