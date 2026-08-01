#!/usr/bin/env node
'use strict';

/**
 * AIMA Documentation Validation
 *
 * Zero-dependency Node.js script (fs/path only) that checks the repository's
 * governance documentation for:
 *   1. Broken internal links
 *   2. Missing ADS v1.0 metadata fields
 *   3. Stable Document IDs not registered in HB-001's Master Documentation Index
 *   4. Documentation index drift (docs not referenced from docs/README.md)
 *   5. Invalid references between governance documents (Dependencies/Dependents
 *      tokens that don't correspond to a real Document ID or a registered prefix)
 *
 * Usage: node scripts/validate-docs.js
 * Exit code: 0 if clean, 1 if any check reports a problem.
 *
 * See docs/governance/DOC-VALIDATION.md for full usage and failure-output guidance.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_ROOT = path.join(REPO_ROOT, 'docs');
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git']);

const ADS_REQUIRED_FIELDS = [
  'Document ID',
  'Document Name',
  'Version',
  'Status',
  'Authority Level',
  'Owner',
  'Dependencies',
  'Dependents',
  'Review Frequency',
  'Last Updated',
  'Related Documents',
];

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walkMarkdownFiles(root) {
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  return results.sort();
}

function relPath(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// Header-block extraction (ADS metadata lives before the first `---` rule)
// ---------------------------------------------------------------------------

function getHeaderBlock(content) {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() === '---');
  return (idx === -1 ? lines : lines.slice(0, idx)).join('\n');
}

function getFieldLine(headerBlock, label) {
  const re = new RegExp(`^\\*\\*${label}:\\*\\*(.*)$`, 'm');
  const m = headerBlock.match(re);
  return m ? m[1].trim() : null;
}

function getDeclaredDocumentId(headerBlock) {
  const value = getFieldLine(headerBlock, 'Document ID');
  return value ? value.replace(/`/g, '').trim() : null;
}

// ---------------------------------------------------------------------------
// Check 1: Broken internal links
// ---------------------------------------------------------------------------

function checkBrokenLinks(files) {
  const problems = [];
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => {
      let match;
      linkRe.lastIndex = 0;
      while ((match = linkRe.exec(line)) !== null) {
        let target = match[2].trim();
        if (/^(https?:)?\/\//.test(target) || target.startsWith('mailto:')) continue;
        target = target.split('#')[0];
        if (!target) continue;
        const resolved = path.normalize(path.join(path.dirname(file), target));
        if (!fs.existsSync(resolved)) {
          problems.push({
            file: relPath(file),
            line: i + 1,
            target,
            detail: `link target does not resolve to a file on disk (${relPath(resolved)})`,
          });
        }
      }
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Check 2: Missing ADS v1.0 metadata fields
// ---------------------------------------------------------------------------

function checkMissingADSFields(files) {
  const problems = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const header = getHeaderBlock(content);
    if (!getDeclaredDocumentId(header)) continue; // not an ADS-governed doc; not in scope
    const missing = ADS_REQUIRED_FIELDS.filter((f) => getFieldLine(header, f) === null);
    if (missing.length > 0) {
      problems.push({ file: relPath(file), missing });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Collect all declared Document IDs across the repo
// ---------------------------------------------------------------------------

function collectDeclaredIds(files) {
  const map = new Map(); // id -> file
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const header = getHeaderBlock(content);
    const id = getDeclaredDocumentId(header);
    if (id) map.set(id, relPath(file));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Parse HB-001's Permanent Numbering Standard + Master Documentation Index
// ---------------------------------------------------------------------------

function parseMarkdownTableAfterHeading(content, headingText) {
  const lines = content.split(/\r?\n/);
  const headingIdx = lines.findIndex((l) => l.trim().replace(/^#+\s*/, '') === headingText);
  if (headingIdx === -1) return [];
  const rows = [];
  let i = headingIdx + 1;
  // skip any prose/blank lines before the table; stop if we hit the next heading first
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    if (lines[i].trim().startsWith('#')) return [];
    i++;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    rows.push(cells);
  }
  // rows[0] = header, rows[1] = separator, rows[2..] = data
  return rows.slice(2);
}

function stripBackticks(s) {
  return s.replace(/`/g, '').trim();
}

function loadRegistry(hbContent) {
  const numberingRows = parseMarkdownTableAfterHeading(hbContent, 'Permanent Numbering Standard');
  const prefixes = new Set(numberingRows.map((r) => stripBackticks(r[0])));

  const masterIndexRows = parseMarkdownTableAfterHeading(hbContent, 'Master Documentation Index');
  const stableIds = new Set(
    masterIndexRows.map((r) => stripBackticks(r[1])).filter((id) => id && !id.includes('*'))
  );

  return { prefixes, stableIds };
}

// ---------------------------------------------------------------------------
// Check 3: Declared Document IDs not registered in HB-001's Master Documentation Index
// ---------------------------------------------------------------------------

function checkStableIdRegistration(declaredIds, registeredStableIds) {
  const problems = [];
  for (const [id, file] of declaredIds) {
    if (!registeredStableIds.has(id)) {
      problems.push({ id, file, detail: `not found in HB-001's Master Documentation Index` });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Check 4: Documentation index drift
// ---------------------------------------------------------------------------

function checkIndexDrift(declaredIds, docsReadmeContent) {
  const problems = [];
  for (const [id, file] of declaredIds) {
    if (!file.startsWith('docs/')) continue;
    const basename = path.posix.basename(file);
    if (!docsReadmeContent.includes(basename)) {
      problems.push({ id, file, detail: `not referenced by filename from docs/README.md` });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Check 5: Invalid references between governance documents
// ---------------------------------------------------------------------------

const ID_TOKEN_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-(?:\d{3,4}|INDEX|TEMPLATE|\*)$/;

function derivePrefix(token) {
  const idx = token.lastIndexOf('-');
  return idx === -1 ? null : `${token.slice(0, idx)}-*`;
}

function extractIdTokens(fieldValue) {
  if (!fieldValue) return [];
  const tokens = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(fieldValue)) !== null) {
    const token = m[1].trim();
    if (ID_TOKEN_RE.test(token)) tokens.push(token);
  }
  return tokens;
}

function checkGovernanceReferences(files, declaredIdsSet, prefixSet) {
  const problems = [];
  const fieldsToCheck = ['Dependencies', 'Dependents', 'Related Documents'];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const header = getHeaderBlock(content);
    if (!getDeclaredDocumentId(header)) continue;
    for (const field of fieldsToCheck) {
      const value = getFieldLine(header, field);
      for (const token of extractIdTokens(value)) {
        const isWildcard = token.endsWith('-*');
        const valid =
          (isWildcard && prefixSet.has(token)) ||
          (!isWildcard &&
            (declaredIdsSet.has(token) ||
              (derivePrefix(token) && prefixSet.has(derivePrefix(token)))));
        if (!valid) {
          problems.push({
            file: relPath(file),
            field,
            token,
            detail: `does not match a declared Document ID or a registered prefix`,
          });
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function printSection(title, problems, formatter) {
  console.log(`\n${title} — ${problems.length} issue(s)`);
  if (problems.length === 0) {
    console.log('  OK');
    return;
  }
  for (const p of problems) {
    console.log(`  - ${formatter(p)}`);
  }
}

function main() {
  const allFiles = walkMarkdownFiles(REPO_ROOT);
  const docsFiles = walkMarkdownFiles(DOCS_ROOT);

  const hbPath = path.join(DOCS_ROOT, 'PRODUCT_BIBLE.md');
  const hbContent = fs.existsSync(hbPath) ? fs.readFileSync(hbPath, 'utf8') : '';
  const { prefixes, stableIds } = loadRegistry(hbContent);

  const declaredIds = collectDeclaredIds(allFiles);
  const declaredIdsSet = new Set(declaredIds.keys());

  const readmePath = path.join(DOCS_ROOT, 'README.md');
  const readmeContent = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';

  const brokenLinks = checkBrokenLinks(allFiles);
  const missingADS = checkMissingADSFields(docsFiles);
  const missingRegistration = checkStableIdRegistration(declaredIds, stableIds);
  const indexDrift = checkIndexDrift(declaredIds, readmeContent);
  const invalidRefs = checkGovernanceReferences(docsFiles, declaredIdsSet, prefixes);

  console.log('AIMA Documentation Validation');
  console.log('==============================');

  printSection(
    '1. Broken internal links',
    brokenLinks,
    (p) => `${p.file}:${p.line} → "${p.target}" (${p.detail})`
  );
  printSection(
    '2. Missing ADS metadata fields',
    missingADS,
    (p) => `${p.file}: missing ${p.missing.join(', ')}`
  );
  printSection(
    '3. Stable IDs not registered in HB-001',
    missingRegistration,
    (p) => `${p.id} (${p.file}): ${p.detail}`
  );
  printSection(
    '4. Documentation index drift (docs/README.md)',
    indexDrift,
    (p) => `${p.id} (${p.file}): ${p.detail}`
  );
  printSection(
    '5. Invalid governance cross-references',
    invalidRefs,
    (p) => `${p.file} [${p.field}]: \`${p.token}\` ${p.detail}`
  );

  const total =
    brokenLinks.length +
    missingADS.length +
    missingRegistration.length +
    indexDrift.length +
    invalidRefs.length;

  console.log('\n==============================');
  if (total === 0) {
    console.log('All documentation checks passed.');
    process.exit(0);
  } else {
    console.log(`${total} issue(s) found. See docs/governance/DOC-VALIDATION.md for guidance.`);
    process.exit(1);
  }
}

main();
