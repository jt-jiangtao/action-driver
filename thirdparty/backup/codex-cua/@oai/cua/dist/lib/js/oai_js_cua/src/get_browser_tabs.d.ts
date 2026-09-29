import type { setupBrowserRuntime } from "@oai/browser";
type BrowserProvider = Awaited<ReturnType<typeof setupBrowserRuntime>>["browsers"];
type Browser = Awaited<ReturnType<BrowserProvider["get"]>>;
export declare function get_browser_tabs(browser: Browser): Promise<import("@oai/browser").GlobalAgentBrowserTab[]>;
export {};
