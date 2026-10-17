import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat,readFile,readlink} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';

const hash=(x: Buffer|string)=>createHash('sha256').update(x).digest('hex');
const git=(root:string,...args:string[])=>execFileSync('git',['-C',root,...args],{timeout:20000,maxBuffer:64*1024*1024});
const names=(v:Buffer)=>v.toString('utf8').split('\0').filter(Boolean);
export function normalizeComposerText(value:string):string {
  return value.normalize('NFC').replace(/\s+/gu,' ').trim();
}
export const FLOWDECK_CONNECTOR_LABEL = 'Probe RemoteMCP2';
export function composerPayloadFor(prompt:string):string {
  return normalizeComposerText(FLOWDECK_CONNECTOR_LABEL+' '+prompt);
}
export function composerPayloadMatches(actual:string,prompt:string):boolean {
  return normalizeComposerText(actual)===composerPayloadFor(prompt);
}
export interface TreeEvidence{
  version:2;head:string;statusSha256:string;unstagedDiffSha256:string;
  stagedDiffSha256:string;dirtyFileContentSha256:string;
  dirtyFileCount:number;fingerprintSha256:string;
}
/** Fail-closed Git state+actual worktree bytes for each modified/staged/untracked path.
 *  Historical attempts lacking this evidence cannot claim full untracked integrity.
 *  No untracked content or paths leave the local evidence store.
 */
export async function snapshotSashaiTree(repo='/Users/test/Documents/work/sashai'):Promise<TreeEvidence>{
 const root=resolve(repo);
 const head=git(root,'rev-parse','HEAD').toString('utf8').trim();
 const status=git(root,'status','--porcelain=v1','-z','--untracked-files=all');
 const unstaged=git(root,'diff','--binary');
 const staged=git(root,'diff','--cached','--binary');
 const dirty=new Set([
  ...names(git(root,'ls-files','-m','-z')),
  ...names(git(root,'ls-files','--others','--exclude-standard','-z')),
  ...names(git(root,'diff','--cached','--name-only','-z')),
 ]);
 const records:{path:string,type:string,sha256:string,size:number}[]=[];
 let total=0;
 for(const name of [...dirty].sort()) {
  if(name.startsWith('/') || name.split('/').includes('..') || !name)throw Error('Invalid Git dirty path');
  const file=join(root,name);
  const rel=relative(root,file);
  if(rel.startsWith('..'+sep)||rel==='..')throw Error('Dirty path outside repository');
  const st=await lstat(file).catch(e=>e?.code==='ENOENT'?null:Promise.reject(e));
  if(!st){records.push({path:name,type:'absent',sha256:'',size:0});continue;}
  if(st.isSymbolicLink()){
   const link=await readlink(file);
   records.push({path:name,type:'symlink',sha256:hash(link),size:Buffer.byteLength(link)});continue;
  }
  if(!st.isFile())throw Error('Unexpected non-file dirty path: '+name);
  if(st.size>128*1024*1024)throw Error('Dirty file exceeds safe fingerprint cap');
  total+=st.size;
  if(total>512*1024*1024)throw Error('Dirty snapshot exceeds 512 MB; refuse incomplete binding');
  const contents=await readFile(file);
  records.push({path:name,type:'file',sha256:hash(contents),size:contents.length});
 }
 const result={
  version:2 as const,head,statusSha256:hash(status),unstagedDiffSha256:hash(unstaged),
  stagedDiffSha256:hash(staged),dirtyFileContentSha256:hash(JSON.stringify(records)),
  dirtyFileCount:records.length
 };
 return {...result,fingerprintSha256:hash(JSON.stringify(result))};
}
