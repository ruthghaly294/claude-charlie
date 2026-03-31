#!/bin/bash
set -euo pipefail

# Ultimate Claude Code Setup — Bootstrap Script
# Installs global tools to ~/.claude/ and verifies the project template.
# Idempotent: safe to re-run.

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
log_fail() { echo -e "  ${RED}✗${NC} $1"; }
log_warn() { echo -e "  ${YELLOW}!${NC} $1"; }
log_step() { echo -e "\n${BOLD}$1${NC}"; }

ERRORS=0

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Ultimate Claude Code Setup                      ║"
echo "║  Full-Stack TypeScript Template                  ║"
echo "╚══════════════════════════════════════════════════╝"

# ─── Step 1: Prerequisites (auto-install) ─────────────────────────────

log_step "Step 1: Checking and installing prerequisites..."

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    log_ok "node found: $(node --version)"
  else
    log_warn "node not found. Installing via nvm..."
    if command -v nvm >/dev/null 2>&1; then
      nvm install --lts
    else
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
      nvm install --lts
    fi
    if command -v node >/dev/null 2>&1; then
      log_ok "node installed: $(node --version)"
    else
      log_fail "Failed to install node. Install manually from https://nodejs.org"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_claude() {
  if command -v claude >/dev/null 2>&1; then
    log_ok "claude found: $(command -v claude)"
  else
    log_warn "claude not found. Installing..."
    npm i -g @anthropic-ai/claude-code
    if command -v claude >/dev/null 2>&1; then
      log_ok "claude installed: $(command -v claude)"
    else
      log_fail "Failed to install claude. Run: npm i -g @anthropic-ai/claude-code"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_gh() {
  if command -v gh >/dev/null 2>&1; then
    log_ok "gh found: $(command -v gh)"
  else
    log_warn "gh not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
      (type -p wget >/dev/null || sudo apt-get update && sudo apt-get install wget -y) \
        && sudo mkdir -p -m 755 /etc/apt/keyrings \
        && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
        && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
        && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
        && sudo apt-get update && sudo apt-get install gh -y
    elif command -v brew >/dev/null 2>&1; then
      brew install gh
    else
      log_fail "Cannot auto-install gh. Install from https://cli.github.com"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v gh >/dev/null 2>&1; then
      log_ok "gh installed: $(command -v gh)"
    else
      log_fail "Failed to install gh. Install from https://cli.github.com"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_node
ensure_claude
ensure_gh

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  log_fail "$ERRORS prerequisite(s) could not be installed. Fix manually and re-run."
  exit 1
fi

# ─── Step 2: Backup ──────────────────────────────────────────────────

log_step "Step 2: Backing up existing config..."

if [ -d "$HOME/.claude" ]; then
  BACKUP_DIR="$HOME/.claude.backup-$(date +%Y%m%d-%H%M%S)"
  cp -r "$HOME/.claude" "$BACKUP_DIR"
  log_ok "Backed up to $BACKUP_DIR"
else
  log_warn "No existing ~/.claude/ found, skipping backup"
fi

# ─── Step 3: Install citypaul dotfiles ────────────────────────────────

log_step "Step 3: Installing citypaul dotfiles (skills, commands, agents)..."

if [ -f "$HOME/.claude/CLAUDE.md" ] && grep -q "TEST-DRIVEN DEVELOPMENT" "$HOME/.claude/CLAUDE.md" 2>/dev/null; then
  log_warn "citypaul dotfiles already installed, skipping"
else
  curl -fsSL https://raw.githubusercontent.com/citypaul/.dotfiles/main/install-claude.sh | bash
  log_ok "citypaul dotfiles installed"
fi

# ─── Step 4: Install plugins ─────────────────────────────────────────

log_step "Step 4: Configuring plugins..."

SETTINGS_FILE="$HOME/.claude/settings.json"

if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

node -e "
const fs = require('fs');
const path = '$SETTINGS_FILE';
const settings = JSON.parse(fs.readFileSync(path, 'utf8'));
settings.enabledPlugins = settings.enabledPlugins || {};
const plugins = [
  'superpowers@claude-plugins-official',
  'claude-md-management@claude-plugins-official',
  'skill-creator@claude-plugins-official',
  'atlassian@claude-plugins-official'
];
plugins.forEach(p => { settings.enabledPlugins[p] = true; });
fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
"

log_ok "Plugins enabled: superpowers, claude-md-management, skill-creator, atlassian"

# ─── Step 5: Install GSD ─────────────────────────────────────────────

log_step "Step 5: Checking GSD installation..."

if [ -d "$HOME/.claude/get-shit-done" ]; then
  log_warn "GSD already installed, skipping"
else
  log_warn "GSD not found. Install manually or via the GSD installer."
  log_warn "See: https://github.com/get-shit-done/gsd"
fi

# ─── Step 6: Merge model setting ─────────────────────────────────────

log_step "Step 6: Configuring model preference..."

node -e "
const fs = require('fs');
const path = '$SETTINGS_FILE';
const settings = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!settings.model) {
  settings.model = 'opus';
}
fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
"

log_ok "Model set to opus (if not already configured)"

# ─── Step 7: Verify installation ─────────────────────────────────────

log_step "Step 7: Verifying installation..."

CHECKS=0
PASSED=0

verify() {
  CHECKS=$((CHECKS + 1))
  if [ -e "$1" ]; then
    log_ok "$2"
    PASSED=$((PASSED + 1))
  else
    log_fail "$2 — missing: $1"
  fi
}

verify "$HOME/.claude/CLAUDE.md" "Global CLAUDE.md"
verify "$HOME/.claude/skills/tdd/SKILL.md" "TDD skill"
verify "$HOME/.claude/skills/testing/SKILL.md" "Testing skill"
verify "$HOME/.claude/skills/typescript-strict/SKILL.md" "TypeScript strict skill"
verify "$HOME/.claude/skills/mutation-testing/SKILL.md" "Mutation testing skill"
verify "$HOME/.claude/skills/refactoring/SKILL.md" "Refactoring skill"
verify "$HOME/.claude/skills/functional/SKILL.md" "Functional skill"
verify "$HOME/.claude/commands/setup.md" "Setup command"
verify "$HOME/.claude/commands/pr.md" "PR command"
verify "$HOME/.claude/agents/tdd-guardian.md" "TDD guardian agent"
verify "$HOME/.claude/agents/pr-reviewer.md" "PR reviewer agent"
verify "$HOME/.claude/settings.json" "Global settings"

# ─── Step 8: Verify project template ─────────────────────────────────

log_step "Step 8: Verifying project template..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

verify "$SCRIPT_DIR/.claude/settings.json" "Project settings"
verify "$SCRIPT_DIR/.claude/hooks/safety-check.sh" "Safety check hook"
verify "$SCRIPT_DIR/.claude/hooks/protect-files.sh" "File protection hook"
verify "$SCRIPT_DIR/.claude/commands/commit-push-pr.md" "commit-push-pr command"
verify "$SCRIPT_DIR/.claude/commands/verify.md" "verify command"
verify "$SCRIPT_DIR/.claude/commands/techdebt.md" "techdebt command"
verify "$SCRIPT_DIR/.claude/commands/sync-context.md" "sync-context command"
verify "$SCRIPT_DIR/.claude/agents/code-simplifier.md" "code-simplifier agent"
verify "$SCRIPT_DIR/.claude/agents/verify-app.md" "verify-app agent"
verify "$SCRIPT_DIR/.claude/agents/security-auditor.md" "security-auditor agent"
verify "$SCRIPT_DIR/.claude/skills/project-onboarding/SKILL.md" "project-onboarding skill"
verify "$SCRIPT_DIR/CLAUDE.md" "Project CLAUDE.md"
verify "$SCRIPT_DIR/.mcp.json" "MCP configuration"
verify "$SCRIPT_DIR/README.md" "README"

# ─── Summary ──────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Setup Complete                                  ║"
echo "╠══════════════════════════════════════════════════╣"
printf "║  Checks passed: %-3s / %-3s                       ║\n" "$PASSED" "$CHECKS"
echo "╚══════════════════════════════════════════════════╝"
echo ""

if [ "$PASSED" -eq "$CHECKS" ]; then
  log_ok "All checks passed. Your Claude Code setup is ready."
  echo ""
  echo "  Next steps:"
  echo "    1. cd your-project"
  echo "    2. claude"
  echo "    3. /sync-context"
  echo ""
else
  FAILED=$((CHECKS - PASSED))
  log_warn "$FAILED check(s) failed. Review the output above."
  exit 1
fi
