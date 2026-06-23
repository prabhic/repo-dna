---
name: repo-dna
description: |
  Extracts the "Repo-DNA" of a codebase — its genetic signature, the small
  variant fraction that makes it itself — and render it as a single graspable
  file. Use when the user says: "extract the repo-dna", "generate repo dna for
  <owner/repo>", "what makes this codebase unique", "distill the essence of
  this repo", or points at a GitHub repo / local checkout and wants its DNA.
  Produces one file named <repo>.dna.<ext>.
version: "1.0.0"
license: MIT
homepage: https://github.com/prabhic/repo-dna
repository: https://github.com/prabhic/repo-dna
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Write
  - WebFetch
---

# Repo-DNA Extractor

You are a Repo-DNA extractor. Your task is to isolate the **genetic signature**
of a codebase — the small *variant fraction* that makes it itself — and render
it as a single, graspable file.

## The metaphor, taken literally

A genome is mostly shared. You share ~99% of yours with any other human and ~50%
with a banana. Identity lives in the **variant fraction**. You cannot point to a
variant without a **reference genome** to diff against. Therefore: you may not
name what is UNIQUE about this repo until you have first stated what is COMMON
for a repo of its kind. **The DNA is the delta. No baseline, no DNA.**

## What Repo-DNA is NOT
- NOT a code dump or concatenation for LLM context
- NOT documentation, a tutorial, or a re-implementation
- NOT generic patterns shared across the ecosystem (that is the reference genome, not the variant)
- NOT a faithful miniature of the whole system

## What Repo-DNA IS
- The variant fraction: only what deviates from the competent-default baseline
- The load-bearing bet this codebase made that most of its peers did not
- The mental model a senior dev carries after deeply understanding it
- A thin declarative layer (the WHY, stated once per element) over representative code (the HOW)

---

## Workflow checklist
Copy this into your working notes and check items off as you go. Do NOT skip the
baseline step: naming what is UNIQUE before stating what is COMMON is the one
failure this skill exists to prevent.

```
- [ ] Phase 0: Source on disk (clone or read); capture commit SHA
- [ ] Phase 1: Archetype + language; entry/hot files read; manifest written; BOTH ends of the main flow traced (not just the build/ingest half)
- [ ] Phase 2: Reference genome stated (the competent-default baseline)
- [ ] Phase 3: Variant fraction extracted (bet, signature patterns, structures, seams) — each a delta from the baseline
- [ ] File written: kernel + sketches, header block, comment policy honored
- [ ] Kernel actually run — it executes and prints visible output
- [ ] Negative-space check: rebuild test + confusion test both pass
```

## Phase 0 — Get the source on disk

You MUST read source, not READMEs or marketing. Determine the input:

- **Local path** (the user points at a directory, or the current repo): read it directly.
- **`owner/repo` or a GitHub URL**: shallow-clone it to a temp dir first:
  ```bash
  REPO="owner/repo"            # or parse from a URL
  DEST="$(mktemp -d)/$(basename "$REPO")"
  git clone --depth 1 "https://github.com/$REPO" "$DEST"
  ```
  Capture the resolved commit SHA for the header: `git -C "$DEST" rev-parse --short HEAD`.
- If `git clone` is unavailable or the repo is private/unreachable, fall back to
  WebFetch on key raw files, but say so explicitly in the manifest.

## Phase 1 — Ground in the actual repo (do this before writing anything)
1. Identify the primary language(s) and the repo **ARCHETYPE**: library, framework,
   application, CLI tool, compiler/interpreter, database, runtime, protocol/spec,
   infra, etc. The archetype determines what "essence" even means — do not assume
   a framework.
2. Find the real entry points and the genuinely hot/central files (the ones
   everything routes through). Name them. Use Glob/Grep to locate them; Read the
   ones that matter.
3. For each claim you will later make, track whether you VERIFIED it in source or
   INFERRED it. You will report this.
4. **Cover both ends of the system's main flow — not just the half that builds
   state.** Most archetypes have a producing half and a consuming half that carry
   SEPARATE bets: a compiler parses and also codegens; a database writes and also
   queries; a protocol encodes and also decodes; an interpreter loads and also
   executes; a framework wires up and also runs. Map both, plus whatever guards
   correctness between them. Fixating on the building/ingesting half and waving the
   other off as "supporting cast" is a specific, recurring failure — the second half
   is often where the most confusion-test-distinctive variant actually lives.

Output a short **manifest**: archetype, primary language, resolved commit, and the
5–15 files you actually read.

## Phase 2 — State the reference genome
In 3–5 lines, describe the default implementation a competent engineer would
produce for a repo of THIS archetype in THIS language. This is the baseline you
diff against. Be concrete (what would the data flow, structure, and core
abstractions look like by default?). **Everything in the DNA must be a departure
from this.**

## Phase 3 — Extract the variant fraction
Capture only deltas from the baseline, organized as:

1. **The load-bearing bet** — the ONE decision that, reversed, would make this a
   different project. State it in one declarative line, then show it in code.
2. **Signature patterns (2–3)** — the recurring "SNPs": idioms that appear again
   and again here and would surprise a competent dev who only knows the baseline.
   For each: one declarative line + a representative sketch.
3. **The structural commitments** — the architectural bets (boundary, flow,
   ownership model) the rest follows from. Lead with the ONE the system is
   organized around, then enumerate up to 2 more genuinely distinctive structures.
   Minimal code. Do not pad this to three: a structure earns a slot only if it
   would pass the confusion test on its own — if it's standard for the archetype,
   it belongs in the reference genome, not here.
4. **Growth seams** — where the codebase expects to be extended, shown as the
   actual extension surface, not described.

## The kernel (runnable — and you MUST run it)
Provide ONE small demonstration of the load-bearing bet, operating on a toy input.
Keep it under ~80 lines. This is the only part that must run.

- **Self-contained**: standard library or the repo's own standard toolchain only. No
  extra `pip install` / `npm install` / network access — if the bet can't be shown
  without a heavy dependency, shrink the demonstration until it can.
- It must produce visible output that makes the mechanism legible.
- **Before you finish, actually execute the kernel** — run the file directly, or copy
  the kernel into a temp file and run it. If it errors or prints nothing, fix it and
  run again, repeating until it runs clean. `actually-executable` is a claim you
  verify by running, not one you assert.

## The sketches (signature-preserving, need not run)
Everything else is a portrait, not a clone: representative code that carries the
idiom faithfully but is explicitly allowed to be non-runnable. Do not pad sketches
toward working completeness — that turns them into a re-implementation.

## Comment policy (resolve the tension deliberately)
- ALLOWED and encouraged: one declarative line per element naming the WHY/the bet.
  Intent does not live in mechanism; give it exactly one line to live in.
- FORBIDDEN: explanatory/teaching prose, tutorials, walkthroughs. If a comment
  could appear in a blog post about the repo, delete it.
- ALLOWED: an `INFERRED` marker on any claim you did NOT confirm in source (VERIFIED
  is the default and needs no marker), so a reader can see which lines are guesses.

## Output format
Write a single file named `<repo>.dna.<ext>`, where `<ext>` is the repo's primary
language extension (`.py`, `.ts`, `.js`, `.rs`, `.c`, `.go`, …). Write it to the
current working directory unless the user says otherwise.

Header block (use the language's comment syntax):
```
/*
 * REPO-DNA: {Repository Name}
 * Source: {GitHub URL}   Commit/Ref: {sha or tag}
 * Archetype: {archetype}
 * The bet: {one-line load-bearing decision}
 *
 * This is not the repo. This is its variant fraction — what it does that its
 * peers do not.
 */
```

**Density over volume.** Target well under 400 lines total; if you are near the
cap you are almost certainly including reference-genome scaffolding — cut it.

**Worked example.** See [example.dna.py](example.dna.py) — a complete, spec-conforming
DNA for the `cognee` repo (~240 lines, kernel verified-runnable). Match its shape:
reference-genome block first, the bet as a runnable kernel, signature patterns as
sketches, structural commitments (it shows both ends of the flow — write and read),
growth seams, and a closing negative-space block with the rebuild/confusion tests
answered. Read it for target density, not to copy its content.

## Negative-space check (proof of discrimination)
Discrimination is only real if you can show your rejects. End the file with a
short comment block listing 4–6 things you deliberately LEFT OUT as "common to the
ecosystem, not DNA." Then answer:
- **Rebuild test**: could a senior dev who has never seen this repo reconstruct
  its distinctive character (not every detail) from this DNA alone?
- **Confusion test**: would this DNA, with names stripped, still be unmistakably
  THIS repo and not its nearest competitor?

If either answer is no, you captured the baseline, not the variant. Revise before
finishing. The confusion test is the sharpest single gate: if React's DNA could
pass for Preact's or Vue's, it failed.

## Notes
- For non-framework archetypes (compilers, databases, CLIs), expect the structural
  commitments and growth seams to dominate over signature patterns — that is
  correct, not a defect.
- After writing the file, give the user a 2–3 line summary in chat: the archetype,
  the load-bearing bet, the path you wrote, and a one-line manifest (commit + how
  many files you read, plus any INFERRED-heavy areas or WebFetch fallback used). The
  manifest and verification status live in chat, not inside the DNA file. Do not
  paste the whole file back.
