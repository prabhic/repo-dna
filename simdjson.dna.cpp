/*
 * REPO-DNA: simdjson
 * Source: https://github.com/simdjson/simdjson   Commit/Ref: 8e6bac9
 * Archetype: High-performance C++ library (JSON parser)
 * The bet: parse JSON by exploiting SIMD instructions to classify 64 bytes at
 *          once into structural/whitespace/string bitmasks, building a flat
 *          structural index in a branchless first pass, then consuming it
 *          lazily on-demand — never materializing a full tree.
 *
 * This is not the repo. This is its variant fraction — what it does that its
 * peers do not.
 */

// ============================================================================
// REFERENCE GENOME  (the competent default for a C++ JSON parser)
// ============================================================================
// A capable engineer would: read the input byte-by-byte (or memchr for quotes),
// track nesting with an explicit stack, build a tree of variant nodes
// (object/array/string/number) via recursive descent, allocate per-node, copy
// string data with escape handling inline, validate UTF-8 as a separate pass or
// interleaved character-at-a-time, and return the complete tree to the caller.
// Numbers are parsed with strtod or equivalent scalar loop. The parser is
// single-architecture, single-pass, fully-eager.

// ============================================================================
// THE LOAD-BEARING BET  (kernel — verified-runnable)
// ============================================================================
// Process 64 bytes at a time: use a SIMD lookup table to classify every byte
// into "operator" or "whitespace" in ONE instruction, producing a 64-bit
// bitmask. A parallel string-state machine (prefix-sum of quote parity via
// carryless multiply) masks out characters inside strings. The result: a flat
// array of structural positions (the "structural index") built without any
// branching per byte. Stage 2 / on-demand then walks this index, never re-
// scanning the input.

#include <cstdint>
#include <cstring>
#include <cstdio>

// Toy demonstration of the classify-via-lookup principle (scalar, portable).
// Real simdjson uses _mm256_shuffle_epi8 / vpshufb to do this for 32/64 bytes.

static uint64_t classify_block(const uint8_t* block, int len) {
    // Lookup: for each low nibble, what structural character could it be?
    // Operators: , 0x2C  : 0x3A  [ 0x5B  ] 0x5D  { 0x7B  } 0x7D
    // After OR 0x20: [ -> {, ] -> }  — low nibbles become unique.
    static const uint8_t op_table[16] = {
        0, 0, 0, 0,  0, 0, 0, 0,
        0, 0, ':', '{',  ',', '}', 0, 0
    };
    uint64_t op_mask = 0;
    for (int i = 0; i < len && i < 64; i++) {
        uint8_t c = block[i];
        uint8_t curlified = c | 0x20;
        uint8_t candidate = op_table[curlified & 0x0F];
        if (candidate != 0 && candidate == curlified) {
            op_mask |= (1ULL << i);
        }
    }
    return op_mask;
}

// String masking: track quote parity to suppress operators inside strings.
// Real simdjson: clmul(quote_bits, 0xFF) gives prefix-sum parity in one cycle.
// (Escape handling omitted for brevity; real impl uses json_escape_scanner.)
static uint64_t string_mask(const uint8_t* block, int len) {
    uint64_t mask = 0;
    bool in_string = false;
    bool escaped = false;
    for (int i = 0; i < len && i < 64; i++) {
        if (block[i] == '\\' && !escaped) { escaped = true; mask |= (in_string ? (1ULL << i) : 0); continue; }
        if (block[i] == '"' && !escaped) in_string = !in_string;
        escaped = false;
        if (in_string) mask |= (1ULL << i);
    }
    return mask;
}

// The structural index: positions of every operator NOT inside a string.
static int build_structural_index(const uint8_t* buf, int len, uint32_t* out) {
    int count = 0;
    for (int base = 0; base < len; base += 64) {
        int chunk = (len - base < 64) ? (len - base) : 64;
        uint64_t ops = classify_block(buf + base, chunk);
        uint64_t strs = string_mask(buf + base, chunk);
        uint64_t structurals = ops & ~strs;
        // Extract set bits (real: uses ctz + clear-lowest-bit in a tight loop)
        while (structurals) {
            int pos = __builtin_ctzll(structurals);
            out[count++] = base + pos;
            structurals &= structurals - 1;
        }
    }
    return count;
}

int main() {
    const char* json = R"({"name":"simdjson","fast":true,"nested":{"x":42}})";
    int len = (int)strlen(json);
    uint32_t index[256];
    int n = build_structural_index((const uint8_t*)json, len, index);
    printf("Input (%d bytes): %s\n", len, json);
    printf("Structural index (%d positions):\n", n);
    for (int i = 0; i < n; i++) {
        printf("  [%2d] pos=%2u  char='%c'\n", i, index[i], json[index[i]]);
    }
    // Demonstrates: the flat index lets stage2 jump directly to any structural
    // element without re-scanning — O(1) access to the i-th operator.
    return 0;
}

// ============================================================================
// SIGNATURE PATTERNS  (sketches — faithful but need not run)
// ============================================================================

// SNP 1 — Architecture dispatch at RUNTIME via a sorted list of implementations.
// Each arch (haswell, icelake, arm64, ...) is a static singleton implementing
// the same virtual interface. On first use, the library picks the best one the
// CPU supports — same binary runs optimally on Haswell AND falls back on
// Westmere. The SIMDJSON_IMPLEMENTATION macro compiles generic code N times.
//   src/implementation.cpp + include/simdjson/implementation.h
namespace sketch_dispatch {
    struct implementation {
        virtual const char* name() const = 0;
        virtual uint32_t required_instruction_sets() const = 0;
        virtual int stage1(const uint8_t*, size_t, /*...*/ int) const = 0;
        bool supported_by_runtime_system() const {
            return (detect_supported_architectures() & required_instruction_sets())
                   == required_instruction_sets();
        }
        static uint32_t detect_supported_architectures(); // cpuid / getauxval
    };
    // Available implementations sorted by priority; first supported one wins.
    // get_active_implementation() -> atomic pointer, swapped once.
}

// SNP 2 — 64 bytes processed per "step", pipelining TWO blocks through
// classify -> scan -> index to hide latency. The structural indexer template
// interleaves block N's bit-extraction with block N+1's SIMD classification,
// saturating execution ports that would otherwise stall.
//   src/generic/stage1/json_structural_indexer.h
namespace sketch_pipeline {
    // template<size_t STEP_SIZE=64>
    // void step(block, reader):
    //   json_block block_1 = scanner.next(in_1);  // SIMD classify 64 bytes
    //   indexer.write(prev_structurals);           // extract bits from PREVIOUS
    //   json_block block_2 = scanner.next(in_2);  // classify NEXT 64 concurrently
    //   indexer.write(block_1.structural_start()); // now extract current
    //   prev_structurals = block_2.structural_start();
    // Two-block interleave keeps both vector and scalar ports busy.
}

// SNP 3 — On-demand (lazy) API: stage1 builds the structural index, but NO
// tree is allocated. Values are parsed only when accessed. The json_iterator
// walks the pre-built index by bumping a token pointer; skipping a subtree is
// O(depth) via matching bracket search over the index — not O(n) re-scan.
//   include/simdjson/generic/ondemand/json_iterator-inl.h
namespace sketch_ondemand {
    struct json_iterator {
        const uint8_t* buf;
        uint32_t* token;        // points into the structural index
        uint32_t* root;
        int depth;
        // Advance to next structural: *++token. No byte scanning.
        // Skip object/array: scan index for matching close bracket at same depth.
        // Parse number/string: only when caller requests the value.
    };
    // The full DOM API (tape_builder) still exists for batch; on-demand is the
    // idiomatic path — it never allocates a tree at all.
}

// ============================================================================
// STRUCTURAL COMMITMENTS
// ============================================================================
// (1) TWO-STAGE PIPELINE: Stage 1 (SIMD character classification + structural
// index) is COMPLETELY separated from Stage 2 / on-demand consumption. The
// structural index is a flat uint32_t[] of byte offsets — the bridge between
// the two halves. This separation means stage1 can be architecture-specific
// SIMD while stage2/on-demand is portable generic code compiled once per arch
// via macro inclusion.

// (2) GENERIC-VIA-INCLUDE architecture: one copy of the parsing logic lives in
// src/generic/. Each architecture (haswell.cpp, arm64.cpp, ...) is a thin
// wrapper that includes the generic code after setting SIMDJSON_IMPLEMENTATION.
// The compiler instantiates it per-arch; no virtual dispatch inside hot loops.
//   src/haswell.cpp: #include <generic/stage1/amalgamated.h>
//   include/simdjson/haswell/ondemand.h: #include "generic/ondemand/amalgamated.h"

// ============================================================================
// GROWTH SEAMS
// ============================================================================
// 1. New CPU architecture: add a directory (e.g., src/rvv-vls/), implement
//    json_character_block::classify() with native SIMD, register a singleton.
//    Generic stage1/stage2/ondemand code is included verbatim.
//
// 2. New on-demand type: extend value_iterator with a new visitor; the index
//    is already built — new types only add consumption patterns, not scanning.
//
// 3. Custom number handling: the number-parsing path (compute_float_64) is
//    templated on WRITER; alternative writers slot in without touching the
//    structural indexer.

// ============================================================================
// NEGATIVE SPACE  (deliberately left out — common to the ecosystem, not DNA)
// ============================================================================
// - Recursive descent tree building (dom::parser/tape) — that is the BASELINE
//   for JSON parsers; the DNA is avoiding it via the structural index.
// - UTF-8 validation — important but standard (lookup4 algorithm is well-known).
// - CMake build system, single-header amalgamation — distribution, not identity.
// - Error codes, padded strings, document streaming — supporting cast.
// - Specific SIMD intrinsic choices (AVX2 vs NEON) — the architecture is that
//   they are PLUGGABLE behind json_character_block::classify(); no single ISA
//   is the DNA.
//
// Rebuild test: a senior dev reading this file knows "64 bytes at a time via
//   SIMD lookup -> bitmask -> flat structural index; string parity via clmul;
//   on-demand walks the index lazily; generic code compiled N times per arch
//   via include; runtime dispatch picks the best." Yes — that IS simdjson.
// Confusion test: this cannot be RapidJSON (recursive scalar descent, eager
//   tree), sajson (single-pass allocation), yyjson (linear alloc but still
//   scalar classification). The SIMD-first structural index is unmistakable.
