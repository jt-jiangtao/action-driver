---
name: imagegen
description: Use when the user asks ActionDriver to generate raster images, illustrations, photos, mockups, or visual variants from text. Shape precise prompts and call the available tools_local_image_generation_generate tool. This Skill does not enable a model or grant tool access by itself.
---

# Image Generation

This is the ActionDriver adaptation of Codex's Imagegen Skill. The complete original instructions are preserved at `references/codex-original-skill.md`; the original references, assets, scripts, agent metadata, and Apache 2.0 `LICENSE.txt` are also included.

## Default execution in ActionDriver

1. Understand the requested subject, style, composition, text, aspect ratio, and constraints. Preserve exact requested text and important visual invariants.
2. Use `references/prompting.md` and `references/sample-prompts.md` to shape the prompt. Add detail only when it helps the stated goal; do not invent unrelated objects, brands, or people.
3. If the `tools_local_image_generation_generate` tool is available, call it with `{ "images": [{ "prompt": "..." }] }`. The tool is backed by ActionDriver's `tools/local/image-generation/generate` runtime tool and the configured default image model. For 1–16 requested images or variants, pass independent prompt objects in the same `images` array. The runtime runs up to four requests at once, queues the rest, and displays every image in its own stable card.
4. Inspect the returned results. Keep successful images when another image fails. If a change is needed, make a focused follow-up call rather than claiming that the image already changed.
5. Explain what was generated and show the resulting conversation images. The runtime stores generated files in the current session's asset directory.

If `tools_local_image_generation_generate` is unavailable or no default image model is configured, explain that a default image model must be configured. A Skill never makes an unavailable tool appear. Do not silently run the bundled CLI as a substitute.

## Scope

- Use this Skill for new raster images and visual variants that benefit from image synthesis.
- The current ActionDriver tool accepts text prompts for generation. It does not provide image editing, image references, masks, transparency controls, output paths, or model overrides. Do not claim those controls are available through `tools_local_image_generation_generate`.
- For native SVG, HTML, CSS, or editable project graphics, use the relevant code tools instead.
- A request for several different images uses separate prompts in one tool call, up to 16 images per call. For more than 16, use additional calls.

## Included reference files

- `references/prompting.md` and `references/sample-prompts.md`: prompt design guidance for normal ActionDriver use.
- `references/codex-original-skill.md`: complete unmodified Codex Skill instructions for provenance; its built-in `image_gen` workflow does not apply to ActionDriver.
- `references/cli.md`, `references/image-api.md`, `references/codex-network.md`, `scripts/image_gen.py`, and `scripts/remove_chroma_key.py`: original Codex CLI resources preserved for completeness. They are **not** the default ActionDriver path, require separate dependencies and credentials, and must not be run as an implicit fallback.

## ActionDriver working directory

- `tools_local_image_generation_generate` delivers generated images directly as task results; no file output is required for that path.
- If a helper script writes image files, start it in the current session workspace, read uploaded inputs from the read-only `input/` directory, and write deliverables into `output/`; never write outside the session workspace.
- Resolve interpreters and packages through `tools_local_command_dependencies_load` instead of installing anything.
