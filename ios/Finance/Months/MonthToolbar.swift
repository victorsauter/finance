import SwiftUI

/// Calendar button plus previous and next arrows, shared by the screens that
/// follow the selected month.
struct MonthToolbar: ToolbarContent {
    @Environment(BudgetStore.self) private var store
    @Binding var isPickingMonth: Bool

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button("Choose month", systemImage: "calendar") { isPickingMonth = true }
            Button("Previous month", systemImage: "chevron.left") { step(-1) }
                .disabled(!store.canStep(-1))
            Button("Next month", systemImage: "chevron.right") { step(1) }
                .disabled(!store.canStep(1))
        }
    }

    private func step(_ delta: Int) {
        withAnimation(.smooth) { store.step(delta) }
    }
}

private struct MonthPickerSheetModifier: ViewModifier {
    @Environment(BudgetStore.self) private var store
    @Binding var isPresented: Bool

    func body(content: Content) -> some View {
        content.sheet(isPresented: $isPresented) {
            MonthPickerSheet(year: store.selected.year)
                .presentationDetents([.medium])
        }
    }
}

extension View {
    /// Presents the month picker as a sheet.
    func monthPickerSheet(isPresented: Binding<Bool>) -> some View {
        modifier(MonthPickerSheetModifier(isPresented: isPresented))
    }
}
