/*
 * REPO-DNA: OpenCode
 * Source: https://github.com/anomalyco/opencode
 * Identity: AI coding agent with LSP-powered code intelligence and client/server TUI architecture
 * 
 * This is not the repo. This is what makes the repo unique.
 * 
 * NOTE: This is conceptual code showing architecture and patterns.
 * Some functions are referenced but not fully implemented to keep focus
 * on the unique architectural patterns rather than implementation details.
 */

// =============================================================================
// IDENTITY CORE: Agent-Tool-Session Architecture
// =============================================================================
// OpenCode's unique insight: An AI agent that operates like an IDE would—
// using Language Server Protocol for true code understanding, not just text.
// This is the key differentiator: LSP-native intelligence in an AI agent.

class OpenCodeAgent {
  constructor(agentInfo, tools, lsp) {
    this.agent = agentInfo;        // Agent configuration (build, plan, general)
    this.tools = tools;            // Tool registry (bash, edit, grep, etc.)
    this.lsp = lsp;                // LSP servers for code intelligence
    this.session = null;           // Current session context
    this.permission = agentInfo.permission; // Permission system
  }

  async *processMessage(userMessage, model) {
    // The core loop: LLM → Tool calls → LSP queries → Results → LLM
    const messages = await this.prepareContext(userMessage);
    
    while (true) {
      // Stream response from LLM with tool calls
      const stream = await this.llmStream(messages, model);
      
      for await (const chunk of stream) {
        if (chunk.type === 'tool-call') {
          // Execute tool with LSP context if needed
          const result = await this.executeTool(chunk.toolCall);
          messages.push({ role: 'tool', content: result });
        }
        if (chunk.type === 'text') {
          yield chunk.text;
        }
        if (chunk.type === 'finish') {
          return;
        }
      }
    }
  }

  async executeTool(toolCall) {
    // Check permissions before execution
    const allowed = await this.checkPermission(toolCall);
    if (!allowed) throw new Error('Permission denied');
    
    // Execute with LSP enhancement
    const tool = this.tools.get(toolCall.name);
    const context = { lsp: this.lsp, session: this.session };
    return await tool.execute(toolCall.arguments, context);
  }
}

// =============================================================================
// SIGNATURE PATTERN 1: LSP-First Code Intelligence
// =============================================================================
// Not just grep and read—OpenCode uses Language Servers for semantic understanding.
// This is what makes it feel like an IDE in agent form.

class LSPIntegration {
  constructor() {
    this.servers = new Map(); // language → LSP server mapping
    this.clients = new Map(); // file → LSP client cache
  }

  async getSymbols(filePath) {
    const client = await this.getClient(filePath);
    // Get semantic structure, not just text
    const symbols = await client.request('textDocument/documentSymbol', {
      textDocument: { uri: filePathToURI(filePath) }
    });
    return symbols; // Classes, functions, variables with types
  }

  async getDefinition(filePath, position) {
    const client = await this.getClient(filePath);
    // Jump to definition like an IDE
    return await client.request('textDocument/definition', {
      textDocument: { uri: filePathToURI(filePath) },
      position: { line: position.line, character: position.character }
    });
  }

  async getDiagnostics(filePath) {
    const client = await this.getClient(filePath);
    // Get compiler/linter errors in real-time
    return await client.request('textDocument/diagnostic', {
      textDocument: { uri: filePathToURI(filePath) }
    });
  }

  async getClient(filePath) {
    // Auto-detect language and spawn appropriate LSP server
    const language = detectLanguage(filePath);
    if (!this.servers.has(language)) {
      const serverConfig = await this.getServerConfig(language);
      const server = await this.spawnServer(serverConfig);
      this.servers.set(language, server);
    }
    return this.servers.get(language);
  }

  async spawnServer(config) {
    // Spawn LSP server process (e.g., typescript-language-server, pyright)
    const server = spawn(config.command, config.args);
    const client = new LSPClient(server.stdin, server.stdout);
    await client.initialize(config.initOptions);
    return client;
  }
}

// =============================================================================
// SIGNATURE PATTERN 2: Tool Registry with Permission System
// =============================================================================
// Tools are the agent's hands. Each tool has schema, execution, and permissions.
// The registry pattern allows dynamic tool loading and custom tool plugins.

const Tool = {
  define(id, init) {
    return {
      id,
      init: async (ctx) => {
        const tool = await (typeof init === 'function' ? init(ctx) : init);
        return {
          description: tool.description,
          parameters: tool.parameters, // Zod schema
          execute: async (args, toolCtx) => {
            // Validate arguments
            const validated = tool.parameters.parse(args);
            // Check permissions
            await toolCtx.ask({
              action: id,
              target: args.path || args.command,
              permission: toolCtx.agent.permission
            });
            // Execute
            return await tool.execute(validated, toolCtx);
          }
        };
      }
    };
  }
};

// Example: Edit tool with LSP awareness
const EditTool = Tool.define('edit', {
  description: 'Edit a file by replacing old text with new text',
  parameters: {
    path: { type: 'string', description: 'File path to edit' },
    old_str: { type: 'string', description: 'Exact text to replace' },
    new_str: { type: 'string', description: 'New text to insert' }
  },
  execute: async (args, ctx) => {
    // Read file
    const content = await readFile(args.path);
    
    // Verify old_str exists and is unique
    const occurrences = content.split(args.old_str).length - 1;
    if (occurrences === 0) throw new Error('String not found');
    if (occurrences > 1) throw new Error('String not unique');
    
    // Perform replacement
    const newContent = content.replace(args.old_str, args.new_str);
    await writeFile(args.path, newContent);
    
    // Use LSP to validate changes
    if (ctx.lsp) {
      const diagnostics = await ctx.lsp.getDiagnostics(args.path);
      if (diagnostics.errors.length > 0) {
        return {
          title: 'Edit completed with errors',
          output: formatDiagnostics(diagnostics),
          metadata: { hasErrors: true }
        };
      }
    }
    
    return {
      title: 'File edited successfully',
      output: `Replaced text in ${args.path}`,
      metadata: { linesChanged: countLines(args.new_str) }
    };
  }
});

// =============================================================================
// SIGNATURE PATTERN 3: Client/Server Architecture with TUI
// =============================================================================
// Server exposes HTTP/WebSocket API; TUI is just one client

class OpenCodeServer {
  constructor() {
    this.sessions = new Map();
    this.bus = new EventBus();
  }

  async handleRequest(req, res) {
    // API routes: /session/create, /session/:id/message, /lsp/symbols, /tool/:name
    const routes = {
      'POST /session/create': () => Session.create(req.body),
      'POST /session/:id/message': async () => {
        const session = this.sessions.get(req.params.id);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for await (const chunk of session.processMessage(req.body.content)) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.end();
      },
      'GET /lsp/symbols': () => this.getLSP(req.query.projectID).getSymbols(req.query.file),
      'POST /tool/:name': () => ToolRegistry.get(req.params.name).execute(req.body.args)
    };
    return routes[`${req.method} ${req.path}`]?.();
  }

  // mDNS for local discovery
  advertise() {
    new MDNS().advertise({ name: 'OpenCode', type: 'opencode', port: 4096 });
  }
}

// TUI connects via WebSocket, two-pane layout (chat | context)
class TUIClient {
  constructor(serverURL) {
    this.ws = new WebSocket(serverURL);
    this.renderer = new TerminalRenderer();
  }

  run() {
    this.renderer.layout({ left: 'chat', right: 'context' });
    this.ws.on('message', (event) => {
      // Handle different event types: text-delta, tool-call, permission-request
      if (event.type === 'text-delta') this.renderer.appendText(event.text);
      if (event.type === 'tool-call') this.renderer.showToolCall(event.tool);
      if (event.type === 'permission-request') this.renderer.promptPermission(event.request);
    });
    this.renderer.on('input', (text) => this.ws.send({ type: 'message', content: text }));
  }
}

// =============================================================================
// ARCHITECTURAL DNA: Permission System
// =============================================================================
// Fine-grained control: allow/deny/ask per action and file pattern

class PermissionSystem {
  constructor(rules) { this.rules = rules; }

  async check(request) {
    const rule = this.matchRule(request.action, request.target);
    if (rule === 'allow') return true;
    if (rule === 'deny') throw new Error('Permission denied');
    if (rule === 'ask') return await this.promptUser(request) === 'allow';
    return false;
  }

  matchRule(action, target) {
    for (const [pattern, perm] of this.rules) {
      if (matchGlob(pattern, target)) return perm[action] || perm['*'];
    }
    return 'ask';
  }
}

// Agent permissions presets
const AgentPermissions = {
  build: { '*': 'allow', 'doom_loop': 'ask', 'read': { '*': 'allow', '*.env': 'deny' } },
  plan: { 'edit': { '*': 'deny' }, 'bash': 'ask', 'read': { '*': 'allow' } }
};

// =============================================================================
// ARCHITECTURAL DNA: Session with Message History & Compaction
// =============================================================================
// Maintains state with auto-compaction when approaching token limits

class Session {
  constructor(id, directory, agent) {
    this.id = id;
    this.directory = directory;
    this.agent = agent;
    this.messages = [];
    this.snapshot = null;
  }

  async *processMessage(userMessage) {
    this.messages.push({ role: 'user', content: userMessage, time: Date.now() });

    // Auto-compact at 100k tokens
    if (this.estimateTokens() > 100000) await this.compact();

    const assistantMessage = { id: generateID(), role: 'assistant', parts: [] };
    const processor = new SessionProcessor({ session: this, agent: this.agent });

    for await (const part of processor.process()) {
      assistantMessage.parts.push(part);
      yield part;
    }

    await this.updateSnapshot();
    this.messages.push(assistantMessage);
  }

  estimateTokens() {
    return this.messages.reduce((sum, m) => sum + Math.ceil((m.content?.length || 0) / 4), 0);
  }

  async compact() {
    const oldMessages = this.messages.slice(0, -20);
    const prompt = `Summarize:\n${oldMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
    const summary = await this.agent.summarize(prompt);
    this.messages = [{ role: 'system', content: summary }, ...this.messages.slice(-20)];
  }

  async updateSnapshot() {
    const diff = await gitDiff(this.directory);
    this.snapshot = { files: diff.files, additions: diff.additions, deletions: diff.deletions };
  }
}

// =============================================================================
// EXTENSION POINTS: Plugin System
// =============================================================================
// Custom tools, agents, and MCP servers

const PluginSystem = {
  async loadTools() {
    for (const file of await glob('~/.opencode/tool/*.{js,ts}')) {
      ToolRegistry.register((await import(file)).default);
    }
  },
  async loadAgents(config) {
    for (const [name, cfg] of Object.entries(config.agents || {})) {
      Agent.register({ name, ...cfg, mode: cfg.mode || 'subagent' });
    }
  },
  async loadMCPServers(config) {
    for (const cfg of config.mcp?.servers || []) {
      const server = await MCP.connect(cfg);
      server.tools.forEach(t => ToolRegistry.register(fromMCPTool(t)));
    }
  }
};

// =============================================================================
// THE "AHA" CODE: Complete Request Flow
// =============================================================================
// This demonstrates the entire OpenCode flow in one example

async function handleCodeRequest(userMessage) {
  // 1. Create session in project directory
  const session = await Session.create({
    directory: process.cwd(),
    agent: 'build'
  });

  // 2. Initialize LSP for code intelligence
  const lsp = await LSP.initialize(session.directory);

  // 3. Load tool registry
  const tools = await ToolRegistry.initialize({
    bash: BashTool,
    edit: EditTool,
    read: ReadTool,
    grep: GrepTool,
    lsp: LSPTool,  // LSP queries as a tool!
    // ... more tools
  });

  // 4. Create agent
  const agent = new OpenCodeAgent(
    { name: 'build', permission: AgentPermissions.build },
    tools,
    lsp
  );

  // 5. Process message with streaming
  console.log('User:', userMessage);
  console.log('Assistant: ');
  
  for await (const chunk of agent.processMessage(userMessage, {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022'
  })) {
    if (chunk.type === 'text') {
      process.stdout.write(chunk.text);
    }
    if (chunk.type === 'tool-call') {
      console.log(`\n[Using tool: ${chunk.name}]`);
    }
  }

  // Show file changes
  const snapshot = session.snapshot; // Access the snapshot property
  console.log('\n\nChanges made:');
  if (snapshot && snapshot.files) {
    for (const file of snapshot.files) {
      console.log(`  ${file.path} (+${file.additions} -${file.deletions})`);
    }
  }

  return session;
}

// Usage:
// await handleCodeRequest("Add error handling to the login function");

// =============================================================================
// THE ESSENCE: LSP-Native AI Agent
// =============================================================================
/*
OpenCode = LLM + Language Server Protocol + Fine-grained Permissions

Unlike text-based AI tools (LLM → Filesystem → Text), OpenCode uses semantic
code intelligence (LLM → LSP Servers → Semantic Operations). The agent understands
code structure, types, definitions, and errors—like an IDE, not a text editor.

Key differentiators:
1. LSP-first: Semantic code understanding via language servers
2. Client/server: Background server, multiple TUI/web/mobile clients  
3. Granular permissions: allow/deny/ask per action and file pattern
4. Multi-agent: Specialized agents (build, plan) with subagent delegation
5. Extensible: Plugin system with MCP support, custom tools
6. Provider agnostic: Works with any LLM (Claude, GPT-4, Gemini, local)

Flow: User → Client → Server → Agent+Tools+LSP → LLM → Tool Execution → Stream
*/

export { OpenCodeAgent, LSPIntegration, Tool, Session, PermissionSystem };
