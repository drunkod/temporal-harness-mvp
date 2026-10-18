/** Disk-backed exact-run source cursor. The initial checkpoint must be
 * explicitly seeded from the upstream reader before the follower starts.
 * Never promote a historical snapshot to a live event automatically.
 */
import {createHash,randomUUID} from 'node:crypto';
import {open,mkdir,readFile,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {dirname,isAbsolute,resolve} from 'node:path';
import type {SourceCursorStore} from './flowdeck-autonomy-production-runtime.js';

type Scope={source:string;ownerId:string;deviceId:string;workflowId:string;runId:string};
type RecordV1={schema:'flowdeck.source-cursor/v1';scope:Scope;seedSha256:string;
 cursor:string|null;revision:number;seen:string[]};
const ident=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
const hash=(v:string|null)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fields=['schema','scope','seedSha256','cursor','revision','seen'];
const scopeFields=['source','ownerId','deviceId','workflowId','runId'];
function scopeKey(s:Scope){
 if(!s||scopeFields.some(k=>!ident.test((s as unknown as Record<string,string>)[k]??''))||
    JSON.stringify(Object.keys(s).sort())!==JSON.stringify([...scopeFields].sort()))
  throw Error('source cursor run/source identity invalid');
 return JSON.stringify(s);
}
function cursorValue(s:string|null){
 if(s!==null&&(typeof s!=='string'||s.length<1||Buffer.byteLength(s,'utf8')>8192))
  throw Error('upstream cursor token invalid');
 return s;
}
function strict(v:unknown):RecordV1 {
 const r=v as RecordV1;
 if(!r||typeof r!=='object'||Array.isArray(r)||
    JSON.stringify(Object.keys(r).sort())!==JSON.stringify([...fields].sort())||
    r.schema!=='flowdeck.source-cursor/v1'||!r.scope)throw Error('source cursor checkpoint malformed');
 scopeKey(r.scope);cursorValue(r.cursor);
 if(!/^[a-f0-9]{64}$/.test(r.seedSha256)||!Number.isSafeInteger(r.revision)||r.revision<0||
    !Array.isArray(r.seen)||r.seen.length!==r.revision+1||r.revision>20000||
    r.seen.some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))||
    new Set(r.seen).size!==r.seen.length||r.seen[r.seen.length-1]!==hash(r.cursor))
  throw Error('source cursor checkpoint revision/chain invalid');
 return r;
}
export function createProductionSourceCursorStore(path:string):SourceCursorStore&{
 initializeExact(scope:Scope,seed:string|null):Promise<void>;
}{
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)
  throw Error('source cursor file must use an absolute path');
 const directory=dirname(path),lockPath=path+'.write-lock';
 let bound:string|null=null,knownRevision:number|null=null;
 async function read():Promise<RecordV1>{
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||await realpath(path)!==path)
   throw Error('source cursor checkpoint file identity changed: quarantine');
  return strict(JSON.parse(await readFile(path,'utf8')));
 }
 async function checked(scope:Scope){
  const key=scopeKey(scope),row=await read();
  if(scopeKey(row.scope)!==key)throw Error('source cursor is pinned to a different run/source');
  return row;
 }
 async function syncDirectory(){
  const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
 }
 async function withLock<T>(task:()=>Promise<T>):Promise<T>{
  const l=await open(lockPath,'wx',0o600).catch(error=>{
   if((error as NodeJS.ErrnoException)?.code==='EEXIST')throw Error('source cursor concurrent/stale writer: quarantine');
   throw error;
  });
  try{return await task();}
  finally{await l.close();await unlink(lockPath);await syncDirectory();}
 }
 return {
  async initializeExact(scope,seed){
   scopeKey(scope);cursorValue(seed);
   await mkdir(directory,{recursive:true,mode:0o700});
   await withLock(async()=>{
    const row:RecordV1={schema:'flowdeck.source-cursor/v1',scope,seedSha256:hash(seed),
     cursor:seed,revision:0,seen:[hash(seed)]};
    let f;
    try{
     f=await open(path,'wx',0o600);
     await f.writeFile(JSON.stringify(row)+'\n');await f.sync();await f.close();f=undefined;
     await syncDirectory();
    }catch(error:any){
     if(f)await f.close();
     if(error?.code!=='EEXIST')throw error;
     const existing=await checked(scope);
     if(existing.seedSha256!==row.seedSha256)
      throw Error('source cursor cannot be reseeded after registration');
    }
   });
  },
  async bindExact(scope){
   const key=scopeKey(scope);
   if(bound&&bound!==key)throw Error('source cursor store already bound to different run');
   const row=await checked(scope);
   bound=key;knownRevision=row.revision;
  },
  async readExact(scope){
   const key=scopeKey(scope);
   if(bound!==key)throw Error('source cursor must be bound before read');
   const row=await checked(scope);
   knownRevision=row.revision;
   return{cursor:row.cursor};
  },
  async advanceExact(scope,next){
   const key=scopeKey(scope);cursorValue(next);
   if(next===null||bound!==key||knownRevision===null)
    throw Error('source cursor advance requires bound run and nonempty token');
   await withLock(async()=>{
    const row=await checked(scope);
    if(row.revision!==knownRevision)throw Error('source cursor checkpoint changed between read and admission');
    const h=hash(next);
    if(row.seen.includes(h))throw Error('upstream source cursor was reused or rolled back');
    if(row.revision>=20000)throw Error('source cursor bounded advancement exhausted: quarantine');
    const updated:RecordV1={...row,cursor:next,revision:row.revision+1,seen:[...row.seen,h]};
    const temp=path+'.tmp-'+randomUUID();
    const f=await open(temp,'wx',0o600);
    try{await f.writeFile(JSON.stringify(updated)+'\n');await f.sync();}finally{await f.close();}
    // Replacement is atomic. A crash leaves only a temp file; no premature ACK.
    await rename(temp,path);await syncDirectory();knownRevision=updated.revision;
   });
  },
 };
}
