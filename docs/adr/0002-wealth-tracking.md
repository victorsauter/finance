# ADR 0002: Wealth tracking and storage direction

- Status: Proposed
- Date: 2026-11-17
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
and concurrent edits against Postgres (Supabase). Candidates:

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

- Which engine, or none (hand-written per-entity sync on Dexie and Supabase)?
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
