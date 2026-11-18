# Finance MCP server

A small local [MCP](https://modelcontextprotocol.io) server that lets Claude
Code read, and with safeguards edit, the owner's finance document (the same
`AppData` the web and iPhone apps sync through Supabase). It runs on the Mac
over stdio, signed in as the owner, and is never hosted. Decision record:
[ADR 0004](../../docs/adr/0004-local-mcp-server.md).

It reuses the web app's code directly: `src/domain/budget` (schema, totals,
factories, ordering), `src/domain/transactions` and
`src/data/cloud/SupabaseTransport.ts`. Node runs the TypeScript as is (type
stripping); `src/register.ts` only teaches Node the web code's extensionless
imports. Nothing here is bundled into the web build.

## Setup

```sh
npm ci
npm run mcp:login     # email, then the code from the email (existing account only)
npm run mcp:status    # checks the stored session
```

`mcp:login` stores the Supabase refresh token and user id in the macOS login
Keychain (service `finance-mcp`, account `default`), nowhere else. The token
is written through `security -i` on stdin, so it never appears in a process
list. Supabase rotates refresh tokens: every refresh is written back to the
Keychain. The Supabase URL and publishable key come from `VITE_SUPABASE_URL`
and `VITE_SUPABASE_PUBLISHABLE_KEY`, or else from the production context of
`netlify.toml`. No service-role key is ever used: the server only sees what
row-level security lets the owner see.

Sign out (revokes the session, then removes the Keychain item):

```sh
npm run mcp:logout
# or remove the item by hand:
security delete-generic-password -s finance-mcp -a default
```

## Run and register

`.mcp.json` at the repository root registers the server for this project:

```json
{ "mcpServers": { "finance": { "command": "npm", "args": ["run", "--silent", "mcp:start"] } } }
```

Claude Code asks once to approve it. `npm run --silent mcp:start` keeps stdout
for the protocol; logs go to stderr. Without a stored session the server exits
with status 1 and the message `Sign in once from a terminal in the repository:
npm run mcp:login`.

To try the tools by hand: `npx @modelcontextprotocol/inspector npm run --silent mcp:start`.

| Variable | Effect |
| --- | --- |
| `FINANCE_MCP_READ_ONLY=1` | Write tools are not registered at all (not even listed). |
| `FINANCE_MCP_BACKUP_DIR` | Backup folder (default `~/Library/Application Support/Finance/mcp-backups/`). |
| `FINANCE_MCP_KEYCHAIN_SERVICE` | Keychain service name (default `finance-mcp`). |

For a read-only registration, set `"env": { "FINANCE_MCP_READ_ONLY": "1" }` in
`.mcp.json` (or a local copy of it).

## Tools

Amounts are integer cents plus a formatted string (`{cents, formatted}`).
Lists are paginated with `limit` (default 50, max 200) and `offset`, and return
`total` and `nextOffset`. Outputs are compact JSON text.

Read (annotated `readOnlyHint: true`):

| Tool | Purpose |
| --- | --- |
| `list_months` | Months with a budget or transactions, planned vs spent, uncategorised count |
| `get_budget(month)` | Incomes, accounts, categories and items with ids, summary (`calculateBudgetSummary`) and actuals |
| `list_categories(month?)` | Category id, name and month |
| `list_transactions(month?, from?, to?, category?, text?, kind?)` | Transactions with kind and category; `category` = id, name or `none` |
| `list_uncategorized(month?)` | Expenses without a category |
| `merchant_summary(from?, to?, kind?, uncategorized_only?)` | Grouped by normalised description: count, total, kind, category (or `mixed: ...`), dates |
| `spending_by_category(from, to)` | Spending by category name, with planned amounts |
| `monthly_totals(from, to)` | Planned and actual per month |
| `list_backups` | Local backups, newest first |

Write (annotated `destructiveHint: true`), transaction classification first:

| Tool | Purpose |
| --- | --- |
| `categorize_by_description(matches[{description, categoryName or categoryId}], from, to, overwrite?)` | Categorise every matching expense, category resolved by name per month |
| `set_transaction_category(ids[], categoryId or null)` | By id |
| `set_kind_by_description(matches[{description, kind}], from, to)` | E.g. mark pocket moves as `transfer` |
| `set_transaction_kind(ids[], kind)` | By id |
| `set_planned_amount(month, itemId, amountCents)` | Planned amount of an expense item |
| `add_expense_item(month, categoryId, name, amountCents)` | New item at the end of a category |
| `rename_item(month, itemId, name)` | Income, account, category or expense item |
| `delete_item(month, itemId)` | Expense item only |
| `restore_backup(file)` | Replace the whole document with a backup |

### Definitions

- **Spending** (same rules as the web month summary,
  `src/features/transactions/month-summary.ts`): EUR transactions only, dated
  by `bookingDate`. `amountCents` is signed as on the statement (negative =
  money out). An `expense` with a negative amount counts `-amountCents`; every
  transaction's `feeCents` counts; `income` and `transfer` rows are not
  spending; a positive `expense` (refund left as expense) adds nothing.
  `spending_by_category` puts expenses without category in `(uncategorised)`
  and fees of income/transfer rows in `(fees on income and transfers)`.
- **Merchant**: the description lower-cased, without accents and punctuation
  (`normalizeText` of the CSV importer). `categorize_by_description` and
  `set_kind_by_description` match the whole normalised description.
- **Categories belong to one month.** A transaction's category must be one of
  its own month's categories (enforced by `schema.ts`, the web app and
  `set_transaction_category`). `categorize_by_description` resolves the
  category by name in each transaction's month; a `categoryId` is turned into
  its name first. If any month lacks the category (or has two with that name)
  nothing is applied and the missing months are listed. Only expenses get a
  category; existing categories are kept unless `overwrite: true`.
- **Kind**: setting `income` or `transfer` clears the category, as in the web app.

### How the importer sets `kind` (and what to fix)

`inferKind` in `src/domain/transactions/revolut-csv.ts` (the iPhone app does
not import CSV):

- positive amount: `income`, whatever the type, so money coming back from a
  pocket or savings vault, reverted card payments and refunds are `income`;
- negative amount whose Revolut type contains `exchange`, `top up`, `topup`,
  `transfer` or `virement`: `transfer` (pocket and vault moves, transfers to
  other accounts, currency exchanges);
- any other negative amount: `expense`, including loan repayments and
  reversals booked as `REVERTED` or similar.

So loan repayments, transfers to your own accounts without a transfer type,
and returns from pockets usually need `set_kind_by_description` (or
`set_transaction_kind`) to `transfer`. `merchant_summary` and
`list_transactions` show `kind` (and the Revolut `type`) for that.

## Safeguards

- Every write tool has `dry_run`, **default true**: it returns a short
  before/after diff (grouped by merchant for the by-description tools) and
  writes nothing.
- With `dry_run: false`: the document and its revision are read, the change
  is applied to a copy with the domain functions, validated with
  `parseAppData`, then a backup of the **pre-write** document is saved
  (folder 0700, file 0600, name with timestamp and revision, newest 30 kept).
  If the backup fails, nothing is written. Then only `save_finance_document`
  is called, with the revision read and a new mutation id.
- Revision conflict (the web or iPhone app saved in between): the call fails
  with `Data changed elsewhere (revision N). Re-read first (e.g. get_budget)
  and redo the change.` Nothing is retried; the backup just taken stays (it is
  a copy of what was read).
- At most 200 changed transactions/items per call; unknown ids, a category of
  another month or an unresolved category fail the whole call.
- A budget edit sets that month's `updatedAt`, as the web app does;
  transaction edits do not.
- `restore_backup` only accepts a bare file name listed by `list_backups`
  (no paths), validates the file with `parseAppData`, backs up the current
  document, then writes the backup with the current revision. It is the only
  whole-document write and is not subject to the 200 cap.

## Restore a backup

Ask Claude for `list_backups`, then `restore_backup` with the file (dry run
first, then `dry_run: false`). Without Claude: the files are JSON
`{savedAt, revision, reason, data}`; save the `data` value as its own JSON
file (for example `jq .data backup.json > restore.json`) and restore it from
the web app's **Backup** page.

## Privacy

Nothing is hosted: the server runs on this Mac and talks only to Supabase.
But every tool result (amounts, merchant names, categories) becomes part of
the Claude conversation and is sent to the AI provider like anything else you
type. Use `FINANCE_MCP_READ_ONLY=1` if you only want analysis. Backups stay in
the local folder above.

## Tests

`npm test` runs `tools/mcp/test/*` in a Node environment with synthetic data
(`fixtures/domain/app-data.json` plus generated rows), a fake document store
that mimics the RPC compare-and-swap, temporary backup folders and an injected
`security` runner. No test touches the network, the Keychain or the home
folder. `tsc -b` (part of `npm run build`) type-checks `tools/mcp` through
`tools/mcp/tsconfig.json`.
