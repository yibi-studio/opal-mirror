#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/opal_mirror_skill.sh"
PROXY="$SCRIPT_DIR/cdp_proxy.mjs"

bash -n "$WRAPPER"
node --check "$PROXY"

help_output="$("$WRAPPER" help)"
grep -q "opal_mirror_skill.sh bootstrap" <<<"$help_output"
grep -q "opal_mirror_skill.sh install-repo" <<<"$help_output"
grep -q "Do not create a fresh --user-data-dir" <<<"$help_output"

missing_repo="$(mktemp -d)"
rm -rf "$missing_repo"
set +e
status_output="$(OPAL_MIRROR_REPO="$missing_repo" "$WRAPPER" status 2>&1)"
status_code=$?
set -e
if [[ "$status_code" -eq 0 ]]; then
  echo "Expected status to fail for a missing repo" >&2
  exit 1
fi
grep -q "Run: .* install-repo" <<<"$status_output"

set +e
sync_output="$(OPAL_MIRROR_REPO="/Users/va7/Desktop/opal-mirror" "$WRAPPER" sync chatgpt 2>&1)"
sync_code=$?
set -e
if [[ "$sync_code" -eq 0 ]]; then
  echo "Expected unbounded sync to be refused" >&2
  exit 1
fi
grep -q "Refusing to run an unbounded sync" <<<"$sync_output"

echo "skill wrapper checks passed"
