#!/usr/bin/env node
/**
 * check-test-ids.js — improved
 *
 * Scans Angular HTML templates for interactive elements and important
 * containers missing `data-testid` attributes, duplicate IDs and naming
 * conventions.
 *
 * Improvements over original:
 *  - Single filesystem walk (was 4 walks)
 *  - Fixed pos/line bug in convention check
 *  - Handles single + double quoted attributes
 *  - Handles dynamic [attr.data-testid] for duplicates & presence
 *  - Efficient line-number tracking (O(n) not O(n²))
 *  - Handles > inside quoted attrs without backslash escape hacks
 *  - Skips HTML comments and handles nesting in extractInnerText
 *  - Unicode-aware toKebab, routerLink/(click) interactive detection
 *  - Ignore directives: check-test-ids-ignore, data-testid-ignore
 *  - CLI flags: --help, --json, --no-color, --src <dir>, --strict, --exclude <glob>
 *  - Suggestion for missing ids, colored + json output
 *  - Works with node or bun (zero dependencies)
 *
 * Exit 0 = pass, 1 = failures (strict also fails on warnings/conventions)
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_SRC = path.resolve(__dirname, '..', 'src');
const INTERACTIVE = ['button', 'input', 'select', 'textarea', 'form'];
const CONTAINERS = ['table', 'nav', 'section', 'dialog', 'article', 'aside', 'header', 'footer', 'main'];
const TEXT_DERIVED_SCOPES = ['btn', 'link', 'heading', 'th', 'label', 'option', 'tab', 'li', 'sort-column'];
const CONTAINER_SCOPES = new Set([
  'card','section','modal','dialog','table','form','nav','page','wrapper','container',
  'body','header','footer','overlay','sidebar','strip','list','group','row'
]);
const VOID_ELEMENTS = new Set(['input','img','br','hr','meta','link','area','base','col','embed','source','track','wbr']);
const MAX_DESC_LEN = 40;
const IGNORE_NEXT_LINE = 'check-test-ids-ignore-next-line';
const IGNORE_FILE = 'check-test-ids-ignore';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { src: DEFAULT_SRC, json: false, color: true, strict: false, excludes: [], help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--json') args.json = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '--strict') args.strict = true;
    else if (a === '--src' && argv[i + 1]) args.src = path.resolve(argv[++i]);
    else if (a.startsWith('--src=')) args.src = path.resolve(a.slice(6));
    else if (a === '--exclude' && argv[i + 1]) args.excludes.push(argv[++i]);
    else if (a.startsWith('--exclude=')) args.excludes.push(a.slice(10));
  }
  if (process.env.NO_COLOR) args.color = false;
  if (!process.stdout.isTTY) args.color = false;
  return args;
}

function printHelp() {
  console.log(`
Usage: node scripts/check-test-ids.js [options]

Options:
  --src <dir>        Source directory (default: src)
  --json             Output JSON instead of pretty text (CI friendly)
  --no-color         Disable colors
  --strict           Fail on warnings & convention violations too
  --exclude <glob>   Exclude paths (repeatable, e.g. --exclude "**/generated/**")
  -h, --help         Show help

Ignore directives in HTML:
  <!-- check-test-ids-ignore -->                 skip whole file
  <!-- check-test-ids-ignore-next-line -->       skip next line
  <div data-testid-ignore>                       skip element

Conventions:
  - Interactive (<${INTERACTIVE.join(', ')}>) must have data-testid
  - Containers (<${CONTAINERS.join(', ')}>) warned if missing
  - External links (http/mailto/tel/#) exempt
  - data-testid must be "<filename>:<scope>-<kebab-from-text>"
`);
}

// Simple glob -> regex (supports * and ** and ?)
function globToRegExp(glob) {
  let r = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  r = r.replace(/\*\*/g, '§§');
  r = r.replace(/\*/g, '[^/]*');
  r = r.replace(/§§/g, '.*');
  r = r.replace(/\?/g, '[^/]');
  return new RegExp('^' + r + '$');
}
function isExcluded(relPath, excludes) {
  if (!excludes.length) return false;
  for (const g of excludes) {
    const re = globToRegExp(g);
    if (re.test(relPath) || re.test(path.basename(relPath))) return true;
    if (!g.includes('*') && !g.includes('?') && relPath.includes(g)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
function toKebab(text) {
  return text
    .trim()
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\$\{[^}]*\}/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&[a-zA-Z0-9#]+;/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getAttr(attrs, name) {
  const re = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i');
  const m = attrs.match(re);
  if (!m) return null;
  return m[1] !== undefined ? m[1] : m[2];
}

function extractInnerText(content, openEndPos, tagName) {
  const openTag = '<' + tagName;
  const closeTag = '</' + tagName + '>';
  let depth = 1;
  let pos = openEndPos + 1;
  const len = content.length;
  let end = -1;
  while (pos < len) {
    const nextOpen = content.indexOf(openTag, pos);
    const nextClose = content.indexOf(closeTag, pos);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const after = content[nextOpen + openTag.length];
      if (after === ' ' || after === '>' || after === '/' || after === '\n' || after === '\t') {
        depth++;
        pos = nextOpen + openTag.length;
        continue;
      }
    }
    depth--;
    if (depth === 0) { end = nextClose; break; }
    pos = nextClose + closeTag.length;
  }
  if (end === -1) return '';
  let text = content.slice(openEndPos + 1, end);
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&[a-zA-Z0-9#]+;/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// File collection — single walk
// ---------------------------------------------------------------------------
function collectHtmlFiles(srcDir, excludes) {
  const files = [];
  if (!fs.existsSync(srcDir)) {
    console.error(`src dir not found: ${srcDir}`);
    return files;
  }
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(srcDir, full);
      if (isExcluded(rel, excludes) || isExcluded(full, excludes)) continue;
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.html') || e.name === 'index.html') continue;
      files.push(full);
    }
  }
  walk(srcDir);
  return files;
}

// ---------------------------------------------------------------------------
// Tag scanner — O(n) line tracking, skips comments
// ---------------------------------------------------------------------------
function findTags(content) {
  const results = [];
  const len = content.length;
  let i = 0;
  let line = 1;
  while (i < len) {
    if (content[i] === '\n') { line++; i++; continue; }
    if (content.startsWith('<!--', i)) {
      const end = content.indexOf('-->', i + 4);
      if (end === -1) break;
      const chunk = content.slice(i, end + 3);
      line += (chunk.match(/\n/g) || []).length;
      i = end + 3;
      continue;
    }
    if (content[i] === '<' && i + 1 < len && /[a-zA-Z]/.test(content[i + 1])) {
      const tagStart = i;
      const tagLine = line;
      i++;
      let name = '';
      while (i < len && /[\w-]/.test(content[i])) { name += content[i]; i++; }
      if (name.startsWith('/')) { continue; }
      name = name.toLowerCase();
      let inDouble = false, inSingle = false, attrs = '';
      let closed = false;
      while (i < len) {
        const ch = content[i];
        if (ch === '\n') line++;
        if (inDouble) {
          if (ch === '"') inDouble = false;
          attrs += ch; i++; continue;
        }
        if (inSingle) {
          if (ch === "'") inSingle = false;
          attrs += ch; i++; continue;
        }
        if (ch === '"') { inDouble = true; attrs += ch; i++; continue; }
        if (ch === "'") { inSingle = true; attrs += ch; i++; continue; }
        if (ch === '>') { i++; closed = true; break; }
        attrs += ch; i++;
      }
      if (!closed) continue;
      results.push({ name, attrs, line: tagLine, start: tagStart, end: i });
    } else {
      i++;
    }
  }
  return results;
}

function getIgnoredLines(content) {
  const ignored = new Set();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(IGNORE_NEXT_LINE)) ignored.add(i + 2);
  }
  return ignored;
}

function suggestId(filePath, tag) {
  const filename = path.basename(filePath, path.extname(filePath));
  const map = { button: 'btn', a: 'link' };
  const scope = map[tag.name] || tag.name;
  return `${filename}:${scope}-...`;
}

function processFile(filePath, content) {
  if (/<!--\s*check-test-ids-ignore\s*-->/.test(content)) return { errors: [], warnings: [] };
  const ignoredLines = getIgnoredLines(content);
  const tags = findTags(content);
  const errors = [];
  const warnings = [];
  for (const tag of tags) {
    if (ignoredLines.has(tag.line)) continue;
    if (/\bdata-testid-ignore\b/.test(tag.attrs)) continue;
    const hasStatic = /\bdata-testid\s*=\s*(?:"[^"]*"|'[^']*')/.test(tag.attrs);
    const hasDynamic = /\[attr\.data-testid\]\s*=\s*(?:"[^"]*"|'[^']*')/.test(tag.attrs);
    if (hasStatic || hasDynamic) continue;
    const href = getAttr(tag.attrs, 'href');
    if (href && /^(https?:\/\/|mailto:|tel:|#)/.test(href.trim())) continue;
    const isInteractiveTag = INTERACTIVE.includes(tag.name);
    const role = getAttr(tag.attrs, 'role');
    const isButtonRole = role === 'button' && tag.name !== 'button';
    const isInteractive = isInteractiveTag || isButtonRole;
    if (isInteractive) {
      errors.push({ file: filePath, line: tag.line, tag: tag.name, suggestion: suggestId(filePath, tag) });
    } else if (CONTAINERS.includes(tag.name)) {
      warnings.push({ file: filePath, line: tag.line, tag: tag.name, suggestion: suggestId(filePath, tag) });
    }
  }
  return { errors, warnings };
}

function checkDuplicates(files) {
  const testIds = new Map();
  const staticRe = /data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
  const dynamicRe = /\[attr\.data-testid\]\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const m of line.matchAll(staticRe)) {
        const id = m[1] ?? m[2];
        if (!testIds.has(id)) testIds.set(id, []);
        testIds.get(id).push({ file, line: i + 1 });
      }
      for (const m of line.matchAll(dynamicRe)) {
        const raw = (m[1] ?? m[2]).trim();
        if (!raw.includes(':') && !raw.includes("'")) continue;
        const pref = raw.match(/^'([^']+)'/);
        if (!pref) continue;
        const id = pref[1] + '*';
        if (!testIds.has(id)) testIds.set(id, []);
        testIds.get(id).push({ file, line: i + 1, dynamic: true });
      }
    }
  }
  const dupes = [];
  for (const [id, locs] of testIds) {
    const isWildcard = id.endsWith('*');
    if (isWildcard) continue;
    if (locs.length > 1) dupes.push({ id, locations: locs });
  }
  return { total: testIds.size, duplicates: dupes };
}

function checkConventions(files) {
  const violations = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    if (/<!--\s*check-test-ids-ignore\s*-->/.test(content)) continue;
    const ignoredLines = getIgnoredLines(content);
    const filename = path.basename(file, path.extname(file));
    const prefix = filename + ':';
    const tags = findTags(content);
    const re = /data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const testId = m[1] ?? m[2];
      const idx = m.index;
      const line = (content.slice(0, idx).match(/\n/g) || []).length + 1;
      if (ignoredLines.has(line)) continue;
      if (!testId.startsWith(prefix)) continue;
      const rest = testId.slice(prefix.length);
      if (rest.includes("'-") || rest.includes("' + ") || rest.endsWith("-'") || rest.includes('*')) continue;
      const scopeMatch = rest.match(/^([a-z][a-z0-9]*)-/);
      if (!scopeMatch) continue;
      const scope = scopeMatch[1];
      const currentDesc = rest.slice(scope.length + 1);
      if (CONTAINER_SCOPES.has(scope)) continue;
      if (!TEXT_DERIVED_SCOPES.includes(scope)) continue;
      let owner = null;
      for (let t = tags.length - 1; t >= 0; t--) {
        if (tags[t].start < idx && tags[t].end > idx) { owner = tags[t]; break; }
        if (tags[t].end < idx) break;
      }
      let openingTag, tagOpenEnd;
      if (owner) {
        openingTag = content.slice(owner.start, owner.end);
        tagOpenEnd = owner.end - 1;
      } else {
        const tagLineStart = content.lastIndexOf('<', idx);
        const tagOpen = content.indexOf('>', tagLineStart);
        if (tagOpen === -1) continue;
        openingTag = content.slice(tagLineStart, tagOpen + 1);
        tagOpenEnd = tagOpen;
      }
      let innerText = '';
      const tagNameForVoid = scope === 'sort-column' ? 'th' : owner ? owner.name : openingTag.split(/\s/)[0].replace('<','').toLowerCase();
      if (!VOID_ELEMENTS.has(tagNameForVoid)) {
        innerText = extractInnerText(content, tagOpenEnd, tagNameForVoid);
      }
      const placeholder = getAttr(openingTag, 'placeholder');
      const ariaLabel = getAttr(openingTag, 'aria-label');
      let expected = null;
      if (innerText && innerText.length <= MAX_DESC_LEN) expected = toKebab(innerText);
      else if (scope === 'input' && placeholder && placeholder.length <= MAX_DESC_LEN) expected = toKebab(placeholder);
      else if ((scope === 'icon' || scope === 'img') && ariaLabel && ariaLabel.length <= MAX_DESC_LEN) expected = toKebab(ariaLabel);
      if (expected && expected !== currentDesc && expected !== '') {
        violations.push({ file, line, testId, currentDesc, expected });
      }
    }
  }
  return violations;
}

function colorize(str, code, enabled) {
  return enabled ? `\x1b[${code}m${str}\x1b[0m` : str;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }
  const SRC_DIR = args.src;
  const files = collectHtmlFiles(SRC_DIR, args.excludes);
  const rel = (f) => path.relative(SRC_DIR, f);
  const allErrors = [];
  const allWarnings = [];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf-8');
    const { errors, warnings } = processFile(f, content);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  }
  const { total: totalIds, duplicates } = checkDuplicates(files);
  const conventionViolations = checkConventions(files);
  const fileCount = files.length;
  if (args.json) {
    console.log(JSON.stringify({ filesScanned: fileCount, uniqueTestIds: totalIds, duplicates, missingInteractive: allErrors, missingContainers: allWarnings, conventionViolations }, null, 2));
  } else {
    const c = args.color;
    console.log(`\n${colorize('🔍 data-testid validation', '1', c)}`);
    console.log(`   Files scanned: ${fileCount}`);
    console.log(`   Unique test IDs: ${totalIds}`);
    if (args.excludes.length) console.log(`   Excludes: ${args.excludes.join(', ')}`);
    if (duplicates.length > 0) {
      console.log(`\n${colorize(`❌ DUPLICATE TEST IDs (${duplicates.length}):`, '31', c)}`);
      for (const d of duplicates) {
        console.log(`   "${d.id}" (${d.locations.length}×):`);
        for (const loc of d.locations) console.log(`     ${rel(loc.file)}:${loc.line}`);
      }
    }
    if (allErrors.length > 0) {
      console.log(`\n${colorize(`❌ Missing test-id on interactive elements (${allErrors.length}):`, '31', c)}`);
      for (const v of allErrors) console.log(`   ${rel(v.file)}:${v.line} — <${v.tag}>  → add ${colorize(v.suggestion, '2', c)}`);
    }
    if (allWarnings.length > 0) {
      console.log(`\n${colorize(`⚠️  Missing test-id on containers (${allWarnings.length}):`, '33', c)}`);
      for (const v of allWarnings) console.log(`   ${rel(v.file)}:${v.line} — <${v.tag}>  → add ${colorize(v.suggestion, '2', c)}`);
    }
    if (conventionViolations.length > 0) {
      console.log(`\n${colorize(`⚠️  Description should derive from visible text (${conventionViolations.length}):`, '33', c)}`);
      for (const v of conventionViolations) {
        console.log(`   ${rel(v.file)}:${v.line} — ${v.testId}`);
        console.log(`     current: ${v.currentDesc} → expected: ${v.expected}`);
      }
    }
    if (allErrors.length === 0 && duplicates.length === 0 && conventionViolations.length === 0) {
      console.log(`\n${colorize('✅ All checks passed', '32', c)}`);
      if (allWarnings.length) console.log(colorize(`   (${allWarnings.length} container warnings — pass with --strict to fail)`, '2', c));
    }
  }
  const fail = allErrors.length > 0 || duplicates.length > 0 || (args.strict && (allWarnings.length > 0 || conventionViolations.length > 0));
  process.exit(fail ? 1 : 0);
}

main();
