import AppKit
import Combine
import CoreServices
import SwiftUI

/// Makes the helper bundle known to LaunchServices so System Settings can resolve it by bundle
/// identity when it is dropped into an authorization list.
public enum BundleRegistration {
    public static func registerHelper() {
        guard Bundle.main.bundleURL.pathExtension == "app" else { return }
        LSRegisterURL(Bundle.main.bundleURL as CFURL, true)
    }
}

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

/// Frosted backing for the native windows; the SwiftUI content on top stays transparent.
@MainActor
func makeFrostedBacking(cornerRadius: CGFloat) -> NSVisualEffectView {
    let view = NSVisualEffectView()
    view.material = .underWindowBackground
    view.blendingMode = .behindWindow
    view.state = .followsWindowActiveState
    view.wantsLayer = true
    view.layer?.cornerRadius = cornerRadius
    view.layer?.masksToBounds = cornerRadius > 0
    return view
}

/// Wraps SwiftUI content in an AppKit view that presents itself as one opaque accessibility
/// element. Querying SwiftUI's own accessibility tree crashed this helper
/// (`SwiftUI AccessibilityNode.attachment` → SIGBUS), and Computer Use never needs to expose the
/// guidance window's internals to other apps.
final class AccessibilityShieldView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("ActionDriver Computer Use")
        setAccessibilityChildren([])
    }

    required init?(coder: NSCoder) { fatalError("not supported") }
}

/// Drag source that behaves like dragging the bundle out of Finder, which is what the Privacy &
/// Security list accepts: a real file URL item plus the legacy filenames flavour.
struct BundleDragSource: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { BundleDragView() }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

final class BundleDragView: NSView, NSDraggingSource {
    private let bundleURL = Bundle.main.bundleURL

    /// Transparent: the SwiftUI layer below draws the chip, this view only starts the drag.
    override func draw(_ dirtyRect: NSRect) {}

    override func mouseDragged(with event: NSEvent) {
        let item = NSPasteboardItem()
        item.setString(bundleURL.absoluteString, forType: .fileURL)
        item.setPropertyList([bundleURL.path], forType: .init("NSFilenamesPboardType"))
        let draggingItem = NSDraggingItem(pasteboardWriter: item)
        draggingItem.setDraggingFrame(bounds, contents: dragImage)
        beginDraggingSession(with: [draggingItem], event: event, source: self)
    }

    private var dragImage: NSImage {
        Bundle.main.image(forResource: "ActionDriver")
            ?? NSWorkspace.shared.icon(forFile: bundleURL.path)
    }

    func draggingSession(
        _ session: NSDraggingSession,
        sourceOperationMaskFor context: NSDraggingContext
    ) -> NSDragOperation {
        .copy
    }
}

struct GuidanceView: View {
    @ObservedObject var model: GuidanceModel
    let onAllow: (GuidancePermission) -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 40) {
            VStack(spacing: 14) {
                Image(nsImage: brandImage)
                    .resizable()
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .shadow(color: .black.opacity(0.12), radius: 8, y: 4)
                Text("启用 ActionDriver Computer Use")
                    .font(.system(size: 24, weight: .bold))
                Text("ActionDriver Computer Use 需要以下权限，才能在你的 Mac 上使用各个 App。这些权限只在你要求 ActionDriver 执行任务时使用。")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .frame(maxWidth: 470)
            }
            VStack(spacing: 14) {
                if model.snapshot.pending == .accessibility { pendingCard } else { row(.accessibility) }
                if model.snapshot.pending == .screenRecording { pendingCard } else { row(.screenRecording) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 26)
        .padding(.top, 8)
        .padding(.bottom, 26)
        .frame(width: 600)
        .fixedSize(horizontal: false, vertical: true)
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
        // The reference window uses Apple's own glyphs: the ringed accessibility figure and the
        // camera inside viewfinder corners. Composed shapes looked visibly different.
        Image(systemName: permission == .accessibility ? "accessibility" : "camera.viewfinder")
            .font(.system(size: 38, weight: .regular))
            .foregroundStyle(permission == .accessibility ? Color.accentColor : Color.secondary)
            .frame(width: 52, height: 52)
    }

    private func row(_ permission: GuidancePermission) -> some View {
        HStack(spacing: 14) {
            icon(permission)
            VStack(alignment: .leading, spacing: 6) {
                Text(title(permission)).font(.system(size: 15, weight: .semibold))
                Text(detail(permission)).font(.system(size: 12.5)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if model.snapshot.isGranted(permission) {
                // Granted capabilities carry no control chrome, only the state, as in the reference.
                HStack(spacing: 6) {
                    Text("已完成")
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.secondary)
                .padding(.trailing, 12)
                .frame(minWidth: 136, alignment: .trailing)
            } else {
                Button {
                    onAllow(permission)
                } label: {
                    Text("允许")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.extraLarge)
                .frame(minWidth: 136)
            }
        }
        // A bordered button carries its own inner padding, so the trailing inset is smaller to keep
        // the visual left and right margins of the card equal.
        .padding(.leading, 24)
        .padding(.trailing, 10)
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
                .shadow(color: .black.opacity(0.10), radius: 8, y: 3)
        )
    }

    private var pendingCard: some View {
        // Only the state hint lives here; the draggable app icon and the drag instruction are the
        // second window's job.
        Text("在系统设置中完成")
        .font(.system(size: 12.5))
        .foregroundStyle(.secondary)
        // Same footprint as a permission card: icon row height (52) plus its vertical padding.
        .frame(maxWidth: .infinity, minHeight: 84)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
            .foregroundStyle(Color.secondary.opacity(0.6)))
        .transition(.opacity.combined(with: .move(edge: .top)))
    }
}

struct DragHintView: View {
    let pending: GuidancePermission?
    let onBack: () -> Void
    @State private var lifted = false

    private var isScreenRecording: Bool { pending == .screenRecording }

    private var instruction: String {
        isScreenRecording
            ? "在“屏幕录制”列表中打开 ActionDriver Computer Use"
            : "把 ActionDriver Computer Use 拖入上方列表"
    }

    var body: some View {
        HStack(spacing: 16) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(Color.primary.opacity(0.07)))
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 22, weight: .heavy))
                        .foregroundStyle(Color.accentColor)
                        .offset(y: lifted ? -3 : 0)
                        .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                                   value: lifted)
                    Text(instruction)
                        .font(.system(size: 14))
                }
                HStack(spacing: 12) {
                    Image(nsImage: brandImage)
                        .resizable()
                        .frame(width: 28, height: 28)
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    Text("ActionDriver Computer Use").font(.system(size: 15))
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(nsColor: .textBackgroundColor)))
                // The whole row is the drag handle, matching the reference panel.
                .overlay(BundleDragSource())
                .help("把这个应用拖到「隐私与安全性」列表中")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(width: 560, height: 132)
        .onAppear { lifted = true }
    }
}

/// The second window: a floating drag hint shown while a grant is waiting in System Settings.
@MainActor
final class DragHintPanelController {
    private var panel: NSPanel?
    private var hosting: NSHostingView<DragHintView>?
    var isVisible: Bool { panel?.isVisible == true }
    /// Invoked when the user dismisses the hint with its back button, so the guidance window can
    /// take focus back.
    var onBack: (() -> Void)?
    /// Supplies the flight anchor (bottom edge of the guidance window) and the resting frame for
    /// the panel, which always sits just below that window.
    var geometry: (() -> (anchor: NSRect, target: NSRect)?)?

    func show(pending: GuidancePermission?) {
        if panel == nil {
            let panel = NSPanel(
                contentRect: NSRect(x: 0, y: 0, width: 560, height: 132),
                styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            panel.isFloatingPanel = true
            panel.level = .floating
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = false
            // The panel can be moved by dragging anywhere outside its controls.
            panel.isMovableByWindowBackground = true
            panel.isReleasedWhenClosed = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            let backing = makeFrostedBacking(cornerRadius: 20)
            let hosting = NSHostingView(rootView: DragHintView(pending: pending, onBack: { [weak self] in
                self?.hide()
                self?.onBack?()
            }))
            hosting.translatesAutoresizingMaskIntoConstraints = false
            backing.addSubview(hosting)
            NSLayoutConstraint.activate([
                hosting.leadingAnchor.constraint(equalTo: backing.leadingAnchor),
                hosting.trailingAnchor.constraint(equalTo: backing.trailingAnchor),
                hosting.topAnchor.constraint(equalTo: backing.topAnchor),
                hosting.bottomAnchor.constraint(equalTo: backing.bottomAnchor)
            ])
            let shield = AccessibilityShieldView(frame: backing.frame)
            backing.translatesAutoresizingMaskIntoConstraints = false
            shield.addSubview(backing)
            NSLayoutConstraint.activate([
                backing.leadingAnchor.constraint(equalTo: shield.leadingAnchor),
                backing.trailingAnchor.constraint(equalTo: shield.trailingAnchor),
                backing.topAnchor.constraint(equalTo: shield.topAnchor),
                backing.bottomAnchor.constraint(equalTo: shield.bottomAnchor)
            ])
            panel.contentView = shield
            self.panel = panel
            self.hosting = hosting
        }
        hosting?.rootView = DragHintView(pending: pending, onBack: { [weak self] in
            self?.hide()
            self?.onBack?()
        })
        guard let panel, let geometry = geometry?() else { return }
        panel.alphaValue = 0
        panel.setFrame(geometry.anchor, display: false)
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.34
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().setFrame(geometry.target, display: true)
            panel.animator().alphaValue = 1
        }
    }

    func hide(animated: Bool = true) {
        guard let panel, panel.isVisible else { return }
        guard animated, let geometry = geometry?() else {
            panel.orderOut(nil)
            return
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.26
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().setFrame(geometry.anchor, display: true)
            panel.animator().alphaValue = 0
        } completionHandler: {
            panel.orderOut(nil)
            panel.alphaValue = 1
        }
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
    private var settingsWatch: Timer?
    private var waitingSince: Date?
    private let dragHint = DragHintPanelController()

    public init(service: NativeComputerUseService) {
        self.service = service
        super.init()
        dragHint.onBack = { [weak self] in self?.cancelPending() }
        dragHint.geometry = { [weak self] in self?.dragHintGeometry() }
    }

    /// The hint flies out of the bottom edge of the guidance window and rests relative to the
    /// System Settings window the user has to drop the app into, falling back to just below the
    /// guidance window when System Settings is not on screen.
    private func dragHintGeometry() -> (anchor: NSRect, target: NSRect)? {
        guard let frame = window?.frame else { return nil }
        let size = NSSize(width: 560, height: 132)
        let anchor = NSRect(x: frame.midX - 40, y: frame.minY - 8, width: 80, height: 32)
        let screen = window?.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        if let settings = systemSettingsFrame() {
            let x = min(max(settings.midX - size.width / 2, screen.minX + 12),
                        screen.maxX - size.width - 12)
            let y = min(max(settings.minY + 34, screen.minY + 12), screen.maxY - size.height - 12)
            return (anchor, NSRect(x: x, y: y, width: size.width, height: size.height))
        }
        var y = frame.minY - size.height - 14
        if y < screen.minY + 12 { y = frame.maxY + 14 }
        return (anchor, NSRect(x: frame.midX - size.width / 2, y: y,
                               width: size.width, height: size.height))
    }

    /// Frame of the System Settings window, converted from the top-left origin used by Quartz.
    private func systemSettingsFrame() -> NSRect? {
        let windows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
        ) as? [[String: Any]] ?? []
        let owners: Set<String> = ["System Settings", "系统设置"]
        let screenHeight = NSScreen.screens.first?.frame.height ?? 0
        var found: NSRect?
        for window in windows {
            guard let owner = window[kCGWindowOwnerName as String] as? String,
                  owners.contains(owner),
                  (window[kCGWindowLayer as String] as? Int) == 0,
                  let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let x = bounds["X"] as? Double, let y = bounds["Y"] as? Double,
                  let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double,
                  width > 400, height > 300 else { continue }
            let rect = NSRect(x: x, y: screenHeight - y - height, width: width, height: height)
            if found == nil || rect.height > found!.height { found = rect }
        }
        return found
    }

    /// Returning from the hint cancels the wait: the dashed card goes back to its normal row with
    /// the live permission state.
    private func cancelPending() {
        dragHint.hide()
        if var snapshot = model?.snapshot {
            let guided = snapshot.guided
            snapshot = probe()
            snapshot.guided = guided
            model?.snapshot = snapshot
        }
        focusWindow()
    }

    /// Always reports what macOS actually says for this process chain; nothing is assumed.
    private func probe(prompting target: GuidancePermission? = nil) -> GuidanceSnapshot {
        service.permissionsSnapshot(prompting: target)
    }

    private func focusWindow() {
        guard let window else { return }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Brings an already running System Settings window to the front. When it is not running the
    /// system's own authorization prompt is what opens it.
    private func focusSystemSettingsIfPresent() {
        NSRunningApplication
            .runningApplications(withBundleIdentifier: "com.apple.systempreferences")
            .first?
            .activate()
    }

    private func openSystemSettingsPane(_ pane: String) {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")
        else { return }
        NSWorkspace.shared.open(url)
    }

    public func show() {
        if window == nil { build() }
        guard let window, let model else { return }
        model.snapshot = probe()
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
        settingsWatch?.invalidate()
        settingsWatch = nil
        dragHint.hide()
        window?.orderOut(nil)
    }

    private func build() {
        let model = GuidanceModel(snapshot: probe())
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
        let backing = makeFrostedBacking(cornerRadius: 0)
        let hosting = NSHostingView(rootView: view)
        hosting.translatesAutoresizingMaskIntoConstraints = false
        backing.addSubview(hosting)
        NSLayoutConstraint.activate([
            hosting.leadingAnchor.constraint(equalTo: backing.leadingAnchor),
            hosting.trailingAnchor.constraint(equalTo: backing.trailingAnchor),
            hosting.topAnchor.constraint(equalTo: backing.topAnchor),
            hosting.bottomAnchor.constraint(equalTo: backing.bottomAnchor)
        ])
        let shield = AccessibilityShieldView(frame: backing.frame)
        backing.translatesAutoresizingMaskIntoConstraints = false
        shield.addSubview(backing)
        NSLayoutConstraint.activate([
            backing.leadingAnchor.constraint(equalTo: shield.leadingAnchor),
            backing.trailingAnchor.constraint(equalTo: shield.trailingAnchor),
            backing.topAnchor.constraint(equalTo: shield.topAnchor),
            backing.bottomAnchor.constraint(equalTo: shield.bottomAnchor)
        ])
        window.contentView = shield
        window.isOpaque = false
        window.backgroundColor = .clear
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
        let content = NSSize(width: max(fitting.width, 600), height: max(fitting.height, 240))
        let target = window.frameRect(forContentRect: NSRect(origin: .zero, size: content))
        var frame = window.frame
        let top = frame.maxY
        frame.size = target.size
        frame.origin.y = top - frame.height
        restingFrame = frame
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
        settingsWatch?.invalidate()
        settingsWatch = nil
        dragHint.hide()
        cancellable = nil
    }

    private func request(_ permission: GuidancePermission) {
        guard let model else { return }
        let probed = probe(prompting: permission)
        let granted = permission == .accessibility ? probed.accessibility : probed.screenRecording
        model.snapshot.recordRequest(permission, granted: granted)
        if model.snapshot.waitingForSystem {
            // This window stays put; the second window carries the draggable app chip for the
            // System Settings list, and its back button returns focus here.
            // An already open System Settings window is brought forward so the user lands where
            // the grant actually happens.
            if permission == .screenRecording {
                // Screen recording is a per-app switch rather than a drag target, so send the user
                // to that pane and use the matching instruction.
                openSystemSettingsPane("Privacy_ScreenCapture")
            } else {
                focusSystemSettingsIfPresent()
            }
            startPolling()
            startSettingsWatch()
        } else if model.snapshot.shouldClose {
            dismiss()
        }
    }

    private func startPolling() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.poll() }
        }
    }

    /// The drag hint is only useful once the user is actually looking at System Settings, so it
    /// waits for that page to come to the front instead of appearing next to our own window.
    private func startSettingsWatch() {
        settingsWatch?.invalidate()
        waitingSince = Date()
        settingsWatch = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.settingsWatchTick() }
        }
    }

    private func settingsWatchTick() {
        guard let model, model.snapshot.waitingForSystem else {
            settingsWatch?.invalidate()
            settingsWatch = nil
            return
        }
        let frontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let settingsFocused = frontmost == "com.apple.systempreferences"
        let waitedLongEnough = waitingSince.map { Date().timeIntervalSince($0) > 12 } ?? false
        if settingsFocused || waitedLongEnough {
            dragHint.show(pending: model.snapshot.pending)
            settingsWatch?.invalidate()
            settingsWatch = nil
        }
    }

    private func poll() {
        guard let model else { return }
        let probed = probe()
        model.snapshot.apply(accessibility: probed.accessibility, screenRecording: probed.screenRecording)
        // The grant landed: the hint has done its job and the guidance window shows the new state.
        if !model.snapshot.waitingForSystem { dragHint.hide() }
        if model.snapshot.shouldClose {
            pollTimer?.invalidate()
            pollTimer = nil
            dismiss()
        }
    }
}
