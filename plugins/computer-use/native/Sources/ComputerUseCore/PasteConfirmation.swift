import Foundation

/// Decides whether a paste actually landed in the target application (1.6).
///
/// Neither the posted ⌘V event nor the pasteboard change count proves the app consumed the
/// clipboard, so the helper watches the one observable thing it has: the target's focused value.
/// A paste counts as confirmed when that value differs from the value seen before the keystroke and
/// stays unchanged across two consecutive samples, which avoids reading a half-finished insert.
public struct PasteConfirmation {
    public let baseline: String?
    private var samples: [String] = []

    public init(baseline: String?) {
        self.baseline = baseline
    }

    /// Number of samples that showed a change, for diagnostics in tests.
    public var changedSamples: Int { samples.count }

    /// Records the target's current value and reports whether the paste is confirmed.
    public mutating func observe(_ value: String?) -> Bool {
        guard let value, let baseline, value != baseline else { return false }
        if samples.last == value { samples.append(value); return samples.count >= 2 }
        samples = [value]
        return false
    }
}
