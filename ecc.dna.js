/*
 * REPO-DNA: Everything Claude Code (ECC)
 * Source: https://github.com/affaan-m/ECC
 * Identity: A harness-native agent operating system that turns AI coding assistants
 *           into governed, skill-routed, hook-enforced production workflows.
 *
 * This is not the repo. This is what makes the repo unique.
 */

// ─── IDENTITY CORE ───────────────────────────────────────────────────────────
// ECC's unique insight: AI coding agents need an "operating system" layer —
// not the model, not the IDE, but the governance + routing + memory fabric
// between them. ECC treats every AI harness (Claude, Cursor, Codex, Gemini,
// Zed, OpenCode) as a deployment target for the SAME skill/hook/rule catalog.

const SUPPORTED_INSTALL_TARGETS = [
  'claude', 'claude-project', 'cursor', 'antigravity',
  'codex', 'gemini', 'opencode', 'codebuddy', 'joycode', 'qwen', 'zed',
];

function installToAnyHarness(target, profile, options = {}) {
  const adapter = getInstallTargetAdapter(target);
  const plan = resolveInstallPlan(profile, {
    target,
    include: options.with || [],
    exclude: options.without || [],
  });
  return adapter.apply(plan);
}

// ─── SIGNATURE PATTERN 1: Hook-Based Governance ──────────────────────────────
// ECC intercepts EVERY tool call (Bash, Write, Edit) with pre/post hooks.
// Hooks are the immune system — they enforce policy without modifying the model.

const HOOKS_SCHEMA = {
  PreToolUse: [
    {
      matcher: 'Bash',
      id: 'pre:bash:dispatcher',
      description: 'Consolidated Bash preflight: quality, tmux, push, GateGuard',
      hooks: [{ type: 'command', command: 'node scripts/hooks/pre-bash-dispatcher.js' }],
    },
    {
      matcher: 'Edit|Write|MultiEdit',
      id: 'pre:edit-write:gateguard-fact-force',
      description: 'Block first edit per file; demand investigation before allowing',
      hooks: [{ type: 'command', command: 'node scripts/hooks/gateguard-fact-force.js' }],
    },
    {
      matcher: 'Edit|Write|MultiEdit',
      id: 'pre:config-protection',
      description: 'Block modifications to linter/formatter configs; fix code instead',
      hooks: [{ type: 'command', command: 'node scripts/hooks/config-protection.js' }],
    },
    {
      matcher: '*',
      id: 'pre:observe:continuous-learning',
      description: 'Capture tool use observations for continuous learning',
      hooks: [{ type: 'command', command: 'node scripts/hooks/observe-runner.js', async: true }],
    },
    {
      matcher: '*',
      id: 'pre:governance-capture',
      description: 'Capture governance events (secrets, policy violations)',
      hooks: [{ type: 'command', command: 'node scripts/hooks/governance-capture.js' }],
    },
  ],
  PostToolUse: [
    {
      matcher: 'Bash',
      id: 'post:bash:test-watcher',
      description: 'Detect test failures and trigger TDD-guide agent',
    },
  ],
  PreCompact: [
    { id: 'pre:compact:session-persist', description: 'Persist session state before compaction' },
  ],
};

// ─── SIGNATURE PATTERN 2: Manifest-Driven Selective Install ──────────────────
// ECC doesn't dump everything into one target. It has a module/profile/component
// manifest system that lets users compose exactly what they need.

const INSTALL_PROFILES = {
  core: { modules: ['rules:common', 'hooks:core', 'agents:planner', 'agents:reviewer'] },
  developer: { extends: 'core', modules: ['skills:tdd-workflow', 'skills:security-review', 'commands:all'] },
  full: { extends: 'developer', modules: ['skills:*', 'agents:*', 'mcp-configs:*'] },
};

function resolveInstallPlan(profileId, { target, include, exclude }) {
  const profile = INSTALL_PROFILES[profileId] || INSTALL_PROFILES.core;
  let modules = expandModules(profile);

  if (include.length) modules = modules.concat(resolveComponentModules(include));
  if (exclude.length) modules = modules.filter(m => !exclude.some(e => m.startsWith(e)));

  const adapter = getInstallTargetAdapter(target);
  return {
    mode: 'manifest',
    target,
    adapter,
    operations: modules.map(m => adapter.mapModuleToOperation(m)),
    installStatePath: adapter.getStatePath(),
  };
}

// ─── SIGNATURE PATTERN 3: Plugin Root Discovery ──────────────────────────────
// Every hook must find the ECC install location at runtime, across all possible
// install paths. This bootstrap pattern appears in every single hook command.

function discoverPluginRoot() {
  const home = require('os').homedir();
  const claudeDir = require('path').join(home, '.claude');
  const sentinel = require('path').join('scripts', 'lib', 'utils.js');

  // Direct install
  if (require('fs').existsSync(require('path').join(claudeDir, sentinel))) return claudeDir;

  // Plugin marketplace paths
  const prefixes = [
    ['ecc'], ['ecc@ecc'], ['marketplaces', 'ecc'],
    ['everything-claude-code'], ['marketplaces', 'everything-claude-code'],
  ];
  for (const prefix of prefixes) {
    const candidate = require('path').join(claudeDir, 'plugins', ...prefix);
    if (require('fs').existsSync(require('path').join(candidate, sentinel))) return candidate;
  }

  // Cache directory (versioned installs)
  for (const name of ['ecc', 'everything-claude-code']) {
    const cacheBase = require('path').join(claudeDir, 'plugins', 'cache', name);
    try {
      for (const org of require('fs').readdirSync(cacheBase, { withFileTypes: true })) {
        if (!org.isDirectory()) continue;
        for (const ver of require('fs').readdirSync(require('path').join(cacheBase, org.name), { withFileTypes: true })) {
          if (!ver.isDirectory()) continue;
          const candidate = require('path').join(cacheBase, org.name, ver.name);
          if (require('fs').existsSync(require('path').join(candidate, sentinel))) return candidate;
        }
      }
    } catch (_) { /* not installed via cache */ }
  }

  return claudeDir;
}

// ─── ARCHITECTURAL DNA: Agent Routing ────────────────────────────────────────
// ECC's core philosophy is "route work to the right specialist."
// 30+ agents are markdown files with YAML frontmatter defining their capabilities.

const AGENT_TAXONOMY = {
  planners: ['planner', 'implementation-planner', 'architect'],
  reviewers: ['code-reviewer', 'security-reviewer', 'a11y-architect'],
  builders: ['tdd-guide', 'build-resolver', 'e2e-runner'],
  operators: ['session-manager', 'loop-status', 'orchestrator'],
};

function routeToAgent(taskType, context) {
  const agentId = AGENT_TAXONOMY[taskType]?.[0];
  if (!agentId) throw new Error(`No agent for task type: ${taskType}`);

  return {
    agent: agentId,
    tools: loadAgentTools(agentId),
    model: loadAgentModel(agentId),
    prompt: injectSkillConventions(agentId, context),
  };
}

// Agent definition format (markdown with YAML frontmatter)
const AGENT_FORMAT = `
---
name: code-reviewer
description: Reviews code for quality, patterns, and potential issues
tools: [Read, Grep, Glob, Bash]
model: sonnet
---
## Review Protocol
1. Check for correctness and edge cases
2. Verify test coverage
3. Assess security implications
4. Validate naming and structure conventions
`;

// ─── ARCHITECTURAL DNA: Skills as Knowledge Units ────────────────────────────
// Skills are composable knowledge capsules: when to use, how it works, examples.
// 135+ skills cover languages, frameworks, patterns, and operational workflows.

function loadSkill(skillId) {
  const skillPath = `skills/${skillId}/skill.md`;
  return {
    id: skillId,
    whenToUse: extractSection(skillPath, 'When to Use'),
    howItWorks: extractSection(skillPath, 'How It Works'),
    examples: extractSection(skillPath, 'Examples'),
  };
}

// ─── ARCHITECTURAL DNA: Install Target Adapters ──────────────────────────────
// Each AI harness has different file layout expectations.
// Adapters normalize: same skill content, different filesystem shape.

function getInstallTargetAdapter(target) {
  const adapters = {
    claude: {
      id: 'claude',
      installRoot: () => require('path').join(require('os').homedir(), '.claude'),
      rulesDir: () => 'rules/ecc',
      skillsDir: () => 'skills/ecc',
      mapModuleToOperation: (mod) => ({ source: mod.source, dest: `${mod.category}/ecc/${mod.name}` }),
      getStatePath: () => '.claude/ecc/install-state.json',
    },
    cursor: {
      id: 'cursor',
      installRoot: () => '.cursor',
      rulesDir: () => 'rules',
      skillsDir: () => 'rules',  // Cursor flattens skills into rules
      mapModuleToOperation: (mod) => ({ source: mod.source, dest: `.cursor/rules/${mod.name}.mdc` }),
      getStatePath: () => '.cursor/ecc-install-state.json',
    },
    codex: {
      id: 'codex',
      installRoot: () => require('path').join(require('os').homedir(), '.codex'),
      mapModuleToOperation: (mod) => ({ source: mod.source, dest: `agents/${mod.name}.md` }),
      getStatePath: () => '.codex/ecc-install-state.json',
    },
  };
  return adapters[target] || adapters.claude;
}

// ─── EXTENSION POINTS ────────────────────────────────────────────────────────

// 1. New install targets: add an adapter to the registry
function registerInstallTarget(targetId, adapter) {
  SUPPORTED_INSTALL_TARGETS.push(targetId);
  // Adapter must implement: installRoot, rulesDir, skillsDir, mapModuleToOperation, getStatePath
}

// 2. New hooks: add entries to hooks.json with matcher + command
function registerHook(phase, matcher, hookScript, options = {}) {
  return {
    matcher,
    id: `${phase}:${matcher.toLowerCase()}:${hookScript}`,
    hooks: [{ type: 'command', command: `node scripts/hooks/${hookScript}`, ...options }],
  };
}

// 3. New skills: create skills/<id>/skill.md with standard sections
// 4. New agents: create agents/<name>.md with YAML frontmatter
// 5. New commands: create commands/<name>.md
// 6. New manifests: add modules to manifests/install-modules.json

// ─── THE "AHA" CODE ──────────────────────────────────────────────────────────
// The GateGuard hook is the single pattern that unlocks understanding of ECC.
// It BLOCKS the first edit to any file and forces the agent to investigate first.
// This embodies ECC's philosophy: agents must understand before they modify.

function gateGuardFactForce(toolInput) {
  const { file_path } = toolInput;
  const sessionState = loadSessionState();

  if (!sessionState.investigatedFiles.has(file_path)) {
    return {
      decision: 'block',
      reason: [
        `BLOCKED: You must investigate "${file_path}" before editing.`,
        'Required investigation:',
        '1. Find all importers/consumers of this file',
        '2. Check data schemas and contracts',
        '3. Review user instructions about this area',
        'After investigation, the edit will be allowed.',
      ].join('\n'),
    };
  }

  return { decision: 'allow' };
}

// Session state persistence: hooks share state across a coding session
function loadSessionState() {
  const stateDir = process.env.ECC_SESSION_DIR || '/tmp/ecc-session';
  try {
    return JSON.parse(require('fs').readFileSync(`${stateDir}/state.json`, 'utf8'));
  } catch (_) {
    return { investigatedFiles: new Set(), observations: [], governanceEvents: [] };
  }
}

// ─── CROSS-HARNESS PORTABLE IDENTITY ─────────────────────────────────────────
// The ultimate DNA: one catalog of intelligence, many deployment surfaces.
// This is what makes ECC unique — it's not a plugin for ONE tool,
// it's an operating system for ALL AI coding agents.

const ECC_IDENTITY = {
  name: 'ECC',
  version: '2.0.0-rc.1',
  tagline: 'Harness-native agent operating system',
  surfaces: SUPPORTED_INSTALL_TARGETS,
  primitives: ['agents', 'skills', 'hooks', 'rules', 'commands', 'mcp-configs'],
  philosophy: {
    agentFirst: 'Route work to the right specialist as early as possible',
    testDriven: 'Write or refresh tests before trusting implementation changes',
    securityFirst: 'Validate inputs, protect secrets, keep safe defaults',
    planBeforeExecute: 'Complex changes broken into deliberate phases',
    understandBeforeModify: 'GateGuard forces investigation before any edit',
  },
};

module.exports = {
  ECC_IDENTITY,
  SUPPORTED_INSTALL_TARGETS,
  HOOKS_SCHEMA,
  INSTALL_PROFILES,
  AGENT_TAXONOMY,
  installToAnyHarness,
  resolveInstallPlan,
  discoverPluginRoot,
  routeToAgent,
  gateGuardFactForce,
  getInstallTargetAdapter,
  registerInstallTarget,
  registerHook,
};
