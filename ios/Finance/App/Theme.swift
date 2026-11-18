import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// Colours taken from the web tokens in `src/index.css`.
enum Theme {
    static let primary = Color(hex: 0x526FFF)
    static let saving = Color(hex: 0x35B995)

    static let brand = LinearGradient(
        colors: [Color(hex: 0x4F7CFF), Color(hex: 0x765EFF), Color(hex: 0x9558F6)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    private static let categoryColors = [
        Color(hex: 0x5C72F2), Color(hex: 0xF16C88), Color(hex: 0xFFB84F),
        Color(hex: 0x8A5CFF), Color(hex: 0x4FC6FF),
    ]

    static func categoryColor(at index: Int) -> Color {
        categoryColors[index % categoryColors.count]
    }
}

/// Grouped background with the two soft brand glows of the web page.
struct PageBackground: View {
    var body: some View {
        ZStack(alignment: .top) {
            Color(.systemGroupedBackground)
            Circle()
                .fill(Color(hex: 0x4F7CFF).opacity(0.22))
                .frame(width: 340, height: 340)
                .blur(radius: 90)
                .offset(x: -130, y: -150)
            Circle()
                .fill(Color(hex: 0x8A5CFF).opacity(0.18))
                .frame(width: 300, height: 300)
                .blur(radius: 90)
                .offset(x: 150, y: -90)
        }
        .ignoresSafeArea()
    }
}
