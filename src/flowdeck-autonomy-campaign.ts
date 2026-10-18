/** Machine-root campaign reservations; no budget is refunded after uncertain effects.
 * A stale mutation lock blocks another reservation until separately audited.
 */
import{mkdir,open,readFile,readdir,rm}from'node:fs/promises';
import{resolve,join}from'node:path';
import{homedir}from'node:os';
import{sha256}from'./flowdeck-autonomy-policy.js';
import type{AutonomyPolicyV1,AutonomousDispatch}from'./flowdeck-autonomy-policy.js';
import{autonomyPolicyDigest}from'./flowdeck-autonomy-policy.js';

export const defaultAutonomyStateRoot=()=>join(homedir(),'Library','Application Support','Flowdeck','autonomy-v1');
const series:AutonomousDispatch[]=['initial_p1','continue_p1','initial_p2'];
const simple=/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/;
export function createAutonomyCampaignStore(root=defaultAutonomyStateRoot()){
 const base=resolve(root);
 const folder=(id:string)=>{if(!simple.test(id))throw Error('invalid campaign identifier');return join(base,sha256(id))};
 const durable=async(path:string,value:unknown)=>{
  const f=await open(path,'wx',0o600);
  try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync()}finally{await f.close()}
  const dir=await open(resolve(path,'..'),'r');try{await dir.sync()}finally{await dir.close()}
 };
 async function initialize(p:AutonomyPolicyV1){
  const dir=folder(p.campaignId);await mkdir(base,{recursive:true,mode:0o700});
  // mkdir is atomic. Existing campaign never silently creates another budget.
  await mkdir(dir,{mode:0o700});
  await durable(join(dir,'policy.json'),{schema:'flowdeck.campaign/v1',campaignId:p.campaignId,
   digest:autonomyPolicyDigest(p),maxRuns:p.maxCampaignRuns,maxSends:p.maxCampaignSubmissions});
  return dir;
 }
 async function readPolicy(p:AutonomyPolicyV1){
  const dir=folder(p.campaignId),v=JSON.parse(await readFile(join(dir,'policy.json'),'utf8'));
  if(v.schema!=='flowdeck.campaign/v1'||v.digest!==autonomyPolicyDigest(p)||
   v.campaignId!==p.campaignId||v.maxRuns!==2||v.maxSends!==6)
   throw Error('campaign policy changed: quarantine');
  return dir;
 }
 async function reservations(p:AutonomyPolicyV1){
  const dir=await readPolicy(p),names=(await readdir(dir)).filter(n=>n.startsWith('attempt-'));
  const records=[];
  for(const name of names){
   if(!/^attempt-[a-f0-9]{64}\.json$/.test(name))throw Error('ambiguous campaign reservation');
   const v=JSON.parse(await readFile(join(dir,name),'utf8'));
   if(v.schema!=='flowdeck.campaign-send-attempt/v1'||v.campaignId!==p.campaignId||
    !simple.test(v.runId)||!series.includes(v.kind)||
    name!=='attempt-'+sha256(JSON.stringify([v.runId,v.kind]))+'.json')
    throw Error('campaign reservation changed: quarantine');
   records.push(v);
  }
  return records;
 }
 async function reserve(p:AutonomyPolicyV1,runId:string,kind:AutonomousDispatch){
  if(!simple.test(runId)||!series.includes(kind))throw Error('invalid run/send identity');
  const dir=await readPolicy(p),mutation=join(dir,'reservation-mutation.lock');
  // Only one reservation writer, across all checkouts sharing the machine root.
  const guard=await open(mutation,'wx',0o600);
  let done=false;
  try{
   await guard.writeFile(JSON.stringify({runId,kind})+'\n');await guard.sync();
   const records=await reservations(p);
   const uniqueRuns=new Set(records.map(x=>x.runId));
   const current=records.filter(x=>x.runId===runId).map(x=>x.kind);
   if(records.length>=p.maxCampaignSubmissions||(!uniqueRuns.has(runId)&&uniqueRuns.size>=p.maxCampaignRuns)||
      current.length>=p.maxSubmissionsPerRun||current.includes(kind)||
      series[current.length]!==kind)
    throw Error('campaign or run budget exhausted/sequence invalid: quarantine');
   const marker=join(dir,'attempt-'+sha256(JSON.stringify([runId,kind]))+'.json');
   await durable(marker,{schema:'flowdeck.campaign-send-attempt/v1',campaignId:p.campaignId,runId,kind});
   done=true;return{reserved:true,spent:records.length+1,remaining:p.maxCampaignSubmissions-records.length-1};
  }finally{
   await guard.close();
   // An ambiguous failure leaves the mutex for investigation: no second writer.
   if(done)await rm(mutation);
  }
 }
 return{initialize,readPolicy,reservations,reserve};
}
