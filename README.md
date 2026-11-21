# herdr-mods

Tmux-style `<Ctrl-Space>` keybindings, popup-free repeatable keys, Vim copy mode, and Vim-navigable **Spaces** & **Agents** sidebars for [Herdr](https://herdr.dev).

## Packages

| Folder | Type | Description |
|---|---|---|
| [`tmux-vim/`](./tmux-vim) | Layout + Mods | Complete Tmux `<Ctrl-Space>` workflow: focusable `Spaces` and `Agents` sidebars with `h/j/k/l` navigation, popup-free 500ms repeatable keys in the bottom status bar, Vim copy mode (`Ctrl-Space [`), and full `<Ctrl-Space>` keybindings. |
| [`copy-mode/`](./copy-mode) | Mod | Standalone Vim Copy Mode (`Ctrl-Space [`) for any Herdr layout using native `terminal.select` and `terminal.adjust_selection`. |

## How to Install in Herdr

Ask an agent inside Herdr:

```text
Read ~/.config/herdr-app/AGENTS.md and install tmux-vim from https://github.com/barrydevp/herdr-mods/tree/master/tmux-vim
```

Or for standalone Vim Copy Mode only:

```text
Read ~/.config/herdr-app/AGENTS.md and install copy-mode from https://github.com/barrydevp/herdr-mods/tree/master/copy-mode
```

## Local Development Sync

To copy changes from `~/.config/herdr-app` into this repository:

```powershell
Copy-Item ~/.config/herdr-app/layouts/main-vim.json ./tmux-vim/layouts/main-vim.json -Force
Copy-Item ~/.config/herdr-app/keys.json ./tmux-vim/keys.json -Force
foreach ($m in @("spaces-vim", "agents-vim", "workspace-status-vim", "copy-mode")) {
  Copy-Item ~/.config/herdr-app/mods/$m/main.js ./tmux-vim/mods/$m/main.js -Force
  Copy-Item ~/.config/herdr-app/mods/$m/mod.json ./tmux-vim/mods/$m/mod.json -Force
}
Copy-Item ~/.config/herdr-app/mods/copy-mode/main.js ./copy-mode/mods/copy-mode/main.js -Force
Copy-Item ~/.config/herdr-app/mods/copy-mode/mod.json ./copy-mode/mods/copy-mode/mod.json -Force
```
