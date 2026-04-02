import SwiftUI

struct CreateAgentView: View {
    @Environment(\.dismiss) var dismiss
    @State private var agentName: String = ""
    @State private var selectedEmoji: String = "🤖"
    @State private var showEmojiPicker = false
    @State private var isCreating = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            // Avatar display
            Button(action: { showEmojiPicker = true }) {
                AgentAvatarView(emoji: selectedEmoji, size: 120)
                    .background(Color(UIColor.secondarySystemBackground))
                    .cornerRadius(24)
            }

            // Name input
            VStack(spacing: 8) {
                TextField("Agent Name", text: $agentName)
                    .font(.title2)
                    .multilineTextAlignment(.center)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .frame(maxWidth: 280)

                Text("Give your agent a unique name")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }

            Spacer()

            // Buttons
            HStack(spacing: 16) {
                Button("Cancel") { dismiss() }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(UIColor.secondarySystemBackground))
                    .cornerRadius(10)

                Button(action: createAgent) {
                    if isCreating {
                        ProgressView()
                    } else {
                        Text("Create")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(agentName.isEmpty ? Color.accentColor.opacity(0.5) : Color.accentColor)
                .foregroundColor(.white)
                .cornerRadius(10)
                .disabled(agentName.isEmpty || isCreating)
            }
            .padding(.horizontal)
            .padding(.bottom)
        }
        .navigationTitle("New Agent")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showEmojiPicker) {
            AvatarPickerSheet(selectedEmoji: $selectedEmoji)
        }
    }

    private func createAgent() {
        isCreating = true
        errorMessage = nil
        Task {
            do {
                struct CreateReq: Encodable { let name: String; let emoji: String }
                let req = CreateReq(name: agentName, emoji: selectedEmoji)
                let _: Agent = try await APIClient.shared.fetch(path: "/api/agents", method: "POST", body: req)
                dismiss()
            } catch let error as APIClient.APIError {
                switch error {
                case .httpError(409):
                    errorMessage = "An agent with this name already exists"
                case .httpError(400):
                    errorMessage = "Invalid agent name"
                default:
                    errorMessage = error.localizedDescription
                }
                isCreating = false
            } catch {
                errorMessage = error.localizedDescription
                isCreating = false
            }
        }
    }
}
