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

RUN_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --test|-t) RUN_TESTS=1 ;;
  esac
done

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

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    log_ok "bun found: $(bun --version)"
  else
    log_warn "bun not found. Installing..."
    BUN_VERSION="1.3.10"
    tmpfile=$(mktemp)
    curl -fsSL "https://bun.sh/install" -o "$tmpfile"
    BUN_VERSION="$BUN_VERSION" bash "$tmpfile" && rm "$tmpfile"
    export PATH="$HOME/.bun/bin:$PATH"
    if command -v bun >/dev/null 2>&1; then
      log_ok "bun installed: $(bun --version)"
    else
      log_fail "Failed to install bun. Install manually from https://bun.sh"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_node
ensure_claude
ensure_gemini
ensure_gh
ensure_bun

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

# ─── Step 6: Install gstack ──────────────────────────────────────────

log_step "Step 6: Installing gstack (headless browser + QA skills)..."

if [ -d "$HOME/.claude/skills/gstack" ]; then
  log_warn "gstack already installed, skipping"
else
  export PATH="$HOME/.bun/bin:$PATH"
  git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git "$HOME/.claude/skills/gstack"
  cd "$HOME/.claude/skills/gstack" && ./setup && cd - >/dev/null
  if [ -d "$HOME/.claude/skills/gstack" ]; then
    log_ok "gstack installed"
  else
    log_fail "gstack installation failed"
    ERRORS=$((ERRORS + 1))
  fi
fi

# ─── Step 7: Install additional skills ───────────────────────────────

log_step "Step 7: Installing additional skills..."

install_skill() {
  local url="$1"
  local name="$2"
  if npx --yes @anthropic-ai/claude-code skills add "$url" 2>/dev/null; then
    log_ok "$name skill installed"
  else
    log_warn "Could not install $name skill. Run manually: npx skills add $url"
  fi
}

install_skill "https://github.com/Leonxlnx/taste-skill" "taste"

# ─── Step 8: NotebookLM setup ────────────────────────────────────────

log_step "Step 8: Setting up NotebookLM integration..."

ensure_pip() {
  if command -v pip3 >/dev/null 2>&1 || command -v pip >/dev/null 2>&1; then
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -m ensurepip --default-pip 2>/dev/null || true
    if command -v pip3 >/dev/null 2>&1; then return 0; fi
  fi
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y -qq python3-pip 2>/dev/null
  elif command -v brew >/dev/null 2>&1; then
    brew install python3
  fi
  command -v pip3 >/dev/null 2>&1 || command -v pip >/dev/null 2>&1
}

PIP_CMD=""
if command -v pip3 >/dev/null 2>&1; then
  PIP_CMD="pip3"
elif command -v pip >/dev/null 2>&1; then
  PIP_CMD="pip"
fi

if [ -z "$PIP_CMD" ]; then
  log_warn "pip not found. Attempting to install..."
  if ensure_pip; then
    PIP_CMD=$(command -v pip3 2>/dev/null || command -v pip 2>/dev/null)
    log_ok "pip installed"
  else
    log_fail "Could not install pip. Install Python 3 + pip manually."
    ERRORS=$((ERRORS + 1))
  fi
fi

if [ -n "$PIP_CMD" ]; then
  if command -v notebooklm >/dev/null 2>&1; then
    log_ok "notebooklm CLI already installed"
  else
    log_warn "Installing notebooklm-py..."
    $PIP_CMD install notebooklm-py 2>/dev/null
    if command -v notebooklm >/dev/null 2>&1; then
      log_ok "notebooklm CLI installed"
    else
      log_warn "notebooklm-py installed but CLI not on PATH (may need shell restart)"
    fi
  fi

  # Install the base NotebookLM skill for Claude Code
  if command -v notebooklm >/dev/null 2>&1; then
    if [ -d "$HOME/.claude/skills/notebooklm" ]; then
      log_ok "NotebookLM skill already installed"
    else
      notebooklm skill install 2>/dev/null && log_ok "NotebookLM skill installed" \
        || log_warn "Could not install NotebookLM skill (run 'notebooklm skill install' manually)"
    fi
  fi

  # Create storage directory
  mkdir -p "$HOME/.notebooklm"
  log_ok "~/.notebooklm/ directory ready"

  # Check if already authenticated
  if [ -f "$HOME/.notebooklm/storage_state.json" ]; then
    log_ok "NotebookLM storage_state.json found (cookies present)"
  else
    log_warn "No NotebookLM cookies yet. To authenticate:"
    log_warn "  1. Export cookies from notebooklm.google.com via Cookie-Editor extension"
    log_warn "  2. Run: python3 scripts/refresh_notebooklm_auth.py"
  fi
fi

# ─── Step 9: Merge model setting ─────────────────────────────────────

log_step "Step 9: Configuring model preference..."

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

# ─── Step 10: Verify installation ────────────────────────────────────

log_step "Step 10: Verifying installation..."

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
verify "$HOME/.notebooklm" "NotebookLM storage directory"
verify "$HOME/.claude/skills/gstack" "gstack skills"

# ─── Step 11: Verify project template ────────────────────────────────

log_step "Step 11: Verifying project template..."

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
verify "$SCRIPT_DIR/scripts/refresh_notebooklm_auth.py" "NotebookLM auth refresh script"

# ─── Step 12: Second Brain stack ─────────────────────────────────────

log_step "Step 12: Installing Second-Brain stack..."

ensure_python3() {
  if command -v python3 >/dev/null 2>&1; then
    log_ok "python3 found: $(python3 --version 2>&1)"
  else
    log_warn "python3 not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update && sudo apt-get install -y python3 python3-pip pipx
    elif command -v brew >/dev/null 2>&1; then
      brew install python pipx
    else
      log_fail "Cannot auto-install python3. Install from https://python.org"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v python3 >/dev/null 2>&1; then
      log_ok "python3 installed: $(python3 --version 2>&1)"
    else
      log_fail "Failed to install python3"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_pipx() {
  if command -v pipx >/dev/null 2>&1; then
    log_ok "pipx found: $(pipx --version 2>&1)"
  else
    log_warn "pipx not found. Installing..."
    python3 -m pip install --user pipx 2>/dev/null || true
    python3 -m pipx ensurepath 2>/dev/null || true
    export PATH="$HOME/.local/bin:$PATH"
    if command -v pipx >/dev/null 2>&1; then
      log_ok "pipx installed"
    else
      log_fail "Failed to install pipx"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_markitdown() {
  if command -v markitdown >/dev/null 2>&1; then
    log_ok "markitdown found"
  else
    log_warn "markitdown not found. Installing markitdown[all] via pipx..."
    pipx install 'markitdown[all]' 2>/dev/null || pipx install markitdown
    if command -v markitdown >/dev/null 2>&1; then
      log_ok "markitdown installed"
    else
      log_fail "Failed to install markitdown. Run: pipx install 'markitdown[all]'"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_yq() {
  if command -v yq >/dev/null 2>&1; then
    log_ok "yq found: $(yq --version 2>&1 | head -1)"
  else
    log_warn "yq not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
      local arch
      arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
      sudo wget -qO /usr/local/bin/yq \
        "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_${arch}" \
        && sudo chmod +x /usr/local/bin/yq
    elif command -v brew >/dev/null 2>&1; then
      brew install yq
    else
      log_fail "Cannot auto-install yq. Install from https://github.com/mikefarah/yq"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v yq >/dev/null 2>&1; then
      log_ok "yq installed"
    else
      log_fail "Failed to install yq"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_jq() {
  if command -v jq >/dev/null 2>&1; then
    log_ok "jq found: $(jq --version 2>&1)"
  else
    log_warn "jq not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -y jq
    elif command -v brew >/dev/null 2>&1; then
      brew install jq
    else
      log_fail "Cannot auto-install jq"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v jq >/dev/null 2>&1; then
      log_ok "jq installed"
    else
      log_fail "Failed to install jq"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_bats() {
  if command -v bats >/dev/null 2>&1; then
    log_ok "bats found: $(bats --version 2>&1 | head -1)"
  else
    log_warn "bats not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -y bats
    elif command -v brew >/dev/null 2>&1; then
      brew install bats-core
    else
      npm install -g bats
    fi
    if command -v bats >/dev/null 2>&1; then
      log_ok "bats installed"
    else
      log_warn "bats install failed — tests will be unavailable until bats is installed manually"
    fi
  fi
}

ensure_qmd() {
  if command -v qmd >/dev/null 2>&1; then
    log_ok "qmd found: $(qmd --version 2>&1 | head -1)"
  else
    log_warn "qmd not found. Installing @tobilu/qmd..."
    if command -v bun >/dev/null 2>&1; then
      bun install -g @tobilu/qmd
    elif command -v npm >/dev/null 2>&1; then
      npm install -g @tobilu/qmd
    else
      log_fail "Need bun or npm to install qmd"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v qmd >/dev/null 2>&1; then
      log_ok "qmd installed"
      log_warn "qmd will download GGUF models on first 'qmd embed' (~hundreds of MB)"
    else
      log_fail "Failed to install qmd"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_graphify_python() {
  if command -v graphify >/dev/null 2>&1; then
    log_ok "graphify found"
  else
    log_warn "graphify not found. Installing..."
    if command -v uv >/dev/null 2>&1; then
      uv tool install graphify || uv tool install graphifyy
    elif command -v pipx >/dev/null 2>&1; then
      pipx install graphify || pipx install graphifyy
    else
      log_fail "Need uv or pipx to install graphify"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v graphify >/dev/null 2>&1; then
      log_ok "graphify installed"
    else
      log_warn "graphify install attempted — may need manual follow-up"
    fi
  fi
}

ensure_obsidian_skills_plugin() {
  if [ -d "$HOME/.claude/plugins/cache/obsidian-skills" ]; then
    log_ok "obsidian-skills plugin present"
  else
    log_warn "obsidian-skills plugin not found at ~/.claude/plugins/cache/obsidian-skills"
    log_warn "Install via: claude plugin marketplace add kepano/obsidian-skills && claude plugin install obsidian-skills"
  fi
}

install_brain_scripts() {
  local src="$SCRIPT_DIR/templates/brain"
  local dst="$HOME/.claude/scripts/brain"

  if [ ! -d "$src" ]; then
    log_fail "templates/brain/ missing in repo"
    ERRORS=$((ERRORS + 1))
    return
  fi

  mkdir -p "$dst"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude 'tests/' "$src/" "$dst/"
  else
    cp -R "$src/." "$dst/"
    [ -d "$dst/tests" ] && rm -rf "$dst/tests"
  fi

  chmod +x "$dst/brain" "$dst"/adapters/*.sh "$dst"/pipelines/*.sh

  mkdir -p "$HOME/.local/bin"
  ln -sf "$dst/brain" "$HOME/.local/bin/brain"

  mkdir -p "$HOME/.claude/commands"
  cp "$SCRIPT_DIR/.claude/commands/brain.md" "$HOME/.claude/commands/brain.md"

  log_ok "brain scripts installed at $dst"
  log_ok "brain symlinked to ~/.local/bin/brain"
  log_ok "/brain slash command installed"
}

register_qmd_mcp() {
  local settings="$HOME/.claude/settings.json"
  command -v jq >/dev/null || { log_fail "jq required for MCP registration"; ERRORS=$((ERRORS + 1)); return; }

  if [ ! -f "$settings" ]; then
    echo '{}' > "$settings"
  fi

  if ! jq empty "$settings" 2>/dev/null; then
    log_warn "settings.json is malformed — backing up and resetting"
    cp "$settings" "${settings}.broken.$(date +%s).bak"
    echo '{}' > "$settings"
  fi

  cp "$settings" "${settings}.bak"

  jq '.mcpServers = ((.mcpServers // {}) + {qmd: {command: "qmd", args: ["mcp"]}})' \
    "$settings" > "${settings}.tmp" && mv "${settings}.tmp" "$settings"

  if jq -e '.mcpServers.qmd.command == "qmd"' "$settings" >/dev/null; then
    log_ok "qmd MCP registered in $settings"
  else
    log_fail "failed to register qmd MCP"
    ERRORS=$((ERRORS + 1))
  fi
}

bootstrap_vault() {
  if [ -d "$HOME/second-brain" ]; then
    log_ok "vault already exists at ~/second-brain"
  else
    "$HOME/.claude/scripts/brain/brain" init
    log_ok "vault bootstrapped"
  fi
}

ensure_python3
ensure_pipx
ensure_markitdown
ensure_yq
ensure_jq
ensure_bats
ensure_qmd
ensure_graphify_python
ensure_obsidian_skills_plugin
install_brain_scripts
register_qmd_mcp
bootstrap_vault

if [ "$RUN_TESTS" -eq 1 ]; then
  log_step "Step 12.1: Running brain bats tests..."
  if command -v bats >/dev/null 2>&1; then
    if bats "$SCRIPT_DIR/templates/brain/tests/" 2>&1 | tail -20; then
      log_ok "brain tests passed"
    else
      log_fail "brain tests failed"
      ERRORS=$((ERRORS + 1))
    fi
  else
    log_warn "bats not installed — tests skipped"
  fi
fi

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
  echo "  NotebookLM (optional):"
  echo "    1. Export cookies from notebooklm.google.com via Cookie-Editor"
  echo "    2. python3 scripts/refresh_notebooklm_auth.py"
  echo "    3. notebooklm use <notebook-id>"
  echo ""
else
  FAILED=$((CHECKS - PASSED))
  log_warn "$FAILED check(s) failed. Review the output above."
  exit 1
fi
