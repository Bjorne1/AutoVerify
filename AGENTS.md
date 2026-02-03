# Repository Guidelines

## Project Structure & Module Organization
This repository contains Layui v2.5.7 distribution files:
- `layui.js`: module loader/runtime.
- `layui.all.js`: pre-bundled build (treat as generated output when possible).
- `lay\modules\`: individual component modules (e.g. `form.js`, `layer.js`, `table.js`).
- `css\`, `images\`, `font\`: static assets used by modules.

## Build, Test, and Development Commands
No build system or test runner is included (no `package.json`, Makefile, etc.). Validate changes by loading the files in a browser:
- Serve this directory with any static server, e.g. `python -m http.server 8000`.
- In a consuming page, include `layui.js` and smoke-test the changed module:
  - `<script src="layui.js"></script>`
  - `layui.use(['layer'], function(){ layer.msg('ok'); });`

## Coding Style & Naming Conventions
- Keep diffs small; avoid reformatting compacted files.
- Prefer editing sources under `lay\modules\` over patching `layui.all.js` directly.
- Module name should match filename and export key (e.g. `lay\modules\form.js` exports `form`).
- Preserve license/version headers at the top of files.

## Testing Guidelines
Automated tests are not present; use manual smoke tests for module loading, dependencies, and basic UI behavior. If you touch assets, verify `css\` and `font\` resources resolve correctly.

## Commit & Pull Request Guidelines
Git history is currently empty, so follow a consistent convention:
- Commit prefixes: `feat:`, `fix:`, `chore:`.
- PRs include: what changed, why, manual verification steps, and screenshots for UI changes.
- If the change must ship via `layui.all.js`, update it (or explain why not).
