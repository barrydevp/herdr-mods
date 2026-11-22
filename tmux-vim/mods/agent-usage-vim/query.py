import sys
import os
import re
import json
import glob
import time
import sqlite3
import subprocess
import urllib.request
from datetime import datetime

IS_WIN = os.name == "nt"
if IS_WIN:
    import msvcrt
    import ctypes
    import ctypes.wintypes as wt
else:
    import fcntl

HOME = os.path.expanduser("~")
USAGE_DIR = os.path.join(HOME, ".config", "herdr-app", "data", "agent-usage")
AGY_DIR = os.path.join(HOME, ".gemini", "antigravity-cli")
CODEX_DIR = os.path.join(HOME, ".codex")
CLAUDE_DIR = os.path.join(HOME, ".claude")


def norm_path(p):
    if not p:
        return ""
    p = str(p).strip()
    if p.startswith("\\\\?\\"):
        p = p[4:]
    return os.path.normcase(os.path.normpath(p)).rstrip("\\/")


def parse_etime(text):
    # ps etime: [[dd-]hh:]mm:ss
    days, _, rest = text.strip().rpartition("-")
    parts = [int(x) for x in rest.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return (int(days) if days else 0) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]


def get_proc_start_time(pid):
    if not pid:
        return None
    if not IS_WIN:
        try:
            stat = f"/proc/{int(pid)}/stat"
            if os.path.exists(stat):
                with open(stat) as f:
                    start_ticks = int(f.read().rsplit(")", 1)[1].split()[19])
                with open("/proc/stat") as f:
                    btime = next(int(line.split()[1]) for line in f if line.startswith("btime"))
                return btime + start_ticks / os.sysconf("SC_CLK_TCK")
            r = subprocess.run(["ps", "-o", "etime=", "-p", str(int(pid))], capture_output=True, text=True, timeout=2)
            if r.returncode == 0 and r.stdout.strip():
                return time.time() - parse_etime(r.stdout)
        except Exception:
            pass
        return None
    try:
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
        if not h:
            return None
        ctime, etime, ktime, utime = wt.FILETIME(), wt.FILETIME(), wt.FILETIME(), wt.FILETIME()
        ok = ctypes.windll.kernel32.GetProcessTimes(
            h, ctypes.byref(ctime), ctypes.byref(etime), ctypes.byref(ktime), ctypes.byref(utime)
        )
        ctypes.windll.kernel32.CloseHandle(h)
        if not ok:
            return None
        ticks = (ctime.dwHighDateTime << 32) | ctime.dwLowDateTime
        return (ticks - 116444736000000000) / 10000000.0
    except Exception:
        return None


def is_file_locked(path):
    if not os.path.exists(path):
        return False
    try:
        with open(path, "r+b") as f:
            if IS_WIN:
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                # Either lock style may be the one the agent holds.
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                fcntl.lockf(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.lockf(f.fileno(), fcntl.LOCK_UN)
        return False
    except OSError:
        return True


def fmt_tokens(n):
    if n is None:
        return "0"
    n = float(n)
    if n >= 999500:
        val = n / 1000000.0
        return f"{val:.1f}M".replace(".0M", "M")
    if n >= 1000:
        val = n / 1000.0
        return f"{val:.1f}k".replace(".0k", "k") if val < 100 else f"{int(round(val))}k"
    return str(int(round(n)))


def fmt_duration(seconds):
    if seconds is None:
        return ""
    seconds = int(max(0, seconds))
    if seconds <= 0:
        return ""
    d = seconds // 86400
    h = (seconds % 86400) // 3600
    m = (seconds % 3600) // 60
    if d > 0:
        return f"{d}d {h}h" if h > 0 else f"{d}d"
    if h > 0:
        return f"{h}h {m}m" if m > 0 else f"{h}h"
    return f"{m}m" if m > 0 else "<1m"


def read_json(path):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None


def read_tail_lines(path, max_bytes=65536):
    try:
        if not os.path.exists(path):
            return []
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            if size > max_bytes:
                f.seek(size - max_bytes)
                raw = f.read().decode("utf-8", errors="ignore")
                lines = raw.splitlines()[1:]
            else:
                raw = f.read().decode("utf-8", errors="ignore")
                lines = raw.splitlines()
        return lines
    except Exception:
        return []


def resolve_agy_conv_id(cwd):
    nc = norm_path(cwd)
    if not nc:
        return None
    last_conv = read_json(os.path.join(AGY_DIR, "cache", "last_conversations.json")) or {}
    for k, v in last_conv.items():
        if norm_path(k) == nc:
            return v
    for line in reversed(read_tail_lines(os.path.join(AGY_DIR, "history.jsonl"), 32768)):
        try:
            d = json.loads(line)
            if norm_path(d.get("workspace")) == nc and d.get("conversationId"):
                return d.get("conversationId")
        except Exception:
            pass
    return None


def norm_effort(value):
    v = re.sub(r"[^a-z]", "", str(value or "").lower())
    return v or None


def effort_in_name(name):
    # Antigravity names its effort in the model: "Gemini 4 Neon (XHigh)".
    m = re.search(r"\(([A-Za-z -]+)\)\s*$", str(name or ""))
    return norm_effort(m.group(1)) if m else None


def clean_line(text, max_len=60):
    if not text:
        return ""
    line = " ".join(str(text).strip().split())
    if line.startswith("/") and " " in line:
        line = line.lstrip("/")
    if len(line) > max_len:
        line = line[: max_len - 1].rstrip() + "…"
    return line


def extract_agy_first_prompt(conv_id):
    if not conv_id:
        return ""
    t_path = os.path.join(AGY_DIR, "brain", conv_id, ".system_generated", "logs", "transcript.jsonl")
    if not os.path.exists(t_path):
        return ""
    try:
        with open(t_path, "r", encoding="utf-8", errors="ignore") as f:
            for idx, raw_line in enumerate(f):
                if idx > 20:
                    break
                d = json.loads(raw_line)
                if d.get("type") == "USER_INPUT":
                    content = d.get("content") or ""
                    m = re.search(r"<USER_REQUEST>\s*(.*?)\s*</USER_REQUEST>", content, re.S)
                    txt = m.group(1) if m else content
                    for ln in txt.splitlines():
                        ln = ln.strip()
                        if ln:
                            return clean_line(ln)
    except Exception:
        pass
    return ""


def get_agy_transcript_usage(conv_id):
    if not conv_id:
        return None
    t_path = os.path.join(AGY_DIR, "brain", conv_id, ".system_generated", "logs", "transcript.jsonl")
    if not os.path.exists(t_path):
        return None
    mtime = os.path.getmtime(t_path)
    lines = read_tail_lines(t_path, 98304)
    for line in reversed(lines):
        try:
            d = json.loads(line)
            if d.get("type") == "PLANNER_RESPONSE" and (
                "input_tokens" in d or "cache_read_tokens" in d or "output_tokens" in d
            ):
                inp = int(d.get("input_tokens") or 0)
                cache_r = int(d.get("cache_read_tokens") or 0)
                cache_c = int(d.get("cache_creation_tokens") or 0)
                out = int(d.get("output_tokens") or 0)
                total = inp + cache_r + cache_c + out
                return {
                    "used_tokens": total,
                    "window_size": 1048576,
                    "model": d.get("model") or "",
                    "mtime": mtime,
                }
        except Exception:
            pass
    return {"used_tokens": 0, "window_size": 1048576, "model": "", "mtime": mtime}


def format_agy_model(m_str):
    if not m_str:
        return "Gemini"
    low = m_str.lower()
    if "argon" in low:
        return "Gemini 4 Argon"
    if "neon" in low:
        return "Gemini 4 Neon"
    if "hydrogen" in low:
        return "Gemini 4 Hydrogen"
    if "flash" in low:
        return "Gemini Flash"
    if "sonnet" in low:
        return "Claude Sonnet"
    if "opus" in low:
        return "Claude Opus"
    return m_str


def format_agy_quota(quota_obj, model_str, updated_at):
    if not quota_obj or not isinstance(quota_obj, dict):
        return None, [], None
    now = time.time()
    elapsed = max(0, now - (updated_at or now))

    def bucket_info(key, label):
        b = quota_obj.get(key)
        if not isinstance(b, dict):
            return None
        frac = b.get("remaining_fraction")
        if frac is None:
            return None
        pct = max(0.0, min(100.0, float(frac) * 100.0))
        rem_sec = b.get("reset_in_seconds")
        if rem_sec is not None:
            rem_sec = int(rem_sec) - int(elapsed)
        elif b.get("reset_time"):
            try:
                dt = datetime.fromisoformat(b["reset_time"].replace("Z", "+00:00"))
                rem_sec = int(dt.timestamp() - now)
            except Exception:
                rem_sec = None
        if rem_sec is not None and rem_sec <= 0:
            pct = 100.0
            rem_sec = None
        pct_str = f"{pct:.1f}%".replace(".0%", "%") if pct < 10 else f"{int(round(pct))}%"
        if pct >= 99.95 and (not rem_sec or rem_sec > 86000):
            return {"text": f"{label} 100% left", "pct": pct}
        dur = fmt_duration(rem_sec)
        txt = f"{label} {pct_str} left ({dur})" if dur else f"{label} {pct_str} left"
        return {"text": txt, "pct": pct}

    low_m = (model_str or "").lower()
    items = []
    if "claude" in low_m or "gpt" in low_m or "opus" in low_m or "sonnet" in low_m:
        for k, lbl in [("3p-5h", "5h"), ("3p-weekly", "7d")]:
            bi = bucket_info(k, lbl)
            if bi:
                items.append(bi)
    else:
        if "argon" in low_m and "gemini-argon-wtu-weekly" in quota_obj:
            bi = bucket_info("gemini-argon-wtu-weekly", "Argon 7d")
            if bi:
                items.append(bi)
        for k, lbl in [("gemini-5h", "5h"), ("gemini-weekly", "7d")]:
            bi = bucket_info(k, lbl)
            if bi:
                items.append(bi)
        if "argon" not in low_m and "gemini-argon-wtu-weekly" in quota_obj:
            bi = bucket_info("gemini-argon-wtu-weekly", "Argon 7d")
            if bi:
                items.append(bi)

    if not items:
        for k in quota_obj:
            bi = bucket_info(k, k)
            if bi:
                items.append(bi)

    if not items:
        return None, [], None
    min_pct = min(i["pct"] for i in items)
    return " · ".join(i["text"] for i in items), items, min_pct


def query_agy(term_id, cwd, pid=None):
    proc_start = get_proc_start_time(pid)
    hook_data = None
    if term_id:
        candidate = read_json(os.path.join(USAGE_DIR, f"agy-term-{term_id}.json"))
        if candidate:
            if not proc_start or float(candidate.get("_updated_at") or 0) >= proc_start - 5:
                hook_data = candidate

    latest_hook = read_json(os.path.join(USAGE_DIR, "agy-latest.json"))
    settings = read_json(os.path.join(AGY_DIR, "settings.json")) or {}

    used_tokens = 0
    window_size = 1048576
    used_pct = 0.0
    model_name = ""
    effort = None
    conv_id = None

    if hook_data is not None:
        # Authoritative live hook from this exact terminal process
        conv_id = hook_data.get("conversation_id") or hook_data.get("session_id") or ""
        m_obj = hook_data.get("model") or {}
        if m_obj.get("display_name") or m_obj.get("id"):
            model_name = m_obj.get("display_name") or m_obj.get("id")
        effort = norm_effort(m_obj.get("effort"))
        cw = hook_data.get("context_window") or {}
        if cw.get("context_window_size"):
            window_size = int(cw["context_window_size"])
        cu = cw.get("current_usage")
        if isinstance(cu, dict):
            used_tokens = (
                int(cu.get("input_tokens") or 0)
                + int(cu.get("cache_read_input_tokens") or 0)
                + int(cu.get("cache_creation_input_tokens") or 0)
                + int(cu.get("output_tokens") or 0)
            )
            used_pct = float(cw.get("used_percentage") or (used_tokens * 100.0 / max(1, window_size)))
        if conv_id:
            tx_usage = get_agy_transcript_usage(conv_id)
            if tx_usage and tx_usage["used_tokens"] > used_tokens:
                used_tokens = tx_usage["used_tokens"]
                window_size = tx_usage.get("window_size") or window_size
                used_pct = used_tokens * 100.0 / max(1, window_size)
                if not model_name and tx_usage.get("model"):
                    model_name = tx_usage["model"]
    else:
        # Fallback for sessions started before the statusLine hook was added:
        # Only use the workspace's conversation if its presence lock file is actively locked by a running agy process!
        candidate_conv = resolve_agy_conv_id(cwd)
        if candidate_conv:
            lock_path = os.path.join(AGY_DIR, "presence", f"{candidate_conv}.lock")
            tx_usage = get_agy_transcript_usage(candidate_conv)
            is_active_conv = is_file_locked(lock_path) or (
                proc_start and tx_usage and tx_usage.get("mtime", 0) >= proc_start - 5
            )
            if is_active_conv and tx_usage:
                used_tokens = tx_usage["used_tokens"]
                window_size = tx_usage.get("window_size") or window_size
                used_pct = used_tokens * 100.0 / max(1, window_size)
                if tx_usage.get("model"):
                    model_name = tx_usage["model"]

    if not model_name:
        model_name = settings.get("model") or "Gemini"
    effort = effort or effort_in_name(model_name) or effort_in_name(settings.get("model"))

    quota_source = hook_data if (hook_data and hook_data.get("quota")) else latest_hook
    quota_obj = (quota_source or {}).get("quota")
    updated_at = (quota_source or {}).get("_updated_at")
    plan_tier = (quota_source or {}).get("plan_tier") or ""

    limit_text, limit_items, min_limit_pct = format_agy_quota(quota_obj, model_name, updated_at)
    if not limit_text:
        limit_text = f"{plan_tier} · run a turn to refresh quota" if plan_tier else "Quota pending next turn"
        limit_items = [{"text": limit_text, "pct": None}]

    pct_str = f"{used_pct:.1f}%".replace(".0%", "%") if 0 < used_pct < 10 else f"{int(round(used_pct))}%"
    ctx_val = f"{pct_str} ({fmt_tokens(used_tokens)} / {fmt_tokens(window_size)})"

    title = clean_line((hook_data or {}).get("conversation_title") or (hook_data or {}).get("_resolved_title") or "")
    if not title and conv_id:
        title = extract_agy_first_prompt(conv_id)
    if not title and cwd:
        title = os.path.basename(str(cwd).rstrip("\\/"))

    return {
        "agent": "Antigravity",
        "agent_key": "antigravity",
        "title": title,
        "model": format_agy_model(model_name),
        "effort": effort,
        "context_value": ctx_val,
        "context_text": f"Context: {ctx_val}",
        "context_pct": round(used_pct, 1),
        "limit_text": f"Limit: {limit_text}",
        "limit_items": limit_items,
        "limit_min_pct": min_limit_pct,
        "plan": plan_tier,
    }


def read_codex_config(key):
    cfg_path = os.path.join(CODEX_DIR, "config.toml")
    try:
        if os.path.exists(cfg_path):
            with open(cfg_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.lstrip().startswith("["):
                        break  # top-level keys only, not a profile's
                    m = re.match(r'^\s*' + re.escape(key) + r'\s*=\s*"([^"]+)"', line)
                    if m:
                        return m.group(1)
    except Exception:
        pass
    return None


def read_codex_config_model():
    cfg_path = os.path.join(CODEX_DIR, "config.toml")
    try:
        if os.path.exists(cfg_path):
            with open(cfg_path, "r", encoding="utf-8") as f:
                for line in f:
                    m = re.match(r'^\s*model\s*=\s*"([^"]+)"', line)
                    if m:
                        return m.group(1)
    except Exception:
        pass
    return "codex"


def query_codex(cwd, pid=None, argv=None):
    nc = norm_path(cwd)
    proc_start = get_proc_start_time(pid)
    argv_str = " ".join(argv or []).lower()
    is_resumed = "resume" in argv_str or "fork" in argv_str

    session_rollout = None
    rate_limit_rollout = None
    model_name = ""
    db_path = os.path.join(CODEX_DIR, "state_5.sqlite")

    if os.path.exists(db_path):
        try:
            con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=1.0)
            cur = con.cursor()
            rows = cur.execute(
                "SELECT cwd, rollout_path, model, created_at, updated_at FROM threads WHERE rollout_path IS NOT NULL ORDER BY updated_at DESC LIMIT 40"
            ).fetchall()
            con.close()
            for r_cwd, r_path, r_model, r_created, r_updated in rows:
                p = r_path[4:] if str(r_path).startswith("\\\\?\\") else str(r_path)
                if not os.path.exists(p):
                    continue
                if not rate_limit_rollout:
                    rate_limit_rollout = p
                if nc and norm_path(r_cwd) == nc and not session_rollout:
                    # Only match this thread to the current running process if it was updated/created after the process started, or if codex was launched with resume/fork
                    file_mtime = os.path.getmtime(p)
                    if not proc_start or is_resumed or float(r_updated or 0) >= proc_start - 5 or file_mtime >= proc_start - 5:
                        session_rollout = p
                        model_name = r_model or ""
        except Exception:
            pass

    if not rate_limit_rollout:
        files = sorted(
            glob.glob(os.path.join(CODEX_DIR, "sessions", "*", "*", "*", "rollout-*.jsonl")),
            key=os.path.getmtime,
            reverse=True,
        )
        if files:
            rate_limit_rollout = files[0]

    used_tokens = 0
    window_size = 475000
    rate_limits = None

    # 1. Read context usage ONLY from the current process's matched session_rollout
    effort = None
    if session_rollout and os.path.exists(session_rollout):
        got_tokens = False
        got_turn = False
        for line in reversed(read_tail_lines(session_rollout, 98304)):
            try:
                d = json.loads(line)
                payload = d.get("payload") or {}
                if not got_tokens and payload.get("type") == "token_count":
                    info = payload.get("info") or {}
                    last_u = info.get("last_token_usage") or {}
                    used_tokens = int(last_u.get("total_tokens") or 0)
                    if info.get("model_context_window"):
                        window_size = int(info["model_context_window"])
                    rate_limits = payload.get("rate_limits")
                    got_tokens = True
                elif not got_turn and d.get("type") == "turn_context":
                    effort = norm_effort(payload.get("effort") or payload.get("reasoning_effort"))
                    model_name = payload.get("model") or model_name
                    got_turn = True
                if got_tokens and got_turn:
                    break
            except Exception:
                pass

    # 2. Read account-wide rate limits (and default context window size) from latest rollout if not in session_rollout
    if rate_limits is None and rate_limit_rollout and os.path.exists(rate_limit_rollout):
        for line in reversed(read_tail_lines(rate_limit_rollout, 98304)):
            try:
                d = json.loads(line)
                payload = d.get("payload") or {}
                if payload.get("type") == "token_count":
                    info = payload.get("info") or {}
                    if info.get("model_context_window"):
                        window_size = int(info["model_context_window"])
                    rate_limits = payload.get("rate_limits")
                    break
            except Exception:
                pass

    if not model_name:
        model_name = read_codex_config_model()
    effort = effort or norm_effort(read_codex_config("model_reasoning_effort"))

    used_pct = (used_tokens * 100.0 / max(1, window_size)) if window_size else 0.0
    pct_str = f"{used_pct:.1f}%".replace(".0%", "%") if 0 < used_pct < 10 else f"{int(round(used_pct))}%"
    ctx_val = f"{pct_str} ({fmt_tokens(used_tokens)} / {fmt_tokens(window_size)})"

    limit_items = []
    min_limit_pct = None
    now = time.time()
    if isinstance(rate_limits, dict):
        for key, default_lbl in [("primary", "5h"), ("secondary", "7d")]:
            w = rate_limits.get(key)
            if not isinstance(w, dict) or w.get("used_percent") is None:
                continue
            mins = w.get("window_minutes")
            lbl = "5h" if mins == 300 else ("7d" if mins == 10080 else default_lbl)
            resets_at = w.get("resets_at")
            if resets_at and resets_at <= now:
                left_pct = 100.0
                rem_sec = None
            else:
                left_pct = max(0.0, min(100.0, 100.0 - float(w["used_percent"])))
                rem_sec = int(resets_at - now) if resets_at else None
            min_limit_pct = left_pct if min_limit_pct is None else min(min_limit_pct, left_pct)
            dur = fmt_duration(rem_sec)
            l_str = f"{left_pct:.1f}%".replace(".0%", "%") if left_pct < 10 else f"{int(round(left_pct))}%"
            txt = f"{lbl} {l_str} left ({dur})" if dur else f"{lbl} {l_str} left"
            limit_items.append({"text": txt, "pct": left_pct})

    if not limit_items:
        limit_items = [{"text": "No rate limit data yet", "pct": None}]
    limit_text = " · ".join(i["text"] for i in limit_items)
    return {
        "agent": "Codex",
        "agent_key": "codex",
        "model": model_name,
        "effort": effort,
        "context_value": ctx_val,
        "context_text": f"Context: {ctx_val}",
        "context_pct": round(used_pct, 1),
        "limit_text": f"Limit: {limit_text}",
        "limit_items": limit_items,
        "limit_min_pct": min_limit_pct,
    }


def claude_project_slug(cwd):
    # Claude Code names a project's folder after its path, every non-alphanumeric as "-":
    # C:\\Users\\me\\.claude -> C--Users-me--claude, /home/me/x_y -> -home-me-x-y
    if not cwd:
        return ""
    p = str(cwd).strip().rstrip("\\/")
    return re.sub(r"[^A-Za-z0-9]", "-", p)


# API context windows (platform.claude.com/docs/en/models/overview): 200K for these
# older models, 1M for Opus 4.6+, Sonnet 4.6+, Haiku 5.5 and every Fable/Mythos model.
# Claude Code may use less; its statusLine (hook.py) reports the real window.
CLAUDE_200K = ("claude-3", "opus-4-5", "opus-4-1", "opus-4-0", "opus-4-2025", "sonnet-4-5", "sonnet-4-0", "sonnet-4-2025", "haiku-4-5")


def claude_window(model):
    low = (model or "").lower()
    if "[1m]" in low:
        return 1000000
    if any(k in low for k in CLAUDE_200K):
        return 200000
    return 1000000


def read_claude_credentials():
    creds = read_json(os.path.join(CLAUDE_DIR, ".credentials.json"))
    if not creds and sys.platform == "darwin":
        # macOS keeps Claude Code's login in the Keychain, not in a file.
        try:
            r = subprocess.run(
                ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                capture_output=True, text=True, timeout=3,
            )
            if r.returncode == 0 and r.stdout.strip():
                creds = json.loads(r.stdout)
        except Exception:
            creds = None
    return creds if isinstance(creds, dict) else {}


def fetch_claude_oauth_usage(network=True):
    cache_path = os.path.join(USAGE_DIR, "claude-oauth-usage.json")
    now = time.time()
    cached = read_json(cache_path)
    if not isinstance(cached, dict):
        cached = {}
    if now - float(cached.get("_fetched_at") or 0) < 60:
        return cached.get("data")
    # After a failure, wait before asking again (longer when told to slow down): the bar
    # refreshes every few seconds, and offline each try would wait out the timeout.
    if now < float(cached.get("_retry_at") or 0):
        return cached.get("data")

    if not network:
        return None
    creds = read_claude_credentials()
    token = (creds.get("claudeAiOauth") or {}).get("accessToken")
    if not token:
        return cached.get("data")

    try:
        req = urllib.request.Request(
            "https://api.anthropic.com/api/oauth/usage",
            headers={
                "Authorization": f"Bearer {token}",
                "anthropic-beta": "oauth-2025-04-20",
                "Accept": "application/json",
                "User-Agent": "herdr-agent-usage",
            },
        )
        with urllib.request.urlopen(req, timeout=3.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        os.makedirs(USAGE_DIR, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({"_fetched_at": now, "data": data}, f)
        return data
    except Exception as e:
        wait = 60
        if getattr(e, "code", None) == 429:
            try:
                wait = max(300, int(e.headers.get("Retry-After") or 0))
            except Exception:
                wait = 300
        try:
            os.makedirs(USAGE_DIR, exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump({**cached, "_retry_at": now + wait}, f)
        except Exception:
            pass
        return cached.get("data")


def format_claude_model(m_str):
    if not m_str:
        return "Sonnet"
    low = m_str.lower()
    if "sonnet-5-5" in low or low == "sonnet":
        return "Sonnet 5.5"
    if "opus-5-5" in low or low == "opus":
        return "Opus 5.5"
    if "haiku-5-5" in low or low == "haiku":
        return "Haiku 5.5"
    if "fable-5-2" in low or low == "fable":
        return "Fable 5.2"
    return m_str


def query_claude(term_id, cwd, pid=None, network=True):
    proc_start = get_proc_start_time(pid)
    # Claude Code's statusLine (hook.py), when wired: its own context window and session.
    hook = read_json(os.path.join(USAGE_DIR, f"claude-term-{term_id}.json")) if term_id else None
    if not isinstance(hook, dict) or (proc_start and float(hook.get("_updated_at") or 0) < proc_start - 5):
        hook = None

    # 1. Exact PID -> sessionId lookup from ~/.claude/sessions/<pid>.json
    session_file = None
    session_meta = read_json(os.path.join(CLAUDE_DIR, "sessions", f"{pid}.json")) if pid else None
    if isinstance(session_meta, dict) and session_meta.get("sessionId"):
        sid = session_meta["sessionId"]
        s_cwd = session_meta.get("cwd") or cwd
        slug = claude_project_slug(s_cwd)
        candidate = os.path.join(CLAUDE_DIR, "projects", slug, f"{sid}.jsonl")
        if os.path.exists(candidate):
            session_file = candidate
    elif hook and hook.get("transcript_path") and os.path.exists(hook["transcript_path"]):
        session_file = hook["transcript_path"]
    else:
        # Fallback: look only inside the current cwd's project folder and only for files modified after proc_start
        slug = claude_project_slug(cwd)
        proj_dir = os.path.join(CLAUDE_DIR, "projects", slug) if slug else ""
        if proj_dir and os.path.isdir(proj_dir):
            files = sorted(glob.glob(os.path.join(proj_dir, "*.jsonl")), key=os.path.getmtime, reverse=True)
            if files:
                if not proc_start or os.path.getmtime(files[0]) >= proc_start - 5:
                    session_file = files[0]

    used_tokens = 0
    model_name = ""
    effort = None
    cost_usd = None
    custom_title = ""
    ai_title = ""
    summary_title = ""
    last_prompt = ""
    last_user_msg = ""

    if session_file and os.path.exists(session_file):
        lines = read_tail_lines(session_file, 98304)
        for line in reversed(lines):
            try:
                d = json.loads(line)
                t = d.get("type")
                # Stop scanning backwards if we hit a /clear command
                if t == "system" and d.get("subtype") == "local_command":
                    cmd_run = d.get("commandRun") or {}
                    if cmd_run.get("command") == "clear":
                        break
                if not custom_title and t == "custom-title":
                    custom_title = clean_line(d.get("customTitle"))
                elif not ai_title and t == "ai-title":
                    ai_title = clean_line(d.get("aiTitle"))
                elif not summary_title and t == "summary":
                    summary_title = clean_line(d.get("summary"))
                elif not last_prompt and t == "last-prompt":
                    lp = (d.get("lastPrompt") or "").strip()
                    if lp and not lp.startswith("/"):
                        last_prompt = clean_line(lp.splitlines()[0])
                elif not last_user_msg and t == "user" and not d.get("isMeta"):
                    msg = d.get("message") or {}
                    content = msg.get("content")
                    if isinstance(content, str):
                        txt = content.strip()
                        if txt and not txt.startswith("<") and not txt.startswith("/"):
                            last_user_msg = clean_line(txt.splitlines()[0])
                if not effort and t == "assistant" and d.get("effort"):
                    effort = norm_effort(d.get("effort"))
                if cost_usd is None and t == "cost-state":
                    cost_usd = d.get("totalCostUSD")
                if used_tokens == 0 and t == "assistant":
                    msg = d.get("message") or {}
                    u = msg.get("usage")
                    if isinstance(u, dict):
                        model_name = msg.get("model") or model_name
                        used_tokens = (
                            int(u.get("input_tokens") or 0)
                            + int(u.get("cache_creation_input_tokens") or 0)
                            + int(u.get("cache_read_input_tokens") or 0)
                            + int(u.get("output_tokens") or 0)
                        )
            except Exception:
                pass

    title = ""
    for cand in (custom_title, ai_title, summary_title, last_user_msg, last_prompt):
        if cand:
            title = cand
            break
    if not title and cwd:
        title = os.path.basename(str(cwd).rstrip("\\/"))

    if not model_name:
        model_name = ((hook or {}).get("model") or {}).get("id") or ""
    if not model_name:
        cl_settings = read_json(os.path.join(CLAUDE_DIR, "settings.json")) or {}
        model_name = cl_settings.get("model") or "sonnet"

    effort = effort or norm_effort(((hook or {}).get("model") or {}).get("effort"))
    cw = (hook or {}).get("context_window") or {}
    window_size = int(cw.get("context_window_size") or 0) or claude_window(model_name)
    cu = cw.get("current_usage")
    if not used_tokens and isinstance(cu, dict):
        used_tokens = sum(int(cu.get(k) or 0) for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"))

    used_pct = (used_tokens * 100.0 / max(1, window_size)) if window_size else 0.0
    pct_str = f"{used_pct:.1f}%".replace(".0%", "%") if 0 < used_pct < 10 else f"{int(round(used_pct))}%"
    ctx_val = f"{pct_str} ({fmt_tokens(used_tokens)} / {fmt_tokens(window_size)})"

    oauth_usage = fetch_claude_oauth_usage(network)
    limit_items = []
    min_limit_pct = None
    now = time.time()

    if isinstance(oauth_usage, dict):
        for key, lbl in [
            ("five_hour", "5h"),
            ("seven_day", "7d"),
            ("seven_day_opus", "Opus 7d"),
            ("seven_day_sonnet", "Sonnet 7d"),
        ]:
            w = oauth_usage.get(key)
            if not isinstance(w, dict) or w.get("utilization") is None:
                continue
            util = float(w["utilization"])
            resets_at_str = w.get("resets_at")
            rem_sec = None
            if resets_at_str:
                try:
                    dt = datetime.fromisoformat(str(resets_at_str).replace("Z", "+00:00"))
                    rem_sec = int(dt.timestamp() - now)
                except Exception:
                    rem_sec = None
            if rem_sec is not None and rem_sec <= 0:
                left_pct = 100.0
                rem_sec = None
            else:
                left_pct = max(0.0, min(100.0, 100.0 - util))
            min_limit_pct = left_pct if min_limit_pct is None else min(min_limit_pct, left_pct)
            l_str = f"{left_pct:.1f}%".replace(".0%", "%") if left_pct < 10 else f"{int(round(left_pct))}%"
            dur = fmt_duration(rem_sec)
            txt = f"{lbl} {l_str} left ({dur})" if dur else f"{lbl} {l_str} left"
            limit_items.append({"text": txt, "pct": left_pct})

    if not limit_items:
        creds = read_claude_credentials()
        oauth = creds.get("claudeAiOauth") or {}
        sub = oauth.get("subscriptionType") or ""
        if sub:
            limit_items.append({"text": f"Plan {sub.capitalize()}", "pct": None})
        if cost_usd is not None:
            limit_items.append({"text": f"Session ${float(cost_usd):.2f}", "pct": None})
        if not limit_items:
            limit_items = [{"text": "Active", "pct": None}]

    limit_text = " · ".join(i["text"] for i in limit_items)
    return {
        "agent": "Claude Code",
        "agent_key": "claude",
        "title": title,
        "model": format_claude_model(model_name),
        "effort": effort,
        "context_value": ctx_val,
        "context_text": f"Context: {ctx_val}",
        "context_pct": round(used_pct, 1),
        "limit_text": f"Limit: {limit_text}",
        "limit_items": limit_items,
        "limit_min_pct": min_limit_pct,
    }


def query_one(req):
    agent_type = (req.get("agent") or "antigravity").lower()
    term_id = req.get("terminal") or ""
    cwd = req.get("cwd") or ""
    pid = req.get("pid")
    argv = req.get("argv")
    network = req.get("network") is not False

    if "codex" in agent_type:
        res = query_codex(cwd, pid=pid, argv=argv)
    elif "claude" in agent_type:
        res = query_claude(term_id, cwd, pid=pid, network=network)
    else:
        res = query_agy(term_id, cwd, pid=pid)

    res["terminal"] = term_id
    res["cwd"] = cwd
    return res


def main():
    try:
        arg = sys.argv[1] if len(sys.argv) > 1 else "{}"
        payload = json.loads(arg)
    except Exception:
        payload = {}

    if isinstance(payload, list):
        out = {}
        for item in payload:
            if isinstance(item, dict):
                tid = item.get("terminal") or item.get("key") or "default"
                out[tid] = query_one(item)
        print(json.dumps(out))
    else:
        print(json.dumps(query_one(payload)))


if __name__ == "__main__":
    main()
