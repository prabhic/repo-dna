/*
 * REPO-DNA: OpenCode
 * Source: https://github.com/anomalyco/opencode
 * Identity: AI coding agent with LSP-powered code intelligence and client/server TUI architecture
 * 
 * This is not the repo. This is what makes the repo unique.
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
// OpenCode is not just a CLI—it's a server that multiple clients can connect to.
// The TUI is just one frontend; mobile apps, web UIs, etc. can connect too.

class OpenCodeServer {
  constructor() {
    this.sessions = new Map();  // sessionID → Session
    this.projects = new Map();  // projectID → Project
    this.bus = new EventBus();  // Event system for real-time updates
  }

  // HTTP/WebSocket API for clients
  async handleRequest(req, res) {
    const router = {
      'POST /session/create': async () => {
        const session = await Session.create({
          directory: req.body.directory,
          agent: req.body.agent || 'build'
        });
        return { sessionID: session.id };
      },

      'POST /session/:id/message': async () => {
        const session = this.sessions.get(req.params.id);
        const stream = session.processMessage(req.body.content);
        
        // Stream response via SSE or WebSocket
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for await (const chunk of stream) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.end();
      },

      'GET /lsp/symbols': async () => {
        const lsp = this.getLSP(req.query.projectID);
        const symbols = await lsp.getSymbols(req.query.file);
        return { symbols };
      },

      'POST /tool/:name': async () => {
        // Direct tool execution endpoint
        const tool = ToolRegistry.get(req.params.name);
        const result = await tool.execute(req.body.args, {
          sessionID: req.body.sessionID,
          agent: req.body.agent
        });
        return result;
      }
    };

    return router[`${req.method} ${req.path}`]?.();
  }

  // mDNS discovery for local network clients
  advertise() {
    const mdns = new MDNS();
    mdns.advertise({
      name: 'OpenCode Server',
      type: 'opencode',
      port: 4096
    });
  }
}

// TUI Client connects to server via HTTP/WebSocket
class TUIClient {
  constructor(serverURL) {
    this.ws = new WebSocket(serverURL);
    this.renderer = new TerminalRenderer();
  }

  async run() {
    // Two-pane layout: chat on left, file tree/output on right
    this.renderer.layout({
      left: { type: 'chat', flex: 2 },
      right: { type: 'context', flex: 1 }
    });

    // Listen for server events
    this.ws.on('message', (event) => {
      if (event.type === 'text-delta') {
        this.renderer.appendText(event.text);
      }
      if (event.type === 'tool-call') {
        this.renderer.showToolCall(event.tool);
      }
      if (event.type === 'permission-request') {
        this.renderer.promptPermission(event.request);
      }
    });

    // Handle user input
    this.renderer.on('input', (text) => {
      this.ws.send({ type: 'message', content: text });
    });
  }
}

// =============================================================================
// ARCHITECTURAL DNA: Permission System
// =============================================================================
// Fine-grained control over what agents can do. Each action requires permission.
// Supports rules like "allow *.ts but deny *.env", "ask before bash", etc.

class PermissionSystem {
  constructor(rules) {
    this.rules = rules; // Hierarchical permission rules
  }

  async check(request) {
    const rule = this.matchRule(request.action, request.target);
    
    if (rule === 'allow') return true;
    if (rule === 'deny') throw new Error('Permission denied');
    if (rule === 'ask') {
      // Prompt user for permission
      const response = await this.promptUser(request);
      return response === 'allow';
    }
    
    return false; // Default deny
  }

  matchRule(action, target) {
    // Match most specific rule first
    // Rules can use glob patterns: "*.env" matches all .env files
    for (const [pattern, permission] of this.rules) {
      if (matchGlob(pattern, target)) {
        return permission[action] || permission['*'];
      }
    }
    return 'ask'; // Default to asking
  }
}

// Built-in agent permissions
const AgentPermissions = {
  build: {
    '*': 'allow',              // Full access
    'doom_loop': 'ask',        // Prevent infinite loops
    'external_directory': 'ask', // Confirm before touching files outside project
    'read': {
      '*': 'allow',
      '*.env': 'deny',         // Never read secrets
      '*.env.*': 'deny',
      '*.env.example': 'allow'
    }
  },
  
  plan: {
    'edit': { '*': 'deny' },   // Read-only except for plan files
    'bash': 'ask',             // Confirm before running commands
    'read': { '*': 'allow' }
  }
};

// =============================================================================
// ARCHITECTURAL DNA: Session with Message History & Compaction
// =============================================================================
// Sessions maintain conversation state with automatic context compaction
// when token limits are approached. Snapshots track file changes.

class Session {
  constructor(id, directory, agent) {
    this.id = id;
    this.directory = directory;
    this.agent = agent;
    this.messages = [];
    this.snapshot = null;  // Git-like snapshot of changes
    this.compacting = false;
  }

  async *processMessage(userMessage) {
    // Add user message
    this.messages.push({
      role: 'user',
      content: userMessage,
      time: Date.now()
    });

    // Check if compaction needed
    const tokenCount = this.estimateTokens();
    if (tokenCount > 100000 && !this.compacting) {
      await this.compact();
    }

    // Create assistant message placeholder
    const assistantMessage = {
      id: generateID(),
      role: 'assistant',
      parts: [],  // Text, tool calls, reasoning
      time: { start: Date.now() }
    };

    // Process with agent
    const processor = new SessionProcessor({
      session: this,
      message: assistantMessage,
      agent: this.agent,
      model: this.agent.model
    });

    // Stream response
    for await (const part of processor.process()) {
      assistantMessage.parts.push(part);
      yield part;
    }

    // Update snapshot
    await this.updateSnapshot();
    
    this.messages.push(assistantMessage);
  }

  estimateTokens() {
    // Rough token estimation for context management
    return this.messages.reduce((sum, msg) => {
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : JSON.stringify(msg.content);
      return sum + Math.ceil(content.length / 4); // ~4 chars per token
    }, 0);
  }

  async compact() {
    // Summarize old messages to save context window
    const oldMessages = this.messages.slice(0, -20);
    const summary = await this.summarizeMessages(oldMessages);
    
    this.messages = [
      { role: 'system', content: summary },
      ...this.messages.slice(-20)
    ];
    
    this.compacting = false;
  }

  async summarizeMessages(messages) {
    // Use LLM to create concise summary of conversation history
    const prompt = `Summarize the following conversation history concisely:\n${
      messages.map(m => `${m.role}: ${m.content}`).join('\n')
    }`;
    const summary = await this.agent.summarize(prompt);
    return summary;
  }

  async updateSnapshot() {
    // Track all file changes in this session
    const diff = await gitDiff(this.directory);
    this.snapshot = {
      files: diff.files,
      additions: diff.additions,
      deletions: diff.deletions,
      diffs: diff.diffs
    };
  }
}

// =============================================================================
// EXTENSION POINTS: Plugin System
// =============================================================================
// OpenCode supports custom tools, agents, and LSP servers via plugins.

const PluginSystem = {
  // Load custom tools from ~/.opencode/tool/*.js
  async loadTools() {
    const toolFiles = await glob('~/.opencode/tool/*.{js,ts}');
    for (const file of toolFiles) {
      const module = await import(file);
      ToolRegistry.register(module.default);
    }
  },

  // Load custom agents from config
  async loadAgents(config) {
    for (const [name, agentConfig] of Object.entries(config.agents || {})) {
      Agent.register({
        name,
        ...agentConfig,
        mode: agentConfig.mode || 'subagent'
      });
    }
  },

  // MCP (Model Context Protocol) support
  async loadMCPServers(config) {
    for (const serverConfig of config.mcp?.servers || []) {
      const server = await MCP.connect(serverConfig);
      // Expose MCP tools as OpenCode tools
      for (const tool of server.tools) {
        ToolRegistry.register(fromMCPTool(tool));
      }
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
// WHAT MAKES OPENCODE UNIQUE
// =============================================================================

/*
1. LSP-NATIVE INTELLIGENCE
   - Not just text search—semantic code understanding via Language Servers
   - Agents can query symbols, jump to definitions, get diagnostics
   - Like giving the AI access to an IDE's intelligence

2. CLIENT/SERVER ARCHITECTURE
   - Server runs in background, multiple clients can connect
   - TUI is just one frontend—enables mobile apps, web UIs, etc.
   - mDNS discovery for seamless local network access

3. GRANULAR PERMISSION SYSTEM
   - Fine-grained control: allow/deny/ask per action and file pattern
   - Prevents agents from reading secrets, running dangerous commands
   - Built-in "plan" agent is read-only by default

4. TOOL EXTENSIBILITY
   - Dynamic tool registry with plugin support
   - Custom tools in ~/.opencode/tool/*.js
   - MCP (Model Context Protocol) integration for external tools

5. MULTI-AGENT SYSTEM
   - Primary agents (build, plan) for different workflows
   - Subagents (@general) for specialized tasks
   - Agent-to-agent delegation with @mentions

6. PROVIDER AGNOSTIC
   - Works with Claude, GPT-4, Gemini, local models
   - Not locked into any single LLM provider
   - Centralized model configuration
*/

// =============================================================================
// COMPARISON: What OpenCode is NOT
// =============================================================================

// NOT Cursor/Copilot:
// - Full terminal control, not just editor integration
// - Autonomous agent that can run tests, debug, deploy
// - Open source, no vendor lock-in

// NOT Claude Code (former "Code Assist"):
// - Open source vs proprietary
// - LSP integration for semantic understanding
// - Client/server architecture vs monolithic

// NOT Aider/Mentat:
// - TUI-first with streaming updates
// - Built-in permission system
// - Multi-agent coordination

// =============================================================================
// MENTAL MODEL
// =============================================================================

/*
Think of OpenCode as:

   User Input → TUI Client → Server → Session
                                ↓
                         Agent + Tools + LSP
                                ↓
                    LLM ← Context (messages + LSP data)
                     ↓
              Tool Calls (with permission checks)
                     ↓
            Execute → Update Session → Stream to Client

The magic is in the LSP integration: The agent doesn't just see files as text,
it sees them as the language server does—with types, symbols, references, errors.

This is the DNA: An AI agent with IDE-level code intelligence.
*/

// =============================================================================
// THE GENIUS MOVE
// =============================================================================

/*
Most AI coding tools:
  LLM → File System → Text Operations → Hope for the best

OpenCode:
  LLM → LSP Servers → Semantic Code Intelligence → Precise Operations

By integrating Language Server Protocol, OpenCode bridges the gap between
AI agents and real IDE intelligence. The agent can:
- Understand code structure (classes, functions, types)
- Navigate references and definitions
- Detect errors before committing
- Refactor with confidence

This architectural decision—LSP as a first-class citizen—is what makes
OpenCode unique. It's not just an AI that edits text, it's an AI that
understands code the way a developer's IDE does.

Combined with:
- Fine-grained permissions (security)
- Client/server architecture (flexibility)  
- Multi-agent system (specialization)
- Tool extensibility (customization)

You get: An open-source AI coding agent that's both powerful and safe.
*/

export { OpenCodeAgent, LSPIntegration, Tool, Session, PermissionSystem };
