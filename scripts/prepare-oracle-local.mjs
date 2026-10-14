#!/usr/bin/env node
/**
 * Install the released Oracle 0.21.5 into the repo's ignored .state directory.
 * Do NOT patch Oracle source or modify the user's Homebrew Oracle binary/profile.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const state = join(root, '.state', 'oracle-v0215');
const cli = join(state, 'node_modules', '.bin', 'oracle');
const pkgFile = join(state, 'node_modules', '@steipete', 'oracle', 'package.json');
await mkdir(state, { recursive: true });
if (!existsSync(pkgFile)) {
  const installed = spawnSync('npm', ['install', '--prefix', state, '--no-save',
    '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund',
    '@steipete/oracle@0.21.5'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  if (installed.status !== 0) throw Error('Could not install Oracle 0.21.5: ' + installed.stderr);
}
const pkg = JSON.parse(await readFile(pkgFile, 'utf8'));
if (pkg.version !== '0.21.5') throw Error('Unexpected pinned Oracle version: ' + pkg.version);
const version = spawnSync(cli, ['--version'], { cwd: root, encoding: 'utf8', timeout: 12000 });
if (version.status !== 0 || version.stdout.trim() !== '0.21.5') throw Error('Oracle binary did not pass version check');
console.log(JSON.stringify({
  localOracle: cli, version: pkg.version,
  source: 'unmodified npm @steipete/oracle@0.21.5',
  globalOracleUntouched: true, legacyLocalPatchesNotUsed: true
}, null, 2));
