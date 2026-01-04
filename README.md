# Repo-DNA

**Extracting the Genetic Code of Codebases**

Every repository exists because it offers something unique. Like DNA in biology—where each organism has a distinct genetic signature—every codebase has core patterns, design decisions, and architectural choices that define its identity. **Repo-DNA** captures this essence.

## What is Repo-DNA?

Repo-DNA is a methodology for distilling complex codebases into their fundamental essence—a single, working file that captures what makes a repository truly unique.

### What Repo-DNA is NOT:

- ❌ A code dump or concatenation for LLM context
- ❌ Documentation or explanation
- ❌ A tutorial or guide
- ❌ Generic patterns shared across many repos

### What Repo-DNA IS:

- ✅ The unique fingerprint of a specific codebase
- ✅ The "why this exists" and "what makes this different" in code form
- ✅ Core architectural decisions expressed as minimal, representative code
- ✅ The mental model a senior developer would carry after deeply understanding the codebase
- ✅ Eventually executable: someone could use this as a seed to rebuild the essence

## How It Works

Repo-DNA extracts five key elements:

1. **Identity Core**: The ONE unique insight or approach the repo embodies
2. **Signature Patterns**: The 2-3 code patterns that define how this codebase thinks
3. **Architectural DNA**: Key structural decisions (data flow, state management, module boundaries)
4. **Extension Points**: How the codebase expects to grow
5. **The "Aha" Code**: The function or class that unlocks understanding of the whole system

## Format

Each Repo-DNA file is:
- A single file, under 500 lines
- Working, syntactically valid code
- Minimal comments—code speaks for itself
- Named `{repo-name}.dna.js` (or appropriate extension)

## Examples in This Repository

This repository contains Repo-DNA extractions for popular frameworks:

- **react-*.js** - Various aspects of React's DNA (hooks, reducers, effects)

Each file demonstrates the core unique value proposition of the framework using minimal, working code.

## Generate Your Own Repo-DNA

Want to extract Repo-DNA for a repository? Use our agentic AI prompt:

👉 **[See REPO_DNA_PROMPT.md](./REPO_DNA_PROMPT.md)** for the complete prompt to give to an AI system.

### Quick Example:

```
Extract the Repo-DNA for: facebook/react
Extract the Repo-DNA for: vuejs/vue
Extract the Repo-DNA for: expressjs/express
```

## Goal

To provide an agentic framework that generates a single, working file for any GitHub repository—capturing the core unique value that makes the repo notable. These files should be:

- **Educational**: Help developers understand "what makes this special"
- **Working**: Syntactically valid and demonstrable
- **Essential**: Strip away everything except what makes it unique
- **Faithful**: Use similar patterns and dependencies as the original repo

## Use Cases

- 🎓 **Learning**: Quickly grasp what makes a framework unique
- 🔍 **Evaluation**: Compare architectural approaches across frameworks
- 🤖 **AI Context**: Provide focused context to AI coding assistants
- 📚 **Documentation**: Living code examples of core patterns
- 🚀 **Prototyping**: Use as seeds for building similar systems

## Contributing

Have a Repo-DNA extraction to share? PRs welcome! Make sure your DNA file:
- Captures what's UNIQUE, not what's COMMON
- Is working code under 500 lines
- Includes the standard header block
- Gives that "aha, now I get it" moment

---

*"This is not the repo. This is what makes the repo unique."* 
