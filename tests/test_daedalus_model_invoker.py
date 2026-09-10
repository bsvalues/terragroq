"""Linux unit tests: synthetic pinned worker, never loads a model or GPU."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "hermes-bridge" / "invoke-daedalus-model.py"
SPEC = importlib.util.spec_from_file_location("daedalus_invoker", SOURCE)
invoker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(invoker)


class InvokerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime = self.root / "runtime"
        self.workspace = self.runtime / "worktrees" / "owned"
        self.workspace.mkdir(parents=True)
        self.thread = self.runtime / "hermes-kernel" / "threads" / "11111111-1111-4111-8111-111111111111"
        self.state = self.thread / "kernel-state"
        self.state.mkdir(parents=True)
        self.turn = self.thread / "turns" / "1"
        self.turn.mkdir(parents=True)
        self.model = self.root / "model"
        self.model.mkdir()
        artifacts = {}
        for name in ["config.json", "tokenizer.json", "tokenizer_config.json", "model.safetensors"]:
            (self.model / name).write_text("fixture")
            artifacts[name] = invoker.digest(self.model / name)
        self.worker = self.root / "worker.py"
        self.set_worker({"status": "ok", "response": '{"actual":"fixture response"}',
                         "metrics": {"stop_reasons": [], "gpu_identity": {"uuid": "GPU-abcd"}}})
        self.policy = {"workOrderId": "WO-FIXTURE", "placement": {"executionNode": "daedalus", "workspaceMode": "OWNED_WORKTREE", "allowedWorkspaceRoots": [str(self.workspace.parent)]},
                       "model": {"id": "Qwen/Qwen3-8B", "cloudFallbackAllowed": False},
                       "promotion": {"status": "PILOT_AUTHORIZED", "requiredEvidence": ["FIXTURE"], "satisfiedEvidence": {"FIXTURE": "unit-only"}},
                       "execution": {"maximumConcurrency": 1, "maximumTurns": 1, "allowedToolsets": [], "timeoutSeconds": 10},
                       "daedalusInvoker": {"pythonExecutable": sys.executable, "workerPath": str(self.worker),
                           "workerSha256": invoker.digest(self.worker), "modelPath": str(self.model), "modelRevision": "a" * 40,
                           "modelFiles": artifacts, "generationSeconds": 1, "maxNewTokens": 128, "expectedGpuUuid": "GPU-abcd"}}
        self.args = types.SimpleNamespace(packet_path=str(self.turn / "packet.json"), policy_path=str(self.root / "policy.json"),
                                         workspace_path=str(self.workspace), state_path=str(self.state),
                                         quarantine_path=str(self.runtime / "hermes-kernel" / "HERMES_FREE_AGENT_QUARANTINED"),
                                         run_id="22222222-2222-4222-8222-222222222222")
        self.packet = {"schemaVersion": 3, "workOrderId": "WO-FIXTURE", "model": "Qwen/Qwen3-8B",
                       "runId": self.args.run_id, "workspaceMode": "OWNED_WORKTREE", "workspacePath": str(self.workspace),
                       "statePath": str(self.state), "kernelSessionId": None, "toolsets": [], "maximumTurns": 1, "prompt": "Read-only fixture"}
        self.save()

    def set_worker(self, result, sleep=0):
        self.worker.write_text("import json, os, sys, time\nr=json.load(sys.stdin)\n"
                               "assert r['backend']=='hf' and r['quantization']=='none' and r['dtype']=='bfloat16'\n"
                               "assert os.environ['HF_HUB_OFFLINE']=='1'\n"
                               "assert r['task'].get('followups') is None\n"
                               f"time.sleep({sleep})\nprint({json.dumps(json.dumps(result))})\n")

    def save(self):
        Path(self.args.policy_path).write_text(json.dumps(self.policy))
        Path(self.args.packet_path).write_text(json.dumps(self.packet))

    def run_invoker(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            invoker.invoke(self.args)
        return output.getvalue()

    def test_actual_response_and_metrics_are_preserved(self):
        output = self.run_invoker()
        self.assertIn('{"actual":"fixture response"}', output)
        self.assertIn("HERMES_FREE_AGENT_COMPLETE runId=" + self.args.run_id, output)
        raw = json.loads((self.turn / "inference-result.json").read_text())
        self.assertEqual(raw["response"], '{"actual":"fixture response"}')
        receipt = json.loads((self.runtime / "hermes-kernel" / "daedalus-last-inference-success.json").read_text())
        self.assertEqual(receipt["resultSha256"], invoker.digest(self.turn / "inference-result.json"))
        self.assertTrue(receipt["inferenceCompleted"])
        self.assertFalse(receipt["kernelTurnAccepted"])
        self.assertEqual(json.loads((self.turn / "inference-request.json").read_text())["task"]["messages"][1]["content"], self.packet["prompt"])

    def test_hash_and_tools_fail_before_process(self):
        self.worker.write_text("raise Exception('tampered')")
        with self.assertRaisesRegex(invoker.Wall, "HASH"):
            self.run_invoker()
        self.assertFalse((self.turn / "inference-result.json").exists())
        self.packet["toolsets"] = ["terminal"]
        self.save()
        with self.assertRaisesRegex(invoker.Wall, "TOOLS"):
            self.run_invoker()

    def test_identity_and_missing_shards_fail(self):
        self.packet["runId"] = "not-this-run"
        self.save()
        with self.assertRaisesRegex(invoker.Wall, "PACKET_IDENTITY"):
            self.run_invoker()
        self.packet["runId"] = self.args.run_id
        del self.policy["daedalusInvoker"]["modelFiles"]["model.safetensors"]
        self.save()
        with self.assertRaisesRegex(invoker.Wall, "MODEL_SHARDS"):
            self.run_invoker()

    def test_busy_lock_prevents_second_process(self):
        import fcntl
        with (self.runtime / "hermes-kernel" / "daedalus-inference.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(invoker.Wall, "BUSY"):
                self.run_invoker()
        self.assertFalse((self.turn / "inference-result.json").exists())

    def test_timeout_kills_worker_and_quarantines(self):
        self.set_worker({}, sleep=5)
        self.policy["daedalusInvoker"]["workerSha256"] = invoker.digest(self.worker)
        self.policy["execution"]["timeoutSeconds"] = 1
        self.save()
        with self.assertRaisesRegex(invoker.Wall, "TIMEOUT"):
            self.run_invoker()
        self.assertIn("TIMEOUT", Path(self.args.quarantine_path).read_text())

    def test_resource_stop_quarantines_without_completion(self):
        self.set_worker({"status": "failure", "metrics": {"stop_reasons": ["sampled_thermal_or_power_limit"]}})
        self.policy["daedalusInvoker"]["workerSha256"] = invoker.digest(self.worker)
        self.save()
        with self.assertRaisesRegex(invoker.Wall, "RESOURCE_STOP"):
            self.run_invoker()
        self.assertTrue(Path(self.args.quarantine_path).exists())

    def test_timeout_applies_when_worker_never_reads_large_stdin(self):
        self.worker.write_text("import time\ntime.sleep(5)\n")
        self.policy["daedalusInvoker"]["workerSha256"] = invoker.digest(self.worker)
        self.policy["execution"].update(timeoutSeconds=1, promptMaxChars=250000)
        self.packet["prompt"] = "x" * 200000  # Exceeds the ordinary Linux pipe capacity.
        self.save()
        started = time.monotonic()
        with self.assertRaisesRegex(invoker.Wall, "TIMEOUT"):
            self.run_invoker()
        self.assertLess(time.monotonic() - started, 3)
        self.assertIn("TIMEOUT", Path(self.args.quarantine_path).read_text())

    def test_invalid_response_is_not_repaired(self):
        self.set_worker({"status": "ok", "response": "not JSON", "metrics": {"stop_reasons": [], "gpu_identity": {"uuid": "GPU-abcd"}}})
        self.policy["daedalusInvoker"]["workerSha256"] = invoker.digest(self.worker)
        self.save()
        with self.assertRaises(json.JSONDecodeError):
            self.run_invoker()


if __name__ == "__main__":
    unittest.main()
