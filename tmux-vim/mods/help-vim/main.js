// The keybind list (Herdr's prefix+?), grouped, filterable by typing.
// Opens at the same top popup position as the picker (offset: 40, width: 640)
// and supports Ctrl+n/p, Ctrl+d/u, and Ctrl+[ / Esc.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { checking, keys, props, closeOverlay, theme } from "herdr";

const GROUPS = [
  ["spaces", /^space\./],
  ["tabs", /^tab\./],
  ["panes", /^pane\./],
  ["agents", /^agent\./],
  ["terminal", /^terminal\.|^send:|^mod\.open:copy-mode/],
  ["window", /./],
];

const HALF_PAGE = 6;

function label(action) {
  if (action.startsWith("send:")) return "type " + JSON.stringify(action.slice(5));
  const [name, arg] = action.split(":");
  const words = name.replace(/[._-]/g, " ");
  return arg ? `${words} ${arg}` : words;
}

export default class HelpVim extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = 0;
    this.allKeys = keys().map((k) => {
      const text = label(k.action);
      return { ...k, text, lowerKeys: k.keys.toLowerCase(), lowerText: text.toLowerCase() };
    });
    this.input = InputState.new({ placeholder: "Type to filter…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = 0;
      cx.notify();
    });
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    if (checking()) return;
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
  }

  close() {
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  render() {
    const t = theme();
    const f = this.filter.toLowerCase();
    const source = this.allKeys ?? [];
    const all = f ? source.filter((k) => k.lowerKeys.includes(f) || k.lowerText.includes(f)) : source;
    const seen = new Set();
    const groups = GROUPS.map(([name, re]) => {
      const rows = all.filter((k) => !seen.has(k) && re.test(k.action) && (seen.add(k) || true));
      return [name, rows];
    }).filter(([, rows]) => rows.length > 0);

    const flatRows = groups.flatMap(([, rows]) => rows);
    this.at = Math.min(this.at, Math.max(0, flatRows.length - 1));
    const itemToChildIdx = new Map();
    const children = [];
    let rowIdx = 0;
    for (const [name, rows] of groups) {
      children.push(
        div().pt(4).pb(2).px(8).text_size(11.5).font_medium().text_color(t.dim).child(name),
      );
      for (const k of rows) {
        const idx = rowIdx++;
        const on = idx === this.at;
        itemToChildIdx.set(idx, children.length);
        children.push(
          h_flex()
            .id(`help-row-${idx}`)
            .h(32)
            .flex_none()
            .px(8)
            .rounded(7)
            .items_center()
            .when(on, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => {
              this.at = idx;
              cx.notify();
            })
            .child(div().w(190).text_color(t.accent).child(k.keys + (k.section !== "global" ? `  (${k.section})` : "")))
            .child(div().text_color(t.foreground).child(k.text)),
        );
      }
    }

    const moveTo = (next, cx) => {
      if (!flatRows.length) return;
      this.at = Math.max(0, Math.min(flatRows.length - 1, next));
      const childIdx = itemToChildIdx.get(this.at);
      if (childIdx !== undefined) this.scroll.scroll_to_item(childIdx);
      cx.notify();
    };

    return v_flex()
      .id("help")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const k = e.key;
        const m = e.modifiers;
        const ctrl = m.control && !m.alt && !m.platform;
        if (k === "escape" || (ctrl && k === "[")) {
          cx.stop_propagation();
          this.close();
          return;
        }
        if (k === "down" || (ctrl && k === "n")) {
          cx.stop_propagation();
          moveTo(this.at + 1, cx);
        } else if (k === "up" || (ctrl && k === "p")) {
          cx.stop_propagation();
          moveTo(this.at - 1, cx);
        } else if (k === "pagedown" || (ctrl && k === "d")) {
          cx.stop_propagation();
          moveTo(this.at + HALF_PAGE, cx);
        } else if (k === "pageup" || (ctrl && k === "u")) {
          cx.stop_propagation();
          moveTo(this.at - HALF_PAGE, cx);
        }
      })
      .w_full()
      .h(430)
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(12)
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Keybinds"))
          .child(
            div()
              .id("help-esc")
              .px(6)
              .py(2)
              .rounded(5)
              .text_size(11)
              .text_color(t.dim)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover).text_color(t.foreground))
              .on_click(() => this.close())
              .child("Esc"),
          ),
      )
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(10)
          .gap(8)
          .items_center()
          .rounded(9)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .track_scroll(this.scroll)
          .py(2)
          .gap(2)
          .children(children),
      );
  }
}
