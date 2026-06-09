#!/usr/bin/env node
// opal-mirror — pulls Claude / ChatGPT / Gemini / DeepSeek / Doubao / Qwen
// conversation history from your already-logged-in Chrome via a CDP proxy.
//
// Usage: node sync.mjs [all|claude|chatgpt|gemini|deepseek|doubao|qwen]
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
  console.log(`opal-mirror — sync Claude / ChatGPT / Gemini history from Chrome.

Usage:
  node sync.mjs [target] [--no-index]
    target = all | claude | chatgpt | gemini | deepseek | doubao | qwen  (default: all)
    --no-index   skip auto-rebuild of INDEX.md after sync

Environment:
  AI_CHAT_ARCHIVE_DIR        output dir  (current: ${ROOT})
  CDP_PROXY                  proxy URL   (current: ${PROXY})

Prereqs:
  1. Chrome running with --remote-debugging-port=9222
  2. CDP proxy server running on \${CDP_PROXY}
  3. You logged into claude.ai / chatgpt.com / gemini.google.com / chat.deepseek.com / www.doubao.com / www.qianwen.com in that Chrome

  Run \`node doctor.mjs\` to verify all of the above.
`);
  process.exit(0);
}

async function listTargets() {
  let r;
  try {
    r = await fetch(`${PROXY}/targets`, { signal: AbortSignal.timeout(3000) });
  } catch (e) {
    console.error(`\n✗ Cannot reach CDP proxy at ${PROXY}`);
    console.error(`  Reason: ${e.message}`);
    console.error(`\nFix:`);
    console.error(`  1. Make sure Chrome is running with --remote-debugging-port=9222`);
    console.error(`  2. Make sure your CDP→HTTP proxy is up on ${PROXY}`);
    console.error(`  3. Run \`node doctor.mjs\` to diagnose\n`);
    process.exit(2);
  }
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

// ---------- DeepSeek ----------
// chat.deepseek.com — token from localStorage('userToken'), Bearer auth.
// list:   GET /api/v0/chat_session/fetch_page?count=50&before_seq_id=<last>
// detail: GET /api/v0/chat/history_messages?chat_session_id=<id>
// 注意: 分页参数是 before_seq_id (不是 seq_id — seq_id 会被忽略导致每页都返回第一页)。
async function syncDeepSeek() {
  const t = await findTarget(x => x.url.startsWith('https://chat.deepseek.com'));
  if (!t) throw new Error('no chat.deepseek.com tab open — log into chat.deepseek.com in Chrome first');
  console.log(`[deepseek] using tab ${t.targetId}`);

  const tokenRaw = await evalIn(t.targetId,
    `(()=>{try{return JSON.parse(localStorage.getItem("userToken"))?.value||""}catch(e){return ""}})()`);
  if (!tokenRaw) {
    console.log('[deepseek] no userToken in localStorage — sign in to chat.deepseek.com first');
    return 0;
  }
  console.log(`[deepseek] token ok (${tokenRaw.slice(0,8)}...)`);

  // 1. list sessions, dedupe by id (defensive)
  const seen = new Set();
  const sessions = [];
  let beforeSeq = null, page = 0;
  while (page < 200) {
    const params = `count=50${beforeSeq ? `&before_seq_id=${beforeSeq}` : ''}`;
    const raw = await evalIn(t.targetId,
      `fetch("/api/v0/chat_session/fetch_page?${params}",{headers:{"Authorization":"Bearer ${tokenRaw}"},credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify(d))`);
    const j = JSON.parse(raw);
    const data = j?.data?.biz_data || {};
    const batch = data.chat_sessions || [];
    if (batch.length === 0) break;

    const fresh = batch.filter(s => !seen.has(s.id));
    fresh.forEach(s => seen.add(s.id));
    sessions.push(...fresh);

    page++;
    beforeSeq = batch[batch.length - 1].seq_id;
    if (!data.has_more) break;
  }
  console.log(`[deepseek] ${sessions.length} unique sessions`);

  // 2. fetch each session's messages
  let total = 0, skipped = 0;
  for (const s of sessions) {
    const file = path.join(ROOT, 'deepseek', `${s.id}.json`);
    try {
      const existing = JSON.parse(await fs.readFile(file, 'utf8'));
      if (existing.updated_at === s.updated_at) { skipped++; continue; }
    } catch {}

    const raw = await evalIn(t.targetId,
      `fetch("/api/v0/chat/history_messages?chat_session_id=${s.id}",{headers:{"Authorization":"Bearer ${tokenRaw}"},credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify(d))`);
    const j = JSON.parse(raw);
    const detail = j?.data?.biz_data || {};
    const record = {
      id: s.id,
      title: s.title || '',
      title_type: s.title_type,
      inserted_at: s.inserted_at,
      updated_at: s.updated_at,
      model_type: s.model_type,
      agent: s.agent,
      version: s.version,
      chat_session: detail.chat_session || s,
      chat_messages: detail.chat_messages || [],
    };
    await writeJSON(file, record);
    total++;
    process.stdout.write(`  + ${(s.title||s.id).slice(0,50)} (${record.chat_messages.length} msgs)\n`);
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[deepseek] saved ${total} new, skipped ${skipped} unchanged`);
  return total;
}

// ---------- 豆包 (Doubao) ----------
// www.doubao.com — cookies (incl. HttpOnly sessionid) auto-sent by browser.
// list:   POST /samantha/thread/list  → {data: {thread_list, has_more}}
// detail: POST /im/chain/single  cmd=3100, anchor_index=MAX_SAFE_INTEGER, direction=1
async function syncDoubao() {
  const t = await findTarget(x => x.url.startsWith('https://www.doubao.com'));
  if (!t) throw new Error('no www.doubao.com tab open — log into www.doubao.com in Chrome first');
  console.log(`[doubao] using tab ${t.targetId}`);

  // common params豆包所有内部 API 都需要的查询字符串
  const COMMON = `version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&samantha_web=1&use-olympus-account=1`;

  // 1. list threads (按需分页，目前只看到 has_more 字段)
  const threads = [];
  let cursor = null, pageNum = 0;
  while (pageNum < 50) {
    const bodyJson = JSON.stringify(cursor ? { count: 50, cursor } : { count: 50 });
    const raw = await evalIn(t.targetId, `
      fetch("/samantha/thread/list?${COMMON}",{
        method:"POST",
        credentials:"include",
        headers:{"content-type":"application/json","agw-js-conv":"str"},
        body: ${JSON.stringify(bodyJson)}
      }).then(r=>r.json()).then(d=>JSON.stringify(d))
    `.trim());
    const j = JSON.parse(raw);
    const data = j?.data || {};
    const batch = data.thread_list || [];
    if (batch.length === 0) break;
    threads.push(...batch);
    pageNum++;
    if (!data.has_more) break;
    // cursor 字段名待确认，简单先用 thread_id_str
    cursor = batch[batch.length - 1]?.thread_id_str || batch[batch.length - 1]?.thread_id;
  }
  console.log(`[doubao] ${threads.length} thread(s)`);

  // 2. fetch each thread's messages (paginated by anchor_index)
  let total = 0, skipped = 0;
  for (const th of threads) {
    const conv = th.conversation || {};
    const cid = conv.conversation_id;
    const ctype = conv.conversation_type ?? 3;
    if (!cid) continue;

    const file = path.join(ROOT, 'doubao', `${cid}.json`);
    try {
      const existing = JSON.parse(await fs.readFile(file, 'utf8'));
      if (existing.update_time === conv.update_time) { skipped++; continue; }
    } catch {}

    // 翻页拉所有消息
    const allMsgs = [];
    const seenMsg = new Set();
    let anchor = 9007199254740991;  // Number.MAX_SAFE_INTEGER
    while (true) {
      const bodyJson = JSON.stringify({
        cmd: 3100,
        uplink_body: {
          pull_singe_chain_uplink_body: {
            conversation_id: cid,
            anchor_index: anchor,
            conversation_type: ctype,
            direction: 1,
            limit: 50,
            ext: {},
            filter: { index_list: [] },
          }
        },
        sequence_id: `${cid}-${anchor}`,
        channel: 2,
        version: "1",
      });
      const raw = await evalIn(t.targetId, `
        fetch("/im/chain/single?${COMMON}",{
          method:"POST",
          credentials:"include",
          headers:{"content-type":"application/json; encoding=utf-8","agw-js-conv":"str"},
          body: ${JSON.stringify(bodyJson)}
        }).then(r=>r.json()).then(d=>JSON.stringify(d))
      `.trim());
      const j = JSON.parse(raw);
      const msgs = j?.downlink_body?.pull_singe_chain_downlink_body?.messages || [];
      if (msgs.length === 0) break;
      const fresh = msgs.filter(m => !seenMsg.has(m.message_id));
      if (fresh.length === 0) break;
      fresh.forEach(m => seenMsg.add(m.message_id));
      allMsgs.push(...fresh);
      // 下一页 anchor = 本批最小 index_in_conv
      const indices = fresh.map(m => Number(m.index_in_conv || 0)).filter(n => n > 0);
      if (indices.length === 0) break;
      const minIdx = Math.min(...indices);
      if (minIdx <= 1) break;
      anchor = minIdx;
      await new Promise(r => setTimeout(r, 150));
    }
    // 时间正序
    allMsgs.sort((a, b) => Number(a.index_in_conv || 0) - Number(b.index_in_conv || 0));

    const record = {
      thread_id: th.thread_id_str || th.thread_id,
      conversation_id: cid,
      conversation_type: ctype,
      name: conv.name || '',
      bot_id: conv.bot_id,
      update_time: conv.update_time,
      message_index: conv.message_index,
      messages: allMsgs,
    };
    await writeJSON(file, record);
    total++;
    process.stdout.write(`  + ${(conv.name || cid).slice(0,50)} (${allMsgs.length} msgs)\n`);
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[doubao] saved ${total} new, skipped ${skipped} unchanged`);
  return total;
}

// ---------- 千问 (Qwen) ----------
// www.qianwen.com — API 在跨域子域 chat2-api.qianwen.com 上
// list:   GET /api/v1/session/list?...&ut=<localStorage.qianwen-uniq-id>
// detail: GET /api/v1/session/msg/list?...&session_id=X&page_size=50&page=N
async function syncQwen() {
  const t = await findTarget(x => x.url.startsWith('https://www.qianwen.com') || x.url.startsWith('https://qianwen.com'));
  if (!t) throw new Error('no www.qianwen.com tab open — log into www.qianwen.com in Chrome first');
  console.log(`[qwen] using tab ${t.targetId}`);

  const ut = await evalIn(t.targetId, `localStorage.getItem('qianwen-uniq-id') || ''`);
  if (!ut) {
    console.log('[qwen] qianwen-uniq-id missing in localStorage — sign in to www.qianwen.com first');
    return 0;
  }
  console.log(`[qwen] ut=${ut.slice(0,8)}...`);

  const API = 'https://chat2-api.qianwen.com';
  const COMMON = `biz_id=ai_qwen&chat_client=h5&device=pc&fr=pc&pr=qwen&ut=${ut}`;

  // 1. 列出所有 sessions
  const sessions = [];
  let pageNum = 1;
  while (pageNum < 100) {
    const raw = await evalIn(t.targetId,
      `fetch("${API}/api/v1/session/list?${COMMON}&page_size=50&page=${pageNum}",{credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify(d))`);
    const j = JSON.parse(raw);
    const batch = j?.data?.list || [];
    if (batch.length === 0) break;
    sessions.push(...batch);
    if (!j.data.have_next_page) break;
    pageNum++;
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[qwen] ${sessions.length} session(s)`);

  // 2. 逐 session 拉消息记录
  let total = 0, skipped = 0;
  for (const s of sessions) {
    const sid = s.session_id;
    const file = path.join(ROOT, 'qwen', `${sid}.json`);
    try {
      const existing = JSON.parse(await fs.readFile(file, 'utf8'));
      if (existing.updated_at === s.updated_at) { skipped++; continue; }
    } catch {}

    const records = [];
    let mp = 1;
    while (mp < 50) {
      const raw = await evalIn(t.targetId,
        `fetch("${API}/api/v1/session/msg/list?${COMMON}&session_id=${sid}&page_size=50&page=${mp}&return_response_messages=true&event_filter=all&forward=false&include_pos=false",{credentials:"include"}).then(r=>r.json()).then(d=>JSON.stringify(d))`);
      const j = JSON.parse(raw);
      const batch = j?.data?.list || j?.data || [];
      const arr = Array.isArray(batch) ? batch : [];
      if (arr.length === 0) break;
      records.push(...arr);
      if (arr.length < 50) break;
      mp++;
      await new Promise(r => setTimeout(r, 150));
    }

    await writeJSON(file, {
      session_id: sid,
      title: s.title || '',
      created_at: s.created_at,
      updated_at: s.updated_at,
      type: s.type,
      records,
    });
    total++;
    process.stdout.write(`  + ${(s.title || sid).slice(0,50)} (${records.length} records)\n`);
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[qwen] saved ${total} new, skipped ${skipped} unchanged`);
  return total;
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
const args = process.argv.slice(2);
const noIndex = args.includes('--no-index');
const which = args.find(a => !a.startsWith('-')) || 'all';

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
try {
  if (which === 'all' || which === 'deepseek') result.deepseek = await syncDeepSeek();
} catch (e) { console.error('[deepseek] FAILED:', e.message); result.deepseek = -1; }
try {
  if (which === 'all' || which === 'doubao') result.doubao = await syncDoubao();
} catch (e) { console.error('[doubao] FAILED:', e.message); result.doubao = -1; }
try {
  if (which === 'all' || which === 'qwen') result.qwen = await syncQwen();
} catch (e) { console.error('[qwen] FAILED:', e.message); result.qwen = -1; }

// Auto-rebuild INDEX.md if anything was actually saved (skip on --no-index).
const totalSaved = Object.values(result).reduce((s, n) => s + (n > 0 ? n : 0), 0);
if (totalSaved > 0 && !noIndex) {
  console.log(`\n[index] rebuilding INDEX.md (${totalSaved} new conversation(s))...`);
  const { spawn } = await import('node:child_process');
  await new Promise((resolve) => {
    const p = spawn('node', [path.join(__dirname, 'build_index.mjs')], { stdio: 'inherit' });
    p.on('close', resolve);
  });
}

console.log('\n=== SUMMARY ===');
console.log(`output dir: ${ROOT}`);
console.log(JSON.stringify(result, null, 2));
