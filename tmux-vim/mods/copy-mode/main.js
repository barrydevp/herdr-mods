// Tmux-style Vim copy mode overlay (`ctrl-space [`).
// Uses Herdr's native terminal.select and terminal.adjust_selection primitives.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  checking,
  closeOverlay,
  focused,
  props,
  run,
  terminals,
  theme,
} from "herdr";

export default class CopyMode extends View {
  init(_props, cx) {
    this.mode = "normal"; // "normal" | "char" | "line" | "word"
    this.count = "";
    this.pendingG = false;
    this.cleaned = false;
    this.seq = 0;
    this.handle = cx.focus_handle();
    if (checking()) return;

    const f = focused();
    this.terminal = props()?.terminal ?? f?.shown ?? f?.terminal ?? null;
    this.handle.focus();
    cx.timer.after(50, () => this.handle.focus());
    cx.timer.after(300, () => this.handle.focus());

    if (this.terminal) {
      const sel = this.selection();
      if (!sel) {
        run("terminal.select", {
          terminal: this.terminal,
          at: "cursor",
          mode: "cell",
        });
      }
    }
  }

  selection() {
    const f = focused();
    if (f && (!this.terminal || f.shown === this.terminal || f.terminal === this.terminal)) {
      if (f.selection) return f.selection;
    }
    if (!this.terminal) return null;
    return terminals().find((t) => t.address === this.terminal)?.selection ?? null;
  }

  takeCount() {
    const n = this.count ? Math.min(200, Math.max(1, parseInt(this.count, 10) || 1)) : 1;
    this.count = "";
    return n;
  }

  move(direction, cx, steps = 1) {
    this.pendingG = false;
    if (!this.terminal) return;
    const total = steps * this.takeCount();
    const token = ++this.seq;
    for (let i = 0; i < total; i++) {
      run("terminal.adjust_selection", { terminal: this.terminal, direction });
    }
    if (this.mode === "normal") {
      cx.spawn(async (cx) => {
        await cx.sleep(16);
        if (this.seq !== token || this.mode !== "normal" || !this.terminal) return;
        const sel = this.selection();
        if (
          sel?.end &&
          (sel.start.row !== sel.end.row || sel.start.col !== sel.end.col)
        ) {
          run("terminal.select", {
            terminal: this.terminal,
            at: sel.end,
            mode: "cell",
          });
        }
      });
    }
  }

  setMode(next, cx) {
    this.pendingG = false;
    this.count = "";
    if (!this.terminal) return;
    const sel = this.selection();
    const at = sel?.end ?? "cursor";
    if (this.mode === next) {
      this.mode = "normal";
      run("terminal.select", { terminal: this.terminal, at, mode: "cell" });
    } else {
      this.mode = next;
      const mode = next === "line" ? "line" : next === "word" ? "word" : "cell";
      run("terminal.select", { terminal: this.terminal, at, mode });
    }
    cx.notify();
  }

  yank() {
    this.cleaned = true;
    run("terminal.copy");
    if (this.terminal) {
      run("terminal.clear_selection", { terminal: this.terminal });
    }
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  exit() {
    if (!this.cleaned && this.terminal) {
      this.cleaned = true;
      run("terminal.clear_selection", { terminal: this.terminal });
    }
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  close() {
    if (checking()) return;
    if (!this.cleaned && this.terminal) {
      this.cleaned = true;
      run("terminal.clear_selection", { terminal: this.terminal });
    }
  }

  onKey(e, cx) {
    const k = e.key;
    const m = e.modifiers;

    // Ctrl combinations
    if (m.control && !m.alt && !m.platform) {
      if (k === "[" || k === "c") {
        this.exit();
        cx.stop_propagation();
        return;
      }
      if (k === "u") {
        this.move("up", cx, 15);
        cx.stop_propagation();
        return;
      }
      if (k === "d") {
        this.move("down", cx, 15);
        cx.stop_propagation();
        return;
      }
      if (k === "b") {
        this.move("page_up", cx, 1);
        cx.stop_propagation();
        return;
      }
      if (k === "f") {
        this.move("page_down", cx, 1);
        cx.stop_propagation();
        return;
      }
      if (k === "h" || k === "j" || k === "k" || k === "l") {
        const dir = { h: "left", j: "down", k: "up", l: "right" }[k];
        this.exit();
        run("pane.go", { direction: dir });
        cx.stop_propagation();
        return;
      }
      return;
    }

    if (m.alt || m.platform) return;
    const key = e.key_char ?? (m.shift && k.length === 1 ? k.toUpperCase() : k);

    if (k === "escape" || key === "q") {
      this.exit();
      cx.stop_propagation();
      return;
    }

    if (k === "enter" || key === "y") {
      this.yank();
      cx.stop_propagation();
      return;
    }

    if (key === "/" || key === "?") {
      this.exit();
      run("terminal.search");
      cx.stop_propagation();
      return;
    }

    // Count prefix 1-9, and 0 when count is already started
    if (/^[1-9]$/.test(key)) {
      this.pendingG = false;
      this.count = (this.count + key).slice(0, 3);
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (key === "0" && this.count.length > 0) {
      this.pendingG = false;
      this.count = (this.count + "0").slice(0, 3);
      cx.stop_propagation();
      cx.notify();
      return;
    }

    // gg / G
    if (key === "G") {
      this.move("end", cx, 1);
      cx.stop_propagation();
      return;
    }
    if (key === "g") {
      if (this.pendingG) {
        this.move("home", cx, 1);
      } else {
        this.pendingG = true;
        cx.notify();
      }
      cx.stop_propagation();
      return;
    }

    // Visual modes: v, V
    if (key === "V") {
      this.setMode("line", cx);
      cx.stop_propagation();
      return;
    }
    if (key === "v" || k === "space") {
      this.setMode("char", cx);
      cx.stop_propagation();
      return;
    }

    // Word motion / selection
    if (key === "w") {
      if (this.mode === "normal" && this.terminal) {
        const sel = this.selection();
        run("terminal.select", {
          terminal: this.terminal,
          at: sel?.end ?? "cursor",
          mode: "word",
        });
        this.mode = "word";
        cx.notify();
      } else {
        this.move("right", cx, 5);
      }
      cx.stop_propagation();
      return;
    }
    if (key === "b") {
      this.move("left", cx, 5);
      cx.stop_propagation();
      return;
    }

    // Line start / end
    if (key === "0" || key === "^" || k === "home") {
      this.move("line_start", cx, 1);
      cx.stop_propagation();
      return;
    }
    if (key === "$" || k === "end") {
      this.move("line_end", cx, 1);
      cx.stop_propagation();
      return;
    }

    // Page up / down
    if (k === "pageup" || key === "H") {
      this.move("page_up", cx, 1);
      cx.stop_propagation();
      return;
    }
    if (k === "pagedown" || key === "L") {
      this.move("page_down", cx, 1);
      cx.stop_propagation();
      return;
    }

    // Directional motions: h/j/k/l and arrow keys
    const dirs = {
      h: "left",
      left: "left",
      j: "down",
      down: "down",
      k: "up",
      up: "up",
      l: "right",
      right: "right",
    };
    if (dirs[key] || dirs[k]) {
      this.move(dirs[key] ?? dirs[k], cx, 1);
      cx.stop_propagation();
    }
  }

  render() {
    const t = theme();
    const sel = this.selection();
    const pos = sel?.end ? `${sel.end.row}:${sel.end.col}` : "cursor";
    const badgeText =
      this.mode === "char"
        ? "VISUAL"
        : this.mode === "line"
          ? "VISUAL LINE"
          : this.mode === "word"
            ? "VISUAL WORD"
            : "COPY (NORMAL)";
    const badgeBg = this.mode === "normal" ? t.accent : t.working;
    const prefix = `${this.count}${this.pendingG ? "g" : ""}`;

    const keyHint = (k, label) =>
      h_flex()
        .gap(4)
        .items_center()
        .child(
          div()
            .px(5)
            .py(1)
            .rounded(4)
            .bg(t.raised)
            .border_1()
            .border_color(t.border)
            .text_size(11)
            .text_color(t.foreground)
            .child(k),
        )
        .child(div().text_size(11.5).text_color(t.muted).child(label));

    return h_flex()
      .id("copy-mode")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .size_full()
      .px(10)
      .gap(10)
      .items_center()
      .bg(t.popover)
      .text_size(12)
      .child(
        div()
          .px(7)
          .py(2)
          .rounded(5)
          .bg(badgeBg)
          .text_size(11)
          .font_semibold()
          .text_color(t.accent_foreground)
          .child(badgeText),
      )
      .child(div().text_size(11.5).text_color(t.dim).child(pos))
      .when(Boolean(prefix), (el) =>
        el.child(
          div()
            .px(5)
            .py(1)
            .rounded(4)
            .bg(t.raised)
            .text_size(11)
            .font_semibold()
            .text_color(t.accent)
            .child(prefix),
        ),
      )
      .child(div().flex_1())
      .child(keyHint("hjkl", "move"))
      .child(keyHint("v/V", "select"))
      .child(keyHint("y", "yank"))
      .child(keyHint("/", "find"))
      .child(
        div()
          .id("cm-esc")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.exit())
          .child("q / Esc"),
      );
  }
}
