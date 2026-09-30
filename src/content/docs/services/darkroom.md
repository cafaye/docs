---
title: darkroom
description: Media uploads, variants, and the S3 pipeline — cafaye's image and file service.
---

`darkroom` owns media: uploads, variant generation (thumbnails, resizes, format
conversion), and the S3 pipeline that gets bytes from a client to durable
storage. It is written in **Rust** because it pushes pixels, and it does not
want garbage-collection pauses in the middle of an image encode.

:::caution[Status: not started]
The repository exists and is **empty** — no manifest, no Dockerfile, no code.
There is nothing to install, nothing to run, and no API to call. The page
documents the intended scope so that a reader can tell the difference between
"not built yet" and "not planned".
:::

The intended design is deliberately narrow: **presigned S3 uploads only**, so
bytes move straight from the client to object storage and never through the
service's own process. That keeps the service out of the large-payload path
entirely — its job starts after the upload lands. A presigned-S3-only stub is
the first thing that gets built; variant generation and the rest of the pipeline
follow.

Cloudflare R2 is a target and it is mostly configuration, but four differences
are real and each has bitten somebody: R2's region is `auto` and not a real
region, its endpoint is account-scoped
(`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), it does **not** support
`x-amz-checksum-sha256` as `FULL_OBJECT`, and it rejects ACL headers outright.
The consequence for the design is that a checksum the client sends cannot be
verified by a header on R2 — `darkroom` will have to verify by reading the
object back at complete time. One S3 implementation, two configurations.

- **Repository:** [github.com/cafaye/darkroom](https://github.com/cafaye/darkroom) — created, empty
- **Language:** Rust
- **Namespace / event source:** `darkroom`