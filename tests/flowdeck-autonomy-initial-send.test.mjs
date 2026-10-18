import test from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,rm,readFile}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{createAutonomousInitialJournal,submitAutonomousInitialOnce,reconcileAutonomousInitial}
 from'../dist/flowdeck-autonomy-initial-send.js';
const scope=()=>({campaignId:'campaign-1',runId:'run-new-1',projectId:'project-new-1',
 taskId:'task-1',tabId:'ABCDEF1234567890',projectUrl:'https://chatgpt.com/g/g-p-fixture/project',
 worktree:'/tmp/flowdeck-test',promptHash:'a'.repeat(64),policyDigest:'b'.repeat(64)});
async function setup(t){const root=await mkdtemp(join(tmpdir(),'flowdeck-init-send-'));t.after(()=>rm(root,{recursive:true,force:true}));return createAutonomousInitialJournal(root)}
function fake(overrides={}){let clicks=0;const trace=[];
 const adapter={checkFence:async()=>{trace.push('fence')},stage:async()=>{trace.push('stage')},
  verify:async()=>{trace.push('verify');return true},click:async()=>{trace.push('click');clicks++},...overrides};
 return{adapter,trace,get clicks(){return clicks}};
}
test('exactly one first submission with durable markers and independent reconciliation',async t=>{
 const j=await setup(t),s=scope(),f=fake();
 assert.deepEqual(await submitAutonomousInitialOnce(j,s,f.adapter),{status:'submitted_unreconciled'});
 assert.equal(f.clicks,1);assert.equal(await j.current(s),'submitted');
 assert.deepEqual(await reconcileAutonomousInitial(j,s,{matchedFirstTurn:false,reportedSession:true,conflict:false}),{status:'pending'});
 assert.equal(await j.current(s),'submitted');
 assert.deepEqual(await reconcileAutonomousInitial(j,s,{matchedFirstTurn:true,reportedSession:true,conflict:false}),{status:'reconciled'});
 assert.equal(await j.current(s),'reconciled');
 await assert.rejects(submitAutonomousInitialOnce(j,s,f.adapter),/already reserved/);
 assert.equal(f.clicks,1);
});
test('crash immediately before stage never permits replay of reserved initial Send',async t=>{
 const j=await setup(t),s=scope(),f=fake({stage:async()=>{throw Error('crash before stage')}});
 await assert.rejects(submitAutonomousInitialOnce(j,s,f.adapter),/crash before stage/);
 assert.equal(await j.current(s),'claimed');
 await assert.rejects(submitAutonomousInitialOnce(j,s,f.adapter),/already reserved/);
 assert.equal(f.clicks,0);
});
test('mismatched composer refuses before click marker; no blind retry',async t=>{
 const j=await setup(t),s=scope(),f=fake({verify:async()=>false});
 await assert.rejects(submitAutonomousInitialOnce(j,s,f.adapter),/composer or identity mismatch/);
 assert.equal(await j.current(s),'staged');assert.equal(f.clicks,0);
 await assert.rejects(submitAutonomousInitialOnce(j,s,f.adapter),/already reserved/);
});
test('crash after durable click_attempted marker never repeats the click',async t=>{
 const j=await setup(t),s=scope(),f=fake({click:async()=>{throw Error('lost acknowledgement')}});
 await assert.rejects(submitAutonomousInitialOnce(j,s,f.adapter),/lost acknowledgement/);
 assert.equal(await j.current(s),'click_attempted');
 await assert.rejects(submitAutonomousInitialOnce(j,s,f.adapter),/already reserved/);
 const bytes=await readFile(j.path(s,'click_attempted'),'utf8');
 assert.ok(bytes.includes('"phase":"click_attempted"'));
});
test('cancellation/fence fails closed before irreversible click boundary',async t=>{
 const j=await setup(t),s=scope();let checks=0,clicks=0;
 const f=fake({checkFence:async()=>{checks++;if(checks===4)throw Error('canceled')},
  click:async()=>{clicks++}});
 await assert.rejects(submitAutonomousInitialOnce(j,s,f.adapter),/canceled/);
 assert.equal(clicks,0);
 assert.equal(await j.current(s),'click_attempted');
 await assert.rejects(submitAutonomousInitialOnce(j,s,f.adapter),/already reserved/);
});
test('positive conflict refuses even after a submitted journal; missing session waits',async t=>{
 const j=await setup(t),s=scope(),f=fake();
 await submitAutonomousInitialOnce(j,s,f.adapter);
 await assert.rejects(reconcileAutonomousInitial(j,s,{matchedFirstTurn:true,reportedSession:true,conflict:true}),/conflicting/);
 assert.equal(await j.current(s),'submitted');
 await assert.rejects(reconcileAutonomousInitial(j,{...s,tabId:'FFFFFFFFFFFFFFFF'},
  {matchedFirstTurn:true,reportedSession:true,conflict:false}),/journal changed|not durably submitted|missing/);
});
test('journal refuses reordered, missing, or tampered phase files',async t=>{
 const j=await setup(t),s=scope();
 await j.reserve(s);
 await assert.rejects(j.next(s,'submitted'),/phase advanced/);
 assert.equal(await j.current(s),'claimed');
 await assert.rejects(j.reserve(s),/already reserved/);
});
