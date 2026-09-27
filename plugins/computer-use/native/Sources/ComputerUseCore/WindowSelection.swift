import CoreGraphics
import Foundation

/// One capturable window of a process.
public struct WindowCandidate: Equatable {
    public let id: Int
    public let frame: CGRect

    public init(id: Int, frame: CGRect) {
        self.id = id
        self.frame = frame
    }
}

public enum WindowSelection {
    /// Picks the window to capture and to map coordinates against.
    ///
    /// A process can own layer-0 windows that are not the window the user is working in — TextEdit
    /// reports its menu bar (full display width, menu-bar height) among them — so the focused window
    /// wins whenever it is present. Without a focused window the largest one is the best guess,
    /// instead of whichever window the system lists first.
    public static func pick(candidates: [WindowCandidate], focused: CGRect?) -> Int? {
        if let focused {
            let matching = candidates.first { candidate in
                abs(candidate.frame.minX - focused.minX) < 2 && abs(candidate.frame.minY - focused.minY) < 2
                    && abs(candidate.frame.width - focused.width) < 2
                    && abs(candidate.frame.height - focused.height) < 2
            }
            if let matching { return matching.id }
        }
        let largest = candidates.max { left, right in
            left.frame.width * left.frame.height < right.frame.width * right.frame.height
        }
        return largest?.id
    }
}
