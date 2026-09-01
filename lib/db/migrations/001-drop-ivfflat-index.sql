-- Migration for a database created before the index fix.
--
-- The original schema created an ivfflat index with lists = 32 over a 27-chunk
-- corpus. ivfflat probes one list per query by default, and with that many lists
-- over that few rows most lists are empty, so retrieval returned 8 candidates at
-- best and frequently zero. Measured recall@5 was 0.23 against 0.79 for plain
-- BM25 on the same golden set.
--
-- Dropping it restores an exact scan, which on a corpus this size is instant.

drop index if exists doc_chunks_embedding_idx;
