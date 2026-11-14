// Small AppKit helper for the startup handoff. Every command prints one JSON line.
//
//   bridge snapshot <app>
//   bridge watch    <app>
//   bridge quit     <app> <pid> <key> <stamp>
//   bridge launch   <app> <port>
//   bridge show     <app> <pid> <key> <stamp> <frontmostPid>
//   bridge wallpaper <app>
//
// It only reads input event counters and timestamps, never what was typed, and it only
// ever calls terminate(): a refused quit stays refused.
//
// A quit Apple Event that reaches an Electron app before its main process is ready is
// approved by AppKit without running the app's own quit lifecycle; the app then keeps
// working and later exits abruptly. quit therefore refuses until the app shows a window.
import AppKit
import CoreGraphics
import Foundation
import Darwin

let inputEvents: [CGEventType] = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]

func emit(_ value: Any) {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let line = String(data: data, encoding: .utf8) else { exit(1) }
    print(line)
    fflush(stdout)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(2)
}

func inputStamp() -> Int {
    inputEvents.reduce(0) { $0 + Int(CGEventSource.counterForEventType(.combinedSessionState, eventType: $1)) }
}

// Mouse movement is left out on purpose: moving away from the Dock is not "using" the app.
func inputIdleMs() -> Double {
    let seconds = inputEvents
        .map { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) }
        .min() ?? .infinity
    return seconds.isFinite ? seconds * 1000 : 1e12
}

func canonical(_ path: String) -> String {
    URL(fileURLWithPath: path).resolvingSymlinksInPath().path
}

func runningApps(_ appPath: String) -> [NSRunningApplication] {
    NSWorkspace.shared.runningApplications.filter {
        guard let url = $0.bundleURL else { return false }
        return canonical(url.path) == appPath && !$0.isTerminated
    }
}

func launchMs(_ app: NSRunningApplication) -> Int {
    Int((app.launchDate?.timeIntervalSince1970 ?? 0) * 1000)
}

func processKey(_ app: NSRunningApplication) -> String {
    "\(app.processIdentifier):\(launchMs(app))"
}

func commandLine(_ pid: pid_t) -> String? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-ww", "-o", "command=", "-p", String(pid)]
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0, let text = String(data: data, encoding: .utf8) else { return nil }
    return text.isEmpty ? nil : text
}

func debugPort(_ command: String) -> Int? {
    guard let range = command.range(of: #"--remote-debugging-port=\d+"#, options: .regularExpression) else { return nil }
    return Int(command[range].split(separator: "=").last ?? "")
}

// On-screen, normal-level windows per process. Owner and layer are readable without
// Screen Recording permission; titles and contents are never requested.
func visibleWindowCounts() -> [Int: Int] {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else { return [:] }
    var counts: [Int: Int] = [:]
    for window in list {
        guard let pid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.intValue,
              (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 else { continue }
        counts[pid, default: 0] += 1
    }
    return counts
}

func describe(_ app: NSRunningApplication, windows: [Int: Int]) -> [String: Any] {
    let command = commandLine(app.processIdentifier)
    return [
        "windows": windows[Int(app.processIdentifier)] ?? 0,
        "pid": Int(app.processIdentifier),
        "key": processKey(app),
        "launchedAt": launchMs(app),
        "finishedLaunching": app.isFinishedLaunching,
        "argumentsKnown": command != nil,
        "debugPort": command.flatMap(debugPort) as Any? ?? NSNull()
    ]
}

func snapshot(_ appPath: String) -> [String: Any] {
    let keyboardIdle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown) * 1000
    return [
        "apps": { let windows = visibleWindowCounts(); return runningApps(appPath).map { describe($0, windows: windows) } }(),
        "frontmostPid": NSWorkspace.shared.frontmostApplication.map { Int($0.processIdentifier) } as Any? ?? NSNull(),
        "inputIdleMs": inputIdleMs(),
        "keyboardIdleMs": keyboardIdle.isFinite ? keyboardIdle : 1e12,
        "inputStamp": inputStamp()
    ]
}

func find(_ appPath: String, pid: String, key: String) -> NSRunningApplication? {
    guard let pid = pid_t(pid) else { return nil }
    return runningApps(appPath).first { $0.processIdentifier == pid && processKey($0) == key }
}

// openApplication is asynchronous and needs the main run loop to deliver its completion.
func open(_ appPath: String, _ configuration: NSWorkspace.OpenConfiguration, timeout: TimeInterval) -> NSRunningApplication? {
    var opened: NSRunningApplication?
    var done = false
    NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: appPath), configuration: configuration) { app, _ in
        DispatchQueue.main.async {
            opened = app
            done = true
        }
    }
    let deadline = Date(timeIntervalSinceNow: timeout)
    while !done && Date() < deadline {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
    }
    return opened
}

func watch(_ appPath: String) -> Never {
    let center = NSWorkspace.shared.notificationCenter
    let names: [NSNotification.Name] = [
        NSWorkspace.didLaunchApplicationNotification,
        NSWorkspace.didTerminateApplicationNotification,
        NSWorkspace.didActivateApplicationNotification
    ]
    let tokens = names.map { name in
        center.addObserver(forName: name, object: nil, queue: .main) { note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  let url = app.bundleURL, canonical(url.path) == appPath else { return }
            emit(["event": name.rawValue, "pid": Int(app.processIdentifier)])
        }
    }
    emit(["event": "watching"])
    withExtendedLifetime(tokens) { RunLoop.main.run() }
    exit(0)
}

// Cocoa measures from the bottom of the primary screen, the renderer from its top.
func wallpaper() -> [String: Any] {
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    return ["screens": NSScreen.screens.map { screen -> [String: Any] in
        let frame = screen.frame
        return [
            "x": frame.minX,
            "y": primaryHeight - frame.maxY,
            "width": frame.width,
            "height": frame.height,
            "image": NSWorkspace.shared.desktopImageURL(for: screen)?.path as Any? ?? NSNull()
        ]
    }]
}

func claimLock(_ file: String, owner: Int32) {
    let fd = Darwin.open(file + ".guard", O_RDWR | O_CREAT, mode_t(0o600))
    guard fd >= 0 else { fail("cannot open lock guard") }
    defer { Darwin.close(fd) }
    var gate = Darwin.flock()
    gate.l_type = Int16(F_WRLCK)
    gate.l_whence = Int16(SEEK_SET)
    gate.l_len = 0
    guard Darwin.fcntl(fd, F_SETLK, &gate) == 0 else { emit(["acquired": false]); return }
    var before = stat()
    if Darwin.lstat(file, &before) == 0 {
        if let text = try? String(contentsOfFile: file, encoding: .utf8),
           let pid = Int32(text.trimmingCharacters(in: .whitespacesAndNewlines)), pid > 0 {
            if Darwin.kill(pid, 0) == 0 || errno == EPERM { emit(["acquired": false]); return }
            guard errno == ESRCH else { fail("cannot inspect lock owner") }
        }
        var current = stat()
        guard Darwin.lstat(file, &current) == 0, current.st_ino == before.st_ino,
              current.st_dev == before.st_dev else { emit(["acquired": false]); return }
        guard Darwin.unlink(file) == 0 else { emit(["acquired": false]); return }
    }
    let temporary = file + ".claim." + UUID().uuidString
    defer { Darwin.unlink(temporary) }
    do {
        try "\(owner)\n".write(toFile: temporary, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary)
        emit(["acquired": Darwin.link(temporary, file) == 0])
    } catch { fail("cannot write lock owner") }
}

let args = CommandLine.arguments
if args.count == 2 && args[1] == "version" {
    emit(["protocol": 1, "capabilities": ["snapshot", "watch", "quit", "launch", "show", "wallpaper", "claim-lock", "window-ready"]])
    exit(0)
}
guard args.count >= 3 else { fail("usage: bridge <command> <app> [...]") }
let command = args[1]
let appPath = canonical(args[2])

switch command {
case "claim-lock":
    guard args.count == 4, let owner = Int32(args[3]), owner > 0 else { fail("invalid lock owner") }
    claimLock(appPath, owner: owner)

case "snapshot":
    emit(snapshot(appPath))

case "watch":
    watch(appPath)

case "quit":
    guard args.count == 6 else { fail("usage: bridge quit <app> <pid> <key> <stamp>") }
    // The user started working between the decision and now: leave the app alone.
    guard String(inputStamp()) == args[5] else {
        emit(["accepted": false, "reason": "input-changed"])
        break
    }
    guard let app = find(appPath, pid: args[3], key: args[4]) else {
        emit(["accepted": false, "reason": "process-changed"])
        break
    }
    guard (visibleWindowCounts()[Int(app.processIdentifier)] ?? 0) > 0 else {
        emit(["accepted": false, "reason": "not-ready"])
        break
    }
    emit(["accepted": app.terminate()])

case "launch":
    guard args.count == 4 else { fail("usage: bridge launch <app> <port>") }
    guard runningApps(appPath).isEmpty else {
        emit(["launched": false])
        break
    }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.arguments = ["--remote-debugging-port=\(args[3])", "--remote-debugging-address=127.0.0.1"]
    configuration.activates = false
    configuration.addsToRecentItems = false
    configuration.createsNewApplicationInstance = false
    guard let app = open(appPath, configuration, timeout: 20) else {
        emit(["launched": false])
        break
    }
    emit(["launched": true, "pid": Int(app.processIdentifier), "key": processKey(app)])

case "show":
    guard args.count == 7 else { fail("usage: bridge show <app> <pid> <key> <stamp> <frontmostPid>") }
    let frontmost = NSWorkspace.shared.frontmostApplication.map { String($0.processIdentifier) } ?? ""
    guard String(inputStamp()) == args[5], frontmost == args[6], find(appPath, pid: args[3], key: args[4]) != nil else {
        emit(["shown": false])
        break
    }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    configuration.addsToRecentItems = false
    emit(["shown": open(appPath, configuration, timeout: 10) != nil])

case "wallpaper":
    emit(wallpaper())

default:
    fail("unknown command: \(command)")
}
