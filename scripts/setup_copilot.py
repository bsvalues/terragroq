"""
setup_copilot.py — Pull required Ollama models for the WilliamOS co-pilot.

Usage:
    python scripts/setup_copilot.py

Env vars:
    WILLIAMOS_LLM_MODEL   Chat model to pull (default: qwen2.5:14b-instruct-q4_K_M)
    WILLIAMOS_LLM_HOST    Ollama base URL (default: http://127.0.0.1:11434)
"""

import json
import os
import shutil
import sys
import subprocess
import time
from urllib.parse import urlparse

import httpx

EMBED_MODEL = "nomic-embed-text"


def ollama_executable() -> str | None:
    exe = shutil.which("ollama")
    if exe:
        return exe
    local = os.path.join(
        os.environ.get("LOCALAPPDATA", ""),
        "Programs",
        "Ollama",
        "ollama.exe",
    )
    return local if os.path.exists(local) else None


def tags_available(host: str) -> bool:
    try:
        httpx.get(f"{host}/api/tags", timeout=5.0).raise_for_status()
        return True
    except Exception:
        return False


def ensure_ollama_running(host: str) -> bool:
    if tags_available(host):
        return True

    parsed = urlparse(host)
    if parsed.hostname not in {"127.0.0.1", "localhost"}:
        print("Ollama not running — refusing to start a non-local model host.")
        return False

    exe = ollama_executable()
    if not exe:
        print("Ollama not found — install Ollama, then re-run.")
        return False

    print("Ollama is installed but not running. Starting it now...")
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
        if tags_available(host):
            print("Ollama is running.")
            return True
        time.sleep(1)

    print("Ollama did not become ready within 30 seconds.")
    return False


def pull_model(client: httpx.Client, host: str, model: str) -> None:
    """Stream /api/pull for the given model, printing progress dots."""
    url = f"{host}/api/pull"
    with client.stream("POST", url, json={"name": model}, timeout=None) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            status = data.get("status", "")
            if status:
                print(f"  [{model}] {status}", flush=True)


def main() -> None:
    chat_model = os.environ.get("WILLIAMOS_LLM_MODEL", "qwen2.5:14b-instruct-q4_K_M")
    host = os.environ.get("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434").rstrip("/")

    print(f"Setting up co-pilot models from {host} ...")

    if not ensure_ollama_running(host):
        sys.exit(1)

    try:
        with httpx.Client() as client:
            print(f"Pulling chat model: {chat_model}")
            pull_model(client, host, chat_model)

            print(f"Pulling embed model: {EMBED_MODEL}")
            pull_model(client, host, EMBED_MODEL)

    except httpx.ConnectError:
        print("Ollama not running — start Ollama, then re-run.")
        sys.exit(1)

    print(f"Co-pilot model ready: {chat_model}")


if __name__ == "__main__":
    main()
