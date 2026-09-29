import type { sky } from "@oai/sky";
export declare function get_apps(computer: typeof sky): Promise<import("node_modules/@oai/sky/src/types/window/ListApps").App[] | {
    id: string;
    displayName: string;
    isRunning: boolean;
    windows: import("node_modules/@oai/sky/src/types/full-desktop").Window[];
}[]>;
