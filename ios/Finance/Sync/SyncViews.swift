import FinanceKit
import SwiftUI

/// The "Cloud sync" section of the Account tab.
struct CloudSyncSection: View {
    @Environment(SyncController.self) private var sync
    @State private var email = ""
    @State private var code = ""

    var body: some View {
        Section {
            switch sync.account {
            case .unavailable:
                Text("Cloud sync is not configured in this build.")
                    .foregroundStyle(.secondary)
            case .signedOut:
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .onSubmit(sendCode)
                Button("Email me a sign-in code", systemImage: "envelope", action: sendCode)
                    .disabled(!email.contains("@") || sync.isWorking)
            case .codeSent(let address):
                Text("Enter the code sent to \(address).")
                TextField("Code", text: $code)
                    .textContentType(.oneTimeCode)
                    .keyboardType(.numberPad)
                    .submitLabel(.go)
                    .onSubmit(verify)
                    .accessibilityLabel("Sign-in code")
                Button("Sign in", systemImage: "person.badge.key", action: verify)
                    .disabled(code.filter(\.isNumber).count < 6 || sync.isWorking)
                Button("Use another email") {
                    code = ""
                    sync.cancelCode()
                }
            case .signedIn(let address):
                LabeledContent("Signed in as", value: address)
                statusRow
                actions
                Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    Task { await sync.signOut() }
                }
                .tint(.red)
                .disabled(sync.isWorking)
            }
            if sync.isWorking {
                ProgressView().frame(maxWidth: .infinity)
            }
            if let error = sync.authError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Cloud sync")
        } footer: {
            Text(footer)
        }
    }

    private var footer: String {
        switch sync.account {
        case .signedIn:
            "Your budget syncs with the web app as one whole copy. Changes made offline upload when the network returns."
        case .unavailable:
            "Your budget stays on this iPhone."
        default:
            "Sign in with a one-time code sent by email, no password. Without an account, your budget stays on this iPhone."
        }
    }

    private var statusRow: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(sync.statusText, systemImage: sync.statusSymbol)
            if let date = sync.lastSynced, sync.status == .synced {
                Text("Last synced \(date.formatted(.relative(presentation: .named)))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Sync status: \(sync.statusText)")
    }

    @ViewBuilder private var actions: some View {
        switch sync.status {
        case .needsFirstUpload:
            Button("Upload this iPhone's budget", systemImage: "icloud.and.arrow.up") {
                sync.uploadThisIPhone()
            }
        case .needsCloudChoice, .conflict:
            Button("Choose which copy to keep", systemImage: "exclamationmark.icloud") {
                sync.isDecisionPostponed = false
            }
        case .unsynced, .error, .offline, .blocked:
            Button("Try again", systemImage: "arrow.clockwise") { sync.syncNow() }
        default:
            EmptyView()
        }
    }

    private func sendCode() {
        guard email.contains("@") else { return }
        Task { await sync.sendCode(to: email) }
    }

    private func verify() {
        Task {
            await sync.verify(code: code)
            if sync.authError == nil { code = "" }
        }
    }
}

/// Asks which whole copy to keep: on first sign-in when the cloud already
/// has a different budget, or after a conflict. Same choice as on the web.
struct SyncDecisionSheet: View {
    let decision: SyncController.Decision
    @Environment(SyncController.self) private var sync
    @Environment(BudgetStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var isConfirmingUpload = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Image(systemName: "exclamationmark.icloud")
                        .font(.largeTitle)
                        .foregroundStyle(Theme.primary)
                        .accessibilityHidden(true)
                    Text(title)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                    Text(message)
                    VStack(alignment: .leading, spacing: 8) {
                        copyRow("This iPhone", months: store.data.budgetMonths.count,
                                transactions: store.data.importedTransactions.count, symbol: "iphone")
                        if let cloud {
                            copyRow("Cloud", months: cloud.budgetMonths, transactions: cloud.transactions, symbol: "icloud")
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 16))

                    buttons
                }
                .padding(24)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Decide later") { dismiss() }
                }
            }
            .confirmationDialog("Replace the cloud copy?", isPresented: $isConfirmingUpload, titleVisibility: .visible) {
                Button("Replace the cloud copy", role: .destructive) { choose(sync.uploadThisIPhone) }
            } message: {
                Text("The budget in the cloud is replaced by this iPhone's data, on every device. Export a backup from the web first if you might need it.")
            }
        }
    }

    private var cloud: CloudSummary? {
        switch decision {
        case .firstSignIn(let summary): summary
        case .conflict(let summary): summary
        }
    }

    private var title: String {
        switch decision {
        case .firstSignIn: "This account already has a budget"
        case .conflict: "Both copies changed"
        }
    }

    private var message: String {
        switch decision {
        case .firstSignIn:
            "The budget in the cloud differs from the one on this iPhone. Keep one whole copy: the other is replaced."
        case .conflict:
            "The cloud copy changed since this iPhone last synced, and this iPhone has changes too. Keep one whole copy: the other is replaced."
        }
    }

    @ViewBuilder private var buttons: some View {
        VStack(spacing: 12) {
            Button {
                choose(sync.useCloudCopy)
            } label: {
                Text("Keep the cloud copy").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityHint("Replaces the budget on this iPhone with the cloud copy.")

            Button(role: .destructive) {
                if case .firstSignIn = decision {
                    isConfirmingUpload = true
                } else {
                    choose(sync.uploadThisIPhone)
                }
            } label: {
                Text("Keep this iPhone's copy").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .accessibilityHint("Replaces the cloud copy with the budget on this iPhone.")
        }
    }

    private func choose(_ action: () -> Void) {
        action()
        dismiss()
    }

    private func copyRow(_ name: String, months: Int, transactions: Int, symbol: String) -> some View {
        Label {
            VStack(alignment: .leading) {
                Text(name).font(.headline)
                Text("\(months) budget months, \(transactions) transactions")
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: symbol)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Small notice at the top of the Budget tab while something is not synced.
struct SyncBadge: View {
    @Environment(SyncController.self) private var sync

    var body: some View {
        if let badge = sync.badge {
            Label(badge.text, systemImage: badge.symbol)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.fill.tertiary, in: .capsule)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel("Sync: \(badge.text)")
        }
    }
}
