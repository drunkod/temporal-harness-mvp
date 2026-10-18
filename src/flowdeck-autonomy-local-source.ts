/** Authoritative RemoteMCP-Jazz work reports: read-only and independent of Flowdeck inbox.
 * This adapter NEVER creates a SQLite database, updates a source cursor or sends.
 */
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { SourceWorkReport, SourceWorkReportReader } from './flowdeck-autonomy-production-evidence.js';

const key=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,255}$/;
const timestamp=(value:unknown,label:string):string=>{
 const ms=Number(value);
 if(value===null||value===undefined||!Number.isSafeInteger(ms)||ms<0||ms>8_640_000_000_000_000)
  throw Error('upstream '+label+' timestamp is invalid');
 return new Date(ms).toISOString();
};

export interface LocalSourceReportReader extends SourceWorkReportReader { close():void }

/** Caller must separately establish exclusive live owner/worker/follower identity. */
export function createLocalSourceWorkReportReader(databasePath:string, ownerId:string, deviceId:string):LocalSourceReportReader {
 if(typeof databasePath!=='string'||!isAbsolute(databasePath)||resolve(databasePath)!==databasePath||
    typeof ownerId!=='string'||!key.test(ownerId)||typeof deviceId!=='string'||!key.test(deviceId))
  throw Error('upstream source path or fixed owner/device scope invalid');
 const st=lstatSync(databasePath);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||realpathSync(databasePath)!==databasePath)
  throw Error('upstream source must be a canonical private regular SQLite file');
 const generation=[st.dev,st.ino,st.birthtimeMs].join(':');
 const db=new DatabaseSync(databasePath,{readOnly:true});
 let closed=false;
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=0;');
  const reports=db.prepare('SELECT work_id,owner_id,device_id,state,outcome,started_at,reported_at FROM control_work_reports WHERE owner_id=? AND device_id=? AND work_id=? LIMIT 2');
  const notices=db.prepare('SELECT kind,notice_id FROM control_work_notices WHERE owner_id=? AND device_id=? AND work_id=? ORDER BY rowid LIMIT 3');
  const assertCurrent=()=>{
   if(closed)throw Error('upstream source reader is closed');
   const current=lstatSync(databasePath);
   if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||
      [current.dev,current.ino,current.birthtimeMs].join(':')!==generation)
    throw Error('upstream SQLite source identity changed: quarantine');
  };
  return {
   async readExact(query) {
    assertCurrent();
    if(!query||query.ownerId!==ownerId||query.deviceId!==deviceId||typeof query.workId!=='string'||!key.test(query.workId))
     throw Error('upstream report query is not pinned to exact owner/device/work');
    const rows=reports.all(ownerId,deviceId,query.workId) as Array<Record<string,any>>;
    if(rows.length===0)return null;
    if(rows.length!==1)throw Error('upstream work report has conflicting duplicates');
    const r=rows[0];
    if(r.work_id!==query.workId||r.owner_id!==ownerId||r.device_id!==deviceId||
       !['running','reported'].includes(r.state))
     throw Error('upstream work report scope or state invalid');
    if((r.state==='running'&&(r.outcome!==null||r.reported_at!==null))||
       (r.state==='reported'&&!['partial','success','failed'].includes(r.outcome)))
     throw Error('upstream work report state/outcome conflict');
    const startedAt=timestamp(r.started_at,'start');
    const reportedAt=r.reported_at===null?null:timestamp(r.reported_at,'report');
    if(r.state==='reported'&&(!reportedAt||reportedAt<startedAt))
     throw Error('upstream report timestamp missing or precedes start');
    const sourceNotices=notices.all(ownerId,deviceId,query.workId) as Array<{kind:string;notice_id:string}>;
    const starts=sourceNotices.filter(x=>x.kind==='work_started');
    const finished=sourceNotices.filter(x=>x.kind==='work_reported');
    if(sourceNotices.length!==(r.state==='reported'?2:1)||starts.length!==1||
       finished.length!==(r.state==='reported'?1:0)||
       sourceNotices.some(x=>typeof x.notice_id!=='string'||!x.notice_id))
     throw Error('upstream work report has absent/duplicate/conflicting notice identity');
    return {workId:query.workId,ownerId,deviceId,state:r.state,
      outcome:r.outcome as SourceWorkReport['outcome'],startedAt,reportedAt,
      eventIds:{started:starts[0].notice_id,...(finished.length?{reported:finished[0].notice_id}:{})}};
   },
   close(){if(!closed){closed=true;db.close();}}
  };
 }catch(error){db.close();throw error;}
}



// Inject the installed RemoteMCP-Jazz SqliteWorkEventReader. Importing its
// TypeScript module is a deployment concern, never a browser/send capability.
import type { ProductionWorkSource, LiveSourceEvent } from './flowdeck-autonomy-production-runtime.js';
import type { WorkEventV1 } from './flowdeck-work-events.js';

export interface InstalledSourceReader {
 head():Promise<string|null>;
 read(after:string|null,limit:number):Promise<{
  schema:string;events:WorkEventV1[];nextCursor:string|null;gap:boolean;history:string;
 }>;
 close():void;
}

/** Real ledger tail, no snapshot-to-live promotion and no skip between catch-up and follow. */
export function createInstalledSourceTail(
 reader:InstalledSourceReader,
 fixed:{ownerId:string;deviceId:string;maxCatchupEvents?:number;pollMs?:number},
):ProductionWorkSource {
 if(!reader||typeof reader.read!=='function'||typeof reader.head!=='function'||
    typeof reader.close!=='function'||!key.test(fixed?.ownerId??'')||!key.test(fixed?.deviceId??''))
  throw Error('installed upstream work-event reader or fixed scope missing');
 const max=fixed.maxCatchupEvents??5000,pollMs=fixed.pollMs??1000;
 if(!Number.isSafeInteger(max)||max<1||max>20000||!Number.isSafeInteger(pollMs)||pollMs<1||pollMs>10000)
  throw Error('source catch-up/poll bounds invalid');
 const readOne=async(after:string|null,signal:AbortSignal):Promise<LiveSourceEvent|null>=>{
  if(signal.aborted)throw Error('upstream source cancelled');
  const page=await reader.read(after,1);
  if(signal.aborted)throw Error('upstream source cancelled');
  if(!page||page.schema!=='remote-mcp.work-page/v1'||page.gap||page.history!=='best_effort'||
     !Array.isArray(page.events)||page.events.length>1)
   throw Error('upstream notice stream gap or unsupported page: quarantine');
  if(page.events.length===0){
   if(page.nextCursor!==after)throw Error('empty upstream page changed its cursor: quarantine');
   return null;
  }
  const event=page.events[0];
  if(event?.schema!=='remote-mcp.work-event/v1'||event.source!=='remote-mcp-jazz'||
     event.origin!=='event'||event.ownerId!==fixed.ownerId||event.deviceId!==fixed.deviceId||
     typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor===after)
   throw Error('upstream notice event/cursor changed source scope: quarantine');
  return {event,cursor:page.nextCursor};
 };
 const wait=(signal:AbortSignal)=>new Promise<void>(resolve=>{
  if(signal.aborted){resolve();return;}
  let timer:ReturnType<typeof setTimeout>;
  const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
  timer=setTimeout(done,pollMs);
  signal.addEventListener('abort',done,{once:true});
 });
 return {
  async catchUp({after,signal}){
   // A fresh scope must be explicitly seeded at the installed source head.
   // Otherwise replaying historical notices as live wakeups is unsafe.
   if(after===null){
    const head=await reader.head();
    if(signal.aborted)throw Error('upstream source cancelled');
    if(head!==null)throw Error('unseeded upstream source cursor: quarantine');
   }
   const events:LiveSourceEvent[]=[];
   let last=after;
   for(let i=0;i<max;i++){
    const row=await readOne(last,signal);
    if(!row)return{complete:true as const,events};
    events.push(row);last=row.cursor;
   }
   // The fixed upper bound refuses unproven readiness, even if the very
   // next read would return empty. No cursor in this batch is checkpointed.
   throw Error('source catch-up bound exceeded: quarantine');
  },
  async *follow({after,signal}){
   let last=after;
   while(!signal.aborted){
    const row=await readOne(last,signal);
    if(row){last=row.cursor;yield row;}
    else await wait(signal);
   }
  },
 };
}
