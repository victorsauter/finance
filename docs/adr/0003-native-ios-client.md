# ADR 0003: Native iPhone client in SwiftUI

- Status: Accepted
- Date: 2026-11-18
- Deciders: project owner

## Context

Finance is used on a computer and on an iPhone. The web app (React, see
[ADR 0001](./0001-ui-stack.md)) works on both, but the owner wants the iPhone
experience to feel native: fluid scrolling and transitions, system controls,
haptics and the iOS 26 Liquid Glass look. The project is also a place to learn
current technology and agent-assisted development, and maintaining two
front-ends is acceptable.

A one-screen SwiftUI prototype of the budget screen (`ios/`) was built and
installed on the owner's iPhone. The owner judged it clearly better than the
web app on the phone and chose to continue with it.

## Decision

Build a native iPhone app in SwiftUI and keep the web app for desktop use. Both
share the same Supabase back-end.

| Concern | Choice | Notes |
| --- | --- | --- |
| iPhone UI | SwiftUI, iOS 26 minimum, Swift 6 | System tab bar, toolbars and sheets; Swift Charts. |
| Desktop UI | Existing web app | Unchanged; phone-specific web polish is no longer a priority. |
| Back-end | Supabase (auth and data) | Shared by both clients. |
| Repository | One repository, app under `ios/` | Web tooling ignores `ios/`; Swift has its own checks. |
| Domain logic | Mirrored in Swift for live totals | Kept equal to TypeScript by shared JSON fixtures read by both test suites. |
| Heavy logic | One place, web and server side | CSV import, loan schedules and net-worth series are not ported to Swift. |
| Local data on iPhone | `budget.json` behind a repository protocol, synced as the web's single document | Same `finance_documents` row and `save_finance_document` RPC as the web; see "Sync" below. |
| Distribution | Free Apple personal team for now | Reinstall every 7 days; no TestFlight or push notifications. |

### Sync (updated 2026-11-18)

The iPhone app syncs exactly like the web app today: one JSON document per user
(`AppData` schema v2) in `public.finance_documents`, read under row-level
security and written only through `save_finance_document` (compare-and-swap on
an integer revision, idempotent on a mutation id). Sign-in uses an email code,
as on the web; supabase-swift keeps the session in the Keychain. Signed out,
the app works on the phone's data only.

The rules mirror `CloudBudgetRepository` on the web and live in FinanceKit's
`SyncEngine`, behind a `RemoteDocumentStore` protocol so they are tested
without a network:

- pull when nothing local is unsynced; otherwise push after a short pause,
  retrying with the same mutation id until the server acknowledges it;
- on a revision conflict, the user keeps one whole copy ("Keep this iPhone's
  copy" or "Keep the cloud copy"), as on the web;
- on first sign-in, an existing cloud copy replaces untouched sample data, and
  otherwise only after an explicit choice; sample data is never uploaded over
  a cloud copy without that choice;
- a cloud copy with a newer schema, or one that fails to decode, is never
  written.

This was chosen over waiting for ADR 0002 because the app has a single user,
used on one device at a time, and no hosted service beyond Supabase is wanted.
PowerSync was spiked and declined because it needs a hosted sync service.
Entity tables remain a later step, needed for a growing wealth history and for
household sharing (ADR 0002); when they land, the iPhone moves with the web.

## Alternatives considered

- **Web app only (PWA).** No second code base, but it cannot match native
  scrolling, navigation, haptics or system materials. Rejected after comparing
  with the prototype on a real device.
- **Expo / React Native for the iPhone app.** The serious second choice: one
  language, native tabs, and a path to Android. Rejected because Android is not
  needed and SwiftUI gives direct access to every iOS API without a bridge.
- **Expo "universal" rewrite (one code base for web and iPhone).** Rejected:
  it would discard the web UI that was just rebuilt, and desktop tables and
  drag and drop are weaker there.
- **Capacitor wrapper around the web app.** Rejected: it is still a web view.
- **Flutter or Kotlin Multiplatform.** Rejected: no benefit for an iPhone-only
  app, and neither renders with the system's own controls.
- **SwiftData with iCloud sync.** Rejected: the web app could not read the data.
- **Waiting for the entity tables and a sync engine of ADR 0002.** First
  chosen, then reversed: with one user on one device at a time, the existing
  single document already gives safe sync and offline edits. PowerSync was
  spiked and declined because it needs a hosted service. The single-document
  sync code is small and will be replaced when entity tables land.

## Consequences

Positive:

- Native feel on iPhone, with new iOS features available as they ship.
- The web app can focus on desktop layouts.
- A clear seam (the repository protocol) between screens and storage.

Negative and risks:

- Two front-ends to maintain, and budget calculations exist twice. Shared
  fixtures reduce, but do not remove, the risk of drift.
- Sync is whole-document: two devices editing at the same time end in a
  conflict where one whole copy wins. Acceptable for one person on one device
  at a time; not suitable for household sharing.
- The local toolchain is Xcode 26.3 on macOS 15, which does not officially
  support iOS 27 devices. It works today; if it stops, the fix is macOS 26.6 or
  later with Xcode 27.
- Free provisioning expires after 7 days and cannot share the app with another
  person; household sharing (issue #9) will need the paid program.

Recovery: the web app and its data format are untouched by this decision, so
removing `ios/` restores the previous state.
