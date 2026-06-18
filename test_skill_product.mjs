import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('.', import.meta.url).pathname;
const skillDir = path.join(root, 'skill', 'opal-mirror');
const wrapper = path.join(skillDir, 'scripts', 'opal_mirror_skill.sh');
const proxy = path.join(skillDir, 'scripts', 'cdp_proxy.mjs');
const skillMd = path.join(skillDir, 'SKILL.md');
const openaiYaml = path.join(skillDir, 'agents', 'openai.yaml');

const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    checks.push({ name, ok: false, error });
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...(options.env || {}) },
  });
  return result;
}

await check('skill package files exist', async () => {
  for (const file of [skillMd, openaiYaml, wrapper, proxy]) {
    await access(file, constants.R_OK);
  }
});

await check('scripts are executable', async () => {
  for (const file of [wrapper, proxy]) {
    const mode = (await stat(file)).mode;
    assert.notEqual(mode & 0o111, 0, `${file} should be executable`);
  }
});

await check('wrapper shell syntax is valid', async () => {
  const result = run('bash', ['-n', wrapper]);
  assert.equal(result.status, 0, result.stderr);
});

await check('bundled CDP proxy syntax is valid', async () => {
  const result = run('node', ['--check', proxy]);
  assert.equal(result.status, 0, result.stderr);
});

await check('hub metadata is present', async () => {
  const yaml = await readFile(openaiYaml, 'utf8');
  assert.match(yaml, /display_name: "Opal Mirror"/);
  assert.match(yaml, /default_prompt: "Use \$opal-mirror/);
});

await check('skill docs use portable script paths', async () => {
  const body = await readFile(skillMd, 'utf8');
  assert.match(body, /scripts\/opal_mirror_skill\.sh bootstrap/);
  assert.doesNotMatch(body, /\/Users\/va7\/\.codex\/skills\/opal-mirror\/scripts/);
  assert.match(body, /Do not add `--user-data-dir`/);
  assert.doesNotMatch(body, /OPAL_MIRROR_CHROME_USER_DATA_DIR/);
  assert.doesNotMatch(body, /chrome-profile/);
});

await check('wrapper help exposes product onboarding', async () => {
  const result = run(wrapper, ['help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /opal_mirror_skill\.sh bootstrap/);
  assert.match(result.stdout, /opal_mirror_skill\.sh install-repo/);
  assert.match(result.stdout, /Do not create a fresh --user-data-dir/);
});

await check('wrapper does not treat crashpad helpers as main Chrome', async () => {
  const body = await readFile(wrapper, 'utf8');
  assert.match(body, /\/Contents\/MacOS\/Google Chrome/);
  assert.doesNotMatch(body, /pgrep -x "Google Chrome"/);
  assert.doesNotMatch(body, /pgrep -af "\/Google Chrome"/);
});

await check('wrapper forbids alternate Chrome profiles', async () => {
  const body = await readFile(wrapper, 'utf8');
  assert.doesNotMatch(body, /OPAL_MIRROR_CHROME_USER_DATA_DIR/);
  assert.doesNotMatch(body, /OPAL_MIRROR_CHROME_DEBUG_PORT/);
  assert.doesNotMatch(body, /Starting user-selected durable Chrome profile/);
  assert.match(body, /DevTools remote debugging requires a non-default data directory/);
  assert.match(body, /will not create or switch to another --user-data-dir/);
});

await check('bundled proxy discovers only normal Chrome debug endpoints', async () => {
  const body = await readFile(proxy, 'utf8');
  assert.doesNotMatch(body, /OPAL_MIRROR_CHROME_USER_DATA_DIR/);
  assert.doesNotMatch(body, /OPAL_MIRROR_CHROME_DEBUG_PORT/);
  assert.match(body, /DevToolsActivePort/);
  assert.match(body, /\/json\/version/);
  assert.match(body, /webSocketDebuggerUrl/);
});

await check('missing repo points to install-repo', async () => {
  const missingRepo = path.join(await mkdtemp(path.join(os.tmpdir(), 'opal-missing-repo-')), 'repo');
  const result = run(wrapper, ['status'], { env: { OPAL_MIRROR_REPO: missingRepo } });
  await rm(path.dirname(missingRepo), { recursive: true, force: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Run: .* install-repo/);
});

await check('unbounded sync is refused before CDP checks', async () => {
  const result = run(wrapper, ['sync', 'chatgpt'], { env: { OPAL_MIRROR_REPO: root } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to run an unbounded sync/);
  assert.doesNotMatch(result.stderr, /Chrome|CDP|DevToolsActivePort/);
});

await check('import requires target login before Codex export', async () => {
  const body = await readFile(wrapper, 'utf8');
  assert.match(body, /require_specific_import_target/);
  assert.match(body, /OPAL_MIRROR_REQUIRE_TARGET="\$target" node doctor\.mjs/);
  assert.match(body, /export_args_have_codex_home/);
  assert.match(body, /codex_home_from_args/);
  assert.match(body, /verify_resume_rows "\$target" "\$limit" "\$\(codex_home_from_args "\$@"\)"/);
  const doctor = await readFile(path.join(root, 'doctor.mjs'), 'utf8');
  assert.match(doctor, /OPAL_MIRROR_REQUIRE_TARGET/);
  assert.match(doctor, /tab open but not logged in/);
});

await check('all-platform Codex import is refused before CDP checks', async () => {
  const result = run(wrapper, ['import-codex-limited', 'all', '1', '--codex-home', '/tmp/opal-nope'], {
    env: { OPAL_MIRROR_REPO: root },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to import all platforms into Codex/);
  assert.doesNotMatch(result.stderr, /Chrome|CDP|DevToolsActivePort/);
});

const failed = checks.filter((item) => !item.ok);
console.log(`\n=== SKILL PRODUCT SUMMARY ===`);
console.log(`${checks.length - failed.length} passed / ${failed.length} failed`);
if (failed.length) {
  process.exitCode = 1;
}
