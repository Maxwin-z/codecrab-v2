# iOS Feature Alignment Plan

以下是 web app 已有但 iOS 端缺失的功能，每个 Task 可独立分配实现。

---

## Task 1 — Role Avatar 支持（创建/编辑 Agent 时）

### 背景
Web 端在创建和编辑 Agent 时提供两个标签页：Emoji + 角色头像图片（16 个职能角色，如 CEO、工程师、设计师等）。
iOS 端目前只有 Emoji 选择，无角色头像。

### 要修改的文件
- `CodeCrab/Views/CreateAgentView.swift`
- `CodeCrab/Views/EditAgentView.swift`（如果也有头像选择入口，见 Task 2）
- 新建 `CodeCrab/Views/AvatarPickerSheet.swift`（可复用的 sheet 组件）

### 实现细节

**1. 角色头像数据**

角色头像图片从 server 静态路径加载（与 web 端一致）：
```
{serverURL}/avatars/role-ceo.webp
{serverURL}/avatars/role-cto.webp
... 共 16 个
```

定义角色头像数据（对应 `roleAvatars.ts`）：
```swift
struct RoleAvatar: Identifiable {
    let id: String
    let label: String
    var url: String { "\(APIClient.shared.baseURL)/avatars/role-\(id).webp" }
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
```

**2. AvatarPickerSheet 组件**

新建可复用的 sheet，包含两个 Tab：
- **Emoji** Tab：现有 6 列 emoji 网格（复用已有逻辑）
- **角色头像** Tab：4 列网格，每格显示 AsyncImage + 标签，URL 从 server 加载

```swift
// AvatarPickerSheet.swift
// Binding: selectedEmoji: String (当选 emoji 时设 emoji 字符，选角色头像时设 "/avatars/role-{id}.webp")
// enum AvatarType { case emoji(String), role(String) }
```

选中状态：被选中的 emoji/头像有蓝色边框高亮，与 web 一致。

**3. Agent 数据模型扩展**

当用户选择角色头像时，传给服务端的 `emoji` 字段值为 `/avatars/role-{id}.webp`（与 web 端行为一致）。
`AgentCard` 中渲染时判断：如果 `agent.emoji` 以 `/avatars/` 开头，用 `AsyncImage` 加载；否则显示文本 emoji。

**4. 修改 CreateAgentView**

将现有的 emoji 选择 sheet 替换为 `AvatarPickerSheet`。

**依赖**：需确认 `APIClient.shared.baseURL` 可访问（已有）。

---

## Task 2 — Agent 独立"编辑名称和头像"入口

### 背景
Web 端侧边栏每个 Agent 行有两个独立操作：
1. **UserPen 图标** → 只修改名称 + 头像（轻量 Dialog，PATCH `/api/agents/{id}`）
2. **Pencil 图标** → 编辑 Role Definition（chat-based，完整的 EditAgentView 流程）

iOS 端 `ProjectListView` 的 context menu "Edit" 只有一个入口，直接跳 Role Definition 编辑，无法单独改名或换头像。

### 要修改的文件
- `CodeCrab/Views/ProjectListView.swift` — context menu 拆成两项
- 新建 `CodeCrab/Views/EditAgentNameAvatarView.swift` — 轻量 sheet

### 实现细节

**1. 新建 EditAgentNameAvatarView**

与 `CreateAgentView` 结构相同，差异：
- 标题："编辑 Agent"
- 预填充当前 `agent.name` 和 `agent.emoji`
- 按钮文字："保存"，API 改为 `PATCH /api/agents/{agentId}`，body `{ name, emoji }`
- 包含 Task 1 的 `AvatarPickerSheet`（名称 + 头像一起改）
- 成功后回调刷新 agents 列表

```swift
struct EditAgentNameAvatarView: View {
    let agent: Agent
    var onSaved: (Agent) -> Void
    // 同 CreateAgentView 结构，预填充 agentName = agent.name, selectedEmoji = agent.emoji
}
```

**2. 修改 ProjectListView context menu**

将现有 `Label("Edit", ...)` 拆成两个：
```swift
.contextMenu {
    Button {
        agentToEditNameAvatar = agent   // 触发 sheet
    } label: {
        Label("编辑名称和头像", systemImage: "person.crop.circle")
    }
    Button {
        Task { await startEditingAgent(agent) }  // 现有逻辑
    } label: {
        Label("编辑 Role Definition", systemImage: "pencil")
    }
    Divider()
    Button(role: .destructive) {
        deleteAgent(agent)
    } label: {
        Label("删除", systemImage: "trash")
    }
}
.sheet(item: $agentToEditNameAvatar) { agent in
    EditAgentNameAvatarView(agent: agent) { updated in
        // 刷新列表中对应 agent
        if let idx = agents.firstIndex(where: { $0.id == updated.id }) {
            agents[idx] = updated
        }
    }
}
```

新增 state：`@State private var agentToEditNameAvatar: Agent?`

---

## Task 3 — Session Paused Banner（暂停状态提示）

### 背景
当 agent 遇到 rate limit、API overloaded、usage limit 时，server 会广播 `session_paused` WebSocket 消息。
Web 端显示黄色 Banner，说明原因，并提供"Continue"按钮（发送 `continue_session` WS 消息）。
iOS 端的 `WebSocketService` 目前没有处理 `session_paused` 消息，`ChatView` 也没有对应 UI。

### 要修改的文件
- `CodeCrab/Services/WebSocketService.swift` — 解析 `session_paused`，新增状态和方法
- `CodeCrab/Views/ChatView.swift` — 在 `bottomControlsSection` 插入暂停 Banner

### 实现细节

**1. WebSocketService 扩展**

新增发布属性：
```swift
@Published var sessionPaused: Bool = false
@Published var pauseReason: String? = nil   // "rate_limit" | "overloaded" | "usage_limit"
@Published var pausedPrompt: String? = nil
```

在 `handleMessage` 中新增 case：
```swift
case "session_paused":
    let pauseReason = json["pauseReason"] as? String
    let pausedPrompt = json["pausedPrompt"] as? String
    self.sessionPaused = true
    self.pauseReason = pauseReason
    self.pausedPrompt = pausedPrompt
    self.isRunning = false
```

在收到 `turn:close` 或新 session 时重置：
```swift
// 在 newChat() 和 resumeSession() 末尾
self.sessionPaused = false
self.pauseReason = nil
self.pausedPrompt = nil
```

新增 `continueSession()` 方法：
```swift
func continueSession() {
    guard !projectId.isEmpty, !sessionId.isEmpty else { return }
    sessionPaused = false
    pauseReason = nil
    pausedPrompt = nil
    isRunning = true
    send(["type": "continue_session", "projectId": projectId, "sessionId": sessionId])
}
```

**2. ChatView 暂停 Banner**

在 `bottomControlsSection` 顶部（Summary Banner 之前）插入：

```swift
if wsService.sessionPaused {
    HStack(spacing: 10) {
        Image(systemName: "pause.circle.fill")
            .foregroundColor(.yellow)
        VStack(alignment: .leading, spacing: 2) {
            Text("Session Paused")
                .font(.subheadline.weight(.semibold))
            Text(pauseReasonLabel(wsService.pauseReason))
                .font(.caption)
                .foregroundColor(.secondary)
            if let prompt = wsService.pausedPrompt,
               !prompt.isEmpty {
                Text(prompt.count > 100 ? String(prompt.prefix(100)) + "…" : prompt)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
        }
        Spacer()
        Button(action: { wsService.continueSession() }) {
            Label("Continue", systemImage: "play.circle.fill")
                .font(.subheadline.weight(.medium))
        }
        .tint(.yellow)
        .buttonStyle(.borderedProminent)
    }
    .padding()
    .background(Color.yellow.opacity(0.12))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.yellow.opacity(0.4), lineWidth: 1))
    .cornerRadius(10)
    .padding(.horizontal)
    .padding(.top, 4)
}
```

辅助方法：
```swift
private func pauseReasonLabel(_ reason: String?) -> String {
    switch reason {
    case "rate_limit":   return "Rate limit reached"
    case "overloaded":   return "API temporarily overloaded"
    case "usage_limit":  return "Usage limit reached"
    default:             return "Session paused"
    }
}
```

---

## Task 4 — Session 删除

### 背景
Web 端 SessionSidebar 中每个 session 行 hover 时显示垃圾桶按钮，可删除 session（`DELETE /api/sessions/{sessionId}`）。
iOS 端 `SessionListView` 目前没有删除操作。

### 要修改的文件
- `CodeCrab/Views/SessionListView.swift`

### 实现细节

在 `ForEach(sessions)` 上添加 `.swipeActions(edge: .trailing)`：

```swift
ForEach(sessions) { session in
    NavigationLink(...) {
        SessionRowView(...)
    }
    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
        Button(role: .destructive) {
            deleteSession(session)
        } label: {
            Label("删除", systemImage: "trash")
        }
    }
}
```

新增删除方法：
```swift
private func deleteSession(_ session: SessionInfo) {
    Task {
        do {
            try await APIClient.shared.request(
                path: "/api/sessions/\(session.sessionId)",
                method: "DELETE"
            )
            withAnimation {
                sessions.removeAll { $0.sessionId == session.sessionId }
            }
        } catch {
            print("Failed to delete session: \(error)")
        }
    }
}
```

`APIClient.request` 方法若尚不存在（只有 `fetch`），则同样需要新增一个不返回 body 的 `request` 重载（现有 `EditAgentView` 已有此方法，可参考）。

---

## 优先级 & 分配建议

| Task | 优先级 | 复杂度 | 预计影响 |
|------|--------|--------|----------|
| Task 3 — Paused Banner | P0 | 中 | 直接影响 agent 使用流程，用户遇到限速时无法继续 |
| Task 4 — Session 删除 | P1 | 低 | 基础管理功能，缺失明显 |
| Task 2 — 编辑名称/头像 | P1 | 低 | UX 完整性，改名需走 Role Definition 流程不合理 |
| Task 1 — Role Avatar | P2 | 中 | 内容完整性，需处理图片加载 |

---

## 注意事项

- **Task 1** 中 `AsyncImage` 加载 webp 需要携带 Authorization header（`/avatars/*` 可能不需要认证，需验证）。如需认证，改用 `URLSession` 手动加载并转为 `UIImage`。
- **Task 3** 中 `continue_session` WS 消息的格式与 web 端一致（见 `packages/shared/src/protocol.ts` `ContinueSessionMessage`），发送前确认 `projectId` 和 `sessionId` 已正确绑定到当前会话。
- `APIClient.request`（无返回体版本）在 `EditAgentView.swift` 中已有实现，Task 4 复用即可。
