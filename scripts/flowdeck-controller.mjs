#!/usr/bin/env node
/** Read-only noninteractive autonomous preflight/status. Never starts lifecycle effects. */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkPolicy,CheckError} from './flowdeck-check.mjs';
import {readAutonomyControllerManifest} from '../dist/flowdeck-autonomy-controller.js';
export async function runControllerCommand(args=process.argv.slice(2),deps={}){
 try{
  if(args.length===2&&args[0]==='preflight'&&args[1].startsWith('--policy=')){const result=await(deps.checkPolicy??checkPolicy)(args[1].slice(9));return{schema:'flowdeck.autonomy-preflight/v1',status:'ready_for_review',policyDigest:result.hash,environment:result.policy.environment};}
  if(args.length===2&&args[0]==='status'&&args[1].startsWith('--manifest='))return{schema:'flowdeck.autonomy-controller-status/v1',manifest:await(deps.readManifest??readAutonomyControllerManifest)(args[1].slice(11))};
  return{schema:'flowdeck.autonomy-preflight/v1',status:'blocked',reason:'usage: preflight --policy=FILE | status --manifest=FILE',exitCode:2};
 }catch(e){return{schema:'flowdeck.autonomy-preflight/v1',status:'blocked',reason:e instanceof CheckError?e.message:'policy_or_manifest_invalid',exitCode:2}}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const result=await runControllerCommand();console.log(JSON.stringify(result,null,2));process.exitCode=result.exitCode??0}
