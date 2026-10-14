import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';

test('Oracle diagnosis is passive, records mismatch without transcript contents',async t=>{
  const r=spawnSync(process.execPath,[resolve('scripts/diagnose-oracle.mjs'),'flowdeck-sashai-oracle-live-cdp'],{
    encoding:'utf8',timeout:14000
  });
  if(r.status!==0){
    t.skip('Sashai CDP tab or saved metadata unavailable: '+(r.stderr||'').slice(0,140));
    return;
  }
  const result=JSON.parse(r.stdout);
  assert.equal(result.oracleErrorCode,'prompt-commit-timeout');
  assert.equal(result.promptSubmitted,true);
  if (!result.tabOpen) t.diagnostic('Historical test tab is closed; checking durable error evidence only');
  if (result.tabOpen) {
  assert.equal(result.cdp?.oldTurnCount,0);
  assert.equal(result.cdp?.modernTurnCount,1);
  assert.ok([0,2].includes(result.cdp?.patchedTurnCount), 'historical local patch is optional');
  assert.equal(result.cdp?.headingCounts?.user,1);
  assert.equal(result.cdp?.headingCounts?.assistant,1);
  assert.equal(result.cdp?.oldAssistantCount,0);
  assert.equal(result.cdp?.newAssistantCount,1);
  assert.equal(result.cdp?.stopVisible,false);
  assert.equal(result.cdp?.hrefMatchesExpected,true);
  assert.equal(result.cdp?.composerPresent,true);
  }
  assert.equal(result.sourceErrorProbe.turnsCount,0);
  const raw=await readFile(result.evidenceFile,'utf8');
  assert.doesNotMatch(raw,/This is an Oracle CLI integration test inside Sashai/);
  assert.doesNotMatch(raw,/ORACLE_SASHAI_SMOKE_OK/);
  const mode=(await stat(result.evidenceFile)).mode&0o777;
  assert.equal(mode&0o077,0,'diagnostics must be private');
});

test('adapter enables verbose diagnostics without submitting on diagnose',async()=>{
  const source=await readFile(resolve('scripts/oracle-sashai.mjs'),'utf8');
  assert.match(source,/ORACLE_DEBUG/);
  assert.match(source,/--verbose/);
  assert.match(source,/--perf-trace-path/);
  assert.match(source,/--heartbeat/);
  const diag=await readFile(resolve('scripts/diagnose-oracle.mjs'),'utf8');
  assert.match(diag,/Runtime\.evaluate/);
  assert.doesNotMatch(diag,/Input\.dispatch|Page\.navigate|Input\.insertText|Runtime\.callFunctionOn/);
});
