---
name: auditing-figma-ui
description: Review or validate Figma UI layouts, controls, modals, spacing, alignment, icons, and interaction states with reproducible structural checks and screenshot evidence.
---

# Auditing Figma UI

Use this Skill for a Figma design audit or for validation after Figma UI changes. It does not authorize design mutations; remain read-only unless the user explicitly asks to modify the file.

## Required workflow

1. Load `figma-use` before calling Figma `use_figma`.
2. Read [references/audit-rules.md](references/audit-rules.md) before extracting a snapshot or interpreting a finding.
3. Resolve the requested file and page scope. For ActionDriver, use `design/figma-ui-audit.config.json` as the project contract.
4. Extract a fresh snapshot with one `use_figma` call per page. Each call may switch page exactly once with `await figma.setCurrentPageAsync(page)`.
5. Save snapshots outside the repository unless the user requests checked-in fixtures. Validate the snapshot page id and required fields before running the script.
6. Run both reports:

   ```bash
   pnpm validate:figma-audit -- /tmp/action-driver-figma-audit/*.json
   pnpm --silent validate:figma-audit -- --json /tmp/action-driver-figma-audit/*.json
   ```

   Use `--silent` for the JSON form so the package-runner banner does not corrupt redirected JSON output. Keep generated reports outside the snapshot glob.

7. Treat exit `0` as no deterministic errors, exit `1` as a successful audit that found errors, and exit `2` as invalid input or configuration. Never suppress exit `1` to claim the design passed.
8. Review every warning and every representative error visually. Capture screenshots for modal density, manual flow, icon semantics, control padding, geometry drift, and any rule whose meaning depends on visual context.
9. Classify each finding as confirmed issue, exact approved exception, or validator false positive. Fix false positives test-first before rerunning the audit.
10. Report deterministic errors, warnings, approved exceptions, screenshot conclusions, and unscanned scope separately. Do not state that Figma is clean while errors or unscanned required pages remain.

## Non-negotiable constraints

- After any Figma mutation, discard affected snapshots and extract them again.
- Match controls by normalized source component identity, not display name or instance id.
- Do not reject absolute positioning or fixed sizing by itself. Report measurable overflow, clipping, overlap, unreachable interaction, or a declared dynamic-content conflict.
- Exceptions require one `ruleId`, one exact `nodeId`, and a non-empty reason. Never add wildcard, page-wide, or blank-reason exceptions.
- Preserve legal SVG internals, Hotspots, overlays, drawers, scroll regions, edge contact, static HUG buttons, and icon-only controls.
- Do not use text glyphs as icons to silence icon checks; use actual vector or component instances.
- Do not claim independent agent pressure-testing unless it actually ran. A self-review must be labeled as such.
