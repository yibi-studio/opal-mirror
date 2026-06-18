#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_REPO="/Users/va7/Desktop/opal-mirror"
PRODUCT_REPO="${XDG_DATA_HOME:-$HOME/.local/share}/opal-mirror"

if [[ -n "${OPAL_MIRROR_REPO:-}" ]]; then
  LOCAL_REPO="$OPAL_MIRROR_REPO"
elif [[ -f "$DEV_REPO/package.json" && -f "$DEV_REPO/sync.mjs" ]]; then
  LOCAL_REPO="$DEV_REPO"
else
  LOCAL_REPO="$PRODUCT_REPO"
fi

DEFAULT_ARCHIVE="${LOCAL_REPO}/ai-chat-archive"

export AI_CHAT_ARCHIVE_DIR="${AI_CHAT_ARCHIVE_DIR:-$DEFAULT_ARCHIVE}"

usage() {
  cat <<'EOF'
opal_mirror_skill.sh

Usage:
  opal_mirror_skill.sh bootstrap [all|claude|chatgpt|gemini|deepseek|doubao|qwen]
  opal_mirror_skill.sh install-repo
  opal_mirror_skill.sh doctor
  opal_mirror_skill.sh cdp-status
  opal_mirror_skill.sh cdp-cleanup
  opal_mirror_skill.sh cdp-start-main
  opal_mirror_skill.sh sync [all|claude|chatgpt|gemini|deepseek|doubao|qwen] --limit N [--no-index]
  opal_mirror_skill.sh sync-limited [all|claude|chatgpt|gemini|deepseek|doubao|qwen] N [extra sync flags...]
  opal_mirror_skill.sh import-codex-limited [all|claude|chatgpt|gemini|deepseek|doubao|qwen] N [export flags...]
  opal_mirror_skill.sh index
  opal_mirror_skill.sh export-codex [all|claude|chatgpt|gemini|deepseek|doubao|qwen] [export flags...]
  opal_mirror_skill.sh bootstrap-codex [all|claude|chatgpt|gemini|deepseek|doubao|qwen] --limit N [export flags...]
  opal_mirror_skill.sh status

Environment:
  OPAL_MIRROR_REPO       Local opal-mirror clone. Default: dev clone if present, else ~/.local/share/opal-mirror
  OPAL_MIRROR_REPO_URL   Repo URL to clone. Default: https://github.com/1va7/opal-mirror.git
  AI_CHAT_ARCHIVE_DIR    Archive output dir. Default: $OPAL_MIRROR_REPO/ai-chat-archive
  CDP_PROXY              CDP HTTP proxy. Default is handled by opal-mirror.

Privacy:
  Do not upload or commit ai-chat-archive, ~/.codex, SQLite, JSONL, cookies, tokens, or browser profiles.

Chrome profile rule:
  Use the user's already logged-in primary Chrome/profile via CDP.
  Do not create a fresh --user-data-dir or temporary browser profile.
  Do not create ad-hoc CDP proxy implementations.
  If multiple accounts/profiles are visible, ask which one to use before syncing.
EOF
}

has_limit_flag() {
  for arg in "$@"; do
    [[ "$arg" == "--limit" || "$arg" == --limit=* ]] && return 0
  done
  return 1
}

export_args_have_codex_home() {
  for arg in "$@"; do
    [[ "$arg" == "--codex-home" || "$arg" == --codex-home=* ]] && return 0
  done
  return 1
}

codex_home_from_args() {
  local prev=""
  for arg in "$@"; do
    if [[ "$prev" == "--codex-home" ]]; then
      printf '%s\n' "$arg"
      return 0
    fi
    if [[ "$arg" == --codex-home=* ]]; then
      printf '%s\n' "${arg#--codex-home=}"
      return 0
    fi
    prev="$arg"
  done
  printf '%s\n' "$HOME/.codex"
}

require_limit_for_sync() {
  if has_limit_flag "$@"; then
    return 0
  fi
  cat >&2 <<'EOF'
Refusing to run an unbounded sync from the skill wrapper.

Ask the user how many recent conversations to sync, then run one of:
  opal_mirror_skill.sh sync chatgpt --limit 20
  opal_mirror_skill.sh sync-limited chatgpt 20

Use the raw repo command only when the user explicitly asks for a full sync.
EOF
  exit 2
}

require_specific_import_target() {
  local target="$1"
  if [[ "$target" == "all" ]]; then
    cat >&2 <<'EOF'
Refusing to import all platforms into Codex from the skill wrapper.

Pick one logged-in platform at a time, e.g.:
  opal_mirror_skill.sh import-codex-limited chatgpt 20
  opal_mirror_skill.sh import-codex-limited gemini 5

Archive-only sync may use target=all, but Codex import must be explicit to avoid exporting stale archives.
EOF
    exit 2
  fi
}

repo_url() {
  printf '%s\n' "${OPAL_MIRROR_REPO_URL:-https://github.com/1va7/opal-mirror.git}"
}

ensure_repo() {
  if [[ -f "$LOCAL_REPO/package.json" && -f "$LOCAL_REPO/sync.mjs" ]]; then
    return 0
  fi
  echo "Local opal-mirror clone not found at $LOCAL_REPO" >&2
  echo "Run: $0 install-repo" >&2
  exit 2
}

install_repo() {
  if ! command -v git >/dev/null 2>&1; then
    echo "Missing dependency: git" >&2
    exit 2
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "Missing dependency: Node.js 18+" >&2
    exit 2
  fi

  local node_major
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [[ "$node_major" -lt 18 ]]; then
    echo "Node.js 18+ is required; current: $(node -v)" >&2
    exit 2
  fi

  if [[ ! -d "$LOCAL_REPO/.git" ]]; then
    mkdir -p "$(dirname "$LOCAL_REPO")"
    echo "Cloning opal-mirror into: $LOCAL_REPO"
    git clone "$(repo_url)" "$LOCAL_REPO"
  elif [[ ! -f "$LOCAL_REPO/package.json" || ! -f "$LOCAL_REPO/sync.mjs" ]]; then
    echo "Existing directory is not an opal-mirror repo: $LOCAL_REPO" >&2
    exit 2
  else
    echo "Using existing opal-mirror repo: $LOCAL_REPO"
  fi

  (cd "$LOCAL_REPO" && npm install)
}

run_node() {
  ensure_repo
  (cd "$LOCAL_REPO" && node "$@")
}

ensure_repo_or_install() {
  if [[ -f "$LOCAL_REPO/package.json" && -f "$LOCAL_REPO/sync.mjs" ]]; then
    return 0
  fi
  install_repo
}

chrome_devtools_file() {
  printf '%s\n' "$HOME/Library/Application Support/Google/Chrome/DevToolsActivePort"
}

cdp_proxy_script() {
  printf '%s\n' "$SKILL_DIR/scripts/cdp_proxy.mjs"
}

assert_no_temp_profile() {
  if pgrep -af "Google Chrome.*--user-data-dir=/tmp/opal-" >/dev/null 2>&1; then
    echo "Refusing to continue: temporary opal Chrome profile is running." >&2
    echo "Run: $0 cdp-cleanup" >&2
    exit 2
  fi
}

main_chrome_running() {
  pgrep -af "/Contents/MacOS/Google Chrome( |$)" >/dev/null 2>&1
}

main_cdp_port() {
  local devtools_file
  devtools_file="$(chrome_devtools_file)"
  if [[ -f "$devtools_file" ]]; then
    sed -n '1p' "$devtools_file"
  fi
}

main_cdp_healthy() {
  local port
  port="$(main_cdp_port)"
  [[ -n "$port" ]] && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

ensure_main_cdp_available() {
  assert_no_temp_profile
  local chrome_bin
  chrome_bin="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

  if main_cdp_healthy; then
    return 0
  fi

  if ! main_chrome_running; then
    if [[ ! -x "$chrome_bin" ]]; then
      echo "Google Chrome not found at: $chrome_bin" >&2
      exit 2
    fi
    local chrome_args=("--remote-debugging-port=9222" "--remote-allow-origins=*")
    echo "Starting main Chrome profile with remote debugging on 9222"
    if [[ "$(uname -s)" == "Darwin" ]]; then
      rm -f /tmp/opal-mirror-chrome.log
      open -na "Google Chrome" --args "${chrome_args[@]}" >/tmp/opal-mirror-chrome.log 2>&1
    else
      nohup "$chrome_bin" "${chrome_args[@]}" >/tmp/opal-mirror-chrome.log 2>&1 &
    fi
    sleep 5
    if main_cdp_healthy; then
      return 0
    fi
    if grep -q "DevTools remote debugging requires a non-default data directory" /tmp/opal-mirror-chrome.log 2>/dev/null; then
      cat >&2 <<'EOF'
Chrome refused remote debugging for the default profile.

opal-mirror must use the user's already logged-in main Chrome profile, so it will not create or switch to another --user-data-dir.

Quit Chrome completely and relaunch the main profile with remote debugging enabled, or adjust Chrome policy/settings so the main profile exposes DevToolsActivePort.
EOF
      exit 2
    fi
    if grep -qi "profile.*in use\\|user data directory.*already\\|lock" /tmp/opal-mirror-chrome.log 2>/dev/null; then
      cat >&2 <<'EOF'
Chrome could not keep the main profile open.

Quit Chrome completely, then relaunch the same main profile with remote debugging enabled.
EOF
      exit 2
    fi
    echo "Failed to start main Chrome CDP. Log:" >&2
    tail -80 /tmp/opal-mirror-chrome.log >&2 || true
    exit 2
  fi

  cat >&2 <<'EOF'
Main Chrome is already running, but its remote debugging port is not reachable.

Quit all Chrome windows completely, then start the same main profile with:
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

Do not add --user-data-dir. opal-mirror must use your already logged-in main Chrome profile.
EOF
  exit 2
}

cdp_cleanup() {
  pkill -f 'opal-main-cdp-proxy.mjs' 2>/dev/null || true
  pkill -f '/tmp/opal-cdp-proxy-home' 2>/dev/null || true
  pkill -f 'Google Chrome.*--user-data-dir=/tmp/opal-' 2>/dev/null || true
  rm -f /tmp/opal-main-cdp-proxy.mjs
  rm -rf /tmp/opal-cdp-proxy-home /tmp/opal-chrome-profile /tmp/opal-chrome-profile-2
}

cdp_status() {
  assert_no_temp_profile
  local devtools_file port ws_path
  devtools_file="$(chrome_devtools_file)"
  if [[ -f "$devtools_file" ]]; then
    port="$(sed -n '1p' "$devtools_file")"
    ws_path="$(sed -n '2p' "$devtools_file")"
  else
    port="9222"
    ws_path=""
  fi
  echo "main Chrome DevToolsActivePort: $devtools_file"
  echo "main Chrome CDP: port=${port} path=${ws_path}"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "main Chrome port: listening"
  else
    echo "main Chrome port: not listening" >&2
    return 1
  fi
  if lsof -nP -iTCP:3456 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "CDP HTTP proxy: listening on 3456"
  else
    echo "CDP HTTP proxy: not listening on 3456"
  fi
}

cdp_proxy_healthy() {
  curl -fsS --max-time 3 http://localhost:3456/targets >/dev/null 2>&1
}

stop_cdp_proxy_port() {
  local pids
  pids="$(lsof -tiTCP:3456 -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping unhealthy CDP HTTP proxy on 3456: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

cdp_start_main() {
  ensure_main_cdp_available
  local proxy_script
  proxy_script="$(cdp_proxy_script)"
  if [[ ! -f "$proxy_script" ]]; then
    echo "Missing approved CDP proxy script: $proxy_script" >&2
    exit 2
  fi
  if lsof -nP -iTCP:3456 -sTCP:LISTEN >/dev/null 2>&1; then
    if cdp_proxy_healthy; then
      echo "CDP HTTP proxy already healthy on 3456"
      return 0
    fi
    stop_cdp_proxy_port
  fi
  nohup env \
    CDP_PROXY_PORT="${CDP_PROXY_PORT:-3456}" \
    node "$proxy_script" >/tmp/opal-mirror-cdp-proxy.log 2>&1 </dev/null &
  echo $! >/tmp/opal-mirror-cdp-proxy.pid
  sleep 2
  if ! lsof -nP -iTCP:3456 -sTCP:LISTEN >/dev/null 2>&1 || ! cdp_proxy_healthy; then
    echo "Failed to start approved CDP proxy. Log:" >&2
    tail -80 /tmp/opal-mirror-cdp-proxy.log >&2 || true
    exit 2
  fi
  echo "CDP HTTP proxy started on 3456 using approved script: $proxy_script"
}

ensure_cdp_ready() {
  assert_no_temp_profile
  if ! lsof -nP -iTCP:3456 -sTCP:LISTEN >/dev/null 2>&1 || ! cdp_proxy_healthy; then
    cdp_start_main
  fi
}

verify_resume_rows() {
  target="$1"
  limit="$2"
  codex_home="${3:-$HOME/.codex}"
  if [[ -f "${codex_home}/state_5.sqlite" ]]; then
    sqlite3 "${codex_home}/state_5.sqlite" \
      "select title, datetime(updated_at_ms/1000, 'unixepoch', 'localtime') || ' local' from threads where title like '[webchat:${target}]%' order by updated_at_ms desc limit ${limit};"
  fi
}

command="${1:-help}"
shift || true

case "$command" in
  help|--help|-h)
    usage
    ;;
  bootstrap)
    target="${1:-all}"
    install_repo
    ensure_cdp_ready
    (cd "$LOCAL_REPO" && OPAL_MIRROR_REQUIRE_TARGET="$target" node doctor.mjs)
    cat <<EOF

opal-mirror bootstrap is ready.

repo: $LOCAL_REPO
archive: $AI_CHAT_ARCHIVE_DIR
target: $target

Next step: ask the user how many recent conversations to import, then run:
  $0 import-codex-limited $target 20

Do not run an unbounded sync from the skill wrapper.
EOF
    ;;
  install-repo)
    install_repo
    ;;
  status)
    ensure_repo
    echo "repo: $LOCAL_REPO"
    echo "archive: $AI_CHAT_ARCHIVE_DIR"
    node -v
    if [[ -d "$AI_CHAT_ARCHIVE_DIR" ]]; then
      find "$AI_CHAT_ARCHIVE_DIR" -maxdepth 2 -type f -name '*.json' | sed "s#^$AI_CHAT_ARCHIVE_DIR/##" | awk -F/ '{count[$1]++} END {for (k in count) print k ": " count[k]}'
    else
      echo "archive directory does not exist yet"
    fi
    ;;
  doctor)
    ensure_repo_or_install
    ensure_cdp_ready
    (cd "$LOCAL_REPO" && OPAL_MIRROR_REQUIRE_TARGET="$target" node doctor.mjs)
    ;;
  cdp-status)
    cdp_status
    ;;
  cdp-cleanup)
    cdp_cleanup
    cdp_status || true
    ;;
  cdp-start-main)
    cdp_start_main
    cdp_status
    ;;
  sync)
    ensure_repo_or_install
    target="${1:-all}"
    if [[ $# -gt 0 ]]; then shift; fi
    require_limit_for_sync "$@"
    ensure_cdp_ready
    if [[ "$target" == "all" ]]; then
      run_node sync.mjs "$@"
    else
      run_node sync.mjs "$target" "$@"
    fi
    ;;
  sync-limited)
    ensure_repo_or_install
    ensure_cdp_ready
    target="${1:-chatgpt}"
    if [[ $# -gt 0 ]]; then shift; fi
    limit="${1:-}"
    if [[ -z "$limit" || ! "$limit" =~ ^[0-9]+$ || "$limit" -le 0 ]]; then
      echo "sync-limited requires a positive integer count, e.g. sync-limited chatgpt 20" >&2
      exit 2
    fi
    shift || true
    if [[ "$target" == "all" ]]; then
      run_node sync.mjs --limit "$limit" "$@"
    else
      run_node sync.mjs "$target" --limit "$limit" "$@"
    fi
    ;;
  import-codex-limited)
    ensure_repo_or_install
    target="${1:-chatgpt}"
    require_specific_import_target "$target"
    if [[ $# -gt 0 ]]; then shift; fi
    limit="${1:-}"
    if [[ -z "$limit" || ! "$limit" =~ ^[0-9]+$ || "$limit" -le 0 ]]; then
      echo "import-codex-limited requires a positive integer count, e.g. import-codex-limited gemini 5" >&2
      exit 2
    fi
    shift || true
    ensure_cdp_ready
    (cd "$LOCAL_REPO" && OPAL_MIRROR_REQUIRE_TARGET="$target" node doctor.mjs)
    if [[ "$target" == "all" ]]; then
      run_node sync.mjs --limit "$limit"
    else
      run_node sync.mjs "$target" --limit "$limit"
    fi
    run_node build_index.mjs
    export_args=("$target" --limit "$limit")
    if ! export_args_have_codex_home "$@"; then
      export_args+=(--codex-home "$HOME/.codex")
    fi
    export_args+=("$@")
    run_node export_codex.mjs "${export_args[@]}"
    if [[ "$target" != "all" ]]; then
      echo
      echo "[verify] recent /resume rows for ${target}:"
      verify_resume_rows "$target" "$limit" "$(codex_home_from_args "$@")"
    fi
    ;;
  index)
    run_node build_index.mjs "$@"
    ;;
  export-codex)
    target="${1:-all}"
    require_specific_import_target "$target"
    if [[ $# -gt 0 ]]; then shift; fi
    run_node export_codex.mjs "$target" "$@"
    ;;
  bootstrap-codex)
    ensure_repo_or_install
    target="${1:-all}"
    require_specific_import_target "$target"
    if [[ $# -gt 0 ]]; then shift; fi
    require_limit_for_sync "$@"
    ensure_cdp_ready
    (cd "$LOCAL_REPO" && OPAL_MIRROR_REQUIRE_TARGET="$target" node doctor.mjs)
    if [[ "$target" == "all" ]]; then
      run_node sync.mjs "$@"
    else
      run_node sync.mjs "$target" "$@"
    fi
    run_node build_index.mjs
    run_node export_codex.mjs "$target" "$@"
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 2
    ;;
esac
