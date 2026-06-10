#!/usr/bin/env node
// doctor.mjs — preflight check for opal-mirror.
// Verifies: Node version, CDP proxy reachability, Chrome debugging port,
// existing logged-in tabs, and login status per platform.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROXY = process.env.CDP_PROXY || 'http://localhost:3456';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const checks = [];
const ok = (name, msg='') => { checks.push({ name, ok: true, msg }); console.log(`  ✓ ${name}${msg?' — '+msg:''}`); };
const warn = (name, msg) => { checks.push({ name, ok: 'warn', msg }); console.log(`  ⚠ ${name} — ${msg}`); };
const fail = (name, msg) => { checks.push({ name, ok: false, msg }); console.log(`  ✗ ${name} — ${msg}`); };

console.log('opal-mirror — preflight check\n');

// 1. Node version
{
  const major = parseInt(process.versions.node.split('.')[0]);
  major >= 18 ? ok('Node ≥ 18', `you have v${process.versions.node}`)
              : fail('Node ≥ 18 required', `you have v${process.versions.node}`);
}

// 2. CDP proxy reachable
let targets = null;
try {
  const r = await fetch(`${PROXY}/targets`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  targets = await r.json();
  ok('CDP proxy reachable', `${PROXY} returned ${targets.length} targets`);
} catch (e) {
  fail('CDP proxy unreachable', `${PROXY} — ${e.message}`);
  console.log(`\n    Start your CDP proxy server, then re-run.`);
  console.log(`    The proxy must expose: GET /targets, POST /eval?target=, GET /new?url=, GET /navigate?target=&url=\n`);
}

// 3. Per-platform tab + login
if (targets) {
  const matchers = [
    {
      key: 'claude',
      name: 'Claude (claude.ai)',
      match: t => t.url.startsWith('https://claude.ai'),
      probe: tid => `fetch("/api/organizations",{credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify({ok:Array.isArray(d)&&d.length>0,orgs:d.length}))`,
    },
    {
      key: 'chatgpt',
      name: 'ChatGPT (chatgpt.com)',
      match: t => t.url.startsWith('https://chatgpt.com') || t.url.startsWith('https://chat.openai.com'),
      probe: tid => `fetch("/api/auth/session",{credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify({ok:!!d.accessToken,user:d.user&&d.user.email}))`,
    },
    {
      key: 'gemini',
      name: 'Gemini (gemini.google.com)',
      match: t => t.url.startsWith('https://gemini.google.com'),
      probe: tid => `JSON.stringify({ok:document.querySelectorAll("conversations-list a[href*='/app/']").length>=0,convos:document.querySelectorAll("conversations-list a[href*='/app/']").length})`,
    },
    {
      key: 'deepseek',
      name: 'DeepSeek (chat.deepseek.com)',
      match: t => t.url.startsWith('https://chat.deepseek.com'),
      probe: tid => `(()=>{try{const tk=JSON.parse(localStorage.getItem("userToken"))?.value;return JSON.stringify({ok:!!tk})}catch(e){return JSON.stringify({ok:false})}})()`,
    },
    {
      key: 'doubao',
      name: '豆包 (www.doubao.com)',
      match: t => t.url.startsWith('https://www.doubao.com'),
      probe: tid => `fetch("/samantha/thread/list?aid=497858",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:'{"count":1}'}).then(r=>r.json()).then(d=>JSON.stringify({ok:d.code===0,threads:(d.data&&d.data.thread_list||[]).length}))`,
    },
    {
      key: 'qwen',
      name: '千问 (www.qianwen.com)',
      match: t => t.url.startsWith('https://www.qianwen.com') || t.url.startsWith('https://qianwen.com'),
      probe: tid => `(()=>{const ut=localStorage.getItem("qianwen-uniq-id");return JSON.stringify({ok:!!ut,ut_prefix:ut?ut.slice(0,8):""})})()`,
    },
  ];

  for (const m of matchers) {
    const t = targets.find(m.match);
    if (!t) {
      warn(m.name, `no tab open — visit the site in your debugged Chrome to enable sync`);
      continue;
    }
    try {
      const evalR = await fetch(`${PROXY}/eval?target=${t.targetId}`, { method: 'POST', body: m.probe(t.targetId) });
      const j = await evalR.json();
      if (j.error) { warn(m.name, `tab open but probe failed: ${j.error}`); continue; }
      const result = JSON.parse(j.value);
      if (result.ok) {
        const meta = Object.entries(result).filter(([k]) => k !== 'ok').map(([k,v]) => `${k}=${v}`).join(', ');
        ok(m.name, `logged in${meta ? ', ' + meta : ''}`);
      } else {
        warn(m.name, `tab open but not logged in`);
      }
    } catch (e) {
      warn(m.name, `probe error: ${e.message}`);
    }
  }
}

// 4. Archive dir
const ROOT = process.env.AI_CHAT_ARCHIVE_DIR || path.join(__dirname, 'ai-chat-archive');
{
  const fs = await import('node:fs/promises');
  try {
    const stat = await fs.stat(ROOT);
    if (stat.isDirectory()) {
      const dirs = await fs.readdir(ROOT);
      const counts = {};
      for (const p of ['claude','chatgpt','gemini','deepseek','doubao','qwen']) {
        try {
          const files = await fs.readdir(path.join(ROOT, p));
          counts[p] = files.filter(f => f.endsWith('.json')).length;
        } catch { counts[p] = 0; }
      }
      ok('archive dir', `${ROOT} (${Object.entries(counts).map(([k,v])=>`${k}=${v}`).join(', ')})`);
    }
  } catch {
    warn('archive dir', `${ROOT} doesn't exist yet — will be created on first sync`);
  }
}

// Summary
const failed = checks.filter(c => c.ok === false).length;
const warned = checks.filter(c => c.ok === 'warn').length;
console.log(`\n${checks.length - failed - warned} ok, ${warned} warning(s), ${failed} failure(s)`);
process.exit(failed > 0 ? 1 : 0);
