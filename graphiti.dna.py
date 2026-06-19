"""
REPO-DNA: Graphiti
Source: https://github.com/getzep/graphiti
Identity: Temporal context graphs that track how facts evolve over time for AI agents.

This is not the repo. This is what makes the repo unique.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


# =============================================================================
# IDENTITY CORE: Facts have temporal validity windows
# =============================================================================
# The ONE unique insight: every relationship in the graph has a time range
# (valid_at, invalid_at) — knowledge isn't static, it evolves. When a fact
# changes, the old edge gets invalidated and a new one is created, preserving
# full temporal history.


class TemporalFact(BaseModel):
    """The atomic unit of Graphiti — a fact with temporal bounds."""

    uuid: str = Field(default_factory=lambda: str(uuid4()))
    source_entity: str
    target_entity: str
    relation_type: str  # SCREAMING_SNAKE_CASE: WORKS_AT, LIVES_IN
    fact: str  # Natural language: "Alice works at Acme Corp"
    valid_at: datetime | None = None  # When this became true
    invalid_at: datetime | None = None  # When this stopped being true
    group_id: str = "default"  # Multi-tenant partitioning

    @property
    def is_current(self) -> bool:
        return self.invalid_at is None

    def invalidate(self, when: datetime) -> None:
        self.invalid_at = when


# =============================================================================
# SIGNATURE PATTERN 1: Episodes as the ingestion primitive
# =============================================================================
# Data enters the graph through "episodes" — timestamped chunks of information
# (messages, JSON, text). The system extracts entities and facts from episodes,
# then integrates them into the existing graph with deduplication and resolution.


class EpisodeType(Enum):
    message = "message"  # "actor: content" format
    json = "json"
    text = "text"
    fact_triple = "fact_triple"


class Episode(BaseModel):
    uuid: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    content: str
    episode_type: EpisodeType
    group_id: str
    valid_at: datetime  # When this episode's events occurred
    created_at: datetime  # When ingested into the system

    # Back-references: which entities/edges were derived from this episode
    entity_edges: list[str] = Field(default_factory=list)


class EntityNode(BaseModel):
    uuid: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    group_id: str
    labels: list[str] = Field(default_factory=list)  # Custom ontology types
    summary: str = ""  # Evolves over time as new info arrives
    name_embedding: list[float] | None = None


# =============================================================================
# SIGNATURE PATTERN 2: Extract → Resolve → Deduplicate pipeline
# =============================================================================
# Every episode goes through: (1) LLM extracts entities + facts,
# (2) entities are resolved against existing graph nodes (deduplication),
# (3) facts are resolved against existing edges (temporal invalidation).


class AddEpisodeResults(BaseModel):
    """What comes out of processing a single episode."""

    episode: Episode
    nodes: list[EntityNode]
    edges: list[TemporalFact]
    communities: list[str] = Field(default_factory=list)


async def add_episode(
    content: str,
    episode_type: EpisodeType,
    group_id: str,
    reference_time: datetime,
    entity_types: dict[str, type[BaseModel]] | None = None,
    edge_types: dict[str, type[BaseModel]] | None = None,
) -> AddEpisodeResults:
    """The core ingestion pipeline — Graphiti's heartbeat.

    1. Create episode node
    2. Retrieve previous episodes for context
    3. Extract entities (nodes) via LLM
    4. Resolve extracted nodes against existing graph (dedupe)
    5. Extract facts (edges) via LLM
    6. Resolve edges — invalidate superseded facts, keep new ones
    7. Build episodic edges linking episode to its extracted entities
    8. Update community structure
    """
    # Step 1: Create episode
    episode = Episode(
        name=f"episode_{uuid4().hex[:8]}",
        content=content,
        episode_type=episode_type,
        group_id=group_id,
        valid_at=reference_time,
        created_at=datetime.now(),
    )

    # Step 2: Get context from recent episodes
    previous_episodes = await retrieve_previous_episodes(group_id, limit=3)

    # Step 3-4: Extract and resolve nodes
    extracted_nodes = await extract_nodes(episode, previous_episodes, entity_types)
    nodes, uuid_map = await resolve_nodes(extracted_nodes, episode)

    # Step 5-6: Extract and resolve edges (the temporal magic)
    extracted_edges = await extract_edges(episode, nodes, previous_episodes, edge_types)
    resolved_edges, invalidated = await resolve_edges(extracted_edges, nodes, episode)

    # Step 7: Link episode to its entities
    episodic_edges = build_episodic_edges(nodes, episode)

    return AddEpisodeResults(
        episode=episode,
        nodes=nodes,
        edges=resolved_edges,
    )


# =============================================================================
# SIGNATURE PATTERN 3: Hybrid search with configurable reranking
# =============================================================================
# Search combines BM25 (keyword), cosine similarity (semantic), and BFS
# (graph traversal) with pluggable rerankers (RRF, MMR, cross-encoder,
# node distance, episode mentions).


class SearchMethod(Enum):
    cosine_similarity = "cosine_similarity"
    bm25 = "bm25"
    bfs = "breadth_first_search"


class Reranker(Enum):
    rrf = "reciprocal_rank_fusion"
    node_distance = "node_distance"
    episode_mentions = "episode_mentions"
    mmr = "mmr"
    cross_encoder = "cross_encoder"


class SearchConfig(BaseModel):
    """Composable search configuration — mix retrieval methods and rerankers."""

    search_methods: list[SearchMethod]
    reranker: Reranker = Reranker.rrf
    limit: int = 10
    min_score: float = 0.0
    mmr_lambda: float = 0.5


class SearchResults(BaseModel):
    edges: list[TemporalFact] = Field(default_factory=list)
    nodes: list[EntityNode] = Field(default_factory=list)
    episodes: list[Episode] = Field(default_factory=list)


# Pre-built recipes — the common search patterns
HYBRID_SEARCH_RRF = SearchConfig(
    search_methods=[SearchMethod.bm25, SearchMethod.cosine_similarity],
    reranker=Reranker.rrf,
)

HYBRID_SEARCH_CROSS_ENCODER = SearchConfig(
    search_methods=[SearchMethod.bm25, SearchMethod.cosine_similarity, SearchMethod.bfs],
    reranker=Reranker.cross_encoder,
)


async def search(
    query: str,
    group_ids: list[str],
    config: SearchConfig = HYBRID_SEARCH_RRF,
    center_node_uuid: str | None = None,
    num_results: int = 10,
) -> SearchResults:
    """Hybrid retrieval across the temporal context graph.

    Combines multiple retrieval strategies, then reranks results.
    center_node_uuid enables graph-distance-aware reranking.
    """
    candidates = []

    for method in config.search_methods:
        if method == SearchMethod.cosine_similarity:
            candidates.extend(await _vector_search(query, group_ids))
        elif method == SearchMethod.bm25:
            candidates.extend(await _fulltext_search(query, group_ids))
        elif method == SearchMethod.bfs:
            if center_node_uuid:
                candidates.extend(await _graph_search(center_node_uuid, group_ids))

    reranked = await _rerank(candidates, config.reranker, query)
    return SearchResults(edges=reranked[: config.limit])


# =============================================================================
# ARCHITECTURAL DNA: The graph schema
# =============================================================================
# Neo4j/FalkorDB as temporal knowledge store with these node/edge types:
#
#   (Entity) -[RELATES_TO {fact, valid_at, invalid_at}]-> (Entity)
#   (Episodic) -[MENTIONS]-> (Entity)
#   (Community) -[HAS_MEMBER]-> (Entity)
#   (Saga) -[HAS_EPISODE]-> (Episodic)
#   (Episodic) -[NEXT_EPISODE]-> (Episodic)
#
# Entities have evolving summaries. Edges carry temporal validity.
# Episodes are provenance — the raw data ground truth.
# Communities group related entities for high-level retrieval.
# Sagas chain episodes into ordered sequences (conversations, threads).


# =============================================================================
# EXTENSION POINTS: Custom ontology via Pydantic models
# =============================================================================
# Developers define their own entity and edge types. The system uses these
# as extraction hints for the LLM and enforces them as graph labels.


class PersonEntity(BaseModel):
    """Example custom entity type — passed to add_episode(entity_types=...)"""

    occupation: str | None = None
    location: str | None = None
    age: int | None = None


class WorksAtEdge(BaseModel):
    """Example custom edge type — typed fact with structured attributes."""

    role: str | None = None
    department: str | None = None
    start_date: datetime | None = None


# Usage: entity_types={"Person": PersonEntity}, edge_types={"WORKS_AT": WorksAtEdge}
# The LLM extracts entities conforming to these schemas, and edges carry
# structured attributes alongside their natural-language fact string.


# =============================================================================
# THE "AHA" CODE: Temporal edge resolution
# =============================================================================
# This is where Graphiti's magic lives. When a new fact contradicts an existing
# one, the old fact gets invalidated (not deleted), preserving history.


async def resolve_edges(
    new_edges: list[TemporalFact],
    nodes: list[EntityNode],
    episode: Episode,
) -> tuple[list[TemporalFact], list[TemporalFact]]:
    """Resolve new facts against the existing graph.

    For each new edge:
    1. Find existing edges between the same entity pair
    2. Ask LLM: does this new fact contradict/supersede existing facts?
    3. If yes: invalidate the old edge (set invalid_at = episode.valid_at)
    4. The new edge becomes the current truth

    Returns (resolved_edges, invalidated_edges)
    """
    resolved = []
    invalidated = []

    for edge in new_edges:
        existing = await _get_existing_edges(
            edge.source_entity, edge.target_entity, edge.group_id
        )

        if not existing:
            resolved.append(edge)
            continue

        # LLM determines if the new fact contradicts existing ones
        contradicted = await _evaluate_contradiction(edge, existing)

        for old_edge in contradicted:
            old_edge.invalidate(when=episode.valid_at or episode.created_at)
            invalidated.append(old_edge)

        # Check if this is truly new (not a duplicate of existing)
        if not await _is_duplicate(edge, existing):
            resolved.append(edge)

    return resolved, invalidated


# =============================================================================
# Stub implementations (the real ones use Neo4j/LLM)
# =============================================================================


async def retrieve_previous_episodes(group_id: str, limit: int) -> list[Episode]:
    return []


async def extract_nodes(
    episode: Episode, previous: list[Episode], entity_types: Any
) -> list[EntityNode]:
    return []


async def resolve_nodes(
    nodes: list[EntityNode], episode: Episode
) -> tuple[list[EntityNode], dict[str, str]]:
    return nodes, {}


async def extract_edges(
    episode: Episode, nodes: list[EntityNode], previous: list[Episode], edge_types: Any
) -> list[TemporalFact]:
    return []


def build_episodic_edges(nodes: list[EntityNode], episode: Episode) -> list[dict]:
    return [{"episode": episode.uuid, "entity": n.uuid} for n in nodes]


async def _vector_search(query: str, group_ids: list[str]) -> list[TemporalFact]:
    return []


async def _fulltext_search(query: str, group_ids: list[str]) -> list[TemporalFact]:
    return []


async def _graph_search(center: str, group_ids: list[str]) -> list[TemporalFact]:
    return []


async def _rerank(
    candidates: list[TemporalFact], reranker: Reranker, query: str
) -> list[TemporalFact]:
    return candidates


async def _get_existing_edges(
    source: str, target: str, group_id: str
) -> list[TemporalFact]:
    return []


async def _evaluate_contradiction(
    new: TemporalFact, existing: list[TemporalFact]
) -> list[TemporalFact]:
    return []


async def _is_duplicate(edge: TemporalFact, existing: list[TemporalFact]) -> bool:
    return False
