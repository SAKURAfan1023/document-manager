import AppKit
import Foundation

private enum ServiceState {
    case stopped
    case starting
    case running
    case externalRunning
    case error(String)
}

private final class StatusDotView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 5
        layer?.backgroundColor = NSColor.systemGray.cgColor
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setColor(_ color: NSColor) {
        layer?.backgroundColor = color.cgColor
    }
}

private final class LauncherController: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let projectRoot: URL
    private let platformURL = URL(string: "http://127.0.0.1:5173")!
    private let healthURL = URL(string: "http://127.0.0.1:5173/api/health")!
    private var serviceProcess: Process?
    private var logHandle: FileHandle?
    private var statusTimer: Timer?

    private var state: ServiceState = .stopped {
        didSet {
            render()
        }
    }

    private let window: NSPanel = {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 280, height: 128),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isMovableByWindowBackground = true
        panel.isReleasedWhenClosed = false
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.backgroundColor = .clear
        return panel
    }()

    private let statusDot = StatusDotView(frame: NSRect(x: 0, y: 0, width: 10, height: 10))
    private let titleLabel = NSTextField(labelWithString: "本地文档阅读馆")
    private let statusLabel = NSTextField(labelWithString: "正在检查状态")
    private let primaryButton = NSButton(title: "启动并打开", target: nil, action: nil)
    private let openButton = NSButton(title: "打开", target: nil, action: nil)
    private let refreshButton = NSButton(title: "刷新", target: nil, action: nil)
    private let stopButton = NSButton(title: "停止", target: nil, action: nil)

    init(projectRoot: URL) {
        self.projectRoot = projectRoot
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildWindow()
        window.center()
        window.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        refreshStatus()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 6, repeats: true) { [weak self] _ in
            self?.refreshStatus()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        statusTimer?.invalidate()
        try? logHandle?.close()
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.terminate(nil)
    }

    private func buildWindow() {
        window.delegate = self

        let visualView = NSVisualEffectView()
        visualView.translatesAutoresizingMaskIntoConstraints = false
        visualView.material = .popover
        visualView.blendingMode = .behindWindow
        visualView.state = .active
        visualView.wantsLayer = true
        visualView.layer?.cornerRadius = 18
        visualView.layer?.borderWidth = 1
        visualView.layer?.borderColor = NSColor.separatorColor.cgColor

        let contentView = NSView()
        contentView.translatesAutoresizingMaskIntoConstraints = false
        visualView.addSubview(contentView)
        window.contentView = visualView

        [statusDot, titleLabel, statusLabel, primaryButton, openButton, refreshButton, stopButton].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
        }

        titleLabel.font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        statusLabel.font = NSFont.systemFont(ofSize: 12)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byTruncatingTail

        primaryButton.target = self
        primaryButton.action = #selector(primaryAction)
        primaryButton.bezelStyle = .rounded
        primaryButton.controlSize = .regular

        openButton.target = self
        openButton.action = #selector(openPlatform)
        openButton.bezelStyle = .rounded

        refreshButton.target = self
        refreshButton.action = #selector(refreshButtonClicked)
        refreshButton.bezelStyle = .rounded

        stopButton.target = self
        stopButton.action = #selector(stopService)
        stopButton.bezelStyle = .rounded

        contentView.addSubview(statusDot)
        contentView.addSubview(titleLabel)
        contentView.addSubview(statusLabel)
        contentView.addSubview(primaryButton)
        contentView.addSubview(openButton)
        contentView.addSubview(refreshButton)
        contentView.addSubview(stopButton)

        NSLayoutConstraint.activate([
            contentView.leadingAnchor.constraint(equalTo: visualView.leadingAnchor, constant: 16),
            contentView.trailingAnchor.constraint(equalTo: visualView.trailingAnchor, constant: -16),
            contentView.topAnchor.constraint(equalTo: visualView.topAnchor, constant: 14),
            contentView.bottomAnchor.constraint(equalTo: visualView.bottomAnchor, constant: -14),

            statusDot.widthAnchor.constraint(equalToConstant: 10),
            statusDot.heightAnchor.constraint(equalToConstant: 10),
            statusDot.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            statusDot.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),

            titleLabel.leadingAnchor.constraint(equalTo: statusDot.trailingAnchor, constant: 10),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            titleLabel.topAnchor.constraint(equalTo: contentView.topAnchor),

            statusLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            statusLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            statusLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2),

            primaryButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            primaryButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            primaryButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 12),
            primaryButton.heightAnchor.constraint(equalToConstant: 30),

            openButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            openButton.topAnchor.constraint(equalTo: primaryButton.bottomAnchor, constant: 8),
            openButton.widthAnchor.constraint(equalToConstant: 76),

            refreshButton.leadingAnchor.constraint(equalTo: openButton.trailingAnchor, constant: 8),
            refreshButton.centerYAnchor.constraint(equalTo: openButton.centerYAnchor),
            refreshButton.widthAnchor.constraint(equalToConstant: 76),

            stopButton.leadingAnchor.constraint(equalTo: refreshButton.trailingAnchor, constant: 8),
            stopButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            stopButton.centerYAnchor.constraint(equalTo: openButton.centerYAnchor)
        ])

        render()
    }

    private func render() {
        switch state {
        case .stopped:
            statusDot.setColor(.systemGray)
            statusLabel.stringValue = "未运行"
            primaryButton.title = "启动并打开"
            primaryButton.isEnabled = true
            openButton.isEnabled = false
            refreshButton.isEnabled = true
            stopButton.isEnabled = false
        case .starting:
            statusDot.setColor(.systemBlue)
            statusLabel.stringValue = "正在启动服务"
            primaryButton.title = "启动中..."
            primaryButton.isEnabled = false
            openButton.isEnabled = false
            refreshButton.isEnabled = true
            stopButton.isEnabled = serviceProcess?.isRunning == true
        case .running:
            statusDot.setColor(.systemGreen)
            statusLabel.stringValue = "运行中（由启动器启动）"
            primaryButton.title = "打开平台"
            primaryButton.isEnabled = true
            openButton.isEnabled = true
            refreshButton.isEnabled = true
            stopButton.isEnabled = serviceProcess?.isRunning == true
        case .externalRunning:
            statusDot.setColor(.systemOrange)
            statusLabel.stringValue = "已运行（外部进程）"
            primaryButton.title = "打开平台"
            primaryButton.isEnabled = true
            openButton.isEnabled = true
            refreshButton.isEnabled = true
            stopButton.isEnabled = false
        case .error(let message):
            statusDot.setColor(.systemRed)
            statusLabel.stringValue = message
            primaryButton.title = "重试"
            primaryButton.isEnabled = true
            openButton.isEnabled = false
            refreshButton.isEnabled = true
            stopButton.isEnabled = serviceProcess?.isRunning == true
        }
    }

    @objc private func primaryAction() {
        healthCheck { [weak self] isHealthy in
            guard let self else {
                return
            }
            DispatchQueue.main.async {
                if isHealthy {
                    self.state = self.serviceProcess?.isRunning == true ? .running : .externalRunning
                    self.openPlatform()
                    return
                }
                self.checkPortOccupied { isOccupied in
                    DispatchQueue.main.async {
                        if isOccupied {
                            self.state = .error("端口被占用/服务异常")
                            return
                        }
                        self.startServiceAndOpen()
                    }
                }
            }
        }
    }

    @objc private func openPlatform() {
        NSWorkspace.shared.open(platformURL)
    }

    @objc private func refreshButtonClicked() {
        refreshStatus()
    }

    @objc private func stopService() {
        guard let process = serviceProcess, process.isRunning else {
            refreshStatus()
            return
        }

        process.terminate()
        serviceProcess = nil
        state = .stopped

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            self?.refreshStatus()
        }
    }

    private func startServiceAndOpen() {
        if serviceProcess?.isRunning == true {
            state = .starting
            pollUntilHealthy(openWhenReady: true)
            return
        }

        do {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = [
                "-lc",
                "export PATH=\"/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH\"; cd \(shellQuote(projectRoot.path)) && npm run dev"
            ]
            let handle = try openLogHandle()
            process.standardOutput = handle
            process.standardError = handle

            try process.run()
            serviceProcess = process
            logHandle = handle
            state = .starting
            pollUntilHealthy(openWhenReady: true)
        } catch {
            state = .error("启动失败：\(error.localizedDescription)")
        }
    }

    private func pollUntilHealthy(openWhenReady: Bool) {
        var attemptsRemaining = 40

        func poll() {
            healthCheck { [weak self] isHealthy in
                guard let self else {
                    return
                }
                DispatchQueue.main.async {
                    if isHealthy {
                        self.state = self.serviceProcess?.isRunning == true ? .running : .externalRunning
                        if openWhenReady {
                            self.openPlatform()
                        }
                        return
                    }

                    if let process = self.serviceProcess, !process.isRunning {
                        self.serviceProcess = nil
                        self.state = .error("服务进程已退出")
                        return
                    }

                    attemptsRemaining -= 1
                    if attemptsRemaining <= 0 {
                        self.state = .error("启动超时，请查看日志")
                        return
                    }

                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        poll()
                    }
                }
            }
        }

        poll()
    }

    private func refreshStatus() {
        healthCheck { [weak self] isHealthy in
            guard let self else {
                return
            }

            if isHealthy {
                DispatchQueue.main.async {
                    self.state = self.serviceProcess?.isRunning == true ? .running : .externalRunning
                }
                return
            }

            self.checkPortOccupied { isOccupied in
                DispatchQueue.main.async {
                    if isOccupied {
                        self.state = .error("端口被占用/服务异常")
                    } else if self.serviceProcess?.isRunning == true {
                        self.state = .starting
                    } else {
                        self.state = .stopped
                    }
                }
            }
        }
    }

    private func healthCheck(completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 0.8
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let httpResponse = response as? HTTPURLResponse
            completion(httpResponse?.statusCode == 200)
        }.resume()
    }

    private func checkPortOccupied(completion: @escaping (Bool) -> Void) {
        DispatchQueue.global(qos: .utility).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
            process.arguments = ["-nP", "-iTCP:5173", "-sTCP:LISTEN"]
            process.standardOutput = Pipe()
            process.standardError = Pipe()

            do {
                try process.run()
                process.waitUntilExit()
                completion(process.terminationStatus == 0)
            } catch {
                completion(false)
            }
        }
    }

    private func openLogHandle() throws -> FileHandle {
        let logDir = projectRoot.appendingPathComponent(".launcher", isDirectory: true)
        try FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)

        let logURL = logDir.appendingPathComponent("document-gallery.log")
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }

        let handle = try FileHandle(forWritingTo: logURL)
        try handle.seekToEnd()
        return handle
    }

    private func shellQuote(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
    }
}

private func projectRootFromBundle() -> URL {
    if let path = Bundle.main.object(forInfoDictionaryKey: "DocumentGalleryProjectRoot") as? String,
       !path.isEmpty {
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    let executableURL = Bundle.main.executableURL ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    return executableURL
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}

let app = NSApplication.shared
private let delegate = LauncherController(projectRoot: projectRootFromBundle())
app.delegate = delegate
app.run()
