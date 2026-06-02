#!/usr/bin/env node
// Scans `Student Work/Headshots/` and `Student Work/Projects/` and rewrites the
// MANIFEST block inside every page listed in PAGES, between the
// __MANIFEST_START__ / __MANIFEST_END__ sentinels. Run after adding/removing/
// renaming any asset.
//
// Usage:  node scripts/generate-manifest.mjs
// Run from the repo root.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const HEADSHOTS_DIR = resolve(ROOT, 'Student Work/Headshots');
const PROJECTS_DIR = resolve(ROOT, 'Student Work/Projects');
const PAGES = [
  resolve(ROOT, 'showcase/index.html'),
  resolve(ROOT, 'students/index.html'),
  resolve(ROOT, 'index/index.html'),
  resolve(ROOT, 'display/index.html'),
  resolve(ROOT, 'edit/index.html'),
];
// Invite page just needs the NAMES list (it spawns headshots, not project
// files), maintained between __NAMES_START__ / __NAMES_END__ sentinels.
const NAMES_PAGE = resolve(ROOT, 'index.html');

const IMAGE_EXT = /\.webp$/i;
const PROJECT_EXT = /\.(webp|url)$/i;   // .url holds a YouTube/Vimeo video link

function listFiles(dir, label, ext) {
  try {
    return readdirSync(dir).filter(f => ext.test(f));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`⚠  ${label} directory not found at ${dir}`);
      return [];
    }
    throw err;
  }
}

const headshotFiles = listFiles(HEADSHOTS_DIR, 'Headshots', IMAGE_EXT);
const projectFiles = listFiles(PROJECTS_DIR, 'Projects', PROJECT_EXT);

const students = headshotFiles
  .map(f => f.replace(IMAGE_EXT, ''))
  .sort((a, b) => a.localeCompare(b));

if (students.length === 0) {
  console.warn('⚠  No headshots found. MANIFEST will be empty.');
}

// Group project files by the prefix before the first underscore.
const grouped = {};
for (const file of projectFiles) {
  const underscore = file.indexOf('_');
  if (underscore <= 0) {
    console.warn(`⚠  Project file "${file}" has no underscore — skipped.`);
    continue;
  }
  const prefix = file.slice(0, underscore);
  // Find headshot match, allowing case-insensitive comparison but warning on mismatches.
  const exact = students.find(s => s === prefix);
  const ci = students.find(s => s.toLowerCase() === prefix.toLowerCase());
  if (!exact && ci) {
    console.warn(`⚠  Casing mismatch: project "${file}" prefix "${prefix}" — using headshot "${ci}".`);
  }
  const key = exact ?? ci;
  if (!key) {
    console.warn(`⚠  Project "${file}" prefix "${prefix}" has no matching headshot — skipped.`);
    continue;
  }
  (grouped[key] ??= []).push(file);
}

// Warn on headshots with no projects.
for (const s of students) {
  if (!grouped[s] || grouped[s].length === 0) {
    console.warn(`⚠  Headshot "${s}" has no matching project files.`);
  }
}

// Build manifest object in student order, with project filenames sorted.
const manifest = {};
for (const s of students) {
  const files = (grouped[s] ?? []).slice().sort((a, b) => a.localeCompare(b));
  manifest[s] = files;
}

// Pretty-print to match the page's existing formatting style (2-space indent).
function renderManifest(obj) {
  const lines = ['const MANIFEST = {'];
  const keys = Object.keys(obj);
  keys.forEach((k, i) => {
    const arr = obj[k];
    const arrLiteral = '[' + arr.map(f => JSON.stringify(f)).join(', ') + ']';
    const trailing = i === keys.length - 1 ? '' : ',';
    lines.push(`      ${JSON.stringify(k)}: ${arrLiteral}${trailing}`);
  });
  lines.push('    };');
  return lines.join('\n');
}

const block = renderManifest(manifest);
const re = /(\/\/ __MANIFEST_START__)[\s\S]*?(\/\/ __MANIFEST_END__)/;

for (const page of PAGES) {
  const text = readFileSync(page, 'utf8');
  if (!re.test(text)) {
    console.error(`✘  Could not find __MANIFEST_START__ / __MANIFEST_END__ sentinels in ${page}`);
    process.exit(1);
  }
  const updated = text.replace(re, `$1\n    ${block}\n    $2`);
  writeFileSync(page, updated);
}

// Sync the invite page's NAMES array with the headshot list.
const rows = [];
for (let i = 0; i < students.length; i += 8) rows.push(students.slice(i, i + 8));
const lastIdx = rows.length - 1;
const namesBlock = [
  'const NAMES = [',
  ...rows.map((row, i) => {
    const items = row.map(s => `'${s}'`).join(',');
    return `      ${items}${i === lastIdx ? '' : ','}`;
  }),
  '    ];'
].join('\n');
const namesRe = /(\/\/ __NAMES_START__[^\n]*\n)[\s\S]*?(\/\/ __NAMES_END__)/;
{
  const text = readFileSync(NAMES_PAGE, 'utf8');
  if (!namesRe.test(text)) {
    console.warn(`⚠  No __NAMES_START__ / __NAMES_END__ sentinels in ${NAMES_PAGE} — skipped.`);
  } else {
    writeFileSync(NAMES_PAGE, text.replace(namesRe, `$1    ${namesBlock}\n    $2`));
  }
}

const total = Object.values(manifest).reduce((n, arr) => n + arr.length, 0);
console.log(`✓ Manifest written to ${PAGES.length} pages: ${students.length} students, ${total} project files.`);
