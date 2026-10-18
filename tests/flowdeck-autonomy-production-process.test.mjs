import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createSenderProcessFence,observeDarwinProcess} from '../dist/flowdeck-autonomy-production-process.js';

const digest=command=>createHash('sha256').update(command).digest('hex');
const identity={workflowId:'workflow-test-0001',runId:'run-test-0001',role:'worker',pid:12345};
const alive={state:'alive',startedAt:'Sun Oct 18 14:00:00 2026',commandSha256:digest('node worker-exact-run')};

test('durable predecessor fence proves only the exact registered process has ended',async t=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'flowdeck-process-fence-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'witness.json');let observation=alive;
 const fence=createSenderProcessFence(path,async pid=>{assert.equal(pid,identity.pid);return observation;});
 await assert.rejects(fence.assertStoppedExact(identity),{code:'ENOENT'});
 await fence.registerExact(identity);
 const record=JSON.parse(await readFile(path,'utf8'));
 assert.equal(record.schema,'flowdeck.sender-process-witness/v1');
 assert.equal(record.workflowId,identity.workflowId);
 assert.equal(record.commandSha256,alive.commandSha256);
 assert.equal(await fence.inspectExact(identity),'running');
 await assert.rejects(fence.assertStoppedExact(identity),/termination_unproven:running/);
 await fence.registerExact(identity);
 observation={...alive,startedAt:'Sun Oct 18 14:00:01 2026'};
 assert.equal(await fence.inspectExact(identity),'unresponsive','PID reuse cannot certify prior shutdown');
 await assert.rejects(fence.registerExact(identity),/differs from observed process/);
 observation={state:'unknown'};
 assert.equal(await fence.inspectExact(identity),'unresponsive');
 await assert.rejects(fence.assertStoppedExact(identity),/termination_unproven:unresponsive/);
 observation={state:'gone'};
 assert.equal(await fence.inspectExact(identity),'stopped');
 await fence.assertStoppedExact(identity);
 await assert.rejects(fence.assertStoppedExact({...identity,runId:'different-run-0001'}),/identity mismatch/);
 await assert.rejects(fence.assertStoppedExact({...identity,pid:12346}),/identity mismatch/);
});

test('unregistered, forged, unsafe or malformed process witness does not pass closeout',async t=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'flowdeck-witness-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'witness.json');
 const fence=createSenderProcessFence(path,async()=>({state:'gone'}));
 await assert.rejects(fence.registerExact(identity),/could not be independently identified/);
 await assert.rejects(fence.assertStoppedExact(identity),{code:'ENOENT'});
 const bad={schema:'flowdeck.sender-process-witness/v1',...identity,startedAt:alive.startedAt,commandSha256:alive.commandSha256,extra:true};
 await writeFile(path,JSON.stringify(bad));
 await assert.rejects(fence.assertStoppedExact(identity),/malformed/);
 await assert.rejects(fence.registerExact({...identity,pid:0}),/identity invalid/);
 assert.throws(()=>createSenderProcessFence('relative/witness'),/absolute path/);
});

test('Darwin observer sees the current process as alive and never mistakes unknown visibility for gone',async()=>{
 if(process.platform!=='darwin')return;
 const self=await observeDarwinProcess(process.pid);
 assert.equal(self.state,'alive');
 assert.match(self.commandSha256,/^[a-f0-9]{64}$/);
 assert.ok(self.startedAt);
 const absent=await observeDarwinProcess(2_147_483_647);
 assert.equal(absent.state,'gone');
});
