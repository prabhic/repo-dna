/*
 * REPO-DNA: React
 * Source: https://github.com/facebook/react
 * Identity: Declarative UI through virtual DOM reconciliation and component composition
 * 
 * This is not the repo. This is what makes the repo unique.
 */

// =============================================================================
// IDENTITY CORE: Virtual DOM & Reconciliation
// =============================================================================
// React's unique approach: UI as a function of state, reconciled efficiently
// through a virtual representation that minimizes real DOM operations.

function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map(child =>
        typeof child === 'object' ? child : createTextElement(child)
      ),
    },
  };
}

function createTextElement(text) {
  return {
    type: 'TEXT_ELEMENT',
    props: { nodeValue: text, children: [] },
  };
}

// =============================================================================
// SIGNATURE PATTERN 1: JSX Transformation
// =============================================================================
// JSX: <div id="foo">Hello</div> → createElement('div', {id: 'foo'}, 'Hello')

const JSX_EXAMPLE = createElement(
  'div', { id: 'container' },
  createElement('h1', null, 'Hello React'),
  createElement('p', null, 'This is the DNA')
);

// =============================================================================
// ARCHITECTURAL DNA: Fiber - The Work Unit
// =============================================================================
// React's secret: Break rendering into interruptible units (Fibers)

function createFiber(element, parent) {
  return {
    type: element.type,
    props: element.props,
    parent, child: null, sibling: null,
    alternate: null,    // Previous fiber for diffing
    effectTag: null,    // PLACEMENT, UPDATE, DELETION
    dom: null, hooks: null,
  };
}

// =============================================================================
// SIGNATURE PATTERN 2: Reconciliation Algorithm
// =============================================================================
// Compare old and new trees, compute minimal changes.
// Same type = update, different type = replace

function reconcileChildren(wipFiber, elements) {
  let index = 0;
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let prevSibling = null;

  while (index < elements.length || oldFiber != null) {
    const element = elements[index];
    let newFiber = null;
    const sameType = oldFiber && element && element.type === oldFiber.type;

    if (sameType) {
      newFiber = {
        type: oldFiber.type, props: element.props, dom: oldFiber.dom,
        parent: wipFiber, alternate: oldFiber, effectTag: 'UPDATE',
      };
    }
    if (element && !sameType) {
      newFiber = {
        type: element.type, props: element.props, dom: null,
        parent: wipFiber, alternate: null, effectTag: 'PLACEMENT',
      };
    }
    if (oldFiber && !sameType) {
      oldFiber.effectTag = 'DELETION';
      deletions.push(oldFiber);
    }

    if (oldFiber) oldFiber = oldFiber.sibling;
    if (index === 0) wipFiber.child = newFiber;
    else if (element) prevSibling.sibling = newFiber;
    
    prevSibling = newFiber;
    index++;
  }
}

// =============================================================================
// ARCHITECTURAL DNA: Work Loop & Scheduling
// =============================================================================
// React's superpower: Interruptible rendering via requestIdleCallback

let nextUnitOfWork = null;
let currentRoot = null;
let wipRoot = null;
let deletions = null;

function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }
  if (!nextUnitOfWork && wipRoot) commitRoot();
  requestIdleCallback(workLoop);
}

function performUnitOfWork(fiber) {
  const isFunctionComponent = fiber.type instanceof Function;
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  if (fiber.child) return fiber.child;
  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) return nextFiber.sibling;
    nextFiber = nextFiber.parent;
  }
}

function updateHostComponent(fiber) {
  if (!fiber.dom) fiber.dom = createDom(fiber);
  reconcileChildren(fiber, fiber.props.children);
}

function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];
  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

// =============================================================================
// SIGNATURE PATTERN 3: Hooks - State in Function Components
// =============================================================================
// React's innovation: State in functions via closure and fiber storage

let wipFiber = null;
let hookIndex = null;

function useState(initial) {
  const oldHook = wipFiber.alternate?.hooks?.[hookIndex];
  const hook = { state: oldHook ? oldHook.state : initial, queue: [] };

  const actions = oldHook ? oldHook.queue : [];
  actions.forEach(action => { hook.state = action(hook.state); });

  const setState = action => {
    hook.queue.push(action);
    wipRoot = { dom: currentRoot.dom, props: currentRoot.props, alternate: currentRoot };
    nextUnitOfWork = wipRoot;
    deletions = [];
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

function useEffect(callback, deps) {
  const oldHook = wipFiber.alternate?.hooks?.[hookIndex];
  const hasChanged = !oldHook || !deps || deps.some((dep, i) => dep !== oldHook.deps[i]);
  const hook = {
    callback: hasChanged ? callback : oldHook.callback,
    deps,
    cleanup: oldHook?.cleanup,
  };

  if (hasChanged) {
    if (hook.cleanup) hook.cleanup();
    hook.cleanup = callback();
  }

  wipFiber.hooks.push(hook);
  hookIndex++;
}

// =============================================================================
// ARCHITECTURAL DNA: Commit Phase
// =============================================================================
// Two-phase rendering: Render (interruptible) → Commit (synchronous)
// Ensures UI consistency - all changes applied at once

function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
}

function commitWork(fiber) {
  if (!fiber) {
    return;
  }

  // Find parent DOM node (skip function components)
  let domParentFiber = fiber.parent;
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  const domParent = domParentFiber.dom;

  if (fiber.effectTag === 'PLACEMENT' && fiber.dom != null) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === 'UPDATE' && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  } else if (fiber.effectTag === 'DELETION') {
    commitDeletion(fiber, domParent);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitDeletion(fiber, domParent) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child, domParent);
  }
}

// =============================================================================
// SIGNATURE PATTERN 4: Props Diffing & DOM Updates
// =============================================================================
// React's optimization: Only update changed properties

const isEvent = key => key.startsWith('on');
const isProperty = key => key !== 'children' && !isEvent(key);
const isNew = (prev, next) => key => prev[key] !== next[key];
const isGone = (prev, next) => key => !(key in next);

function updateDom(dom, prevProps, nextProps) {
  // Remove old event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(key => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      dom[name] = '';
    });

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      dom[name] = nextProps[name];
    });

  // Add new event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });
}

function createDom(fiber) {
  const dom =
    fiber.type === 'TEXT_ELEMENT'
      ? document.createTextNode('')
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);
  return dom;
}

// =============================================================================
// EXTENSION POINT: Custom Hooks Pattern
// =============================================================================
// How React grows: Compose hooks to create reusable stateful logic

function useCustomHook(key, initialValue) {
  const [state, setState] = useState(initialValue);
  useEffect(() => {
    // Custom logic combining multiple hooks
    const stored = localStorage.getItem(key);
    if (stored) setState(JSON.parse(stored));
  }, [key]);
  return [state, (value) => {
    setState(value);
    localStorage.setItem(key, JSON.stringify(value));
  }];
}

// =============================================================================
// THE "AHA" CODE: Complete Working Example
// =============================================================================
// This demonstrates the entire React philosophy in action

function Counter() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('React');

  useEffect(() => {
    document.title = `${name}: ${count}`;
    return () => {
      document.title = 'React DNA';
    };
  }, [count, name]);

  return createElement(
    'div',
    null,
    createElement('h1', null, `${name} Counter`),
    createElement('p', null, `Count: ${count}`),
    createElement(
      'button',
      { onClick: () => setCount(c => c + 1) },
      'Increment'
    ),
    createElement(
      'input',
      {
        value: name,
        onInput: (e) => setName(e.target.value)
      }
    )
  );
}

// Render function: The public API
function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

// Start the work loop
requestIdleCallback(workLoop);

// Usage:
// render(createElement(Counter), document.getElementById('root'));

// =============================================================================
// WHAT MAKES REACT UNIQUE
// =============================================================================

/*
1. DECLARATIVE UI: UI = f(state) - describe what, not how
2. VIRTUAL DOM & RECONCILIATION: Diff old/new trees for minimal DOM updates
3. FIBER ARCHITECTURE: Interruptible rendering units with priority scheduling
4. COMPONENT COMPOSITION: Small reusable pieces with unidirectional data flow
5. HOOKS: State and lifecycle in functions, composable stateful logic
6. SYNTHETIC EVENTS: Cross-browser normalization with event delegation
*/

// NOT Vue (templates), Angular (framework), Svelte (compile-time), jQuery (imperative)

// =============================================================================
// MENTAL MODEL
// =============================================================================

/*
React mental model: Component Tree → Virtual DOM → Fiber Tree → 
Reconciliation → Effect List → Commit → Real DOM

State change flow: setState → Schedule work → Reconcile → Commit → DOM update
*/

// =============================================================================
// THE GENIUS MOVES
// =============================================================================

/*
Key innovations:
1. JSX - Write markup in JS with compile-time transformation
2. One-way data flow - Props down, events up
3. Reconciliation - Keys for identity, type-based diffing
4. Fiber - Incremental rendering with pause/resume
5. Hooks - Stateful logic without classes
*/

// =============================================================================
// REAL WORLD PATTERNS
// =============================================================================

// Pattern 1: Render Props
function DataProvider({ render }) {
  const [data, setData] = useState(null);
  useEffect(() => { /* fetch data */ }, []);
  return render(data);
}

// Pattern 2: Higher-Order Components
function withLoading(Component) {
  return function({ isLoading, ...props }) {
    return isLoading ? createElement('div', null, 'Loading...') : createElement(Component, props);
  };
}

// Pattern 3: Context - Provider/Consumer for prop drilling avoidance

// =============================================================================
// IF YOU UNDERSTAND THIS, YOU UNDERSTAND REACT
// =============================================================================

const REACT_ESSENCE = {
  // 1. UI as a function
  render: (state) => createElement('div', null, state.value),
  
  // 2. State updates trigger reconciliation
  setState: (newState) => {
    // Schedule work by creating a new root fiber
    nextUnitOfWork = createFiber(REACT_ESSENCE.render(newState), null);
  },
  
  // 3. Reconciliation computes minimal DOM changes (conceptual)
  // In actual implementation, reconcileChildren does this
  
  // 4. Commit applies changes synchronously (conceptual)
  // In actual implementation, commitRoot and commitWork do this
};

/*
The entire library in one sentence:
"UI is a pure function of state, reconciled incrementally via a virtual 
 representation, and committed synchronously to the DOM."
*/

export { createElement, render, useState, useEffect };
