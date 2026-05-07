#!/usr/bin/env node
// Validate Pixel Distill custom-agent export shape.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_ROOT = process.env.AI_CHAT_ARCHIVE_DIR || path.join(__dirname, 'ai-chat-archive');
const EXPORT_ROOT = process.env.PIXEL_DISTILL_AGENT_DIR || path.join(ARCHIVE_ROOT, 'pixel-distill-agent');
const SESSIONS_DIR = path.join(EXPORT_ROOT, 'sessions');

const results = [];
const pass = (name, msg='') => { results.push(true); console.log(`  ✓ ${name}${msg ? ' — ' + msg : ''}`); };
const fail = (name, msg) => { results.push(false); console.log(`  ✗ ${name} — ${msg}`); };

async function listJSONL() {
  try {
    const files = await fs.readdir(SESSIONS_DIR);
    return files.filter(f => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
}

function platformFromName(file) {
  if (file.includes('webchat:claude:')) return 'claude';
  if (file.includes('webchat:chatgpt:')) return 'chatgpt';
  if (file.includes('webchat:gemini:')) return 'gemini';
  return 'unknown';
}

console.log(`\nTesting Pixel Distill export at: ${EXPORT_ROOT}\n`);

const files = await listJSONL();
if (files.length > 0) pass('session files exist', `${files.length} jsonl`);
else fail('session files exist', 'no sessions/*.jsonl found; run node export_pixel_distill.mjs --clean');

const counts = {};
let bad = 0;
let totalMessages = 0;
for (const file of files) {
  counts[platformFromName(file)] = (counts[platformFromName(file)] || 0) + 1;
  const full = path.join(SESSIONS_DIR, file);
  const lines = (await fs.readFile(full, 'utf8')).split(/\n/);
  const rows = lines.filter(Boolean).map(line => {
    try { return JSON.parse(line); }
    catch { bad++; return null; }
  }).filter(Boolean);
  const session = rows[0];
  if (!session || session.type !== 'session' || !session.id || !session.timestamp || !session.cwd || !session.thread_name) {
    bad++;
    continue;
  }
  const messages = rows.slice(1).filter(r => r.type === 'message' && r.message?.role && Array.isArray(r.message?.content));
  totalMessages += messages.length;
  if (!messages.some(m => m.message.role === 'user')) bad++;
}

bad === 0 ? pass('jsonl schema', 'all sessions have session line + user messages')
          : fail('jsonl schema', `${bad} malformed sessions/lines`);

for (const p of ['claude','chatgpt','gemini']) {
  (counts[p] || 0) > 0 ? pass(`${p} exported`, `${counts[p]} sessions`)
                       : fail(`${p} exported`, '0 sessions');
}

totalMessages > 0 ? pass('messages exported', `${totalMessages} messages`) : fail('messages exported', '0 messages');

try {
  const manifest = JSON.parse(await fs.readFile(path.join(EXPORT_ROOT, 'manifest.json'), 'utf8'));
  Array.isArray(manifest.summaries) ? pass('manifest', `${manifest.summaries.length} platform summaries`)
                                    : fail('manifest', 'missing summaries');
} catch (e) {
  fail('manifest', e.message);
}

console.log('\n=== SUMMARY ===');
const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
