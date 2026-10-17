#!/usr/bin/env node
/** Offline inline-Markdown destination checks. No browser, services, or external URL fetches. */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entrypoints = [
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/README.md',
  'docs/FILE-MAP.md', 'docs/publishing.md', 'docs/architecture/overview.md',
  'scripts/README.md', 'examples/README.md',
];

export function inlineDestinations(markdown) {
  // Examples are not links; this deliberately does not validate reference-style links or anchors.
  let fenced = null;
  const prose = markdown.split(/\r?\n/).map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fenced) fenced = marker[1];
      else if (marker[1][0] === fenced[0] && marker[1].length >= fenced.length) fenced = null;
      return '';
    }
    return fenced ? '' : line.replace(/(`+)[^`]*?\1/g, '');
  }).join('\n');
  return [...prose.matchAll(/!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)/g)]
    .map(match => {
      const value = match[1].trim();
      return value.startsWith('<') ? value.slice(1, -1) : value.replace(/\s+["'][^"']*["']$/, '');
    });
}

export async function checkMarkdownLinks(base, files) {
  const errors = [], localEvidence = [];
  for (const file of files) {
    let text;
    try { text = await readFile(resolve(base, file), 'utf8'); }
    catch { errors.push({ file, target: file, reason: 'document_unreadable' }); continue; }
    for (const target of inlineDestinations(text)) {
      if (!target || target.startsWith('#') || /^(?:https?:|mailto:|data:|zed:|\/\/)/i.test(target)) continue;
      if (/^file:/i.test(target) || isAbsolute(target)) {
        errors.push({ file, target, reason: 'machine_specific_link' }); continue;
      }
      let decoded;
      try { decoded = decodeURIComponent(target.split(/[?#]/)[0]); }
      catch { errors.push({ file, target, reason: 'invalid_url_encoding' }); continue; }
      const destination = resolve(base, dirname(file), decoded);
      const rel = relative(base, destination);
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
        errors.push({ file, target, reason: 'outside_repository' }); continue;
      }
      if (rel === '.state' || rel.startsWith('.state' + sep)) {
        localEvidence.push({ file, target, reason: 'local_only_evidence' }); continue;
      }
      try { await stat(destination); }
      catch { errors.push({ file, target, reason: 'missing_destination' }); }
    }
  }
  return { errors, localEvidence };
}

async function markdownFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.state', '.git'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) result.push(relative(root, path));
  }
  return result;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && !['--all', '--help'].includes(args[0]))) {
    throw new Error('Usage: node scripts/check-docs.mjs [--all|--help]');
  }
  if (args[0] === '--help') {
    console.log('Usage: node scripts/check-docs.mjs [--all]\nDefault: current entry docs. --all: also retained docs. Offline file destinations only; not anchors/reference links, privacy, or external URLs.');
    return;
  }
  const files = [...new Set(args[0] === '--all'
    ? [...entrypoints, ...await markdownFiles(resolve(root, 'docs'))]
    : entrypoints)].sort();
  const result = await checkMarkdownLinks(root, files);
  for (const issue of result.errors) console.error(`ERROR ${issue.file}: ${issue.target} (${issue.reason})`);
  for (const issue of result.localEvidence) console.warn(`LOCAL ${issue.file}: ${issue.target} (not public evidence)`);
  console.log(`Checked ${files.length} documents: ${result.errors.length} errors, ${result.localEvidence.length} local-only evidence links.`);
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
