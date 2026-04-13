import SwiftUI
import Combine
import AVFoundation
import MediaPlayer

// MARK: - AudioPlayerController

final class AudioPlayerController: ObservableObject {
    @Published var isPlaying = false
    @Published var currentTime: Double = 0
    @Published var duration: Double = 0
    @Published var isReady = false

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var durationObserver: NSKeyValueObservation?
    private var playCommandToken: Any?
    private var pauseCommandToken: Any?
    private var toggleCommandToken: Any?
    private var skipForwardToken: Any?
    private var skipBackwardToken: Any?
    private var seekCommandToken: Any?

    let fileName: String

    init(fileName: String) {
        self.fileName = fileName
    }

    deinit {
        removeObservers()
        player?.pause()
    }

    func load(url: URL, token: String?) {
        var options: [String: Any] = [:]
        if let token {
            options["AVURLAssetHTTPHeaderFieldsKey"] = ["Authorization": "Bearer \(token)"]
        }
        let asset = AVURLAsset(url: url, options: options.isEmpty ? nil : options)
        let item = AVPlayerItem(asset: asset)
        player = AVPlayer(playerItem: item)

        setupAudioSession()
        setupObservers(item: item)
        setupNowPlaying()
        setupRemoteCommands()
    }

    func play() {
        player?.play()
        isPlaying = true
        updateNowPlaying()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        updateNowPlaying()
    }

    func toggle() {
        isPlaying ? pause() : play()
    }

    func seek(to time: Double) {
        let cmTime = CMTime(seconds: time, preferredTimescale: 600)
        player?.seek(to: cmTime, toleranceBefore: .zero, toleranceAfter: .zero)
        currentTime = time
        updateNowPlaying()
    }

    func skip(by seconds: Double) {
        seek(to: max(0, min(currentTime + seconds, duration)))
    }

    func cleanup() {
        removeObservers()
        player?.pause()
        player = nil
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    // MARK: - Private

    private func setupAudioSession() {
        #if os(iOS)
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch { }
        #endif
    }

    private func setupObservers(item: AVPlayerItem) {
        let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            self.currentTime = time.seconds
            self.updateNowPlaying()
        }

        statusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                if item.status == .readyToPlay {
                    self?.isReady = true
                }
            }
        }

        durationObserver = item.observe(\.duration, options: [.new]) { [weak self] item, _ in
            let d = item.duration.seconds
            if d.isFinite && d > 0 {
                DispatchQueue.main.async { self?.duration = d }
            }
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(didPlayToEnd),
            name: .AVPlayerItemDidPlayToEndTime,
            object: item
        )
    }

    @objc private func didPlayToEnd() {
        DispatchQueue.main.async { [weak self] in
            self?.isPlaying = false
            self?.player?.seek(to: .zero)
            self?.currentTime = 0
            self?.updateNowPlaying()
        }
    }

    private func setupNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: (fileName as NSString).deletingPathExtension,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: 0,
            MPMediaItemPropertyPlaybackDuration: 0,
            MPNowPlayingInfoPropertyPlaybackRate: 0.0,
        ]
    }

    private func updateNowPlaying() {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPMediaItemPropertyPlaybackDuration] = duration
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func setupRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        playCommandToken = c.playCommand.addTarget { [weak self] _ in self?.play(); return .success }
        pauseCommandToken = c.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        toggleCommandToken = c.togglePlayPauseCommand.addTarget { [weak self] _ in self?.toggle(); return .success }
        c.skipForwardCommand.preferredIntervals = [15]
        skipForwardToken = c.skipForwardCommand.addTarget { [weak self] event in
            if let e = event as? MPSkipIntervalCommandEvent { self?.skip(by: e.interval) }
            return .success
        }
        c.skipBackwardCommand.preferredIntervals = [15]
        skipBackwardToken = c.skipBackwardCommand.addTarget { [weak self] event in
            if let e = event as? MPSkipIntervalCommandEvent { self?.skip(by: -e.interval) }
            return .success
        }
        seekCommandToken = c.changePlaybackPositionCommand.addTarget { [weak self] event in
            if let e = event as? MPChangePlaybackPositionCommandEvent { self?.seek(to: e.positionTime) }
            return .success
        }
    }

    private func removeObservers() {
        if let observer = timeObserver { player?.removeTimeObserver(observer) }
        timeObserver = nil
        statusObserver?.invalidate()
        durationObserver?.invalidate()
        NotificationCenter.default.removeObserver(self)

        let c = MPRemoteCommandCenter.shared()
        if let t = playCommandToken { c.playCommand.removeTarget(t) }
        if let t = pauseCommandToken { c.pauseCommand.removeTarget(t) }
        if let t = toggleCommandToken { c.togglePlayPauseCommand.removeTarget(t) }
        if let t = skipForwardToken { c.skipForwardCommand.removeTarget(t) }
        if let t = skipBackwardToken { c.skipBackwardCommand.removeTarget(t) }
        if let t = seekCommandToken { c.changePlaybackPositionCommand.removeTarget(t) }
    }
}

// MARK: - AudioPlayerView

struct AudioPlayerView: View {
    @ObservedObject var controller: AudioPlayerController
    let fileSize: Int
    @Environment(\.colorScheme) private var colorScheme

    private var ext: String {
        (controller.fileName as NSString).pathExtension.uppercased()
    }

    private var displayName: String {
        (controller.fileName as NSString).deletingPathExtension
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            coverArt
                .padding(.bottom, 44)

            VStack(spacing: 6) {
                Text(displayName)
                    .font(.title2.weight(.semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)

                Text("\(ext) · \(formatSize(fileSize))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 36)

            scrubber
                .padding(.horizontal, 32)
                .padding(.bottom, 32)

            controls
                .padding(.horizontal, 40)

            Spacer()
        }
    }

    // MARK: Cover art

    private var coverArt: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 24)
                .fill(
                    LinearGradient(
                        colors: [Color.accentColor.opacity(0.75), Color.accentColor.opacity(0.35)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 224, height: 224)
                .shadow(color: Color.accentColor.opacity(0.35), radius: 24, y: 10)

            Image(systemName: "music.note")
                .font(.system(size: 88, weight: .ultraLight))
                .foregroundStyle(.white.opacity(0.9))
        }
    }

    // MARK: Scrubber

    private var scrubber: some View {
        VStack(spacing: 6) {
            Slider(
                value: Binding(
                    get: { controller.currentTime },
                    set: { controller.seek(to: $0) }
                ),
                in: 0...max(controller.duration, 1)
            )
            .tint(.primary)
            .disabled(!controller.isReady)

            HStack {
                Text(formatTime(controller.currentTime))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Spacer()
                Text("-\(formatTime(max(0, controller.duration - controller.currentTime)))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
    }

    // MARK: Controls

    private var controls: some View {
        HStack(spacing: 52) {
            Button { controller.skip(by: -15) } label: {
                Image(systemName: "gobackward.15")
                    .font(.system(size: 30))
                    .foregroundStyle(.primary)
            }
            .disabled(!controller.isReady)

            Button { controller.toggle() } label: {
                ZStack {
                    Circle()
                        .fill(Color.primary)
                        .frame(width: 76, height: 76)
                    Image(systemName: controller.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(colorScheme == .dark ? Color.black : Color.white)
                        .offset(x: controller.isPlaying ? 0 : 2)
                }
            }
            .disabled(!controller.isReady)
            .overlay {
                if !controller.isReady {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.secondary)
                }
            }

            Button { controller.skip(by: 15) } label: {
                Image(systemName: "goforward.15")
                    .font(.system(size: 30))
                    .foregroundStyle(.primary)
            }
            .disabled(!controller.isReady)
        }
    }

    // MARK: Helpers

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let total = Int(seconds)
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }

    private func formatSize(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024) }
        return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
    }
}
