# ADR 0002: Wealth tracking and storage direction

- Status: Accepted for the storage direction (section 2) and the sync engine
  (section 3): **PowerSync**, chosen by the owner on 2026-11-18 after the spike.
  Still open: where PowerSync runs (self-hosted or PowerSync Cloud) and the
  other open questions below. The wealth domain model (section 1) and
  household sharing (section 5) remain a direction, decided in their own issues.
  No production migration has run; it needs the owner's explicit go-ahead.
- Date: 2026-11-17, spike report and decision added 2026-11-18
- Deciders: project owner

## Context

Finance is a personal, open-source, "Finary-like" application for managing the
finances of one household: budgets (planned versus actual), savings, projects
and loan costs, and global wealth tracking.

Finary's bank connectors did not work for the institutions in use (a neobank,
two French retail banks, a broker and another investment account). Automatic
aggregation is therefore not a viable base. Finance relies on manual budget and
valuation entry plus file imports (Revolut CSV is implemented; others are
tracked in issue [#8](https://github.com/victorsauter/finance/issues/8)). The
goal is to chart how savings and investments evolve over time.

Current state:

- Local-first React app. Data lives in IndexedDB through Dexie.
- Optional Supabase sync stores **one versioned `AppData` JSON document per
  user** (see [`SUPABASE.md`](../../SUPABASE.md)). `AppData` holds
  `budgetMonths[]` with their income, accounts, expense categories, planned
  expenses and transactions (`src/domain/budget/models.ts`).
- Conflicts between devices are resolved by choosing one of two whole copies;
  there is no per-field merge. Household sharing and realtime are not
  implemented. [`MIGRATION_PLAN.md`](../../MIGRATION_PLAN.md) records the original
  normalized-table proposal that was deliberately deferred.
- Amounts are integer cents.

## Decision (direction, not yet binding)

### 1. Domain model for wealth

Add these concepts alongside the budget domain, all as pure TypeScript with
integer-cent amounts and ISO dates:

- **Account / asset**: type (cash, savings, investment, property, other),
  currency, archived flag. Liabilities (loans) are modelled as negative-balance
  items.
- **Valuation**: account, date, amount. The history of valuations is the source
  of the net worth time series. Missing dates carry the last known value
  forward.
- **Investment**: positions (instrument label, quantity, cost basis) and
  contributions or withdrawals recorded separately from market gains, so
  performance is not confused with deposits.
- **Loan**: principal, rate, term, start date, frequency, insurance, fees,
  optional early repayments. Pure functions derive the amortization schedule,
  remaining principal at any date, and total cost of credit. Remaining principal
  feeds net worth as a liability.
- **Savings goal / project**: target amount and date, linked accounts or
  contributions, projected completion and required monthly saving. A project can
  include a loan to show total cost.

Corresponding issues: net worth [#4](https://github.com/victorsauter/finance/issues/4),
investments [#5](https://github.com/victorsauter/finance/issues/5), loans
[#6](https://github.com/victorsauter/finance/issues/6), goals
[#7](https://github.com/victorsauter/finance/issues/7).

### 2. Move from a single document to per-entity tables

Keep the single-document model for the budget while it is small, but plan to
move to normalized per-entity tables **before wealth history grows**. Reasons:

- Valuation history is append-heavy and unbounded. Re-uploading and re-reading
  the whole document for every new valuation scales badly and bloats the
  offline outbox.
- Whole-document conflict resolution forces users to discard one device's
  changes, which is unacceptable once two people edit the same data.
- Household sharing needs row-level permissions (shared versus private
  accounts); a document per user cannot express that.
- Queries over time ranges, per account, are natural in tables and awkward in a
  blob.
- Entity-level rows give stable ids and `updated_at`/soft deletes for merging.

Migration must be one-time and reversible, preceded and followed by a JSON
backup, and the existing backup format must stay readable.
Tracked in issue [#10](https://github.com/victorsauter/finance/issues/10).

### 3. Sync engine candidates

No engine is chosen. A time-boxed spike should test offline writes, reconnect,
and concurrent edits against Postgres (Supabase). The spike has since run: see
"Spike report" below, which corrects the PowerSync licence in this table.
ElectricSQL was not spiked because it has no official Swift client and no write
path. Candidates:

| Candidate | Strengths | Weaknesses and caveats |
| --- | --- | --- |
| PowerSync | Offline-first with an upload queue; server validates every write, a place for permissions. Postgres-based; documented for several client platforms. | Needs a write API; self-hosted edition is under the FSL license (per the perfin issue below). Additional service to run. |
| ElectricSQL | Postgres-native read sync; reached 1.0 and Apache 2.0 licensed (per the Kanopy blog). | Shapes are single-table, no joins; you design the write path; full local SQL via PGlite adds weight (about 3.7 MB gzip per the blog). |
| TanStack DB layered over a sync source | Backend-agnostic; can sit on top of Electric or PowerSync collections; MIT. | Beta (v0.1.x per the blog); more sync logic to build yourself; server-validated rollback, no built-in CRDTs. |

Also reported in the sources but not shortlisted here: Zero (no offline writes,
which conflicts with the local-first requirement), Turso Sync and LiveStore
(pre-1.0 per the perfin issue).

Selection criteria: offline writes, conflict handling, Postgres and Supabase
fit, self-hosting and license (the project is open source), bundle size,
maturity, and operational burden for a personal deployment. Consider also
keeping Dexie plus a hand-written per-entity sync if no engine justifies its
operational cost.

### 4. Charts

Recharts for time series (see [ADR 0001](./0001-ui-stack.md)); `d3-sankey` is
kept for the cash-flow diagram.

### 5. Household sharing

Introduce a household with members and roles, shared data by default,
optionally private accounts, and row-level security by membership. Requires the
normalized model above. Tracked in issue
[#9](https://github.com/victorsauter/finance/issues/9).

### 6. Open-source references

Use as design references, not as code to copy (all are copyleft or have their
own licenses; check before reusing anything):

- [Sure](https://openalternative.co/compare/sure-am/vs/wealthfolio): community
  fork of Maybe Finance, budgeting plus investment tracking, self-hosted,
  AGPL-3.0 per the comparison page. The claim that the original Maybe project was
  archived in July 2025 comes from project knowledge and was not verified on the
  source page.
- Wealthfolio: desktop investment tracker with a privacy focus, AGPL-3.0 per the
  same page (Rust and Tauri).
- Ghostfolio: open-source wealth management software, named in the same
  comparison but not described on the fetched page; details unverified.

Takeaways to explore: how they model accounts and valuations, how they compute
performance excluding contributions, and how they treat multi-currency.
AGPL-3.0 licensed code must not be copied into a project with an incompatible
license; ideas and data models are fine to learn from.

## Spike report (2026-11-18, issue #10)

Everything below ran on a local Supabase CLI stack with synthetic data. The
production project was not touched, no production migration exists, and the web
app's live sync path is unchanged.

### What was built

- **Entity tables** next to `finance_documents`, which is unchanged:
  `supabase/migrations/20261118120000_finance_entities.sql`, tested by
  `supabase/tests/finance_entities.sql` (run both test files with
  `scripts/test-db.sh`). Tables: `budget_months`, `budget_incomes`,
  `budget_accounts`, `budget_expense_categories`, `budget_expense_items`,
  `imported_transactions`, `user_settings`.
  - Ids are UUIDs generated by the client. `updated_at` is always set by a
    server trigger. Rows are soft-deleted through `deleted_at`; clients have no
    delete right.
  - Every row carries `owner_id`. Row-level security and composite foreign keys
    both use it, so a row can only reference rows of the same owner.
  - Household sharing (issue #9) keeps the column: `owner_id` becomes a
    household id, households are seeded with the user's id so no row is
    rewritten, and the policies switch to a membership check.
  - The names `wealth_accounts`, `wealth_valuations`, `wealth_loans` and
    `wealth_goals` are reserved for section 1 and follow the same conventions.
    They are not created yet.
- **Reversible conversion** in `src/data/entities/` (pure TypeScript, not wired
  into the app): `documentToEntities`, `entitiesToDocument`, and two guarded
  procedures, `migrateDocumentToEntities` and `rollbackEntitiesToDocument`.
  Each returns a JSON backup taken before and one taken after, in the existing
  backup format. The migration refuses to continue unless the document rebuilt
  from the rows equals the original. 299 tests on synthetic documents.
- **Engine spike** in `spikes/powersync/` (service, sync rules, eight scripted
  scenarios, full results in its `README.md`) and a compile check in
  `spikes/powersync-swift6/`.

### PowerSync results

Versions: service `journeyapps/powersync-service` 1.28.3 with Postgres bucket
storage, `@powersync/node` 1.3.1, `@powersync/web` 2.7.0, `powersync-swift`
1.17.0.

| Criterion | Result | What was observed |
| --- | --- | --- |
| Offline write | Pass | Writes are visible locally at once and wait in the upload queue; nothing reaches Postgres while offline. |
| Reconnect | Pass | The queue drained in about 120 ms, a second client of the same user received everything, and the server's `updated_at` came back to the writer. A simulated network failure was retried without loss. |
| Concurrent edit from two clients | Pass, with limits | All clients and the server always converged. The limits are in the next table. |
| Sync rules mirroring RLS | Pass | One stream filtered on `owner_id = auth.user_id()`. User B's local database held none of user A's ids, every write B tried on A's data was refused, and a forged token got a 401. PowerSync reads with a role that bypasses RLS, so these rules are the only read barrier and must change together with the policies. |
| Postgres and Supabase fit | Pass, with caveats | No change to the migrations. Needs logical replication, a publication, a replication role and one replication slot. |
| Swift 6 strict concurrency | Pass (compile only) | Both targets build in Swift 6 mode, one with MainActor default isolation, for macOS, iOS and the simulator, with no warning and no workaround. Nothing was run on a device. |

Concurrent edits, both clients offline, then reconnecting one after the other:

| Case | Outcome |
| --- | --- |
| Same row, same column | The last upload wins, with no signal to either user. |
| Same row, different columns | Both edits are kept. |
| One soft-deletes, the other edits | The edit lands on the deleted row, so the user never sees it again. |
| Both create the same month (different ids) | The unique index rejects the second month, then its children fail their foreign key. That device's month disappears. |
| Both append an income with the same `sort_order` | Both rows are kept with a duplicate `sort_order`. |

A connector that compares the previous value before writing (PowerSync's
`trackPrevious`) detected the first and third cases.

Other findings that shape the design, whichever engine is chosen:

- **The connector is the app's job.** PowerSync supplies the local database, the
  upload queue, the download path and the rollback of rejected writes. The app
  still writes the upload code: telling a temporary error from a permanent one
  (by default one rejected write blocks the queue forever), recording
  rejections for the user, and any conflict detection. There is no conflict
  hook.
- **Uploads are not atomic.** A local transaction arrives as one unit, but
  PostgREST commits each request on its own. A 3,000-row import with one bad row
  left 2,999 rows on the server. An all-or-nothing import or restore needs a
  server function, which is a further migration.
- **Column grants and upsert.** The stock Supabase connector uses `upsert`,
  which our column-level update grants refuse. Plain insert and update work.
- **Numbers.** Integers bound as JavaScript numbers lose precision above 1e15
  in the upload queue. Budget amounts stop at 1e11, so they are safe, but
  `balance_cents` must be bound as BigInt or capped.
- **Timestamps.** With `timestamp_max_precision: milliseconds` they round-trip
  byte for byte in the `toISOString()` form the document uses. The default is
  microseconds.
- **Sign-out.** Without `disconnectAndClear()`, one user's pending write was
  uploaded under the next user's session. With it, pending writes are dropped,
  so the app must refuse to sign out while the queue is not empty.
- **Web cost.** The browser fetched about 590 KiB gzip at runtime, of which
  506 KiB is the SQLite WebAssembly file. Dexie would be replaced by SQLite in
  the browser. Safari, multi-tab behaviour and the PWA offline start were not
  tested.
- **Footprint when self-hosted.** One container, 80 to 170 MiB of memory, bucket
  storage in a second database on the same Postgres server. If the service
  stays down until the replication slot exceeds the WAL limit, it re-replicates
  everything.
- **Licences.** The service is Apache-2.0 since v1.28.0 (2026-11-03) and was
  FSL before, which is what the table in section 3 recorded. The JavaScript
  SDKs, the Swift SDK and the SQLite core extension are Apache-2.0.

Not tested: Safari and iOS Safari, several tabs, the Swift SDK against a running
service, real network loss and token expiry, WAL overflow, upgrades of the
service image, more than about 3,700 rows per user, households, and whether the
production Supabase plan allows the direct database connection that logical
replication needs.

### Comparison with the hand-written fallback

The fallback was compared on paper, since PowerSync passed every criterion. It
is an outbox over `supabase-js` and Dexie on the web, and over `supabase-swift`
2.x and GRDB on the iPhone, pulling rows by `(owner_id, updated_at)`.

| | PowerSync, self-hosted | Hand-written outbox |
| --- | --- | --- |
| Extra service | One container on the Kubernetes cluster, plus a replication role and slot on Supabase | None |
| Monthly cost | None beyond the cluster. PowerSync Cloud instead: free tier that pauses after one to two weeks idle, or 49 USD | None |
| Code to write | Upload connector and error handling, once per platform | The same, plus the download path, the cursor, the local store and the queue, once per platform |
| Web local store | Changes from Dexie to SQLite (about 590 KiB gzip more) | Stays on Dexie |
| Conflict handling | Last write wins by default; compare-before-write is possible | Whatever is written; the same compare-before-write is the natural choice |
| Main risk | A new service to keep running and upgrade; untested in Safari | Two sync engines to get right and keep identical, with the classic pull-cursor pitfalls |

### Decision

The owner chose **PowerSync** on 2026-11-18. Hosting is not decided: the
recommendation is to self-host it on the Kubernetes cluster; PowerSync Cloud is
the alternative. The hand-written outbox is the fallback if PowerSync fails in
a part the spike did not cover (Safari, the Swift SDK on a device, the direct
database connection on the production Supabase plan).

The recommendation that led to it: PowerSync passed every
criterion, all its parts are now Apache-2.0, and it removes the part that would
otherwise be written twice and is hardest to get right on the iPhone: the
download path and the local queue.

Whichever engine is chosen, these follow-ups come before any production
migration:

1. Deterministic ids for a month and for the rows seeded into it, so two devices
   creating the same month offline produce the same rows and not a rejected
   duplicate. The same applies to imported transactions, keyed by `sourceKey`.
2. A server function for all-or-nothing import, restore and first migration.
3. Compare-before-write on upload, with a visible list of rejected or
   overwritten edits. This replaces the whole-copy choice on the Account page.
4. A sign-out rule: refuse while writes are pending.
5. Tighten the blank-name checks, which today only strip spaces while the
   document schema also rejects tabs and other blank characters.

### Replacement for the existing flows

- **Guest mode** stays local and keeps the document format.
- **Enabling sync** on an account converts the local document with
  `migrateDocumentToEntities`, downloads the first backup, uploads the rows,
  then keeps the second backup.
- **Conflicts** stop being a choice between two whole copies. Edits to
  different rows or columns merge. Edits to the same value are detected on
  upload and listed for the user.
- **Backup and restore** keep the document format: export goes through
  `entitiesToDocument`, restore through the server function of follow-up 2.

### Rollback procedure

`finance_documents` is not modified by the migration and stays the source of
truth until the app switches.

1. Before the switch, the app downloads `backupBefore`, the untouched document.
2. To go back after the switch, run `rollbackEntitiesToDocument` on the current
   rows. It returns the rows as JSON and the rebuilt document. Restore that
   document through the existing Backup page, or restore `backupBefore` to
   return to the exact state before the switch.
3. The entity tables can then be emptied or dropped; nothing else depends on
   them. With PowerSync, also drop its publication, replication slot and role
   (`spikes/powersync/scripts/teardown-db.ts` shows the statements).

## Alternatives considered

1. **Keep one document per user indefinitely.** Simplest and already working,
   atomic backups. Rejected as a long-term direction for the reasons in section
   2, but acceptable while the wealth feature set is small.
2. **Rely on bank aggregators.** The targeted institutions are not supported by
   the aggregator the owner tried, so this does not solve the problem.
3. **Adopt a full external product** (self-hosted Sure or Wealthfolio). They
   cover parts of the need, but not the owner's budget model (planned versus
   actual with carry-forward) and would split the data across tools.

## Consequences

- A data migration project is required before or alongside the first wealth
  features; it needs a tested rollback.
- Sync and conflict semantics change from "pick a whole copy" to per-entity
  merging, which changes the Account page conflict flow.
- An additional backend service may be needed depending on the engine.
- Wealth features can start with manual entry inside the existing document as a
  spike if the migration slips, at the cost of rework.

## Open questions

- Where does PowerSync run: self-hosted on the Kubernetes cluster (recommended)
  or PowerSync Cloud? The engine itself is decided.
- Is replacing Dexie by SQLite in the browser acceptable (about 590 KiB gzip
  more, Safari untested)?
- When two devices change the same value offline, is "last one wins, with a
  visible notice" enough, or must the user choose?
- Multi-currency: store currency per account only, or convert at valuation time?
  Which source for rates?
- Price data for investments: manual only, or a licensed provider?
- Valuation granularity: per account only, or per position?
- How is a transaction import linked to account balances (derive balance from
  transactions, or treat valuations as authoritative)?
- Which license for the project (issue
  [#11](https://github.com/victorsauter/finance/issues/11)), given AGPL-licensed
  references and self-hosted sync components under FSL?
- Data retention and encryption at rest for financial history in the cloud.
- Is end-to-end encryption desired for the synced data, and how does it interact
  with server-side validation?

## Source reliability

- [Kanopy Labs: TanStack DB vs ElectricSQL vs Zero](https://kanopylabs.com/blog/tanstack-db-vs-electricsql-vs-zero-sync):
  vendor-adjacent blog. Version numbers, sizes and maturity statements are its
  own and may be outdated. It did not discuss PowerSync trade-offs beyond
  mentioning an adapter.
- [perfin issue 9](https://github.com/emrosas/perfin/issues/9): one maintainer's
  research for a different app (Expo, paid cloud sync). It reflects that
  project's constraints and is a single opinion, not a benchmark.
- [OpenAlternative comparison](https://openalternative.co/compare/sure-am/vs/wealthfolio):
  directory site; license and stack summaries are sparse and auto-generated. It
  does not mention Maybe's archived status or describe Ghostfolio.
  Verify licenses on the projects' repositories before relying on them.
