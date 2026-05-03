# REPO-DNA: Hermes Agent
# Source: https://github.com/NousResearch/hermes-agent
# Identity: A self-improving agent that writes its own skills, memories, and training data — the agent IS the training loop
#
# This is not the repo. This is what makes the repo unique.

# =============================================================================
# IDENTITY CORE: The Agent Is Its Own Teacher
# =============================================================================
# Hermes's genius: every conversation produces three outputs — a response,
# updated persistent memory, and optionally a new Skill (a Markdown procedure).
# Both memory and skills get compiled into the NEXT session's system prompt.
# The agent improves itself by using itself. No fine-tuning required between runs.

# System prompt assembly (called once per session, cached for prefix-cache hits)
def build_system_prompt(soul_md, memory_store, skills_index, context_files, platform_hints, tools):
    parts = []
    parts.append(soul_md or DEFAULT_AGENT_IDENTITY)       # 1. Persona
    parts.append(build_tool_guidance(tools))               # 2. Tool-aware behavioral rules
    if memory_store:
        parts.append(memory_store.format_for_system_prompt("memory"))  # 3. Frozen memory snapshot
        parts.append(memory_store.format_for_system_prompt("user"))    # 4. User profile
    parts.append(skills_index)                             # 5. Agent-created procedure library
    parts.append(context_files)                            # 6. AGENTS.md / .cursorrules
    parts.append(f"Conversation started: {now()}")         # 7. Timestamp (frozen at build)
    parts.append(platform_hints)                           # 8. Telegram/Discord/CLI formatting
    return "\n\n".join(p for p in parts if p)

# =============================================================================
# SIGNATURE PATTERN 1: Skills — Procedural Memory as Markdown
# =============================================================================
# Skills live in ~/.hermes/skills/<name>/SKILL.md.
# YAML frontmatter declares conditional activation: when to auto-inject into
# the system prompt without the agent explicitly asking for them.
# The agent writes these during conversations and the curator maintains them.

SKILL_MD_EXAMPLE = """
---
name: fetch-arxiv-pdf
description: Fetch and parse an arXiv PDF for a given paper ID
metadata:
  hermes:
    fallback_for_toolsets: [browser]   # activate when browser toolset is absent
    requires_toolsets: [terminal]      # only activate when terminal is present
    config:
      - key: arxiv.cache_dir
        description: Directory to cache downloaded PDFs
        default: "~/arxiv-cache"
---

Use `curl` to fetch the PDF and `pdftotext` to extract content:

```bash
mkdir -p {arxiv.cache_dir}
curl -L https://arxiv.org/pdf/{paper_id}.pdf -o {arxiv.cache_dir}/{paper_id}.pdf
pdftotext {arxiv.cache_dir}/{paper_id}.pdf -
```
"""

def build_skills_system_prompt(available_tools, available_toolsets):
    """Scan ~/.hermes/skills/, parse frontmatter, apply conditional activation,
    and inject matching skill bodies into the system prompt."""
    injected = []
    disabled = get_disabled_skill_names()
    for skill_md in iter_skill_index_files(get_skills_dir(), "SKILL.md"):
        frontmatter, body = parse_frontmatter(skill_md.read_text())
        name = frontmatter.get("name", skill_md.parent.name)
        if name in disabled:
            continue
        if not skill_matches_platform(frontmatter):
            continue
        conds = extract_skill_conditions(frontmatter)
        if not _condition_met(conds, available_tools, available_toolsets):
            continue
        injected.append(f"### Skill: {name}\n{body.strip()}")
    return "\n\n".join(injected)

def _condition_met(conds, tools, toolsets):
    # fallback_for_toolsets: inject only if these toolsets are NOT loaded
    for ts in conds["fallback_for_toolsets"]:
        if ts in toolsets:
            return False
    # requires_toolsets: inject only if ALL of these ARE loaded
    for ts in conds["requires_toolsets"]:
        if ts not in toolsets:
            return False
    return True

# =============================================================================
# SIGNATURE PATTERN 2: Nudge-Triggered Background Learning Loop
# =============================================================================
# After every Nth turn (memory_nudge_interval) or Nth tool iteration
# (skill_nudge_interval), Hermes spawns a BACKGROUND review agent AFTER
# delivering the user response. Main session is never blocked.
# The background agent reads the conversation snapshot, writes/patches skills
# and memories, and exits. Those changes take effect next session.

class AIAgent:
    def __init__(self):
        self._memory_nudge_interval = 10   # review memory every 10 turns
        self._skill_nudge_interval = 10    # review skills every 10 tool iterations
        self._turns_since_memory = 0
        self._iters_since_skill = 0
        self._cached_system_prompt = None  # built once, reused all turns

    def run_conversation(self, user_message, conversation_history=None):
        messages = list(conversation_history or [])
        if self._cached_system_prompt is None:
            self._cached_system_prompt = build_system_prompt(...)

        # Check turn-based memory nudge trigger
        _should_review_memory = False
        self._turns_since_memory += 1
        if self._turns_since_memory >= self._memory_nudge_interval:
            _should_review_memory = True
            self._turns_since_memory = 0

        messages.append({"role": "user", "content": user_message})
        final_response, iters_used = self._agent_loop(messages)

        # Check iteration-based skill nudge trigger
        self._iters_since_skill += iters_used
        _should_review_skills = self._iters_since_skill >= self._skill_nudge_interval
        if _should_review_skills:
            self._iters_since_skill = 0

        # AFTER delivering response: background review never competes with user
        if _should_review_memory or _should_review_skills:
            self._spawn_background_review(
                messages_snapshot=list(messages),
                review_memory=_should_review_memory,
                review_skills=_should_review_skills,
            )

        return final_response

    def _spawn_background_review(self, messages_snapshot, review_memory, review_skills):
        """Fork an auxiliary AIAgent with no nudge intervals.
        It reads the snapshot and calls memory/skill_manage tools, then exits."""
        import threading
        def _run():
            review_agent = AIAgent()
            review_agent._memory_nudge_interval = 0   # no re-entrancy
            review_agent._skill_nudge_interval = 0
            prompt = _build_review_prompt(review_memory, review_skills)
            review_agent.run_conversation(prompt, conversation_history=messages_snapshot)
        threading.Thread(target=_run, daemon=True).start()

# =============================================================================
# ARCHITECTURAL DNA: SQLite FTS5 Session Store + Cross-Session Recall
# =============================================================================
# All sessions are stored in a single WAL-mode SQLite DB with two FTS5 tables:
# one for unicode61 (Latin/keyword) and one for trigram (CJK substring).
# session_search tool lets the agent recall its own past conversations.

SCHEMA = """
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,            -- 'cli', 'telegram', 'discord', ...
    parent_session_id TEXT,          -- compression-triggered session splitting
    system_prompt TEXT,              -- cached for Anthropic prefix-cache reuse
    estimated_cost_usd REAL,
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(id),
    role TEXT,
    content TEXT,
    tool_calls TEXT,                 -- JSON
    reasoning TEXT                   -- <think> blocks stored for trajectory export
);

-- Unicode61 FTS: fast for English/keyword search
CREATE VIRTUAL TABLE messages_fts USING fts5(content);

-- Trigram FTS: substring search for CJK and partial-word matching
CREATE VIRTUAL TABLE messages_fts_trigram USING fts5(content, tokenize='trigram');
"""

# Write-contention strategy: short SQLite timeout (1s) + application-level
# jitter retry instead of SQLite's convoy-prone internal busy handler.
class SessionDB:
    _WRITE_MAX_RETRIES = 15
    _WRITE_RETRY_MIN_S = 0.020
    _WRITE_RETRY_MAX_S = 0.150

    def _with_retry(self, fn):
        for attempt in range(self._WRITE_MAX_RETRIES):
            try:
                return fn()
            except Exception as e:
                if "locked" not in str(e).lower() or attempt == self._WRITE_MAX_RETRIES - 1:
                    raise
                import random, time
                time.sleep(random.uniform(self._WRITE_RETRY_MIN_S, self._WRITE_RETRY_MAX_S))

# =============================================================================
# ARCHITECTURAL DNA: Background Curator — The Skills Gardener
# =============================================================================
# A forked AIAgent that runs on a 7-day inactivity-triggered schedule.
# It owns the full skill lifecycle: active → stale → archived (never deletes).
# Pinned skills are immutable. Only agent-created skills are touched —
# bundled and hub-installed skills are off-limits.

SKILL_STATES = {"active", "stale", "archived"}  # pinned is orthogonal

def should_run_curator(now, last_run_at, interval_hours=24*7, min_idle_hours=2):
    """Gate: enabled AND not paused AND idle enough AND interval elapsed."""
    if not is_enabled() or is_paused():
        return False
    if last_run_at is None:
        seed_last_run_at(now)   # first install: defer by one full interval
        return False
    idle_ok = agent_idle_for(min_idle_hours)
    interval_ok = (now - last_run_at).total_seconds() / 3600 >= interval_hours
    return idle_ok and interval_ok

def run_curator():
    """Spawn a background AIAgent with a curation system prompt.
    It calls skill_manage(action='patch'/'archive'/'pin') autonomously."""
    curator_agent = AIAgent()
    curator_agent._memory_nudge_interval = 0
    curator_agent._skill_nudge_interval = 0
    curator_agent.run_conversation(CURATOR_SYSTEM_PROMPT)

# Skill usage telemetry: sidecar .usage.json, never in frontmatter.
def bump_use(skill_name):
    if not is_agent_created(skill_name):
        return   # never track bundled / hub skills
    _mutate(skill_name, lambda r: (
        r.update({"use_count": r["use_count"] + 1, "last_used_at": now_iso()})
    ))

def archive_skill(skill_name):
    assert is_agent_created(skill_name), "never archive bundled/hub skills"
    skill_dir = find_skill_dir(skill_name)
    dest = archive_dir() / skill_dir.name
    skill_dir.rename(dest)
    set_state(skill_name, "archived")

# =============================================================================
# EXTENSION POINT 1: ContextEngine — Pluggable Compression
# =============================================================================

from abc import ABC, abstractmethod

class ContextEngine(ABC):
    last_prompt_tokens: int = 0
    threshold_percent: float = 0.75
    protect_first_n: int = 3
    protect_last_n: int = 6

    @abstractmethod
    def update_from_response(self, usage: dict) -> None: ...

    @abstractmethod
    def should_compress(self, prompt_tokens: int = None) -> bool: ...

    @abstractmethod
    def compress(self, messages: list, focus_topic: str = None) -> list: ...

    def get_tool_schemas(self) -> list:
        return []   # LCM engine exposes lcm_grep, lcm_describe, lcm_expand

    def on_session_start(self, session_id: str, **kwargs) -> None: ...
    def on_session_end(self, session_id: str, messages: list) -> None: ...

# =============================================================================
# EXTENSION POINT 2: MemoryManager — Pluggable External Memory Providers
# =============================================================================
# BuiltinMemoryProvider is always registered. Only ONE external provider at a time.
# External providers (e.g. Honcho) append to the system prompt block.

class MemoryManager:
    def __init__(self):
        self._builtin = BuiltinMemoryProvider()
        self._external: "ExternalProvider | None" = None

    def register_external(self, provider):
        if self._external is not None:
            raise ValueError("Only one external memory provider is allowed")
        self._external = provider

    def build_system_prompt(self) -> str:
        parts = [self._builtin.build_system_prompt()]
        if self._external:
            parts.append(self._external.build_system_prompt())
        return "\n\n".join(p for p in parts if p)

    def on_turn_end(self, user_message, assistant_response):
        self._builtin.on_turn_end(user_message, assistant_response)
        if self._external:
            self._external.on_turn_end(user_message, assistant_response)

# =============================================================================
# THE "AHA" CODE: The Full Learning Loop in One Diagram
# =============================================================================

def hermes_learning_loop():
    """
    TURN N:
      user: "analyze this CSV and save what you learned"
      → agent runs tools (python, memory, skill_manage)
      → agent writes to MEMORY.md: "User prefers pandas over polars"
      → agent creates ~/.hermes/skills/csv-analysis/SKILL.md with procedure
      → agent responds to user
      → [AFTER response] background review spawns:
            review_agent.run("review skills created this session")
            → Curator patches SKILL.md with edge cases from the conversation

    TURN N+1 (next session):
      _build_system_prompt() reads MEMORY.md → injects "User prefers pandas"
      _build_system_prompt() scans skills/csv-analysis/SKILL.md → injects procedure
      → model already "knows" the CSV workflow before the user says a word

    The feedback loop:
      Use → Write → Compile → Inject → Use (better) → Write (richer) → ...

    No fine-tuning. No vector DB. Just: agent writes Markdown, Markdown becomes prompt.
    The trajectory of each conversation is also saved for RL training via Atropos.
    """

# =============================================================================
# ITERATION BUDGET: Per-Agent Isolation
# =============================================================================
# Parent agent: max 90 iterations. Each subagent spawned via delegate_task:
# max 50 iterations (independent budget). Total can exceed parent cap.
# execute_code (programmatic tool calls) iterations are refunded — they're
# free because they don't consume model attention.

class IterationBudget:
    def __init__(self, max_total: int):
        self.max_total = max_total
        self._used = 0

    def consume(self) -> bool:
        if self._used >= self.max_total:
            return False
        self._used += 1
        return True

    def refund(self):
        self._used = max(0, self._used - 1)   # execute_code turns don't count

# =============================================================================
# WHAT MAKES HERMES UNIQUE
# =============================================================================

# NOT a one-shot agent (AutoGPT): Hermes accumulates knowledge across sessions
# NOT a RAG system: skills are injected as system prompt text, not retrieved per-query
# NOT fine-tuning: improvements happen between conversations via Markdown edits
# NOT Cline/Cursor: no human approval gates — the agent acts autonomously
# NOT a chatbot: runs serverless (Modal/Daytona), headless (cron/daemon), multi-platform

# The three feedback loops that make Hermes self-improving:
#
#   1. MEMORY LOOP (turn-based, 10-turn default)
#      conversation → memory() tool → MEMORY.md / USER.md
#      → compiled into next session's system prompt
#
#   2. SKILLS LOOP (iteration-based, 10-iteration default)
#      complex task → skill_manage(create) → SKILL.md
#      → compiled into system prompt when conditions match
#      → Curator prunes/patches stale skills in the background
#
#   3. TRAJECTORY LOOP (every conversation, opt-in)
#      conversation → _save_trajectory() → trajectory_samples.jsonl
#      → RL training via Atropos environments
#      → next generation of tool-calling models (closes the outer loop)
