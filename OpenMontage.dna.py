"""
REPO-DNA: OpenMontage
Source: https://github.com/calesthio/OpenMontage   Commit/Ref: 9066dcb
Archetype: agentic application shipped AS a repo — a "cartridge" your coding agent
           runs (open-source AI video-production system; Python tools + Remotion)
The bet: there is no orchestrator process — your CODING AGENT is the runtime; the
         repo ships declarative pipeline manifests + markdown "director" skills it
         executes, and Python only loads and validates.

This is not the repo. This is its variant fraction — what it does that its
peers do not.
"""

# ============================================================================
# REFERENCE GENOME  (the competent default for an open-source AI video tool in
# Python — everything below must DEPART from this, or it is not DNA)
# ============================================================================
# A capable engineer ships an app/CLI you run: `python generate.py --prompt "..."`.
# A Python main loop orchestrates — call an LLM to plan scenes, call image/video/TTS
# provider APIs, stitch with ffmpeg/moviepy, write out an mp4. The orchestration
# logic lives in code; the LLM is a callee behind an API key; provider adapters, a
# DAG runner, and prompt templates are all Python. You run the program; it runs the
# models.


# ============================================================================
# THE LOAD-BEARING BET  (reverse it and this becomes an ordinary AI-video app)
# ============================================================================
# Flip the control inversion: the repo has NO engine. It is a cartridge — a
# declarative pipeline manifest + markdown "director" skills + JSON artifact
# schemas + a Remotion renderer + stateless Python leaf-tools. Your coding agent
# (Claude Code / Cursor / Codex / Copilot / Windsurf) reads the manifest and BECOMES
# the orchestrator; Python's whole job is load + validate, never execute.
# (Kernel verified-runnable; see AGENTS.md, lib/pipeline_loader.py, AGENT_GUIDE.md.)

# --- "the program": a pipeline manifest (really pipeline_defs/cinematic.yaml) ---
MANIFEST = {
    "name": "cinematic",
    "orchestration": {"mode": "executive-producer", "budget_usd": 2.0, "max_send_backs": 2},
    "stages": [
        {"name": "research", "skill": "pipelines/cinematic/research-director",
         "produces": "research_brief", "review_focus": ["references are specific, not generic"]},
        {"name": "script", "skill": "pipelines/cinematic/script-director",
         "produces": "script", "review_focus": ["every line earns its place"]},
        {"name": "compose", "skill": "pipelines/cinematic/compose-director",
         "produces": "render_props", "review_focus": ["timeline matches the script beats"]},
    ],
}
# --- artifact contracts (really schemas/artifacts/*.schema.json) ---
SCHEMA = {"research_brief": ["topic", "references"], "script": ["beats"],
          "render_props": ["compositionId", "props"]}


def validate_manifest(m):  # PYTHON's whole job (1/2): validate the manifest
    assert m["stages"] and all("skill" in s for s in m["stages"]), "bad manifest"


def validate_artifact(kind, art):  # PYTHON's whole job (2/2): validate hand-offs
    missing = [k for k in SCHEMA[kind] if k not in art]
    if missing:
        raise ValueError(f"{kind} missing {missing}")


checkpoints = {}  # really lib/checkpoint.py -> JSON files on disk (resumable)


def agent_runtime(manifest, produce, review, resume_from=None):
    # THE RUNTIME IS THE AGENT. This loop is what your coding assistant performs.
    validate_manifest(manifest)
    started = resume_from is None
    for stage in manifest["stages"]:
        if not started:
            if stage["name"] != resume_from:
                print(f"  (skip {stage['name']:8} — already checkpointed)"); continue
            started = True
        print(f"stage={stage['name']:8} -> embody skill: {stage['skill']}")
        sends = 0
        while True:
            art = produce(stage)                       # agent plays the director role
            validate_artifact(stage["produces"], art)  # python checks the contract
            if review(stage, art) == "approve" or sends >= manifest["orchestration"]["max_send_backs"]:
                break
            sends += 1
            print(f"           SENT BACK: {stage['review_focus'][0]!r} -> retry {sends}")
        checkpoints[stage["name"]] = art
        print(f"           produced {stage['produces']!r}; checkpoint saved")
    return checkpoints


def _demo():
    # the "agent": really an LLM coding assistant generating + judging. Stubbed.
    def produce(stage):
        return {"research": {"topic": "neon city", "references": ["Blade Runner", "Akira"]},
                "script": {"beats": ["cold open", "build", "drop"]},
                "compose": {"compositionId": "Cinematic", "props": {"clips": 6}}}[stage["name"]]
    seen = {}

    def review(stage, art):  # English gate, judged by the agent; fail script once
        seen[stage["name"]] = seen.get(stage["name"], 0) + 1
        return "send_back" if (stage["name"] == "script" and seen[stage["name"]] == 1) else "approve"

    print("=== full run (agent is the runtime; python only validates) ===")
    print("final:", list(agent_runtime(MANIFEST, produce, review)))
    print("\n=== resume from 'compose' (file-based checkpoints) ===")
    seen.clear()
    agent_runtime(MANIFEST, produce, review, resume_from="compose")
    # Runs as: research approved; script SENT BACK once then approved; compose
    # approved; resume skips the two checkpointed stages.


if __name__ == "__main__":
    _demo()


# ============================================================================
# SIGNATURE PATTERNS  (the recurring SNPs — sketches, faithful but need not run)
# ============================================================================

# SNP 1 — Stages are film-crew DIRECTOR ROLES the agent embodies, not functions.
# The manifest's required_skills list IS the org chart; each stage names a markdown
# skill ("You are the Research Director... you do NOT make creative decisions").
#   pipeline_defs/cinematic.yaml + skills/pipelines/cinematic/*-director.md
_STAGE = {  # one stage of pipeline_defs/cinematic.yaml
    "name": "research",
    "skill": "pipelines/cinematic/research-director",   # md role the agent becomes
    "produces": ["research_brief"],
    "tools_available": ["web_search"],
    "checkpoint_required": True,
    "review_focus": ["Visual references are specific and relevant to the mood"],
}
_CREW = ["research", "proposal", "script", "scene", "asset", "edit", "compose", "publish"]
# plus meta skills every pipeline pulls in: meta/reviewer, meta/checkpoint-protocol.


# SNP 2 — Quality gates are ENGLISH, judged by the agent — an executive-producer
# loop with money/time/iteration caps and send-backs, not assert statements.
#   pipeline_defs/cinematic.yaml: orchestration + per-stage review_focus
_ORCH = {
    "mode": "executive-producer",
    "budget_default_usd": 2.00,
    "max_revisions_per_stage": 3,
    "max_send_backs": 3,
    "max_wall_time_minutes": 12,
}  # meta/reviewer reads review_focus prose and decides approve | send-back.


# SNP 3 — Multi-HOST agent targeting: the runtime is portable across assistants.
# Every coding agent's entry file funnels to one contract; none carries logic.
#   AGENTS.md / CLAUDE.md / CODEX.md / COPILOT.md / CURSOR.md / .windsurfrules
#   -> all say: read AGENT_GUIDE.md first.
AGENTS_MD = "There are no instructions in this file. All instructions are in AGENT_GUIDE.md."


# ============================================================================
# STRUCTURAL COMMITMENTS  (the two bets the rest is organized around)
# ============================================================================
# (1) THE CARTRIDGE SPLIT — "the program" is data + prose; "the hands" are dumb.
#   program  : pipeline_defs/*.yaml (manifests) + skills/**/*.md (director roles)
#              + schemas/**/*.json (artifact contracts)
#   hands    : lib/*.py (stateless leaf-tools) + remotion-composer/ (renderer)
# Python loads and validates; it is structurally incapable of running a pipeline.
def load_pipeline(name, defs_dir):  # sketch of lib/pipeline_loader.py
    manifest = _yaml_safe_load(defs_dir / f"{name}.yaml")
    jsonschema.validate(instance=manifest, schema=_manifest_schema())  # validate only
    return manifest                                                    # ...then hand back
# accessors only: get_stage_order / get_required_tools / get_stage_skill /
# get_stage_review_focus — no run(), no execute(). lib/checkpoint.py likewise just
# validates + persists stage state so the agent can resume.

# (2) THE RENDER END (the consuming half) — the agent's brain hands off to a
# DETERMINISTIC renderer via a JSON props file; Remotion turns props into frames.
#   remotion-composer/src/Root.tsx registers compositions; agent emits props JSON.
def Root():  # sketch — remotion-composer/src/Root.tsx
    register("Cinematic", CinematicRenderer)   # <Composition id=... component=.../>
    register("Explainer", Explainer)
    register("TalkingHead", TalkingHead)
    # The compose-director stage produces render_props (e.g. titled_video_props.json);
    # `remotion render <id> props.json out.mp4` is the only place pixels are made.
    # [INFERRED: exact props filename/handoff from titled_video_props.json + compositions]


# ============================================================================
# GROWTH SEAMS  (the actual extension surface)
# ============================================================================
# 1. New pipeline: drop a pipeline_defs/<name>.yaml manifest.
# 2. New crew role: add skills/pipelines/<name>/<role>.md and list it in required_skills.
# 3. New look: add a playbook/style (manifest compatible_playbooks; custom_playbooks).
# 4. Per-manifest permission flags gate extensions:
#       extensions: {custom_scripts, custom_playbooks, custom_skills, custom_tools}
# 5. New visual: add a Remotion composition in remotion-composer/src + Root.tsx.


# ============================================================================
# NEGATIVE SPACE  (deliberately LEFT OUT — common to the ecosystem, not DNA)
# ============================================================================
# - Provider adapters (OpenAI / fal / Veo / Kling / Chirp3 / WhisperX) and the
#   image/video/TTS calls themselves — table stakes for any AI-video tool.
# - ffmpeg/moviepy stitching, mp4 muxing, caption burn-in — reference genome.
# - The ~800 vendored "best-practices" md packs (vercel-react, remotion, manim) —
#   borrowed reference material, not OpenMontage's own identity.
# - YAML loading + JSON-schema validation as a mechanism — ordinary plumbing.
# - PROMPT_GALLERY / example prompts / demo videos — marketing and docs, not DNA.
#
# Rebuild test: from this file a senior dev could reconstruct the character — "an AI
#   video system with no engine: a coding agent reads a YAML pipeline manifest,
#   embodies a chain of markdown 'director' skills, produces schema-validated
#   artifacts through an executive-producer review loop with budget/send-back caps,
#   checkpoints to disk, and hands a props JSON to Remotion to render; Python only
#   loads and validates." Yes.
# Confusion test: strip the names and it still can't be an ordinary AI-video app
#   (an open `generate.py`, Pika, InVideo) — those ARE the orchestrator. OpenMontage
#   deliberately has none and runs INSIDE your coding agent, shipping its logic as
#   manifests + prose skills across six different assistant hosts. Passes.
