import Foundation

/// Order in which a state read visits an element's children. The read has an element budget, and an
/// app's menu bar alone can hold hundreds of menu items, so windows (the focused one first) come
/// before everything else and menu bars come last; other children keep their original order.
enum AccessibilityChildOrder {
    static func prioritized<Element>(_ children: [Element], role: (Element) -> String?,
                                     isFocused: (Element) -> Bool) -> [Element] {
        func rank(_ child: Element) -> Int {
            let childRole = role(child)
            if childRole == "AXWindow" { return isFocused(child) ? 0 : 1 }
            if childRole == "AXMenuBar" { return 3 }
            return 2
        }
        return children.enumerated()
            .sorted { lhs, rhs in
                let (left, right) = (rank(lhs.element), rank(rhs.element))
                return left == right ? lhs.offset < rhs.offset : left < right
            }
            .map(\.element)
    }
}
