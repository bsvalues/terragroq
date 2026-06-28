"""WilliamOS Control Center — Launcher and process management.

One command to start the cockpit. One process. Browser opens.
Backend serves the built frontend statically on port 8420.
"""

import json
import os
import signal
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_APP = PROJECT_ROOT / "control-center" / "backend" / "app.py"
FRONTEND_DIR = PROJECT_ROOT / "control-center" / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
RUNTIME_DIR = PROJECT_ROOT / "WilliamOS" / "110_ControlCenter" / "generated" / "runtime"
RUNTIME_STATE = RUNTIME_DIR / "control-center.json"

BACKEND_PORT = 8420
BACKEND_URL = f"http://localhost:{BACKEND_PORT}"
OLLAMA_URL = os.environ.get("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")
DEFAULT_MODEL = os.environ.get("WILLIAMOS_LLM_MODEL", "qwen2.5:14b-instruct-q4_K_M")
DEFAULT_RUNTIME = os.environ.get("WILLIAMOS_LLM_RUNTIME", "ollama").strip().lower() or "ollama"


def _port_in_use(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    try:
        sock.connect(("localhost", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def _port_owner_pid(port: int) -> int | None:
    if sys.platform != "win32":
        return None
    try:
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                (
                    f"Get-NetTCPConnection -LocalPort {port} -State Listen "
                    "-ErrorAction SilentlyContinue | "
                    "Select-Object -First 1 -ExpandProperty OwningProcess"
                ),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        value = result.stdout.strip()
        return int(value) if value else None
    except Exception:
        return None


def _pid_command_line(pid: int | None) -> str:
    if not pid:
        return ""
    if sys.platform == "win32":
        try:
            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    (
                        f"Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\" | "
                        "Select-Object -ExpandProperty CommandLine"
                    ),
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.stdout.strip()
        except Exception:
            return ""
    return ""


def _wait_for_port(port: int, timeout: int = 15) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _port_in_use(port):
            return True
        time.sleep(0.5)
    return False


def _health_check() -> dict:
    import urllib.request
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        resp = urllib.request.urlopen(  # noqa: S310 — hardcoded localhost, not user input
            f"{BACKEND_URL}/api/status", timeout=5
        )
        data = json.loads(resp.read().decode())
        return {"ok": True, "data": data}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _copilot_health_check() -> dict:
    import urllib.request
    try:
        resp = urllib.request.urlopen(  # noqa: S310
            f"{BACKEND_URL}/api/copilot/health", timeout=10
        )
        data = json.loads(resp.read().decode())
        return {"ok": bool(data.get("ok")), "data": data}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _ollama_tags() -> dict:
    import urllib.request
    try:
        base = OLLAMA_URL.rstrip("/")
        host = urlparse(base).hostname or ""
        if host not in {"127.0.0.1", "localhost"}:
            return {"ok": False, "error": "refusing non-local Ollama host"}
        resp = urllib.request.urlopen(f"{base}/api/tags", timeout=10)  # noqa: S310
        data = json.loads(resp.read().decode())
        models = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
        return {"ok": True, "models": models}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _ollama_executable() -> str | None:
    exe = shutil.which("ollama")
    if exe:
        return exe
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"
    return str(local) if local.exists() else None


def _model_runtime_status() -> dict:
    backend_dir = PROJECT_ROOT / "control-center" / "backend"
    inserted = False
    try:
        if str(backend_dir) not in sys.path:
            sys.path.insert(0, str(backend_dir))
            inserted = True
        from copilot import llm  # noqa: PLC0415
        return llm.runtime_status()
    except Exception as e:
        return {
            "selected": DEFAULT_RUNTIME,
            "active": {
                "ok": False,
                "runtime": DEFAULT_RUNTIME,
                "runtime_label": DEFAULT_RUNTIME,
                "model": DEFAULT_MODEL,
                "detail": str(e),
            },
            "registry": [],
            "fallback": False,
            "policy": "explicit-runtime-only",
        }
    finally:
        if inserted and str(backend_dir) in sys.path:
            sys.path.remove(str(backend_dir))


def _ensure_ollama_running() -> dict:
    tags = _ollama_tags()
    if tags["ok"]:
        return {"ok": True, "started": False, "models": tags.get("models", [])}

    parsed = urlparse(OLLAMA_URL.rstrip("/"))
    if parsed.hostname not in {"127.0.0.1", "localhost"}:
        return {"ok": False, "started": False, "error": "refusing non-local Ollama host"}

    exe = _ollama_executable()
    if not exe:
        return {"ok": False, "started": False, "error": "Ollama executable not found"}

    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    subprocess.Popen(
        [exe, "serve"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )

    deadline = time.time() + 30
    while time.time() < deadline:
        tags = _ollama_tags()
        if tags["ok"]:
            return {"ok": True, "started": True, "models": tags.get("models", [])}
        time.sleep(1)

    return {"ok": False, "started": True, "error": "Ollama did not become ready within 30 seconds"}


def _ensure_selected_runtime_ready() -> dict:
    status = _model_runtime_status()
    selected = status.get("selected", DEFAULT_RUNTIME)
    active = status.get("active", {})
    if selected != "ollama":
        return {
            "ok": bool(active.get("ok")),
            "started": False,
            "runtime": active.get("runtime_label", selected),
            "model": active.get("model", DEFAULT_MODEL),
            "detail": active.get("detail", "runtime not reachable"),
            "managed": False,
        }

    ollama = _ensure_ollama_running()
    ollama["runtime"] = "Ollama"
    ollama["model"] = DEFAULT_MODEL
    ollama["managed"] = True
    return ollama


def _smoke_check() -> dict:
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        resp = urllib.request.urlopen(  # noqa: S310
            f"{BACKEND_URL}/api/smoke", timeout=30
        )
        return json.loads(resp.read().decode())
    except Exception as e:
        return {"status": "FAIL", "error": str(e)}


def _get_next_action() -> str:
    import urllib.request
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/agent/next",
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        resp = urllib.request.urlopen(req, timeout=10)  # noqa: S310
        data = json.loads(resp.read().decode())
        rec = data.get("recommended", {})
        return rec.get("action", "No recommendation available")
    except Exception:
        return "Could not fetch recommendation"


def _post_json(path: str, payload: dict, timeout: int = 10) -> dict:
    req = urllib.request.Request(
        f"{BACKEND_URL}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=timeout)  # noqa: S310
    return json.loads(resp.read().decode())


def _get_json(path: str, timeout: int = 10) -> dict:
    resp = urllib.request.urlopen(f"{BACKEND_URL}{path}", timeout=timeout)  # noqa: S310
    return json.loads(resp.read().decode())


def _devops_smoke_checks() -> dict:
    checks = {}

    try:
        data = _get_json("/api/devops/playbook", timeout=10)
        ok = (
            data.get("ok") is True
            and data.get("mode") == "devops-playbook-operational"
            and len(data.get("first_slices", [])) >= 5
            and len(data.get("mistake_patterns", [])) >= 10
            and data.get("handoff_banner", {}).get("MUTATION_AUTHORITY", "").startswith("NO")
        )
        checks["devops_playbook"] = "PASS" if ok else f"FAIL: {data}"
    except Exception as e:
        checks["devops_playbook"] = f"FAIL: {e}"

    try:
        data = _get_json("/api/devops/current-truth", timeout=10)
        truth = data.get("current_truth", {})
        ok = (
            data.get("ok") is True
            and truth.get("phase_6_status") == "blocked"
            and "Phase 6 proactive behavior" in truth.get("blocked", [])
        )
        checks["devops_current_truth"] = "PASS" if ok else f"FAIL: {data}"
    except Exception as e:
        checks["devops_current_truth"] = f"FAIL: {e}"

    try:
        data = _post_json(
            "/api/devops/goal",
            {
                "goal": "automatically run AI improvements across TerraFusion Phase 6",
                "authority": "A2_LOCAL_MUTATION",
            },
            timeout=10,
        )
        ok = (
            data.get("ok") is True
            and data.get("MODE") == "EXECUTE"
            and data.get("AUTHORITY_REQUESTED") == "A2_LOCAL_MUTATION"
            and data.get("AUTHORITY_GRANTED") == "A0_READ_ONLY"
            and data.get("work_order_draft", {}).get("STATUS") == "draft"
            and data.get("handoff_banner", {}).get("MUTATION_AUTHORITY", "").startswith("NO")
            and any(m.get("pattern_id") == "MP-009" for m in data.get("MISTAKE_PATTERN_MATCHES", []))
        )
        checks["devops_goal_classifier"] = "PASS" if ok else f"FAIL: {data}"
    except Exception as e:
        checks["devops_goal_classifier"] = f"FAIL: {e}"

    try:
        data = _post_json(
            "/api/devops/loop",
            {
                "target": "WO-WILLIAMOS-PHASE5I-WORK-ORDER-ENGINE-001",
                "loop_type": "verify",
                "authority": "A0_READ_ONLY",
                "max_iterations": 1,
            },
            timeout=10,
        )
        ok = (
            data.get("ok") is True
            and data.get("LOOP_TYPE") == "VERIFY"
            and data.get("AUTHORITY") == "A0_READ_ONLY"
            and str(data.get("STOP_REASON", "")).startswith("STOP:")
        )
        checks["devops_loop_planner"] = "PASS" if ok else f"FAIL: {data}"
    except Exception as e:
        checks["devops_loop_planner"] = f"FAIL: {e}"

    return checks


def _save_runtime_state(pid: int, mode: str) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    state = {
        "backend_pid": pid,
        "backend_url": BACKEND_URL,
        "started_at": datetime.now().isoformat(),
        "mode": mode,
    }
    RUNTIME_STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _load_runtime_state() -> dict | None:
    if RUNTIME_STATE.exists():
        try:
            return json.loads(RUNTIME_STATE.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _clear_runtime_state() -> None:
    if RUNTIME_STATE.exists():
        RUNTIME_STATE.unlink()


def _pid_alive(pid: int) -> bool:
    if pid is None:
        return False
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _is_control_center_pid(pid: int | None) -> bool:
    cmd = _pid_command_line(pid)
    return str(BACKEND_APP) in cmd or "control-center\\backend\\app.py" in cmd or "control-center/backend/app.py" in cmd


def _stop_pid(pid: int, timeout: int = 10) -> bool:
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["taskkill", "/F", "/PID", str(pid)],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return result.returncode == 0
        os.kill(pid, signal.SIGTERM)
        return True
    except Exception:
        return False


def build_frontend() -> bool:
    if not FRONTEND_DIR.exists():
        print("ERROR: control-center/frontend/ not found.")
        return False

    pkg_json = FRONTEND_DIR / "package.json"
    node_modules = FRONTEND_DIR / "node_modules"
    if not node_modules.exists() and pkg_json.exists():
        print("Installing frontend dependencies...")
        r = subprocess.run(
            ["npm", "install"],
            cwd=str(FRONTEND_DIR),
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"npm install failed:\n{r.stderr}")
            return False

    print("Building frontend...")
    r = subprocess.run(
        ["npm", "run", "build"],
        cwd=str(FRONTEND_DIR),
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"Build failed:\n{r.stderr}")
        return False

    if not FRONTEND_DIST.exists():
        print("ERROR: dist/ not created after build.")
        return False

    index = FRONTEND_DIST / "index.html"
    assets = FRONTEND_DIST / "assets"
    if not index.exists() or not assets.exists():
        print("ERROR: Build output incomplete.")
        return False

    print(f"Build complete: {FRONTEND_DIST}")
    return True


def start(open_browser: bool = True) -> int:
    if not BACKEND_APP.exists():
        print("ERROR: control-center/backend/app.py not found.")
        return 1

    if _port_in_use(BACKEND_PORT):
        health = _health_check()
        if health["ok"]:
            owner = _port_owner_pid(BACKEND_PORT)
            if owner:
                _save_runtime_state(owner, "adopted-existing")
            print(f"Control Center already running on {BACKEND_URL}")
            if owner:
                print(f"  PID: {owner}")
            if open_browser:
                webbrowser.open(BACKEND_URL)
            return 0
        else:
            owner = _port_owner_pid(BACKEND_PORT)
            print(f"Port {BACKEND_PORT} is in use but the Control Center health check failed.")
            if owner:
                print(f"  Owning PID: {owner}")
                cmd = _pid_command_line(owner)
                if cmd:
                    print(f"  Command: {cmd}")
            print("Stop or move the conflicting process before launching.")
            return 1

    if not FRONTEND_DIST.exists():
        print("No frontend build found. Building now...")
        if not build_frontend():
            print("Frontend build failed. Starting backend only (no UI).")

    runtime = _ensure_selected_runtime_ready()
    if runtime["ok"]:
        state = "started" if runtime.get("started") else "already running"
        if runtime.get("managed"):
            print(f"{runtime.get('runtime', 'Model runtime')} {state}.")
        else:
            print(f"{runtime.get('runtime', 'Model runtime')} reachable (explicit runtime; no auto-start).")
    else:
        detail = runtime.get("error") or runtime.get("detail", "unavailable")
        print(f"{runtime.get('runtime', 'Model runtime')} offline: {detail}")
        print("  Control Center will still start; conversational routing needs the selected local runtime.")
        print("  No fallback runtime will be selected automatically.")

    mode = "built-static" if FRONTEND_DIST.exists() else "backend-only"

    print("Starting WilliamOS Control Center...")
    proc = subprocess.Popen(
        [sys.executable, str(BACKEND_APP)],
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )

    _save_runtime_state(proc.pid, mode)

    print(f"  Backend PID: {proc.pid}")
    print(f"  Waiting for health check...")

    if not _wait_for_port(BACKEND_PORT, timeout=15):
        print("ERROR: Backend did not start within 15 seconds.")
        proc.terminate()
        _clear_runtime_state()
        return 1

    health = _health_check()
    if not health["ok"]:
        print(f"ERROR: Health check failed: {health.get('error')}")
        proc.terminate()
        _clear_runtime_state()
        return 1

    engine = health["data"].get("engine", "WilliamOS")
    version = health["data"].get("version", "?")

    print()
    print(f"  {engine} Control Center v{version}")
    print(f"  {BACKEND_URL}")
    print(f"  Mode: {mode}")
    print()

    next_action = _get_next_action()
    print(f"  Next action: {next_action}")
    print()

    if open_browser:
        webbrowser.open(BACKEND_URL)
        print("  Browser opened.")

    print()
    print("  Press Ctrl+C to stop.")

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\nStopping Control Center...")
        if sys.platform == "win32":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.terminate()
        proc.wait(timeout=10)
        _clear_runtime_state()
        print("Stopped.")

    return 0


def stop() -> int:
    state = _load_runtime_state()
    if not state:
        if _port_in_use(BACKEND_PORT):
            owner = _port_owner_pid(BACKEND_PORT)
            health = _health_check()
            if health["ok"] and _is_control_center_pid(owner):
                print(f"Stopping adopted Control Center (PID {owner})...")
                if owner and _stop_pid(owner):
                    print("Stopped.")
                    _clear_runtime_state()
                    return 0
            print(f"Port {BACKEND_PORT} is in use, but no owned Control Center runtime state was found.")
            if owner:
                print(f"  Owning PID: {owner}")
                cmd = _pid_command_line(owner)
                if cmd:
                    print(f"  Command: {cmd}")
            print("Refusing to stop an unknown process automatically.")
            return 1
        print("Control Center is not running.")
        return 0

    pid = state.get("backend_pid")
    if pid and _pid_alive(pid):
        if not _is_control_center_pid(pid):
            print(f"Runtime state PID {pid} is alive but is not the Control Center backend.")
            print("Refusing to stop an unrelated process.")
            return 1
        print(f"Stopping Control Center (PID {pid})...")
        if _stop_pid(pid):
            print("Stopped.")
        else:
            print(f"Could not stop PID {pid}.")
            return 1
    else:
        owner = _port_owner_pid(BACKEND_PORT)
        if _port_in_use(BACKEND_PORT) and _is_control_center_pid(owner):
            print(f"Runtime state was stale; stopping port owner PID {owner}...")
            if owner and _stop_pid(owner):
                print("Stopped.")
            else:
                print(f"Could not stop PID {owner}.")
                return 1
        else:
            print("Control Center process not found (may have already stopped).")

    _clear_runtime_state()
    return 0


def restart(open_browser: bool = True) -> int:
    stop_code = stop()
    if stop_code != 0:
        return stop_code
    time.sleep(1)
    return start(open_browser=open_browser)


def status() -> int:
    cc_dir = PROJECT_ROOT / "control-center"
    backend_exists = BACKEND_APP.exists()
    frontend_exists = FRONTEND_DIR.exists()
    dist_exists = FRONTEND_DIST.exists()

    print("=== WilliamOS Control Center ===")
    print()
    print(f"  Backend:    {'OK' if backend_exists else 'MISSING'}")
    print(f"  Frontend:   {'OK' if frontend_exists else 'MISSING'}")
    print(f"  Built:      {'YES' if dist_exists else 'NO — run: william control-center-build'}")

    state = _load_runtime_state()
    running = _port_in_use(BACKEND_PORT)
    owner = _port_owner_pid(BACKEND_PORT) if running else None

    if running:
        health = _health_check()
        if health["ok"]:
            engine = health["data"].get("engine", "?")
            version = health["data"].get("version", "?")
            print(f"  Server:     RUNNING — {engine} v{version}")
            print(f"  URL:        {BACKEND_URL}")
            print(f"  PID:        {owner or (state or {}).get('backend_pid', '?')}")
            print(f"  Owned:      {'YES' if state else 'ADOPTABLE'}")
            if state:
                print(f"  Mode:       {state.get('mode', '?')}")
                print(f"  Started:    {state.get('started_at', '?')}")
            copilot = _copilot_health_check()
            if copilot["ok"]:
                data = copilot["data"]
                runtime_label = data.get("runtime_label") or data.get("runtime", "Local runtime")
                print(f"  Runtime:    {runtime_label} — selected")
                print(f"  Model:      ONLINE — {data.get('model', DEFAULT_MODEL)}")
                print(f"  Detail:     {data.get('detail', 'model available')}")
            else:
                data = copilot.get("data", {})
                detail = copilot.get("error") or data.get("detail", "unavailable")
                runtime_label = data.get("runtime_label") or data.get("runtime", DEFAULT_RUNTIME)
                print(f"  Runtime:    {runtime_label} — selected")
                print(f"  Model:      OFFLINE — {data.get('model', DEFAULT_MODEL)}")
                print(f"  Detail:     {detail}")
            runtime_status = _model_runtime_status()
            for item in runtime_status.get("registry", []):
                health = item.get("health", {})
                label = item.get("label", item.get("id", "runtime"))
                marker = "selected" if item.get("selected") else "candidate"
                state = "OK" if health.get("ok") else "OFFLINE"
                print(f"  {label}: {state} — {marker}; no auto-switch")
        else:
            print(f"  Server:     PORT IN USE but not healthy")
            if owner:
                print(f"  PID:        {owner}")
                cmd = _pid_command_line(owner)
                if cmd:
                    print(f"  Command:    {cmd}")
    else:
        print(f"  Server:     NOT RUNNING")
        print(f"  Launch:     william control-center")

    print()
    return 0


def smoke() -> int:
    if not _port_in_use(BACKEND_PORT):
        print("Control Center is not running. Start it first:")
        print("  william control-center --no-open")
        print()
        print("Or run offline smoke:")
        result = subprocess.run(
            [sys.executable, str(BACKEND_APP), "--smoke"],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT),
        )
        print(result.stdout.strip())
        if result.stderr.strip():
            print(result.stderr.strip())
        return result.returncode

    print("=== Control Center Smoke Test ===")
    print()

    import urllib.request

    checks = {}

    # 1. Status endpoint
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(f"{BACKEND_URL}/api/status", timeout=5)  # noqa: S310
        checks["status"] = "PASS" if r.status == 200 else "FAIL"
    except Exception as e:
        checks["status"] = f"FAIL: {e}"

    # 2. Home endpoint
    try:
        r = urllib.request.urlopen(f"{BACKEND_URL}/api/home", timeout=10)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["home"] = "PASS" if "inbox_count" in data else "FAIL: missing data"
    except Exception as e:
        checks["home"] = f"FAIL: {e}"

    # 3. Today endpoint
    try:
        r = urllib.request.urlopen(f"{BACKEND_URL}/api/today", timeout=5)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["today"] = "PASS" if "date" in data else "FAIL: missing date"
    except Exception as e:
        checks["today"] = f"FAIL: {e}"

    # 4. Review queues
    try:
        r = urllib.request.urlopen(f"{BACKEND_URL}/api/review-queues", timeout=10)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["review_queues"] = "PASS" if "total" in data else "FAIL: missing total"
    except Exception as e:
        checks["review_queues"] = f"FAIL: {e}"

    # 5. Agent next
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/agent/next",
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        r = urllib.request.urlopen(req, timeout=10)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["agent_next"] = "PASS" if "recommended" in data else "FAIL: no recommendation"
    except Exception as e:
        checks["agent_next"] = f"FAIL: {e}"

    # 6. Safety endpoint
    try:
        r = urllib.request.urlopen(f"{BACKEND_URL}/api/safety", timeout=10)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["safety"] = "PASS" if "status" in data else "FAIL: no status"
    except Exception as e:
        checks["safety"] = f"FAIL: {e}"

    # 7. Unsafe command refusal
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/run",
            data=json.dumps({"command": "semantic-clear", "args": [], "confirmed": False}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        r = urllib.request.urlopen(req, timeout=5)  # noqa: S310
        data = json.loads(r.read().decode())
        if data.get("ok") is False and "forbidden" in data.get("reason", "").lower():
            checks["unsafe_refusal"] = "PASS"
        else:
            checks["unsafe_refusal"] = f"FAIL: command was not refused (got: {data})"
    except Exception as e:
        checks["unsafe_refusal"] = f"FAIL: {e}"

    # 8. Frontend reachable
    try:
        r = urllib.request.urlopen(BACKEND_URL, timeout=5)  # noqa: S310
        checks["frontend"] = "PASS" if r.status == 200 else f"FAIL: status {r.status}"
    except Exception as e:
        checks["frontend"] = f"FAIL: {e}"

    # 9. Review items endpoint
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(f"{BACKEND_URL}/api/review/items", timeout=10)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["review_items"] = "PASS" if "items" in data and "total" in data else "FAIL: missing data"
    except Exception as e:
        checks["review_items"] = f"FAIL: {e}"

    # 10. Path safety (protected folder rejected)
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/acceptance/plan",
            data=json.dumps({"path": "WilliamOS/03_Doctrine/test.md"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        r = urllib.request.urlopen(req, timeout=5)  # noqa: S310
        data = json.loads(r.read().decode())
        if data.get("ok") is False and "protected" in data.get("error", "").lower():
            checks["path_safety"] = "PASS"
        else:
            checks["path_safety"] = f"FAIL: protected path was not rejected (got: {data})"
    except Exception as e:
        checks["path_safety"] = f"FAIL: {e}"

    # 11. Accept endpoint rejects wrong confirmation
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/acceptance/accept",
            data=json.dumps({
                "draft_path": "WilliamOS/80_DoctrinePromotion/drafts/test.md",
                "dest": "WilliamOS/03_Doctrine/",
                "confirmation": "accept",
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(req, timeout=5)  # noqa: S310
        data = json.loads(r.read().decode())
        if data.get("ok") is False and "ACCEPT" in data.get("error", ""):
            checks["accept_wrong_confirm"] = "PASS"
        else:
            checks["accept_wrong_confirm"] = f"FAIL: not rejected (got: {data})"
    except Exception as e:
        checks["accept_wrong_confirm"] = f"FAIL: {e}"

    # 12. Accept endpoint rejects invalid destination
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/acceptance/accept",
            data=json.dumps({
                "draft_path": "WilliamOS/80_DoctrinePromotion/drafts/test.md",
                "dest": "WilliamOS/00_Inbox/",
                "confirmation": "ACCEPT",
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(req, timeout=5)  # noqa: S310
        data = json.loads(r.read().decode())
        if data.get("ok") is False:
            checks["accept_bad_dest"] = "PASS"
        else:
            checks["accept_bad_dest"] = f"FAIL: not rejected (got: {data})"
    except Exception as e:
        checks["accept_bad_dest"] = f"FAIL: {e}"

    # 13. Accept-draft refused via generic run
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/run",
            data=json.dumps({
                "command": "accept-draft",
                "args": ["--draft", "test.md", "--dest", "WilliamOS/03_Doctrine/", "--confirm"],
                "confirmed": False,
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(req, timeout=5)  # noqa: S310
        data = json.loads(r.read().decode())
        if data.get("ok") is False and "forbidden" in data.get("reason", "").lower():
            checks["accept_generic_refused"] = "PASS"
        else:
            checks["accept_generic_refused"] = f"FAIL: not blocked (got: {data})"
    except Exception as e:
        checks["accept_generic_refused"] = f"FAIL: {e}"

    # 14. Closure checklist endpoint
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/closure/checklist",
            data=b'{}',
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(req, timeout=15)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["closure_checklist"] = "PASS" if data.get("ok") else f"FAIL: {data}"
    except Exception as e:
        checks["closure_checklist"] = f"FAIL: {e}"

    # 15. Closure dry-run endpoint
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/closure/dry-run",
            data=b'{}',
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(req, timeout=15)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["closure_dry_run"] = "PASS" if data.get("ok") else f"FAIL: {data}"
    except Exception as e:
        checks["closure_dry_run"] = f"FAIL: {e}"

    # 16. Snapshot dry-run endpoint
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/git/snapshot-dry-run",
            data=b'{}',
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(req, timeout=15)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["snapshot_dry_run"] = "PASS" if data.get("ok") else f"FAIL: {data}"
    except Exception as e:
        checks["snapshot_dry_run"] = f"FAIL: {e}"

    # 17. Agent post-acceptance guidance
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/agent/post-acceptance",
            data=b'{}',
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(req, timeout=10)  # noqa: S310
        data = json.loads(r.read().decode())
        checks["agent_post_acceptance"] = "PASS" if data.get("ok") and "steps" in data else f"FAIL: {data}"
    except Exception as e:
        checks["agent_post_acceptance"] = f"FAIL: {e}"

    # 18. Accept endpoint rejects path traversal
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        req = urllib.request.Request(
            f"{BACKEND_URL}/api/acceptance/accept",
            data=json.dumps({
                "draft_path": "WilliamOS/../secrets.md",
                "dest": "WilliamOS/03_Doctrine/",
                "confirmation": "ACCEPT",
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        r = urllib.request.urlopen(req, timeout=5)  # noqa: S310
        data = json.loads(r.read().decode())
        if data.get("ok") is False and "traversal" in data.get("error", "").lower():
            checks["accept_traversal"] = "PASS"
        else:
            checks["accept_traversal"] = f"FAIL: not rejected (got: {data})"
    except Exception as e:
        checks["accept_traversal"] = f"FAIL: {e}"

    checks.update(_devops_smoke_checks())

    passed = sum(1 for v in checks.values() if v == "PASS")
    total = len(checks)

    for name, result in checks.items():
        icon = "PASS" if result == "PASS" else "FAIL"
        print(f"  [{icon}] {name}: {result}")

    print()
    verdict = "PASS" if passed == total else "FAIL"
    print(f"  Smoke: {verdict} ({passed}/{total})")
    return 0 if verdict == "PASS" else 1
