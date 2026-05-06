#!/usr/bin/env node
// chat-history-sync — pulls Claude / ChatGPT / Gemini conversation history
// from your already-logged-in Chrome via a CDP proxy.
//
// Usage: node sync.mjs [all|claude|chatgpt|gemini]
// Env:   AI_CHAT_ARCHIVE_DIR  output directory (default: <script-dir>/ai-chat-archive)
//        CDP_PROXY            CDP proxy URL    (default: http://localhost:3456)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY = process.env.CDP_PROXY || 'http://localhost:3456';
// Default: data dir co-located with the script. Override via AI_CHAT_ARCHIVE_DIR.
const ROOT = process.env.AI_CHAT_ARCHIVE_DIR || path.join(__dirname, 'ai-chat-archive');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`chat-history-sync — sync Claude / ChatGPT / Gemini history from Chrome.

Usage:
  node sync.mjs [target]     target = all | claude | chatgpt | gemini  (default: all)

Environment:
  AI_CHAT_ARCHIVE_DIR        output dir  (current: ${ROOT})
  CDP_PROXY                  proxy URL   (current: ${PROXY})

Prereqs:
  1. Chrome running with --remote-debugging-port=9222
  2. CDP proxy server running on \${CDP_PROXY}
  3. You logged into claude.ai / chatgpt.com / gemini.google.com in that Chrome
`);
  process.exit(0);
}

async function listTargets() {
  const r = await fetch(`${PROXY}/targets`);
  return r.json();
}

async function evalIn(targetId, expr) {
  const r = await fetch(`${PROXY}/eval?target=${targetId}`, { method: 'POST', body: expr });
  const j = await r.json();
  if (j.error) throw new Error(`eval error: ${j.error} :: ${j.message || ''} :: ${expr.slice(0, 120)}`);
  return j.value;
}

async function findTarget(matcher) {
  const targets = await listTargets();
  return targets.find(matcher);
}

async function openTab(url) {
  const r = await fetch(`${PROXY}/new?url=${encodeURIComponent(url)}`);
  const j = await r.json();
  await new Promise(res => setTimeout(res, 4000));
  return j.targetId;
}

async function writeJSON(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ---------- Claude ----------
async function syncClaude() {
  const t = await findTarget(x => x.url.startsWith('https://claude.ai'));
  if (!t) throw new Error('no claude.ai tab open — log into claude.ai in Chrome first');
  console.log(`[claude] using tab ${t.targetId}`);

  const orgsRaw = await evalIn(t.targetId,
    `fetch("/api/organizations",{credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify(d.map(o=>({uuid:o.uuid,name:o.name}))))`);
  const orgs = JSON.parse(orgsRaw);
  console.log(`[claude] orgs: ${orgs.map(o => o.name).join(', ')}`);

  let total = 0;
  for (const org of orgs) {
    const listRaw = await evalIn(t.targetId,
      `fetch("/api/organizations/${org.uuid}/chat_conversations",{credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify(d.map(c=>({uuid:c.uuid,name:c.name,updated_at:c.updated_at,created_at:c.created_at}))))`);
    const list = JSON.parse(listRaw);
    console.log(`[claude] org ${org.name}: ${list.length} conversations`);

    for (const c of list) {
      const file = path.join(ROOT, 'claude', `${c.uuid}.json`);
      try {
        const existing = JSON.parse(await fs.readFile(file, 'utf8'));
        if (existing.updated_at === c.updated_at) continue;
      } catch {}

      const detailRaw = await evalIn(t.targetId,
        `fetch("/api/organizations/${org.uuid}/chat_conversations/${c.uuid}?tree=True&rendering_mode=raw",{credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify(d))`);
      const detail = JSON.parse(detailRaw);
      detail._org = { uuid: org.uuid, name: org.name };
      await writeJSON(file, detail);
      total++;
      process.stdout.write(`  + ${c.name?.slice(0, 50) || c.uuid}\n`);
    }
  }
  console.log(`[claude] saved ${total} conversation(s)`);
  return total;
}

// ---------- ChatGPT ----------
async function syncChatGPT() {
  let t = await findTarget(x => x.url.startsWith('https://chatgpt.com') || x.url.startsWith('https://chat.openai.com'));
  if (!t) {
    console.log('[chatgpt] opening chatgpt.com (no existing tab)...');
    const id = await openTab('https://chatgpt.com/');
    t = { targetId: id };
  }
  console.log(`[chatgpt] using tab ${t.targetId}`);

  const sessRaw = await evalIn(t.targetId,
    `fetch("/api/auth/session",{credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify({hasToken:!!d.accessToken,user:d.user&&d.user.email}))`);
  const sessInfo = JSON.parse(sessRaw);
  console.log(`[chatgpt] session: ${JSON.stringify(sessInfo)}`);
  if (!sessInfo.hasToken) {
    console.log('[chatgpt] not logged in — open chatgpt.com in Chrome and sign in');
    return 0;
  }

  // Page-side helper: returns {status, body}. Caller checks status to detect rate limits.
  const apiCall = (urlPath) => `
    (async () => {
      const s = await fetch("/api/auth/session",{credentials:"include"}).then(r=>r.json());
      const r = await fetch("${urlPath}", {
        credentials:"include",
        headers: {"Authorization": "Bearer " + s.accessToken}
      });
      return JSON.stringify({status: r.status, body: await r.text()});
    })()
  `.trim();

  async function chatgptFetch(urlPath, label) {
    let delay = 2000;
    for (let attempt = 0; attempt < 6; attempt++) {
      const raw = await evalIn(t.targetId, apiCall(urlPath));
      const { status, body } = JSON.parse(raw);
      if (status === 200) return JSON.parse(body);
      if (status === 429 || status >= 500) {
        process.stdout.write(`    [retry ${attempt+1}] ${label} got ${status}, waiting ${delay}ms\n`);
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30000);
        continue;
      }
      throw new Error(`${label} HTTP ${status}: ${body.slice(0,200)}`);
    }
    throw new Error(`${label} failed after 6 retries`);
  }

  let offset = 0;
  const limit = 100;
  const allConvos = [];
  while (true) {
    const page = await chatgptFetch(`/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`, `list@${offset}`);
    if (!page.items || page.items.length === 0) break;
    allConvos.push(...page.items);
    if (allConvos.length >= page.total) break;
    offset += page.items.length;
  }
  console.log(`[chatgpt] ${allConvos.length} conversations total`);

  let total = 0, skipped = 0, consecutiveFails = 0;
  for (const c of allConvos) {
    const file = path.join(ROOT, 'chatgpt', `${c.id}.json`);
    try {
      const existing = JSON.parse(await fs.readFile(file, 'utf8'));
      if (existing.mapping && existing.update_time === c.update_time) { skipped++; continue; }
    } catch {}

    let detail;
    try {
      detail = await chatgptFetch(`/backend-api/conversation/${c.id}`, c.id.slice(0,8));
      consecutiveFails = 0;
    } catch (e) {
      consecutiveFails++;
      console.log(`    [skip] ${c.id.slice(0,8)}: ${e.message.slice(0,80)}`);
      if (consecutiveFails >= 5) {
        console.log(`[chatgpt] aborting — 5 consecutive failures (likely rate-limited; try again later)`);
        break;
      }
      continue;
    }
    if (!detail.mapping) {
      console.log(`    [skip] ${c.id.slice(0,8)}: response missing mapping`);
      continue;
    }
    await writeJSON(file, detail);
    total++;
    process.stdout.write(`  + ${(c.title || c.id).slice(0, 50)}\n`);
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`[chatgpt] saved ${total} new, skipped ${skipped} unchanged`);
  return total;
}

// ---------- Gemini ----------
// Gemini has no clean REST API. We scrape the sidebar then navigate into each
// conversation and read rendered transcripts from the DOM.
async function syncGemini() {
  let t = await findTarget(x => x.url.startsWith('https://gemini.google.com'));
  if (!t) {
    console.log('[gemini] opening gemini.google.com (no existing tab)...');
    const id = await openTab('https://gemini.google.com/app');
    t = { targetId: id };
  }
  console.log(`[gemini] using tab ${t.targetId}`);

  const listRaw = await evalIn(t.targetId,
    `(()=>{const a=[...document.querySelectorAll("conversations-list a[href*='/app/']")].map(x=>({href:x.href,id:x.href.split("/app/")[1]?.split(/[?#]/)[0],title:x.textContent.trim()}));return JSON.stringify(a);})()`);
  const list = JSON.parse(listRaw);
  console.log(`[gemini] sidebar lists ${list.length} conversation(s)`);

  let total = 0;
  for (const c of list) {
    if (!c.id) continue;
    const file = path.join(ROOT, 'gemini', `${c.id}.json`);

    await fetch(`${PROXY}/navigate?target=${t.targetId}&url=${encodeURIComponent(c.href)}`);
    let last = -1;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 600));
      const n = await evalIn(t.targetId, `document.querySelectorAll("user-query").length`);
      if (n === last && n > 0) break;
      last = n;
    }

    const turnsRaw = await evalIn(t.targetId, `
      (()=>{
        const nodes=[...document.querySelectorAll("user-query, model-response")];
        const turns=nodes.map(n=>{
          const role=n.tagName.toLowerCase()==="user-query"?"user":"model";
          let text=n.innerText.trim();
          text=text.replace(/^(You said|Gemini said|Show thinking)\\n+/g,"").replace(/^Show thinking\\n+/m,"");
          return {role,text};
        });
        return JSON.stringify(turns);
      })()
    `.trim());
    const turns = JSON.parse(turnsRaw);

    const record = {
      id: c.id,
      title: c.title,
      url: c.href,
      synced_at: new Date().toISOString(),
      turn_count: turns.length,
      turns,
    };
    await writeJSON(file, record);
    total++;
    process.stdout.write(`  + ${c.title.slice(0, 50)} (${turns.length} turns)\n`);
  }
  console.log(`[gemini] saved ${total} conversation(s)`);
  return total;
}

// ---------- Main ----------
const which = process.argv[2] || 'all';
const result = {};
try {
  if (which === 'all' || which === 'claude') result.claude = await syncClaude();
} catch (e) { console.error('[claude] FAILED:', e.message); result.claude = -1; }
try {
  if (which === 'all' || which === 'chatgpt') result.chatgpt = await syncChatGPT();
} catch (e) { console.error('[chatgpt] FAILED:', e.message); result.chatgpt = -1; }
try {
  if (which === 'all' || which === 'gemini') result.gemini = await syncGemini();
} catch (e) { console.error('[gemini] FAILED:', e.message); result.gemini = -1; }

console.log('\n=== SUMMARY ===');
console.log(`output dir: ${ROOT}`);
console.log(JSON.stringify(result, null, 2));
