#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Installs everything CI needs so lint, typecheck, unit tests, pipeline
# tests and the e2e suite run inside a remote session. Runs only in the
# web environment (CLAUDE_CODE_REMOTE=true); a local session is a no-op.
# Idempotent: every step is a cheap no-op once the container is cached.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

log() { echo "[session-start] $*"; }

# Quieter, non-interactive installs.
export npm_config_update_notifier=false
export PIP_ROOT_USER_ACTION=ignore

# --- Node -------------------------------------------------------------------
# Chromium is pre-installed at $PLAYWRIGHT_BROWSERS_PATH; stop the
# @playwright/test postinstall from downloading its own copy.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

log "npm install"
npm install --no-audit --no-fund --loglevel=error

# CI's circular-import check runs madge via npx (not a devDependency).
# Warm the npx cache so the same command works here; never fatal.
log "warming npx cache for madge"
npx --yes madge --version >/dev/null 2>&1 || log "madge warm-up skipped"

# --- Python -----------------------------------------------------------------
log "pip install (pipeline + pytest)"
python3 -m pip install --quiet --disable-pip-version-check \
  -r requirements.txt -r requirements-dev.txt

# --- Session environment ----------------------------------------------------
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1'
    # playwright.config.ts honours PW_CHROME_PATH, so the e2e suite uses the
    # container's Chromium even when @playwright/test pins another build.
    if [ -x /opt/pw-browsers/chromium ]; then
      echo 'export PW_CHROME_PATH=/opt/pw-browsers/chromium'
    fi
  } >> "$CLAUDE_ENV_FILE"
fi

log "done"
