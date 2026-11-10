# Supabase integration

## Delivery status

Implemented on 10 November 2026. Netlify remains the frontend host. PostgreSQL
migrations `20261110123510_finance_schema` and
`20261110123513_finance_documents` have been applied to project
`dqaoxjedszryzgiojreb`. No real financial data was uploaded during implementation.
Frontend release status is tracked by the GitHub PR and Netlify deployment;
database migration alone does not publish the frontend.

This first delivery intentionally uses one versioned JSON document per user,
not the normalized entity tables in the original migration proposal. The
existing version 2 budget and backup format is preserved. This gives atomic
imports/restores and simple recovery, but conflicts are whole-document choices,
not per-field merges. Realtime, household sharing, account deletion UI and
historical server backups are not implemented.

## Before the first production login

1. Open [Auth URL configuration](https://supabase.com/dashboard/project/dqaoxjedszryzgiojreb/auth/url-configuration).
   Set Site URL to `https://finance.victorsauter.com`. Add these exact redirect
   URLs for the environments you will use:
   - `https://finance.victorsauter.com/account`
   - `https://vs-finance.netlify.app/account`
   - `http://localhost:5173/account` (local development only)
   - `http://127.0.0.1:4173/account` (local production preview only)
   Add any different development port explicitly; do not wildcard all production
   domains. The app requests the current origin plus `/account`.
2. Verify the Email provider is enabled. Default templates provide a magic link.
   To also support the code input, add `{{ .Token }}` to the Magic Link template
   and the signup confirmation template used for new users, while retaining
   `{{ .ConfirmationURL }}` if you want links too.
3. Check email delivery. The default Supabase sender is restricted to project
   team email addresses and is heavily limited. Configure a custom SMTP provider
   before inviting other users. SMTP credentials belong in Supabase settings,
   never in this repository or the browser. Follow the provider's sender-domain
   verification instructions; do not change unrelated domain/email records.
4. Rotate the database password previously shared in chat. It is not used by the
   app and has not been placed in the source or frontend configuration.

See the official [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls),
[email templates guide](https://supabase.com/docs/guides/auth/auth-email-templates)
and [SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp).
Dashboard configuration and real email delivery have not been verified by the
automated browser tests, which use isolated Auth/Data API fixtures.

## Build and deployment configuration

Only these **public browser values** are required:

```dotenv
VITE_SUPABASE_URL=https://dqaoxjedszryzgiojreb.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<the project's sb_publishable_ key>
```

Use `.env.local` locally; it is ignored by Git and Docker. `.env.example` is a
template. Never add a database password, service-role key, secret API key or SMTP
password. Without both variables, the app remains local-only.

`netlify.toml` provides the connected project's public configuration for
production, `npm run build`, output `dist`, SPA fallback routes and no-cache
service-worker responses. Deploy previews and branch deploys deliberately have
empty cloud variables. Netlify UI overrides must not reconnect previews to
production. Use a separate staging project for cloud previews.

After the Auth configuration is ready, publish the reviewed Git changes through
the existing Netlify deployment. A rebuild is required when changing Vite
variables. Do not migrate DNS or create a Kubernetes load balancer for this.

## First use and migration

1. Export a JSON backup from **Backup** on each existing device/origin. Guest
   data from localhost, a Netlify subdomain and a custom domain are separate.
2. Open **Account**, enter your email, then open the sign-in link on this device
   or enter the email code. Signing in alone uploads nothing.
3. For an empty cloud account, choose **Import guest budgets and enable sync**.
   Review the counts and confirm. A local JSON backup is downloaded first.
   Alternatively, enable sync with the account's current local budgets.
4. If the cloud account already has data, choose its cloud budgets. The app
   backs up the current account cache and refuses to automatically overwrite
   remote budgets with guest data. Import another device's JSON only through
   **Backup**, with its explicit replacement confirmation.
5. Wait for **Sync status: synced**. Sign into the same account on the other
   device, then explicitly enable/download the cloud copy there as well.
6. Sign-out returns to the unchanged guest cache. Account data and pending edits
   stay in that account's separate local cache; signing back into the same
   account resumes it. Signing into another account does not expose it in the UI.

## Sync and conflict behaviour

- Each account uses IndexedDB database `finance-user-<user UUID>`. Guest data
  stays in `finance`; legacy guest migration never runs inside an account cache.
- A durable coalescing outbox retains the exact pending payload and mutation ID
  until acknowledgement. Newer edits create a subsequent snapshot after the
  pending one is acknowledged. A lost network response can safely be retried.
- Saves use a compare-and-swap revision and transactional idempotency receipt.
  If another device saved first, neither version is silently overwritten.
- **Account** exposes both JSON copies and explicit **Use cloud copy** or
  **Keep local copy** choices, with backup downloads before replacement. Review
  the exports: this version does not merge unrelated changes automatically.
- Refresh occurs on focus, reconnect, visible-tab return, every 30 seconds and
  **Sync now**. This is not instantaneous Realtime collaboration.
- Local save status and cloud sync status are distinct. Offline edits stay
  pending; do not clear browser data while changes are pending or in error.
- Only one tab per account/browser can edit where Web Locks is supported. A
  second tab asks you to close the first and reload. On older browsers without
  Web Locks, manually keep one tab open. Different devices still use revision
  conflict handling.
- Reset, JSON restore and deletion are real account changes after sync is
  enabled. They propagate to other devices. Sync is not historical backup.
- Original CSV files stay on-device; confirmed structured transactions,
  descriptions and source filenames are part of the synced document.

## Database security and limitations

RLS permits authenticated users to select only their own `finance_documents`
row. Direct inserts, updates and deletes are revoked. The only write interface,
`save_finance_document`, derives the owner from `auth.uid()` and accepts no
caller-supplied owner. The client pins the checked account's JWT on every data
request so an account switch cannot send an old snapshot under a new session.

The SECURITY DEFINER RPC uses an empty search path, owner-scoped lock, expected
revision, generated JSON Schema validation and relational checks for duplicate
IDs, transaction source keys, references and amounts. Documents are limited to
10 MB. All document/receipt updates happen in one transaction.

Supabase's security advisor reports the authenticated SECURITY DEFINER RPC and
the receipt table's RLS-without-policy setup. These are intentional boundaries:
the RPC must own writes because clients have no table write grants; receipts
have no client grants or policies and are accessible only inside the RPC. The
SQL tests exercise those boundaries. Do not grant clients receipt-table access
or direct document writes to silence advisory notices.

Isolation is enforced by PostgreSQL, not by the publishable key. This is not
end-to-end encryption. A signed-in browser can read its own account data, and
local caches/session tokens are not encrypted separately from the browser
profile. Use private browsing on shared devices. Public email signup, if enabled
in Auth, lets each new user create their own isolated document; this is not a
single-owner signup allowlist.

Receipts are retained for retry correctness; storage will grow with saves.
Monitor database size and usage. Do not prune receipts casually while devices
can still retry old mutations. Large datasets and high-frequency edits should
move to a separately designed normalized sync protocol. No paid resources or
SMTP subscriptions were provisioned by this implementation.

## Validation and recovery

```sh
npm ci
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser cloud tests need the public Vite variables enabled at build time; they
intercept all Supabase requests and send no real emails. The existing local-only
tests still run without cloud configuration. The iPhone project emulates mobile
Chromium, not Safari. Verify real Safari and a real email link during rollout.

Validation at delivery: 39 unit/integration tests and 24 desktop/mobile browser
tests passed; lint and production build succeeded. `npm audit --omit=dev`
reported no runtime dependency vulnerabilities. The full audit still reports
seven transitive build-tool findings (three low, four moderate); those require
a separate compatible tooling update, not a forced downgrade. Vite also warns
that the main client chunk exceeds 500 kB; account/transactions routes are lazy,
but further vendor splitting is deferred.

`supabase/tests/finance_documents.sql` tests owner isolation, anonymous denial,
direct-write denial, CAS conflicts, idempotency and malformed/relationally
invalid payloads. Run with an owner connection in a disposable/staging project:

```sh
psql "$FINANCE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/finance_documents.sql
```

All fixtures are synthetic and wrapped in a transaction ending in `ROLLBACK`.
The test was also executed against the connected empty project with no retained
users/documents. Migration filenames match that project's applied history; do
not reapply them blindly. On a new project, apply both migrations in order.
Generated client contracts are in `src/data/cloud/database.types.ts`.

`scripts/generate-cloud-schema.mjs` regenerates the initial JSON Schema from
Zod for reproducibility. Once deployed, schema changes need a **new migration**;
do not edit/reapply historical migrations to upgrade a live database.

Before first production import, export guest JSON. During rollout, verify a
real two-device edit, offline edit/reconnect, conflict resolution and JSON
restore using disposable budgets. Automated unit tests cover these sync
failures, but do not replace the real email/device acceptance check.

Keep regular JSON exports outside the browser and establish project-level
backups appropriate to your Supabase plan. To recover an accidental change,
export both current copies first, then restore a known-good JSON through
**Backup** and wait for synced. A database restore requires an independent
administrator procedure and careful client-cache reconciliation.

For frontend rollback, first export every account's current/pending local copy.
Redeploy the previous frontend or rebuild without cloud variables to return to
guest-only mode; do not drop tables or clear account caches. Existing guest
IndexedDB and version 2 JSON backups remain compatible. A rollback stops future
frontend sync but cannot undo already-synced edits; recover those from backups.
