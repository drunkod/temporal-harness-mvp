import test from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,rm,readFile,stat}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{createAutonomyCampaignStore}from'../dist/flowdeck-autonomy-campaign.js';
const p=()=>({campaignId:'new-campaign-fixture-001',maxCampaignRuns:2,maxCampaignSubmissions:6,
 maxSubmissionsPerRun:3,mode:'automatic-initial-send',schema:'flowdeck.autonomy-policy/v1'});
const seq=['initial_p1','continue_p1','initial_p2'];
async function setup(t){const root=await mkdtemp(join(tmpdir(),'flowdeck-autonomy-campaign-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const c=createAutonomyCampaignStore(root);const policy=p();await c.initialize(policy);
 return{c,policy,root};
}
test('campaign reserves exactly six nonrefundable attempts over two runs',async t=>{
 const {c,policy}=await setup(t);
 for(const run of ['run-01','run-02']){
  for(const kind of seq){const x=await c.reserve(policy,run,kind);
   assert.equal(x.reserved,true)}
 }
 assert.equal((await c.reservations(policy)).length,6);
 await assert.rejects(c.reserve(policy,'run-03','initial_p1'),/budget|sequence/);
 await assert.rejects(c.reserve(policy,'run-01','initial_p1'),/EEXIST/); // failed reservation leaves quarantine lock
});
test('out-of-order, repeated and third run are refused without replenishing',async t=>{
 const {c,policy}=await setup(t);
 await assert.rejects(c.reserve(policy,'run-1','initial_p2'),/sequence/);
 await assert.rejects(c.reserve(policy,'run-1','initial_p1'),/EEXIST/);
 // Strict quarantine: after a failed reservation, a durable mutation lock remains.
 assert.equal((await c.reservations(policy)).length,0);
});
test('changed standing policy cannot inspect or reserve existing campaign',async t=>{
 const {c,policy}=await setup(t);
 await assert.rejects(c.readPolicy({...policy,maxCampaignSubmissions:30}),/policy changed/);
 await assert.rejects(c.initialize(policy),/EEXIST/);
 assert.equal((await c.reservations(policy)).length,0);
});
test('campaign records never contain the raw prompt or cookies',async t=>{
 const {c,policy}=await setup(t);
 await c.reserve(policy,'run-1','initial_p1');
 const rows=await c.reservations(policy);
 assert.deepEqual(rows.map(x=>Object.keys(x).sort()),[['campaignId','kind','runId','schema']]);
});
