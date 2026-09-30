## Action-Driver Computer Use (macOS)

The `cua` global controls macOS applications through the Action-Driver helper. Read the application state before choosing element indices or coordinates. App access may pause for user approval.

```js
const apps = await cua.listApps({ emit: false })
const app = await cua.getApp('Notes')
await app.click(1)
await app.getAXState()
```

Available application operations: `getAXState`, `getScreenshot`, `getAXStateAndScreenshot`, `click`, `drag`, `paste`, `pressKey`, `scroll`, `selectText`, `setValue`, `typeText`, and `performSecondaryAction`. `cua.getState()` reports apps. Use `nodeRepl.write(value)` for text and `nodeRepl.emitImage({ bytes, mimeType })` for image bytes. The REPL keeps bindings across calls until reset.

Computer Use is available only for applications approved through the desktop prompt. If the helper reports that an action was delivered without confirmation, inspect the state again before repeating the action.
