# Developing `herdr-mods`

This repository contains shareable Herdr layouts and mods (`tmux-vim/` and `copy-mode/`).
Herdr runs live from `~/.config/herdr-app` (`~\.config\herdr-app`).

## First Step for Any Agent

Before editing any mod, layout, or keybinding, read:
1. `~\.config\herdr-app\AGENTS.md` — Herdr's full architecture, layout, keybinding, and mod rules.
2. `~\.config\herdr-app\herdr.d.ts` and `~\.config\herdr-app\gpui-kit.d.ts` — The exact TypeScript definitions for the installed version of Herdr.

## Packages in This Repo

- `tmux-vim/`:
  - `layouts/main-vim.json`: Cloned `main` layout using `spaces-vim`, `agents-vim`, and `workspace-status-vim`.
  - `mods/spaces-vim/`: Focusable Spaces sidebar (`"focusable": true`) with `h/j/k/l` navigation and `watchFocus` focus ring management.
  - `mods/agents-vim/`: Focusable Agents sidebar (`"focusable": true`) with `h/j/k/l` navigation and `watchFocus` focus ring management.
  - `mods/workspace-status-vim/`: Bottom status bar with integrated popup-free 500ms repeat-key controller (`REPEAT · 500ms`).
  - `mods/copy-mode/`: Top status pill for tmux-style `copy-mode-vi` (`Ctrl-Space [`).
  - `mods/help-vim/`: Top popup keybindings reference (`Ctrl-Space ?` / `Ctrl-?`) aligned with the picker/palette position.
  - `keys.json`: `<Ctrl-Space>` tmux prefix bindings + `"alt-p": "mod.open:picker"`, `"alt-shift-p": "app.palette"`, `"ctrl-[": "send:\u001b"`.
  - `RECIPE.md` & `preview.png`: Shareable recipe and screenshot for `herdr.dev/layouts`.
- `copy-mode/`:
  - Standalone package of `mods/copy-mode/` (`main.js`, `mod.json`, `keys.json`, `RECIPE.md`, `preview.png`) for `herdr.dev/mods`.
  - Keep `copy-mode/mods/copy-mode/` and `tmux-vim/mods/copy-mode/` in sync using `./sync.ps1`.

## Development Workflow (`./sync.ps1`)

Use `./sync.ps1` to sync between this repo and the live Herdr app (`~/.config/herdr-app`):

```powershell
# 1. Edit files in C:\Dev\herdr-mods\tmux-vim\..., then deploy to live Herdr and run checks:
./sync.ps1 apply

# 2. Or if you edited files directly in ~/.config/herdr-app, pull them back into this repo:
./sync.ps1 pull

# 3. Validate all mods with herdr-app check and check live window status:
./sync.ps1 check
```
