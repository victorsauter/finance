import SwiftUI

/// Bottom banner offering to undo the last deletion for a few seconds.
private struct UndoBanner: ViewModifier {
    @Environment(BudgetStore.self) private var store

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom) {
                if let notice = store.undoNotice {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(notice.noun) deleted")
                                .font(.subheadline.weight(.semibold))
                            Text(notice.name)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Button("Undo") {
                            withAnimation(.smooth) { store.undoRemoval() }
                        }
                        .fontWeight(.semibold)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .glassEffect(.regular, in: .capsule)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: notice.id) {
                        try? await Task.sleep(for: .seconds(8))
                        withAnimation(.smooth) { store.dismissUndo(notice.id) }
                    }
                }
            }
            .animation(.smooth, value: store.undoNotice?.id)
            .sensoryFeedback(.warning, trigger: store.undoNotice?.id) { _, new in new != nil }
    }
}

extension View {
    func undoBanner() -> some View {
        modifier(UndoBanner())
    }
}
