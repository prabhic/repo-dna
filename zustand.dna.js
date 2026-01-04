/*
 * REPO-DNA: Zustand
 * Source: https://github.com/pmndrs/zustand
 * Identity: Provider-free state management through vanilla stores and selective subscriptions
 * 
 * This is not the repo. This is what makes the repo unique.
 */

// =============================================================================
// IDENTITY CORE: Vanilla Store - The Foundation
// =============================================================================
// What makes Zustand unique: State lives outside React in a vanilla JS store.
// No providers, no context, just a closure with listeners.

function createStore(createState) {
  let state;
  const listeners = new Set();

  const setState = (partial, replace) => {
    const nextState = 
      typeof partial === 'function' 
        ? partial(state) 
        : partial;
    
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = replace 
        ? nextState 
        : Object.assign({}, state, nextState);
      listeners.forEach((listener) => listener(state, previousState));
    }
  };

  const getState = () => state;

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const api = { setState, getState, subscribe };
  state = createState(setState, getState, api);
  
  return api;
}

// =============================================================================
// SIGNATURE PATTERN 1: Selector-Based Subscriptions
// =============================================================================
// Zustand's magic: Components subscribe only to state slices they need.
// Uses strict equality (old === new) by default for optimal re-renders.

function useStore(api, selector = (state) => state) {
  // Simplified useSyncExternalStore pattern
  const subscribe = (callback) => {
    return api.subscribe((state, prevState) => {
      const currentSlice = selector(state);
      const prevSlice = selector(prevState);
      if (!Object.is(currentSlice, prevSlice)) {
        callback();
      }
    });
  };

  const getSnapshot = () => selector(api.getState());

  // In real Zustand, this would be React.useSyncExternalStore
  // Here we simulate the concept
  return getSnapshot();
}

// =============================================================================
// SIGNATURE PATTERN 2: Hook Creation Pattern
// =============================================================================
// The "aha" moment: create() returns a hook that IS the store.
// No providers needed - the hook carries the store with it.

function create(createState) {
  const api = createStore(createState);
  
  // The returned function is both a hook AND has store methods
  const useBoundStore = (selector) => useStore(api, selector);
  
  // Attach store API to the hook itself
  Object.assign(useBoundStore, api);
  
  return useBoundStore;
}

// =============================================================================
// ARCHITECTURAL DNA: Immutable State Merging
// =============================================================================
// Key decision: setState merges by default (like React's setState)
// But allows full replacement with second parameter

const useCounterStore = create((set, get) => ({
  count: 0,
  
  // Pattern 1: Functional updates for accessing current state
  increment: () => set((state) => ({ count: state.count + 1 })),
  
  // Pattern 2: Direct object merging
  decrement: () => set({ count: get().count - 1 }),
  
  // Pattern 3: Full state replacement
  reset: () => set({ count: 0 }, true),
  
  // Pattern 4: Async actions (no special handling needed)
  incrementAsync: async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    set((state) => ({ count: state.count + 1 }));
  },
}));

// =============================================================================
// ARCHITECTURAL DNA: Transient Updates
// =============================================================================
// Zustand's superpower: Read state without causing re-renders

function TransientExample() {
  const usePositionStore = create((set) => ({
    x: 0,
    y: 0,
    setPosition: (x, y) => set({ x, y }),
  }));

  // Subscribe outside render cycle for high-frequency updates
  const handleMouseMove = (e) => {
    // Direct store access - no re-render
    usePositionStore.getState().setPosition(e.clientX, e.clientY);
  };

  // Only subscribe to what you render
  const x = usePositionStore((state) => state.x);
  
  return { x, handleMouseMove };
}

// =============================================================================
// EXTENSION POINT: Middleware Pattern
// =============================================================================
// How Zustand grows: Middleware wraps setState/getState to add behavior

const logger = (config) => (set, get, api) => 
  config(
    (...args) => {
      console.log('  applying', args);
      set(...args);
      console.log('  new state', get());
    },
    get,
    api
  );

const persist = (config, options) => (set, get, api) =>
  config(
    (...args) => {
      set(...args);
      localStorage.setItem(options.name, JSON.stringify(get()));
    },
    get,
    api
  );

// Middleware composition
const useStoreWithMiddleware = create(
  logger(
    persist(
      (set) => ({
        count: 0,
        inc: () => set((s) => ({ count: s.count + 1 })),
      }),
      { name: 'counter-storage' }
    )
  )
);

// =============================================================================
// THE "AHA" CODE: Complete Working Implementation
// =============================================================================
// This is the essence - everything above distilled into one working example

// 1. Create a store with actions
const useBearStore = create((set, get) => ({
  bears: 0,
  fish: 0,
  
  increasePopulation: () => set((state) => ({ 
    bears: state.bears + 1 
  })),
  
  removeAllBears: () => set({ bears: 0 }),
  
  addFish: () => set({ fish: get().fish + 1 }),
}));

// 2. Usage in components (conceptual - no React here)
function BearCounter() {
  // Select only what you need - component re-renders only when bears change
  const bears = useBearStore((state) => state.bears);
  return `${bears} around here...`;
}

function Controls() {
  // Select only the action - never re-renders (action reference is stable)
  const increasePopulation = useBearStore((state) => state.increasePopulation);
  return increasePopulation; // Would be used in onClick
}

// 3. Read state anywhere, anytime
console.log('Current bears:', useBearStore.getState().bears);

// 4. Subscribe to all changes
const unsubscribe = useBearStore.subscribe((state, prevState) => {
  console.log('Bears changed from', prevState.bears, 'to', state.bears);
});

// 5. Update state directly (outside React)
useBearStore.getState().increasePopulation();

// =============================================================================
// WHAT MAKES ZUSTAND UNIQUE
// =============================================================================

/*
1. NO PROVIDERS
   - State lives in a closure, not React context
   - Store is created once, accessed everywhere via the hook
   - No wrapper components needed

2. GRANULAR SUBSCRIPTIONS  
   - Components subscribe to specific state slices via selectors
   - Re-renders only when selected slice changes (strict equality)
   - Solves zombie child problem inherently

3. VANILLA CORE
   - Store is pure JavaScript, works without React
   - React integration is just a thin wrapper
   - Can use the same store in Node.js, React Native, etc.

4. ERGONOMIC API
   - create() returns a hook that IS the store
   - No dispatch, no action types, no reducers (unless you want them)
   - setState merges by default (familiar to React developers)

5. TRANSIENT UPDATES
   - getState() allows reading without subscribing
   - Perfect for high-frequency updates (mouse, scroll, etc.)
   - Something Redux/Context can't do efficiently

6. MIDDLEWARE AS EXTENSION
   - Simple function wrapping pattern
   - Compose multiple middleware easily
   - Community ecosystem of middleware (persist, immer, devtools)
*/

// =============================================================================
// COMPARISON: What Zustand is NOT
// =============================================================================

// NOT Redux:
const notRedux = create((set) => ({
  // No action types
  // No reducers required  
  // No dispatch function
  // Direct state updates
  value: 0,
  inc: () => set((s) => ({ value: s.value + 1 })),
}));

// NOT Context:
// - No Provider wrapper needed
// - No value prop drilling
// - Better performance (no context propagation)

// NOT MobX:
// - Immutable updates (not observables)
// - Explicit subscriptions (not automatic)
// - Simpler mental model

// NOT Jotai/Recoil:
// - Not atom-based
// - Single store per create() call
// - No dependency graph

// =============================================================================
// MENTAL MODEL
// =============================================================================

/*
Think of Zustand as:

   [Vanilla Store]  ←  Created once in module scope
          ↓
   [React Hook]     ←  Wraps store with useSyncExternalStore  
          ↓
   [Selector]       ←  Picks state slice for this component
          ↓
   [Equality Check] ←  Determines if re-render is needed
          ↓
   [Component]      ←  Renders with selected state

The store exists independently. The hook connects React to it.
This is why no providers are needed - the hook carries the store.
*/

// =============================================================================
// THE GENIUS MOVE
// =============================================================================

/*
Most state libraries:
  State → Provider → Context → Component

Zustand:
  State → Hook → Component
  
By making the hook the store (via closure and Object.assign),
Zustand eliminates the provider layer entirely. The store 
"travels" with the hook function itself.

This is the DNA: A vanilla store + a hook that IS that store.
Everything else is just ergonomics on top of this foundation.
*/

// =============================================================================
// REAL WORLD PATTERNS
// =============================================================================

// Pattern 1: Slices (Domain separation)
const createUserSlice = (set) => ({
  user: null,
  login: (user) => set({ user }),
  logout: () => set({ user: null }),
});

const createCartSlice = (set) => ({
  items: [],
  addItem: (item) => set((state) => ({ 
    items: [...state.items, item] 
  })),
});

const useAppStore = create((set, get) => ({
  ...createUserSlice(set),
  ...createCartSlice(set),
}));

// Pattern 2: Computed values (getters)
const useComputedStore = create((set, get) => ({
  items: [],
  // Not stored - computed on access
  get total() {
    return get().items.reduce((sum, item) => sum + item.price, 0);
  },
}));

// Pattern 3: Store as single source of truth
const useGlobalStore = create((set) => ({
  theme: 'light',
  user: null,
  notifications: [],
  // All app state in one place, if you want
}));

// =============================================================================
// IF YOU UNDERSTAND THIS, YOU UNDERSTAND ZUSTAND
// =============================================================================

const ZUSTAND_ESSENCE = create((set, get, api) => ({
  // State: Just an object
  state: { value: 0 },
  
  // Actions: Just functions that call set
  action: () => set({ value: 1 }),
  
  // Access the store itself
  store: api,
  
  // That's it. Really.
}));

// Use it:
const value = ZUSTAND_ESSENCE(state => state.value);

// Update it:
ZUSTAND_ESSENCE.getState().action();

// Subscribe to it:
ZUSTAND_ESSENCE.subscribe(console.log);

/*
The entire library in one sentence:
"A closure holding state, a Set holding listeners, and a hook that selects."
*/

export { create, createStore, useStore };
