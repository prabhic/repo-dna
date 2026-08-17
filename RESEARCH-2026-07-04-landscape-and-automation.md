# Repo-DNA: Landscape, Differentiation & Automation Feasibility

**Date:** 2026-07-04  
**Branch:** `research/dna-landscape-automation`  
**Scope:** Survey of existing codebase-distillation tools + automation pipeline designs

---

## TL;DR

**Is Repo-DNA differentiated?** Yes — meaningfully. Every comparable tool either dumps context (repomix, gitingest, code2prompt), generates prose documentation (DeepWiki, Sourcegraph), or recovers structural diagrams (SSAR, CIAO, ArchAgent). None of them ask "what makes this repo different from its nearest competent alternative?" or enforce a discrimination test. The _delta framing_ (reference genome → variant fraction), the _confusion test_, and the _runnable kernel as proof_ are genuine conceptual innovations with no close equivalent in the current tool landscape.

**Is automation feasible?** Yes — a tiered path exists. A single-LLM-pass pipeline can produce plausible DNA today, but quality collapses on large or novel repos. The strongest feasible near-term architecture is a **multi-stage specialized agent pipeline** (Scout → Genome → Delta → Kernel → Validator) that mirrors the SKILL.md workflow checklist. Full validation against a peer-corpus to auto-run the confusion test is longer-term (months, not days), but the mechanical layers (clone, rank, run kernel) are implementable now.

**Single best path:** Implement the multi-stage agent pipeline (Pipeline 2) against the existing SKILL.md spec; use kernel execution as the automated quality gate; defer peer-corpus confusion testing to Phase 3.

---

## Landscape Table

| Tool / Approach | What It Produces | Primary Goal | Overlap with Repo-DNA | Gap vs Repo-DNA |
|---|---|---|---|---|
| **repomix** | XML/text dump of the full repo; Tree-sitter compression optional | Feed entire codebase as LLM context | Single-file output | Capture everything, not the delta. No reference genome, no load-bearing bet, no discrimination test. |
| **gitingest** | Plain-text dump (github.com → gitingest.com URL swap) | Frictionless codebase-to-prompt | Single-file output | Same as repomix: exhaustive context, not distillation. No essence concept. |
| **code2prompt** | Structured prompt with file tree, Handlebars templates, token counts | Templated context packaging for LLMs | Single-file, configurable filtering | Richer templating than repomix but still a dump. No baseline, no bet, no confusion test. |
| **DeepWiki** (Cognition/Devin) | Interactive wiki pages: architecture overview, dependency graphs, conversational Q&A | Democratize codebase comprehension | Produces a distilled understanding of the repo | Prose documentation, not essence-in-code. No reference genome. No runnable kernel. No discrimination test. Covers "what it is," not "what makes it unique." |
| **Sourcegraph / Cody** | RAG-based answers to code questions; completion; search results | Navigate and understand large codebases, assist coding | Deep code reading | Chat answers, not a persistent artifact. No baseline concept. Retrieval ≠ distillation. |
| **Architecture Recovery tools** (SSAR ICSE 2026, CIAO 2025, ArchAgent) | UML component diagrams, package diagrams, C&C views | Document the implemented architecture | Structural understanding of the codebase | Captures _what the architecture is_, not _what makes it distinct from peers_. No archetype baseline. No runnable kernel. Academic output (diagrams), not executable. |
| **ADR generation** (AgenticAKM, LLM-based) | Architectural Decision Records extracted from source code | Document design decisions | Closer — hunts for design decisions | Captures ALL decisions found, not the ONE load-bearing bet. No reference genome, no discrimination test, no kernel. ADRs are prose, not code. |
| **SWE-Explore / RepoMaster** | Ranked list of relevant code regions for a task | Benchmark repo exploration for bug-fixing agents | Multi-step codebase reading | Task-specific navigation, not a persistent distillation artifact. No essence / delta framing. |
| **Repo-DNA** | Single `.dna.<ext>` file: reference genome + load-bearing bet + runnable kernel + sketches + negative-space block | Capture the variant fraction that makes a repo itself | — | _Is_ the baseline comparison |

**Read across this table:** the left column is dominated by tools that capture volume (dumps) or structure (docs/diagrams). The gap Repo-DNA targets — "what would a competent alternative have done, and what did this project do instead?" — is unoccupied.

---

## What's Genuinely Novel

### 1. The Delta Framing (no baseline, no DNA)

Every other tool starts from the repo and computes outward. Repo-DNA starts by declaring what is *common* — the reference genome — and then extracts only departures. This relational definition of uniqueness is the core insight: you cannot point to a variant without a reference. No other tool in the landscape implements this. It is philosophically sound (borrowed from population genetics, where SNPs are defined against a reference allele) and practically useful (it forces the extractor to think about archetypes, not just mechanisms).

### 2. The Confusion Test as a Discriminative Proof

"Strip the names — could this DNA only be THIS repo and not its nearest competitor?" No other tool enforces a discrimination check. Architecture recovery tools produce diagrams that would look similar for competing products. DeepWiki produces docs that would differ only in content, not in discriminative structure. The confusion test is an active falsifiability gate — rare in the tooling space.

### 3. The Runnable Kernel as Proof of Understanding

A runnable kernel — self-contained, standard-library-only — that demonstrably exercises the load-bearing bet is a claim verification step, not just documentation. It forces the extractor to commit: "this mechanism actually runs this way." The current SKILL.md requires physically running the kernel and fixing it if it errors. No competing approach makes the output executable and tests it.

### 4. The Load-Bearing Bet Concept

Other ADR and architecture tools catalog decisions. Repo-DNA hunts for ONE: the decision that, reversed, would make this a different project. This is a conceptual reduction from "list of decisions" to "causal spine." The bet concept is novel in the tooling space (though related to the idea of "architectural drivers" in the academic literature, it is much more specific and opinionated).

### 5. The Negative-Space Block

Explicitly listing what was _left out_ and why is unusual. Most documentation tools are additive. The negative-space block is a form of bounded completeness — it proves the extractor made deliberate choices, not just included everything they found.

---

## Honest Weaknesses

### 1. Subjectivity of the Reference Genome

The quality of the DNA depends entirely on how accurately the extractor models the "competent default." Two engineers might draw very different reference genomes for the same archetype, yielding different deltas. There is no formal archetype taxonomy. For novel repos at the intersection of archetypes (e.g., a database that is also a messaging system), the reference genome is underspecified by the methodology.

### 2. The Bet May Not Be Singular

The requirement for ONE load-bearing bet is productive for forcing clarity, but many mature systems have multiple co-equal organizing principles. React arguably has two bets (fiber interruptibility AND host-agnosticism behind a build-time fork). The singular constraint may force an artificial ranking that misrepresents systems with peer-level bets.

### 3. Hallucination is Structurally Hard to Catch

An LLM can state a compelling bet, write a runnable kernel that demonstrates the mechanism described, and pass the confusion test — all while the bet is a misread of the actual codebase. The kernel only proves "this code runs," not "this is actually how the real repo works." The current methodology partially guards against this with source verification markers (`INFERRED`), but the discrimination between VERIFIED and INFERRED is only as good as the extractor's actual reading depth.

### 4. Temporal Decay with No Versioning Signal

A DNA file has a commit SHA in the header. But there is no mechanism for alerting consumers that the DNA has drifted from the live codebase, no freshness protocol, and no diff-from-last-DNA workflow. For fast-moving repos, DNA can go stale in weeks.

### 5. The 400-Line Constraint Can Force Premature Choices

The density constraint is valuable as a forcing function but can cause the extractor to drop genuinely distinctive elements to stay under the cap. For systems with multiple distinctive structural commitments (e.g., a database with distinct write, read, and recovery paths), 400 lines is tight.

### 6. The Confusion and Rebuild Tests Are Circular

Both tests are currently answered by the same agent that wrote the DNA. A more rigorous validation would require a _separate_ agent (or human) that has not seen the DNA construction process to answer both tests blind.

---

## Top 3 Automation Pipeline Designs

Each pipeline must solve four subproblems: (a) establish the reference genome baseline, (b) find the load-bearing bet, (c) extract signature patterns, and (d) validate the output. They differ in how they solve these and in the tradeoffs they accept.

---

### Pipeline 1: Structured-Prompt Single-Pass

**Architecture**

```
Input: owner/repo
  │
  ├─ Step 1: Clone (shallow) + file ranking
  │   - git clone --depth 1
  │   - Rank files by: entry-point heuristics (main, index, core, lib),
  │     git blame heat (most-edited files), import graph centrality
  │   - Select top 25-40 files
  │
  ├─ Step 2: Single LLM call with SKILL.md as system prompt
  │   - Feed: ranked file contents + SKILL.md methodology
  │   - Ask for: reference genome → bet → kernel → sketches → negative space
  │   - Specify target format: <repo>.dna.<ext>
  │
  ├─ Step 3: Kernel execution
  │   - Extract kernel section from output
  │   - Run in isolated subprocess
  │   - If exit code ≠ 0 or empty stdout: re-invoke LLM with error + ask to fix
  │   - Max 3 retries
  │
  └─ Output: <repo>.dna.<ext>
```

**Validation Strategy:** Kernel must execute and print visible output. Optionally: pipe the DNA to a second LLM call with "answer the confusion test: does this DNA, with names stripped, describe only this repo?" — a soft heuristic, not a formal check.

**Feasibility:** High — this is approximately what a manual invocation of the current SKILL.md skill does, automated. Can be implemented in one session.

**Effort:** Low — ~2 days to wire up.

**Risks:**
- Context window overflows on large repos (>500 files). Mitigation: stricter file ranking, chunk-then-summarize pre-step.
- LLM may not actually read the ranked files deeply — it simulates reading. No systematic verification.
- Single-pass means the reference genome is written before sufficient reading is done. The SKILL.md checklist intentionally sequences genome AFTER reading, but a single prompt conflates them.
- Quality ceiling: produces plausible DNA for well-known repos (where LLM has priors) and poorer DNA for obscure or novel ones.

---

### Pipeline 2: Multi-Stage Specialized Agent (Recommended)

This pipeline mirrors the SKILL.md Phase 0–3 + kernel + validation workflow as discrete agents, each with a narrow task and a written output that feeds the next.

**Architecture**

```
Input: owner/repo
  │
  ├─ Stage 0: Scout Agent
  │   Task: Clone repo, capture commit SHA, identify archetype and language.
  │         Run import-graph analysis (python -c / node -e / tree-sitter).
  │         Produce: { archetype, language, entry_files[], hot_files[], commit_sha }
  │   Tools: Bash (clone, git blame, find), Glob, Grep
  │
  ├─ Stage 1: Reader Agent
  │   Task: Read the top 30-50 files identified by Scout.
  │         Produce a MANIFEST: for each file, one-line summary of what it does
  │         and what distinctive mechanisms it contains.
  │         Explicitly cover BOTH ends of the system's main flow.
  │   Tools: Read, Grep (to find the hot paths)
  │   Output: manifest.json { files_read, flow_head, flow_tail, notable_mechanisms[] }
  │
  ├─ Stage 2: Genome Agent
  │   Task: Given the archetype + language from Scout, write the reference genome.
  │         "What would a competent engineer build for a {archetype} in {language}?"
  │         Use web search if needed for ecosystem baselines.
  │         Produce: reference_genome.md (3-5 concrete lines)
  │   Tools: WebSearch, Write
  │   Output: reference_genome.md
  │
  ├─ Stage 3: Delta Agent
  │   Task: Given the manifest (Stage 1) and genome (Stage 2), extract the delta.
  │         Identify the ONE load-bearing bet (must be reversible and repo-specific).
  │         Identify 2-3 signature patterns (SNPs).
  │         Identify structural commitments (cover both ends).
  │         Identify growth seams.
  │         Explicitly list 4-6 things left out as "common, not DNA."
  │   Output: delta.json { bet, snps[], structural[], seams[], negspace[] }
  │
  ├─ Stage 4: Kernel Writer + Runner Agent
  │   Task: Write a self-contained kernel (<80 lines, stdlib-only) that
  │         demonstrates the load-bearing bet. Run it. Fix until it prints output.
  │         Max 3 fix iterations before escalating with a warning.
  │   Tools: Write, Bash (run the kernel)
  │   Output: kernel.<ext> + kernel_output.txt
  │
  ├─ Stage 5: Assembler Agent
  │   Task: Combine genome (Stage 2) + delta (Stage 3) + kernel (Stage 4) into
  │         the final <repo>.dna.<ext> file. Apply the SKILL.md format spec.
  │   Output: <repo>.dna.<ext>
  │
  └─ Stage 6: Validator Agent
       Task: Answer both tests independently:
         (a) REBUILD TEST: "Given only this DNA, could a senior dev reconstruct
             the repo's distinctive character?" (LLM judgment, binary + reason)
         (b) CONFUSION TEST: Given the DNA with names stripped, and the names of
             3 adjacent repos (fetched from Scout's archetype), produce a verdict:
             "Is this DNA ambiguous — could it describe a peer?" If yes: what needs
             to change?
         Output a validation_report.json with verdicts.
       Tools: WebSearch (find peer repos), Read
```

**Validation Strategy:**
1. **Mechanical**: kernel exit code = 0 AND stdout is non-empty (automated gate)
2. **Semi-automated**: Validator agent confusion test against 3 named peer repos (LLM judgment, not oracle)
3. **Optional human gate**: validation_report.json surfaced to user before final write

**Feasibility:** Medium-high — all stages use existing Claude Code tools. The main engineering work is wiring the stage outputs together and handling the kernel retry loop. Can be built on top of the existing Workflow infrastructure.

**Effort:** ~1-2 weeks for a working implementation; ~4 weeks for production quality.

**Risks:**
- Genome Agent may write a shallow or incorrect reference genome if the archetype is ambiguous. Mitigation: have it cite 2-3 concrete examples of the baseline pattern.
- Delta Agent may pick a departure that is common to a sub-archetype but not the whole ecosystem. Mitigation: the Validator's confusion test catches this.
- Kernel Writer may need heavy deps to demonstrate the bet (e.g., if the bet is in a concurrency model that requires the actual runtime). Mitigation: shrink the demonstration until it can use stdlib; accept that some bets require a sketch, not a running kernel.
- Stage outputs can be lossy — the Delta Agent works from the manifest, not the raw code. Mitigation: pass the manifest AND the top 10 most-relevant raw files to Stage 3.

---

### Pipeline 3: RAG + Multi-Perspective Judge Panel

This pipeline trades sequential depth for parallel breadth. Multiple agents explore the repo from different angles; a judge panel synthesizes.

**Architecture**

```
Input: owner/repo
  │
  ├─ Ingest Phase (once per repo)
  │   - Clone repo; chunk by file + AST boundaries
  │   - Build embedding index (local vector store, e.g., FAISS / chromadb)
  │   - Build import graph (call graph adjacency)
  │   - Build edit-frequency heatmap (git log --numstat)
  │
  ├─ Multi-Perspective Extraction (parallel, 5 agents)
  │   Each agent gets: archetype, import graph summary, top-K chunks by relevance
  │   Agent A (Surprise): "What would a new contributor find most surprising?"
  │   Agent B (Reversal): "What decision, if reversed, would break the most code?"
  │   Agent C (Peer compare): "What do you see here that you haven't seen in
  │                           similar repos?" (uses web search for peers)
  │   Agent D (Hot path): "What does the hottest code path reveal about priorities?"
  │   Agent E (Consumer): "What does the consuming half of the flow do that's unusual?"
  │   Each outputs: { candidate_bet, evidence[], confidence }
  │
  ├─ Synthesis Agent
  │   Task: Given 5 candidate bets, find the ONE that:
  │     (a) appears in at least 3 agents' outputs, OR is highest-confidence
  │     (b) is reversible (would make this a different project if flipped)
  │     (c) is not present in the reference genome for this archetype
  │   Output: final_bet + reference_genome + signature_patterns[]
  │
  ├─ Discriminant Checker
  │   Task: Fetch the top 3 peer repos by archetype (from web search or a corpus).
  │         Ask: "Does the proposed bet also describe peers?"
  │         If yes, return to Synthesis Agent with a rejection + peer evidence.
  │         Iterate until bet passes or max 3 rounds.
  │
  ├─ Kernel Generator + Runner (same as Pipeline 2 Stage 4)
  │
  └─ Assembler (same as Pipeline 2 Stage 5)
```

**Validation Strategy:**
1. Kernel execution (mechanical)
2. Discriminant Checker provides a peer-corpus confusion test (stronger than Pipeline 2's LLM-only judgment, because it actually reads peer repos)
3. Multi-agent consensus as a proxy for bet reliability

**Feasibility:** Lower — requires a vector embedding pipeline, a pre-built or dynamically built peer corpus, and parallelism infrastructure. The per-repo setup cost (clone + chunk + embed) is non-trivial.

**Effort:** 2-3 months for a robust implementation.

**Risks:**
- RAG retrieval may miss non-central-but-distinctive files (rare utility files that encode the real bet). Mitigation: hybrid: RAG + import-graph traversal + git-blame heat.
- Multi-perspective synthesis can average toward the obvious rather than the distinctive.
- Peer corpus needs to be curated or dynamically selected — "top 3 by stars" may not be the right competitors.
- Higher cost per extraction (5+ LLM calls in parallel + embedding + peer reads).
- More complex failure modes: a single agent's hallucination can pollute the synthesis.

---

## Recommendation + Phased Plan

### Recommendation

**Build Pipeline 2 (multi-stage) against the existing SKILL.md spec.** It is the closest formal implementation of the existing human workflow; it produces explicit intermediate artifacts (manifest, genome, delta) that are independently inspectable; and it has a clear, mechanical validation gate (kernel execution). Pipeline 1 is too shallow for anything beyond toy repos. Pipeline 3 is architecturally sound but the effort-to-quality tradeoff doesn't improve over Pipeline 2 until you have a peer corpus, which is a separate project.

### Phased Plan

**Phase 1 (1-2 days): Single-Pass Baseline**
- Implement Pipeline 1 as a regression baseline.
- Wire: clone → file ranking → SKILL.md prompt → kernel extraction → kernel run.
- Measure: what fraction of kernels run on the first try? (Target: >70% for well-known repos.)
- Use the existing `.dna.*` files in this repo as ground truth for quality comparison.
- Deliverable: `scripts/extract_dna_simple.sh` + a prompt template.

**Phase 2 (1-2 weeks): Multi-Stage Pipeline**
- Implement Pipeline 2 as a Claude Code Workflow (using the `Workflow` tool or a Python orchestration script).
- Stages as separate agents with explicit JSON hand-off contracts.
- Key milestones:
  - [ ] Scout + Reader working, producing a reliable manifest
  - [ ] Genome Agent producing concrete, archetype-specific reference genomes (evaluate on 5 known repos)
  - [ ] Kernel Writer running kernels successfully for 80%+ of test repos
  - [ ] Validator Agent producing consistent confusion-test verdicts
- Test set: cognee, react, zustand, OpenMontage, linux (already in repo) + 5 new repos.

**Phase 3 (1-2 months): Corpus-Based Validation**
- Build a peer corpus: 50-100 repos per major archetype (web framework, state manager, ORM, graph DB, etc.)
- Embed corpus DNA candidates using the Discriminant Checker pattern from Pipeline 3.
- Add automated confusion test that compares extracted DNA against peer DNAs.
- Expose a quality score: `bet_discriminability` (0-1, fraction of peers the bet does NOT describe).
- Deliverable: `dna_quality_score.py` + a public corpus.

**Phase 4 (ongoing): Feedback Loop**
- Users who add DNA files to the repo provide ground-truth data.
- Use the ground-truth DNAs to fine-tune the Genome Agent's archetype templates.
- Add a freshness check: compare the commit SHA in the header against the repo's latest commit; emit a staleness warning if the repo has changed materially.

---

## Worked Sketch: `expressjs/express` (Dry Run of Pipeline 2)

This section traces Pipeline 2 through a well-known small repo to show what each stage produces. This is a conceptual sketch based on public knowledge of Express; a real run would read actual source.

### Stage 0 — Scout Output

```json
{
  "archetype": "HTTP server framework (middleware-based)",
  "language": "JavaScript (Node.js)",
  "commit_sha": "hypothetical",
  "entry_files": ["lib/express.js", "lib/application.js"],
  "hot_files": ["lib/router/index.js", "lib/router/layer.js", "lib/router/route.js",
                "lib/application.js", "lib/middleware/init.js"]
}
```

### Stage 1 — Manifest (key mechanisms)

- `application.js`: `app.use()` and `app.handle()` register and traverse the middleware stack. The app object IS a function (`createApplication` returns a callable).
- `router/index.js`: The router is itself a piece of middleware; `router.handle()` traverses its layers.
- `router/layer.js`: A single `(path, handler)` tuple with a `match(path)` method using path-to-regexp.
- `router/route.js`: A route is a chain of method-specific handlers (a mini-stack within a layer).
- **Both ends of the flow:** Producing side = `app.use()` / `router.use()` registration. Consuming side = `app.handle()` → `router.process_params()` → `Layer.handle_request()` → `next()` traversal.

### Stage 2 — Reference Genome (Genome Agent)

> A capable engineer building an HTTP server framework in Node.js would:
> - Create an `http.createServer(function(req, res){ ... })` wrapper
> - Maintain an array of `{ method, path, handler }` tuples
> - For each request, iterate the array, match method + path, and call the matching handler
> - Apply one middleware layer concept (e.g., "all routes run sequentially until one sends a response")
> - Error handling is a try/catch around the handler call

### Stage 3 — Delta (Delta Agent)

> **Load-bearing bet:** The middleware function signature `(req, res, next)` turns the framework into a composable pipeline: calling `next()` defers to the _next registered middleware_; calling `next(err)` skips to the first _4-argument error handler_. The `app` object itself is a `(req, res, next)` function (you can pass it to `http.createServer` OR nest it inside another Express app). The framework is the traversal of this stack, nothing else.
>
> **Signature patterns (SNPs):**
> 1. The router IS middleware: `app.use('/api', apiRouter)` mounts a sub-router as a middleware, not as a special router type.
> 2. Error middleware is distinguished by arity alone: `(err, req, res, next)` — no decorator, no special class.
> 3. Route methods are sugar over `app.use` with a method filter: `app.get(path, handler)` === `app.use(path, layer_for(GET, handler))`.
>
> **Structural commitments:**
> 1. (Write/register side) `Layer` is the atomic unit: a (regexp, handler) pair. The stack is a flat array of Layers.
> 2. (Consume/dispatch side) `next()` is a closure over the layer array index — calling it increments the index and invokes the next Layer's `handle_request`. There is no scheduler, no event bus.
>
> **Growth seams:** `app.engine(ext, fn)` for template engines; `app.use(path, fn)` for mounting anything; `router.param(name, fn)` for param middleware.
>
> **Negative space (left out as common):**
> - HTTP parsing (Node's `http` module handles it) — reference genome
> - Template engines (Pug, EJS) — pluggable, not identity
> - Body parsing — moved to a separate middleware package (a design choice, but ecosystem, not DNA)
> - Static file serving — `serve-static` middleware, not the core

### Kernel Sketch (would need to actually run)

```js
// express-kernel.js — load-bearing bet: (req,res,next) traversal; app IS a handler
const http = require('http');

// The entire framework is this:
function createApp() {
  const layers = [];
  const app = function handle(req, res, next) {
    let i = 0;
    function dispatch(err) {
      const layer = layers[i++];
      if (!layer) return next ? next(err) : res.end('Not found');
      if (err) {
        // 4-arg = error handler; skip non-error layers
        if (layer.handle.length === 4) return layer.handle(err, req, res, dispatch);
        return dispatch(err);
      }
      try { layer.handle(req, res, dispatch); } catch(e) { dispatch(e); }
    }
    dispatch();
  };
  app.use = (fn) => { layers.push({ handle: fn }); return app; };
  return app;
}

const app = createApp();
app.use((req, res, next) => { console.log('mw1: logging'); next(); });
app.use((req, res, next) => { res.end('hello from mw2'); });
app.use((err, req, res, next) => { res.end('error: ' + err.message); });

const server = http.createServer(app);  // app IS the handler
server.listen(0, () => {
  const { port } = server.address();
  http.get(`http://localhost:${port}/`, (r) => {
    r.on('data', d => { console.log('response:', d.toString()); server.close(); });
  });
});
// Output: mw1: logging \n response: hello from mw2
```

**What the kernel proves:** The load-bearing bet runs in ~20 lines. The bet is: `next()` is a closure over a layer-array index; the app is just this traversal function. Strip Express from around this and you understand the remaining 1000 LOC as elaborations.

**Confusion test verdict (hypothetical Validator):** Does this describe Koa? No — Koa uses `async (ctx, next) => await next()` with a single context object; no `(err, req, res, next)` arity trick. Does it describe Fastify? No — Fastify is schema-first; the core is a JSON schema validator + serializer, not a middleware stack. Passes.

---

## Open Questions

1. **Archetype taxonomy**: Should Repo-DNA ship a formal archetype registry (framework, compiler, ORM, state manager, protocol…) with canonical reference genomes? This would make the Genome Agent much more reliable and enable objective baseline comparisons.

2. **Multi-bet repos**: How should the methodology handle systems where two or more bets are genuinely co-equal and neither can be reversed without breaking the other? (Example: React's fiber interruptibility AND host-agnosticism are possibly co-equal.) Current spec forces a ranking; an alternative is "bet cluster."

3. **Private/proprietary repos**: All examples are public repos. The methodology applies in principle to private codebases, but the kernel execution step requires a running environment with deps. A `--sketch-only` mode (no kernel requirement) might be needed.

4. **DNA drift detection**: Once a DNA file is committed, how do you know it's still accurate? A CI workflow that re-runs the confusion test on each commit to the source repo is technically possible but expensive. A lighter-weight heuristic: flag staleness if the hot files identified in the header have changed by more than N%.

5. **Fine-tuning vs prompting**: At what scale does it make sense to fine-tune a model on the existing DNA corpus (cognee, react, zustand, linux, etc.) versus continuing to prompt with the SKILL.md spec? The corpus is currently small (~15 files) but growing. A fine-tuned "DNA extractor" model could internalize the reference-genome-first discipline more reliably than a prompted one.

6. **Cross-language reference genomes**: The Genome Agent must produce language-specific reference genomes (e.g., "a competent Python ORM" vs "a competent Rust ORM" are meaningfully different). Does the archetype taxonomy need a language dimension?

7. **Validation ground truth**: The repo currently has ~15 DNA files. Are all of them correct? A structured human-review process (with a rubric based on the confusion test and rebuild test) would produce a ground-truth corpus that could drive automated evaluation of pipeline quality.

---

*Research conducted 2026-07-04. Web searches performed for repomix, gitingest, code2prompt, DeepWiki, Sourcegraph/Cody, architecture recovery (SSAR/CIAO/ArchAgent), ADR generation (AgenticAKM), and multi-agent repository exploration (SWE-Explore/RepoMaster). Repo files read: README.md, SKILL.md, REPO_DNA_PROMPT.md, cognee.dna.py, react.dna.js, OpenMontage.dna.py, zustand.dna.js.*
