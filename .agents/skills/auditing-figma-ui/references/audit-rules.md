# Figma UI audit rules

Read this reference when extracting Figma snapshots, changing audit configuration, or reviewing validator findings.

## Snapshot contract

The validator accepts one or more JSON files with schema version `1`:

```json
{
  "schemaVersion": 1,
  "fileKey": "PzmxsQ99mfhqedj4aFYut0",
  "capturedAt": "2026-09-22T08:00:00.000Z",
  "page": { "id": "60:2", "name": "01 Components" },
  "nodes": []
}
```

Every node requires `id`, `type`, `x`, `y`, `width`, and `height`. Preserve these fields when available:

- `parentId`, `name`, `visible`, `clipsContent`
- `absoluteX`, `absoluteY`
- `layoutMode`, `layoutPositioning`, `layoutSizingHorizontal`, `layoutSizingVertical`
- `paddingLeft`, `paddingRight`, `paddingTop`, `paddingBottom`, `itemSpacing`
- `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `overflowDirection`
- `text`, `textTruncation`, `maxLines`
- `sourceComponentId`, `auditGroupId`, `variantProperties`
- `reactions`
- reviewed `semanticRole` and `contentRegionId`

Normalize `sourceComponentId` to the owning Component Set id when the node is a variant or an instance of a variant. Use the non-variant main component id otherwise. `auditGroupId` identifies states that must keep the same geometry; do not derive it from the visible label.

`semanticRole` is evidence, not a name heuristic. Assign it only from an explicit node-id map reviewed for the current page. Supported roles include `content-region`, `modal`, `drawer`, `scroll-region`, `overlay`, `hotspot`, `background`, `target-highlight`, `icon`, `label`, and `trailing-icon`.

## One-page extraction program

Adapt the constants, but keep one page per `use_figma` call and one page switch. Do not call `loadAllPagesAsync`, `setPluginData`, or `createImageAsync`.

```js
const PAGE_ID = "60:2";
const FILE_KEY = "PzmxsQ99mfhqedj4aFYut0";
const ROLE_BY_NODE_ID = {};
const CONTENT_REGION_BY_MODAL_ID = {};

const page = await figma.getNodeByIdAsync(PAGE_ID);
if (!page || page.type !== "PAGE") throw new Error(`Page ${PAGE_ID} not found`);
await figma.setCurrentPageAsync(page);

const sourceIdentity = async (node) => {
  let component = null;
  if (node.type === "INSTANCE") component = await node.getMainComponentAsync();
  if (node.type === "COMPONENT") component = node;
  if (!component) return null;
  return component.parent?.type === "COMPONENT_SET" ? component.parent.id : component.id;
};

const nodes = [];
for (const node of page.findAll()) {
  if (!("x" in node) || !("width" in node)) continue;
  const box = node.absoluteBoundingBox;
  const record = {
    id: node.id,
    name: node.name,
    type: node.type,
    parentId: node.parent?.type === "PAGE" ? null : node.parent?.id ?? null,
    visible: node.visible !== false,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    absoluteX: box?.x,
    absoluteY: box?.y,
    clipsContent: "clipsContent" in node ? node.clipsContent : false,
    layoutMode: "layoutMode" in node ? node.layoutMode : null,
    layoutPositioning: "layoutPositioning" in node ? node.layoutPositioning : null,
    layoutSizingHorizontal: "layoutSizingHorizontal" in node ? node.layoutSizingHorizontal : null,
    layoutSizingVertical: "layoutSizingVertical" in node ? node.layoutSizingVertical : null,
    paddingLeft: "paddingLeft" in node ? node.paddingLeft : null,
    paddingRight: "paddingRight" in node ? node.paddingRight : null,
    paddingTop: "paddingTop" in node ? node.paddingTop : null,
    paddingBottom: "paddingBottom" in node ? node.paddingBottom : null,
    itemSpacing: "itemSpacing" in node ? node.itemSpacing : null,
    overflowDirection: "overflowDirection" in node ? node.overflowDirection : null,
    text: node.type === "TEXT" ? node.characters : null,
    textTruncation: node.type === "TEXT" ? node.textTruncation : null,
    maxLines: node.type === "TEXT" ? node.maxLines : null,
    sourceComponentId: await sourceIdentity(node),
    variantProperties: "variantProperties" in node ? node.variantProperties : null,
    reactions: "reactions" in node ? node.reactions : [],
    semanticRole: ROLE_BY_NODE_ID[node.id] ?? null,
    contentRegionId: CONTENT_REGION_BY_MODAL_ID[node.id] ?? null
  };
  nodes.push(record);
}

return {
  schemaVersion: 1,
  fileKey: FILE_KEY,
  capturedAt: new Date().toISOString(),
  page: { id: page.id, name: page.name },
  nodes
};
```

If the tool cannot serialize a native Plugin API object, copy only plain fields from it. For reactions, retain action type, destination id, URL, transition and trigger fields required by the audit.

## Severity and rules

| Rule | Severity | Meaning |
| --- | --- | --- |
| `TEXT_OUT_OF_BOUNDS` | error | Visible text exceeds a clipping ancestor. |
| `TEXT_GLYPH_ICON` | error | A reviewed icon role is represented by a text glyph. |
| `VARIANT_OVERLAP` | error | Component variants have positive-area overlap. Edge contact is legal. |
| `SECTION_OVERLAP` | error | Sections have positive-area overlap. |
| `MODAL_OUTSIDE_CONTENT` | error | A modal extends outside its reviewed content region. |
| `CONTROL_CONTENT_OVERFLOW` | error | Visible inline content is wider than the control. |
| `CONTROL_PADDING_BREAKS_CONTENT` | error | Content would fit, but horizontal padding consumes required space. |
| `CONTROL_LABEL_NO_ELLIPSIS` | error | A fixed-width dynamic label lacks `ENDING` and `maxLines: 1`. |
| `REACTION_TARGET_MISSING` | error | An internal reaction destination is absent. |
| `REQUIRED_STATE_MISSING` | error | A configured component state is absent. |
| `MANUAL_FLOW_LAYOUT` | warning | Ordered content depends on manual coordinates or an unapproved absolute child. |
| `FIXED_DYNAMIC_CONTAINER` | warning | Dynamic fixed content has no clipping, scroll, or truncation policy. |
| `MODAL_NOT_CENTERED` | warning | Modal center drifts beyond the configured tolerance. |
| `EXCESSIVE_VERTICAL_WHITESPACE` | warning | Modal has excessive unused space below real content. |
| `CONTROL_PADDING_OUTLIER` | warning | Padding falls outside the component profile. |
| `CONTROL_GEOMETRY_DRIFT` | warning | Width, height, padding, or label anchor changes between states. |
| `REACTION_COUNT_REGRESSION` | warning | Page reactions fell below the reviewed baseline. |

## Content budget

For a matched button, select, filter, or model item:

```text
required width = sum(visible inline child widths) + itemSpacing × gap count
available width = control width - paddingLeft - paddingRight
```

Reserve the trailing icon as a visible child. Do not hide the chevron or status icon to obtain a pass. Static HUG labels may expand and do not require truncation. Fixed-width dynamic labels require single-line ending truncation.

## Action-Driver authoritative sources

The checked-in project configuration currently tracks these Component Set ids:

- `175:243` — Control/Text Button
- `406:1360` — Control/Icon Button
- `351:1296` — Control/Select v2
- `197:897` — Model Selector/Trigger
- `197:896` — Model Selector/Model Item

The required scope is Components `60:2`, Home `60:4`, Task `60:6`, Model Configuration `273:5`, Agent Configuration `379:2`, and Logs `315:2`. Re-extract every required page before a whole-file pass claim.

## Visual review

Open or render the containing frame, not only the failing layer. Verify hierarchy, apparent density, label/icon alignment, clipping, focus treatment, and whether the configured role is correct. A screenshot may confirm or reject a warning, but it cannot replace deterministic geometry, state, or reaction checks.

Every exception must remain exact and evidence-backed:

```json
{
  "ruleId": "MANUAL_FLOW_LAYOUT",
  "nodeId": "123:456",
  "reason": "Prototype hotspot overlay; verified inside its owning frame on 2026-09-22"
}
```
