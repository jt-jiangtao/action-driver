# Complete Figma UI QA inventory

## User-visible signoff claims

| Claim / control | Functional check | Visual state and evidence |
|---|---|---|
| Home default and model picker | Home copy, composer, trigger, outside/Escape close, keyboard/model selection | `home-default.png`, `home-model-selecting.png` at 1440×900 |
| Any recent task opens shared detail | Open multiple task IDs and verify unique title, message, timeline and browser title | `task-split.png` at 1440×900 |
| Task layout modes | Maximize, restore, collapse and expand browser through visible buttons | `task-split.png`, `task-browser-expanded.png`, `task-browser-collapsed.png` |
| Task model picker | Open picker without panel reflow; layout change closes it | `task-model-selecting.png` |
| Browser skill controls | Pause, resume, take over and return to Agent; pending locks duplicate input | Task screenshots plus component/E2E interaction |
| Settings populated / collapsed / menu | Expand/collapse library and open overlay menu | `settings-populated.png`, `settings-menu-open.png` |
| Delete confirmation / empty | Cancel preserves data; confirm both cards and reach real empty state | `settings-empty.png` |
| Add-model connection step | Complete fields, test connection, preserve values across steps | `settings-connection-form.png` |
| Model test states | Trigger untested → testing → success and deterministic partial failure | `settings-models-untested.png`, `settings-models-testing.png`, `settings-models-success.png`, `settings-models-partial-failure.png` |
| Minimum window | At 1024×700 all primary actions stay within viewport and Task columns do not overlap | E2E bounding-box assertions and `minimum-window.png` |

## Exploratory checks

- Unknown task IDs must not replace the current projection; rapidly switching recent tasks must not show stale content.
- Repeated pause/delete/test clicks while pending must issue one command and keep dialogs/menus recoverable.
- At 1024×700 inspect the densest states: Task split with floating browser controls and Settings model dialog.
- Check for clipping, horizontal page scroll, hidden primary actions, overlay stacking errors, fixed-icon colors, and layout movement when menus open.
