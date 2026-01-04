/*
 * REPO-DNA: TanStack Query
 * Source: https://github.com/TanStack/query
 * Identity: Async state management through intelligent caching, automatic refetching, and observer-based subscriptions
 * 
 * This is not the repo. This is what makes the repo unique.
 */

// =============================================================================
// IDENTITY CORE: Server State is Different from Client State
// =============================================================================
// TanStack Query's insight: Server state needs different primitives.
// It's async, shared, stale-able, and needs synchronization.

class Query {
  constructor(config) {
    this.queryKey = config.queryKey;
    this.queryHash = config.queryHash;
    this.queryFn = config.options?.queryFn;
    this.observers = [];
    this.state = {
      data: undefined, dataUpdatedAt: 0, error: null, errorUpdatedAt: 0,
      fetchFailureCount: 0, fetchStatus: 'idle', status: 'pending', isInvalidated: false
    };
    this.promise = null;
    this.gcTime = config.options?.gcTime ?? 5 * 60 * 1000;
  }

  fetch(options = {}) {
    if (this.state.fetchStatus !== 'idle' && this.promise && !options.cancelRefetch) {
      return this.promise; // Deduplication
    }

    this.promise = createRetryer({
      fn: () => this.queryFn({ queryKey: this.queryKey, signal: new AbortController().signal }),
      onSuccess: (data) => this.dispatch({ type: 'success', data }),
      onError: (error) => this.dispatch({ type: 'error', error }),
      onFail: (failureCount, error) => this.dispatch({ type: 'failed', failureCount, error }),
      retry: this.options?.retry ?? 3,
    });

    this.dispatch({ type: 'fetch' });
    return this.promise;
  }

  dispatch(action) {
    this.state = this.reducer(this.state, action);
    this.observers.forEach(observer => observer.onQueryUpdate());
  }

  reducer(state, action) {
    switch (action.type) {
      case 'fetch': return { ...state, fetchStatus: 'fetching' };
      case 'success': return { 
        ...state, data: action.data, dataUpdatedAt: Date.now(), error: null,
        status: 'success', fetchStatus: 'idle', fetchFailureCount: 0, isInvalidated: false 
      };
      case 'error': return { 
        ...state, error: action.error, errorUpdatedAt: Date.now(), 
        status: 'error', fetchStatus: 'idle' 
      };
      case 'failed': return { ...state, fetchFailureCount: action.failureCount };
      case 'invalidate': return { ...state, isInvalidated: true };
      default: return state;
    }
  }

  addObserver(observer) { if (!this.observers.includes(observer)) this.observers.push(observer); }
  removeObserver(observer) { this.observers = this.observers.filter(o => o !== observer); }
  setOptions(options) { this.options = options; } // Update query configuration
}

// =============================================================================
// SIGNATURE PATTERN 1: QueryCache - Central Registry
// =============================================================================
// Every query cached by key. Enables deduplication, sharing, and GC.

class QueryCache {
  constructor(config = {}) {
    this.queries = new Map();
    this.config = config;
    this.listeners = new Set();
  }

  build(client, options, state) {
    const queryHash = this.hashQueryKey(options.queryKey);
    let query = this.queries.get(queryHash);
    
    if (!query) {
      query = new Query({ client, queryKey: options.queryKey, queryHash, options, state });
      this.add(query);
    } else {
      query.setOptions(options);
    }
    return query;
  }

  add(query) {
    if (!this.queries.has(query.queryHash)) {
      this.queries.set(query.queryHash, query);
      this.notify({ type: 'added', query });
      setTimeout(() => { if (query.observers.length === 0) this.remove(query); }, query.gcTime);
    }
  }

  remove(query) {
    if (this.queries.has(query.queryHash)) {
      this.queries.delete(query.queryHash);
      this.notify({ type: 'removed', query });
    }
  }

  hashQueryKey(queryKey) {
    return JSON.stringify(queryKey, (_, val) =>
      typeof val === 'object' && val !== null
        ? Object.keys(val).sort().reduce((r, k) => (r[k] = val[k], r), {})
        : val
    );
  }

  findAll(filters = {}) {
    const queries = Array.from(this.queries.values());
    if (!filters.queryKey) return queries;
    
    return queries.filter(q => {
      if (filters.exact) return this.hashQueryKey(q.queryKey) === this.hashQueryKey(filters.queryKey);
      return filters.queryKey.every((item, i) => q.queryKey[i] === item);
    });
  }

  notify(event) { this.listeners.forEach(l => l(event)); }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// =============================================================================
// SIGNATURE PATTERN 2: QueryObserver - Bridge to UI
// =============================================================================
// Connects queries to components. Handles subscription, selective re-rendering, refetching.

class QueryObserver {
  constructor(client, options) {
    this.client = client;
    this.options = options;
    this.listeners = new Set();
    this.currentQuery = null;
    this.currentResult = null;
    this.updateQuery();
  }

  updateQuery() {
    const query = this.client.queryCache.build(this.client, this.options);
    if (query === this.currentQuery) return;
    
    const prevQuery = this.currentQuery;
    this.currentQuery = query;
    if (prevQuery) prevQuery.removeObserver(this);
    query.addObserver(this);
  }

  onQueryUpdate() {
    this.updateResult();
    this.notify();
  }

  updateResult() {
    const { data, error, status, fetchStatus } = this.currentQuery.state;
    this.currentResult = {
      data, error, status, fetchStatus,
      isLoading: status === 'pending' && fetchStatus === 'fetching',
      isSuccess: status === 'success',
      isError: status === 'error',
      isFetching: fetchStatus === 'fetching',
      isStale: this.isStale(),
      refetch: this.refetch.bind(this),
    };
  }

  isStale() {
    const staleTime = this.options.staleTime ?? 0;
    return this.currentQuery.state.dataUpdatedAt === 0 || 
           Date.now() - this.currentQuery.state.dataUpdatedAt > staleTime;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    
    if (this.listeners.size === 1) {
      this.currentQuery.addObserver(this);
      if (this.shouldFetchOnMount()) this.executeFetch();
      this.updateRefetchInterval();
    }
    
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.destroy();
    };
  }

  shouldFetchOnMount() {
    return this.options.enabled !== false && this.isStale();
  }

  executeFetch() { this.currentQuery.fetch(); }
  refetch(options) { return this.currentQuery.fetch({ ...options, cancelRefetch: true }); }

  updateRefetchInterval() {
    const interval = this.options.refetchInterval;
    if (interval && interval > 0) {
      this.refetchIntervalId = setInterval(() => {
        if (this.options.enabled !== false) this.executeFetch();
      }, interval);
    }
  }

  notify() { this.listeners.forEach(l => l(this.currentResult)); }
  
  setOptions(options) { this.options = options; this.updateQuery(); }
  
  destroy() {
    clearInterval(this.refetchIntervalId);
    this.currentQuery?.removeObserver(this);
  }
}

// =============================================================================
// SIGNATURE PATTERN 3: Smart Retry with Exponential Backoff
// =============================================================================

function createRetryer(config) {
  let failureCount = 0, isRetryCancelled = false;
  const retry = config.retry ?? 3;
  
  function run() {
    if (isRetryCancelled) return Promise.reject(new Error('Cancelled'));
    
    return config.fn().then(
      data => (config.onSuccess?.(data), data),
      error => {
        failureCount++;
        config.onFail?.(failureCount, error);
        
        const shouldRetry = typeof retry === 'function' ? retry(failureCount, error) : failureCount <= retry;
        if (!shouldRetry) return (config.onError?.(error), Promise.reject(error));
        
        const delay = Math.min(1000 * 2 ** failureCount, 30000);
        return new Promise(resolve => setTimeout(resolve, delay)).then(() => run());
      }
    );
  }
  
  return { promise: run(), cancel: () => { isRetryCancelled = true; } };
}

// =============================================================================
// ARCHITECTURAL DNA: QueryClient - The Public API
// =============================================================================

class QueryClient {
  constructor(config = {}) {
    this.queryCache = config.queryCache || new QueryCache();
    this.mutationCache = config.mutationCache || new MutationCache();
    this.defaultOptions = config.defaultOptions || {};
  }

  fetchQuery(options) {
    const query = this.queryCache.build(this, options);
    return query.state.data !== undefined && !query.state.isInvalidated
      ? Promise.resolve(query.state.data)
      : query.fetch();
  }

  prefetchQuery(options) {
    return this.fetchQuery(options).catch(() => {});
  }

  getQueryData(queryKey) {
    const queryHash = this.queryCache.hashQueryKey(queryKey);
    return this.queryCache.queries.get(queryHash)?.state.data;
  }

  setQueryData(queryKey, updater) {
    const queryHash = this.queryCache.hashQueryKey(queryKey);
    const query = this.queryCache.queries.get(queryHash);
    if (!query) return undefined;
    
    const prevData = query.state.data;
    const data = typeof updater === 'function' ? updater(prevData) : updater;
    query.dispatch({ type: 'success', data });
    return data;
  }

  invalidateQueries(filters) {
    this.queryCache.findAll(filters).forEach(query => {
      query.dispatch({ type: 'invalidate' });
      if (query.observers.length > 0) query.fetch();
    });
  }

  removeQueries(filters) {
    this.queryCache.findAll(filters).forEach(q => this.queryCache.remove(q));
  }
  
  cancelQueries(filters) {
    // Cancel in-flight queries (simplified for DNA)
    this.queryCache.findAll(filters).forEach(q => {
      if (q.promise) q.promise = null;
    });
  }
}

// =============================================================================
// EXTENSION POINTS: Framework Adapters
// =============================================================================
// Core is framework-agnostic. Adapters wrap QueryObserver with framework primitives.
// Note: React import omitted for clarity - this shows the pattern, not full implementation

function useQuery(options, queryClient) {
  // const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  // const observerRef = React.useRef(null);
  
  // Conceptual React integration pattern:
  // 1. Create observer once
  const observer = new QueryObserver(queryClient, options);
  
  // 2. Subscribe to changes and trigger re-render
  observer.subscribe(() => {
    // forceUpdate() - trigger component re-render
  });
  
  // 3. Update options on each render
  observer.setOptions(options);
  
  // 4. Return current result
  return observer.currentResult;
}

// =============================================================================
// THE "AHA" CODE: Subscribable Pattern
// =============================================================================
// Everything is Subscribable. Creates reactive data flow where UI updates automatically.

class Subscribable {
  constructor() { this.listeners = new Set(); }
  
  subscribe(listener) {
    this.listeners.add(listener);
    this.onSubscribe?.();
    return () => { this.listeners.delete(listener); this.onUnsubscribe?.(); };
  }
  
  hasListeners() { return this.listeners.size > 0; }
}

// Query, QueryObserver, QueryCache all extend Subscribable

// =============================================================================
// KEY INSIGHT: Optimistic Updates
// =============================================================================

class MutationCache {
  constructor() { this.mutations = []; }
}

function useMutation(options, queryClient) {
  return {
    mutate: async (variables) => {
      const queryKey = options.queryKey;
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData(queryKey);
      
      if (options.onMutate) {
        const rollback = await options.onMutate(variables);
        
        try {
          const data = await options.mutationFn(variables);
          queryClient.setQueryData(queryKey, data);
          options.onSuccess?.(data, variables);
          return data;
        } catch (error) {
          queryClient.setQueryData(queryKey, previousData);
          options.onError?.(error, variables, rollback);
          throw error;
        } finally {
          queryClient.invalidateQueries({ queryKey });
        }
      }
    },
  };
}

// =============================================================================
// KEY INSIGHT: Structural Sharing
// =============================================================================
// Deeply compares data to prevent unnecessary re-renders.

function replaceEqualDeep(prev, next) {
  if (prev === next) return prev;
  
  const type = Object.prototype.toString.call(prev);
  if (type !== Object.prototype.toString.call(next)) return next;
  
  if (type === '[object Object]') {
    const result = { ...next };
    let hasChange = false;
    
    for (const key in result) {
      result[key] = replaceEqualDeep(prev[key], next[key]);
      if (result[key] !== prev[key]) hasChange = true;
    }
    return hasChange ? result : prev;
  }
  
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) return next;
    const result = [...next];
    let hasChange = false;
    
    for (let i = 0; i < result.length; i++) {
      result[i] = replaceEqualDeep(prev[i], next[i]);
      if (result[i] !== prev[i]) hasChange = true;
    }
    return hasChange ? result : prev;
  }
  
  return next;
}

// =============================================================================
// USAGE EXAMPLE: The Complete Picture
// =============================================================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,      // 1 minute
      gcTime: 5 * 60 * 1000,     // 5 minutes
      retry: 3,
      refetchOnWindowFocus: true,
    },
  },
});

// In a React component:
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['todos'],
  queryFn: async () => {
    const response = await fetch('/api/todos');
    return response.json();
  },
  staleTime: 5 * 60 * 1000,
}, queryClient);

// Invalidate after mutation:
queryClient.invalidateQueries({ queryKey: ['todos'] });

// This is TanStack Query's DNA: A reactive caching layer that treats async
// state as a first-class citizen, with automatic lifecycle management,
// intelligent refetching, and seamless UI synchronization.
