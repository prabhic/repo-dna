"""
REPO-DNA: cognee
Source: https://github.com/topoteretes/cognee   Commit/Ref: 15e4860
Archetype: AI-memory / knowledge-graph framework (Python library + async pipelines)
The bet: model your domain as typed Pydantic DataPoints; the knowledge graph is
         DERIVED by reflecting over them (nodes, edges, and embeddable fields read
         off the type) instead of hand-written as triples. A direct node/edge API
         exists, but reflection is the idiomatic path the system is built around.

This is not the repo. This is its variant fraction — what it does that its
peers do not.
"""

# ============================================================================
# REFERENCE GENOME  (the competent default for an AI-memory / KG framework in
# Python — everything below must be a DEPARTURE from this, or it is not DNA)
# ============================================================================
# A capable engineer would: ingest docs -> chunk -> ask an LLM for (entity,
# relation, entity) triples -> write those triples to a graph DB with bespoke
# Cypher AND write chunk embeddings to a vector DB through separate glue.
# Entities are keyed by their raw name string; dedup is ad hoc. Retrieval is
# "vector top-k + a hand-written graph hop". The ingest pipeline is a fixed
# sequence of awaited function calls. Graph code and storage code are written
# by hand, per store, per entity type.


# ============================================================================
# THE LOAD-BEARING BET  (reverse it and this becomes a different project)
# ============================================================================
# The graph is not emitted as triples — it is DERIVED by reflecting over typed
# Pydantic objects. Declare DataPoint subclasses, mark fields, and ONE call
# fans the same objects into graph + vector + relational stores, with node
# identity computed from declared fields so re-mentions MERGE across runs.
# (Kernel verified-runnable; see cognee/infrastructure/engine/models/DataPoint.py
#  and cognee/tasks/storage/add_data_points.py.)

import uuid
from dataclasses import dataclass, field, fields

NS = uuid.NAMESPACE_OID


class DataPoint:
    identity_fields: list = []   # Dedup(): these derive a deterministic uuid5 id
    index_fields: list = []      # Embeddable(): these get vectorized for search

    def node_id(self):
        # Declared identity -> stable id; nothing declared -> a node that never merges.
        if self.identity_fields:
            vals = "|".join(
                str(getattr(self, f)).lower().replace(" ", "_") for f in self.identity_fields
            )
            return uuid.uuid5(NS, f"{type(self).__name__}:{vals}")
        return uuid.uuid4()


@dataclass
class Entity(DataPoint):
    name: str
    identity_fields = ["name"]
    index_fields = ["name"]


@dataclass
class Document(DataPoint):
    title: str
    mentions: list = field(default_factory=list)  # nested DataPoints become edges
    identity_fields = ["title"]


def reflect(dp, nodes, edges):  # one model -> nodes + edges, recursively
    nid = dp.node_id()
    scalar = {
        f.name: getattr(dp, f.name) for f in fields(dp) if not isinstance(getattr(dp, f.name), list)
    }
    nodes[nid] = (type(dp).__name__, scalar, dp.index_fields)
    for f in fields(dp):
        val = getattr(dp, f.name)
        if isinstance(val, list):
            for child in val:
                edges.add((nid, f.name, child.node_id()))
                reflect(child, nodes, edges)
    return nid


def _demo():
    nodes, edges = {}, set()
    reflect(Document("Doc A", [Entity("Ada Lovelace"), Entity("Babbage")]), nodes, edges)
    reflect(Document("Doc B", [Entity("Ada Lovelace")]), nodes, edges)  # mentions Ada again
    print(f"nodes: {len(nodes)}   edges: {len(edges)}")
    for nid, (typ, props, idx) in nodes.items():
        embeds = {k: props[k] for k in idx if k in props}
        print(f"  {typ:9} id={str(nid)[:8]}  embeds={embeds}")
    print(
        "Ada is ONE node across Doc A + Doc B:",
        Entity("Ada Lovelace").node_id() == Entity("ada lovelace").node_id(),
    )
    # Runs as: nodes: 4  edges: 3  (Ada appears once, not twice) -> True


if __name__ == "__main__":
    _demo()


# ============================================================================
# SIGNATURE PATTERNS  (the recurring SNPs — sketches, faithful but need not run)
# ============================================================================

# SNP 1 — Field ANNOTATIONS, read at class-creation time, ARE the storage policy.
# A field's marker decides what is vectorized and what forms the merge key; no
# imperative "index this column" calls anywhere.
#   cognee/infrastructure/engine/models/FieldAnnotations.py + DataPoint.__pydantic_init_subclass__
from typing import Annotated, Optional  # noqa: E402


class Entity_(DataPoint):  # sketch — real base is pydantic BaseModel
    name: Annotated[str, "Embeddable()", "Dedup()"]          # -> index_fields + identity_fields
    description: Annotated[str, "LLMContext()"]              # -> sent to LLM, not embedded
    is_a: Optional["EntityType"] = None                     # DataPoint-typed field -> an edge
    # __pydantic_init_subclass__ scans Annotated markers and auto-populates
    # metadata = {"index_fields": [...], "identity_fields": [...]} unless declared.


# SNP 2 — Identity IS the dedup key: uuid5(class_name, normalized fields).
# The class supplies its own namespace, so a bare-string lookup and a constructed
# instance agree on the id before the instance exists.
#   DataPoint.id_for / _generate_identity_id
def id_for(cls_name, *values):  # sketch of DataPoint.id_for
    joined = "|".join(str(v).lower().replace(" ", "_").replace("'", "") for v in values)
    return uuid.uuid5(NS, f"{cls_name}:{joined}")
    # uuid4 default => "no stable identity, never deduplicates"; opting into
    # identity_fields is what makes a node idempotent/mergeable across pipeline runs.


# SNP 3 — @task adapts ANY callable shape to a uniform pipeline step, and the
# CONSUMER's batch_size sets streaming granularity (not the producer's).
#   cognee/modules/pipelines/tasks/task.py
def task(fn=None, *, batch_size=None, enriches=False, **default_params):
    # func / coroutine / generator / async-generator are each detected via
    # inspect.* and wrapped in one Task interface. Calling a task does NOT run it
    # — it returns a BoundTask capturing kwargs for run_pipeline to execute later.
    ...


async def _pipeline_shape():  # sketch of how cognify is assembled
    await run_pipeline(
        [
            classify_documents(),
            extract_chunks_from_documents(),
            extract_graph_and_summarize(graph_model="KnowledgeGraph"),
            add_data_points(),  # <- the reflect-into-three-stores step
        ],
        data="raw_input",
        dataset="main",
    )
    # A `_Drop` sentinel yielded by a task removes that item from the stream;
    # `enriches=True` lets a task mutate-and-pass-through instead of replacing.


# ============================================================================
# STRUCTURAL COMMITMENTS  (the two bets the rest is organized around)
# ============================================================================
# (1) WRITE SIDE — add_data_points() is the seam where everything converges: it
# reflects each DataPoint object-graph into (nodes, edges) via get_graph_from_model,
# dedups them, then writes through ONE capability-negotiated `unified` engine that
# fronts graph + vector + relational together. On the idiomatic path the domain
# author touches no store directly; a direct node/edge API exists for the ~9
# first-party tasks (memify, ingestion, temporal) that bypass reflection.
# Integrity: ingest is transactional ACROSS the tri-store — a failed cognify rolls
# the partial write back from graph AND vector (cognify/rollback.py). Validation is
# SOFT: every node carries an `ontology_valid` bit — entities are checked against a
# declared ontology and FLAGGED, not rejected (DataPoint.ontology_valid).
#   cognee/tasks/storage/add_data_points.py + cognify/rollback.py
async def add_data_points(data_points, ctx=None):  # sketch
    nodes, edges = [], []
    for dp in data_points:
        n, e = await get_graph_from_model(dp)  # reflection, not hand-written triples
        nodes += n
        edges += e
    nodes, edges = deduplicate_nodes_and_edges(nodes, edges)  # merge by derived id
    unified = await get_unified_engine()  # graph + vector + relational, one interface
    await unified.graph.add(nodes, edges)
    # index_fields drive what the same call sends to the vector index.


# (2) READ SIDE — retrieval works at TRIPLET granularity, not chunk or node. The
# graph read embeds nodes AND edges and brute-force scores whole triplets by vector
# distance (a `triplet_distance_penalty`), wide-then-narrow (top 100 -> top 5), then
# linearizes each surviving edge to "Node1 / Edge / Node2" text for the LLM. Search
# is a REGISTRY of ~21 SearchType modes (graph/triplet/hybrid/cypher/temporal/CoT…)
# made community-pluggable via use_retriever() — the read path is as first-class and
# swappable as the write path. Note: brute force, not a clever index — distance
# scoring over triplets is the deliberate bet.
#   modules/retrieval/utils/brute_force_triplet_search.py + register_retriever.py
async def graph_completion(query, top_k=5, wide_search_top_k=100,  # sketch
                           triplet_distance_penalty=6.5):
    edges = await brute_force_triplet_search(  # node+edge vectors -> scored triplets
        query, wide_search_top_k=wide_search_top_k,
        triplet_distance_penalty=triplet_distance_penalty,
    )
    context = format_triplets(edges[:top_k])   # edges -> "Node1 / Edge / Node2" text
    return await generate_completion(query, context)  # context -> LLM answer


# ============================================================================
# GROWTH SEAMS  (the actual extension surface)
# ============================================================================
# 1. Custom knowledge shape: pass any pydantic model as graph_model=...
#       await cognify(graph_model=MyDomainGraph)
# 2. Custom node types: subclass DataPoint, add Annotated[..., Embeddable/Dedup].
# 3. Custom pipelines: hand a list[Task] to run_custom_pipeline / memify.
# 4. Import foreign memory: cognee.migration sources adapt other systems IN —
#       Mem0Source, GraphitiSource/ZepSource, LettaSource, COGXArchiveSource.
# 5. Custom retrieval: register a retriever per SearchType via use_retriever(...).


# ============================================================================
# NEGATIVE SPACE  (deliberately LEFT OUT — common to the ecosystem, not DNA)
# ============================================================================
# - Document chunking / TextChunker, LLM entity-extraction prompts — table stakes
#   for any KG-memory tool; the reference genome already has them.
# - FastAPI server, CLI, MCP server, React frontend — distribution, not identity.
# - Pluggable LLM / embedding providers, async-everywhere — expected baseline.
# - Alembic migrations, observability/tracing, multi-user/session plumbing — cast.
#   (NOTE: SearchType retrieval is NOT here — it is DNA; see structural commitment 2.)
# - Neo4j/Kuzu/LanceDB/pgvector specifics — the unified engine exists precisely
#   to make any single backend NOT the DNA.
#
# Rebuild test: from this file a senior dev could reconstruct cognee's character —
#   "model your memory as typed Pydantic DataPoints; the graph is reflected off
#   them and fanned into three stores; identity = a derived uuid5 so entities
#   merge; you READ it back at triplet granularity via brute-force vector scoring;
#   ECL runs as batch-streaming @task pipelines." Yes.
# Confusion test: strip the names and it still can't be Mem0 (LLM-managed
#   key/value memories) or Graphiti/Zep (bi-temporal episodic triples) — neither
#   derives its graph by REFLECTING user-declared Pydantic types into a tri-store,
#   nor reads it back by brute-force scoring embedded TRIPLETS. Passes.
