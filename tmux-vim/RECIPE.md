# Tmux + Vim Workflow (`main-vim`)

Tmux-style `<Ctrl-Space>` keybindings, Vim copy mode (`Ctrl-Space [`), top-center pickers (`picker-vim`, `palette-vim`, `help-vim`) with Vim navigation (`Ctrl-N/P`, `Ctrl-D/U`, `Ctrl-[`), and focusable **Spaces** and **Agents** sidebar panels that you can jump into with `Ctrl-Space h/j/k/l` and navigate using `h j k l`.

![Tmux + Vim Workflow](preview.png)

## What you see

- **Left sidebar (`268px` wide, `theme().chrome` background):**
  - Top header (`46px`, `workspace-chrome`): app brand, search button, and sidebar collapse toggle.
  - **Spaces pane (`spaces-vim`, weight 1, min `90px`):** spaces grouped by machine with worktrees nested under their main repository. When focused via `Ctrl+Space h` or clicking the pane background/header, it draws a `1px` `theme().accent` border, highlights the `Spaces` title in `theme().accent` with a `j/k · l/Enter` badge, and outlines the cursor-selected space row in `theme().accent`.
  - **Agents pane (`agents-vim`, weight 1, min `90px`):** agents in Priority or Grouped-by-space view with sub-agent trees. When focused, it draws a `1px` `theme().accent` border, highlights the `Agents` title in `theme().accent` with a `j/k · l/Enter` badge, and outlines the cursor-selected agent row in `theme().accent`.
  - Footer (`69px`, `workspace-chrome`): Settings and Add machine rows.
- **Right work column:**
  - Top tab bar (`42px`, `tabs`), main split terminal pane area (`padding: 8`, `gap: 8`, `radius: 10`), collapsible right `Files` / `Changes` stack (`368px`), and bottom status bar (`28px`, `workspace-status-vim`).
  - **Status bar (`workspace-status-vim`, `28px`):** shows machine name, git branch, agent count, blocked count, and the `Alt+Shift+P  commands` palette shortcut.

## How it behaves

- **Agent statuses:** working agents spin `mods/workspace-chrome/spinner.svg` in `theme().working`; blocked agents show a `Needs you` badge (or `!` in priority/compact mode) in `theme().blocked`; finished agents show a solid dot in `theme().done`; idle agents show a hollow ring in `theme().idle`.
- **Direct `<Ctrl-Space>` tmux prefix bindings:**
  - `Ctrl+Space` followed by `h/j/k/l` (or arrows) moves focus between panes and the sidebar (`pane.go`); `n/p` switches to next/prev tab; `( / )` or `K / J` switches to prev/next space; `< / >` moves the current tab left/right; `{ / }` swaps panes left/right.
  - `c` creates a tab, `1`–`9` selects a tab, `%` / `v` splits right, `"` / `s` splits down, `z` zooms, `x` / `q` closes a pane, `,` renames a tab, `&` closes a tab, `$` renames a space, `w` / `P` opens `picker-vim`, `[` opens Vim copy mode, `/` searches terminal output, `]` pastes, `:` opens `palette-vim`, `?` opens `help-vim`, `b` toggles the sidebar, `Ctrl-Space` sends NUL.
- **Sidebar Vim navigation (`Spaces` and `Agents`):**
  - `Ctrl+Space h` from the leftmost terminal pane moves focus into the sidebar (`Spaces` or `Agents`). `Ctrl+Space j` and `Ctrl+Space k` move between `Spaces` and `Agents`. `Ctrl+Space l`, `Esc`, or `q` moves focus back to the terminal pane.
  - Clicking a specific space or agent row switches to and focuses its terminal pane directly; clicking the sidebar pane background/header focuses that sidebar pane for keyboard navigation.
  - While focused in **Spaces**: `j`/`k` moves the cursor, `gg`/`G` jumps to first/last space, `Enter`/`l` switches to the highlighted space and focuses its terminal, `Space`/`o` switches space while keeping focus in `Spaces`, `h` folds the machine group, `n`/`a`/`+` creates a space, `r` renames, `d`/`x` closes, `m` opens the space menu.
  - While focused in **Agents**: `j`/`k` moves through agents and sub-agents, `gg`/`G` jumps to first/last, `Enter`/`l` focuses the agent's pane (or peeks at an unkept sub-agent), `Space`/`p` peeks, `P` pins/unpins, `h` folds sub-agents or groups, `s` toggles sort mode (`Priority` ↔ `Grouped by space`).
- **Quick pickers & help at top center (`Alt+P`, `Alt+Shift+P`, `Ctrl+Space ?`):**
  - `Alt+P` (or `Ctrl+Space w` / `Ctrl+Space P`) opens `picker-vim` (space/tab/agent switcher).
  - `Alt+Shift+P` (or `Ctrl+Space :`) opens `palette-vim` (command palette).
  - `Ctrl+Space ?` (or `Ctrl+?`) opens `help-vim` (keybindings list).
  - All three open at the same top popup position (`offset: 40, width: 640`) and support `Ctrl+N` / `Ctrl+P` to select next/previous, `Ctrl+D` / `Ctrl+U` to scroll half a page down/up, and `Ctrl+[` or `Esc` to close.
- **Terminal Escape fix:** `"ctrl-[": "send:\u001b[27u"` in the `"terminal"` section of `keys.json` sends the Kitty `CSI u` Escape sequence (`\x1b[27u`), which works as Escape in both Neovim and Antigravity/Codex.

## Built from

- **Layout:** `layouts/main-vim.json` (cloned from `main`), wiring block `spaces` to `spaces-vim`, block `agents` to `agents-vim`, and block `status` to `workspace-status-vim`, plus shipped `workspace-chrome`, `tabs`, `pane`, `files`, and `changes`.
- **Mods:**
  - `mods/spaces-vim/` (`focusable: true` in `mod.json`): cloned from `spaces`, listening for `"focus"` on `nextCommand()`, tracking a `FocusHandle` on `#spaces-root`, and handling `h/j/k/l` in `on_key_down`.
  - `mods/agents-vim/` (`focusable: true` in `mod.json`): cloned from `agents`, listening for `"focus"` on `nextCommand()`, tracking a `FocusHandle` on `#agents-root` and a `ScrollHandle` on `#ag-list`, and handling `h/j/k/l` in `on_key_down`.
  - `mods/workspace-status-vim/` (`place: "none"`): cloned from `workspace-status`, displaying the `Alt+Shift+P  commands` shortcut for `palette-vim`.
  - `mods/copy-mode/` (`place: "none"`, top popup overlay `580x40` at offset `12px`): Vim copy mode using `terminal.select`, `terminal.adjust_selection`, `terminal.clear_selection`, and `terminal.copy`.
  - `mods/picker-vim/`, `mods/palette-vim/`, `mods/help-vim/` (`place: "none"`, top popup overlays `640x0.8` at offset `40px`): top pickers and help reference with `Ctrl-N/P`, `Ctrl-D/U`, and `Ctrl-[` keybindings.
- **Keys:** `keys.json` merging default bindings with `<Ctrl-Space>` sequences, `"alt-p": "mod.open:picker-vim"`, `"alt-shift-p": "mod.open:palette-vim"`, and `"ctrl-[": "send:\u001b[27u"`.

## Watch out

- `this.handle.focus()` is applied by GPUI after the current JS callback returns. Schedule a follow-up `cx.notify()` after `25–35ms` (`watchFocus`) so `this.handle.is_focused()` renders `true` immediately without waiting for mouse hover events, and poll gently while `this.handle.is_focused()` is `true` so the focus ring clears as soon as focus leaves.
- Always call `run("pane.go", { direction: "right" })` when leaving a `"focusable": true` sidebar mod for the already-active terminal pane; calling `run("pane.focus", { pane })` alone on an already-focused pane leaves Herdr's `pane.go` state on the sidebar mod.
- Guard all `init()` tasks and commands with `if (checking()) return;` after initializing instance fields so `herdr-app check` passes cleanly.
- `spaces-vim` and `picker-vim` run `git` and `hc machine` as the shipped `spaces` and `picker` mods do.

## Done when

- `herdr-app check` passes on `mods/spaces-vim`, `mods/agents-vim`, `mods/workspace-status-vim`, `mods/copy-mode`, `mods/picker-vim`, `mods/palette-vim`, and `mods/help-vim`.
- `herdr-app status` reports `"layout": "main-vim"` and `"errors": []`.
- `Ctrl+Space h` moves keyboard focus from the terminal into the left sidebar (`Spaces` or `Agents`) and immediately draws the `theme().accent` focus border; `Ctrl+Space j` and `Ctrl+Space k` move between `Spaces` and `Agents`; `j` and `k` move the row cursor inside the focused sidebar; `Enter` or `l` activates the highlighted item and returns focus to the terminal.
- Pressing `Alt+P`, `Alt+Shift+P`, or `Ctrl+Space ?` opens the top-center popup where `Ctrl+N`/`Ctrl+P` moves selection, `Ctrl+D`/`Ctrl+U` scrolls half a page, and `Ctrl+[` closes the popup.
- Pressing `Ctrl+Space [` opens the `COPY (NORMAL)` pill at the top of the window, navigates and selects terminal text with `h/j/k/l` and `v`/`V`, yanks with `y`, and exits cleanly on `q` or `Esc`.
