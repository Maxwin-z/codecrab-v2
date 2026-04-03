import SwiftUI

// MARK: - Environment: project path

struct ProjectPathKey: EnvironmentKey {
    static let defaultValue: String = ""
}
extension EnvironmentValues {
    var projectPath: String {
        get { self[ProjectPathKey.self] }
        set { self[ProjectPathKey.self] = newValue }
    }
}

// MARK: - File path detection & probing

/// Detectable file extensions for path linking
private let detectableExtsPattern =
    "png|jpg|jpeg|gif|svg|webp|ico|bmp|" +
    "mp4|mov|avi|mkv|webm|mp3|wav|m4a|" +
    "md|markdown|mdx|" +
    "ts|tsx|js|jsx|mjs|cjs|" +
    "py|pyw|rb|go|rs|java|kt|scala|" +
    "swift|m|h|c|cpp|cc|cxx|cs|" +
    "html|htm|css|scss|less|" +
    "json|yaml|yml|toml|xml|graphql|gql|" +
    "sh|bash|zsh|fish|" +
    "sql|r|lua|php|pl|ex|exs|erl|" +
    "txt|csv|log|env|ini|cfg|conf|" +
    "pdf"

/// Matches absolute paths like /foo/bar/baz.ts (or with line number :123)
private let absPathRegex: NSRegularExpression? = {
    try? NSRegularExpression(
        pattern: "((?:/[\\w@.+-]+)+\\.(?:\(detectableExtsPattern)))(?::\\d+)?\\b",
        options: [.caseInsensitive]
    )
}()

/// Matches relative paths like foo/bar/baz.mp4 — must contain at least one slash
/// Negative lookbehind prevents matching the tail of an absolute path or a URL
private let relPathRegex: NSRegularExpression? = {
    try? NSRegularExpression(
        pattern: "(?<![:/\\w\"'])((?:[\\w@.+-]+/)+[\\w@.+-]+\\.(?:\(detectableExtsPattern)))(?::\\d+)?\\b",
        options: [.caseInsensitive]
    )
}()

/// Extract unique file paths (absolute and relative) from text
func extractFilePaths(from text: String) -> [String] {
    let range = NSRange(text.startIndex..., in: text)
    var paths = Set<String>()

    func collect(regex: NSRegularExpression?) {
        guard let regex else { return }
        for match in regex.matches(in: text, range: range) {
            if let r = Range(match.range(at: 1), in: text) {
                paths.insert(String(text[r]))
            }
        }
    }

    collect(regex: absPathRegex)
    collect(regex: relPathRegex)
    return Array(paths)
}

// MARK: - Probe API

struct ProbeResult: Codable {
    let exists: Bool
    let isFile: Bool
    let size: Int?
}

struct ProbeResponse: Codable {
    let results: [String: ProbeResult]
}

/// In-memory probe cache (resolvedAbsolutePath → exists)
private var probeCache: [String: Bool] = [:]

/// Probe the server for file existence (batch, by absolute paths)
func probeFilePaths(_ paths: [String]) async -> Set<String> {
    guard !paths.isEmpty else { return [] }

    var uncached: [String] = []
    var existing = Set<String>()

    for p in paths {
        if let cached = probeCache[p] {
            if cached { existing.insert(p) }
        } else {
            uncached.append(p)
        }
    }

    guard !uncached.isEmpty else { return existing }

    print("[FileLink] Probing \(uncached.count) path(s): \(uncached)")

    do {
        struct ProbeRequest: Encodable { let paths: [String] }
        let response: ProbeResponse = try await APIClient.shared.fetch(
            path: "/api/files/probe",
            method: "POST",
            body: ProbeRequest(paths: uncached)
        )
        for (p, info) in response.results {
            let valid = info.exists && info.isFile
            probeCache[p] = valid
            if valid { existing.insert(p) }
        }
        print("[FileLink] Probe results: \(response.results.mapValues { "\($0.exists)/\($0.isFile)" })")
    } catch {
        print("[FileLink] Probe error: \(error)")
    }

    return existing
}

/// Build a display→resolved path map for text, resolving relative paths via projectPath.
/// Returns only entries where the resolved path exists on the server.
func buildPathMap(from text: String, projectPath: String) async -> [String: String] {
    let detected = extractFilePaths(from: text)
    print("[FileLink] Detected paths in text: \(detected)")
    guard !detected.isEmpty else { return [:] }

    // Map display text → resolved absolute path
    var displayToResolved: [String: String] = [:]
    for display in detected {
        if display.hasPrefix("/") {
            displayToResolved[display] = display
        } else if !projectPath.isEmpty {
            let base = projectPath.hasSuffix("/") ? String(projectPath.dropLast()) : projectPath
            displayToResolved[display] = base + "/" + display
        } else {
            print("[FileLink] Skipping relative path '\(display)' — no projectPath available")
        }
    }

    guard !displayToResolved.isEmpty else { return [:] }

    let resolvedPaths = Array(Set(displayToResolved.values))
    let found = await probeFilePaths(resolvedPaths)

    var result: [String: String] = [:]
    for (display, resolved) in displayToResolved {
        if found.contains(resolved) {
            result[display] = resolved
            print("[FileLink] Linked: '\(display)' → '\(resolved)'")
        }
    }
    return result
}

// MARK: - FileLinkedTextView (UIViewRepresentable)

/// A UITextView wrapper that renders text with file paths as tappable links.
/// pathMap: display text (as it appears in the message) → resolved absolute path
struct FileLinkedTextView: UIViewRepresentable {
    let text: String
    var font: UIFont = .monospacedSystemFont(ofSize: UIFont.preferredFont(forTextStyle: .body).pointSize, weight: .regular)
    var textColor: UIColor = .label
    /// display text → resolved absolute path
    let pathMap: [String: String]
    var onPathTap: ((String) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.isEditable = false
        tv.isSelectable = true
        tv.isScrollEnabled = false
        tv.backgroundColor = .clear
        tv.textContainerInset = .zero
        tv.textContainer.lineFragmentPadding = 0
        tv.delegate = context.coordinator
        tv.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        tv.setContentHuggingPriority(.defaultLow, for: .horizontal)
        tv.linkTextAttributes = [
            .foregroundColor: UIColor.systemBlue,
            .underlineStyle: NSUnderlineStyle.single.rawValue,
        ]
        return tv
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        context.coordinator.onPathTap = onPathTap
        let newAttr = buildAttributedString()
        if uiView.attributedText?.string != text || context.coordinator.lastPathMap != pathMap {
            uiView.attributedText = newAttr
            context.coordinator.lastPathMap = pathMap
            uiView.invalidateIntrinsicContentSize()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIScreen.main.bounds.width
        let size = uiView.sizeThatFits(CGSize(width: width, height: CGFloat.greatestFiniteMagnitude))
        return CGSize(width: width, height: size.height)
    }

    private func buildAttributedString() -> NSAttributedString {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: textColor,
        ]
        let result = NSMutableAttributedString(string: text, attributes: attrs)
        let nsText = text as NSString

        for (displayPath, resolvedPath) in pathMap {
            var searchStart = 0
            while searchStart < nsText.length {
                let searchRange = NSRange(location: searchStart, length: nsText.length - searchStart)
                let range = nsText.range(of: displayPath, options: [], range: searchRange)
                if range.location == NSNotFound { break }
                // Encode the resolved absolute path in the URL
                if let encoded = resolvedPath.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
                   let url = URL(string: "filepreview://\(encoded)") {
                    result.addAttribute(.link, value: url, range: range)
                }
                searchStart = range.location + range.length
            }
        }

        return result
    }

    class Coordinator: NSObject, UITextViewDelegate {
        var onPathTap: ((String) -> Void)?
        var lastPathMap: [String: String] = [:]

        func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
            if case .link(let url) = textItem.content, url.scheme == "filepreview" {
                return UIAction { _ in
                    let resolvedPath = url.absoluteString
                        .replacingOccurrences(of: "filepreview://", with: "")
                        .removingPercentEncoding ?? url.path
                    self.onPathTap?(resolvedPath)
                }
            }
            return defaultAction
        }
    }
}
