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
| Local data on iPhone | A local store behind a repository protocol | Replaced by the sync engine chosen in [ADR 0002](./0002-wealth-tracking.md). |
| Distribution | Free Apple personal team for now | Reinstall every 7 days; no TestFlight or push notifications. |

The native app connects to Supabase only after the normalized data model and
sync engine of ADR 0002 (issue #10) are in place. Until then it works on data
stored on the phone.

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
- **Starting the native app on the single-document format.** Rejected: its
  sync code would be thrown away when ADR 0002 lands.

## Consequences

Positive:

- Native feel on iPhone, with new iOS features available as they ship.
- The web app can focus on desktop layouts.
- A clear seam (the repository protocol) between screens and storage.

Negative and risks:

- Two front-ends to maintain, and budget calculations exist twice. Shared
  fixtures reduce, but do not remove, the risk of drift.
- Until the app is connected, edits made on the iPhone do not reach the web.
- The local toolchain is Xcode 26.3 on macOS 15, which does not officially
  support iOS 27 devices. It works today; if it stops, the fix is macOS 26.6 or
  later with Xcode 27.
- Free provisioning expires after 7 days and cannot share the app with another
  person; household sharing (issue #9) will need the paid program.

Recovery: the web app and its data format are untouched by this decision, so
removing `ios/` restores the previous state.
