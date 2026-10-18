import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalSourceWorkReportReader,createInstalledSourceTail} from '../dist/flowdeck-autonomy-local-source.js';

const scope={ownerId:'owner-local-01',deviceId:'device-local-01',workId:'work-local-01'};
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'flowdeck-upstream-ledger-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(await realpath(dir),'source.sqlite'),db=new DatabaseSync(file);
 db.exec('CREATE TABLE control_work_reports (work_id TEXT PRIMARY KEY, owner_id TEXT, device_id TEXT, state TEXT, outcome TEXT, started_at INTEGER, reported_at INTEGER);CREATE TABLE control_work_notices (notice_id TEXT,kind TEXT,work_id TEXT,owner_id TEXT,device_id TEXT);');
 const start=1760781600000,report=1760781604000;
 db.prepare('INSERT INTO control_work_reports VALUES (?,?,?,?,?,?,?)')
   .run(scope.workId,scope.ownerId,scope.deviceId,'running',null,start,null);
 db.prepare('INSERT INTO control_work_notices VALUES (?,?,?,?,?)')
   .run('start-notice','work_started',scope.workId,scope.ownerId,scope.deviceId);
 return {file,db,start,report,close:()=>db.close()};
}
test('read-only installed source report is independent of delivered Flowdeck inbox flags',async t=>{
 const f=await fixture(t);t.after(f.close);
 const reader=createLocalSourceWorkReportReader(f.file,scope.ownerId,scope.deviceId);t.after(()=>reader.close());
 assert.deepEqual(await reader.readExact(scope),{
  ...scope,state:'running',outcome:null,
  startedAt:new Date(f.start).toISOString(),reportedAt:null,eventIds:{started:'start-notice'}
 });
 f.db.prepare('UPDATE control_work_reports SET state=?,outcome=?,reported_at=? WHERE work_id=?')
   .run('reported','partial',f.report,scope.workId);
 f.db.prepare('INSERT INTO control_work_notices VALUES (?,?,?,?,?)')
   .run('report-notice','work_reported',scope.workId,scope.ownerId,scope.deviceId);
 assert.deepEqual(await reader.readExact(scope),{
  ...scope,state:'reported',outcome:'partial',
  startedAt:new Date(f.start).toISOString(),reportedAt:new Date(f.report).toISOString(),
  eventIds:{started:'start-notice',reported:'report-notice'}
 });
 assert.equal(await reader.readExact({...scope,workId:'other-work-01'}),null);
});
test('query cannot change owner/device and source outcome/notice conflicts block',async t=>{
 const f=await fixture(t);t.after(f.close);
 const r=createLocalSourceWorkReportReader(f.file,scope.ownerId,scope.deviceId);t.after(()=>r.close());
 await assert.rejects(r.readExact({...scope,ownerId:'other-owner-01'}),/not pinned/);
 await assert.rejects(r.readExact({...scope,deviceId:'other-device-01'}),/not pinned/);
 f.db.prepare('UPDATE control_work_reports SET state=?,outcome=?,reported_at=? WHERE work_id=?')
   .run('reported','success',f.report,scope.workId);
 await assert.rejects(r.readExact(scope),/absent|conflicting notice/);
 f.db.prepare('INSERT INTO control_work_notices VALUES (?,?,?,?,?)')
   .run('report-one','work_reported',scope.workId,scope.ownerId,scope.deviceId);
 f.db.prepare('INSERT INTO control_work_notices VALUES (?,?,?,?,?)')
   .run('report-two','work_reported',scope.workId,scope.ownerId,scope.deviceId);
 await assert.rejects(r.readExact(scope),/duplicate|conflicting notice/);
});
test('read-only upstream reader refuses source file identity replacement and closed reader reuse',async t=>{
 const f=await fixture(t);t.after(f.close);
 const r=createLocalSourceWorkReportReader(f.file,scope.ownerId,scope.deviceId);
 const replacement=f.file+'.replacement';
 const other=new DatabaseSync(replacement);other.close();
 await rename(f.file,f.file+'.old');
 await rename(replacement,f.file);
 await assert.rejects(r.readExact(scope),/identity changed/);
 r.close();
 await assert.rejects(r.readExact(scope),/closed/);
});


const notice=(id)=>({schema:'remote-mcp.work-event/v1',source:'remote-mcp-jazz',eventId:id,
 ownerId:scope.ownerId,deviceId:scope.deviceId,origin:'event',workId:scope.workId,
 kind:'work_started',revision:1,sourceCommittedAt:'2026-10-18T00:00:00Z',
 startedAt:'2026-10-18T00:00:00Z',timestampEvidence:'recorded_in_source_transaction',
 completionEvidence:'none',executionVerified:false,backgroundProcesses:'unknown'});
test('source catch-up refuses unseeded historical notices rather than treating snapshots as live',async()=>{
 let reads=0;
 const reader={head:async()=> 'historical-head',read:async()=>{reads++;throw Error('must not read');},close:()=>{}};
 const source=createInstalledSourceTail(reader,{ownerId:scope.ownerId,deviceId:scope.deviceId});
 await assert.rejects(source.catchUp({after:null,signal:new AbortController().signal}),/unseeded upstream source cursor/);
 assert.equal(reads,0);
});
test('installed source streams one cursor per event with no gap through catch-up and follow',async()=>{
 let available=[notice('first')],reads=[];
 const reader={head:async()=>null,close:()=>{},async read(after,limit){
  reads.push([after,limit]);
  const index=after===null?0:after==='cursor-1'?1:2;
  return{schema:'remote-mcp.work-page/v1',gap:false,history:'best_effort',
   events:available.slice(index,index+1),
   nextCursor:index<available.length?'cursor-'+(index+1):after};
 }};
 const source=createInstalledSourceTail(reader,{ownerId:scope.ownerId,deviceId:scope.deviceId,pollMs:1});
 const abort=new AbortController();
 const snapshot=await source.catchUp({after:null,signal:abort.signal});
 assert.equal(snapshot.complete,true);
 assert.deepEqual(snapshot.events.map(x=>x.cursor),['cursor-1']);
 available.push(notice('second'));
 const iterator=source.follow({after:snapshot.events.at(-1).cursor,signal:abort.signal})[Symbol.asyncIterator]();
 const second=await iterator.next();
 assert.equal(second.value.event.eventId,'second');
 assert.equal(second.value.cursor,'cursor-2');
 abort.abort();await iterator.return();
 assert.deepEqual(reads.slice(0,3),[[null,1],['cursor-1',1],['cursor-1',1]]);
});
test('installed source quarantines gaps and a non-terminating catch-up bound',async()=>{
 const reader={head:async()=>null,close:()=>{},read:async()=>({schema:'remote-mcp.work-page/v1',events:[],nextCursor:null,gap:true,history:'best_effort'})};
 const source=createInstalledSourceTail(reader,{ownerId:scope.ownerId,deviceId:scope.deviceId});
 await assert.rejects(source.catchUp({after:null,signal:new AbortController().signal}),/gap/);
 let seq=0;
 const endless={head:async()=>null,close:()=>{},read:async()=>{seq++;return{
  schema:'remote-mcp.work-page/v1',events:[notice('id-'+seq)],nextCursor:'cursor-'+seq,gap:false,history:'best_effort'
 };}};
 const bounded=createInstalledSourceTail(endless,{ownerId:scope.ownerId,deviceId:scope.deviceId,maxCatchupEvents:2});
 await assert.rejects(bounded.catchUp({after:null,signal:new AbortController().signal}),/bound exceeded/);
 assert.equal(seq,2);
});
