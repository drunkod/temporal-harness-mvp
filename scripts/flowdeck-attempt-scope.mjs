/** Single-host browser-owner fencing. This claim is intentionally NOT leased by PID.
 * An uncertain Temporal start can outlive its initiating process; never auto-clear.
 * An operator must independently reconcile all histories before a future reset.
 */
import {createHash} from 'node:crypto';
import {mkdir,open,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';

const part=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(value);
export function attemptScopePath(base,{deviceId,profile='helium-profile-4'}){
 if(!part(deviceId)||profile!=='helium-profile-4')throw Error('Invalid device/browser scope');
 const digest=createHash('sha256').update(JSON.stringify([deviceId,profile])).digest('hex');
 return join(resolve(base),'.state/flowdeck-supervisor','attempt-scope-'+digest+'.json');
}
export async function inspectAttemptScope(base,scope){
 const file=attemptScopePath(base,scope);
 const machineOwner=join(homedir(),'Library','Application Support','Flowdeck','autonomy-v1','browser-owner.lock');
 try{
  const record=JSON.parse(await readFile(machineOwner,'utf8'));
  if(record?.schema!=='flowdeck.browser-owner/v1')throw Error('Machine-wide Flowdeck browser-owner record is invalid; quarantine');
  return {occupied:true,path:machineOwner,record,writes:false};
 }catch(e){if(e?.code!=='ENOENT')throw e;}
 try{return {occupied:true,path:file,record:JSON.parse(await readFile(file,'utf8')),writes:false};}
 catch(e){if(e?.code==='ENOENT')return {occupied:false,path:file,writes:false};throw e;}
}
/** All send-capable historical Flowdeck workflows in this namespace are conservatively
 * treated as competing, including ones predating the new scope marker.
 * A visibility failure MUST block start rather than be interpreted as no contenders. */
export async function assertNoRunningFlowdeck(list){
 for await(const info of list({query:"ExecutionStatus = 'Running'"})){
  if(info?.status?.name==='RUNNING'&&
     (info.type==='flowdeckSupervisor'||info.type==='flowdeckRecoverSend'||
      (info.taskQueue==='flowdeck-supervisor'&&info.workflowId?.startsWith('flowdeck-supervisor-'))))
   throw Error('Existing running Flowdeck workflow occupies browser-owner scope; reconcile before starting another');
 }
}
export async function assertAttemptScopeOwner(base,scope){
 const existing=await inspectAttemptScope(base,scope);
 const record=existing.record;
 if(!existing.occupied||record?.schema!=='flowdeck.attempt-scope/v1'||
    record.workflowId!==scope.workflowId||record.projectId!==scope.projectId||
    record.ownerId!==scope.ownerId||record.deviceId!==scope.deviceId||
    record.profile!=='helium-profile-4')
   throw Error('Recovery release browser-owner scope is absent or belongs to another execution; audited reconciliation required');
 return record;
}
export async function claimAttemptScope(base,scope){
 if(!part(scope?.projectId)||!part(scope?.ownerId)||
    typeof scope?.workflowId!=='string'||!/^[-a-zA-Z0-9_]{1,220}$/.test(scope.workflowId)||
    !part(scope?.deviceId))throw Error('Invalid Flowdeck attempt identity');
 const path=attemptScopePath(base,scope);
 await mkdir(join(resolve(base),'.state/flowdeck-supervisor'),{recursive:true});
 const record={schema:'flowdeck.attempt-scope/v1',projectId:scope.projectId,
  ownerId:scope.ownerId,deviceId:scope.deviceId,profile:'helium-profile-4',
  workflowId:scope.workflowId,claimedAt:new Date().toISOString(),
  disposition:'unresolved_until_audited_reconciliation'};
 let file;
 try{file=await open(path,'wx',0o600);}
 catch(e){if(e?.code==='EEXIST')throw Error('Browser-owner scope already claimed; inspect exact attempt and reconcile before any new start');throw e;}
 try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync();}
 finally{await file.close();}
 // The exclusive claim remains on disk even if subsequent verification fails.
 const dir=await open(join(resolve(base),'.state/flowdeck-supervisor'),'r');
 try{await dir.sync();}finally{await dir.close();}
 return {path,record};
}
