#!/usr/bin/env node
/** Oracle-only Sashai supervisor CLI. No prompts are ever sent by this program. */
import {
  listSashaiTabs, adoptSashaiConversation, autoAdoptSashai, sashaiOverview,
  parseSashaiChatUrl, SASHAI_PROJECT_URL
} from '../dist/sashai-observer.js';
import { previewSashaiContinuation } from '../dist/sashai-dispatch-preview.js';

const [action='status', ...args]=process.argv.slice(2);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const output=x=>console.log(JSON.stringify(x,null,2));
try{
  if(action==='doctor'){
    const version=await fetch('http://127.0.0.1:9222/json/version',{signal:AbortSignal.timeout(4000)}).then(r=>r.json());
    output({cdp:'ready', browser:version.Browser, project:SASHAI_PROJECT_URL,
      tabs:await listSashaiTabs(), submitsMessages:false, repoHarness:false});
  }else if(action==='adopt'){
    let url=args[0];
    if(!url){
      const tabs=await listSashaiTabs();
      if(tabs.length!==1)throw Error('Open exactly ONE Sashai conversation in Helium or pass exact chat URL');
      url=tabs[0].url;
    }
    parseSashaiChatUrl(url);
    output({operation:'read-only adoption',observation:await adoptSashaiConversation(url)});
  }else if(action==='auto-adopt'){
    output(await autoAdoptSashai());
  }else if(action==='supervise'){
    // Standalone passive watcher: adopts only a unique active Sashai conversation.
    // Never sends any ChatGPT message or claims a repository task complete.
    const maxRuns = args[0]==='forever' ? Infinity : Math.min(60,Math.max(1,Number(args[0]||5)));
    let last=null;
    for(let i=0;i<maxRuns;i++){
      try {
        const adoption=await autoAdoptSashai();
        const snapshot=await sashaiOverview();
        const event={turn:snapshot.status,task:snapshot.taskState,
          chat:snapshot.observation?.conversationId||null,
          adoption:adoption.status,reason:adoption.reason||null};
        const marker=JSON.stringify(event);
        if(last!==marker){output({observedAt:new Date().toISOString(),...event});last=marker;}
      }catch(err){
        const msg='passive watcher probe failed: '+err.message;
        if(last!==msg){console.error(msg);last=msg;}
      }
      if(i<maxRuns-1)await sleep(5000);
    }
  }else if(action==='watch'){
    const count=Math.min(30,Math.max(1,Number(args[0]||5)));
    for(let i=0;i<count;i++){
      const snapshot=await sashaiOverview();
      output({observedAt:snapshot.checkedAt,turn:snapshot.status,
        task:snapshot.taskState,conversationId:snapshot.observation?.conversationId,
        replies:snapshot.observation?.assistantTurns,
        answerObserved:snapshot.independentlyObservedAnswer,
        oracleStatus:snapshot.oracle?.oracleStatus,run:i+1});
      if(i<count-1)await sleep(2000);
    }
  }else if(action==='preview'){
    const snapshot=await sashaiOverview();
    output(previewSashaiContinuation({
      taskSource:snapshot.taskSource, observation:snapshot.observation,
      previousAttempt:'unknown', connectorPreservingTransportVerified:false,
    }));
  }else if(action==='status'){
    output(await sashaiOverview());
  }else if(action==='tabs'){
    output(await listSashaiTabs());
  }else{
    console.error('Usage: node scripts/sashai-supervisor.mjs doctor|tabs|adopt [Sashai-URL]|auto-adopt|supervise [count|forever]|status|preview|watch [count]');
    process.exitCode=2;
  }
}catch(error){console.error('Supervisor probe error:',error.message);process.exitCode=1;}
