import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const command=fileURLToPath(new URL('../scripts/flowdeck-replay-check.mjs',import.meta.url));
const base=['--address','127.0.0.1:7233','--namespace','default',
  '--workflow-id','flowdeck-supervisor-sashai-probe-pilot',
  '--run-id','01a13ff6-0bb0-73e4-bd7f-56493bedc9fd'];
const run=args=>spawnSync(process.execPath,[command,...args],{encoding:'utf8',timeout:4500});

test('exact-run replay CLI documents required explicit identities and performs no work for help',()=>{
 const r=run(['--help']);
 assert.equal(r.status,0);
 for(const word of ['--address','--namespace','--workflow-id','--run-id'])
  assert.ok(r.stdout.includes(word));
});
test('replay refuses omitted and ambiguous identity arguments before connecting',()=>{
 for(const args of [[],base.slice(0,-2),[...base,'--run-id','duplicate'],[...base,'--unknown','value']]){
  const r=run(args);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Usage:/);
 }
});
test('replay refuses non-exact run names instead of choosing a latest execution',()=>{
 for(const candidate of ['latest','', 'all','00000000-0000-0000']){
  const args=[...base.slice(0,-1),candidate];
  const r=run(args);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Usage:/);
 }
});
test('replay rejects unsafe or invalid watchdog bounds before opening Temporal',()=>{
 for(const budget of ['0','9999','180001','NaN','1.5']){
  const r=run([...base,'--deadline-ms',budget]);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Replay watchdog must be between/);
 }
});
