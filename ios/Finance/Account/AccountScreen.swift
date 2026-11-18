import FinanceKit
import SwiftUI
import UniformTypeIdentifiers

/// Cloud sync sign-in, backup, restore and reset.
struct AccountScreen: View {
    private struct PendingImport {
        let fileName: String
        let data: AppData
    }

    private struct Notice: Equatable {
        let id = UUID()
        let text: String
        let isError: Bool

        static func success(_ text: String) -> Notice { Notice(text: text, isError: false) }
        static func failure(_ text: String) -> Notice { Notice(text: text, isError: true) }
    }

    @Environment(BudgetStore.self) private var store
    @Environment(SyncController.self) private var sync
    @State private var isImporting = false
    @State private var isExporting = false
    @State private var exportDocument: BackupDocument?
    @State private var pendingImport: PendingImport?
    @State private var isConfirmingReset = false
    @State private var notice: Notice?

    var body: some View {
        NavigationStack {
            Form {
                if let notice {
                    Section { noticeView(notice) }
                }

                CloudSyncSection()

                Section("On this iPhone") {
                    LabeledContent("Budget months", value: store.data.budgetMonths.count.formatted())
                    LabeledContent("Transactions", value: store.data.importedTransactions.count.formatted())
                }

                Section {
                    Button("Import a backup", systemImage: "square.and.arrow.down") {
                        isImporting = true
                    }
                    Button("Export a backup", systemImage: "square.and.arrow.up", action: export)
                } header: {
                    Text("Backup")
                } footer: {
                    Text("Backups are the JSON files of the web app's Backup page, so data moves both ways.")
                }

                // Hidden while signed in so sample data can never reach the cloud.
                if !sync.isSignedIn {
                    Section {
                        Button("Reset to sample data", systemImage: "arrow.counterclockwise", role: .destructive) {
                            isConfirmingReset = true
                        }
                        .tint(.red)
                    } footer: {
                        Text("Signed out, your budget is stored on this iPhone only. Export a backup now and then, and before resetting.")
                    }
                }
            }
            .navigationTitle("Account")
            .fileImporter(isPresented: $isImporting, allowedContentTypes: [.json], onCompletion: didPick)
            .fileExporter(
                isPresented: $isExporting,
                document: exportDocument,
                contentType: .json,
                defaultFilename: "finance-\(Date().formatted(.iso8601.year().month().day()))",
                onCompletion: didExport
            )
            .confirmationDialog(
                "Replace your current data?",
                isPresented: Binding(
                    get: { pendingImport != nil },
                    set: { if !$0 { pendingImport = nil } }
                ),
                titleVisibility: .visible,
                presenting: pendingImport
            ) { pending in
                Button("Replace data", role: .destructive) { replace(with: pending) }
            } message: { pending in
                Text("\(count(pending.data.budgetMonths.count, "budget")) and \(count(pending.data.importedTransactions.count, "transaction")) from \u{201C}\(pending.fileName)\u{201D} will replace what is on this iPhone\(sync.isSignedIn ? " and in the cloud" : ""). Export a backup first if you want to keep it.")
            }
            .confirmationDialog("Reset to sample data?", isPresented: $isConfirmingReset, titleVisibility: .visible) {
                Button("Reset to sample data", role: .destructive) {
                    withAnimation(.smooth) { store.resetToSampleData() }
                    notice = .success("The sample data is back.")
                }
            } message: {
                Text("All budgets and transactions on this iPhone are replaced by made-up sample data.")
            }
            .sensoryFeedback(notice?.isError == true ? .error : .success, trigger: notice)
        }
    }

    // MARK: Actions

    private func export() {
        do {
            exportDocument = try store.backupDocument()
            isExporting = true
        } catch {
            notice = .failure("The backup could not be created: \(error.localizedDescription)")
        }
    }

    private func didExport(_ result: Result<URL, any Error>) {
        switch result {
        case .success: notice = .success("The backup has been saved.")
        case .failure(let error) where (error as? CocoaError)?.code == .userCancelled: break
        case .failure(let error): notice = .failure("The backup could not be saved: \(error.localizedDescription)")
        }
    }

    private func didPick(_ result: Result<URL, any Error>) {
        switch result {
        case .failure(let error):
            notice = .failure("The file could not be opened: \(error.localizedDescription)")
        case .success(let url):
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                // The cap is checked on the size first so a huge file is never loaded.
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= BackupFile.maxBytes else { throw BackupError.tooLarge }
                let imported = try BackupFile.decode(Data(contentsOf: url))
                pendingImport = PendingImport(fileName: url.lastPathComponent, data: imported)
            } catch {
                notice = .failure(error.localizedDescription)
            }
        }
    }

    private func replace(with pending: PendingImport) {
        withAnimation(.smooth) { store.replaceData(with: pending.data) }
        notice = .success(
            "\(count(pending.data.budgetMonths.count, "budget")) and \(count(pending.data.importedTransactions.count, "transaction")) restored."
        )
    }

    private func count(_ number: Int, _ noun: String) -> String {
        "\(number) \(noun)\(number == 1 ? "" : "s")"
    }

    // MARK: Pieces

    private func noticeView(_ notice: Notice) -> some View {
        Label(
            notice.text,
            systemImage: notice.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"
        )
        .foregroundStyle(notice.isError ? Color.red : Color.green)
    }
}
