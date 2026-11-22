import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, terminals, focused, theme, exec, hc, appHome, window, checking, shared, setShared, props, readTextFile } from "herdr";

// The shown tab's terminals are looked at this often; every agent (for the titles
// the sidebars show) less often.
const TAB_EVERY = 4000;
const ALL_EVERY = 30000;
// An agent that is not working is asked about again only this often (its limits can still move).
const IDLE_EVERY = 60000;

// "5h 87% left (1h 59m)": the percentages in `color`, the rest in `rest`. Each piece is its
// own text run, so spaces at a piece's edge become non-breaking to survive layout.
function colorPercent(text, color, rest) {
  const parts = String(text).split(/(\d+(?:\.\d+)?%)/).filter(Boolean);
  return h_flex().children(parts.map((s) =>
    div().text_color(/^\d+(?:\.\d+)?%$/.test(s) ? color : rest).child(s.replace(/ /g, " "))));
}

// `mac/t2` -> "mac" and "t2"; a bare `t2` is on this computer (null).
const machineOf = (addr) => (addr.includes("/") ? addr.slice(0, addr.lastIndexOf("/")) : null);
const localId = (addr) => addr.slice(addr.lastIndexOf("/") + 1);

const ICONS = {
  antigravity: { icon: "icons/antigravity.svg", tint: false },
  codex: { icon: "icons/codex.svg", tint: true },
  claude: { icon: "icons/claude.svg", tint: false },
};

function detectAgentKey(p, t, a, fg) {
  // Check live foreground process name first when available from `hc get`
  if (fg?.name) {
    const fgLow = `${fg.name} ${(fg.argv ?? []).join(" ")}`.toLowerCase();
    if (fgLow.includes("codex")) return "codex";
    if (fgLow.includes("claude")) return "claude";
    if (fgLow.includes("agy") || fgLow.includes("antigravity")) return "antigravity";
    // If foreground is explicitly a shell (pwsh, powershell, cmd, bash, zsh), no agent is running in the foreground
    // (a login shell's name starts with "-" on macOS and Linux: "-zsh")
    if (/^-?(pwsh|powershell|cmd|bash|zsh|fish|nu|sh|dash|ksh|tcsh|xonsh)(\.exe)?$/i.test(fg.name.split(/[\\/]/).pop())) {
      return null;
    }
  }

  const raw = [
    p?.app,
    p?.program?.key,
    p?.program?.name,
    t?.agent,
    t?.status?.app,
    t?.program?.key,
    t?.foreground?.name,
    a?.app,
    a?.program?.key,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (raw.includes("codex")) return "codex";
  if (raw.includes("claude")) return "claude";
  if (raw.includes("antigravity") || raw.includes("agy")) return "antigravity";
  return null;
}

export default class AgentUsageBar extends View {
  init(_props, cx) {
    this.cache = {};
    this.fgInfo = {};
    this.lastSig = "";
    this.busy = false;
    this.pendingRefresh = false;
    this.pendingAll = false;
    this.pendingForce = false;
    this.py = {}; // machine ("" here) -> the Python 3 command that works there; null: none
    this.remote = {}; // machine -> { want, path } of its query.py copy
    this.src = null; // query.py's text, for copies on other machines
    this.seen = {}; // terminal -> { key, stable, at } of its last query, to skip idle agents
    if (checking()) return;
    this.refresh(cx, true);
    cx.timer.every(TAB_EVERY, (cx) => {
      if (window().active) this.refresh(cx);
    });
    cx.timer.every(ALL_EVERY, (cx) => {
      if (window().active) this.refresh(cx, true);
    });
  }

  // The Python 3 command on a machine (null: this computer). `python3` is the Microsoft
  // Store stub on Windows, and often the only name on macOS and Linux.
  async python(m) {
    const k = m ?? "";
    if (this.py[k] !== undefined) return this.py[k];
    const names = !m && window()?.platform === "windows" ? ["python", "py"] : ["python3", "python", "py"];
    for (const cmd of names) {
      try {
        const r = await exec(cmd, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)"], { on: m, timeout: 8000 });
        if (r.code === 0) return (this.py[k] = cmd);
      } catch (e) {
        if (m && /unreachable|connect|machine/i.test(String(e?.message ?? e))) return null; // away: ask again later
      }
    }
    return (this.py[k] = null);
  }

  // query.py where Python can run it: here, the mod's own file; on another machine, a copy in
  // its ~/.cache/herdr-agent-usage, written once per version. Remote commands go through the
  // local `hc`, whose command line Windows caps at 32k characters, so it goes in pieces.
  async script(py, m) {
    const local = `${appHome()}/mods/agent-usage-vim/query.py`;
    if (!m) return local;
    this.src ??= await readTextFile(local);
    if (!this.src) return null;
    let h = 5381;
    for (let i = 0; i < this.src.length; i++) h = ((h * 33) ^ this.src.charCodeAt(i)) >>> 0;
    const want = `~/.cache/herdr-agent-usage/query-${h.toString(16)}.py`;
    if (this.remote[m]?.want === want) return this.remote[m].path;
    const has = await exec(py, ["-c", "import os,sys;p=os.path.expanduser(sys.argv[1]);print(p);sys.exit(0 if os.path.exists(p) else 1)", want], { on: m, timeout: 8000 });
    const path = has.stdout.trim();
    if (!path) return null;
    if (has.code !== 0) {
      const write = [
        "import os,sys,glob",
        "p,mode,text,last=sys.argv[1:5]",
        "os.makedirs(os.path.dirname(p),exist_ok=True)",
        "open(p+'.part',mode,encoding='utf-8',newline='').write(text)",
        "if last=='1':",
        "  os.replace(p+'.part',p)",
        "  [os.remove(f) for f in glob.glob(os.path.join(os.path.dirname(p),'query-*.py')) if f!=p]",
      ].join("\n");
      const CHUNK = 8000;
      for (let i = 0; i < this.src.length; i += CHUNK) {
        const r = await exec(py, ["-c", write, path, i ? "a" : "w", this.src.slice(i, i + CHUNK), i + CHUNK >= this.src.length ? "1" : "0"], { on: m, timeout: 15000 });
        if (r.code !== 0) return null;
      }
    }
    this.remote[m] = { want, path };
    return path;
  }

  target() {
    const f = focused();
    const allPanes = panes();
    const allTerms = terminals();
    const allAgents = agents();
    const termMap = new Map(allTerms.map((t) => [t.address, t]));
    const agentMap = new Map(allAgents.map((a) => [a.address, a]));

    const activeSpace = spaces().find((s) => s.active);
    const activeTab = activeSpace?.tabs?.find((tb) => tb.active);
    const tabId = f?.tab ?? activeTab?.id ?? null;

    // 1. Currently focused terminal/pane in the active tab
    const focusedPane =
      (f?.pane && allPanes.find((p) => p.pane === f.pane)) ||
      (tabId && allPanes.find((p) => p.tab === tabId && p.focused)) ||
      allPanes.find((p) => p.focused) ||
      (tabId && allPanes.find((p) => p.tab === tabId)) ||
      null;

    const focusedTermAddr = f?.shown ?? f?.terminal ?? focusedPane?.terminal ?? null;
    if (focusedTermAddr) {
      const p = allPanes.find((x) => x.terminal === focusedTermAddr) ?? focusedPane;
      const t = termMap.get(focusedTermAddr);
      const a = agentMap.get(focusedTermAddr);
      const fg = this.fgInfo[focusedTermAddr];
      const key = detectAgentKey(p, t, a, fg);
      if (key) {
        return {
          terminal: focusedTermAddr,
          agent: key,
          cwd: fg?.cwd ?? p?.cwd ?? t?.cwd ?? f?.cwd ?? activeSpace?.folder ?? "",
          pid: fg?.pid ?? null,
          argv: fg?.argv ?? null,
          program: p?.program ?? a?.program ?? t?.program ?? null,
        };
      }
    }

    // 2. Any other agent pane in the SAME active tab (e.g., when split alongside a shell)
    if (tabId) {
      const tabPanes = allPanes.filter((p) => p.tab === tabId && p.terminal && p.terminal !== focusedTermAddr);
      for (const p of tabPanes) {
        const t = termMap.get(p.terminal);
        const a = agentMap.get(p.terminal);
        const fg = this.fgInfo[p.terminal];
        const key = detectAgentKey(p, t, a, fg);
        if (key) {
          return {
            terminal: p.terminal,
            agent: key,
            cwd: fg?.cwd ?? p.cwd ?? t?.cwd ?? activeSpace?.folder ?? "",
            pid: fg?.pid ?? null,
            argv: fg?.argv ?? null,
            program: p.program ?? a?.program ?? t?.program ?? null,
          };
        }
      }
    }

    // No active agent in the current tab
    return {
      terminal: focusedTermAddr ?? null,
      agent: null,
      cwd: (focusedTermAddr && this.fgInfo[focusedTermAddr]?.cwd) ?? focusedPane?.cwd ?? f?.cwd ?? activeSpace?.folder ?? "",
      pid: null,
      argv: null,
      program: null,
    };
  }

  // What the bar can show (the focused terminal, else an agent in the shown tab);
  // with `all`, every agent too, for the titles the sidebars read. Terminals on other
  // machines (`mac/t2`) are asked about there, where their agents keep their files.
  collectCandidateTerminals(all) {
    const f = focused();
    const tabId = f?.tab ?? spaces().find((s) => s.active)?.tabs?.find((tb) => tb.active)?.id ?? null;
    const addrs = new Set();

    if (f?.shown) addrs.add(f.shown);
    if (f?.terminal) addrs.add(f.terminal);
    for (const p of panes()) {
      if (p.terminal && p.tab === tabId) addrs.add(p.terminal);
    }
    if (all) {
      for (const a of agents()) {
        if (a.address) addrs.add(a.address);
      }
    }
    return Array.from(addrs).filter(Boolean);
  }

  // Forget terminals that ended: their address can come back for a new one.
  prune() {
    const all = terminals();
    if (!all.length) return; // right after a start the list is empty
    const live = new Set(all.filter((t) => t.state === "live").map((t) => t.address));
    for (const k of Object.keys(this.fgInfo)) if (!live.has(k)) delete this.fgInfo[k];
    for (const k of Object.keys(this.cache)) if (!live.has(k)) delete this.cache[k];
    const titles = shared("agent.titles");
    if (titles && typeof titles === "object" && Object.keys(titles).some((k) => !live.has(k))) {
      setShared("agent.titles", Object.fromEntries(Object.entries(titles).filter(([k]) => live.has(k))));
    }
  }

  // What the bar shows, to redraw only when it changes (a redraw redraws every mod).
  shownState() {
    return JSON.stringify([this.cache, this.fgInfo, this.py]);
  }

  // `force` (a click): ask about every agent now, idle or not.
  refresh(cx, all = false, force = false) {
    if (checking()) return;
    if (this.busy) {
      this.pendingRefresh = true;
      this.pendingAll ||= all;
      this.pendingForce ||= force;
      return;
    }
    this.busy = true;
    cx.spawn(async (cx) => {
      const before = this.shownState();
      try {
        if (all) this.prune();
        const addrs = this.collectCandidateTerminals(all);
        const activity = {};
        for (const addr of addrs) {
          try {
            const r = await hc(["get", addr, "--json"]);
            if (r.code === 0 && r.stdout) {
              const info = JSON.parse(r.stdout);
              const fg = info?.foreground;
              if (fg) this.fgInfo[addr] = fg;
              activity[addr] = {
                working: info?.status?.state === "working",
                key: [info?.turn, info?.status?.state, info?.status_ms, fg?.pid, fg?.cwd, fg?.name].join(":"),
              };
            }
          } catch {
            // ignore individual hc get error
          }
        }

        const allPanes = panes();
        const allTerms = terminals();
        const allAgents = agents();
        const termMap = new Map(allTerms.map((t) => [t.address, t]));
        const agentMap = new Map(allAgents.map((a) => [a.address, a]));

        // Layout props: "claude_usage_api": false keeps the Claude limits off the network.
        const network = props()?.claude_usage_api !== false;
        const reqList = [];
        for (const addr of addrs) {
          const p = allPanes.find((x) => x.terminal === addr);
          const t = termMap.get(addr);
          const a = agentMap.get(addr);
          const fg = this.fgInfo[addr];
          const key = detectAgentKey(p, t, a, fg);
          // Skip an agent that isn't working and hasn't changed in its last two queries (its
          // turn's final numbers can land just after its state changes), for up to IDLE_EVERY.
          const act = activity[addr];
          const prev = this.seen[addr];
          const now = Date.now();
          if (key && act && !force && !act.working && prev?.stable && prev.key === act.key && now - prev.at < IDLE_EVERY && this.cache[addr]) continue;
          if (key && act) this.seen[addr] = { key: act.key, stable: prev?.key === act.key, at: now };
          if (key) {
            reqList.push({
              terminal: addr,
              agent: key,
              cwd: fg?.cwd ?? p?.cwd ?? t?.cwd ?? "",
              pid: fg?.pid ?? null,
              argv: fg?.argv ?? null,
              network,
            });
          }
        }

        // One run per machine, each with its own terminal ids (`mac/t2` is `t2` there).
        const byMachine = new Map();
        for (const req of reqList) {
          const m = machineOf(req.terminal);
          if (!byMachine.has(m)) byMachine.set(m, []);
          byMachine.get(m).push({ ...req, terminal: localId(req.terminal) });
        }
        const parsed = {};
        for (const [m, reqs] of byMachine) {
          try {
            const py = await this.python(m);
            const script = py && (await this.script(py, m));
            if (!script) continue;
            const res = await exec(py, [script, JSON.stringify(reqs)], { on: m, timeout: 10000 });
            const out = res.code === 0 && res.stdout ? JSON.parse(res.stdout.trim()) : null;
            for (const [tid, info] of Object.entries(out && typeof out === "object" ? out : {})) parsed[m ? `${m}/${tid}` : tid] = info;
          } catch {
            // that machine is away or its run failed: keep what it showed
          }
        }
        this.cache = { ...this.cache, ...parsed };
        const prevTitles = shared("agent.titles") ?? {};
        const nextTitles = { ...(typeof prevTitles === "object" && prevTitles ? prevTitles : {}) };
        let titlesChanged = false;
        for (const [tid, info] of Object.entries(parsed)) {
          if (info?.title && nextTitles[tid] !== info.title) {
            nextTitles[tid] = info.title;
            titlesChanged = true;
          }
        }
        if (titlesChanged) setShared("agent.titles", nextTitles);
      } catch {
        // ignore transient errors
      } finally {
        if (this.shownState() !== before) cx.notify();
        this.busy = false;
        if (this.pendingRefresh) {
          const again = this.pendingAll;
          const forced = this.pendingForce;
          this.pendingRefresh = false;
          this.pendingAll = false;
          this.pendingForce = false;
          this.refresh(cx, again, forced);
        }
      }
    });
  }

  renderIcon(t, agentKey, prog) {
    const spec = (prog?.icon ? { icon: prog.icon, tint: prog.tint } : null) ?? ICONS[agentKey] ?? ICONS.antigravity;
    if (!spec?.icon) return null;
    return spec.tint
      ? svg(spec.icon).size(13).flex_none().text_color(t.muted)
      : image(spec.icon).w(13).h(13).flex_none();
  }

  render(cx) {
    const t = theme();
    const cur = this.target();
    const allTerms = terminals();
    const termObj = cur.terminal ? allTerms.find((x) => x.address === cur.terminal) : null;
    const sig = `${cur.terminal ?? "none"}:${cur.agent ?? "none"}:${cur.cwd}:${cur.pid ?? 0}:${termObj?.turn ?? 0}:${termObj?.status ?? ""}`;
    if (sig !== this.lastSig && !checking()) {
      this.lastSig = sig;
      this.refresh(cx);
    }

    if (!cur.agent || !cur.terminal) {
      return h_flex()
        .id("agent-usage-bar")
        .size_full()
        .px(14)
        .gap(8)
        .items_center()
        .bg(t.chrome)
        .border_t(1)
        .border_color(t.border)
        .text_size(11.5)
        .text_color(t.dim)
        .on_click((_e, cx) => this.refresh(cx, false, true))
        .child("No active agent in this tab");
    }

    const where = machineOf(cur.terminal);
    if (this.py[where ?? ""] === null) {
      return h_flex()
        .id("agent-usage-bar")
        .size_full()
        .px(14)
        .items_center()
        .bg(t.chrome)
        .border_t(1)
        .border_color(t.border)
        .text_size(11.5)
        .text_color(t.dim)
        .child(`Agent usage needs Python 3 on ${where ?? "this computer"} (python3, or python / py on Windows)`);
    }

    const data = this.cache[cur.terminal] ?? null;
    const agentKey = data?.agent_key ?? cur.agent;
    const modelLabel = data?.model ? `${data.agent} · ${data.model}` : cur.agent === "codex" ? "Codex" : cur.agent === "claude" ? "Claude Code" : "Antigravity";
    const ctxVal = data?.context_value ?? "loading…";
    const limitItems = Array.isArray(data?.limit_items) && data.limit_items.length ? data.limit_items : [{ text: "loading…", pct: null }];

    const ctxPct = data?.context_pct ?? 0;
    // Only a number that needs you is colored: terminal yellow to watch, red to act.
    const ctxColor = ctxPct >= 85 ? t.ansi1 : ctxPct >= 60 ? t.ansi3 : t.foreground;

    const itemColor = (pct) => (pct != null && pct <= 5 ? t.ansi1 : pct != null && pct <= 20 ? t.ansi3 : t.foreground);

    const pic = this.renderIcon(t, agentKey, cur.program);

    const rightChildren = [div().text_color(t.dim).child("Limit:")];
    limitItems.forEach((item, idx) => {
      if (idx > 0) rightChildren.push(div().text_color(t.dim).child("·"));
      rightChildren.push(colorPercent(item.text, itemColor(item.pct), t.muted));
    });

    return h_flex()
      .id("agent-usage-bar")
      .size_full()
      .px(14)
      .gap(6)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.5)
      .text_color(t.muted)
      .on_click((_e, cx) => this.refresh(cx, false, true))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .flex_none()
          .when(Boolean(pic), (el) => el.child(pic))
          .child(div().text_color(t.foreground).font_medium().child(modelLabel))
          // The reasoning effort the agent runs at (low … max, as its model names them).
          .when(Boolean(data?.effort), (el) => el
            .child(div().px(5).rounded(4).bg(t.raised).text_size(10.5).text_color(t.muted).child(data.effort)))
          .child(div().text_color(t.dim).child("·"))
          .child(div().text_color(t.dim).child("Context:"))
          .child(colorPercent(ctxVal, ctxColor, t.muted)),
      )
      .child(div().text_color(t.dim).child("·"))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .flex_none()
          .children(rightChildren),
      );
  }
}
