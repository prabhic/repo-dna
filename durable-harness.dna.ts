/*
 * REPO-DNA: durable-harness
 * Source: https://github.com/vercel-labs/durable-harness   Commit/Ref: fb056a3c08549fdad9b87ed8358a27e2097ded11
 * Archetype: TypeScript durable coding-agent harness library / monorepo
 * The bet: A session's Workflow World event log is the source of truth for
 *          both its conversation and every model/tool effect; each invocation
 *          folds that log and resumes the same turn by replaying completed effects.
 *
 * This is not the repo. This is its variant fraction — what it does that its
 * peers do not.
 */

// ============================================================================
// REFERENCE GENOME  (the competent default for a TypeScript agent framework)
// ============================================================================
// A capable engineer would keep conversation history in application state,
// run a model/tool loop inside one request or worker, and persist snapshots
// between turns. A restart would reload the last snapshot and retry unfinished
// work, with bespoke logic to avoid duplicate tool calls. Hosting and tool
// execution would usually share the same process boundary.


// ============================================================================
// THE LOAD-BEARING BET
// ============================================================================
// A model or tool call is an effect with a stable key, a logged intent, and a
// logged outcome. Replaying a drive returns a completed outcome from the fold;
// it does not repeat the work. This toy kernel demonstrates recovery after a
// process disappears between tool completion and the next model call.

function fold(events) {
  const effects = new Map()
  for (const event of events) {
    if (event.eventType === 'step_started') {
      effects.set(event.key, { status: 'running', name: event.name, input: event.input, replay: event.replay })
    } else if (event.eventType === 'step_completed') {
      const effect = effects.get(event.key)
      if (effect) {
        effect.status = 'completed'
        effect.output = event.output
      }
    }
  }
  return effects
}

async function effect(events, key, name, input, run, replay = 'safe') {
  const prior = fold(events).get(key)
  if (prior?.status === 'completed') return prior.output
  if (prior?.status === 'running' && replay === 'never') {
    throw new Error(`interrupted non-replayable effect: ${key}`)
  }
  events.push({ eventType: 'step_started', key, name, input, replay })
  const output = await run()
  events.push({ eventType: 'step_completed', key, output })
  return output
}

async function runTurn(events, stopAfterTool = false) {
  const request = await effect(events, 'model:0', 'model', 'inspect notes', async () => ({
    tool: 'read',
    path: 'notes.md',
  }))
  const contents = await effect(events, 'tool:0', 'tool.read', request, async () => 'ship the small fix', 'never')
  if (stopAfterTool) return
  return effect(events, 'model:1', 'model', contents, async () => `Answer: ${contents}`)
}

async function demo() {
  const events = []
  let answer
  await runTurn(events, true)
  console.log('process lost after tool completion; committed effects:', fold(events).size)
  answer = await runTurn(events)
  console.log('recovered:', answer)
  console.log('model calls:', events.filter((e) => e.eventType === 'step_started' && e.name === 'model').length)
  console.log('tool calls:', events.filter((e) => e.eventType === 'step_started' && e.name === 'tool.read').length)
  try {
    await effect([{ eventType: 'step_started', key: 'tool:uncertain', name: 'tool.write', replay: 'never' }],
      'tool:uncertain', 'tool.write', {}, async () => 'must not run', 'never')
  } catch {
    console.log('ambiguous write re-run: blocked')
  }
}

demo()


// ============================================================================
// SIGNATURE PATTERNS
// ============================================================================

// SNP 1 — A replay policy makes uncertainty explicit: safe work may be retried;
// work marked never is not blindly repeated after an interrupted execution.
function callTool(ctx, tool, input) {
  return ctx.effect(`tool:${tool.name}:${input.callId}`, {
    name: `tool.${tool.name}`,
    replay: tool.replay ?? 'never',
    input,
  }, (io) => tool.execute(input, io))
}

// SNP 2 — Pi's transcript is a fold of model-step inputs and outputs; recovery
// rebuilds Pi at the last model call, memo-replays it, then continues the turn.
function restorePi(state) {
  const models = state.effectOrder.filter((step) => step.name === 'model')
  const transcript = []
  for (const [index, step] of models.entries()) {
    transcript.push(...step.input.appended)
    if (index < models.length - 1) transcript.push(step.output)
  }
  return { transcript, resumeAt: models.length ? models.length - 1 : 0 }
}

// SNP 3 — Effects declare capabilities, so a lane handoff is committed before
// the effect runs instead of assuming every tool belongs on the current host.
const laneNeeds = {
  browser: ['workspace', 'gateway'],
  function: ['workspace', 'gateway', 'secrets'],
  sandbox: ['workspace', 'gateway', 'machine'],
}


// ============================================================================
// STRUCTURAL COMMITMENTS
// ============================================================================

// (1) SESSION STATE IS A PURE FOLD — submissions, effect records, transcript
//     placement, and handoff epochs are derived from ordered World events.
//     The fold arbitrates races: first writer per effect key wins, stale epoch
//     writes are fenced, and late outcomes for resolved steps are inert.
//     The harness sees state and ctx.effect, never raw event-log semantics.
//
// (2) THE WORLD OWNS RECOVERY — one run per session, a private queue namespace,
//     and a flow consumer dispatch deliveries to the registered harness.
//     Starting a World re-enqueues sessions left mid-turn; any process can
//     continue from the log rather than relying on the original request.
//
// (3) THE HOST IS NOT THE TOOL MACHINE — model-selected commands and files run
//     in a virtual workspace or a session's Vercel Sandbox, not on the shared
//     Function's filesystem, processes, or environment.
function executeInWorkspace(workspace, command) {
  return workspace.exec(command)
}


// ============================================================================
// GROWTH SEAMS
// ============================================================================
// 1. Harness adapters: implement { name, drive(ctx) } and express durable work
//    with ctx.effect; built-ins adapt Pi, fx, Claude Code, Codex, and OpenCode.
// 2. World adapters: select the environment's World or provide another World
//    for storage, queue delivery, and recovery.
// 3. Tool surface: harness-neutral HostTools and virtual()/sandbox() workspace
//    adapters let the same agent logic use isolated execution environments.
// 4. Capability lanes: declare needs and lane wake handlers to move work among
//    browser, Function, and Sandbox execution contexts.


// ============================================================================
// NEGATIVE SPACE  (deliberately LEFT OUT — common to the ecosystem, not DNA)
// ============================================================================
// - Provider/model selection and ordinary prompt construction — adapter concerns.
// - Chat routes, SSE, and framework deployment wiring — transport surfaces.
// - A general-purpose workflow DSL — the durable unit here is an agent effect.
// - A specific database or queue backend — the World owns those primitives.
// - Coding-agent prompts, tool catalogs, and UI — supplied by integrations.
//
// Rebuild test: a senior developer can reconstruct the core: sessions are
//   event-log-backed runs; each effect is keyed and outcome-memoized; recovery
//   folds the log and resumes the adapter's in-flight turn on a World.
//   Yes.
//
// Confusion test: stripped of names, this is not merely a checkpointed agent
//   graph or a generic workflow engine. Its identity is adapter-level resumption
//   of model/tool turns from one effect log, with explicit no-repeat policy and
//   capability-based movement between isolated execution lanes. Passes.
