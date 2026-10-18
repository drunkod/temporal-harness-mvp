import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductionFollowerOwnership} from '../dist/flowdeck-autonomy-production-ownership.js';
import {createProductionSourceCursorStore} from '../dist/flowdeck-autonomy-production-cursor.js';
import {createProductionSourceFollower} from '../dist/flowdeck-autonomy-production-runtime.js';

const scope={source:'remote-mcp-jazz',ownerId:'owner-exact-01',deviceId:'device-exact-01',
 workflowId:'workflow-exact-01',runId:'run-exact-01'};
async function rootFor(t){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'flowdeck-owner-test-')));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return dir;
}
test('persistent exclusive follower ownership refuses concurrent owner and releases after exact drain',async t=>{
 const dir=await rootFor(t),path=join(dir,'source-owner.json');
 const a=createProductionFollowerOwnership(path),b=createProductionFollowerOwnership(path);
 const lease=await a.acquireExact(scope);
 await lease.assertHeldExact();
 await assert.rejects(b.acquireExact(scope),/predecessor ownership unproven/);
 await lease.releaseExact();
 await assert.rejects(lease.assertHeldExact(),/already released/);
 const next=await b.acquireExact(scope);await next.assertHeldExact();await next.releaseExact();
});
test('stale ownership is not silently adopted, and substituted evidence is never released',async t=>{
 const dir=await rootFor(t),path=join(dir,'source-owner.json');
 const a=createProductionFollowerOwnership(path),b=createProductionFollowerOwnership(path);
 const lease=await a.acquireExact(scope);
 await writeFile(path,JSON.stringify({schema:'tampered'})+'\n');
 await assert.rejects(lease.assertHeldExact(),/changed/);
 await assert.rejects(lease.releaseExact(),/changed/);
 await assert.rejects(b.acquireExact(scope),/predecessor ownership unproven/);
 assert.match(await readFile(path,'utf8'),/tampered/);
});
test('owned follower holds exclusion through admission and checkpoint, releasing only after drain',async t=>{
 const dir=await rootFor(t),path=join(dir,'owner.json'),cursorPath=join(dir,'cursor.json');
 const ownership=createProductionFollowerOwnership(path);
 const cursor=createProductionSourceCursorStore(cursorPath);
 await cursor.initializeExact(scope,'seed-001');
 let ingestStarted,releaseIngest,followStarted,stopFollow;
 const entered=new Promise(r=>{ingestStarted=r});
 const resume=new Promise(r=>{releaseIngest=r});
 const following=new Promise(r=>{followStarted=r});
 const source={async catchUp(){return {complete:true,events:[{
  event:{source:scope.source,ownerId:scope.ownerId,deviceId:scope.deviceId,eventId:'event-001'},
  cursor:'event-cursor-002'}]}},
  async *follow({signal}){followStarted();await new Promise(r=>{
   stopFollow=r;signal.addEventListener('abort',r,{once:true})})}
 };
 const inbox={ingest:async()=>{ingestStarted();await resume;return {disposition:'accepted'}},
  retryPending:async()=>({pending:0,blocked:0}),status:async()=>({pending:0,events:{}})};
 const actor=createProductionSourceFollower({source,inbox,cursor,ownership,signalExact:async()=>{}});
 const start=actor.startOrAdoptExact({workflowId:scope.workflowId,runId:scope.runId},
  {source:scope.source,ownerId:scope.ownerId,deviceId:scope.deviceId});
 await entered;
 await assert.rejects(createProductionFollowerOwnership(path).acquireExact(scope),/predecessor ownership unproven/);
 releaseIngest();await start;await following;
 await assert.rejects(createProductionFollowerOwnership(path).acquireExact(scope),/predecessor ownership unproven/);
 await actor.stopAndDrain();
 const restarted=createProductionSourceCursorStore(cursorPath);await restarted.bindExact(scope);
 assert.deepEqual(await restarted.readExact(scope),{cursor:'event-cursor-002'});
 const next=await ownership.acquireExact(scope);await next.releaseExact();
});

test('ownership-release failure keeps follower unresponsive and refuses false shutdown certification',async()=>{
 let released=0;
 const ownership={acquireExact:async()=>({
  assertHeldExact:async()=>{},
  releaseExact:async()=>{released++;throw Error('ownership_release_unproven');}
 })};
 const source={catchUp:async()=>({complete:true,events:[]}),
  async *follow({signal}){await new Promise(r=>signal.addEventListener('abort',r,{once:true}));}};
 const inbox={ingest:async()=>({disposition:'accepted'}),
  retryPending:async()=>({pending:0,blocked:0}),status:async()=>({pending:0,events:{}})};
 const cursor={bindExact:async()=>{},readExact:async()=>({cursor:null}),advanceExact:async()=>{}};
 const actor=createProductionSourceFollower({source,inbox,cursor,ownership,signalExact:async()=>{}});
 const target={workflowId:scope.workflowId,runId:scope.runId};
 const identity={source:scope.source,ownerId:scope.ownerId,deviceId:scope.deviceId};
 await actor.startOrAdoptExact(target,identity);
 await assert.rejects(actor.stopAndDrain(),/source_follower_shutdown_unproven:ownership_release_unproven/);
 assert.equal(released,1);
 assert.equal(await actor.status(),'unresponsive');
 await assert.rejects(actor.stopAndDrain(),/source_follower_shutdown_unproven/);
 await assert.rejects(actor.startOrAdoptExact(target,identity),/not proven running/);
});
test('upstream failure does not become a proved stop after later cancellation',async()=>{
 const ownership={acquireExact:async()=>({
  assertHeldExact:async()=>{},releaseExact:async()=>{}
 })};
 let entered;
 const reached=new Promise(r=>{entered=r;});
 const source={catchUp:async()=>({complete:true,events:[]}),
  async *follow(){entered();throw Error('source_contract_failed');}};
 const inbox={ingest:async()=>({disposition:'accepted'}),
  retryPending:async()=>({pending:0,blocked:0}),status:async()=>({pending:0,events:{}})};
 const cursor={bindExact:async()=>{},readExact:async()=>({cursor:null}),advanceExact:async()=>{}};
 const actor=createProductionSourceFollower({source,inbox,cursor,ownership,signalExact:async()=>{}});
 await actor.startOrAdoptExact({workflowId:scope.workflowId,runId:scope.runId},
  {source:scope.source,ownerId:scope.ownerId,deviceId:scope.deviceId});
 await reached;
 for(let n=0;n<20&&(await actor.status())!=='unresponsive';n++)
  await new Promise(r=>setTimeout(r,1));
 assert.equal(await actor.status(),'unresponsive');
 await assert.rejects(actor.stopAndDrain(),/source_follower_shutdown_unproven:source_contract_failed/);
 assert.equal(await actor.status(),'unresponsive');
});
