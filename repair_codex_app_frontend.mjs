#!/usr/bin/env node
// Repair Codex App sidebar visibility for imported opal-mirror webchat threads.
//
// Codex App keeps a frontend sidebar registry in ~/.codex/.codex-global-state.json.
// The app may rewrite that file from memory while it is running, so this repair
// refuses to write the real ~/.codex registry unless Codex App has fully quit.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const archiveRoot = path.resolve(readFlag('--archive') || process.env.AI_CHAT_ARCHIVE_DIR || path.join(__dirname, 'ai-chat-archive'));
const codexHome = path.resolve(readFlag('--codex-home') || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const codexAppCwd = path.resolve(readFlag('--app-cwd') || path.join(os.homedir(), 'Documents', 'Codex'));
const dryRun = args.includes('--dry-run');
const allowRunningApp = args.includes('--allow-running-app') || process.env.OPAL_MIRROR_ALLOW_RUNNING_CODEX_APP === '1';
const jsonOutput = args.includes('--json');
const fixMtimeOnly = args.includes('--fix-mtime-only');

if (help) {
  console.log(`Repair Codex App sidebar registry for opal-mirror imports.

Usage:
  node repair_codex_app_frontend.mjs [--archive DIR] [--codex-home DIR] [--app-cwd DIR] [--allow-running-app] [--fix-mtime-only] [--dry-run] [--json]

By default, this refuses to write the real ~/.codex frontend registry while
Codex App is running, because the app can overwrite external edits on shutdown.
Rollout mtimes are repaired even while Codex App is running.
`);
  process.exit(0);
}

function readFlag(name) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1];
  const inline = args.find(a => a.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : '';
}

function appThreadMapPath() {
  return path.join(archiveRoot, '_codex_app_thread_ids.json');
}

function appOutputDirFor(threadId) {
  return path.join(codexAppCwd, 'webchat-imports', threadId, 'outputs');
}

function timestampForFile(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isRealCodexHome() {
  if (process.env.OPAL_MIRROR_ASSUME_REAL_CODEX_HOME === '1') return true;
  if (process.env.OPAL_MIRROR_ASSUME_REAL_CODEX_HOME === '0') return false;
  return path.resolve(codexHome) === path.resolve(path.join(os.homedir(), '.codex'));
}

function codexAppIsRunning() {
  if (process.env.OPAL_MIRROR_ASSUME_CODEX_APP_RUNNING === '1') return true;
  if (process.env.OPAL_MIRROR_ASSUME_CODEX_APP_RUNNING === '0') return false;
  const ps = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (ps.status !== 0) return false;
  return ps.stdout.split('\n').some(line => (
    line.includes('/Applications/Codex.app/Contents/MacOS/Codex')
    || line.includes('/Applications/Codex.app/Contents/Resources/codex app-server')
  ));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readRolloutMetadata(file) {
  try {
    const fh = await fs.open(file, 'r');
    try {
      const { buffer, bytesRead } = await fh.read(Buffer.alloc(8192), 0, 8192, 0);
      const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
      const row = JSON.parse(firstLine);
      return row?.payload?.metadata || {};
    } finally {
      await fh.close();
    }
  } catch {
    return {};
  }
}

async function loadAppRows() {
  const map = await readJson(appThreadMapPath(), {});
  const mapIds = new Set(Object.values(map).filter(Boolean));
  const db = path.join(codexHome, 'state_5.sqlite');
  if (!fsSync.existsSync(db)) return [];
  const sqlite = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' });
  if (sqlite.status !== 0) return [];
  const query = `
select id, cwd, title, rollout_path, updated_at_ms
from threads
where source='vscode' and title like '[webchat:%'
order by updated_at_ms asc, id asc;`;
  const result = spawnSync('sqlite3', [db, '-json', query], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  let rows = [];
  try { rows = JSON.parse(result.stdout); } catch { return []; }
  const accepted = [];
  for (const row of rows) {
    const metadata = await readRolloutMetadata(row.rollout_path);
    if (mapIds.has(row.id) || metadata.imported_by === 'opal-mirror') {
      accepted.push({
        id: row.id,
        cwd: codexAppCwd,
        outputDir: appOutputDirFor(row.id),
        title: row.title,
        rolloutPath: row.rollout_path,
        updatedAtMs: Number(row.updated_at_ms),
      });
    }
  }
  return accepted;
}

async function repairRolloutMtimes(appRows) {
  let changed = 0;
  let missing = 0;
  for (const row of appRows) {
    if (!row.rolloutPath || !Number.isFinite(row.updatedAtMs)) continue;
    try {
      const stat = await fs.stat(row.rolloutPath);
      if (Math.abs(stat.mtimeMs - row.updatedAtMs) <= 1000) continue;
      changed++;
      if (!dryRun) {
        const seconds = Math.floor(row.updatedAtMs / 1000);
        await fs.utimes(row.rolloutPath, seconds, seconds);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') missing++;
      else throw error;
    }
  }
  return { checked: appRows.length, changed, missing };
}

async function repairState(appRows) {
  const file = path.join(codexHome, '.codex-global-state.json');
  let state = await readJson(file, {});
  if (state === null || typeof state !== 'object' || Array.isArray(state)) state = {};

  const projectless = Array.isArray(state['projectless-thread-ids']) ? state['projectless-thread-ids'] : [];
  const imported = new Set(appRows.map(r => r.id));
  const existingWithoutImports = projectless.filter(id => !imported.has(id));
  const nextProjectless = [...existingWithoutImports, ...appRows.map(r => r.id)];

  const hints = state['thread-workspace-root-hints'] && typeof state['thread-workspace-root-hints'] === 'object'
    ? state['thread-workspace-root-hints']
    : {};
  const outputDirs = state['thread-projectless-output-directories'] && typeof state['thread-projectless-output-directories'] === 'object'
    ? state['thread-projectless-output-directories']
    : {};
  state['projectless-thread-ids'] = nextProjectless;
  state['thread-workspace-root-hints'] = hints;
  state['thread-projectless-output-directories'] = outputDirs;

  const atomState = state['electron-persisted-atom-state'] && typeof state['electron-persisted-atom-state'] === 'object'
    ? state['electron-persisted-atom-state']
    : {};
  const permissions = atomState['heartbeat-thread-permissions-by-id'] && typeof atomState['heartbeat-thread-permissions-by-id'] === 'object'
    ? atomState['heartbeat-thread-permissions-by-id']
    : {};
  state['electron-persisted-atom-state'] = atomState;
  atomState['heartbeat-thread-permissions-by-id'] = permissions;

  for (const row of appRows) {
    hints[row.id] = row.cwd;
    outputDirs[row.id] = row.outputDir;
    permissions[row.id] = {
      activePermissionProfile: { id: ':danger-full-access', extends: null },
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
    };
    if (!dryRun) await fs.mkdir(row.outputDir, { recursive: true });
  }

  const previousPresent = appRows.filter(row => projectless.includes(row.id)).length;
  const missingBefore = appRows.length - previousPresent;
  if (dryRun || missingBefore === 0) {
    return { file, backup: null, registered: appRows.length, missingBefore, changed: false };
  }

  if (isRealCodexHome() && codexAppIsRunning() && !allowRunningApp) {
    return { file, backup: null, registered: appRows.length, missingBefore, changed: false, skipped: true, reason: 'Codex App started before write' };
  }

  const backup = fsSync.existsSync(file)
    ? path.join(codexHome, `.codex-global-state.json.backup-before-opal-mirror-repair-${timestampForFile(new Date())}`)
    : null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (backup) await fs.copyFile(file, backup);
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(state)}\n`, 'utf8');
  await fs.rename(tmp, file);
  return { file, backup, registered: appRows.length, missingBefore, changed: true };
}

async function main() {
  const appRows = await loadAppRows();
  if (!appRows.length) {
    return { status: 'skipped', reason: 'no imported Codex App webchat rows found', codexHome };
  }

  const mtimes = await repairRolloutMtimes(appRows);
  if (fixMtimeOnly) {
    return {
      status: mtimes.changed ? 'repaired' : 'ok',
      registered: appRows.length,
      mtimes,
      codexHome,
    };
  }

  if (isRealCodexHome() && codexAppIsRunning() && !allowRunningApp) {
    return {
      status: 'skipped',
      reason: 'Codex App is running; fully quit it before repairing sidebar registry',
      codexHome,
      mtimes,
    };
  }

  const result = await repairState(appRows);
  if (result.skipped) return { status: 'skipped', ...result };
  return {
    status: result.changed ? 'repaired' : 'ok',
    registered: result.registered,
    missingBefore: result.missingBefore,
    mtimes,
    file: result.file,
    backup: result.backup,
  };
}

const result = await main();
if (jsonOutput) {
  console.log(JSON.stringify(result));
} else if (result.status === 'repaired') {
  console.log(`Codex App sidebar registry repaired: registered ${result.registered} imported thread(s), added ${result.missingBefore}.`);
  if (result.mtimes) console.log(`Codex App rollout mtimes repaired: changed ${result.mtimes.changed}/${result.mtimes.checked}.`);
  console.log(`state: ${result.file}`);
  if (result.backup) console.log(`backup: ${result.backup}`);
} else if (result.status === 'ok') {
  console.log(`Codex App sidebar registry already contains ${result.registered} imported thread(s).`);
  if (result.mtimes) console.log(`Codex App rollout mtimes ok: changed ${result.mtimes.changed}/${result.mtimes.checked}.`);
} else {
  console.log(`Codex App sidebar registry repair skipped: ${result.reason}`);
}
