# Figma UI Audit Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增项目级 Figma UI 审计 Skill 和确定性 Node 校验脚本，能够发现布局、模态框、图标、交互状态以及按钮/下拉框内容预算问题，并对当前 Action-Driver Figma 六个页面执行全面检查。

**Architecture:** Figma 插件 API 负责提取标准化 JSON 快照，仓库脚本只读取快照与显式配置并输出 error/warning。确定性几何问题自动失败，主观视觉问题进入截图复核清单；脚本不保存 Figma Token，也不自动修改设计。

**Tech Stack:** Node.js 20 ESM、`node:test`、Figma Plugin API、Codex repository Skill、OpenSpec。

**Spec:** `docs/superpowers/specs/2026-09-22-auditing-figma-ui-design.md`

## Global Constraints

- Skill 位于 `.agents/skills/auditing-figma-ui/`，自动发现保持启用。
- Figma 插件 API 是节点结构和 prototype reaction 的事实来源；Node 脚本不得直接要求 Figma Token。
- Error 退出码为 `1`，输入或配置错误退出码为 `2`，无 error 退出码为 `0`；warning 不改变退出码。
- 例外必须由 `ruleId + nodeId + reason` 精确登记，禁止页面级或规则级全局忽略。
- 不根据节点名称猜测动态内容、控件语义或合理覆盖层；这些信息由项目配置显式提供。
- 不自动修复 Figma，不以单一截图像素差替代结构和交互审计。
- 所有新增实现遵循测试先行；每个规则必须先有能够失败的 fixture。

## Review Focus

- 实例内部节点 ID 与源组件节点 ID 不同：配置匹配必须支持 main component/source key，而不是只匹配一次性实例 ID。
- 隐藏节点、SVG 内部路径、背景层、Hotspot 和合法浮层：不得被文字、重叠或绝对定位规则误报。
- 中文、英文、模型名和 session ID 等不同长度标签：固定宽度动态控件必须保留尾部图标并单行省略。
- 边缘恰好相接、负 item spacing、可见阴影：几何计算不得把合法接触或效果范围当成内容重叠。
- 同一 Component Set 的状态变体顺序或命名改变：状态覆盖检查必须基于显式状态值，而不是画布位置。

---

### Task 1: 快照契约、CLI 与基础结构规则

**Files:**
- Create: `.agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`
- Create: `.agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.mjs`

**Interfaces:**
- Consumes: JSON snapshot paths and optional `--config <path>`, `--json` flags.
- Produces: `validateSnapshot(snapshot, config) -> { issues, summary }`, `formatHumanReport(result) -> string`, CLI exit codes `0 | 1 | 2`.

- [ ] **Step 1: Write the failing contract and structural-rule tests**

Create tests using `node:test` with inline `validSnapshot()` and `node(overrides)` builders. Cover invalid schema, hidden text, visible text outside a clipping parent, textual glyphs, component-variant overlap, section edge-touching, and precise exceptions:

```js
test('reports visible clipped text but ignores hidden text', () => {
  const result = validateSnapshot(
    validSnapshot([
      node({ id: 'parent', type: 'FRAME', width: 80, height: 32, clipsContent: true }),
      node({ id: 'visible', type: 'TEXT', parentId: 'parent', x: 12, y: 8, width: 76, height: 16, text: '很长的标签' }),
      node({ id: 'hidden', type: 'TEXT', parentId: 'parent', visible: false, x: 0, y: 40, width: 100, height: 16 })
    ]),
    validConfig()
  )

  assert.deepEqual(result.issues.map(({ ruleId, nodeId }) => [ruleId, nodeId]), [
    ['TEXT_OUT_OF_BOUNDS', 'visible']
  ])
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test .agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `validate-figma-snapshot.mjs`.

- [ ] **Step 3: Implement the snapshot parser and structural rules**

Implement schema version `1`, node indexing, visibility propagation, local-bound checks, rectangle intersection with edge-touch exclusion, exact exception matching, deterministic issue sorting, human/JSON formatting, and CLI argument handling. Use issue shape:

```js
{
  severity: 'error',
  ruleId: 'TEXT_OUT_OF_BOUNDS',
  pageId: '60:2',
  nodeId: '177:259',
  message: 'text exceeds clipping parent by 8px on the right',
  measurements: { overflowRight: 8, overflowBottom: 0 }
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test .agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`

Expected: PASS; invalid snapshot fixture returns code `2`, structural violation fixture returns code `1`, valid fixture returns code `0`.

- [ ] **Step 5: Commit the structural validator**

```bash
git add .agents/skills/auditing-figma-ui/scripts
git commit -m "feat: add figma snapshot structural validator"
```

### Task 2: 流式布局、固定尺寸与模态框规则

**Files:**
- Modify: `.agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`
- Modify: `.agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.mjs`

**Interfaces:**
- Consumes: node `layoutMode`, `layoutPositioning`, `layoutSizingHorizontal`, `layoutSizingVertical`, min/max, padding, effects, and configured overlay/fixed-size roles.
- Produces: `MANUAL_FLOW_LAYOUT`, `FIXED_DYNAMIC_CONTAINER`, `MODAL_NOT_CENTERED`, `MODAL_OUTSIDE_CONTENT`, `EXCESSIVE_VERTICAL_WHITESPACE` issues.

- [ ] **Step 1: Add failing layout fixtures**

Add tests for three sequential siblings in a `layoutMode: 'NONE'` container, a fixed dynamic-text container without any overflow policy, an allowed 16px icon, an allowed Hotspot, an Auto Layout child marked absolute without an overlay role, centered and off-center modal fixtures, and a drawer whose expected empty scrolling area must not be reported as modal whitespace.

```js
test('warns for manual sequential flow but permits registered overlays', () => {
  const result = validateSnapshot(manualFlowSnapshot(), {
    ...validConfig(),
    allowedAbsoluteNodeIds: ['menu-overlay']
  })
  assert.ok(result.issues.some((issue) => issue.ruleId === 'MANUAL_FLOW_LAYOUT'))
  assert.ok(!result.issues.some((issue) => issue.nodeId === 'menu-overlay'))
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern='manual|fixed|modal|whitespace' .agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`

Expected: FAIL because the new rule IDs are absent.

- [ ] **Step 3: Implement outcome-based layout rules**

Detect sequential manual flow only when configured node relationships or a conservative axis heuristic establishes ordering. Treat absolute positioning and fixed sizing as warnings only when they lack an approved role and expose a measurable content risk. Calculate modal center relative to the configured content region, not the whole 1440px canvas. Exclude drawers, scroll regions, backgrounds and prototype hotspots through explicit snapshot roles.

- [ ] **Step 4: Run all validator tests**

Run: `node --test .agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`

Expected: PASS with no new false positive in the allowed overlay, icon, drawer, or edge-touch fixtures.

- [ ] **Step 5: Commit layout auditing**

```bash
git add .agents/skills/auditing-figma-ui/scripts
git commit -m "feat: audit figma layout constraints"
```

### Task 3: 按钮、下拉框与状态几何规则

**Files:**
- Modify: `.agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`
- Modify: `.agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.mjs`

**Interfaces:**
- Consumes: `config.controlProfiles[]`, direct child widths, padding, item spacing, label truncation, max lines, variant state values and source component identity.
- Produces: `CONTROL_CONTENT_OVERFLOW`, `CONTROL_LABEL_NO_ELLIPSIS`, `CONTROL_PADDING_BREAKS_CONTENT`, `CONTROL_PADDING_OUTLIER`, `CONTROL_GEOMETRY_DRIFT` issues.

- [ ] **Step 1: Add failing control-content tests**

Cover exact fit, padding-caused overflow, excessive empty padding, icon-only square controls, static HUG labels, dynamic fixed labels with and without `ENDING + maxLines: 1`, reserved trailing icon width, and equivalent states whose padding or label anchor drifts:

```js
test('requires ellipsis for a dynamic fixed select label', () => {
  const result = validateSnapshot(selectSnapshot({
    width: 112,
    label: { width: 76, textTruncation: 'DISABLED', maxLines: null }
  }), configWithSelectProfile())

  assert.ok(result.issues.some((issue) => issue.ruleId === 'CONTROL_LABEL_NO_ELLIPSIS'))
})

test('accepts a static HUG action button without truncation', () => {
  const result = validateSnapshot(hugButtonSnapshot(), configWithButtonProfile())
  assert.ok(!result.issues.some((issue) => issue.ruleId === 'CONTROL_LABEL_NO_ELLIPSIS'))
})
```

- [ ] **Step 2: Run the control tests and verify RED**

Run: `node --test --test-name-pattern='button|select|padding|ellipsis|geometry' .agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`

Expected: FAIL because content-budget and state-geometry rules are absent.

- [ ] **Step 3: Implement component-profile validation**

Resolve controls by configured source component identity, not display names. Compute:

```text
required width = visible inline children + itemSpacing × gaps
available width = control width - paddingLeft - paddingRight
```

Report overflow measurements as errors. Validate allowed heights, padding ranges, icon gaps and state-invariant anchors as warnings until they cause clipping. Require `textTruncation: 'ENDING'` and `maxLines: 1` for dynamic fixed-width label slots.

- [ ] **Step 4: Run all validator tests and verify GREEN**

Run: `node --test .agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`

Expected: PASS, including long Chinese labels, long model identifiers and trailing-chevron reservation.

- [ ] **Step 5: Commit control auditing**

```bash
git add .agents/skills/auditing-figma-ui/scripts
git commit -m "feat: audit figma control density"
```

### Task 4: 交互、状态覆盖与项目配置

**Files:**
- Create: `design/figma-ui-audit.config.json`
- Modify: `.agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`
- Modify: `.agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: configured page IDs, content regions, component sources, required variant states, reaction baselines and precise exceptions.
- Produces: `REACTION_TARGET_MISSING`, `REACTION_COUNT_REGRESSION`, `REQUIRED_STATE_MISSING`, root commands `pnpm test:figma-audit` and `pnpm validate:figma-audit -- <snapshot...>`.

- [ ] **Step 1: Add failing reaction, state and config tests**

Test missing reaction targets, preserved external navigation actions, reaction count decrease, complete and incomplete variant state matrices, unknown config keys, missing exception reasons, and an exception broader than one node.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern='reaction|state|config|exception' .agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs`

Expected: FAIL because interaction and configuration validation is missing.

- [ ] **Step 3: Implement interaction rules and Action-Driver configuration**

Register pages `60:2`, `60:4`, `60:6`, `273:5`, `379:2`, `315:2`; content regions and authoritative control component IDs; required variant states; baseline reaction counts; dynamic select/model label slots; and only reviewed overlay/Hotspot/fixed-size exceptions. Reject wildcard node IDs or blank reasons.

- [ ] **Step 4: Add package commands**

Add:

```json
{
  "scripts": {
    "test:figma-audit": "node --test .agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.test.mjs",
    "validate:figma-audit": "node .agents/skills/auditing-figma-ui/scripts/validate-figma-snapshot.mjs --config design/figma-ui-audit.config.json"
  }
}
```

- [ ] **Step 5: Run configuration and full validator tests**

Run: `pnpm test:figma-audit`

Expected: PASS with exit code `0`.

- [ ] **Step 6: Commit interaction rules and project configuration**

```bash
git add package.json design/figma-ui-audit.config.json .agents/skills/auditing-figma-ui/scripts
git commit -m "feat: configure figma ui audit"
```

### Task 5: 编写并验证项目 Skill

**Files:**
- Create: `.agents/skills/auditing-figma-ui/SKILL.md`
- Create: `.agents/skills/auditing-figma-ui/references/audit-rules.md`
- Create: `.agents/skills/auditing-figma-ui/agents/openai.yaml`

**Interfaces:**
- Consumes: Figma file/page scope, `design/figma-ui-audit.config.json`, the validator CLI and Figma `use_figma` capability.
- Produces: a discoverable `auditing-figma-ui` workflow that extracts fresh snapshots, runs the validator, reviews warnings with screenshots and reports unresolved scope.

- [ ] **Step 1: Record the pre-Skill baseline failures outside the Skill directory**

Write `/tmp/auditing-figma-ui-baseline.md` from the already observed baseline: naive rules reported legitimate SVG overlaps, Hotspots, overlays, zero-gap table layouts and drawer empty space; source-aware scanning found a real `87px required / 80px available` button budget and dynamic model labels without ellipsis. Keep this evidence outside the production Skill until the baseline has been observed and classified.

- [ ] **Step 2: Initialize the Skill without examples**

Run:

```bash
python /Users/jiangtao/.codex/skills/.system/skill-creator/scripts/init_skill.py auditing-figma-ui --path .agents/skills --resources scripts,references
```

Then replace the generated content and remove every unused scaffold file or marker. Keep the description limited to trigger conditions: reviewing or validating Figma layouts, controls, modals, spacing, alignment, icons or interaction states.

- [ ] **Step 3: Write the extraction and audit workflow**

`SKILL.md` must require `figma-use`, one page per `use_figma` call, fresh snapshots after every mutation, validator execution before success claims, screenshot review for warnings, and a final report separating errors, warnings, approved exceptions and unscanned scope. `references/audit-rules.md` contains the snapshot schema, Plugin API extraction program, rule table and Action-Driver control profiles.

- [ ] **Step 4: Validate Skill structure and script discoverability**

Run:

```bash
python /Users/jiangtao/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/auditing-figma-ui
pnpm test:figma-audit
```

Expected: Skill validator succeeds and all deterministic validator tests pass. Because this task does not authorize subagents, record independent pressure-scenario testing as not run rather than claiming it passed.

- [ ] **Step 5: Commit the Skill**

```bash
git add .agents/skills/auditing-figma-ui
git commit -m "feat: add figma ui auditing skill"
```

### Task 6: 对真实 Figma 文件执行全面审计

**Files:**
- Create: `design/figma-ui-audit-report.md`
- Modify only if evidence requires: `design/figma-ui-audit.config.json`

**Interfaces:**
- Consumes: fresh snapshots for pages `60:2`, `60:4`, `60:6`, `273:5`, `379:2`, `315:2`.
- Produces: a dated audit report listing errors, warnings, screenshots reviewed, approved exceptions and follow-up node IDs.

- [ ] **Step 1: Extract one fresh snapshot per page**

Run six parallel `use_figma` calls, each switching page exactly once and returning the standardized snapshot. Save the combined JSON outside the repository first; do not treat prior exploratory output as current evidence.

- [ ] **Step 2: Run the validator in human and JSON modes**

Run:

```bash
pnpm validate:figma-audit -- /tmp/action-driver-figma-audit/*.json
pnpm validate:figma-audit -- --json /tmp/action-driver-figma-audit/*.json > /tmp/action-driver-figma-audit/report.json
```

Expected: exit `0` only if there are no errors; exit `1` is an expected successful audit outcome when current design violations are found and must not be converted into a passing code.

- [ ] **Step 3: Review every warning and representative screenshot**

Generate screenshots for all error nodes and for warning classes involving modal density, manual flow, icon semantics, control padding and geometry drift. Mark each as confirmed issue, approved exception with reason, or validator false positive requiring a test-first fix.

- [ ] **Step 4: Write the audit report**

Include per-page counts, exact node IDs, measurements, component-source root causes, repeated-instance deduplication, and separate follow-up work. Do not mark Figma clean while any error remains.

- [ ] **Step 5: Run final project verification**

Run:

```bash
pnpm test:figma-audit
python /Users/jiangtao/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/auditing-figma-ui
openspec validate add-figma-ui-audit-skill --strict
git diff --check
```

Expected: validator tests, Skill validation, OpenSpec strict validation and whitespace checks pass. The real design audit may intentionally report unresolved Figma errors; the report must list them explicitly.

- [ ] **Step 6: Commit the audit report**

```bash
git add design/figma-ui-audit-report.md design/figma-ui-audit.config.json
git commit -m "docs: report figma ui audit findings"
```
