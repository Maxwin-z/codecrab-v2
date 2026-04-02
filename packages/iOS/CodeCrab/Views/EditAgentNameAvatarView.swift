import SwiftUI

struct EditAgentNameAvatarView: View {
    let agent: Agent
    var onSaved: (Agent) -> Void

    @Environment(\.dismiss) var dismiss
    @State private var agentName: String = ""
    @State private var selectedEmoji: String = "🤖"
    @State private var showEmojiPicker = false
    @State private var isSaving = false
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

                Text("Change the name or avatar of your agent")
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

                Button(action: saveAgent) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Text("Save")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(agentName.isEmpty ? Color.accentColor.opacity(0.5) : Color.accentColor)
                .foregroundColor(.white)
                .cornerRadius(10)
                .disabled(agentName.isEmpty || isSaving)
            }
            .padding(.horizontal)
            .padding(.bottom)
        }
        .navigationTitle("Edit Agent")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            agentName = agent.name
            selectedEmoji = agent.emoji
        }
        .sheet(isPresented: $showEmojiPicker) {
            AvatarPickerSheet(selectedEmoji: $selectedEmoji)
        }
    }

    private func saveAgent() {
        isSaving = true
        errorMessage = nil
        Task {
            do {
                struct PatchReq: Encodable { let name: String; let emoji: String }
                let req = PatchReq(name: agentName, emoji: selectedEmoji)
                let updated: Agent = try await APIClient.shared.fetch(
                    path: "/api/agents/\(agent.id)", method: "PATCH", body: req
                )
                onSaved(updated)
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
                isSaving = false
            } catch {
                errorMessage = error.localizedDescription
                isSaving = false
            }
        }
    }
}
