#!/usr/bin/env python3
"""Pinned, offline, single-flight inference only. No model tools or code execution."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time


class Wall(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Wall(reason)


def absolute(value):
    require(isinstance(value, str) and "\0" not in value and Path(value).is_absolute(), "PATH")
    return Path(value).resolve(strict=True)


def digest(file):
    value = hashlib.sha256()
    with file.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def pin(file, expected):
    require(isinstance(expected, str) and re.fullmatch(r"[a-f0-9]{64}", expected), "HASH")
    require(file.is_file() and digest(file) == expected, "HASH")


def read_json(file):
    require(file.stat().st_size <= 1024 * 1024, "INPUT_SIZE")
    return json.loads(file.read_text(encoding="utf-8"))


def validate(args):
    workspace = absolute(args.workspace_path)
    require(workspace.is_dir() and workspace.parent.name == "worktrees", "WORKSPACE")
    runtime = workspace.parent.parent
    packet_path, policy_path, state = map(absolute, (args.packet_path, args.policy_path, args.state_path))
    require(re.fullmatch(r"[0-9a-f-]{36}", args.run_id), "RUN_ID")
    threads = runtime / "hermes-kernel" / "threads"
    require(state.parent.parent == threads and state.name == "kernel-state", "STATE")
    require(re.fullmatch(r"[0-9a-f-]{36}", state.parent.name), "THREAD")
    require(packet_path.parent.parent == state.parent / "turns" and packet_path.name == "packet.json"
            and packet_path.parent.name.isdecimal(), "PACKET_PATH")
    quarantine = runtime / "hermes-kernel" / "HERMES_FREE_AGENT_QUARANTINED"
    require(Path(args.quarantine_path).is_absolute() and Path(args.quarantine_path).resolve() == quarantine, "QUARANTINE_PATH")
    require(not quarantine.exists() and not (policy_path.parent / quarantine.name).exists(), "QUARANTINED")
    require(not policy_path.is_relative_to(workspace), "POLICY_PATH")
    packet, policy = read_json(packet_path), read_json(policy_path)
    require(packet.get("schemaVersion") == 3 and packet.get("runId") == args.run_id, "PACKET_IDENTITY")
    require(packet.get("workspaceMode") == "OWNED_WORKTREE" and absolute(packet.get("workspacePath")) == workspace
            and absolute(packet.get("statePath")) == state and packet.get("kernelSessionId") is None, "PACKET_WORKSPACE")
    require(policy.get("placement", {}).get("executionNode") == "daedalus", "NODE")
    require(policy["placement"].get("workspaceMode") == "OWNED_WORKTREE"
            and str(workspace.parent) in policy["placement"].get("allowedWorkspaceRoots", []), "WORKSPACE_POLICY")
    require(policy.get("model", {}).get("id") == "Qwen/Qwen3-8B" and packet.get("model") == "Qwen/Qwen3-8B", "MODEL")
    require(packet.get("workOrderId") == policy.get("workOrderId") and bool(policy.get("workOrderId")), "WORK_ORDER")
    promotion = policy.get("promotion", {})
    require(promotion.get("status") in ("PILOT_AUTHORIZED", "PROMOTED"), "AUTHORIZATION")
    evidence = promotion.get("satisfiedEvidence", {})
    required = promotion.get("requiredEvidence", []) + (promotion.get("promotionRequires", []) if promotion.get("status") == "PROMOTED" else [])
    require(bool(required) and all(evidence.get(key) for key in required), "EVIDENCE")
    execution = policy.get("execution", {})
    require(execution.get("maximumConcurrency") == 1 and execution.get("maximumTurns") == 1 and execution.get("allowedToolsets") == []
            and packet.get("toolsets") == [] and packet.get("maximumTurns") == 1, "TOOLS")
    require(policy.get("model", {}).get("cloudFallbackAllowed") is False, "OFFLINE")
    require(isinstance(packet.get("prompt"), str) and 0 < len(packet["prompt"]) <= execution.get("promptMaxChars", 16000), "PROMPT")
    config = policy["daedalusInvoker"]
    python_real, worker, model = map(absolute, (config["pythonExecutable"], config["workerPath"], config["modelPath"]))
    # Keep the venv launcher path: resolving its symlink would lose pyvenv.cfg discovery.
    python = Path(config["pythonExecutable"])
    require(all(not item.is_relative_to(workspace) for item in (python_real, worker, model)), "EXECUTABLE_PATH")
    pin(worker, config["workerSha256"])
    require(model.is_dir() and re.fullmatch(r"[a-f0-9]{40}", config["modelRevision"]), "MODEL_PATH")
    artifacts = config["modelFiles"]
    require(isinstance(artifacts, dict) and {"config.json", "tokenizer.json", "tokenizer_config.json"} <= artifacts.keys(), "MODEL_FILES")
    shards = {entry.name for entry in model.glob("*.safetensors")}
    require(bool(shards) and shards <= artifacts.keys(), "MODEL_SHARDS")
    consumed = {entry.name for entry in model.iterdir() if entry.suffix in (".json", ".safetensors", ".txt", ".model") and entry.is_file()}
    require(consumed <= artifacts.keys(), "MODEL_FILES")
    for name, expected in artifacts.items():
        require(isinstance(name, str) and Path(name).name == name and name not in (".", ".."), "MODEL_FILE_PATH")
        file = absolute(str(model / name))
        require(file.parent == model, "MODEL_FILE_PATH")
        pin(file, expected)
    seconds, generation, tokens = execution["timeoutSeconds"], config["generationSeconds"], config["maxNewTokens"]
    require(type(seconds) is int and 1 <= seconds <= 3600 and type(generation) is int and 1 <= generation <= seconds,
            "TIMEOUT")
    require(type(tokens) is int and 1 <= tokens <= 2048, "TOKENS")
    require(re.fullmatch(r"GPU-[a-fA-F0-9-]+", config["expectedGpuUuid"]), "GPU")
    return packet, config, python, worker, model, packet_path, quarantine, seconds


def answer_bytes(response, run_id):
    require(isinstance(response, str), "OUTPUT")
    candidate = response.strip()
    matched = re.fullmatch(r"HERMES_TURN_OUTPUT runId=" + re.escape(run_id) + r"\s*\n([\s\S]*?)\nHERMES_TURN_OUTPUT_END", candidate)
    if matched:
        candidate = matched.group(1)
    else:
        fenced = re.fullmatch(r"```json\s*\n([\s\S]*?)\n```", candidate)
        if fenced:
            candidate = fenced.group(1)
    require(isinstance(json.loads(candidate), dict), "OUTPUT")
    return candidate


def invoke(args):
    import fcntl  # Linux worker only; intentionally no unlocked portability fallback.
    started = time.monotonic()
    packet, config, python, worker, model, packet_path, quarantine, seconds = validate(args)
    policy_hash = digest(Path(args.policy_path))
    lock_path = quarantine.parent / "daedalus-inference.lock"
    with lock_path.open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Wall("BUSY")
        require(not quarantine.exists(), "QUARANTINED")
        request = {"backend": "hf", "model_path": str(model), "dtype": "bfloat16", "quantization": "none",
                   "max_context": 16384, "generation_seconds": config["generationSeconds"],
                   "task": {"id": args.run_id, "max_new_tokens": config["maxNewTokens"], "messages": [
                       {"role": "system", "content": "You are a bounded read-only repository context worker. Use only supplied context. No tools are available; do not claim edits, commands, tests, commits, or actions you did not perform. Return the requested JSON result."},
                       {"role": "user", "content": packet["prompt"]}]}}
        turn_root = packet_path.parent
        request_path = turn_root / "inference-request.json"
        request_path.write_text(json.dumps(request), encoding="utf-8")
        os.chmod(request_path, 0o600)
        env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "LD_LIBRARY_PATH") if key in os.environ}
        env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_DATASETS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                   CUDA_VISIBLE_DEVICES=config["expectedGpuUuid"], TOKENIZERS_PARALLELISM="false")
        if time.monotonic() - started >= seconds:
            quarantine.write_text("DAEDALUS_TIMEOUT runId=" + args.run_id)
            raise Wall("TIMEOUT")
        with (turn_root / "inference-result.json").open("xb") as stdout, (turn_root / "inference-stderr.txt").open("xb") as stderr:
            os.chmod(stdout.name, 0o600); os.chmod(stderr.name, 0o600)
            child = subprocess.Popen([str(python), "-I", str(worker)], stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                                     cwd=str(turn_root), env=env, start_new_session=True)
            try:
                # Feed the pipe without blocking: a worker that never reads stdin
                # must remain subject to the same deadline as model generation.
                pending = memoryview(json.dumps(request).encode())
                os.set_blocking(child.stdin.fileno(), False)
                while child.poll() is None:
                    if time.monotonic() - started >= seconds:
                        quarantine.write_text("DAEDALUS_TIMEOUT runId=" + args.run_id)
                        raise Wall("TIMEOUT")
                    require(os.fstat(stdout.fileno()).st_size + os.fstat(stderr.fileno()).st_size <= 8 * 1024 * 1024, "OUTPUT_SIZE")
                    if pending:
                        try:
                            written = os.write(child.stdin.fileno(), pending[:65536])
                            pending = pending[written:]
                        except BlockingIOError:
                            pass
                    if not pending and not child.stdin.closed:
                        child.stdin.close()
                    time.sleep(0.1)
            finally:
                if not child.stdin.closed:
                    child.stdin.close()
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
        result = read_json(turn_root / "inference-result.json")
        stops = result.get("metrics", {}).get("stop_reasons", [])
        if stops:
            quarantine.write_text(json.dumps({"runId": args.run_id, "stopReasons": stops}))
            raise Wall("RESOURCE_STOP")
        require(child.returncode == 0 and result.get("status") == "ok", "EXECUTION")
        require(result.get("metrics", {}).get("gpu_identity", {}).get("uuid") == config["expectedGpuUuid"], "GPU_IDENTITY")
        answer = answer_bytes(result.get("response"), args.run_id)
        require(digest(Path(args.policy_path)) == policy_hash and digest(worker) == config["workerSha256"], "POLICY_CHANGED")
        receipt = {"schemaVersion": 1, "nodeId": "daedalus", "modelId": "Qwen/Qwen3-8B", "modelRevision": config["modelRevision"],
                   "observedAt": datetime.now(timezone.utc).isoformat(), "runId": args.run_id,
                   "executionMode": "read-only-inference", "agentToolsEnabled": False, "inferenceCompleted": True,
                   "kernelTurnAccepted": False, "policySha256": policy_hash, "workerSha256": config["workerSha256"],
                   "gpuUuid": config["expectedGpuUuid"], "metrics": result["metrics"],
                   "resultPath": str(turn_root / "inference-result.json"), "resultSha256": digest(turn_root / "inference-result.json")}
        receipt_temp = quarantine.parent / (".daedalus-success-" + args.run_id + ".json")
        with receipt_temp.open("x") as target:
            os.chmod(receipt_temp, 0o600)
            json.dump(receipt, target)
        os.replace(receipt_temp, quarantine.parent / "daedalus-last-inference-success.json")
        print("HERMES_TURN_OUTPUT runId=" + args.run_id)
        print(answer)
        print("HERMES_TURN_OUTPUT_END")
        print("HERMES_FREE_AGENT_COMPLETE runId=" + args.run_id)


def main():
    parser = argparse.ArgumentParser()
    for name in ("packet-path", "policy-path", "workspace-path", "run-id", "quarantine-path", "state-path"):
        parser.add_argument("--" + name, required=True)
    try:
        invoke(parser.parse_args())
        return 0
    except Exception as error:
        reason = str(error) if isinstance(error, Wall) else type(error).__name__
        print("HERMES_FREE_AGENT_" + ("TIMEOUT" if reason == "TIMEOUT" else "EXECUTION") + "_WALL reason=" + reason)
        return 124 if reason == "TIMEOUT" else 1


if __name__ == "__main__":
    sys.exit(main())
