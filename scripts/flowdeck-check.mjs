#!/usr/bin/env node
/** Noninteractive, fail-closed Flowdeck acceptance runner.
 * Offline by default; never promotes any check to a live sender.
 */
import{spawn}from'node:child_process';
import{readFile,writeFile,mkdir}from'node:fs/promises';
import{randomUUID}from'node:crypto';
import{createHash}from'node:crypto';
import{join,resolve,isAbsolute}from'node:path';
import{pathToFileURL}from'node:url';
const root=resolve(import.meta.dirname,'..');
const hash=b=>createHash('sha256').update(b).digest('hex');
/** Test-only endpoint, deliberately not the normal local production port. */
export async function verifySyntheticTemporalSafety({
 address=process.env.FLOWDECK_TEST_TEMPORAL_ADDRESS,
 attested=process.env.FLOWDECK_TEST_TEMPORAL_ISOLATED==='1',
 connect=async target=>{
  const {Connection}=await import('@temporalio/client');
  const conn=await Connection.connect({address:target,connectTimeout:'5 seconds'});
  try{await conn.workflowService.getSystemInfo({});}finally{await conn.close();}
 }}={}){
 if(typeof address!=='string'||!/^127\.0\.0\.1:(\d{2,5})$/.test(address)||
    Number(address.split(':')[1])===7233||Number(address.split(':')[1])>65535)
  throw new CheckError('synthetic_test_only_temporal_address_required');
 if(attested!==true)
  throw new CheckError('synthetic_isolated_server_attestation_required');
 try{await connect(address);}catch{throw new CheckError('synthetic_temporal_server_unavailable');}
 return address;
}
async function artifactIdentity(){
 const digests={};
 for(const [label,path] of Object.entries({
  source:'src/flowdeck-autonomy-production-runtime.ts',
  workflow:'dist/flowdeck-autonomous-workflow.js',
  runner:'scripts/flowdeck-check.mjs',
  dependencies:'package-lock.json'})){
  try{digests[label+'Sha256']=hash(await readFile(join(root,path)));}
  catch{digests[label+'Sha256']=null;}
 }
 return digests;
}
function testTally(output){
 const number=field=>{const m=output.match(new RegExp('(?:^|\\n)(?:#|ℹ) '+field+' (\\d+)(?:\\r?\\n|$)'));return m?Number(m[1]):null;};
 return {executed:number('tests'),passed:number('pass'),skipped:number('skipped'),failed:number('fail')};
}
export class CheckError extends Error{constructor(reason,code=2){super(reason);this.code=code}}
export function parseCheckArgs(args){
 const x={profile:'offline',nonInteractive:false,policy:null};
 const rest=[...args];while(rest.length){
  const arg=rest.shift();
  if(arg==='--non-interactive')x.nonInteractive=true;
  else if(arg==='--profile'&&rest.length)x.profile=rest.shift();
  else if(arg==='--policy'&&rest.length)x.policy=rest.shift();
  else throw new CheckError('unknown_or_missing_argument');
 }
 if(!['offline','synthetic','browser-no-send','live'].includes(x.profile))
  throw new CheckError('unsupported_test_profile');
 if(!x.nonInteractive)throw new CheckError('non_interactive_required');
 if((x.profile==='live'||x.profile==='browser-no-send')&&!x.policy)
  throw new CheckError('scoped_policy_required');
 return x;
}
function summary(value){return typeof value==='string'?value.slice(-1800):''}
export async function checkPolicy(path,{read=readFile,
 load=async()=>import('../dist/flowdeck-autonomy-policy.js'),
 loadProject=async()=>import('../dist/flowdeck-projects.js'),
 inspect=async()=>import('../dist/sashai-task-source.js')}={}){
 if(!path||!isAbsolute(path))throw new CheckError('policy_path_must_be_absolute');
 const p=JSON.parse(await read(path,'utf8'));
 const module=await load();
 const policy=module.validateAutonomyPolicy(p);
 // The Project loader checks current approved task enrollment and active-plan
 // source authority. No browser-capable check runs from policy claims alone.
 const project=await(await loadProject()).loadSupervisorProject(policy.projectId);
 const gate=await(await inspect()).inspectSashaiTaskSource(project.repo);
 if(gate.status!=='approved_plan_has_pending_tasks'||gate.planSha256!==policy.planSha256)
  throw new CheckError('approved_plan_changed_or_missing');
 module.validateAutonomyPolicy(policy,project,undefined);
 return{policy,hash:module.autonomyPolicyDigest(policy)};
}
/** A real browser check may stage a draft. Block unless the checkout scope is
 * unoccupied AND Temporal confirms there are no competing send-capable flows.
 * A visibility error is never interpreted as an empty system.
 */
export async function verifyBrowserNoSendSafety(policy,{base=root}={}){
 const {inspectAttemptScope,assertNoRunningFlowdeck}=await import('./flowdeck-attempt-scope.mjs');
 const s=await inspectAttemptScope(base,{deviceId:policy.deviceId});
 if(s.occupied)throw new CheckError('browser_owner_scope_occupied');
 const {Connection,Client}=await import('@temporalio/client');
 let connection;
 try{
  connection=await Connection.connect({address:'127.0.0.1:7233',connectTimeout:'5 seconds'});
  const client=new Client({connection,namespace:'default'});
  await assertNoRunningFlowdeck(options=>client.workflow.list(options));
  for await(const w of client.workflow.list({query:"ExecutionStatus = 'Running'"})){
   if(w?.status?.name==='RUNNING' &&
      (w?.type==='flowdeckAutonomousLifecycleV1'||String(w.workflowId||'').startsWith('flowdeck-autonomy-')))
    throw new CheckError('active_autonomous_execution_occupies_browser');
  }
 }catch(e){if(e instanceof CheckError)throw e;
  throw new CheckError('browser_ownership_or_temporal_visibility_unavailable');
 }finally{await connection?.close()}
}
export function stageCommands(profile){
 const fixture=['tests/flowdeck-autonomy-policy.test.mjs',
   'tests/flowdeck-autonomy-production-initial.test.mjs',
   'tests/flowdeck-autonomy-production-evidence.test.mjs',
   'tests/flowdeck-autonomy-evidence.test.mjs',
   'tests/flowdeck-autonomy-controller.test.mjs',
   'tests/flowdeck-autonomy-initial-send.test.mjs',
   'tests/flowdeck-autonomy-campaign.test.mjs',
   'tests/flowdeck-autonomy-closeout.test.mjs',
   'tests/flowdeck-autonomous-workflow.test.mjs',
   'tests/flowdeck-manual-start.test.mjs',
   'tests/flowdeck-supervisor-activities.test.mjs',
   'tests/flowdeck-successful-cycle-closeout.test.mjs',
   'tests/flowdeck-launch.test.mjs',
   'tests/flowdeck-autonomy-check-runner.test.mjs'];
 switch(profile){
 case'offline':return[{stage:'fixtures',command:process.execPath,args:['--test',...fixture],expectedTests:171,requiresNoSkips:true}];
 case'synthetic':return[
  {stage:'synthetic_fixtures',command:process.execPath,
   args:['--test','tests/flowdeck-pilot-budget.test.mjs','tests/flowdeck-supervisor-workflow.test.mjs',
    'tests/flowdeck-autonomous-workflow.test.mjs','tests/flowdeck-autonomy-check-runner.test.mjs'],
   expectedTests:85,requiresNoSkips:true},
  ...['happy','initial-uncertain','review-gate','p2-uncertain','duplicate-event'].map(scenario=>({
   stage:'autonomous_temporal_'+scenario,command:process.execPath,
   args:['scripts/flowdeck-autonomous-smoke.mjs',scenario]})),
  {stage:'production_composition',command:process.execPath,
   args:['--test','tests/flowdeck-autonomy-production-composition.test.mjs'],
   expectedTests:4,requiresNoSkips:true,timeoutMs:180_000}
 ];
 case'browser-no-send':return[{stage:'browser_composer_no_send',command:process.execPath,
  args:['scripts/flowdeck-browser-check.mjs','--repeat','1']}];
 default:throw new CheckError('live_automation_not_yet_implemented',2);
 }
}
export async function execStage(stage,{cwd=root,timeoutMs=90000,envAddress=null,spawnImpl=spawn}={}){
 const started=Date.now();
 return await new Promise(resolveStage=>{
  const childEnv={...process.env,CI:'1',FLOWDECK_NONINTERACTIVE:'1',
    ...(envAddress?{TEMPORAL_ADDRESS:envAddress}:{})};
  // A Node test invoking this runner is not itself a child test file.
  // Propagating NODE_TEST_CONTEXT causes node --test to silently skip cases.
  delete childEnv.NODE_TEST_CONTEXT;
  const child=spawnImpl(stage.command,stage.args,{cwd,stdio:['ignore','pipe','pipe'],
    env:childEnv,detached:process.platform!=='win32'});
  let output='',timedOut=false,complete=false;
  const remember=data=>{output=(output+String(data)).slice(-12000)};
  child.stdout?.on('data',remember);child.stderr?.on('data',remember);
  const finish=(code,signal,spawnError)=>{
   if(complete)return;complete=true;clearTimeout(timer);
   const tally=testTally(output);
   const incomplete=(stage.expectedTests!==undefined&&
    (tally.executed!==stage.expectedTests||tally.passed!==stage.expectedTests||
      tally.failed!==0))||
    (stage.requiresNoSkips&&(tally.skipped!==0||tally.failed!==0||
      tally.executed===null||tally.passed!==tally.executed));
   resolveStage({stage:stage.stage,exitCode:timedOut?4:spawnError?3:incomplete?3:code??3,
    signal:signal||null,elapsedMs:Date.now()-started,timedOut,
    expectedTests:stage.expectedTests??null,tests:tally,
    outputTail:summary(output),error:spawnError?'child_process_failed':incomplete?'required_test_matrix_incomplete':null});
  };
  const timer=setTimeout(()=>{
   timedOut=true;try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');
   else child.kill('SIGKILL')}catch{child.kill('SIGKILL')}
  },timeoutMs);
  child.once('error',()=>finish(3,null,true));child.once('close',(code,signal)=>finish(code,signal,false));
 });
}
export async function runCheck(args=process.argv.slice(2),deps={}){
 const now=Date.now();let profile='offline',code=2,result;
 try{
  const opts=parseCheckArgs(args);profile=opts.profile;
  let policy=null;
  let temporalAddress=null;
  if(profile==='synthetic')
   temporalAddress=await (deps.verifySyntheticTemporalSafety||verifySyntheticTemporalSafety)();

  if(opts.policy)policy=await (deps.checkPolicy||checkPolicy)(opts.policy);
  if(profile==='live')throw new CheckError('live_mode_blocked_until_production_activities_worker_follower_and_verified_closeout_are_integrated');
  if(profile==='browser-no-send'){
   if(policy?.policy?.environment!=='local-live')
    throw new CheckError('browser_test_requires_scoped_local_live_policy');
   await (deps.verifyBrowserNoSendSafety||verifyBrowserNoSendSafety)(policy.policy);
  }
  const stages=(deps.stageCommands||stageCommands)(profile);
  if(!Array.isArray(stages)||stages.length===0||stages.some(s=>!s||typeof s.stage!=='string'||!s.stage))
   throw new CheckError('required_test_stages_missing');
  const reports=[];
  for(const stage of stages){
   const r=await (deps.execStage||execStage)(stage,
    {timeoutMs:stage.timeoutMs??90_000,envAddress:temporalAddress});
   reports.push(r);
   if(r.exitCode!==0)break;
  }
  code=reports.every(r=>r.exitCode===0)?0:reports.some(r=>r.timedOut)?4:3;
  result={schema:'flowdeck.check-result/v2',profile,outcome:code===0?'passed':'failed',
   code,classification:code===0?'passed':code===4?'quarantined':'failed',
   elapsedMs:Date.now()-now,policyDigest:policy?.hash??null,
   temporalAddress:temporalAddress??null,
   expectedStages:stages.map(s=>s.stage),executedStages:reports.map(r=>r.stage),
   artifactDigests:await artifactIdentity(),
   stages:reports.map(r=>({
    stage:r.stage,exitCode:r.exitCode,elapsedMs:r.elapsedMs,timedOut:r.timedOut,signal:r.signal,
    expectedTests:r.expectedTests??null,tests:r.tests??null,
    outputSha256:hash(r.outputTail??''),diagnostic:r.error??null}))};
 }catch(e){
  code=e instanceof CheckError?e.code:2;
  result={schema:'flowdeck.check-result/v2',profile,outcome:'blocked',
   classification:'setup-blocked',code,elapsedMs:Date.now()-now,
   reason:e instanceof CheckError?e.message:'setup_or_policy_validation_failed',
   artifactDigests:await artifactIdentity(),expectedStages:[],executedStages:[],stages:[]};
 }
 // Records never include raw prompts, cookies, stdout, URLs or local credentials.
 if(deps.writeResult)await deps.writeResult(result);
 return result;
}
export async function persistCheckResult(result,{folder=join(root,'.state','verification-runs','autonomy-checks')}={}){
 await mkdir(folder,{recursive:true,mode:0o700});
 const output=join(folder,'check-'+randomUUID()+'.json');
 // Only structured and redacted metadata is saved; never child stdout or prompts.
 await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 return output;
}
export async function main(){
 const result=await runCheck();
 const output=await persistCheckResult(result);
 console.log(JSON.stringify({...result,reportPath:output},null,2));process.exitCode=result.code;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().catch(()=>{console.log(JSON.stringify({outcome:'blocked',code:2,reason:'runner_internal_error'}));process.exitCode=2});
