/*
 * REPO-DNA: React
 * Source: https://github.com/react/react   Commit/Ref: 06b2a50
 * Archetype: UI library / reconciler (JS monorepo, Flow-typed)
 * The bet: reconciliation is an INTERRUPTIBLE computation over a mutable fiber
 *          tree, scheduled cooperatively by priority — render can pause, abort,
 *          and restart; only commit touches the host.
 *
 * This is not the repo. This is its variant fraction — what it does that its
 * peers do not.
 */

// ============================================================================
// REFERENCE GENOME  (the competent default for a VDOM UI library in JS —
// everything below must DEPART from this, or it is not DNA)
// ============================================================================
// A capable engineer ships: a createElement that returns a vnode tree, and a
// recursive render() that diffs new-vnode-vs-old-vnode and patches the DOM in one
// synchronous, uninterruptible walk from the root. State setters trigger a
// re-render of the subtree, also synchronously. The diff and the DOM writes live
// in the same pass; there is one renderer, and it is the DOM. (This is roughly
// Preact: correct, small, and synchronous.)


// ============================================================================
// THE LOAD-BEARING BET  (reverse it and React becomes "just another VDOM lib")
// ============================================================================
// Make the render walk PAUSABLE. Work is split into per-fiber units; a scheduler
// runs them in slices and asks shouldYield() between units; a higher-priority
// update throws the in-progress tree away and restarts. The host is never touched
// until a separate, synchronous commit. (Kernel verified-runnable; see
// react-reconciler/src/ReactFiberWorkLoop.js: workLoopConcurrentByScheduler.)

const host = {
  // The reconciler never names a host — a renderer supplies these (here: strings).
  createInstance: (t) => ({ t, children: [] }),
  appendChild: (p, c) => p.children.push(c),
  commit: (root) => serialize(root),
};
const serialize = (n) =>
  n.t + (n.children.length ? `(${n.children.map(serialize).join(",")})` : "");

const h = (t, ...kids) => ({ t, kids });
const APP = h("App", h("Header"), h("List", h("Item"), h("Item")));
const unitsOf = (el, acc = []) => (acc.push(el), el.kids.forEach((k) => unitsOf(k, acc)), acc);

let budget; // the scheduler's time slice: units allowed before we MUST yield
const shouldYield = () => budget-- <= 0;

function render(rootEl, priority) {
  // RENDER = producing half: builds a work-in-progress tree, pausable & pure.
  const wip = unitsOf(rootEl); // fresh WIP (fiber double-buffer: current.alternate)
  budget = priority === "high" ? 1e9 : 3;
  const built = host.createInstance(rootEl.t);
  for (let i = 0; i < wip.length; i++) {
    if (shouldYield()) return { done: false, at: i, total: wip.length }; // PAUSE
    if (i > 0) host.appendChild(built, host.createInstance(wip[i].t)); // beginWork
  }
  return { done: true, built };
}

function schedule() {
  // SCHEDULER drives render in slices; a high-pri update preempts and RESTARTS.
  console.log("lo-pri render starts…");
  const paused = render(APP, "low");
  console.log(`  yielded after ${paused.at}/${paused.total} units — render is pausable`);
  console.log("HIGH-PRI update arrives -> throw away in-progress work, restart");
  const finished = render(APP, "high"); // interruption: WIP discarded, redone
  console.log("  committed (consuming half, synchronous):", host.commit(finished.built));
}
// Runs as: yields after 3/5 units; restarts at high pri; commits App(Header,List,Item,Item).
if (require.main === module) schedule();


// ============================================================================
// SIGNATURE PATTERNS  (the recurring SNPs — sketches, faithful but need not run)
// ============================================================================

// SNP 1 — DOUBLE-BUFFERED fibers: work happens on an off-screen `alternate` tree,
// swapped to `current` only at commit — so an abandoned render leaves no trace.
//   react-reconciler/src/ReactFiber.js: createWorkInProgress
function createWorkInProgress(current, pendingProps) {
  let wip = current.alternate;                 // reuse the spare buffer if present
  if (wip === null) {
    wip = createFiber(current.tag, pendingProps, current.key, current.mode);
    wip.alternate = current;
    current.alternate = wip;                    // two fibers per element, forever paired
  }
  return wip;                                   // mutate THIS; `current` stays intact
}

// SNP 2 — Hooks resolve through a MUTABLE dispatcher, so `useState` has no logic of
// its own — the same call dispatches to mount-impl vs update-impl inside the
// reconciler. The `react` package ships hooks that are pure indirection.
//   react/src/ReactHooks.js + react-reconciler/src/ReactFiberHooks.js
function useState(initial) {
  const dispatcher = ReactSharedInternals.H;    // swapped per render phase
  return dispatcher.useState(initial);          // mount vs update lives elsewhere
}

// SNP 3 — Priority is a 31-bit LANES bitmask, not a number: many updates coexist,
// get batched/entangled by bitwise ops, and the scheduler renders the highest lane.
//   react-reconciler/src/ReactFiberLane.js
const NoLanes    = 0b0000000000000000000000000000000;
const SyncLane   = 0b0000000000000000000000000000010; // discrete input -> sync
const DefaultLane= 0b0000000000000000000000000100000; // normal updates
const mergeLanes = (a, b) => a | b;            // entanglement is just bitwise-or


// ============================================================================
// STRUCTURAL COMMITMENTS  (the two bets the rest is organized around)
// ============================================================================
// (1) THE HOST-AGNOSTIC BOUNDARY — the reconciler imports every host primitive
// from one module, `./ReactFiberConfig`, which is a BUILD-TIME fork: each renderer
// substitutes its own (DOM, Native, ART, test, noop). `react-reconciler` is itself
// a published package so anyone can supply a config and get React's full model.
//   react-reconciler/src/ReactFiberConfig (fork) <- ReactFiberConfigDOM.js, etc.
// sketch — resolved per renderer at BUILD time (kept as comment so it can't force
// ESM resolution and break the kernel above):
//   import { createInstance, appendInitialChild, commitUpdate, supportsMutation }
//     from "./ReactFiberConfig";   // the DOM build points this at ReactFiberConfigDOM.js
//   The `react` package itself touches NO host: grep `document.` in react/src ->
//   matches only in __tests__. React-the-library has no DOM in it.

// (2) THE RENDER/COMMIT SPLIT (both ends of the flow) — the producing half (render:
// beginWork/completeWork building fibers) is interruptible and side-effect-free; the
// consuming half (commit: commitMutationEffects then flushPassiveEffects) is one
// synchronous, un-interruptible pass where ALL host mutations happen.
//   react-reconciler/src/ReactFiberWorkLoop.js: workLoopConcurrentByScheduler + commitRoot
function workLoopConcurrentByScheduler() {       // render: stop the instant time's up
  while (workInProgress !== null && !shouldYield()) workInProgress = performUnitOfWork(workInProgress);
}
function commitRoot(root) {                       // commit: no yielding, host writes here
  commitMutationEffects(root);                    // DOM is mutated in this pass only
  requestPaint();
  scheduleCallback(flushPassiveEffects);          // effects after paint
}


// ============================================================================
// GROWTH SEAMS  (the actual extension surface)
// ============================================================================
// 1. New renderer: implement a HostConfig and call into `react-reconciler`
//    (react-dom, react-native, react-art, react-three-fiber all do exactly this).
// 2. New hook: compose existing hooks; or add a dispatcher method for a primitive.
// 3. New priority behavior: define a Lane and its scheduling in ReactFiberLane.js.
// 4. Suspense/lazy: throw a thenable during render; the reconciler retries the
//    boundary when it resolves — render's restartability IS the extension point.


// ============================================================================
// NEGATIVE SPACE  (deliberately LEFT OUT — common to the ecosystem, not DNA)
// ============================================================================
// - createElement / JSX / vnode shape — every VDOM library has this; reference genome.
// - Synthetic events, attribute/prop diffing, DOM property tables — react-dom detail,
//   not the cross-renderer identity.
// - Tree diffing / key-based child reconciliation — Preact, Vue, Inferno all diff too.
// - The monorepo's devtools / build (rollup, flow, www) packages — tooling, not DNA.
// - Server Components / Flight — a major bet, but a SEPARATE protocol layer; the core
//   identity below stands without it.
//
// Rebuild test: from this file a senior dev could reconstruct React's character —
//   "components are pure functions reconciled into a double-buffered fiber tree by an
//   interruptible, lane-prioritized scheduler; the reconciler is host-agnostic behind
//   a build-time config; render is pausable and pure, commit is synchronous and where
//   the host is touched; hooks are dispatcher indirection." Yes.
// Confusion test: strip the names and it still can't be Preact (which diffs
//   synchronously, no fiber, no scheduler) nor Vue/Solid (fine-grained reactivity, no
//   whole-tree re-render-and-diff). Only React re-renders top-down AND makes that walk
//   interruptible and restartable. Passes.
