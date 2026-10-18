/** Cross-process lifetime ownership for one source follower. Never steals a stale
 * claim: recovery requires independent proof of predecessor termination.
 * Per-cursor write locks alone do not serialize event admission.
 */
import {randomUUID} from 'node:crypto';
import {mkdir,open,lstat,readFile,realpath,unlink} from 'node:fs/promises';
import {dirname,isAbsolute,resolve} from 'node:path';

export type FollowerScope={source:string;ownerId:string;deviceId:string;workflowId:string;runId:string};
export interface FollowerLease {
 assertHeldExact():Promise<void>;
 releaseExact():Promise<void>;
}
export interface FollowerOwnership {
 acquireExact(scope:FollowerScope):Promise<FollowerLease>;
}
const ident=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
const fields=['source','ownerId','deviceId','workflowId','runId'];
function valid(scope:FollowerScope) {
 if(!scope||JSON.stringify(Object.keys(scope).sort())!==JSON.stringify([...fields].sort())||
    fields.some(k=>!ident.test((scope as unknown as Record<string,string>)[k]??'')))
  throw Error('source follower ownership scope invalid');
}
export function createProductionFollowerOwnership(path:string):FollowerOwnership {
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)
  throw Error('source follower ownership path must be absolute');
 const dir=dirname(path);
 async function syncDirectory(){
  const handle=await open(dir,'r');try{await handle.sync();}finally{await handle.close();}
 }
 return {
  async acquireExact(scope){
   valid(scope);
   await mkdir(dir,{recursive:true,mode:0o700});
   if(await realpath(dir)!==dir)throw Error('source follower ownership parent is not canonical');
   const row=JSON.stringify({schema:'flowdeck.follower-owner/v1',scope,
    token:randomUUID(),pid:process.pid});
   let file;
   try {
    file=await open(path,'wx',0o600);
   } catch(error:any) {
    if(error?.code==='EEXIST')throw Error('source follower predecessor ownership unproven: quarantine');
    throw error;
   }
   const identity=await file.stat();
   try{await file.writeFile(row+'\n');await file.sync();}
   finally{await file.close();}
   await syncDirectory();
   let released=false;
   async function assertHeldExact(){
    if(released)throw Error('source follower ownership already released');
    const before=await lstat(path);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
       before.dev!==identity.dev||before.ino!==identity.ino||
       await realpath(path)!==path||await readFile(path,'utf8')!==row+'\n')
      throw Error('source follower ownership changed: quarantine');
    const after=await lstat(path);
    if(after.dev!==identity.dev||after.ino!==identity.ino)
      throw Error('source follower ownership changed during inspection: quarantine');
   }
   return {
    assertHeldExact,
    async releaseExact(){
     await assertHeldExact(); // only the exact currently held owner can release
     await unlink(path);await syncDirectory();released=true;
    }
   };
  }
 };
}
