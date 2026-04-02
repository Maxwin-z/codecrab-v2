import SwiftUI

struct RoleAvatar: Identifiable {
    let id: String
    let label: String
    var path: String { "/avatars/role-\(id).webp" }
    func url(serverURL: String) -> URL? {
        URL(string: "\(serverURL)/avatars/role-\(id).webp")
    }
}

let ROLE_AVATARS: [RoleAvatar] = [
    RoleAvatar(id: "ceo",                  label: "CEO"),
    RoleAvatar(id: "cto",                  label: "CTO"),
    RoleAvatar(id: "cfo",                  label: "CFO"),
    RoleAvatar(id: "coo",                  label: "COO"),
    RoleAvatar(id: "product-manager",      label: "产品经理"),
    RoleAvatar(id: "engineer",             label: "工程师"),
    RoleAvatar(id: "designer",             label: "设计师"),
    RoleAvatar(id: "data-analyst",         label: "数据分析师"),
    RoleAvatar(id: "sales-director",       label: "销售总监"),
    RoleAvatar(id: "sales-rep",            label: "销售专员"),
    RoleAvatar(id: "marketing-manager",    label: "市场经理"),
    RoleAvatar(id: "marketing-specialist", label: "市场专员"),
    RoleAvatar(id: "cs-manager",           label: "客服经理"),
    RoleAvatar(id: "customer-service",     label: "客服专员"),
    RoleAvatar(id: "hr-manager",           label: "HR 经理"),
    RoleAvatar(id: "finance-analyst",      label: "财务分析师"),
]

// Reusable view that renders an agent emoji string: either a text emoji or an AsyncImage for /avatars/ paths
struct AgentAvatarView: View {
    let emoji: String
    let size: CGFloat

    private var serverURL: String {
        UserDefaults.standard.string(forKey: "codecrab_server_url") ?? ""
    }

    var body: some View {
        if emoji.hasPrefix("/avatars/"), let url = URL(string: "\(serverURL)\(emoji)") {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    Color.gray.opacity(0.2)
                }
            }
            .frame(width: size, height: size)
            .clipped()
        } else {
            Text(emoji)
                .font(.system(size: size * 0.6))
                .frame(width: size, height: size)
        }
    }
}

struct AvatarPickerSheet: View {
    @Binding var selectedEmoji: String
    @Environment(\.dismiss) var dismiss
    @State private var selectedTab = 0

    private var serverURL: String {
        UserDefaults.standard.string(forKey: "codecrab_server_url") ?? ""
    }

    let emojis = ["🤖","✍️","🎬","🔍","📊","🌐","📝","🎨","💻","📱",
        "🧠","🎯","📚","🔬","🎵","🏗️","💡","🔒","🌈","⚡",
        "🚀","🦀","🐍","🦊","🐳","🐧","🦅","🐝","🦋","🍎",
        "💎","🔮","🎪","🏰","🎲","🧩","🔭","🧪","⚙️","🛠️",
        "📡","🗂️","📦","🏷️","✏️","🗃️","💼","🎓","🌍","🌙",
        "☀️","⛅","🌊","🔥","💧","🌿","🍀","🌸","🌺","🎸"]

    var body: some View {
        NavigationView {
            TabView(selection: $selectedTab) {
                emojiGrid
                    .tabItem { Label("Emoji", systemImage: "face.smiling") }
                    .tag(0)
                roleAvatarGrid
                    .tabItem { Label("角色头像", systemImage: "person.crop.square") }
                    .tag(1)
            }
            .navigationTitle("选择头像")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            if selectedEmoji.hasPrefix("/avatars/") {
                selectedTab = 1
            }
        }
    }

    private var emojiGrid: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 6), spacing: 20) {
                ForEach(emojis, id: \.self) { emoji in
                    Button(action: {
                        selectedEmoji = emoji
                        dismiss()
                    }) {
                        Text(emoji)
                            .font(.largeTitle)
                            .frame(width: 44, height: 44)
                            .background(selectedEmoji == emoji ? Color.accentColor.opacity(0.15) : Color.clear)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(selectedEmoji == emoji ? Color.accentColor : Color.clear, lineWidth: 2)
                            )
                            .cornerRadius(8)
                    }
                }
            }
            .padding()
        }
    }

    private var roleAvatarGrid: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 16) {
                ForEach(ROLE_AVATARS) { role in
                    Button(action: {
                        selectedEmoji = role.path
                        dismiss()
                    }) {
                        VStack(spacing: 4) {
                            AsyncImage(url: role.url(serverURL: serverURL)) { phase in
                                switch phase {
                                case .success(let image):
                                    image.resizable().aspectRatio(contentMode: .fill)
                                default:
                                    Color.gray.opacity(0.2)
                                }
                            }
                            .frame(width: 64, height: 64)
                            .clipped()
                            .overlay(
                                Rectangle()
                                    .stroke(role.path == selectedEmoji ? Color.accentColor : Color.clear, lineWidth: 2)
                            )

                            Text(role.label)
                                .font(.caption2)
                                .foregroundColor(.primary)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
    }
}
