/*
 * REPO-DNA: gigatoken
 * Source: https://github.com/marcelroed/gigatoken   Commit/Ref: ecf968d
 * Archetype: High-performance library (Rust + Python bindings via PyO3)
 * The bet: replace the pretokenization regex with hand-written SIMD mask
 *          scanners (one per scheme) that classify 64-byte batches into
 *          bitmasks, then drive the BPE encode loop through a prefetchable
 *          open-addressing cache whose layout is co-designed with the
 *          scanner's output format.
 *
 * This is not the repo. This is its variant fraction — what it does that its
 * peers do not.
 */

// ============================================================================
// REFERENCE GENOME  (the competent default for a BPE tokenizer library in Rust)
// ============================================================================
// A capable engineer would: compile a regex from the tokenizer's pretokenization
// pattern (fancy-regex or regex crate), split text into pretokens, look each up
// in a HashMap<Vec<u8>, Vec<TokenId>>, on cache miss run the standard O(n²)
// priority-queue BPE merge loop, store results in a DashMap for thread safety,
// parallelize with rayon by splitting input on newlines/separators up front,
// expose to Python via PyO3 returning Vec<Vec<u32>>. Throughput: 50-350 MB/s
// multithreaded (tiktoken/HF tokenizers).


// ============================================================================
// THE LOAD-BEARING BET  (reverse it and this becomes a different project)
// ============================================================================
// Pretokenization is NOT delegated to a regex engine. Instead, each tokenizer
// scheme (r50k/cl100k/o200k/deepseek/qwen/...) gets a hand-written SIMD mask
// scanner: 64-byte batches are classified with NEON/AVX-512/AVX2 into per-byte
// bitmasks, token boundaries are derived with shifted-mask algebra in scalar
// registers, and a walker pops one bit per token — zero per-token dispatch
// branches. This eliminates the ~8 cy/token branch-miss floor of regex-based
// scanners. The scanner's output format (packed u128 keys + precomputed hashes)
// feeds DIRECTLY into a co-designed cache that resolves >99% of pretokens in
// one cache-line probe.
//
// Kernel below demonstrates the core idea: SWAR (sub-word parallelism) byte
// classification + bitmask boundary derivation, the mechanism that replaces
// regex for ASCII-dominated text.

fn main() {
    // Demonstrate the mask-scanner principle: classify bytes into character
    // classes using SWAR tricks, derive token boundaries from shifted masks.
    // This is the scalar ground-truth logic that the SIMD path accelerates.

    let input = b"Hello world! It's a test123 end";
    let mut boundaries: Vec<usize> = vec![0]; // token starts

    // The r50k regex: `'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+`
    // The scanner replaces this with class masks + algebra:
    let mut pos = 0;
    while pos < input.len() {
        let end = advance_r50k(input, pos);
        boundaries.push(end);
        pos = end;
    }

    println!("input: {:?}", std::str::from_utf8(input).unwrap());
    println!("pretoken boundaries: {:?}", boundaries);
    print!("pretokens:");
    for w in boundaries.windows(2) {
        let tok = &input[w[0]..w[1]];
        print!(" {:?}", std::str::from_utf8(tok).unwrap_or("<non-utf8>"));
    }
    println!();

    // The key insight: each pretoken gets packed into a u128 key (bytes in low
    // 15 lanes, length in top byte) — one unaligned 16-byte load + mask. The
    // hash of this key prefetches the cache line BEFORE the encode loop needs
    // it, hiding DRAM latency entirely.
    println!("\npacked keys (hex, length-tagged):");
    for w in boundaries.windows(2) {
        let bytes = &input[w[0]..w[1]];
        if let Some(key) = pack_pretoken_key(bytes) {
            let len = (key >> 120) as u8;
            println!("  {:?} -> key len={} low_bits=0x{:016x}",
                std::str::from_utf8(bytes).unwrap_or("?"), len, key as u64);
        }
    }
}

/// Scalar advance for one r50k pretoken: the ground truth that SIMD accelerates.
/// Returns the end position of the pretoken starting at `pos`.
fn advance_r50k(bytes: &[u8], pos: usize) -> usize {
    let b = bytes[pos];
    let len = bytes.len();

    // Apostrophe contractions: 's 'd 'm 't 'll 've 're
    if b == b'\'' && pos + 1 < len {
        let next = bytes[pos + 1] | 0x20; // lowercase
        if matches!(next, b's' | b'd' | b'm' | b't') {
            return pos + 2;
        }
        if pos + 2 < len {
            let nn = bytes[pos + 2] | 0x20;
            if (next == b'l' && nn == b'l')
                || (next == b'v' && nn == b'e')
                || (next == b'r' && nn == b'e')
            {
                return pos + 3;
            }
        }
    }

    // Optional leading space
    let start = pos;
    let mut p = pos;
    if p < len && bytes[p] == b' ' {
        p += 1;
    }
    if p >= len {
        return p;
    }

    let c = bytes[p];
    if c.is_ascii_alphabetic() || c >= 0x80 {
        // Letter run (ASCII fast path; non-ASCII treated as letter)
        p += 1;
        while p < len && (bytes[p].is_ascii_alphabetic() || bytes[p] >= 0x80) {
            p += 1;
        }
        return p;
    }
    if c.is_ascii_digit() {
        // Digit run
        p += 1;
        while p < len && bytes[p].is_ascii_digit() {
            p += 1;
        }
        return p;
    }
    if !c.is_ascii_whitespace() {
        // "Other" run (not letter, not digit, not whitespace)
        p += 1;
        while p < len
            && !bytes[p].is_ascii_alphabetic()
            && !bytes[p].is_ascii_digit()
            && !bytes[p].is_ascii_whitespace()
            && bytes[p] < 0x80
        {
            p += 1;
        }
        return p;
    }

    // Whitespace: if we consumed a space but it's only whitespace ahead, emit
    // the whitespace run (trailing whitespace rule)
    if start < p {
        // The leading space joined something — but the thing after was ws.
        // This is the ` ?[^\s\p{L}\p{N}]+` or the `\s+(?!\S)|\s+` case.
        // For simplicity in this kernel: consume whitespace greedily.
        while p < len && bytes[p].is_ascii_whitespace() {
            p += 1;
        }
        return p;
    }
    // Pure whitespace from pos
    p += 1;
    while p < len && bytes[p].is_ascii_whitespace() {
        p += 1;
    }
    p
}

/// Pack a pretoken of <= 15 bytes into a u128 key: bytes in low 15 lanes,
/// length in the top byte. This is how the encode loop avoids HashMap overhead.
fn pack_pretoken_key(bytes: &[u8]) -> Option<u128> {
    let n = bytes.len();
    if n == 0 || n > 15 {
        return None;
    }
    let mut lanes = [0u8; 16];
    lanes[..n].copy_from_slice(bytes);
    let low = u128::from_le_bytes(lanes);
    Some(low | ((n as u128) << 120))
}


// ============================================================================
// SIGNATURE PATTERNS  (sketches, faithful but need not run)
// ============================================================================

// SNP 1 — Two-phase chunked span pull: the scanner harvests a chunk of 256
// pretoken boundaries into a flat buffer (phase A), then a branch-free counted
// emission loop (phase B) packs each span into a keyed entry with its hash
// pre-staged for L2 prefetch. This decouples the SIMD classify from the
// cache-probing encode, letting the encode loop start with every line already
// in L2. The per-span refill ladder and pack branches of a fused pull loop
// were "the largest single source of encode's discarded issue bandwidth."
//   src/pretokenize/fast/mod.rs — fill_spans_keyed_mask / fill_spans_two_phase

// SNP 2 — 32-byte open-addressing cache with paired slots on one cache line.
// The table is 2 MiB-aligned + MADV_HUGEPAGE'd so the dTLB covers it in a
// few dozen entries. Entry = (key: u128, val: u64, ext: u64) at exactly 32B;
// two entries share one 64B line. Probe is a single-line read with a
// branch-free pair check. Values pack up to 4 token IDs inline (the common
// case: ~98% of pretokens encode to <= 2 tokens). ~99.4% hit rate at 1.3M
// unique pretokens. The encode loop prefetches L2 a chunk ahead AND L1 a
// fixed short distance ahead — two separate prefetch stages.
//   src/bpe/pretoken_cache.rs — ShortPretokenCache, probe_pair, prefetch_l2

// SNP 3 — Fork-sized workers: parallel encoding uses a WorkerPool where each
// worker is a full Tokenizer fork sharing Arc'd model tables but owning its
// own cache, pre-sized via Heaps' law (distinct(n) ≈ 3.45·n^0.62) for its
// expected byte share. This eliminates the 6-7 rehash doublings of a cold
// run and avoids any cross-thread cache contention (no DashMap, no locks on
// the hot path). Workers self-schedule coarse chunks (>= 1 MB) with
// work-stealing.
//   src/bpe/tiktoken.rs — fork_sized; src/batch.rs — WorkerPool


// ============================================================================
// STRUCTURAL COMMITMENTS
// ============================================================================
// (1) ONE PRETOKENIZER PER SCHEME, NOT ONE REGEX — the entire fast/
// directory is a family of hand-written scanners (r50k, cl100k, o200k,
// deepseek_v3, qwen2, qwen3_5, olmo3, kimi, nemotron), each implementing a
// MaskScheme trait with two functions: `advance` (scalar ground truth) and
// `batch_masks` (SIMD 64-byte classifier returning usable/bad bitmasks).
// Adding a new tokenizer means writing its character-class algebra, not
// changing an engine. The mask infrastructure (batch walker, bad-zone
// re-derive, two-phase fill) is shared and scheme-agnostic.
//   src/pretokenize/fast/mask.rs — MaskScheme trait, MaskState

// (2) THE ENCODE LOOP IS A PREFETCH PIPELINE, NOT A LOOKUP LOOP — the
// traditional encode is: for pretoken { cache.get_or_insert(merge(pretoken)) }.
// Gigatoken's is: fill_spans_keyed (prefetch L2 per span) → probe_emit_chunk
// (prefetch L1 D ahead, branchless flat emit, single cold branch for misses).
// The hot path stores 4 token lanes unconditionally and advances the write
// cursor only when the fast predicate holds (~99% of pretokens). Everything
// else (probe walks, arena spills, long pretokens, misses) is #[cold]
// #[inline(never)]. The loop's register allocation is hand-managed (loop-
// invariant raw pointers refreshed only on realloc).
//   src/bpe/tiktoken.rs — probe_emit_chunk, probe_emit_slow


// ============================================================================
// GROWTH SEAMS  (the actual extension surface)
// ============================================================================
// 1. New pretokenizer scheme: implement MaskScheme { advance, batch_masks }
//    in a new src/pretokenize/fast/<scheme>.rs submodule.
//        pub struct FastNewPretokenizer<'a> { bytes: &'a [u8], state: MaskState }
//        impl MaskScheme for NewScheme { fn batch_masks(...) -> (u64, u64); }
//        impl_mask_pretoken_spans!(FastNewPretokenizer, NewScheme);
// 2. New input format: implement DocumentIter for src/input/ + wire into
//    DocFormat enum and for_each_doc dispatcher.
// 3. New merge strategy: the ranked_merges path shows the seam — swap in any
//    merge-priority function that returns (merged_id, rank) per pair.
// 4. Python API surface: add #[pymethods] on BPETokenizer / new #[pyclass]es
//    in src/bindings/ — the Rust encode pipeline is decoupled from bindings.


// ============================================================================
// NEGATIVE SPACE  (deliberately LEFT OUT — common to the ecosystem, not DNA)
// ============================================================================
// - BPE merge loop itself (priority-queue pair merging) — every tokenizer does
//   this; gigatoken's merge_short/merge_symbols are standard O(n²) BPE.
// - PyO3 bindings, Python compatibility shims — distribution, not identity.
// - Rayon parallelism (par_iter, thread pools) — expected for any Rust perf lib.
// - File I/O (mmap, parquet, JSONL, gzip/zstd) — commodity input handling.
// - Special/added token handling (Aho-Corasick matching) — standard in HF/tiktoken.
// - SentencePiece support — an alternate path, not the distinctive one.
//
// Rebuild test: from this DNA a senior dev could reconstruct gigatoken's
//   character — "replace pretokenization regex with per-scheme SIMD mask
//   scanners that output packed keys feeding a hugepage-backed open-addressing
//   cache with two-stage prefetch; fork workers pre-sized by Heaps' law with
//   no shared mutable state." Yes.
// Confusion test: strip the names and this cannot be tiktoken (regex-based,
//   single HashMap, no per-scheme scanners), HF tokenizers (regex + DashMap,
//   no bitmask algebra), or rust-tokenizers (regex dispatch, standard HashMap).
//   The SIMD mask scanner → packed-key cache pipeline is unique. Passes.
