/*
 * REPO-DNA: Project N.O.M.A.D.
 * Source: https://github.com/crosstalk-solutions/project-nomad   Commit/Ref: 6a4f02d
 * Archetype: Self-hosted appliance orchestrator (Docker-based offline-first knowledge server)
 * The bet: A single AdonisJS admin container owns the Docker socket and programmatically
 *          creates/manages ALL child service containers (Kiwix, Ollama, Qdrant, CyberChef…)
 *          via dockerode — not docker-compose — so the UI can install, uninstall, update,
 *          GPU-configure, and relocate services at runtime without touching the host shell.
 *
 * This is not the repo. This is its variant fraction — what it does that its
 * peers do not.
 */

// ============================================================================
// REFERENCE GENOME  (the competent default for a self-hosted appliance manager
// in TypeScript — everything below must be a DEPARTURE from this)
// ============================================================================
// A capable engineer would: provide a curated docker-compose.yml per tool,
// expose a UI to flip env vars and run `docker compose up/down` via shell exec,
// store settings in a flat YAML/JSON file, and require the user to manually
// pull images, manage ports, and handle GPU passthrough. Updates would be a
// "git pull && docker compose pull && docker compose up -d" script. Content
// (Wikipedia, maps, AI models) would be managed outside the tool entirely.
// The system would be a thin wrapper around compose files.


// ============================================================================
// THE LOAD-BEARING BET  (reverse it and this becomes a different project)
// ============================================================================
// The admin container holds the Docker socket and imperatively creates child
// containers from a database-stored `container_config` JSON blob. This makes
// every service a dynamic, runtime-managed entity: GPU detection rewrites the
// image tag, host storage root is resolved from the admin's own mount and
// propagated to children, dependencies are recursively installed, and the UI
// can install/uninstall without any compose file or host-side tooling.

// --- Kernel: demonstrates the core mechanism (runnable) ---

import { createServer } from 'http'

// Simulates the DockerService pattern: container_config is data, not a compose file.
// The admin reads a service record, resolves runtime state, and builds create opts.

interface ServiceRecord {
  service_name: string
  container_image: string
  container_config: string // JSON blob — the portable "recipe"
  installed: boolean
  depends_on: string | null
}

interface ContainerCreateOpts {
  Image: string
  name: string
  HostConfig: { Binds: string[]; PortBindings: Record<string, { HostPort: string }[]> }
}

// The bet: container_config is a DB column, not a file. Install = parse + enrich + create.
function buildCreateOpts(
  service: ServiceRecord,
  hostStorageRoot: string,
  gpuType: 'nvidia' | 'amd' | 'none'
): ContainerCreateOpts {
  const config = JSON.parse(service.container_config)
  let image = service.container_image

  // GPU-aware image swap (Ollama-specific, detected at install time)
  if (service.service_name === 'nomad_ollama' && gpuType === 'amd') {
    image = 'ollama/ollama:rocm'
  }

  // Host storage root rewriting: admin resolves its own mount, children follow
  const binds: string[] = (config.HostConfig?.Binds ?? []).map((b: string) => {
    const defaultRoot = '/opt/project-nomad/storage'
    if (b.startsWith(defaultRoot)) {
      return hostStorageRoot + b.slice(defaultRoot.length)
    }
    return b
  })

  return {
    Image: image,
    name: service.service_name,
    HostConfig: {
      Binds: binds,
      PortBindings: config.HostConfig?.PortBindings ?? {},
      ...(gpuType === 'nvidia'
        ? { DeviceRequests: [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }] }
        : {}),
    },
  }
}

// Demo: build container create options for two services
function demo() {
  const services: ServiceRecord[] = [
    {
      service_name: 'nomad_ollama',
      container_image: 'ollama/ollama:latest',
      container_config: JSON.stringify({
        HostConfig: {
          Binds: ['/opt/project-nomad/storage/ollama:/root/.ollama'],
          PortBindings: { '11434/tcp': [{ HostPort: '11434' }] },
        },
      }),
      installed: false,
      depends_on: null,
    },
    {
      service_name: 'nomad_kiwix_server',
      container_image: 'ghcr.io/kiwix/kiwix-serve:3.7.0',
      container_config: JSON.stringify({
        HostConfig: {
          Binds: ['/opt/project-nomad/storage/zim:/data'],
          PortBindings: { '8080/tcp': [{ HostPort: '8181' }] },
        },
      }),
      installed: false,
      depends_on: null,
    },
  ]

  const hostRoot = '/mnt/data/nomad-storage' // user relocated storage
  console.log('=== Project NOMAD DNA: imperative container orchestration ===\n')

  for (const svc of services) {
    const opts = buildCreateOpts(svc, hostRoot, svc.service_name === 'nomad_ollama' ? 'nvidia' : 'none')
    console.log(`Service: ${opts.name}`)
    console.log(`  Image: ${opts.Image}`)
    console.log(`  Binds: ${opts.HostConfig.Binds.join(', ')}`)
    console.log(`  Ports: ${JSON.stringify(opts.HostConfig.PortBindings)}`)
    const extra = (opts.HostConfig as any).DeviceRequests
    if (extra) console.log(`  GPU:   NVIDIA passthrough (all GPUs)`)
    console.log()
  }
  console.log('Key insight: no compose file touched. DB record + runtime detection = container spec.')
}

demo()


// ============================================================================
// SIGNATURE PATTERNS  (sketches, faithful but need not run)
// ============================================================================

// SNP 1 — SSE broadcast bus: every long-running operation (install, download,
// update) emits granular progress via AdonisJS Transmit channels. The UI
// subscribes to `services/{name}` and renders real-time state without polling.
//   admin/app/services/docker_service.ts: _broadcast()
function _broadcast(serviceName: string, event: string, message: string) {
  // transmit.broadcast(`services/${serviceName}`, { event, message, ts: Date.now() })
  // Events: pulling, creating, gpu-config, dependency-not-installed, complete, error
  // The UI renders a step-by-step install log from these — not from container logs.
}

// SNP 2 — Sidecar-mediated self-update: the admin cannot restart itself, so a
// tiny watcher container polls a shared volume for an update-request JSON, then
// `sed`s the compose image tag, pulls, and recreates — all without the admin
// running `docker compose` on itself.
//   install/sidecar-updater/update-watcher.sh + admin/app/services/auto_update_service.ts
interface UpdateRequest {
  target_tag: string // strict semver only — validated before writing
}
// Admin writes { target_tag: "1.33.2" } to /shared/update-request.
// Sidecar reads, sed's compose.yml, pulls, recreates containers one-by-one.
// Admin reads /shared/update-status for UI progress. No host shell access needed.

// SNP 3 — ZIM-to-vector ingestion pipeline: offline Wikipedia/reference ZIM files
// are extracted article-by-article via @openzim/libzim, chunked with ChonkieJS,
// and embedded into Qdrant with Nomic Embed Text v1.5. This turns static offline
// archives into a searchable RAG knowledge base — unique to NOMAD vs plain Kiwix.
//   admin/app/services/zim_extraction_service.ts + rag_service.ts
interface ZIMContentChunk {
  id: string
  content: string
  article_title: string
  source: string // ZIM filename
  heading_path: string[]
}
// ZIM → cheerio HTML parse → heading-aware chunking → embedding → Qdrant upsert
// Batched (ZIM_BATCH_SIZE), resumable (startOffset), with magic-number validation
// to avoid native C++ abort on corrupted files.


// ============================================================================
// STRUCTURAL COMMITMENTS
// ============================================================================

// (1) INSTALL SIDE — DockerService._createContainer() is the convergence point.
// Every install flows: preflight → mark installing → resolve dependencies
// (recursive) → pull image → run pre-install hooks (per-service: Kiwix library
// XML, Calibre empty DB seed, Vaultwarden dirs, Jellyfin media subfolders,
// MeshCore config) → detect GPU → rewrite storage binds → docker.createContainer
// → start → broadcast complete. The Service model in MySQL is the single source
// of truth for what's installed; Docker state is derived, not authoritative.
//   admin/app/services/docker_service.ts (2200+ lines)

// (2) CONSUME SIDE — The user-facing read path is NOT just "open the service URL".
// The RAG pipeline is the distinctive consumer: uploaded PDFs + ZIM content are
// chunked, embedded (Nomic Embed v1.5 via Ollama), stored in Qdrant, and queried
// with a re-ranking layer that combines vector similarity with stopword-filtered
// keyword overlap. The AI chat pipes Qdrant context into Ollama completions.
// This makes NOMAD's read path a local RAG system, not a link aggregator.
//   admin/app/services/rag_service.ts (2000+ lines)

// (3) AUTO-UPDATE DECISION ENGINE — Three independent auto-update loops (core,
// apps, content) each with: time-window gating, cool-off periods, pre-flight
// checks (disk space for new image), consecutive-failure backoff, and major-version
// lockout. The dry-run command exercises the full pipeline deterministically
// without triggering any real update — a testable decision function, not a cron script.
//   admin/app/services/auto_update_service.ts + app_auto_update_service.ts + content_auto_update_service.ts


// ============================================================================
// GROWTH SEAMS  (the actual extension surface)
// ============================================================================
// 1. Supply Depot catalog: add a row to the services seeder with container_config
//    JSON and the UI renders install/uninstall/update buttons automatically.
//      admin/database/seeders/service_seeder.ts
// 2. Custom apps: users define arbitrary Docker containers via the UI (image,
//    ports, volumes, env) — stored as is_custom=true Service records.
//      POST /api/system/services/custom
// 3. Collection manifests: curated content packs (Wikipedia tiers, map regions)
//    defined in /collections/*.json — the Easy Setup wizard reads these.
//      collections/wikipedia.json, collections/maps.json
// 4. Pre-install hooks: per-service setup logic in DockerService — add a new
//    `if (service.service_name === SERVICE_NAMES.X)` block for any prep work.


// ============================================================================
// NEGATIVE SPACE  (deliberately LEFT OUT — common to the ecosystem, not DNA)
// ============================================================================
// - AdonisJS framework patterns (Lucid ORM, Inertia.js SSR, VineJS validation,
//   route groups, middleware) — standard framework usage, not distinctive.
// - React + TailwindCSS + TanStack Query frontend — table-stakes SPA stack.
// - Docker Compose for the management stack itself (admin, mysql, redis) — that's
//   the standard approach; the DNA is that child services BYPASS compose.
// - Ollama/Qdrant integration — connecting to these APIs is expected; the
//   distinctive part is the ZIM→RAG pipeline and offline-first design.
// - BullMQ job queues for downloads — standard background-job infrastructure.
// - Kiwix/Kolibri/CyberChef as bundled tools — curation choices, not architecture.
//
// Rebuild test: a senior dev reading this would know — "NOMAD is an AdonisJS app
//   that holds the Docker socket, stores service recipes as JSON in MySQL, and
//   imperatively creates/updates/removes child containers with GPU detection and
//   storage-root propagation. It turns offline ZIM archives into a RAG knowledge
//   base via Qdrant. It self-updates through a sidecar that rewrites compose tags."
//   That's enough to reconstruct the distinctive character. Yes.
//
// Confusion test: strip the names and this can't be CasaOS (declarative app-store
//   YAML), Umbrel (docker-compose per app, no runtime rewriting), or Homarr (just
//   a dashboard). None of them: (a) derive child container specs from DB records at
//   runtime, (b) resolve storage binds from their own mount, (c) extract ZIM content
//   into a vector DB for RAG, or (d) self-update via a sidecar shared-volume protocol.
//   Passes.
