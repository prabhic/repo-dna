/*
 * REPO-DNA: ZeroClaw
 * Source: https://github.com/zeroclaw-labs/zeroclaw
 * Identity: Trait-driven agentic runtime — every pillar (provider, channel, memory, tool) is a
 *           swappable trait object, enabling AI agents that run on any hardware with <5MB RAM.
 *
 * This is not the repo. This is what makes the repo unique.
 */

// =============================================================================
// IDENTITY CORE: Four-Pillar Trait Architecture
// =============================================================================
// ZeroClaw's unique insight: an AI agent is just the composition of four
// independently-swappable traits. Nothing is hard-wired — not the LLM,
// not the messaging channel, not the memory backend, not the tools.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// Pillar 1 — LLM back-end (OpenAI, Anthropic, Gemini, Ollama, …)
#[async_trait]
trait Provider: Send + Sync {
    fn capabilities(&self) -> ProviderCapabilities { ProviderCapabilities::default() }
    async fn chat(&self, messages: &[ChatMessage], model: &str) -> anyhow::Result<ChatResponse>;
}

// Pillar 2 — Messaging surface (Telegram, Slack, Discord, iMessage, email, …)
#[async_trait]
trait Channel: Send + Sync {
    fn name(&self) -> &str;
    async fn send(&self, msg: &SendMessage) -> anyhow::Result<()>;
    async fn listen(&self, tx: tokio::sync::mpsc::Sender<ChannelMessage>) -> anyhow::Result<()>;
}

// Pillar 3 — Persistence (SQLite, Postgres, Qdrant, in-memory, …)
#[async_trait]
trait Memory: Send + Sync {
    fn name(&self) -> &str;
    async fn store(&self, key: &str, content: &str, category: MemoryCategory) -> anyhow::Result<()>;
    async fn recall(&self, query: &str, limit: usize) -> anyhow::Result<Vec<MemoryEntry>>;
    async fn forget(&self, key: &str) -> anyhow::Result<bool>;
}

// Pillar 4 — Agent capabilities (shell, browser, file, web_fetch, delegate, …)
#[async_trait]
trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult>;
    fn spec(&self) -> ToolSpec {
        ToolSpec { name: self.name().into(), description: self.description().into(),
                   parameters: self.parameters_schema() }
    }
}

// =============================================================================
// SIGNATURE PATTERN 1: Provider-Agnostic Stop Reason Normalization
// =============================================================================
// Each LLM API uses different vocabulary for "I'm done" / "call a tool".
// ZeroClaw absorbs this variability with a single enum so the agent loop
// never branches on provider identity.

#[derive(Debug, Clone, PartialEq, Eq)]
enum NormalizedStopReason {
    EndTurn,
    ToolCall,
    MaxTokens,
    ContextWindowExceeded,
    SafetyBlocked,
    Cancelled,
    Unknown(String),
}

impl NormalizedStopReason {
    fn from_openai(raw: &str) -> Self {
        match raw {
            "stop"           => Self::EndTurn,
            "tool_calls"     => Self::ToolCall,
            "length"         => Self::MaxTokens,
            "content_filter" => Self::SafetyBlocked,
            other            => Self::Unknown(other.into()),
        }
    }
    fn from_anthropic(raw: &str) -> Self {
        match raw {
            "end_turn" | "stop_sequence" => Self::EndTurn,
            "tool_use"                   => Self::ToolCall,
            "max_tokens"                 => Self::MaxTokens,
            "model_context_window_exceeded" => Self::ContextWindowExceeded,
            other                        => Self::Unknown(other.into()),
        }
    }
    fn from_gemini(raw: &str) -> Self {
        match raw.to_uppercase().as_str() {
            "STOP"       => Self::EndTurn,
            "MAX_TOKENS" => Self::MaxTokens,
            "SAFETY"     => Self::SafetyBlocked,
            other        => Self::Unknown(other.into()),
        }
    }
}

// =============================================================================
// SIGNATURE PATTERN 2: The Builder Composition Root
// =============================================================================
// AgentBuilder is where all four trait pillars click together with security
// and observability. The agent does not know which provider, channel, memory
// backend, or tool set was given — it only sees trait objects.

struct Agent {
    provider:    Box<dyn Provider>,
    tools:       Vec<Box<dyn Tool>>,
    tool_specs:  Vec<ToolSpec>,
    memory:      Arc<dyn Memory>,
    model:       String,
    temperature: f64,
    history:     Vec<ConversationMessage>,
}

#[derive(Default)]
struct AgentBuilder {
    provider:    Option<Box<dyn Provider>>,
    tools:       Option<Vec<Box<dyn Tool>>>,
    memory:      Option<Arc<dyn Memory>>,
    model:       Option<String>,
    temperature: Option<f64>,
}

impl AgentBuilder {
    fn new() -> Self { Self::default() }
    fn provider(mut self, p: Box<dyn Provider>) -> Self { self.provider = Some(p); self }
    fn tools(mut self, t: Vec<Box<dyn Tool>>) -> Self { self.tools = Some(t); self }
    fn memory(mut self, m: Arc<dyn Memory>) -> Self { self.memory = Some(m); self }
    fn model(mut self, m: impl Into<String>) -> Self { self.model = Some(m.into()); self }

    fn build(self) -> Agent {
        let tools = self.tools.unwrap_or_default();
        let tool_specs = tools.iter().map(|t| t.spec()).collect();
        Agent {
            provider: self.provider.expect("provider required"),
            tool_specs,
            tools,
            memory: self.memory.expect("memory required"),
            model: self.model.unwrap_or_else(|| "default".into()),
            temperature: self.temperature.unwrap_or(0.7),
            history: Vec::new(),
        }
    }
}

// =============================================================================
// ARCHITECTURAL DNA: The Think-Act Loop
// =============================================================================
// The agent loop is ZeroClaw's core agentic pattern. Research first (gather
// facts via tools), then respond. Loop continues until EndTurn — no hard
// iteration limit exists by default.

impl Agent {
    async fn run(&mut self, user_message: &str) -> anyhow::Result<String> {
        // Memory context injection — recall relevant past before each turn
        let memories = self.memory.recall(user_message, 5).await?;
        let memory_context = memories.iter()
            .map(|m| format!("[memory] {}: {}", m.key, m.content))
            .collect::<Vec<_>>()
            .join("\n");

        self.history.push(ConversationMessage::Chat(ChatMessage::user(
            if memory_context.is_empty() { user_message.into() }
            else { format!("{}\n\n---\n{}", memory_context, user_message) }
        )));

        loop {
            let flat: Vec<ChatMessage> = self.history.iter()
                .flat_map(|m| m.to_chat_messages())
                .collect();

            let response = self.provider.chat(&flat, &self.model).await?;
            let stop = response.stop_reason.clone().unwrap_or(NormalizedStopReason::EndTurn);

            match stop {
                NormalizedStopReason::EndTurn => {
                    let text = response.text.clone().unwrap_or_default();
                    self.history.push(ConversationMessage::Chat(ChatMessage::assistant(&text)));
                    // Auto-save significant responses to memory
                    const MIN_RESPONSE_LEN_FOR_STORAGE: usize = 20;
                    if text.len() > MIN_RESPONSE_LEN_FOR_STORAGE {
                        let _ = self.memory.store("last_response", &text, MemoryCategory::Conversation).await;
                    }
                    return Ok(text);
                }
                NormalizedStopReason::ToolCall => {
                    let tool_calls = response.tool_calls.clone();
                    self.history.push(ConversationMessage::AssistantToolCalls {
                        text: response.text.clone(),
                        tool_calls: tool_calls.clone(),
                    });
                    // Execute all tool calls, feed results back
                    let mut results = Vec::new();
                    for call in &tool_calls {
                        let args: serde_json::Value = match serde_json::from_str(&call.arguments) {
                            Ok(v) => v,
                            Err(e) => {
                                eprintln!("warn: malformed tool arguments for '{}': {e}", call.name);
                                serde_json::json!({})
                            }
                        };
                        let output = self.dispatch_tool(&call.name, args).await;
                        results.push(ToolResultMessage { tool_call_id: call.id.clone(), content: output });
                    }
                    self.history.push(ConversationMessage::ToolResults(results));
                }
                _ => break,
            }
        }
        Ok(String::new())
    }

    async fn dispatch_tool(&self, name: &str, args: serde_json::Value) -> String {
        for tool in &self.tools {
            if tool.name() == name {
                return match tool.execute(args).await {
                    Ok(r)  => r.output,
                    Err(e) => format!("tool_error: {e}"),
                };
            }
        }
        format!("unknown_tool: {name}")
    }
}

// =============================================================================
// SIGNATURE PATTERN 3: ReliableProvider — Transparent Failover
// =============================================================================
// Any provider can be wrapped with retry + fallback at zero cost to call sites.
// This is the "lean but resilient" philosophy: one small wrapper, provider-agnostic.

struct ReliableProvider {
    primary:   Box<dyn Provider>,
    fallbacks: Vec<Box<dyn Provider>>,
    max_retries: usize,
}

#[async_trait]
impl Provider for ReliableProvider {
    async fn chat(&self, messages: &[ChatMessage], model: &str) -> anyhow::Result<ChatResponse> {
        let mut last_err = anyhow::anyhow!("no providers");
        for attempt in 0..=self.max_retries {
            let provider: &dyn Provider = if attempt == 0 {
                &*self.primary
            } else if !self.fallbacks.is_empty() {
                &*self.fallbacks[(attempt - 1) % self.fallbacks.len()]
            } else {
                &*self.primary
            };
            match provider.chat(messages, model).await {
                Ok(r) => return Ok(r),
                Err(e) => {
                    last_err = e;
                    let backoff_ms = 200u64.saturating_mul(1u64 << attempt.min(5));
                    tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                }
            }
        }
        Err(last_err)
    }
}

// =============================================================================
// ARCHITECTURAL DNA: Secure-by-Default Sandbox
// =============================================================================
// Every tool execution can be scoped to a workspace and filtered through a
// security policy. This is NOT optional — it is part of the core Agent DNA.
// Sandbox implementations (Landlock, Bubblewrap, Firejail) are feature-gated
// but the hook is always present.

#[async_trait]
trait SecurityPolicy: Send + Sync {
    async fn check_tool_call(&self, tool_name: &str, args: &serde_json::Value) -> PolicyDecision;
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PolicyDecision { Allow, Deny(String), RequireApproval(String) }

struct WorkspacePolicy {
    workspace: std::path::PathBuf,
    allowed_tools: Vec<String>,
}

#[async_trait]
impl SecurityPolicy for WorkspacePolicy {
    async fn check_tool_call(&self, tool_name: &str, args: &serde_json::Value) -> PolicyDecision {
        if !self.allowed_tools.is_empty() && !self.allowed_tools.iter().any(|t| t == tool_name) {
            return PolicyDecision::Deny(format!("tool '{tool_name}' not in allowlist"));
        }
        // Path escape check: deny any path that escapes the workspace
        if let Some(path_val) = args.get("path").and_then(|v| v.as_str()) {
            let path = std::path::Path::new(path_val);
            if path.is_absolute() && !path.starts_with(&self.workspace) {
                return PolicyDecision::Deny(
                    format!("path '{path_val}' escapes workspace '{}'", self.workspace.display())
                );
            }
        }
        PolicyDecision::Allow
    }
}

// =============================================================================
// EXTENSION POINT: How ZeroClaw Grows
// =============================================================================
// Each seam is a trait. Adding a new provider/channel/memory/tool means
// implementing one trait and wiring it into the builder — nothing else changes.

// New provider: implement Provider, drop in via AgentBuilder::provider()
struct MyCustomProvider { base_url: String, api_key: String }

#[async_trait]
impl Provider for MyCustomProvider {
    async fn chat(&self, _messages: &[ChatMessage], _model: &str) -> anyhow::Result<ChatResponse> {
        // POST to self.base_url with self.api_key, parse the response
        Ok(ChatResponse { text: Some("hello from custom provider".into()),
                          tool_calls: vec![], stop_reason: Some(NormalizedStopReason::EndTurn),
                          usage: None })
    }
}

// New channel: implement Channel, register in the daemon's channel list
struct MyWebhookChannel { url: String }

#[async_trait]
impl Channel for MyWebhookChannel {
    fn name(&self) -> &str { "my_webhook" }
    async fn send(&self, _msg: &SendMessage) -> anyhow::Result<()> {
        // POST msg to self.url
        Ok(())
    }
    async fn listen(&self, _tx: tokio::sync::mpsc::Sender<ChannelMessage>) -> anyhow::Result<()> {
        // Poll or receive webhook events, push to tx
        Ok(())
    }
}

// New tool: implement Tool, append to AgentBuilder::tools()
struct HealthCheckTool;

#[async_trait]
impl Tool for HealthCheckTool {
    fn name(&self) -> &str { "health_check" }
    fn description(&self) -> &str { "Returns system health status" }
    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({ "type": "object", "properties": {} })
    }
    async fn execute(&self, _args: serde_json::Value) -> anyhow::Result<ToolResult> {
        Ok(ToolResult { success: true, output: "healthy".into(), error: None })
    }
}

// =============================================================================
// THE "AHA" CODE: Full Runtime Assembly
// =============================================================================
// Once you read this, you understand the entire ZeroClaw architecture.
// The agent is purely the composition of its parts — swap any pillar at will.

async fn build_and_run() -> anyhow::Result<()> {
    // Swap provider: change one line to switch from OpenAI to Anthropic to Gemini to Ollama
    let provider = ReliableProvider {
        primary:     Box::new(MyCustomProvider { base_url: "https://api.example.com".into(),
                                                 api_key:  std::env::var("API_KEY")? }),
        fallbacks:   vec![],
        max_retries: 3,
    };

    // Swap memory: SQLite locally, Postgres in prod, Qdrant for vector search — one line
    let memory: Arc<dyn Memory> = Arc::new(SqliteMemory::new("~/.zeroclaw/memory.db").await?);

    // Swap tools: compose exactly the capabilities this deployment needs
    let tools: Vec<Box<dyn Tool>> = vec![
        Box::new(HealthCheckTool),
        // Box::new(ShellTool::new(workspace.clone())),
        // Box::new(WebFetchTool::new()),
    ];

    let mut agent = AgentBuilder::new()
        .provider(Box::new(provider))
        .memory(memory)
        .tools(tools)
        .model("gpt-4o")
        .build();

    let response = agent.run("What is the system health?").await?;
    println!("{response}");
    Ok(())
}

// =============================================================================
// SUPPORTING TYPES (minimal — real definitions live in src/providers/traits.rs,
//                   src/channels/traits.rs, src/memory/traits.rs, src/tools/traits.rs)
// =============================================================================
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage { pub role: String, pub content: String }
impl ChatMessage {
    fn user(c: impl Into<String>)      -> Self { Self { role: "user".into(), content: c.into() } }
    fn assistant(c: impl Into<String>) -> Self { Self { role: "assistant".into(), content: c.into() } }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolCall { pub id: String, pub name: String, pub arguments: String }

#[derive(Debug, Clone)]
struct ChatResponse {
    pub text:        Option<String>,
    pub tool_calls:  Vec<ToolCall>,
    pub stop_reason: Option<NormalizedStopReason>,
    pub usage:       Option<TokenUsage>,
}

#[derive(Debug, Clone, Default)]
struct TokenUsage { pub input_tokens: Option<u64>, pub output_tokens: Option<u64> }

#[derive(Debug, Clone)]
struct ProviderCapabilities { pub native_tool_calling: bool, pub vision: bool }
impl Default for ProviderCapabilities {
    fn default() -> Self { Self { native_tool_calling: false, vision: false } }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolSpec { pub name: String, pub description: String, pub parameters: serde_json::Value }

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolResult { pub success: bool, pub output: String, pub error: Option<String> }

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolResultMessage { pub tool_call_id: String, pub content: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
enum ConversationMessage {
    Chat(ChatMessage),
    AssistantToolCalls { text: Option<String>, tool_calls: Vec<ToolCall> },
    ToolResults(Vec<ToolResultMessage>),
}
impl ConversationMessage {
    fn to_chat_messages(&self) -> Vec<ChatMessage> {
        match self {
            Self::Chat(m) => vec![m.clone()],
            Self::AssistantToolCalls { text, .. } =>
                text.as_deref().map(|t| vec![ChatMessage::assistant(t)]).unwrap_or_default(),
            Self::ToolResults(r) =>
                r.iter().map(|r| ChatMessage { role: "tool".into(), content: r.content.clone() }).collect(),
        }
    }
}

struct ChannelMessage { pub sender: String, pub content: String, pub channel: String }
struct SendMessage    { pub content: String, pub recipient: String }
impl SendMessage {
    fn new(c: impl Into<String>, r: impl Into<String>) -> Self {
        Self { content: c.into(), recipient: r.into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum MemoryCategory { Core, Daily, Conversation, Custom(String) }

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MemoryEntry { pub id: String, pub key: String, pub content: String }

struct SqliteMemory; // placeholder — real impl in src/memory/sqlite.rs
impl SqliteMemory {
    async fn new(_path: &str) -> anyhow::Result<Self> { Ok(Self) }
}
#[async_trait]
impl Memory for SqliteMemory {
    fn name(&self) -> &str { "sqlite" }
    async fn store(&self, _k: &str, _c: &str, _cat: MemoryCategory) -> anyhow::Result<()> { Ok(()) }
    async fn recall(&self, _q: &str, _n: usize) -> anyhow::Result<Vec<MemoryEntry>> { Ok(vec![]) }
    async fn forget(&self, _k: &str) -> anyhow::Result<bool> { Ok(true) }
}

/*
 * ZeroClaw in one sentence:
 * "An agentic AI runtime built from four independent Rust traits — Provider, Channel,
 *  Memory, Tool — composed at startup, secured by default, and small enough to run
 *  on the cheapest hardware you own."
 *
 * What makes it DIFFERENT from every other agent framework:
 * 1. SIZE — single Rust binary, <5MB RAM at runtime, sub-10ms cold start.
 *    No Node runtime, no Python interpreter, no JVM. Runs on a $3 microcontroller.
 * 2. TRAIT PURITY — not a plugin system with hooks; every core system IS a trait.
 *    You do not extend ZeroClaw; you implement its contracts.
 * 3. PROVIDER NORMALIZATION — NormalizedStopReason, ToolsPayload, ProviderCapabilities
 *    absorb all provider-specific quirks so the agent loop is provider-blind.
 * 4. SECURE-BY-DEFAULT — sandboxing and workspace scoping are not optional features;
 *    they are wired into the tool dispatch path (Landlock on Linux, Bubblewrap, Firejail).
 * 5. HARDWARE-FIRST — firmware/, peripherals/, hardware/ directories; first-class support
 *    for GPIO, USB, serial ports, STM32 — agents that actuate physical hardware.
 */
