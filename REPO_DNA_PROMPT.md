# Repo-DNA Generator Prompt

## Usage

Give this prompt to an agentic AI system along with a repository name to generate the Repo-DNA file.

---

## Prompt

```
You are a Repo-DNA extractor. Your task is to distill the unique genetic code of a codebase into a single, graspable file.

## What is Repo-DNA?

Every repository exists because it offers something unique. Like DNA in biology—where each organism has a distinct genetic signature—every codebase has core patterns, design decisions, and architectural choices that define its identity. Repo-DNA captures this essence.

## What Repo-DNA is NOT:

- NOT a code dump or concatenation for LLM context
- NOT documentation or explanation
- NOT a tutorial or guide
- NOT generic patterns shared across many repos

## What Repo-DNA IS:

- The unique fingerprint of this specific codebase
- The "why this exists" and "what makes this different" in code form
- Core architectural decisions expressed as minimal, representative code
- The mental model a senior developer would carry after deeply understanding the codebase
- Eventually executable: someone could use this as a seed to rebuild the essence

## Your Task:

Given the repository: {REPO_NAME}

Generate a single file (`{repo-name}.dna.js` or appropriate extension) that captures:

1. **Identity Core**: What is the ONE unique insight or approach this repo embodies? Express it in code, not comments.

2. **Signature Patterns**: The 2-3 code patterns that appear repeatedly and define how this codebase thinks. Not common patterns—patterns unique to THIS repo.

3. **Architectural DNA**: The key structural decisions (data flow, state management, module boundaries) as minimal working code.

4. **Extension Points**: How does this codebase expect to grow? Show the seams.

5. **The "Aha" Code**: The single function or class that, once understood, unlocks understanding of the whole system.

## Format:

- Single file, under 500 lines
- Working code, not pseudocode (it should be syntactically valid)
- Minimal comments—let code speak
- Include a header block:

/*
 * REPO-DNA: {Repository Name}
 * Source: {GitHub URL}
 * Identity: {One-line essence}
 * 
 * This is not the repo. This is what makes the repo unique.
 */

## Quality Check:

Ask yourself:
- If I deleted the original repo, could a senior dev rebuild its essence from this DNA?
- Does this capture what's UNIQUE, not what's COMMON?
- Would reading this give an "aha, now I get what this framework is about" moment?

Now extract the Repo-DNA for: {REPO_NAME}
```

---

## Example Usage

```
Extract the Repo-DNA for: facebook/react
```

```
Extract the Repo-DNA for: vuejs/vue
```

```
Extract the Repo-DNA for: expressjs/express
```
