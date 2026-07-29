#!/usr/bin/env bash
# scripts/welcome.sh
# =====================================================================
# Run this at the start of every session to:
#   1. Show current git state
#   2. Sync from GitHub (auto-stash any local changes)
#   3. List any remote branches you might want to switch to
#
# Usage:
#   bash scripts/welcome.sh
#
# To make this run automatically when entering the project dir,
# add this to your ~/.bashrc:
#
#   cd /home/z/my-project 2>/dev/null && [ -f scripts/welcome.sh ] && bash scripts/welcome.sh
# =====================================================================
set -euo pipefail

PROJECT_DIR="/home/z/my-project"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  GCCLAB TMS — Session Start                              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Show current state
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LAST_COMMIT=$(git log -1 --format="%s (%cr)" 2>/dev/null || echo "unknown")

echo -e "${BLUE}Current state:${NC}"
echo -e "  Branch:       ${GREEN}$BRANCH${NC}"
echo -e "  HEAD:         $HEAD_SHA"
echo -e "  Last commit:  $LAST_COMMIT"
echo ""

# Show working tree status (brief)
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  CHANGES=$(git status --porcelain 2>/dev/null | wc -l)
  echo -e "${YELLOW}⚠ Working tree has $CHANGES uncommitted change(s)${NC}"
  git status --short 2>/dev/null | head -5 | sed 's/^/    /'
  if [ "$CHANGES" -gt 5 ]; then
    echo "    ... and $(( CHANGES - 5 )) more"
  fi
  if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
    echo ""
    echo -e "${RED}🚫 POLICY: Never commit directly to $BRANCH${NC}"
    echo -e "${RED}   Use feature branches instead:${NC}"
    echo -e "${CYAN}   bash scripts/push-as-branch.sh <topic> \"<commit message>\"${NC}"
    echo -e "${RED}   This will create a branch, push, and open a PR for review.${NC}"
  fi
  echo ""
fi

# Sync from GitHub
echo -e "${BLUE}━━━ Syncing from GitHub ━━━${NC}"
bash "$PROJECT_DIR/scripts/sync-from-github.sh" 2>&1 | tail -20
echo ""

# List all remote branches
echo -e "${BLUE}━━━ Remote branches available ━━━${NC}"
git branch -r 2>/dev/null | grep -v "HEAD ->" | head -10 | sed 's/^/  /'
echo ""

# Final ready message
echo -e "${GREEN}✓ Ready to work${NC}"
echo -e "  Tip: To switch to a remote branch: ${CYAN}git checkout -b <branch-name> origin/<branch-name>${NC}"
echo -e "  Tip: To push your changes later:   ${CYAN}git push origin $BRANCH${NC}"
