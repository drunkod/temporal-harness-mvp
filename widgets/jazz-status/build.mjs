import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--reuse-from')) {
  throw new Error('Usage: node build.mjs [--reuse-from /absolute/plugin/repository]');
}
const source = args.length ? resolve(args[1], 'control-plane/apps/control-plane/package.json') : join(root, 'package.json');
const require = createRequire(source);
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const packages = {};
for (const [name, expected] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
  const path = require.resolve(`${name}/package.json`);
  const actual = JSON.parse(await readFile(path, 'utf8')).version;
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, found ${actual}`);
  packages[name] = dirname(path);
}
const ts = require('typescript');
const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, {
  ...parsed.options,
  types: [],
  paths: {
    'jazz-tools': [join(packages['jazz-tools'], 'dist/index.d.ts')],
    'jazz-tools/react': [join(packages['jazz-tools'], 'dist/react/index.d.ts')],
    'react': [join(packages['@types/react'], 'index.d.ts')],
    'react/*': [join(packages['@types/react'], '*')],
    'react-dom/*': [join(packages['@types/react-dom'], '*')],
  },
});
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n',
}));
console.log('Widget TypeScript check passed.');
const { build } = require('esbuild');
await mkdir(join(root, 'dist'), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['index.tsx'],
  outfile: 'dist/jazz-status.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
      ...Object.fromEntries(['jazz-tools', 'react', 'react-dom'].map(name => [name, packages[name]])),
      'jazz-tools/react': require.resolve('jazz-tools/react'),
    },
  metafile: true,
});
await writeFile(join(root, 'dist/build-meta.json'), JSON.stringify({ versions: { ...manifest.dependencies }, metafile: result.metafile }, null, 2) + '\n');
console.log('Built isolated browser bundle; no root dependencies or plugin files changed.');
