# Installing the `repo-dna` Claude skill

## What is a Claude skill?

A **skill** is a folder Claude Code loads on demand. It's just a `SKILL.md` file
with YAML frontmatter (`name`, `description`) and a markdown body of instructions.
Claude reads the `description` of every available skill at session start; when your
request matches, it invokes the skill and follows the body. You trigger it by
asking in plain language (the `description` lists the trigger phrases) or by typing
`/repo-dna` — no separate install step beyond putting the folder in the right place.

Skills are discovered from three locations:

| Scope | Location | Use when |
|-------|----------|----------|
| **Project** | `<repo>/.claude/skills/<name>/SKILL.md` | You want it available to anyone who clones *this* repo |
| **Personal** | `~/.claude/skills/<name>/SKILL.md` | You want it in *every* project on your machine |
| **Plugin** | shipped inside a plugin | Distributing to a team via the plugin marketplace |

This repo ships the skill as a Claude Code **plugin** — `SKILL.md` lives at the repo
root (the plugin's default skill), with `example.dna.py` beside it. You can run it
straight from the repo, install it **standalone** for a bare `/repo-dna`, or install
the **plugin** from the marketplace. All three are below.

---

## Option A — Run it straight from this repo

```bash
git clone https://github.com/prabhic/repo-dna
cd repo-dna
claude --plugin-dir .     # load this repo as a plugin
```

Then just ask:

```
Extract the Repo-DNA for: facebook/react
```

(`--plugin-dir .` loads the root `SKILL.md`; invoked here as `/repo-dna:repo-dna`.)

## Option B — Install standalone (bare `/repo-dna` in any project)

Copy the skill files into your personal skills directory:

```bash
mkdir -p ~/.claude/skills/repo-dna
cp SKILL.md example.dna.py ~/.claude/skills/repo-dna/
```

Now from *any* directory:

```bash
cd ~/some/other/project
claude
> /repo-dna           # or: "extract the repo-dna for tinygrad/tinygrad"
```

To update later, re-copy the files. To uninstall: `rm -rf ~/.claude/skills/repo-dna`.

Only Option B gives the **bare `/repo-dna`**; Options A and C use the namespaced
**`/repo-dna:repo-dna`**.

## Option C — Install as a plugin (marketplace, versioned)

This repo is also a Claude Code plugin with its own marketplace. Inside Claude Code:

```text
/plugin marketplace add prabhic/repo-dna
/plugin install repo-dna@repo-dna
```

Plugin skills are **always namespaced**, so via this route the skill is invoked as
**`/repo-dna:repo-dna`** (not bare). Choose this for one-line install and
version-pinned updates; choose Option B if you prefer the bare `/repo-dna`.

## Verify it's installed

Inside Claude Code, type `/` and confirm `repo-dna` appears in the skill list, or
just ask "what makes this codebase unique" and confirm Claude announces it's using
the `repo-dna` skill.

---

## Usage

Point the skill at any of:

- a GitHub repo: `Extract the Repo-DNA for: getzep/graphiti`
- a GitHub URL: `generate repo dna for https://github.com/sqlite/sqlite`
- a local checkout: `extract the repo-dna of ./` or `... of /path/to/repo`

The skill clones the repo (shallow) if needed, reads the real source, and writes a
single `<repo>.dna.<ext>` file in your current directory, then summarizes the
load-bearing bet. See the example outputs in the root of this repo
(`graphiti.dna.py`, `react.dna.js`, `linux.dna.c`, …) for the target shape.

## Requirements

- Claude Code CLI
- `git` on PATH (for cloning remote repos; not needed for local paths)
