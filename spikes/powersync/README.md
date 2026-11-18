# PowerSync spike (local only)

Time-boxed spike for ADR 0002 section 3: can PowerSync be the sync engine for Finance
(React web client now, SwiftUI iPhone client later, Supabase Postgres back-end)?
Everything ran on one Mac against the local Supabase stack, with synthetic users
(`*@example.invalid`) and synthetic data. No hosted service was contacted.

Run date: 2026-11-18. All 8 scenarios passed in the final run (`results/20261118142309.json`, gitignored).

## Summary

| Criterion | Result | Evidence |
| --- | --- | --- |
| Offline writes | PASS | Scenario 2: writes visible locally at once, held in the upload queue, nothing in Postgres while disconnected. |
| Reconnect | PASS | Scenario 2: queue drained about 120 ms after reconnect, second client of the same user received everything, server `updated_at` and `owner_id` came back. Scenario 4: a simulated network failure was retried and nothing was lost. |
| Concurrent edit convergence | PASS, with caveats | Scenario 3: server and both clients always converged. With the plain connector, same-column edits are last-upload-wins with no signal; edits to a row deleted meanwhile are applied to the deleted row. A compare-and-set connector (`trackPrevious`) detected both cases. |
| Sync rules mirror RLS | PASS | Scenario 5: B's SQLite (checked byte by byte) never held A's ids; B's writes into A's data were all refused by Postgres; a forged HS256 token was refused by PowerSync. |
| Postgres / Supabase fit | PASS, with caveats | No schema change, no Supabase setting change. Needs a replication role with BYPASSRLS, a publication and a replication slot. The demo connector's `upsert` does not work with our column grants (insert is needed). Integers of 16 digits lose precision in the upload queue unless bound as BigInt. |

## How to run (from a clean checkout)

Prerequisites: Docker, Node (run here with Node 26.13.1; the brief said 24), the local Supabase
stack started from the repository root (`npx supabase start`, project id `finance`).

```sh
cd spikes/powersync
npm ci                 # better-sqlite3 and esbuild install scripts are allow-listed in package.json
npm run setup-db       # role, publication, storage database, writes .env (gitignored, random passwords)
docker compose up -d   # PowerSync service 1.28.3, one container
npm run scenarios      # prints PASS/FAIL per scenario with facts; exit code 1 on any failure
npm run web-size       # optional: throwaway Vite build of @powersync/web, prints sizes

# clean up
docker compose down -v
npm run teardown-db    # drops slots, publication, powersync_storage database and both roles
```

`SCENARIOS=2,3` runs a subset. `KEEP_USERS=1` keeps the synthetic users (by default they are
deleted at the end, which cascades to their rows). Keys are read at runtime from
`npx supabase status -o env`; every script refuses non-local hosts.

### What is in this folder

- `docker-compose.yml`, `powersync/service.yaml`, `powersync/sync-config.yaml`: the service.
  It joins the `supabase_network_finance` Docker network, replicates from the local `postgres`
  database and keeps bucket storage in a separate `powersync_storage` database **on the same
  Postgres server** (allowed for Postgres 14+, docs: self-hosted-instances, "Postgres Version
  Requirements"). So the whole PowerSync side is one container. Telemetry is disabled.
- `scripts/setup-db.ts` / `teardown-db.ts`: database-side requirements applied at runtime.
  `wal_level` was already `logical`; nothing in `supabase/` was changed.
- `src/connector.ts`: the backend connector. Downloads use the Supabase access token;
  uploads go through supabase-js/PostgREST as the signed-in user (RLS, grants, constraints and
  triggers apply).
- `src/schema.ts`, `src/harness.ts`, `src/seed.ts` (uses the app's `createSyntheticAppData` and
  `documentToEntities` through the `@/` alias), `src/scenarios/*.ts`, `src/run-all.ts`.
- `web-size/`: throwaway entry for the bundle measurement.

### Sync rules

`powersync/sync-config.yaml` uses Sync Streams (`edition: 3`, the current format): one stream
`owned_rows`, `auto_subscribe: true`, one query per table, each
`SELECT * FROM <table> WHERE owner_id = auth.user_id()`. This mirrors the select policies
(`owner_id = auth.uid()`). It creates one bucket per user. The replication role bypasses RLS, so
these queries are the only read barrier; how they were verified is in scenario 5.
Soft-deleted rows are synced on purpose (other devices must learn about the delete).

## Results per scenario (final run)

### 1. Initial sync

User A seeded with 3,688 rows (36 months, 89 incomes, 54 accounts, 89 categories, 189 items,
3,241 transactions, 1 settings row), from the app's synthetic generator.

| Measure | Value |
| --- | --- |
| Replication of the seed into bucket storage | 1.3 s (7.0 s in the first run, on an idle service) |
| Fresh client, connect to all rows readable | 240 ms and 245 ms (two fresh clients) |
| Client SQLite file after sync | 7.6 MiB (about 2 KiB per row: JSON copy in `ps_data__*` plus `ps_oplog`) |
| `powersync_storage` database | 16 MiB after the first seed; 40 MiB after several runs (ops history of deleted users stays until compaction) |

### 2. Offline write, then reconnect

Disconnected client: one transaction inserting a month, 2 incomes, an account, a category and an
item; then an amount edit and a soft delete. Observed:

- Visible locally at once (2 ms for the 3 local transactions). Queue: 8 entries (6 PUT, 2 PATCH), 160 bytes.
- Before upload the local month has `owner_id = null` and `updated_at = null`: the server fills both and they come back after the checkpoint (`updated_at` came back as `2026-11-18T12:33:30.850Z`, the server value truncated to ms).
- Reconnect to rows in Postgres: 114 ms; to writer settled (queue empty and checkpoint applied): 124 ms.
- The second client of the same user received the month, children, edit and soft delete about 220 ms later.
- The SDK logs `Could not apply checkpoint due to local data. Will retry...` while uploads are pending; expected behaviour, not an error.

### 3. Concurrent edits (same user, both clients offline, first reconnects and settles, then second)

Plain connector ("lww", the behaviour the PowerSync docs describe):

| Case | Server and both clients afterwards | Silently lost? | What the app would have to do |
| --- | --- | --- | --- |
| (a) same row, same column (1111 vs 2222) | 2222 (last upload wins) | Yes: 1111 overwritten, no error | Accept, or detect (see below) |
| (b) same row, different columns (name vs amount) | both kept | No: PATCH carries only changed columns | Nothing |
| (c) soft delete vs edit | row deleted, amount 3333 applied to the deleted row | Yes in practice: the edit is invisible | Detect, or resurrect/ask |
| (d) same (year, month) created twice | first month kept; second rejected 23505 on `budget_months_owner_year_month_live_key`, its child income rejected 23503 | Yes: second month and its children vanish from that device at the next checkpoint | Read `upload_rejections`, re-parent children onto the surviving month, re-submit |
| (e) same `sort_order` appended twice | both incomes kept with `sort_order` 5 | No, but order ambiguous | Tie-break (e.g. by id) or renumber |

All three (server, client 1, client 2) converged in every case.

Compare-and-set connector (`conflictMode: 'detect'`, uses `trackPrevious: true` on the client
tables: a PATCH carries the previous values, the update adds `eq(column, previous)` and
`deleted_at is null`): (a) the second write was rejected as CONFLICT and reverted, 1111 stayed;
(b) still merged, no false conflict; (c) the edit on the deleted row was rejected, the row stayed
deleted with its old amount. All three converged. This needs no server change, but it is code
the app writes; PowerSync itself has no conflict hook (docs: handling-update-conflicts).
Caveat (not tested): compare-and-set on a timestamp column would raise false conflicts, because
clients see timestamps truncated to ms.

### 4. Rejected uploads

Six writes queued offline, then reconnect:

| Write | How it surfaces in the connector (PostgREST error code) |
| --- | --- |
| Insert with negative amount | `23514` check_violation |
| Second live month for the same (year, month) | `23505` unique_violation on the partial index |
| Update of `created_at` (no column grant) | `42501` permission denied |
| Local hard delete (no delete grant) | `42501` permission denied |
| Valid inserts before and after them | landed |

By default an error thrown from `uploadData` makes the SDK retry the same transaction forever
and blocks the queue (docs: client-side-integration, "Error Handling"). Chosen handling:

- Transient (no SQLSTATE: network failure, 5xx, PostgREST connection errors): throw, SDK retries
  (observed: 4 retries in 2 s with `retryDelayMs: 500`, write kept, landed once the network came back).
- Permanent (22xxx, 23xxx, 42501, 42703, PGRST204, an update matching no visible row): record the
  op in a local-only table `upload_rejections`, continue with the rest of the transaction, then
  `complete()`. The queue never blocks (drained in 121 ms). PowerSync then reverts the rejected
  local change at the next checkpoint: the rejected inserts disappeared, `created_at` was
  reverted, the hard-deleted row came back.
- A PUT that hits the primary key (retry after a lost response) is turned into an update of the
  updatable columns, so retries are idempotent.
- Local hard deletes: optional translation into a soft delete (`translateDeletes`), verified.
- The official Supabase demo connector uses `upsert` for PUT. With our column grants it fails
  with `42501` (ON CONFLICT DO UPDATE needs update rights on `id`, `owner_id`...). Use insert.

### 5. Isolation

User B synced, then the raw SQLite file was inspected (bypassing the SDK views): 1 row in the
`ps_data__*` tables, all with B's `owner_id`, one bucket
(`owned_rows|0["<B's user id>"]`), and neither A's user id nor A's month id appears anywhere in
the file bytes (main file and WAL). Then B tried:

| Attempt by B | Result |
| --- | --- |
| Insert carrying A's `owner_id` | `42501` (RLS with check) |
| Insert pointing at A's month | `23503` (composite owner-keyed FK) |
| Insert reusing an id of A's row | `23505` on the primary key, then the update matches no visible row. Leaks that the id exists (uuids make guessing impractical) |
| Direct PostgREST update of A's row | no error, 0 rows (RLS hides it): the connector must check affected rows, which it does with `.select('id')` |
| Direct PostgREST select of A's rows | 0 rows |
| Token with `sub` = A, HS256-signed with the local legacy JWT secret, sent to PowerSync | HTTP 401: only the JWKS (ES256) keys are trusted |

A's row was unchanged on the server.

### 6. Type mapping

| Postgres | Client SQLite | Notes |
| --- | --- | --- |
| `uuid` | text, lowercase | A client that inserts an upper-case uuid gets the row back under the lower-case id: the local id changes. Client ids must be lower-case (`crypto.randomUUID()` is). |
| `bigint` | integer | Download of ±(2^53-1): exact, read as JS number. **Upload: integers bound as JS numbers are stored as REAL in the upload-queue JSON; 431 of 6,500 probed values of 16 digits changed (smallest 1.8e15), e.g. -(2^53-1) reached Postgres as -9007199254740990, silently.** No value below 1e15 changed (budget amounts max 1e11). Binding as `BigInt` is exact. Transaction amounts and balances are allowed up to 2^53-1 by the schema, so the app must bind BigInt or cap at 1e15. |
| `integer` | integer | 2,147,483,647 exact |
| `date` | text `YYYY-MM-DD` | |
| `timestamptz` | text | With `edition: 3` the default is `YYYY-MM-DDTHH:mm:ss.ssssssZ` (observed `...05.678000Z` for a value written as `...05.678Z`). With `timestamp_max_precision: milliseconds` (used here) it is exactly the `toISOString()` shape and a client value round-trips byte-identical. Server `now()` values lose their microseconds on the client (truncated). The docs' type table still shows the older `YYYY-MM-DD hh:mm:ss.sssZ` format. |
| nullable `text` | NULL | Unicode and quotes intact |

A PATCH sends only the changed column, so unchanged values are never rewritten by a client.

### 7. Sign-out / switching user (measured, but lower priority)

- Without clearing: B's pending offline write was uploaded with C's session and became C's row
  (`owner_id` defaults to `auth.uid()`). B's synced rows were removed when C's checkpoint arrived.
- `disconnectAndClear()` exists and empties every synced table, the upload queue, `ps_buckets`,
  `ps_oplog` and, by default, local-only tables (`clearLocal: false` keeps them). A write still
  pending at sign-out is lost: the app must block or warn while the queue is non-empty.

### 8. Large local transactions (extra)

- 3,000-row CSV import in one local transaction: 366 ms locally, 59 KiB of queue. It is handed to
  `uploadData` as one `CrudTransaction`; the connector sent bulk inserts of 1,000 rows. One
  invalid row made its chunk fail and the connector replayed that chunk row by row
  (1,002 requests, 2.2 s). Result: 2,999 rows on the server, not atomic.
- Full restore of a 36-month document (3,669 rows) in one local transaction: 422 ms locally,
  10 requests, 251 ms upload, settled 0.8 s after the write.
- Atomicity: PowerSync preserves the client transaction boundary, but PostgREST has no
  multi-statement transaction, so each request commits on its own. One server transaction per
  client transaction needs an RPC (a SQL function taking the ops), i.e. a migration.

## Collected facts

| Fact | Value | Source |
| --- | --- | --- |
| Service image | `journeyapps/powersync-service:1.28.3` (digest `sha256:effc8cfa...`, 414 MB). 1.29.0 existed only as `-next` on Docker Hub. | `docker image inspect`, Docker Hub tags |
| SDKs | `@powersync/node` 1.3.1, `@powersync/common` 2.5.0, `@powersync/web` 2.7.0, `better-sqlite3` 13.2.0, `@supabase/supabase-js` 2.119.0 | `package-lock.json` |
| Storage engine | Postgres bucket storage (storage version 2), separate database on the Supabase server | `service.yaml`; docs: compatibility, deployment-architecture |
| Licence, service | **Apache-2.0 since v1.28.0 (2026-11-03)**; FSL-1.1-ALv2 up to v1.27.x. Both earlier claims were right at their time. | `powersync-service` LICENSE, commit 574ddbd6 (PR #878), v1.28.0 release notes, image label `org.opencontainers.image.licenses` |
| Licence, JS SDKs | Apache-2.0 | `powersync-js` LICENSE, npm metadata |
| Licence, SQLite core extension | Apache-2.0 | `powersync-sqlite-core` LICENSE |
| Licence, Swift SDK | Apache-2.0 | `powersync-swift` LICENSE |
| Containers | 1 (unified API + replication). Bucket storage can share the Postgres server. | this setup |
| Service memory | about 80-112 MiB idle, peak 171 MiB during the full run (`mem_limit` 512 MiB, `--max-old-space-size=400`) | `docker stats` |
| Postgres requirements | `wal_level=logical` (Supabase default), a role with REPLICATION and BYPASSRLS, publication `powersync`, one replication slot (two during a sync-rules redeploy: observed `powersync_1_*` replaced by `powersync_2_*`) | setup script, service logs |
| WAL retention risk | While the service is down the slot retains WAL. Local Supabase has `max_slot_wal_keep_size = 512MB`; past that the slot is invalidated and PowerSync re-replicates from scratch (manual slot drop needed if it happens during the snapshot). Not reproduced here. | `show max_slot_wal_keep_size`; docs: postgres-maintenance |
| Kubernetes | One Deployment (unified, or API + replication split for HA), a ConfigMap/Secret for the two YAML files and connection strings, an Ingress with `proxy-buffering: off`, liveness on `/probes/liveness`, a daily `compact` CronJob for storage v2. No persistent volume. Not tried. | docs: deployment-architecture |
| Web SDK cost | Fetched at runtime in Chromium with `vfs: 'auto'`: 590 KiB gzip (WASM 506 KiB, JS 84 KiB). The build emits 3.0 MiB gzip in total (all VFS, async and encryption variants). The current app's JS is about 290 KiB gzip, so this roughly triples the download. | `npm run web-size`; served `dist/` and read the server log |
| Browser features | OPFS + dedicated worker (`vfs: 'auto'` picks SimpleOpfsVFS), shared worker for one sync connection across tabs where supported. No COOP/COEP needed: the probe page ran with `crossOriginIsolated = false`. Only the experimental in-memory pool needs cross-origin isolation. | browser check; docs: javascript-web-storage |
| Multi-tab | Supported: tabs share one database and, on desktop browsers, one sync connection through a shared worker (off by default on Safari, iOS, Android, where only one tab syncs). It goes beyond the app's "one editing tab per account" rule, so that rule could be dropped or kept as a product choice. Not tested. | docs: javascript-web-storage |

## What PowerSync does not give

- No per-field merge beyond "a PATCH carries only changed columns", and no conflict-detection
  hook. Detection is the connector's job (shown with `trackPrevious` + compare-and-set).
- No atomic multi-row upload through PostgREST: atomicity needs an RPC.
- No error policy: by default one permanent error blocks the queue forever.
- Server-side validation errors are not reported back to the user: the write just disappears at
  the next checkpoint unless the connector records it.

## What the app would need to build on top of PowerSync

1. A connector like `src/connector.ts`: transient vs permanent classification, a rejection table
   and UI, idempotent PUT (insert, then update on primary-key conflict), affected-row checks,
   DELETE translated to soft delete (or no local deletes at all).
2. A conflict policy: accept last-upload-wins, or compare-and-set on previous values with a UI.
3. Re-parenting for the duplicate-month case (d) and a tie-break for equal `sort_order` (e).
4. BigInt binding (or a 1e15 cap) for transaction amounts and balances.
5. Sign-out guard: block while the upload queue is non-empty, then `disconnectAndClear()`.
6. An RPC if a CSV import or a restore must be all-or-nothing.
7. Operations: one more service, its storage, a replication slot to monitor, a compact job,
   PWA precache rules for the WASM (Workbox's default patterns do not include `.wasm`; not tested).
8. On iOS: the Swift SDK (`spikes/powersync-swift6` only checked that it compiles in Swift 6).

## Not tested

- The web SDK in a real app (only a bundle probe that opened a database); Safari, iOS Safari,
  multi-tab, OPFS failures in private browsing, PWA offline cold start.
- The Swift SDK against this service.
- Real network loss (offline was simulated with `disconnect()`; network failure of uploads was
  simulated by failing supabase-js fetches), token expiry and refresh during long offline periods.
- WAL growth while the service is down, slot invalidation, sync-rules redeploy under load,
  compaction, an upgrade of the service image.
- Volumes beyond about 3,700 rows per user, many users, many concurrent clients.
- Households (rules keyed on membership instead of `owner_id`).
- MongoDB bucket storage, PowerSync Cloud, the PowerSync CLI.

## Surprises and contradictions with the docs

- The service licence changed to Apache-2.0 two weeks before this spike (v1.28.0).
- The type table in the docs gives `YYYY-MM-DD hh:mm:ss.sssZ` for timestamptz; with edition 3 the
  observed default is ISO with microseconds (`...T...ssssssZ`).
- Upload-queue precision loss for 16-digit JS numbers (not mentioned in the docs pages read).
- The official Supabase connector's `upsert` is incompatible with column-level update grants.
- `supabase: true` in `client_auth` only auto-detects hosted projects; local Supabase needs an
  explicit `jwks_uri` (as the docs say for "Supabase local development").
- `npm run lint` at the root is green but oxlint reports nothing for this folder; with the
  worktree under `.claude/worktrees/`, the root `ignorePatterns: [".claude/**"]` may be what skips
  it (not investigated). The spike was type-checked with the root `tsc` instead
  (`../../node_modules/.bin/tsc -p tsconfig.json`, clean).
