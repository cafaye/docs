---
title: darkroom
description: Signed media uploads, tenant-scoped asset variants, and one S3 implementation that also speaks Cloudflare R2.
---

`darkroom` owns media: signed uploads, a tenant-scoped asset registry, and
derived variants. It is written in **Rust** because it pushes pixels, and it does
not want garbage-collection pauses in the middle of an image encode.

:::caution[Status: v0 — signed uploads, variants, and Cloudflare R2]
The three-call upload flow, the tenant-isolated asset registry, variant
generation, idempotent creates, and the transactional outbox insert are **built
and tested**, and the object-storage layer now speaks **Cloudflare R2 through the
same S3 implementation** — one `S3ObjectStore`, two configurations, no
`R2ObjectStore`. There is an `openapi/v1.yaml`, a Dockerfile, a compose stack
and migrations.

**Not built:** audio and video transcoding, thumbnails for non-images, lossy WebP
variants, any CDN or public read URL, malware scanning, the outbox publisher
loop, and the background sweepers (stale-`pending`, idempotency-key retention,
orphaned objects). There is **no live R2 integration test** — nothing in the
repository can reach a real bucket and nothing should — so the R2 rules below
are tested as configuration, credential scope and header shape, and the
end-to-end check against a bucket is a **manual procedure in that repository's
README**.

**`darkroom` exports no OTel signal, and that is a different answer from
"broken".** It has no `opentelemetry` dependency and no exporter; it uses the
Rust `tracing` facade with a JSON subscriber and keeps its own `trace_id` in a
task-local, so the `X-Trace-Id` header, the problem body, and every log line
under the request read the same value — a real correlation story that is not an
OTLP span story. Its log records do reach the stack when it runs, through the
collector's stderr receiver, with no per-language SDK involved. The other
emitters are on `core`'s `error.type` vocabulary; `darkroom` records a
`trace_id` rather than an error class. See [Observability](/observability/).
:::

## The upload flow is three calls, and the bytes never pass through

```
POST /v1/uploads ──▶ 201 { asset: pending, upload_url, storage_key, expires_in_secs }
                            │
   client PUTs bytes ───────┘   straight to object storage
                            │
POST /v1/uploads/{id}/complete ──▶ 200 { asset: ready }
                                   or 409 (object absent) / 422 (checksum mismatch)
```

That is the entire design: a 1 GiB upload is one request to the bucket, not a
stream through an API process that has to buffer it, spool it to disk, and time
out on a slow client. Two tests hold it — the byte counters behind them are
asserted, not assumed.

**Readiness is decided at `complete`, not at presign.** The presign is a promise;
`complete` is the fact, and it is where the object is read back and hashed. That
is also why a checksum works identically on AWS S3 and on R2, which cannot verify
one for you.

**One known cost, stated by the repository rather than hidden:** `complete`
reads the object through `ObjectStore::get`, so a 1 GiB upload is buffered in the
API process at completion time. It is released as soon as it is hashed, and the
hash is available in a streaming form that is tested equivalent to the one-shot
path — but the trait hands over `Bytes`, and the read is what it is.

## Cloudflare R2 is configuration, not a second implementation

There is no `R2ObjectStore`, and that is the point. The two backends differ in
four ways, all of them **request shaping**, and request shaping is entirely below
the storage trait:

| | R2 | how `darkroom` handles it |
| --- | --- | --- |
| region | `auto`; `us-east-1` and `""` alias to it, but SigV4 must be signed as `auto` | an R2 endpoint resolves to `auto`; **a real region is refused at startup**, naming the variable and the value |
| endpoint | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, account-scoped, no global endpoint | always configuration, never a constant; `region=auto` with no endpoint is refused so a bucket-only config cannot silently resolve `s3.amazonaws.com` |
| checksums | SHA-256 is `COMPOSITE` only; `FULL_OBJECT` is offered for CRC-64/NVME | `darkroom` never asks — the object metadata type has no checksum field, and `complete` reads the bytes back |
| ACL headers | rejected outright | never sent |

**The checksum line is the one with a consequence you will feel.** On R2 a
client-supplied checksum cannot be verified by a header, so verification is a
read-back at completion. That is true on S3 too, which is why the read-back is
the only path and there is no per-backend branch.

`S3ObjectStore` is compiled only with `--features s3`, which is the deployment
image's build. **The AWS SDK is not a default dependency at all**, so the default
build cannot construct a real object-storage client — which is what makes "tests
never hit the network" a property of the dependency graph rather than a promise
in a document.

## Running it

:::caution[Port 5432 is a literal here, and it is the trap]
`darkroom/docker-compose.yml` is one of the three that **can** be brought up on
its own, and it publishes Postgres on host `5432` as a literal — the same port a
native PostgreSQL install usually holds. When it collides, the container comes up
**healthy** anyway: the healthcheck is `pg_isready`, which reports a server
accepting connections and does not authenticate. Your command then reaches the
*other* database and fails with `role "darkroom" does not exist`, which reads
like a missing migration and is not one. Check what owns 5432 first.
:::

```sh
# the database, and the service
docker compose up -d
curl -s localhost:8080/healthz
```

There is **no `POSTGRES_PORT` variable** here to move it — the published port is
a literal, and a second compose file's `ports:` list is appended rather than
substituted, so adding one is not the fix. Run one service at a time, or stop
whatever holds 5432.

The image is built from **`docker/Dockerfile`**, not `./Dockerfile`:

```sh
docker build -f docker/Dockerfile --build-arg --features s3 -t darkroom .
```

| Variable | Meaning |
| --- | --- |
| `PORT` | Listen port. `8080`. |
| `DATABASE_URL` | Postgres DSN. The service owns its own database. |
| `DARKROOM_OBJECT_STORE` | `memory` or `s3`. `memory` for development; `s3` is the deployment build. |
| `DARKROOM_S3_BUCKET` · `DARKROOM_S3_ENDPOINT` · `DARKROOM_S3_REGION` | Bucket, account-scoped endpoint, and region. `region` is optional for R2 and defaults to `auto`. |
| `DARKROOM_JWKS_URL` · `DARKROOM_ISSUER` · `DARKROOM_AUDIENCE` | How the caller is authenticated. `darkroom` verifies tokens **locally against identity's key set** and reads `account_id` and scopes from the verified token. |
| `DARKROOM_ENV` | `production` by default. `development` enables the HMAC verifier, which exists only behind `--features dev-auth`. |
| `DARKROOM_LOG_FORMAT` | `human` or a machine format. |

`darkroom` **authenticates locally and consumes no events.** Media is produced by
API calls, not by reacting to another service's events, so `consumes` is omitted
rather than filled with a placeholder. `identity` is a hard runtime requirement —
a token cannot be verified without it — so `dependencies` is omitted rather than
given a `required: false` value, because a field modelling "the service runs
without it, degraded" has no honest value here.

## The gate

`./bin/prime` is green on a bare machine with no Postgres and no Docker, and it
runs **three** tiers — including `cargo test --features s3`, because `cargo test`
does not compile the `s3` feature at all. The database tier is separate:

```sh
./bin/prime          # fmt, build, clippy, test, + the s3 feature
./bin/prime --db     # + the #[ignore]d database tests, against TEST_DATABASE_URL
```

See [Running the gates](/running-the-gates/#darkroom--three-tiers-two-of-them-non-default).

- **Repository:** [github.com/cafaye/darkroom](https://github.com/cafaye/darkroom)
- **Language:** Rust
- **Namespace / event source:** `darkroom` — publishes `darkroom.asset.ready`,
  `darkroom.asset.deleted`, `darkroom.variant.created`
- **Container port:** 8080
