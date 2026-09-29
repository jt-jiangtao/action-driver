import type { Browsers } from "./types";
type TabMention = {
    source: "extension" | "iab";
    browser_id: string;
    tab_id: string;
    title: string;
    url: string;
};
export declare function parse_tab_mention(value: string): TabMention;
export declare function get_mentioned_browser_id(browsers: Browsers, mention: TabMention): Promise<string>;
export {};
