/*
 * REPO-DNA: Vite
 * Source: https://github.com/vitejs/vite
 * Identity: Native ESM dev server with on-demand compilation and instant HMR
 * 
 * This is not the repo. This is what makes the repo unique.
 */

// =============================================================================
// IDENTITY CORE: Native ESM + On-Demand Transform
// =============================================================================
// Vite's revelation: Skip bundling in dev. Serve native ESM, transform on request.

class ViteDevServer {
  constructor(config) {
    this.config = config;
    this.moduleGraph = new ModuleGraph();
    this.pluginContainer = new PluginContainer(config.plugins);
  }

  async handleRequest(url) {
    if (!this.shouldTransform(url)) return null;
    
    const mod = await this.moduleGraph.getModuleByUrl(url);
    if (mod?.transformResult) return mod.transformResult;
    
    const file = url.replace(/^\//, this.config.root + '/');
    const code = await require('fs').promises.readFile(file, 'utf-8');
    const transformed = await this.pluginContainer.transform(code, file);
    
    this.moduleGraph.updateModuleInfo(url, { 
      file, transformResult: transformed,
      importedModules: code.match(/from\s+['"](.+?)['"]/g) || []
    });
    
    return transformed;
  }

  shouldTransform(url) { return /\.(js|ts|jsx|tsx|vue|svelte)$/.test(url); }
}

// =============================================================================
// SIGNATURE PATTERN 1: Dependency Pre-Bundling with esbuild
// =============================================================================
// Vite's speed: Pre-bundle deps with esbuild (100x faster), convert CJS to ESM

async function optimizeDeps(deps, config) {
  await require('esbuild').build({
    entryPoints: deps,
    bundle: true,
    format: 'esm',
    outdir: config.cacheDir,
    splitting: true
  });

  return deps.reduce((acc, dep) => {
    acc[dep] = `/.vite/deps/${dep}.js`;
    return acc;
  }, {});
}

// =============================================================================
// SIGNATURE PATTERN 2: Plugin Container (Rollup-Compatible)
// =============================================================================
// Vite's extensibility: Rollup plugin API works in both dev and build

class PluginContainer {
  constructor(plugins = []) { this.plugins = plugins; }

  async transform(code, id) {
    for (const plugin of this.plugins) {
      if (!plugin.transform) continue;
      const result = await plugin.transform.call({ meta: {} }, code, id);
      if (result) code = typeof result === 'string' ? result : result.code;
    }
    return { code, map: null };
  }
}

// =============================================================================
// ARCHITECTURAL DNA: Module Graph
// =============================================================================
// Track dependencies, enable precise HMR

class ModuleGraph {
  constructor() {
    this.urlToModule = new Map();
  }

  async getModuleByUrl(url) {
    return this.urlToModule.get(url);
  }

  updateModuleInfo(url, info) {
    let mod = this.urlToModule.get(url);
    if (!mod) {
      mod = { url, importers: new Set(), importedModules: new Set() };
      this.urlToModule.set(url, mod);
    }
    Object.assign(mod, info);
    return mod;
  }

  invalidateModule(mod) {
    mod.transformResult = null;
    const affected = new Set([mod]);
    const stack = [mod];
    
    while (stack.length) {
      const current = stack.pop();
      current.importers.forEach(imp => {
        if (!affected.has(imp)) {
          affected.add(imp);
          stack.push(imp);
        }
      });
    }
    return Array.from(affected);
  }
}

// =============================================================================
// SIGNATURE PATTERN 3: Hot Module Replacement (HMR)
// =============================================================================
// Vite's instant updates: Precise HMR via module graph

class HMRServer {
  constructor(server) {
    this.server = server;
    this.clients = new Set();
  }

  async handleFileChange(file) {
    const mod = this.server.moduleGraph.urlToModule.get(file);
    if (!mod) return;
    
    const affected = this.server.moduleGraph.invalidateModule(mod);
    const boundary = this.findHMRBoundary(mod);
    
    if (boundary) {
      this.send({
        type: 'update',
        updates: [{ 
          type: 'js-update', 
          path: boundary.url, 
          acceptedPath: mod.url, 
          timestamp: Date.now() 
        }]
      });
    } else {
      this.send({ type: 'full-reload' });
    }
  }

  findHMRBoundary(mod) {
    const visited = new Set();
    const queue = [mod];
    
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      
      if (current.isSelfAccepting) return current;
      if (current.acceptedHmrDeps?.has(mod)) return current;
      
      current.importers.forEach(imp => queue.push(imp));
    }
    return null;
  }

  send(payload) {
    const msg = JSON.stringify(payload);
    this.clients.forEach(c => c.send(msg));
  }
}

// Client HMR runtime
const createHMRClient = () => {
  const ws = new WebSocket(`ws://${location.host}`);
  const hotModules = new Map();

  ws.onmessage = async ({ data }) => {
    const { type, updates } = JSON.parse(data);
    
    if (type === 'update') {
      for (const u of updates) {
        const mod = hotModules.get(u.path);
        if (mod?.callbacks) {
          const newMod = await import(`${u.acceptedPath}?t=${u.timestamp}`);
          mod.callbacks.forEach(cb => cb(newMod));
        }
      }
    } else if (type === 'full-reload') {
      location.reload();
    }
  };

  return {
    accept(cb) {
      const mod = hotModules.get(import.meta.url) || { callbacks: [] };
      mod.callbacks.push(cb);
      hotModules.set(import.meta.url, mod);
    }
  };
};

// =============================================================================
// SIGNATURE PATTERN 4: Dev vs Build Split
// =============================================================================
// Different strategies for different goals

async function build(config) {
  const rollup = require('rollup');
  
  const bundle = await rollup.rollup({
    input: config.build.input,
    plugins: config.plugins
  });

  await bundle.write({
    dir: config.build.outDir,
    format: 'es'
  });
}

// =============================================================================
// EXTENSION POINT: Framework Plugins
// =============================================================================

function vuePlugin() {
  return {
    name: 'vite:vue',
    async transform(code, id) {
      if (!id.endsWith('.vue')) return null;
      const { parse, compileTemplate, compileScript } = require('@vue/compiler-sfc');
      const { descriptor } = parse(code);
      const script = compileScript(descriptor, { id });
      const template = compileTemplate({ source: descriptor.template.content, id });
      return { code: `${script.content}\n${template.code}\nexport default { ...script, render: ${template.code.match(/function render/)?.[0] || 'render'} }` };
    }
  };
}

function reactPlugin() {
  return {
    name: 'vite:react',
    async transform(code, id) {
      if (!/\.(jsx|tsx)$/.test(id)) return null;
      return require('esbuild').transform(code, {
        loader: id.endsWith('tsx') ? 'tsx' : 'jsx',
        jsx: 'automatic'
      });
    }
  };
}

// =============================================================================
// THE "AHA" CODE: Complete Working Example
// =============================================================================

async function startVite() {
  const config = {
    root: './src',
    cacheDir: './node_modules/.vite',
    plugins: [reactPlugin()],
    build: { outDir: './dist', input: './src/main.js' }
  };

  const server = new ViteDevServer(config);
  const hmr = new HMRServer(server);
  
  require('chokidar').watch(config.root).on('change', file => hmr.handleFileChange(file));
  
  require('http').createServer(async (req, res) => {
    const result = await server.handleRequest(req.url);
    if (result) {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(result.code);
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  }).listen(3000);
}

// =============================================================================
// WHAT MAKES VITE UNIQUE
// =============================================================================

/*
1. NATIVE ESM IN DEV - No bundling, transform on demand, only what's requested
2. ESBUILD FOR DEPS - 10-100x faster pre-bundling, CJS to ESM conversion
3. INSTANT HMR - Precise invalidation via import graph, surgical replacements
4. PLUGIN COMPATIBILITY - Rollup API, works in dev and build
5. DEV/BUILD SPLIT - Different tools for different goals (esbuild vs Rollup)

NOT webpack (always bundles), NOT Parcel (less control), NOT Snowpack (less mature)

The genius: Leverage native ESM, transform only what's needed, when needed.
*/

// =============================================================================
// MENTAL MODEL
// =============================================================================

/*
Traditional: [Source] → [Bundle Everything] → [Dev Server] → [Browser]
Vite:        [Source] → [Optimize Deps Once] → [Transform on Request] → [Browser]

Key insight: Separate dep optimization from source transformation
- node_modules → pre-bundle once with esbuild
- Your code → transform on-demand per request
*/

// =============================================================================
// THE GENIUS MOVES
// =============================================================================

/*
1. Browser as bundler - ESM handles loading, parallelism comes free
2. ESM-based HMR - Explicit imports make dependency tracing trivial
3. esbuild for speed - Pre-bundle deps in milliseconds
4. Rollup for build - Don't compromise dev experience for production needs
*/

// =============================================================================
// REAL WORLD PATTERNS
// =============================================================================

// HMR API
if (import.meta.hot) {
  import.meta.hot.accept(newModule => {
    // Handle update
  });
}

// Environment variables
console.log(import.meta.env.VITE_API_KEY);

// Glob imports
const modules = import.meta.glob('./components/*.jsx');

// Asset URLs
const url = new URL('./logo.png', import.meta.url);

// =============================================================================
// IF YOU UNDERSTAND THIS, YOU UNDERSTAND VITE
// =============================================================================

const VITE_ESSENCE = {
  dev: (file) => server.handleRequest(file),           // No bundle in dev
  deps: (packages) => optimizeDeps(packages, config),  // Pre-bundle deps
  serve: (url) => pluginContainer.transform(url),      // Transform per request
  hmr: (file) => moduleGraph.invalidateModule(file),   // Precise HMR
  build: () => build(config)                            // Optimize for prod
};

/*
The entire tool in one sentence:
"Skip bundling in dev by serving native ESM with on-demand transformation,
 pre-bundle dependencies with esbuild for speed, enable instant HMR via
 import graph, and use Rollup for optimized production builds."

Before Vite: Make bundling faster
Vite's insight: What if we don't bundle during development at all?
Result: Instant start, instant HMR, scales to any size

This is the DNA: Native ESM + Transform on Demand + esbuild for deps
*/

export { ViteDevServer, build, optimizeDeps, PluginContainer, ModuleGraph, HMRServer };
