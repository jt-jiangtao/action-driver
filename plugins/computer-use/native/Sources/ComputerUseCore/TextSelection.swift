import Foundation

enum TextSelection {
    /// Accessibility text ranges are UTF-16 offsets, not Swift Character counts.
    static func range(in current: String, text: String, prefix: String? = nil,
                      suffix: String? = nil, selectionType: String = "text") -> NSRange? {
        guard !text.isEmpty else { return nil }
        var searchStart = current.startIndex
        while let found = current.range(of: text, range: searchStart..<current.endIndex) {
            searchStart = found.upperBound
            let prefixMatches = prefix.map { !$0.isEmpty && current[..<found.lowerBound].hasSuffix($0) } ?? true
            let suffixMatches = suffix.map { !$0.isEmpty && current[found.upperBound...].hasPrefix($0) } ?? true
            guard prefixMatches && suffixMatches else { continue }
            let range = NSRange(found, in: current)
            switch selectionType {
            case "cursor-before": return NSRange(location: range.location, length: 0)
            case "cursor-after": return NSRange(location: range.location + range.length, length: 0)
            default: return range
            }
        }
        return nil
    }
}
