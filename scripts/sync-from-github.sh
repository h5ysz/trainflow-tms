#!/usr/bin/env bash
# scripts/sync-from-github.sh
# =====================================================================
# Smart sync from GitHub — safe to run at the start of every session.
#
# Behavior:
#   1. Fetch latest from origin
#   2. If local is clean → fast-forward / rebase pull
#   3. If local has uncommitted changes → stash, pull, pop (with conflict handling)
#   4. If rebase conflicts → bail out and show diff, leave stash for manual fix
#   5. Print a summary of what changed
#
# Usage:
#   bash scripts/sync-from-github.sh            # default: rebase pull
#   bash scripts/sync-from-github.sh --merge    # merge instead of rebase
#   bash scripts/sync-from-github.sh --force    # discard local commits, hard reset to origin
# =====================================================================
set -euo pipefail

PROJECT_DIR="/home/z/my-project"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1" >&2; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }

# Parse args
STRATEGY="rebase"
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --merge) STRATEGY="merge" ;;
    --force) FORCE=true ;;
    --help|-h)
      echo "Usage: bash scripts/sync-from-github.sh [--merge|--force|--help]"
      echo ""
      echo "  (default)  Fetch + rebase pull from origin/main"
      echo "  --merge    Fetch + merge pull (creates merge commit)"
      echo "  --force    HARD RESET local main to origin/main (discards local commits!)"
      echo "  --help     Show this help"
      exit 0
      ;;
  esac
done

# Sanity checks
if [ ! -d ".git" ]; then
  err "Not a git repository: $PROJECT_DIR"
  exit 1
fi

if ! git remote get-url origin &>/dev/null; then
  err "No 'origin' remote configured"
  exit 1
fi

REMOTE_URL=$(git remote get-url origin)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
info "Project:  $PROJECT_DIR"
info "Remote:   $REMOTE_URL"
info "Branch:   $BRANCH"
echo ""

# ── Force mode ─────────────────────────────────────────────────────────
if [ "$FORCE" = "true" ]; then
  warn "FORCE MODE: discarding ALL local changes and commits"
  warn "This cannot be undone. Press Ctrl+C within 5 seconds to abort..."
  sleep 5
  git fetch origin
  git reset --hard "origin/$BRANCH"
  git clean -fd
  log "Hard reset to origin/$BRANCH complete"
  exit 0
fi

# ── Check for uncommitted changes ──────────────────────────────────────
echo "Checking local working tree..."
if [ -n "$(git status --porcelain)" ]; then
  warn "Local working tree has uncommitted changes:"
  git status --short | head -10 | sed 's/^/    /'
  if [ "$(git status --porcelain | wc -l)" -gt 10 ]; then
    echo "    ... and $(( $(git status --porcelain | wc -l) - 10 )) more"
  fi
  echo ""
  info "Stashing local changes to allow clean pull..."
  STASH_RESULT=$(git stash push -u -m "auto-stash before sync $(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>&1)
  if [ $? -ne 0 ]; then
    err "Failed to stash changes: $STASH_RESULT"
    exit 1
  fi
  if echo "$STASH_RESULT" | grep -q "No local changes to save"; then
    info "(Stash had nothing to save — untracked files only, continuing)"
    STASHED=false
  else
    log "Changes stashed"
    STASHED=true
  fi
  echo ""
else
  log "Local working tree is clean"
  STASHED=false
fi

# ── Fetch ──────────────────────────────────────────────────────────────
echo "Fetching latest from origin..."
git fetch origin --prune 2>&1 | sed 's/^/    /' || {
  err "Fetch failed — check your network / token"
  if [ "$STASHED" = "true" ]; then
    warn "Restoring stashed changes..."
    git stash pop
  fi
  exit 1
}
log "Fetch complete"
echo ""

# ── Check if local is behind ───────────────────────────────────────────
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")
if [ -z "$REMOTE" ]; then
  err "Remote branch origin/$BRANCH not found"
  exit 1
fi

if [ "$LOCAL" = "$REMOTE" ]; then
  log "Already up to date — local matches origin/$BRANCH"
  if [ "$STASHED" = "true" ]; then
    info "Restoring stashed changes..."
    git stash pop
    log "Stash restored"
  fi
  exit 0
fi

# Are we ahead, behind, or diverged?
COUNTS=$(git rev-list --left-right --count "HEAD...origin/$BRANCH")
AHEAD=$(echo "$COUNTS" | awk '{print $1}')
BEHIND=$(echo "$COUNTS" | awk '{print $2}')

info "Local is $AHEAD commit(s) ahead, $BEHIND commit(s) behind origin/$BRANCH"
echo ""

# ── Show incoming commits ──────────────────────────────────────────────
if [ "$BEHIND" -gt 0 ]; then
  echo "Incoming commits from GitHub:"
  git log --oneline --no-decorate "HEAD..origin/$BRANCH" | head -15 | sed 's/^/    /'
  if [ "$BEHIND" -gt 15 ]; then
    echo "    ... and $(( BEHIND - 15 )) more"
  fi
  echo ""
fi

# ── Pull (rebase or merge) ─────────────────────────────────────────────
if [ "$STRATEGY" = "rebase" ]; then
  info "Pulling with rebase (keeps linear history)..."
  PULL_OUTPUT=$(git pull --rebase origin "$BRANCH" 2>&1) || {
    err "Rebase failed — likely conflict"
    echo "$PULL_OUTPUT" | sed 's/^/    /'
    echo ""
    warn "You have a rebase in progress. Options:"
    echo "    1. Resolve conflicts manually, then:  git rebase --continue"
    echo "    2. Abort and restore previous state:  git rebase --abort"
    if [ "$STASHED" = "true" ]; then
      echo "    3. Stashed changes are still safe in: git stash list"
    fi
    exit 1
  }
  echo "$PULL_OUTPUT" | grep -E "^Successfully|^Fast-forward|^From |^\s+[a-f0-9]+" | sed 's/^/    /' || true
  log "Rebase pull complete"
else
  info "Pulling with merge..."
  PULL_OUTPUT=$(git pull --no-edit origin "$BRANCH" 2>&1) || {
    err "Merge failed — likely conflict"
    echo "$PULL_OUTPUT" | sed 's/^/    /'
    echo ""
    warn "Resolve conflicts manually, then:  git commit"
    if [ "$STASHED" = "true" ]; then
      echo "    Stashed changes are still safe in: git stash list"
    fi
    exit 1
  }
  echo "$PULL_OUTPUT" | sed 's/^/    /'
  log "Merge pull complete"
fi
echo ""

# ── Restore stash ──────────────────────────────────────────────────────
if [ "$STASHED" = "true" ]; then
  info "Restoring stashed local changes..."
  STASH_POP_OUTPUT=$(git stash pop 2>&1) || {
    warn "Stash pop had conflicts — your stashed changes are preserved"
    echo "$STASH_POP_OUTPUT" | sed 's/^/    /'
    echo ""
    info "Resolve conflicts, then:  git stash drop"
    exit 1
  fi
  log "Stashed changes restored"
  echo ""
fi

# ── Final summary ──────────────────────────────────────────────────────
NEW_LOCAL=$(git rev-parse HEAD)
NEW_BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH")
NEW_AHEAD=$(git rev-list --count "origin/$BRANCH..HEAD")

echo "────────────────────────────────────────"
log "Sync complete"
info "Current HEAD: $NEW_LOCAL"
info "Branch:       $BRANCH"
if [ "$NEW_BEHIND" -eq 0 ]; then
  log "Up to date with origin/$BRANCH"
else
  warn "Still $NEW_BEHIND commit(s) behind — investigate"
fi
if [ "$NEW_AHEAD" -gt 0 ]; then
  info "$NEW_AHEAD local commit(s) ahead — push when ready:  git push origin $BRANCH"
fi
if [ -n "$(git status --porcelain)" ]; then
  warn "Working tree has uncommitted changes — review with: git status"
fi
echo "────────────────────────────────────────"
