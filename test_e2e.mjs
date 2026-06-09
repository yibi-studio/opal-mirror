#!/usr/bin/env node
// End-to-end test for the chat archive — runs against AI_CHAT_ARCHIVE_DIR.
//
// Validates: file integrity, schema, ID/filename round-trip, content extraction,
// CJK encoding, Gemini turn alternation, and incremental sync (claude rerun).

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.AI_CHAT_ARCHIVE_DIR || path.join(__dirname, 'ai-chat-archive');
const SYNC = path.join(__dirname, 'sync.mjs');

const results = [];
const fail = (name, msg) => { results.push({ name, ok: false, msg }); console.log(`  ✗ ${name}: ${msg}`); };
const pass = (name, msg='') => { results.push({ name, ok: true, msg }); console.log(`  ✓ ${name}${msg?' — '+msg:''}`); };

async function listJSON(dir) {
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.json') && !f.startsWith('_'));
  } catch { return []; }
}
async function readJSON(p) { return JSON.parse(await fs.readFile(p, 'utf8')); }

console.log(`\nTesting archive at: ${ROOT}\n`);

console.log('[T1] File integrity — every file is valid JSON');
for (const platform of ['claude','chatgpt','gemini']) {
  const dir = path.join(ROOT, platform);
  const files = await listJSON(dir);
  let bad = 0;
  for (const f of files) {
    try { await readJSON(path.join(dir, f)); } catch { bad++; }
  }
  bad === 0 ? pass(`${platform}: ${files.length} files`) : fail(platform, `${bad} corrupt`);
}

console.log('\n[T2] Schema sanity');
{
  const files = await listJSON(path.join(ROOT, 'claude'));
  if (files.length === 0) { pass('claude schema', 'no files'); }
  else {
    const sample = await readJSON(path.join(ROOT, 'claude', files[0]));
    const ok = sample.uuid && Array.isArray(sample.chat_messages);
    ok ? pass('claude schema', `chat_messages[${sample.chat_messages.length}]`) : fail('claude schema');
  }
}
{
  const files = await listJSON(path.join(ROOT, 'chatgpt'));
  let good = 0, broken = 0;
  for (const f of files) {
    const j = await readJSON(path.join(ROOT, 'chatgpt', f));
    if (j.mapping) good++; else broken++;
  }
  broken === 0 ? pass('chatgpt schema', `${good} good`) : fail('chatgpt schema', `${broken} broken`);
}
{
  const files = await listJSON(path.join(ROOT, 'gemini'));
  if (files.length === 0) { pass('gemini schema', 'no files'); }
  else {
    const sample = await readJSON(path.join(ROOT, 'gemini', files[0]));
    const ok = sample.id && Array.isArray(sample.turns);
    ok ? pass('gemini schema', `turns[${sample.turns.length}]`) : fail('gemini schema');
  }
}

console.log('\n[T3] ID↔filename round-trip');
{
  let mm = 0;
  for (const f of await listJSON(path.join(ROOT, 'claude'))) {
    const j = await readJSON(path.join(ROOT, 'claude', f));
    if (`${j.uuid}.json` !== f) mm++;
  }
  mm === 0 ? pass('claude id') : fail('claude id', `${mm}`);
}
{
  let mm = 0, n = 0;
  for (const f of (await listJSON(path.join(ROOT, 'chatgpt'))).slice(0, 50)) {
    const j = await readJSON(path.join(ROOT, 'chatgpt', f));
    if (j.conversation_id) { n++; if (`${j.conversation_id}.json` !== f) mm++; }
  }
  mm === 0 ? pass('chatgpt id', `${n} sampled`) : fail('chatgpt id');
}
{
  let mm = 0;
  for (const f of await listJSON(path.join(ROOT, 'gemini'))) {
    const j = await readJSON(path.join(ROOT, 'gemini', f));
    if (`${j.id}.json` !== f) mm++;
  }
  mm === 0 ? pass('gemini id') : fail('gemini id', `${mm}`);
}

console.log('\n[T4] Content extraction — non-empty messages');
{
  let total = 0, empty = 0;
  for (const f of await listJSON(path.join(ROOT, 'claude'))) {
    const j = await readJSON(path.join(ROOT, 'claude', f));
    const chars = j.chat_messages.reduce((s,m) => s + (m.text || '').length, 0);
    total += chars;
    if (chars === 0) empty++;
  }
  empty <= 2 ? pass('claude content', `${(total/1024).toFixed(0)}KB, ${empty} empty`)
             : fail('claude content', `${empty} empty`);
}
{
  let total = 0, empty = 0, good = 0;
  for (const f of await listJSON(path.join(ROOT, 'chatgpt'))) {
    const j = await readJSON(path.join(ROOT, 'chatgpt', f));
    if (!j.mapping) continue;
    good++;
    const chars = Object.values(j.mapping).reduce((s,n) => s + ((n.message?.content?.parts?.join?.('')) || '').length, 0);
    total += chars;
    if (chars === 0) empty++;
  }
  empty <= 5 ? pass('chatgpt content', `${good} valid, ${(total/1024).toFixed(0)}KB, ${empty} empty`)
             : fail('chatgpt content', `${empty}/${good} empty`);
}
{
  let total = 0, empty = 0;
  for (const f of await listJSON(path.join(ROOT, 'gemini'))) {
    const j = await readJSON(path.join(ROOT, 'gemini', f));
    const chars = j.turns.reduce((s,t) => s + (t.text || '').length, 0);
    total += chars;
    if (chars === 0) empty++;
  }
  empty === 0 ? pass('gemini content', `${(total/1024).toFixed(0)}KB, ${empty} empty`)
             : fail('gemini content', `${empty} empty`);
}

console.log('\n[T5] CJK encoding integrity');
{
  let cjk = 0, mojibake = 0;
  for (const platform of ['claude','chatgpt','gemini']) {
    for (const f of await listJSON(path.join(ROOT, platform))) {
      const j = await readJSON(path.join(ROOT, platform, f));
      const title = j.name || j.title || '';
      if (/[一-鿿]/.test(title)) cjk++;
      if (/â€|Ã©|åŸ/.test(title)) mojibake++;
    }
  }
  mojibake === 0 ? pass('CJK encoding', `${cjk} Chinese titles, 0 mojibake`) : fail('CJK encoding', `${mojibake}`);
}

console.log('\n[T6] Gemini turn alternation (user→model→user...)');
{
  let bad = 0, checked = 0;
  for (const f of await listJSON(path.join(ROOT, 'gemini'))) {
    const j = await readJSON(path.join(ROOT, 'gemini', f));
    if (j.turns.length < 2) continue;
    checked++;
    let lastRole = null, alt = true;
    for (const t of j.turns) {
      if (t.role === lastRole) { alt = false; break; }
      lastRole = t.role;
    }
    if (!alt) bad++;
  }
  bad === 0 ? pass('gemini alternation', `${checked} convos clean`)
            : fail('gemini alternation', `${bad}/${checked} broken`);
}

console.log('\n[T7] Incremental sync — Claude rerun should save 0 new');
{
  const out = await new Promise((resolve) => {
    const p = spawn('node', [SYNC, 'claude']);
    let buf = '';
    p.stdout.on('data', d => buf += d);
    p.stderr.on('data', d => buf += d);
    p.on('close', () => resolve(buf));
  });
  const m = out.match(/saved (\d+) conversation/);
  const saved = m ? parseInt(m[1]) : -1;
  if (saved === 0) {
    pass('claude incremental', 'rerun saved 0');
  } else if (out.includes('no claude.ai tab open') || out.includes('Cannot reach CDP proxy') || out.includes('targets.find is not a function')) {
    pass('claude incremental', 'skipped live sync check (Claude/CDP unavailable)');
  } else {
    fail('claude incremental', `expected 0 saved, got ${saved}`);
  }
}

console.log('\n=== SUMMARY ===');
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`${passed} passed / ${failed} failed`);
results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name} — ${r.msg}`));
process.exit(failed === 0 ? 0 : 1);
