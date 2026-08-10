/*
 * REPO-DNA: qm
 * Source: https://github.com/yc-software/qm   Commit/Ref: 7f2c916
 * Archetype: multiplayer agent harness (headless server, TypeScript)
 * The bet: scope-isolation — every person and every room gets an independent
 *          workspace/sandbox/memory/keychain, yet any harness (Pi, OpenCode,
 *          Codex, Claude Code) drives the same core through a single interface,
 *          so the deployment is never tied to one vendor's agent loop.
 *
 * This is not the repo. This is its variant fraction — what it does that its
 * peers do not.
 */

// ============================================================================
// REFERENCE GENOME  (the competent default for a multi-user agent server in TS)
// ============================================================================
// A capable engineer would: wrap ONE coding-agent SDK behind an HTTP API, store
// chat history in Postgres, expose tool calls via a fixed list of functions,
// run everything in a shared filesystem or container, gate access with an API
// key, and deploy to one cloud. Model, memory, sandbox, and surface are
// tightly coupled — swapping models means rewriting the loop; adding Slack
// means forking the codebase.

// ============================================================================
// THE LOAD-BEARING BET  (kernel — verified runnable)
// ============================================================================
// The system routes EVERY turn through an Orchestrator that resolves a ScopeId
// before touching model, memory, or sandbox. The scope IS the isolation unit:
// personal:U1, channel:C1, group:G1. Everything downstream — workspace layers,
// egress policy, command policy, security posture, skill visibility — derives
// from the scope. A harness is just a turn-executor plugged in by interface.

type ScopeKind = "personal" | "channel" | "team" | "org" | "group";
type ScopeId = `${ScopeKind}:${string}`;

function scopeId(kind: ScopeKind, ref: string): ScopeId {
  return `${kind}:${ref}`;
}
function personalScope(principalId: string): ScopeId {
  return scopeId("personal", principalId);
}

interface Principal {
  id: string;
  type: "internal" | "guest";
  teamIds?: string[];
}

// Resolution: conversation → scope → layers + policy + security
interface Resolution {
  layers: { scopeId: ScopeId; mountPath: string; mode: "ro" | "rw" }[];
  systemPrompt: string;
  commandPolicy: CommandPolicy;
  securityPolicy: { inboundScreening: "off" | "external"; toolApprovals: "none" | "all" };
  egress: { allowedHosts: string[]; deniedHosts: string[] };
}

interface CommandPolicy {
  mode: "denylist" | "allowlist";
  rules: { pattern: string; decision: "allow" | "deny" | "require_approval"; reason?: string }[];
}

// Harness interface — the interchangeability surface
interface Harness {
  turn(input: HarnessTurnInput): Promise<HarnessTurnResult>;
  compact?(input: unknown): Promise<string>;
  detect?(input: unknown): Promise<unknown>;
}
interface HarnessTurnInput {
  session: { id: string; scopeId: ScopeId };
  input: string;
  systemPrompt: string;
  history: unknown[];
  tools: ToolContext;
  model?: string;
  cancel?: AbortSignal;
  emit(entry: unknown): Promise<unknown>;
}
interface HarnessTurnResult {
  reply: string;
  pendingApprovals?: { command: string; reason: string }[];
}

// Tool context — the fixed surface presented to every harness
interface ToolContext {
  execute(command: string): Promise<ExecResult>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  publish(input: unknown): Promise<unknown>;
  memory: { recall(): Promise<string>; capture(facts: string[]): Promise<void> };
}
interface ExecResult { stdout: string; stderr: string; code: number; timedOut: boolean }

// --- Kernel: demonstrate scope-isolation + harness-agnostic turn ---
function createResolution(actor: Principal, kind: "dm" | "channel"): Resolution {
  const scope: ScopeId = kind === "dm"
    ? personalScope(actor.id)
    : scopeId("channel", "C_GENERAL");
  const orgScope = scopeId("org", "acme");
  return {
    layers: [
      { scopeId: orgScope, mountPath: "global", mode: "ro" },
      { scopeId: scope, mountPath: "", mode: "rw" },
    ],
    systemPrompt: "You are a helpful assistant.",
    commandPolicy: {
      mode: "denylist",
      rules: [
        { pattern: "\\brm\\b.*--recursive", decision: "require_approval", reason: "recursive delete" },
        { pattern: "\\bmkfs\\b", decision: "deny", reason: "destructive" },
      ],
    },
    securityPolicy: { inboundScreening: "external", toolApprovals: "none" },
    egress: { allowedHosts: [], deniedHosts: [] },
  };
}

// Demonstrate the Orchestrator's core path: resolve scope, pick harness, run turn
async function orchestrate(
  actor: Principal,
  message: string,
  harness: Harness,
  kind: "dm" | "channel" = "dm",
): Promise<string> {
  const resolution = createResolution(actor, kind);
  const scope = resolution.layers.find(l => l.mode === "rw")!.scopeId;
  console.log(`[orchestrate] scope=${scope} layers=${resolution.layers.length}`);

  // Command policy gate (simplified)
  const commandCheck = (cmd: string): "allow" | "deny" | "require_approval" => {
    for (const rule of resolution.commandPolicy.rules) {
      if (new RegExp(rule.pattern, "i").test(cmd)) return rule.decision;
    }
    return resolution.commandPolicy.mode === "allowlist" ? "deny" : "allow";
  };

  const tools: ToolContext = {
    async execute(command) {
      const decision = commandCheck(command);
      if (decision === "deny") return { stdout: "", stderr: "DENIED", code: 1, timedOut: false };
      if (decision === "require_approval") return { stdout: "", stderr: "NEEDS_APPROVAL", code: 1, timedOut: false };
      return { stdout: `ran: ${command}`, stderr: "", code: 0, timedOut: false };
    },
    async read(path) { return `[content of ${scope}/${path}]`; },
    async write(_path, _content) {},
    async publish(_input) { return { url: "https://app.example" }; },
    memory: {
      async recall() { return `[memory for ${scope}]`; },
      async capture(_facts) {},
    },
  };

  const result = await harness.turn({
    session: { id: "sess_1", scopeId: scope },
    input: message,
    systemPrompt: resolution.systemPrompt,
    history: [],
    tools,
    emit: async (e) => e,
  });
  console.log(`[orchestrate] reply="${result.reply}"`);
  return result.reply;
}

// A mock harness proves any SDK can slot in
const mockHarness: Harness = {
  async turn(input) {
    const mem = await input.tools.memory.recall();
    const exec = await input.tools.execute("echo hello");
    return { reply: `[mock-harness] scope=${input.session.scopeId} mem=${mem} exec=${exec.stdout}` };
  },
};

// Run kernel
const alice: Principal = { id: "U_ALICE", type: "internal", teamIds: ["T1"] };
const bob: Principal = { id: "U_BOB", type: "internal" };

await orchestrate(alice, "deploy the app", mockHarness, "dm");
await orchestrate(bob, "check CI status", mockHarness, "channel");

// Denied command demonstration
const denyHarness: Harness = {
  async turn(input) {
    const r = await input.tools.execute("mkfs /dev/sda1");
    return { reply: `exec result: code=${r.code} stderr=${r.stderr}` };
  },
};
await orchestrate(alice, "nuke disk", denyHarness);

// ============================================================================
// SIGNATURE PATTERN 1: Scope-scoped everything
// ============================================================================
// Memory, workspace, skills, sandbox, keychain — each store takes a ScopeId
// as its first argument. There is no global state shared across scopes.

interface MemoryService {
  recall(scope: ScopeId): Promise<string>;
  capture(scope: ScopeId, facts: string[], at: number): Promise<number>;
}

interface WorkspaceStore {
  scopeDir(scope: ScopeId): string;
  read(scope: ScopeId, path: string): Promise<string | null>;
  write(scope: ScopeId, path: string, data: string): Promise<void>;
}

interface SkillStore {
  list(scope: ScopeId): Promise<SkillResolution[]>;
  get(scope: ScopeId, name: string): Promise<SkillResolution | null>;
}
interface SkillResolution { skill: { manifest: { name: string; body: string } } | null }

// ============================================================================
// SIGNATURE PATTERN 2: Security posture as a composable enum
// ============================================================================
// The org sets a floor posture (dangerous < auto < strict); scopes can only
// tighten. The posture determines two booleans: inbound screening and tool
// approval gates. Command policy is a separate composable layer (org floor +
// scope overlay, denylist or allowlist).

type SecurityPosture = "dangerous" | "auto" | "strict";
const POSTURE_RANK: Record<SecurityPosture, number> = { dangerous: 0, auto: 1, strict: 2 };

function composeSecurityPosture(orgFloor: SecurityPosture, scope?: SecurityPosture | null): SecurityPosture {
  if (!scope || POSTURE_RANK[orgFloor] >= POSTURE_RANK[scope]) return orgFloor;
  return scope;
}
console.log(`[posture] org=auto scope=strict → ${composeSecurityPosture("auto", "strict")}`);
console.log(`[posture] org=strict scope=dangerous → ${composeSecurityPosture("strict", "dangerous")}`);

// ============================================================================
// SIGNATURE PATTERN 3: Harness-router — multi-vendor by interface, not by fork
// ============================================================================
// Pi, OpenCode, Codex, Claude Code each implement the same Harness interface.
// The router resolves which harness+model to use per turn based on org config,
// scope config, and per-request overrides — with an "approved harnesses" gate.

type HarnessId = "pi" | "opencode" | "codex" | "claude-code";
interface RuntimeChoice { harnessId: HarnessId; modelId: string }

function resolveRuntimeChoice(
  approved: HarnessId[],
  orgDefault: RuntimeChoice,
  scopeOverride?: Partial<RuntimeChoice>,
  requestOverride?: Partial<RuntimeChoice>,
): RuntimeChoice {
  const base = scopeOverride?.harnessId && approved.includes(scopeOverride.harnessId)
    ? { harnessId: scopeOverride.harnessId, modelId: scopeOverride.modelId ?? orgDefault.modelId }
    : orgDefault;
  if (!requestOverride?.harnessId) return base;
  if (!approved.includes(requestOverride.harnessId)) throw new Error("harness not approved");
  return { harnessId: requestOverride.harnessId, modelId: requestOverride.modelId ?? base.modelId };
}
console.log(`[router] ${JSON.stringify(resolveRuntimeChoice(["pi", "opencode"], { harnessId: "pi", modelId: "sonnet" }, { harnessId: "opencode" }))}`);

// ============================================================================
// STRUCTURAL COMMITMENT: Deployment-layer separation
// ============================================================================
// The core is generic. Everything org-specific lives in a deployment directory
// (validated by the `qm` CLI) that wires substrates at startup. The wiring.ts
// file instantiates every store interface from config — Postgres vs in-memory,
// AWS vs Fly vs local sandbox, env-based vs Secrets Manager credentials.
// A private-fork model (not GitHub Fork) lets orgs carry core + customizations
// in one repo while keeping merges small (core stays byte-identical to upstream).

interface DeploymentLayer {
  soul?: string;                 // org system prompt
  commandPolicy?: CommandPolicy; // org command floor
  sandboxImage?: string;         // custom sandbox base
  skills?: string[];             // skill pack repos
  tools?: BrokeredTool[];        // custom API tools
}
interface BrokeredTool { service: string; endpoint: string }

// ============================================================================
// GROWTH SEAMS
// ============================================================================
// 1. New harness: implement Harness interface, add to harness-router approved list
// 2. New surface: plugins/ directory — Slack, web-ui, admin, portal are all plugins
//    over the core's HTTP API; add another by mounting Fastify routes
// 3. New tool: extend ToolContext in tools/primitives.ts — every harness sees it
// 4. New persistence backend: implement SessionStore / WorkspaceStore / MemoryService
//    interface, wire in wiring.ts

// ============================================================================
// NEGATIVE SPACE — deliberately left out (common to the ecosystem, not DNA)
// ============================================================================
// - LLM prompt engineering / chain-of-thought patterns (every agent does this)
// - Postgres schema details (standard CRUD + pg-boss queue)
// - Slack Bolt integration boilerplate (standard @slack/bolt usage)
// - Fastify HTTP routing (generic REST API patterns)
// - Docker / Fly / AWS deploy scaffolding (standard IaC)
// - Token counting / context windowing (all agent loops do this)
//
// Rebuild test: YES — a senior dev reading this DNA knows: scope-isolation is
// the primitive, harness is an interface not a dependency, security composes
// monotonically, and the deployment layer is the org-specific seam.
//
// Confusion test: YES — this cannot be mistaken for a single-user coding agent
// (Cursor, Aider, Claude Code) or a framework (LangChain, CrewAI). The
// distinguishing signature is multiplayer-scope-isolation + vendor-agnostic
// harness routing + org-deployable-layer separation.
