/*
 * REPO-DNA: Clawdbot
 * Source: https://github.com/clawdbot/clawdbot
 * Identity: Personal AI assistant gateway bridging multiple messaging platforms to AI models with security-first pairing
 * 
 * This is not the repo. This is what makes the repo unique.
 */

// ============================================================================
// IDENTITY CORE: Multi-Channel Gateway with Secure Pairing
// ============================================================================

type ChannelId = 'whatsapp' | 'telegram' | 'discord' | 'slack' | 'signal' | 'imessage' | 'webchat';
type AgentId = string;
type SessionKey = `${AgentId}:${string}`; // agent:main or agent:channel:peer

interface PairingCode {
  channel: ChannelId;
  from: string;
  code: string;
  createdAt: Date;
  expiresAt: Date;
}

interface GatewayConfig {
  agents: Record<AgentId, AgentConfig>;
  channels: Record<ChannelId, ChannelConfig>;
  gateway: {
    port: number;
    bind: 'loopback' | 'lan' | 'tailnet';
    auth: { enabled: boolean; tokens?: string[] };
  };
}

interface AgentConfig {
  model?: string;
  provider?: string;
  identity?: { name: string; avatar?: string };
  workspace?: string;
  tools?: {
    allowlist?: string[];
    denylist?: string[];
  };
}

interface ChannelConfig {
  enabled: boolean;
  dmPolicy: 'open' | 'pairing' | 'deny';
  allowFrom?: string[];
}

// ============================================================================
// SIGNATURE PATTERN 1: WebSocket Gateway Control Plane
// ============================================================================

interface GatewayContext {
  config: GatewayConfig;
  sessions: SessionStore;
  channels: ChannelManager;
  nodeRegistry: NodeRegistry;
  pairingStore: PairingStore;
}

class GatewayServer {
  private methods = new Map<string, (params: any, ctx: GatewayContext) => Promise<any>>();

  async handleWsMessage(ws: WebSocket, message: string) {
    const { id, method, params } = JSON.parse(message);
    const handler = this.methods.get(method);
    if (!handler) return ws.send(JSON.stringify({ id, error: `Unknown method: ${method}` }));
    
    try {
      const result = await handler(params, this.context);
      ws.send(JSON.stringify({ id, result }));
    } catch (error) {
      ws.send(JSON.stringify({ id, error: error.message }));
    }
  }
}

// ============================================================================
// SIGNATURE PATTERN 2: Session Isolation & Routing
// ============================================================================

class SessionStore {
  private sessions = new Map<SessionKey, Session>();
  
  resolve(channel: ChannelId, from: string, groupId?: string, config?: GatewayConfig): SessionKey {
    const agentId = this.resolveAgentForRoute(channel, from, groupId, config);
    return groupId ? `${agentId}:${channel}:${groupId}` : `${agentId}:${channel}:${from}`;
  }
  
  private resolveAgentForRoute(channel: ChannelId, from: string, groupId: string | undefined, config?: GatewayConfig): AgentId {
    // Multi-agent routing: check routing rules in config
    if (!config?.agents) return 'default';
    for (const [agentId, agentConfig] of Object.entries(config.agents)) {
      if (this.matchesRoutingRule(agentConfig, channel, from, groupId)) return agentId;
    }
    return 'default';
  }
  
  private matchesRoutingRule(config: AgentConfig, channel: ChannelId, from: string, groupId?: string): boolean {
    return false; // Simplified - real implementation checks allowFrom patterns
  }
  
  getOrCreate(key: SessionKey, config: GatewayConfig): Session {
    let session = this.sessions.get(key);
    if (!session) {
      session = new Session(key, config);
      this.sessions.set(key, session);
    }
    return session;
  }
  
  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(s => s.getInfo());
  }
}

class Session {
  messages: Message[] = [];
  state: 'idle' | 'active' | 'streaming' = 'idle';
  lastActiveAt = new Date();
  agentId: AgentId;
  
  constructor(public key: SessionKey, private config: GatewayConfig) {
    this.agentId = key.split(':')[0];
  }
  
  addMessage(message: Message) {
    this.messages.push(message);
    this.lastActiveAt = new Date();
  }
  
  getInfo(): SessionInfo {
    return {
      key: this.key,
      agentId: this.agentId,
      messageCount: this.messages.length,
      state: this.state,
      lastActiveAt: this.lastActiveAt
    };
  }
}

// ============================================================================
// SIGNATURE PATTERN 3: Plugin-Based Channel Architecture
// ============================================================================

interface ChannelPlugin {
  id: ChannelId;
  meta: {
    name: string;
    order?: number;
  };
  
  // Lifecycle
  init(config: ChannelConfig, ctx: GatewayContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // Messaging
  sendMessage(to: string, message: OutgoingMessage): Promise<void>;
  onMessage(handler: MessageHandler): void;
  
  // Directory (contacts/groups)
  listPeers?(): Promise<ChannelPeer[]>;
  listGroups?(): Promise<ChannelGroup[]>;
}

type MessageHandler = (event: IncomingMessageEvent) => Promise<void>;

interface IncomingMessageEvent {
  channel: ChannelId;
  from: string;
  groupId?: string;
  message: IncomingMessage;
  timestamp: Date;
}

interface IncomingMessage {
  text?: string;
  attachments?: Attachment[];
  replyTo?: string;
}

interface OutgoingMessage {
  text: string;
  attachments?: Attachment[];
  replyTo?: string;
}

interface Attachment {
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  data?: Buffer;
  mimeType: string;
  filename?: string;
}

class ChannelManager {
  private plugins = new Map<ChannelId, ChannelPlugin>();
  
  register(plugin: ChannelPlugin) {
    this.plugins.set(plugin.id, plugin);
  }
  
  async initializeAll(config: GatewayConfig, ctx: GatewayContext) {
    for (const [channelId, channelConfig] of Object.entries(config.channels)) {
      if (!channelConfig.enabled) continue;
      const plugin = this.plugins.get(channelId as ChannelId);
      if (!plugin) continue;
      
      await plugin.init(channelConfig, ctx);
      plugin.onMessage(async (event) => this.handleIncomingMessage(event, channelConfig, ctx));
    }
  }
  
  private async handleIncomingMessage(event: IncomingMessageEvent, channelConfig: ChannelConfig, ctx: GatewayContext) {
    // Security: check pairing for DMs
    if (!event.groupId && channelConfig.dmPolicy === 'pairing') {
      if (!await ctx.pairingStore.isApproved(event.channel, event.from)) {
        const code = await ctx.pairingStore.generate(event.channel, event.from);
        const plugin = this.plugins.get(event.channel);
        if (plugin) {
          await plugin.sendMessage(event.from, {
            text: `🔐 Pairing required\n\nCode: ${code.code}\n\nApprove with: clawdbot pairing approve ${event.channel} ${code.code}`
          });
        }
        return;
      }
    }
    
    // Resolve session key for routing
    const sessionKey = ctx.sessions.resolve(event.channel, event.from, event.groupId, ctx.config);
    
    // Run agent and send reply
    const response = await runEmbeddedAgent(sessionKey, event.message.text || '', ctx);
    const plugin = this.plugins.get(event.channel);
    if (plugin) {
      await plugin.sendMessage(event.from, { text: response.text, replyTo: event.message.replyTo });
    }
  }
  
  getStatus(): ChannelStatus[] {
    return Array.from(this.plugins.values()).map(p => ({ id: p.id, name: p.meta.name, status: 'connected' }));
  }
}

// ============================================================================
// ARCHITECTURAL DNA: Gateway → Channels → Sessions → Agent → Tools
// ============================================================================

async function runEmbeddedAgent(sessionKey: SessionKey, message: string, ctx: GatewayContext): Promise<AgentResponse> {
  const session = ctx.sessions.getOrCreate(sessionKey, ctx.config);
  const agentConfig = ctx.config.agents[session.agentId] || {};
  const tools = buildToolsForAgent(agentConfig, session);
  
  session.state = 'streaming';
  const response = await runPiAgent({
    model: agentConfig.model || 'claude-3-5-sonnet-20241022',
    provider: agentConfig.provider || 'anthropic',
    messages: session.messages,
    newMessage: { role: 'user', content: message },
    tools: tools,
    systemPrompt: buildSystemPrompt(agentConfig),
    onStream: (chunk) => broadcastSessionUpdate(sessionKey, { type: 'stream', chunk })
  });
  
  session.addMessage({ role: 'user', content: message });
  session.addMessage({ role: 'assistant', content: response.text });
  session.state = 'idle';
  
  return response;
}

function buildToolsForAgent(config: AgentConfig, session: Session): Tool[] {
  const allTools = [
    ...getCodingTools(), // bash, edit, read, write from @mariozechner/pi-coding-agent
    ...getClawdbotTools(), // session management, canvas, nodes
    ...getChannelTools(session.key), // send messages to other channels
  ];
  
  if (config.tools?.allowlist) return allTools.filter(t => config.tools!.allowlist!.includes(t.name));
  if (config.tools?.denylist) return allTools.filter(t => !config.tools!.denylist!.includes(t.name));
  return allTools;
}

// ============================================================================
// EXTENSION POINT: Pairing System (Security-First DM Access)
// ============================================================================

class PairingStore {
  private pending = new Map<string, PairingCode>();
  private approved = new Map<string, Set<string>>(); // channel -> Set<from>
  
  async generate(channel: ChannelId, from: string): Promise<PairingCode> {
    const code = this.generateCode();
    const pairing: PairingCode = {
      channel,
      from,
      code,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    };
    
    this.pending.set(code, pairing);
    return pairing;
  }
  
  async approve(channel: ChannelId, code: string): Promise<boolean> {
    const pairing = this.pending.get(code);
    if (!pairing) return false;
    if (pairing.channel !== channel) return false;
    if (pairing.expiresAt < new Date()) return false;
    
    // Add to approved list
    if (!this.approved.has(channel)) {
      this.approved.set(channel, new Set());
    }
    this.approved.get(channel)!.add(pairing.from);
    
    // Clean up pending
    this.pending.delete(code);
    
    return true;
  }
  
  isApproved(channel: ChannelId, from: string): boolean {
    return this.approved.get(channel)?.has(from) ?? false;
  }
  
  private generateCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
}

// ============================================================================
// THE "AHA" CODE: Multi-Channel Inbox with Session Isolation
// ============================================================================

/*
 * This is the core insight that makes clawdbot unique:
 * 
 * 1. Every message from any channel gets routed to a SESSION
 * 2. Sessions are isolated by (agent, channel, peer/group)
 * 3. Each session maintains its own conversation history
 * 4. Multiple agents can run simultaneously, each with their own sessions
 * 5. Security is enforced at the channel level via pairing codes
 * 
 * This creates a personal AI assistant that:
 * - Feels native on every platform (WhatsApp, Discord, etc)
 * - Maintains context per conversation
 * - Can be restricted to approved contacts only
 * - Routes different channels/groups to different AI agents
 * - All controlled through a single WebSocket gateway
 */

async function bootstrapGateway(config: GatewayConfig): Promise<GatewayServer> {
  const context: GatewayContext = {
    config,
    sessions: new SessionStore(),
    channels: new ChannelManager(),
    nodeRegistry: new NodeRegistry(),
    pairingStore: new PairingStore()
  };
  
  const gateway = new GatewayServer();
  await context.channels.initializeAll(config, context);
  await gateway.start(config.gateway.port, config.gateway.bind);
  
  return gateway;
}

// ============================================================================
// Supporting Types
// ============================================================================

interface Message { role: 'user' | 'assistant' | 'system'; content: string; timestamp?: Date; }
interface Tool { name: string; description: string; parameters: any; execute: (params: any) => Promise<any>; }
interface AgentResponse { text: string; toolCalls?: ToolCall[]; }
interface ToolCall { name: string; input: any; output: any; }
interface SessionInfo { key: SessionKey; agentId: AgentId; messageCount: number; state: Session['state']; lastActiveAt: Date; }
interface ChannelStatus { id: ChannelId; name: string; status: 'connected' | 'disconnected' | 'error'; }
interface ChannelPeer { id: string; name: string; }
interface ChannelGroup { id: string; name: string; memberCount?: number; }
interface MobileNode { id: string; platform: 'ios' | 'android' | 'macos'; capabilities: string[]; }

class NodeRegistry {
  private nodes = new Map<string, MobileNode>();
  register(node: MobileNode) { this.nodes.set(node.id, node); }
  get(id: string): MobileNode | undefined { return this.nodes.get(id); }
}

// Stub implementations
declare function runPiAgent(opts: any): Promise<AgentResponse>;
declare function getCodingTools(): Tool[];
declare function getClawdbotTools(): Tool[];
declare function getChannelTools(sessionKey: SessionKey): Tool[];
declare function buildSystemPrompt(config: AgentConfig): string;
declare function broadcastSessionUpdate(sessionKey: SessionKey, update: any): void;
declare function resolveDefaultAgentId(config: GatewayConfig): AgentId;
interface WebSocketServer { }
interface WebSocket { send(data: string): void; }
