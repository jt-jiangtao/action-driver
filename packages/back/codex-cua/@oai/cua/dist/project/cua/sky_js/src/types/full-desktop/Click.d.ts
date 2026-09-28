import type { MouseButton } from "../MouseButton";
import type { Window } from "./Window";
export type Input = {
    /** Linux target window, without implicit activation. Required for elements; coordinates are window-relative. Omit for desktop input. */
    window?: Window;
    /** Element ID from `get_window_state().ax_tree`. Use instead of x/y for a primary activation or right-click. */
    element_id?: string;
    /** X coordinate on the desktop or within the target window. */
    x?: number;
    /** Y coordinate on the desktop or within the target window. */
    y?: number;
    /** Mouse button to click, including "right" to open an element's context menu. */
    mouse_button?: MouseButton;
    /** Number of clicks to perform. */
    click_count?: number;
    /** Optional key chord to hold during the click, using the same format as `press_key()`. */
    key?: string;
    /** Milliseconds to hold the mouse button down for each click. */
    duration?: number;
};
export type Return = Promise<void>;
/** Click an AX element with one left or right click, or click coordinates. Element targets do not support key or duration options. */
export type Function = (input: Input) => Return;
