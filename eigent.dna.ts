/*
 * REPO-DNA: Eigent
 * Source: https://github.com/eigent-ai/eigent
 * Identity: Multi-agent workforce orchestration with parallel execution through event-driven action queues
 * 
 * This is not the repo. This is what makes the repo unique.
 */

// =============================================================================
// IDENTITY CORE: Parallel Multi-Agent Coordination via Action Queue
// =============================================================================
// Eigent's genius: Multiple specialized agents work in parallel on decomposed
// tasks, coordinating through an event-driven action queue with real-time UI sync.

enum Action {
  improve = "improve", start = "start", stop = "stop",
  create_agent = "create_agent", activate_agent = "activate_agent", 
  deactivate_agent = "deactivate_agent", assign_task = "assign_task",
  decompose_progress = "decompose_progress", task_state = "task_state",
  activate_toolkit = "activate_toolkit", deactivate_toolkit = "deactivate_toolkit",
  ask = "ask", notice = "notice", end = "end",
}

// =============================================================================
// SIGNATURE PATTERN 1: Agent Factory with Toolkit Composition
// =============================================================================
// Each agent is a factory that composes domain-specific toolkits.

interface ToolkitMessageIntegration {
  register_toolkits<T extends AgentToolkit>(toolkit: T): T;
}

interface AgentToolkit {
  get_tools(): FunctionTool[];
  send_message_to_user?(message: string): Promise<void>;
}

// Example: Developer agent factory
async function developer_agent(options: ChatOptions) {
  const msg_integration = new ToolkitMessageIntegration(
    (msg) => send_to_user(options.project_id, 'developer', msg)
  );
  
  const terminal = msg_integration.register_toolkits(
    new TerminalToolkit(options.project_id, options.working_directory)
  );
  
  const screenshot = msg_integration.register_toolkits(
    new ScreenshotToolkit(options.project_id)
  );
  
  return create_agent('developer_agent', DEVELOPER_PROMPT, options, [
    ...terminal.get_tools(),
    ...screenshot.get_tools(),
  ]);
}

// =============================================================================
// SIGNATURE PATTERN 2: THE "AHA!" - ListenChatAgent with Action Queue
// =============================================================================
// How agents coordinate without blocking: wrap CAMEL-AI's ChatAgent and 
// hook into a project-level action queue for real-time coordination.

class ListenChatAgent extends ChatAgent {
  constructor(
    private api_task_id: string,
    private agent_name: string,
    system_message: string,
    model: ModelBackend,
    tools: FunctionTool[],
  ) {
    super(system_message, model, tools);
  }
  
  async step(input: string): Promise<Response> {
    const queue = get_task_lock(this.api_task_id);
    
    // Signal activation
    await queue.put({ action: Action.activate_agent, data: {
      agent_name: this.agent_name, message: input
    }});
    
    // Execute agent logic
    const response = await super.step(input);
    
    // Track tool usage
    for (const call of response.tool_calls) {
      await queue.put({ action: Action.activate_toolkit, data: {
        toolkit_name: call.function_name
      }});
    }
    
    // Signal deactivation
    await queue.put({ action: Action.deactivate_agent, data: {
      agent_name: this.agent_name
    }});
    
    return response;
  }
}

// =============================================================================
// SIGNATURE PATTERN 3: Project-Level State Isolation with Zustand
// =============================================================================
// Project->Chat->Task hierarchy: multiple chats per project, each with
// independent state but shared queued messages.

interface ProjectStore {
  projects: Record<string, Project>;
  activeProjectId: string | null;
  
  createProject(name: string): string;
  createChatStore(projectId: string): string;
  getChatStore(projectId: string, chatId: string): VanillaChatStore;
  getProjectById(projectId: string): Project | null;
  addQueuedMessage(projectId: string, content: string): void;
}

interface Project {
  id: string;
  chatStores: Record<string, VanillaChatStore>;
  activeChatId: string | null;
  queuedMessages: Array<{ task_id: string; content: string }>;
  metadata?: { historyId?: string };
}

interface VanillaChatStore {
  getState(): ChatState;
  subscribe(listener: (state: ChatState) => void): () => void;
}

interface ChatState {
  tasks: Record<string, Task>;
  activeTaskId: string | null;
  
  create(id?: string): string;
  startTask(taskId: string, msg: string): Promise<void>;
  
  // Agent coordination
  setActiveAgent(taskId: string, name: string): void;
  setTaskAssigning(taskId: string, agents: Agent[]): void;
  setTaskRunning(taskId: string, info: TaskInfo[]): void;
  
  // Progress and task info
  setProgressValue(taskId: string, val: number): void;
  computedProgressValue(taskId: string): void;
  setTaskInfo(taskId: string, info: TaskInfo[]): void;
  
  // Status and human interaction
  setStatus(taskId: string, status: 'running' | 'finished' | 'pending' | 'pause'): void;
  setHasWaitConfirm(taskId: string, hasWait: boolean): void;
}

interface Task {
  messages: Message[];
  summaryTask: string;
  taskInfo: TaskInfo[];       // Decomposed subtasks
  taskRunning: TaskInfo[];    // Currently executing
  taskAssigning: Agent[];     // Being allocated
  activeAgent: string;
  status: 'running' | 'finished' | 'pending' | 'pause';
  progressValue: number;
  
  // Human-in-the-loop
  activeAsk: string;
  hasWaitConfirm: boolean;
  
  // Workspace
  fileList: FileInfo[];
  webViewUrls: Array<{ url: string; processTaskId: string }>;
}

// =============================================================================
// ARCHITECTURAL DNA: Task Lock & Coordination Queue
// =============================================================================

class TaskLock {
  private queue: ActionData[] = [];
  
  async put(action: ActionData): Promise<void> {
    this.queue.push(action);
    await this.notify_frontend();
  }
  
  private async notify_frontend(): Promise<void> {
    const sse = this.get_sse_connection();
    for (const action of this.queue) {
      await sse.send(JSON.stringify(action));
    }
    this.queue = [];
  }
}

const task_locks = new Map<string, TaskLock>();

function get_task_lock(project_id: string): TaskLock {
  if (!task_locks.has(project_id)) {
    task_locks.set(project_id, new TaskLock());
  }
  return task_locks.get(project_id)!;
}

// =============================================================================
// EXTENSION POINT: MCP (Model Context Protocol) Integration
// =============================================================================
// Dynamic tool loading from external MCP servers for infinite extensibility.

interface MCPConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}

async function mcp_agent(options: ChatOptions & { installed_mcp: MCPConfig }) {
  const tools: FunctionTool[] = [...new McpSearchToolkit().get_tools()];
  
  // Load tools from MCP servers
  if (Object.keys(options.installed_mcp.mcpServers).length > 0) {
    const mcp_tools = await get_mcp_tools(options.installed_mcp);
    tools.push(...mcp_tools);
  }
  
  return new ListenChatAgent(
    options.project_id, 'mcp_agent', MCP_PROMPT, 
    create_model(options), tools
  );
}

async function get_mcp_tools(config: MCPConfig): Promise<FunctionTool[]> {
  const tools: FunctionTool[] = [];
  
  for (const [name, server] of Object.entries(config.mcpServers)) {
    const mcp = spawn_mcp_server(server);
    const available = await mcp.list_tools();
    
    for (const tool of available) {
      tools.push({
        name: `${name}_${tool.name}`,
        description: tool.description,
        parameters: tool.inputSchema,
        func: async (args) => mcp.call_tool(tool.name, args),
      });
    }
  }
  
  return tools;
}

// =============================================================================
// THE "AHA" CODE: Agent Model Creator & Parallel Coordination
// =============================================================================
// This ties everything together: specialized agents with thread-safe
// event loop handling, action queue integration, and parallel execution.

function agent_model(
  agent_name: string,
  system_message: string,
  options: ChatOptions,
  tools: FunctionTool[],
) {
  const queue = get_task_lock(options.project_id);
  const agent_id = generate_uuid();
  
  // Signal creation
  schedule_async_task(
    queue.put({ action: Action.create_agent, data: { agent_name, agent_id }})
  );
  
  // Create agent
  const agent = new ListenChatAgent(
    options.project_id, agent_name, system_message,
    create_model(options), tools
  );
  
  // Register for parallel coordination
  register_agent(options.project_id, agent_name, agent);
  
  return agent;
}

// Thread-safe task scheduling for parallel agents
function schedule_async_task(coro: Promise<void>) {
  try {
    const loop = asyncio.get_running_loop();
    loop.create_task(coro);
  } catch {
    const main_loop = get_main_event_loop();
    if (main_loop?.is_running()) {
      asyncio.run_coroutine_threadsafe(coro, main_loop);
    }
  }
}

// Agent types - each with specialized factories
enum Agents {
  developer_agent = "developer_agent",
  browser_agent = "browser_agent",
  mcp_agent = "mcp_agent",
  multi_modal_agent = "multi_modal_agent",
}

const agent_factories = {
  [Agents.developer_agent]: developer_agent,
  [Agents.browser_agent]: browser_agent,
  [Agents.mcp_agent]: mcp_agent,
  [Agents.multi_modal_agent]: multi_modal_agent,
};

// =============================================================================
// FRONTEND-BACKEND COMMUNICATION: SSE Action Stream
// =============================================================================

async function startTask(projectId: string, taskId: string, msg: string) {
  const controller = new AbortController();
  
  await fetchEventSource(`${BASE_URL}/api/task/start`, {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, task_id: taskId, message: msg }),
    signal: controller.signal,
    
    async onmessage(event) {
      if (event.data) {
        const action = JSON.parse(event.data);
        await handle_action(projectId, taskId, action);
      }
    },
  });
}

// Action handler - updates Zustand stores
async function handle_action(projectId: string, taskId: string, action: ActionData) {
  const project = projectStore.getProjectById(projectId);
  if (!project?.activeChatId) return;
  
  const store = projectStore.getChatStore(projectId, project.activeChatId);
  
  switch (action.action) {
    case Action.activate_agent:
      store.getState().setActiveAgent(taskId, action.data.agent_name);
      store.getState().setTaskRunning(taskId, action.data);
      break;
      
    case Action.assign_task:
      store.getState().setTaskAssigning(taskId, action.data.agents);
      break;
      
    case Action.decompose_progress:
      store.getState().setTaskInfo(taskId, action.data.tasks);
      store.getState().computedProgressValue(taskId);
      break;
      
    case Action.ask:
      store.getState().setHasWaitConfirm(taskId, true);
      break;
      
    case Action.end:
      store.getState().setStatus(taskId, 'finished');
      break;
  }
}

// =============================================================================
// Supporting Types
// =============================================================================

interface ChatOptions {
  project_id: string;
  model_platform: string;
  model_type: string;
  working_directory?: string;
}

interface FunctionTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  func: (...args: any[]) => Promise<any>;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface TaskInfo {
  id: string;
  content: string;
  state: 'pending' | 'running' | 'completed';
}

interface Agent {
  name: string;
  id: string;
}

interface FileInfo {
  name: string;
  path: string;
}

// =============================================================================
// SUMMARY: Eigent's Unique DNA
// =============================================================================
//
// 1. **Multi-Agent Parallel Coordination**: Agents work simultaneously on 
//    decomposed tasks, coordinated via event-driven action queue.
//
// 2. **Toolkit Composition Pattern**: Agents composed from specialized toolkits
//    with unified message integration for human communication.
//
// 3. **Project Isolation Hierarchy**: Project->Chat->Task with Zustand stores,
//    enabling multiple independent workspaces with replay.
//
// 4. **MCP Extensibility**: Dynamic tool loading from external MCP servers
//    makes the system infinitely extensible.
//
// 5. **Action Queue Architecture**: ListenChatAgent wraps CAMEL-AI and hooks
//    into project-level queues for real-time UI synchronization.
//
// The "Aha!": Eigent orchestrates a workforce of specialized agents working
// in parallel, each with domain expertise, coordinating through event streams,
// with infinite extensibility through MCP. It's not a chatbot—it's a 
// multi-agent operating system for complex workflows.
