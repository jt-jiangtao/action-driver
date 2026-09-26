import AppKit
import Combine
import SwiftUI

/// Brand artwork copied into the helper bundle at build time; falls back to the app icon.
private let brandImage: NSImage =
    Bundle.main.image(forResource: "ActionDriver") ?? NSApp.applicationIconImage ?? NSImage()

@MainActor
final class GuidanceModel: ObservableObject {
    @Published var snapshot = GuidanceSnapshot()

    init(snapshot: GuidanceSnapshot = GuidanceSnapshot()) {
        self.snapshot = snapshot
    }
}

struct GuidanceView: View {
    @ObservedObject var model: GuidanceModel
    let onAllow: (GuidancePermission) -> Void
    let onClose: () -> Void
    @State private var chipLifted = false

    var body: some View {
        VStack(spacing: 16) {
            Image(nsImage: brandImage)
                .resizable()
                .frame(width: 58, height: 58)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 8, y: 4)
            Text("启用 ActionDriver Computer Use")
                .font(.system(size: 22, weight: .bold))
            Text("ActionDriver Computer Use 需要以下权限，才能在你的 Mac 上使用各个 App。这些权限只在你要求 ActionDriver 执行任务时使用。")
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 430)
            VStack(spacing: 12) {
                if model.snapshot.pending == .accessibility { pendingCard } else { row(.accessibility) }
                if model.snapshot.pending == .screenRecording { pendingCard } else { row(.screenRecording) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 26)
        .padding(.top, 34)
        .padding(.bottom, 26)
        .frame(width: 520)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color(nsColor: .windowBackgroundColor))
        .onExitCommand(perform: onClose)
    }

    private func title(_ permission: GuidancePermission) -> String {
        permission == .accessibility ? "辅助功能" : "屏幕录制"
    }

    private func detail(_ permission: GuidancePermission) -> String {
        permission == .accessibility
            ? "允许 ActionDriver 访问 App 界面"
            : "ActionDriver 通过截图判断该点哪里"
    }

    private func icon(_ permission: GuidancePermission) -> some View {
        Group {
            if permission == .accessibility {
                ZStack {
                    Circle().stroke(Color.accentColor, lineWidth: 4).frame(width: 46, height: 46)
                    Image(systemName: "figure.arms.open")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(Color.accentColor)
                }
            } else {
                ZStack {
                    Image(systemName: "viewfinder")
                        .font(.system(size: 34))
                        .foregroundStyle(Color.secondary)
                    Image(systemName: "camera.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Color.secondary)
                        .offset(y: 1)
                }
            }
        }
        .frame(width: 52, height: 52)
    }

    private func row(_ permission: GuidancePermission) -> some View {
        HStack(spacing: 14) {
            icon(permission)
            VStack(alignment: .leading, spacing: 3) {
                Text(title(permission)).font(.system(size: 15, weight: .semibold))
                Text(detail(permission)).font(.system(size: 12.5)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if model.snapshot.isGranted(permission) {
                Button {
                    // Already granted: nothing to do, the control only reports the state.
                } label: {
                    HStack(spacing: 5) {
                        Text("已完成")
                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold))
                    }
                    .frame(minWidth: 60)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .frame(minWidth: 96)
                .disabled(true)
            } else {
                Button("允许") { onAllow(permission) }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(minWidth: 96)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color(nsColor: .controlBackgroundColor)))
    }

    private var pendingCard: some View {
        VStack(spacing: 10) {
            HStack(spacing: 7) {
                Image(systemName: "display")
                Text("在系统设置中完成")
            }
            .font(.system(size: 13))
            .foregroundStyle(.secondary)
            HStack(spacing: 7) {
                Image(nsImage: brandImage)
                    .resizable()
                    .frame(width: 16, height: 16)
                    .padding(4)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Color(nsColor: .windowBackgroundColor))
                        .shadow(color: .black.opacity(0.16), radius: 2, y: 1))
                    .offset(y: chipLifted ? -6 : 0)
                    .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                               value: chipLifted)
                Image(systemName: "arrow.up").foregroundStyle(.secondary)
                Text("把 ActionDriver Computer Use 拖入上方列表")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
            .foregroundStyle(Color.secondary.opacity(0.6)))
        .transition(.opacity.combined(with: .move(edge: .top)))
        .onAppear { chipLifted = true }
    }
}

/// Owns the native guidance window: macOS renders the authorization panel, this window moves out
/// of its way, polls our own helper, then flies back once the grant lands.
@MainActor
public final class GuidanceWindowController: NSObject, NSWindowDelegate {
    private let service: NativeComputerUseService
    private var window: NSWindow?
    private var model: GuidanceModel?
    private var hosting: NSHostingView<GuidanceView>?
    private var cancellable: AnyCancellable?
    private var restingFrame: NSRect?
    private var pollTimer: Timer?
    private var isAway = false

    public init(service: NativeComputerUseService) {
        self.service = service
        super.init()
    }

    public func show() {
        if window == nil { build() }
        guard let window, let model else { return }
        model.snapshot = service.permissionsSnapshot()
        if isAway {
            flyBack(window)
            return
        }
        guard !window.isVisible else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        window.alphaValue = 0
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.22
            window.animator().alphaValue = 1
        }
    }

    public func dismiss() {
        pollTimer?.invalidate()
        pollTimer = nil
        window?.orderOut(nil)
    }

    private func build() {
        let model = GuidanceModel(snapshot: service.permissionsSnapshot())
        let view = GuidanceView(
            model: model,
            onAllow: { [weak self] permission in self?.request(permission) },
            onClose: { [weak self] in self?.dismiss() }
        )
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 560),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        // No title bar: the content fills the window. Only the close button stays, and closing it
        // is the single way out besides Escape.
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true
        window.standardWindowButton(.closeButton)?.isHidden = false
        let hosting = NSHostingView(rootView: view)
        window.contentView = hosting
        window.delegate = self
        window.center()
        self.window = window
        self.model = model
        self.hosting = hosting
        refit(animated: false)
        // The pending card changes the content height, so the window follows the content instead of
        // leaving empty space at the bottom.
        cancellable = model.$snapshot.sink { [weak self] _ in
            Task { @MainActor in self?.refit(animated: true) }
        }
    }

    private func refit(animated: Bool) {
        guard let window, let hosting else { return }
        let fitting = hosting.fittingSize
        let content = NSSize(width: max(fitting.width, 520), height: max(fitting.height, 240))
        let target = window.frameRect(forContentRect: NSRect(origin: .zero, size: content))
        var frame = window.frame
        let top = frame.maxY
        frame.size = target.size
        frame.origin.y = top - frame.height
        restingFrame = frame
        guard !isAway else { return }
        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.22
                context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                window.animator().setFrame(frame, display: true)
            }
        } else {
            window.setFrame(frame, display: true)
        }
    }

    /// The close button is the only exit besides Escape, so it must also stop polling.
    public func windowWillClose(_ notification: Notification) {
        pollTimer?.invalidate()
        pollTimer = nil
        cancellable = nil
    }

    private func request(_ permission: GuidancePermission) {
        guard let model else { return }
        let probed = service.permissionsSnapshot(prompting: permission)
        let granted = permission == .accessibility ? probed.accessibility : probed.screenRecording
        model.snapshot.recordRequest(permission, granted: granted)
        if model.snapshot.waitingForSystem {
            flyAway()
            startPolling()
        } else if model.snapshot.shouldClose {
            dismiss()
        }
    }

    private func startPolling() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1.2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.poll() }
        }
    }

    private func poll() {
        guard let model, model.snapshot.waitingForSystem else {
            pollTimer?.invalidate()
            pollTimer = nil
            return
        }
        let previous = model.snapshot
        let probed = service.permissionsSnapshot()
        model.snapshot.apply(accessibility: probed.accessibility, screenRecording: probed.screenRecording)
        if model.snapshot.shouldReturnFromEdge(previous: previous), let window {
            flyBack(window)
        }
        if model.snapshot.shouldClose {
            pollTimer?.invalidate()
            pollTimer = nil
            dismiss()
        }
    }

    private func flyAway() {
        guard let window else { return }
        let screen = window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let target = NSRect(x: screen.maxX - 132, y: screen.maxY - 96, width: 120, height: 84)
        isAway = true
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.5
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            window.animator().setFrame(target, display: true)
            window.animator().alphaValue = 0
        } completionHandler: {
            window.orderOut(nil)
            window.alphaValue = 1
        }
    }

    private func flyBack(_ window: NSWindow) {
        let destination = restingFrame ?? window.frame
        isAway = false
        window.alphaValue = 0
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.5
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            window.animator().setFrame(destination, display: true)
            window.animator().alphaValue = 1
        }
    }
}
