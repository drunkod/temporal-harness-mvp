import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSashaiChatUrl, classifyReadOnlyPage, chooseAutoAdoptCandidate, sashaiOverview } from '../dist/sashai-observer.js';

const chatUrl='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6acfb5c5-ea98-83ed-a041-da6cb6e3814b';

test('accept only conversations in the specific ChatGPT Sashai project', () => {
  const result=parseSashaiChatUrl(chatUrl);
  assert.equal(result.conversationId,'6acfb5c5-ea98-83ed-a041-da6cb6e3814b');
  assert.equal(result.url,chatUrl);
  assert.throws(()=>parseSashaiChatUrl('https://chatgpt.com/c/6acfb5c5-ea98-83ed-a041-da6cb6e3814b'),/Sashai/);
  assert.throws(()=>parseSashaiChatUrl('https://chatgpt.com/g/g-p-6a9527ab00ac8191a7db3837685940d4-dr-desktopcommandermcp/c/6acfb5c5-ea98-83ed-a041-da6cb6e3814b'),/Sashai/);
  assert.throws(()=>parseSashaiChatUrl(chatUrl.replace('chatgpt.com','chatgpt.com.evil.test')),/hosted/);
});

test('a finished chat turn never marks a project task verified', () => {
  const completed=classifyReadOnlyPage({
    userTurns:1,assistantTurns:1,lastAssistant:'Task completed! All tests pass.',stopVisible:false
  });
  assert.equal(completed.turnState,'turn_finished');
  assert.equal(completed.taskState,'unverified');
});

test('visible Stop button means generation is still active', () => {
  const active=classifyReadOnlyPage({userTurns:1,assistantTurns:0,stopVisible:true,busy:true});
  assert.equal(active.turnState,'running');
  assert.equal(active.taskState,'unverified');
});

test('a user prompt without a generated answer is waiting, not success', () => {
  const waiting=classifyReadOnlyPage({userTurns:1,assistantTurns:0,stopVisible:false});
  assert.equal(waiting.turnState,'awaiting_answer');
});

test('older assistant replies cannot finish a newer unanswered user turn', () => {
  const pending=classifyReadOnlyPage({userTurns:2,assistantTurns:1,
    lastAssistant:'Older completed response',stopVisible:false});
  assert.equal(pending.turnState,'awaiting_answer');
  assert.equal(pending.taskState,'unverified');
});

test('generic busy hint is informational while an empty answer cannot finish a turn', () => {
  const completed=classifyReadOnlyPage({userTurns:2,assistantTurns:2,
    lastAssistant:'Completed response',busy:true});
  assert.equal(completed.turnState,'turn_finished');
  assert.equal(completed.pageBusyHint,true);
  assert.equal(classifyReadOnlyPage({userTurns:1,assistantTurns:1,
    lastAssistant:'  '}).turnState,'awaiting_answer');
});

test('read-only observer correlates browser evidence independently of failing Oracle metadata',async(t)=>{
  let actual;
  try {actual=await sashaiOverview();}
  catch(e){t.skip('Helium CDP is unavailable: '+e.message);return;}
  assert.equal(actual.project,'dr/sashai');
  assert.equal(actual.taskState,'unverified');
  if(actual.observation?.browser==='attached_read_only' && actual.oracle?.conversationUrl===actual.observation.url){
    assert.equal(parseSashaiChatUrl(actual.observation.url).conversationId,
      actual.observation.conversationId);
    assert.equal(actual.observation.turnState,'turn_finished');
    assert.equal(actual.independentlyObservedAnswer,true);
    if(actual.oracle.oracleStatus==='error'){
      assert.ok(actual.oracle.captureError);
    }else{
      assert.equal(actual.oracle.oracleStatus,'completed');
      assert.equal(actual.oracle.captureError,null);
    }
  }
});

test('dashboard read-only status never launches a legacy Repo Harness fixture',async(t)=>{
  let before;
  try{before=await fetch('http://127.0.0.1:4319/api/runs');}
  catch{t.skip('Dashboard is not running');return;}
  const initial=(await before.json()).runs.length;
  for(let i=0;i<2;i++){
    const r=await fetch('http://127.0.0.1:4319/api/sashai/status');
    assert.equal(r.status,200);
    const x=await r.json();assert.equal(x.project,'dr/sashai');
  }
  const after=(await(await fetch('http://127.0.0.1:4319/api/runs')).json()).runs.length;
  assert.equal(after,initial);
  const legacy=await fetch('http://127.0.0.1:4319/api/start',{method:'POST'});
  assert.equal(legacy.status,410);
});

test('explicit Sashai chat adoption is idempotent and does not submit another message',async(t)=>{
  let current;
  try{current=await (await fetch('http://127.0.0.1:4319/api/sashai/status')).json();}
  catch{t.skip('Dashboard is offline');return;}
  const url=current.adopted?.url;
  const before=current.observation;
  if(!url||before?.browser!=='attached_read_only'){t.skip('No adopted open Sashai tab');return;}
  const r=await fetch('http://127.0.0.1:4319/api/sashai/adopt',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({url})
  });
  assert.equal(r.status,200);
  const adopted=(await r.json()).observation;
  assert.equal(adopted.conversationId,before.conversationId);
  assert.equal(adopted.userTurns,before.userTurns);
  assert.equal(adopted.assistantTurns,before.assistantTurns);
});

test('locally patched Oracle keeps Homebrew global package unchanged',async(t)=>{
  const fs=await import('node:fs/promises');
  const path=await import('node:path');
  const local=path.resolve('.state/oracle-local/node_modules/@steipete/oracle/dist/src/browser/conversationTurns.js');
  try{
    const body=await fs.readFile(local,'utf8');
    assert.match(body,/ChatGPT 2026 UI/);
    const global='/opt/homebrew/Cellar/oracle/0.21.3/libexec/lib/node_modules/@steipete/oracle/dist/src/browser/conversationTurns.js';
    try{assert.doesNotMatch(await fs.readFile(global,'utf8'),/ChatGPT 2026 UI/);}
    catch(err){if(err.code==='ENOENT')t.diagnostic('Homebrew Oracle not installed on this test host');else throw err;}
  }catch(err){if(err.code==='ENOENT')t.skip('Local Oracle pin not installed');else throw err;}
});

test('passive supervisor chooses only a uniquely active Sashai task',()=>{
  const a='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6acfb5c5-ea98-83ed-a041-da6cb6e3814b';
  const b='https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/6acfbc18-4c98-83ed-b711-a5a8e9efb121';
  assert.deepEqual(chooseAutoAdoptCandidate([
    {url:a,turnState:'turn_finished'},{url:b,turnState:'running'}],a),
    {url:b,reason:'single_running_chat'});
  assert.deepEqual(chooseAutoAdoptCandidate([{url:a,turnState:'awaiting_answer'}],b),
    {url:a,reason:'single_pending_response'});
  assert.equal(chooseAutoAdoptCandidate([{url:a,turnState:'running'},{url:b,turnState:'running'}],null),null);
  assert.equal(chooseAutoAdoptCandidate([{url:a,turnState:'turn_finished'},{url:b,turnState:'turn_finished'}],null),null);
  assert.equal(chooseAutoAdoptCandidate([{url:a,turnState:'turn_finished'}],a),null);
  assert.deepEqual(chooseAutoAdoptCandidate([{url:a,turnState:'turn_finished'}],null),
    {url:a,reason:'sole_finished_chat'});
});

test('Work-style collapsed assistant activity uses the latest role heading, not visible text counts',()=>{
  const finished=classifyReadOnlyPage({userTurns:2,assistantTurns:1,lastRole:'assistant',
    lastAssistant:'Diagram repair completed',stopVisible:false});
  assert.equal(finished.turnState,'turn_finished');
  assert.equal(finished.taskState,'unverified');
  const waiting=classifyReadOnlyPage({userTurns:2,assistantTurns:6,lastRole:'user',
    lastAssistant:'Earlier completed review',stopVisible:false});
  assert.equal(waiting.turnState,'awaiting_answer');
  const running=classifyReadOnlyPage({userTurns:2,assistantTurns:6,lastRole:'assistant',
    lastAssistant:'Streaming',stopVisible:true});
  assert.equal(running.turnState,'running');
});
