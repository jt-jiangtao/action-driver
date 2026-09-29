# cua_repl

`@oai/cua-repl` launches NodeREPL with the `cua` API from
`@oai/cua/tinyskyAlt`. The `cua_node` archive includes this package.
Codex Desktop's `unified-computer-use` plugin points at its installed bin.
Desktop copies `@oai/cua-repl/plugin` from the selected `cua_node` runtime so the
plugin's tools and hooks match its executable. This also applies to local runtime
overrides and source builds. Omitting the runtime, or selecting an older runtime
without `@oai/cua-repl`, omits the plugin. A package missing its plugin fails
packaging instead of using the checkout's copy.
The packaged `plugin/.mcp.template.json` is disabled and has no launch arguments.
Desktop renames it to `.mcp.json`, the filename required by the plugin loader.
Older packages that already contain `.mcp.json` keep that file.
Desktop fills in the downloaded Node executable and package bin path before
enabling it. Users do not need to provide these arguments.

The launcher accepts the normal NodeREPL environment plus:

- `CUA_REPL_NODE_REPL_PATH`: absolute path to the NodeREPL executable.
- `CUA_REPL_ENABLED_SURFACES`: required. Set `browser`, `computer`, or
  `browser,computer`. Missing, empty, or unknown values fail startup.
- `CUA_REPL_BROWSER_ENV`: optional. Select `codex-app`, `training`, `cloud`, or
  `orbit` browser documentation. Omit it to preserve the `codex-app` default.
  `cloud` and `orbit` also select CDP browser instructions in the tool description.
- `NODE_REPL_JS_BANNER`: optional replacement bootstrap JavaScript, used verbatim.

The default banner lives in `instructions/banner.js` and is the same for every mode:

```js
await import("@oai/cua/tinyskyAlt");
```

The launcher exposes the mode through the frozen `nodeRepl.env` snapshot.
The import reads it, sets up only the selected providers, and emits core
instructions without collecting inventory. The model can call `cua.getState()`
for fresh inventory or go directly to a browser or app. Later `cua.initialize()`
calls also refresh inventory without repeating setup.

`cua.getTab()` binds an existing tab by runtime/provider ID, a complete tab-v1
mention (`{ mention }`), or `{ url }` with an explicit browser. Chrome mentions
select their referenced profile; IAB mentions use the current session's sole IAB.
URL lookups require one exact match. Stale, missing, or ambiguous references fail
without opening a replacement tab. `cua.createBrowserTab()` opens a new tab;
`cua.getBrowser()` selects a browser without opening one.

The launcher reads the packaged `instructions/banner.js` when `NODE_REPL_JS_BANNER` is unset.
An override, including an empty string, is used verbatim without reading the file.
Import initialization runs once per REPL module cache. Resetting the REPL runs
the banner again with a fresh cache, including after a failed import.

Caller-provided trusted services are preserved. Desktop supplies its browser and
Sky services; training keeps its CDP browser service. Existing approval and
permission settings are inherited. Desktop suppresses legacy skills and hints
only for the providers handled by `cua_repl`. The hidden `turn_ended` tool remains
enabled for host cleanup notifications.

`instructions/linux/`, `instructions/macos/`, and `instructions/windows/` each
contain Markdown files for that platform's common, browser, computer, and output
instructions. Shared tool descriptions and `banner.js` live directly in `instructions/`.
`src/instructions.ts` reads the Markdown for the runtime's `process.platform`;
the launcher includes only the enabled providers. The platform text is initially
identical so each can evolve without changing the others.

The package includes the banner and Markdown files. The launcher resolves them
through the `#instructions/*` import map, so the same reads work
from source and from the compiled package. No resource generation step is needed.

## Training

Set the boolean on any `CBV10CuaUnifiedToolVariantProducer` subclass:

```python
from qstar.common.tools.unified_tool.variants.cua_cbv10 import BrowserUseOnlyMatrices
from unified_toolbox.setup_fn.setup_node import SetupNode

producer = BrowserUseOnlyMatrices(
    enable_cua_repl=True,
    setup_node=SetupNode(version=cua_node_version),
)
```

Use a `cua_node` version built with this package and the updated CUA SDK.
CI publishes these archives and links them in the build annotations.
Training enables both browser and computer APIs and keeps the training browser
backend. Leaving `enable_cua_repl=False` preserves existing behavior.
Keep one existing NodeREPL integration selected. `enable_cua_repl` changes its
server and skill contents, not its skill name. It cannot be used with the
standalone computer tool.

### Behavior guidance

Training always installs the selected skill with its existing name: `browser`,
`computer-use`, `cua`, or `tinysky`. It contains only the required name and
description, with an empty body for behavior guidance. `EnvLocalSkill` creates
its `SKILL.md` from inline text, so no additional packaged file is needed.
API instructions still come from the tool and runtime.

Existing behavior producers can append guidance using the same skill name.
The browser and computer-use confirmation-policy producers also retain their
matching skill. Variant weights and grading metadata are unchanged.

Keeping the name and file does not rewrite behavior specs. Before using a
preset with `cua_repl`, check any instructions or grading criteria that require
manual initialization, the old library API, or calls to `node_repl`. Those must
describe `cua_repl` and its initialized API instead.

## Build and test

From the repository root:

```sh
js install project=@oai/cua-repl
js build project=@oai/cua-repl docker=False publish=False
pnpm --dir lib/js/oai_js_cua_repl run types
pnpm --dir lib/js/oai_js_cua_repl test
```

The standard JS build owns compilation and packing. The desktop plugin contains
only static manifests, so packaging the app does not compile this server.
