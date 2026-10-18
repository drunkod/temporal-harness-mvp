import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,rm,writeFile,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductionSourceCursorStore} from '../dist/flowdeck-autonomy-production-cursor.js';

const scope={source:'remote-mcp-jazz',ownerId:'owner-exact-001',deviceId:'device-exact-001',
 workflowId:'workflow-exact-001',runId:'run-exact-001'};
async function fixture(t){
 const root=await mkdtemp(join(await realpath(tmpdir()),'flowdeck-cursor-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const path=join(root,'source-cursor.json');
 return {path,store:createProductionSourceCursorStore(path)};
}

test('explicitly seeded source cursor survives restart and rejects rollback/reseeding',async t=>{
 const {path,store}=await fixture(t);
 await assert.rejects(store.bindExact(scope),{code:'ENOENT'});
 await store.initializeExact(scope,'upstream-head-001');
 await store.bindExact(scope);
 assert.deepEqual(await store.readExact(scope),{cursor:'upstream-head-001'});
 await store.advanceExact(scope,'upstream-event-002');
 assert.deepEqual(await store.readExact(scope),{cursor:'upstream-event-002'});
 const restarted=createProductionSourceCursorStore(path);
 await restarted.initializeExact(scope,'upstream-head-001');
 await restarted.bindExact(scope);
 assert.deepEqual(await restarted.readExact(scope),{cursor:'upstream-event-002'});
 await restarted.advanceExact(scope,'upstream-event-003');
 assert.deepEqual(await restarted.readExact(scope),{cursor:'upstream-event-003'});
 await assert.rejects(restarted.advanceExact(scope,'upstream-event-002'),/reused or rolled back/);
 await assert.rejects(restarted.initializeExact(scope,'new-head-999'),/cannot be reseeded/);
 const row=JSON.parse(await readFile(path,'utf8'));
 assert.equal(row.revision,2);
 assert.equal(row.seen.length,3);
 assert.equal(row.cursor,'upstream-event-003');
});

test('source cursor different workflow/source or an unbound writer cannot reuse checkpoint',async t=>{
 const {path,store}=await fixture(t);
 await store.initializeExact(scope,null);
 const wrong={...scope,runId:'different-run-001'};
 await assert.rejects(store.bindExact(wrong),/pinned to a different/);
 await assert.rejects(store.advanceExact(scope,'cursor-one'),/requires bound run/);
 await store.bindExact(scope);
 await assert.rejects(store.readExact(wrong),/must be bound/);
 await store.readExact(scope);
 await store.advanceExact(scope,'cursor-one');
 const other=createProductionSourceCursorStore(path);
 await assert.rejects(other.initializeExact({...scope,source:'another-source-001'},null),/different run\/source/);
});

test('two checkpoint writers cannot silently overwrite each other',async t=>{
 const {path,store:a}=await fixture(t);
 await a.initializeExact(scope,null);await a.bindExact(scope);await a.readExact(scope);
 const b=createProductionSourceCursorStore(path);
 await b.bindExact(scope);await b.readExact(scope);
 await a.advanceExact(scope,'cursor-one');
 await assert.rejects(b.advanceExact(scope,'cursor-two'),/changed between read and admission/);
 assert.deepEqual(await a.readExact(scope),{cursor:'cursor-one'});
});

test('malformed and hard-linked source cursor remains quarantined',async t=>{
 const {path,store}=await fixture(t);
 await store.initializeExact(scope,null);
 const raw=JSON.parse(await readFile(path,'utf8'));
 raw.revision=1;
 await writeFile(path,JSON.stringify(raw));
 await assert.rejects(store.bindExact(scope),/revision\/chain invalid/);
 const {path:otherPath,store:other}=await fixture(t);
 await other.initializeExact(scope,null);
 await link(otherPath,otherPath+'.hard');
 await assert.rejects(other.bindExact(scope),/file identity changed/);
});
