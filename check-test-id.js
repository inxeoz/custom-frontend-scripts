#!/usr/bin/env node
/**
 * check-test-ids.js — ponytail-lean
 * Single read per file, pre-compiled excludes, no dead wildcard tracking.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SRC = path.resolve(process.cwd(), 'src');
const INTERACTIVE = ['button','input','select','textarea','form'];
const CONTAINERS = ['table','nav','section','dialog','article','aside','header','footer','main'];
const TEXT_DERIVED_SCOPES = ['btn','link','heading','th','label','option','tab','li','sort-column'];
const CONTAINER_SCOPES = new Set(['card','section','modal','dialog','table','form','nav','page','wrapper','container','body','header','footer','overlay','sidebar','strip','list','group','row']);
const VOID_ELEMENTS = new Set(['input','img','br','hr','meta','link','area','base','col','embed','source','track','wbr']);

// --- CLI ---
function parseArgs(argv){
  const a={src:DEFAULT_SRC, json:false, color:true, strict:false, excludes:[], help:false};
  for(let i=2;i<argv.length;i++){
    const v=argv[i];
    if(v==='--help'||v==='-h') a.help=true;
    else if(v==='--json') a.json=true;
    else if(v==='--no-color') a.color=false;
    else if(v==='--strict') a.strict=true;
    else if(v==='--src'&&argv[i+1]) a.src=path.resolve(argv[++i]);
    else if(v.startsWith('--src=')) a.src=path.resolve(v.slice(6));
    else if(v==='--exclude'&&argv[i+1]) a.excludes.push(argv[++i]);
    else if(v.startsWith('--exclude=')) a.excludes.push(v.slice(10));
  }
  if(process.env.NO_COLOR) a.color=false;
  if(!process.stdout.isTTY) a.color=false;
  a.excludeRes = a.excludes.map(globToRegExp);
  return a;
}
function printHelp(){
  console.log(`
Usage: node scripts/check-test-ids.js [options]
Options:
  --src <dir>        Source directory (default: src)
  --json             Output JSON instead of pretty text (CI friendly)
  --no-color         Disable colors
  --strict           Fail on warnings & convention violations too
  --exclude <glob>   Exclude paths (repeatable, e.g. --exclude "**/generated/**")
  -h, --help         Show help
Ignore directives: <!-- check-test-ids-ignore --> (file), <!-- check-test-ids-ignore-next-line -->, data-testid-ignore (element)
Conventions: interactive <${INTERACTIVE.join(', ')}> must have data-testid; containers <${CONTAINERS.join(', ')}> warned; data-testid "<filename>:<scope>-<kebab>"`.trim());
}
function globToRegExp(g){
  let r=g.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*\*/g,'§§').replace(/\*/g,'[^/]*').replace(/§§/g,'.*').replace(/\?/g,'[^/]');
  return new RegExp('^'+r+'$');
}
function isExcluded(rel, full, excludeRes, excludes){
  if(!excludes.length) return false;
  for(let i=0;i<excludes.length;i++){
    const g=excludes[i], re=excludeRes[i];
    if(re.test(rel)||re.test(path.basename(rel))) return true;
    if(!g.includes('*')&&!g.includes('?')&&(rel.includes(g)||full.includes(g))) return true;
  }
  return false;
}
function toKebab(s){
  return s.trim().replace(/\{\{[^}]*\}\}/g,'').replace(/\$\{[^}]*\}/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/&[a-zA-Z0-9#]+;/g,' ').replace(/[^a-zA-Z0-9\s-]/g,'').trim().toLowerCase().replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
}
const ATTR_RE = (name)=> new RegExp(name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')','i');
function getAttr(attrs,name){
  const m=attrs.match(ATTR_RE(name));
  return m ? (m[1]!==undefined?m[1]:m[2]) : null;
}
// nearest closing tag — ponytail: depth tracking rarely needed for btn/th scope
function extractInnerText(content, openEndPos, tagName){
  const closeTag='</'+tagName+'>';
  const end=content.indexOf(closeTag, openEndPos+1);
  if(end===-1) return '';
  let t=content.slice(openEndPos+1,end);
  t=t.replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]+>/g,' ').replace(/&[a-zA-Z0-9#]+;/g,' ');
  return t.replace(/\s+/g,' ').trim();
}
function collectHtmlFiles(srcDir, excludes, excludeRes){
  const files=[];
  if(!fs.existsSync(srcDir)){ console.error(`src dir not found: ${srcDir}`); return files; }
  function walk(dir){
    let entries; try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
    for(const e of entries){
      const full=path.join(dir,e.name), rel=path.relative(srcDir,full);
      if(isExcluded(rel, full, excludeRes, excludes)) continue;
      if(e.isDirectory()){ walk(full); continue; }
      if(!e.name.endsWith('.html')||e.name==='index.html') continue;
      files.push(full);
    }
  }
  walk(srcDir); return files;
}
function findTags(content){
  const res=[], len=content.length; let i=0, line=1;
  while(i<len){
    if(content[i]==='\n'){line++; i++; continue;}
    if(content.startsWith('<!--',i)){
      const end=content.indexOf('-->',i+4); if(end===-1) break;
      const chunk=content.slice(i,end+3); line+=(chunk.match(/\n/g)||[]).length; i=end+3; continue;
    }
    if(content[i]==='<'&&i+1<len&&/[a-zA-Z]/.test(content[i+1])){
      const tagLine=line, tagStart=i; i++; let name='';
      while(i<len&&/[\w-]/.test(content[i])){name+=content[i]; i++;}
      if(name.startsWith('/')) continue;
      name=name.toLowerCase();
      let inD=false,inS=false,attrs='',closed=false;
      while(i<len){
        const ch=content[i]; if(ch==='\n') line++;
        if(inD){ if(ch==='"') inD=false; attrs+=ch; i++; continue; }
        if(inS){ if(ch==="'") inS=false; attrs+=ch; i++; continue; }
        if(ch==='"'){inD=true; attrs+=ch; i++; continue;}
        if(ch==="'"){inS=true; attrs+=ch; i++; continue;}
        if(ch==='>'){i++; closed=true; break;}
        attrs+=ch; i++;
      }
      if(!closed) continue;
      res.push({name, attrs, line:tagLine, start:tagStart, end:i});
    } else i++;
  }
  return res;
}
function getIgnoredLines(content){
  const s=new Set(), lines=content.split('\n');
  for(let i=0;i<lines.length;i++) if(lines[i].includes('check-test-ids-ignore-next-line')) s.add(i+2);
  return s;
}
function processFile(filePath, content){
  if(/<!--\s*check-test-ids-ignore\s*-->/.test(content)) return {errors:[],warnings:[]};
  const ignored=getIgnoredLines(content), tags=findTags(content), errors=[], warnings=[];
  for(const tag of tags){
    if(ignored.has(tag.line)) continue;
    if(/\bdata-testid-ignore\b/.test(tag.attrs)) continue;
    if(/\bdata-testid\s*=\s*(?:"[^"]*"|'[^']*')/.test(tag.attrs)) continue;
    if(/\[attr\.data-testid\]\s*=\s*(?:"[^"]*"|'[^']*')/.test(tag.attrs)) continue;
    const href=getAttr(tag.attrs,'href');
    if(href&&/^(https?:\/\/|mailto:|tel:|#)/.test(href.trim())) continue;
    const isInteractive = INTERACTIVE.includes(tag.name) || (getAttr(tag.attrs,'role')==='button'&&tag.name!=='button');
    const suggestion = path.basename(filePath, path.extname(filePath))+':'+(tag.name==='a'?'link':tag.name)+'-...';
    if(isInteractive) errors.push({file:filePath,line:tag.line,tag:tag.name,suggestion});
    else if(CONTAINERS.includes(tag.name)) warnings.push({file:filePath,line:tag.line,tag:tag.name,suggestion});
  }
  return {errors, warnings};
}
function checkDuplicates(cache){
  const map=new Map();
  const staticRe=/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
  for(const [file, content] of cache){
    // skip file-ignored (keep logic consistent with processFile)
    if(/<!--\s*check-test-ids-ignore\s*-->/.test(content)) continue;
    for(const m of content.matchAll(staticRe)){
      const id=m[1]??m[2];
      if(!map.has(id)) map.set(id,[]);
      // line via quick split count (few ids per file, O(n) ok)
      const line=(content.slice(0,m.index).match(/\n/g)||[]).length+1;
      map.get(id).push({file, line});
    }
  }
  const dupes=[]; for(const [id, locs] of map) if(locs.length>1) dupes.push({id, locations:locs});
  return {total:map.size, duplicates:dupes};
}
function checkConventions(cache){
  const violations=[];
  for(const [file, content] of cache){
    if(/<!--\s*check-test-ids-ignore\s*-->/.test(content)) continue;
    const ignored=getIgnoredLines(content);
    const filename=path.basename(file, path.extname(file)), prefix=filename+':';
    const tags=findTags(content);
    const re=/data-testid\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
    let m; while((m=re.exec(content))!==null){
      const testId=m[1]??m[2], idx=m.index;
      const line=(content.slice(0,idx).match(/\n/g)||[]).length+1;
      if(ignored.has(line)) continue;
      if(!testId.startsWith(prefix)) continue;
      const rest=testId.slice(prefix.length);
      if(rest.includes("'-")||rest.includes("' + ")||rest.endsWith("-'")||rest.includes('*')) continue;
      const sm=rest.match(/^([a-z][a-z0-9]*)-/); if(!sm) continue;
      const scope=sm[1], currentDesc=rest.slice(scope.length+1);
      if(CONTAINER_SCOPES.has(scope)) continue;
      if(!TEXT_DERIVED_SCOPES.includes(scope)) continue;
      let owner=null;
      for(let t=tags.length-1;t>=0;t--) if(tags[t].start<idx&&tags[t].end>idx){owner=tags[t];break;} else if(tags[t].end<idx) break;
      let openingTag, tagOpenEnd, tagNameForVoid;
      if(owner){ openingTag=content.slice(owner.start,owner.end); tagOpenEnd=owner.end-1; tagNameForVoid=scope==='sort-column'?'th':owner.name; }
      else {
        const s=content.lastIndexOf('<',idx), e=content.indexOf('>',s);
        if(e===-1) continue; openingTag=content.slice(s,e+1); tagOpenEnd=e; tagNameForVoid=scope==='sort-column'?'th':openingTag.split(/\s/)[0].replace('<','').toLowerCase();
      }
      if(VOID_ELEMENTS.has(tagNameForVoid)) continue;
      let expected=null;
      const inner=extractInnerText(content, tagOpenEnd, tagNameForVoid);
      if(inner&&inner.length<=40) expected=toKebab(inner);
      else if(scope==='input'){ const ph=getAttr(openingTag,'placeholder'); if(ph&&ph.length<=40) expected=toKebab(ph); }
      else if(scope==='icon'||scope==='img'){ const al=getAttr(openingTag,'aria-label'); if(al&&al.length<=40) expected=toKebab(al); }
      if(expected&&expected!==currentDesc&&expected!=='') violations.push({file,line,testId,currentDesc,expected});
    }
  }
  return violations;
}
function colorize(s, code, en){ return en?`\x1b[${code}m${s}\x1b[0m`:s; }
function main(){
  const args=parseArgs(process.argv);
  if(args.help){ printHelp(); process.exit(0); }
  const files=collectHtmlFiles(args.src, args.excludes, args.excludeRes);
  const cache=new Map(files.map(f=>[f, fs.readFileSync(f,'utf-8')]));
  const rel=f=>path.relative(args.src,f);
  const allE=[], allW=[];
  for(const [f, c] of cache){ const {errors, warnings}=processFile(f,c); allE.push(...errors); allW.push(...warnings); }
  const {total, duplicates}=checkDuplicates(cache);
  const violations=checkConventions(cache);
  if(args.json){
    console.log(JSON.stringify({filesScanned:files.length, uniqueTestIds:total, duplicates, missingInteractive:allE, missingContainers:allW, conventionViolations:violations},null,2));
  } else {
    const c=args.color;
    console.log(`\n${colorize('🔍 data-testid validation','1',c)}`);
    console.log(`   Files scanned: ${files.length}`); console.log(`   Unique test IDs: ${total}`);
    if(args.excludes.length) console.log(`   Excludes: ${args.excludes.join(', ')}`);
    if(duplicates.length){ console.log(`\n${colorize(`❌ DUPLICATE TEST IDs (${duplicates.length}):`,'31',c)}`); for(const d of duplicates){ console.log(`   "${d.id}" (${d.locations.length}×):`); for(const l of d.locations) console.log(`     ${rel(l.file)}:${l.line}`);} }
    if(allE.length){ console.log(`\n${colorize(`❌ Missing test-id on interactive elements (${allE.length}):`,'31',c)}`); for(const v of allE) console.log(`   ${rel(v.file)}:${v.line} — <${v.tag}>  → add ${colorize(v.suggestion,'2',c)}`); }
    if(allW.length){ console.log(`\n${colorize(`⚠️  Missing test-id on containers (${allW.length}):`,'33',c)}`); for(const v of allW) console.log(`   ${rel(v.file)}:${v.line} — <${v.tag}>  → add ${colorize(v.suggestion,'2',c)}`); }
    if(violations.length){ console.log(`\n${colorize(`⚠️  Description should derive from visible text (${violations.length}):`,'33',c)}`); for(const v of violations){ console.log(`   ${rel(v.file)}:${v.line} — ${v.testId}`); console.log(`     current: ${v.currentDesc} → expected: ${v.expected}`);} }
    if(!allE.length&&!duplicates.length&&!violations.length){ console.log(`\n${colorize('✅ All checks passed','32',c)}`); if(allW.length) console.log(colorize(`   (${allW.length} container warnings — pass with --strict to fail)`,'2',c)); }
  }
  process.exit(allE.length||duplicates.length||(args.strict&&(allW.length||violations.length))?1:0);
}
main();
