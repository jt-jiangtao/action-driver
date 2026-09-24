---
name: Skill Creator
description: Create or revise a reusable ActionDriver Skill when the user asks for one.
---

# Skill Creator

Create a focused Skill folder with a `SKILL.md` entrypoint. Its frontmatter needs a clear `name` and a short `description` that says when to use it. The body should contain only instructions that change how the Agent handles the requested task. Put substantial optional detail in `references/` and deterministic helpers in `scripts/` only when the workflow needs them.

Use the already available Shell, Python, Node, or TypeScript tool to write the folder in the current workspace. Then call `skill_install` with the local folder path so ActionDriver validates and copies it into the personal Skill directory. Do not write directly into `.system`, install packages, or assume this Skill grants additional tool permissions. Check the installed Skill's name, description, and content before telling the user it is ready.

The bundled `references/codex-skill-creator.md` preserves the source author's detailed skill-writing guidance. The companion `scripts/`, `agents/`, `assets/`, and license are copied with this system Skill. Use a companion file only when it fits ActionDriver's available tools; the copied Python validators use PyYAML and are not part of the standard-library-only runtime contract.
