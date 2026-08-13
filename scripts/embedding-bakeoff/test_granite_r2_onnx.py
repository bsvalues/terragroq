import importlib.util
import json
import math
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("granite_r2_onnx.py")
SPEC = importlib.util.spec_from_file_location("granite_r2_onnx", MODULE_PATH)
granite = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(granite)


class FakeArray:
    def __init__(self, value):
        self.value = value
        self.shape = self._shape(value)

    @classmethod
    def _shape(cls, value):
        if not isinstance(value, list):
            return ()
        if not value:
            return (0,)
        child = cls._shape(value[0])
        if any(cls._shape(item) != child for item in value):
            raise ValueError("ragged fake array")
        return (len(value),) + child

    def tolist(self):
        return self.value


class FakeEncoding:
    def __init__(self, length):
        self.ids = [1, 2] + [0] * (length - 2)
        self.attention_mask = [1, 1] + [0] * (length - 2)


class FakeNode:
    def __init__(self, name, shape, data_type):
        self.name = name
        self.shape = shape
        self.type = data_type


class RuntimeState:
    providers = ["CPUExecutionProvider"]
    inputs = [
        FakeNode("input_ids", [None, None], "tensor(int64)"),
        FakeNode("attention_mask", [None, None], "tensor(int64)"),
    ]
    outputs = [FakeNode("last_hidden_state", [None, None, 768], "tensor(float)")]
    output_value = None
    sessions = []
    tokenizer_length_delta = 0

    @classmethod
    def reset(cls):
        cls.providers = ["CPUExecutionProvider"]
        cls.inputs = [
            FakeNode("input_ids", [None, None], "tensor(int64)"),
            FakeNode("attention_mask", [None, None], "tensor(int64)"),
        ]
        cls.outputs = [FakeNode("last_hidden_state", [None, None, 768], "tensor(float)")]
        cls.output_value = None
        cls.sessions = []
        cls.tokenizer_length_delta = 0


class GraniteR2OnnxTests(unittest.TestCase):
    def setUp(self):
        RuntimeState.reset()
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        (self.root / "onnx").mkdir()
        (self.root / "1_Pooling").mkdir()
        (self.root / "onnx/model_quint8_avx2.onnx").write_bytes(b"fake")
        (self.root / "tokenizer.json").write_text("{}", encoding="utf-8")
        self.write_json("config.json", {
            "hidden_size": 768,
            "max_position_embeddings": 32768,
            "pad_token_id": 0,
        })
        self.write_json("1_Pooling/config.json", {
            "word_embedding_dimension": 768,
            "pooling_mode_cls_token": True,
            "pooling_mode_mean_tokens": False,
            "pooling_mode_max_tokens": False,
            "pooling_mode_mean_sqrt_len_tokens": False,
            "pooling_mode_weightedmean_tokens": False,
            "pooling_mode_lasttoken": False,
        })

    def tearDown(self):
        self.tempdir.cleanup()

    def write_json(self, relative, value):
        (self.root / relative).write_text(json.dumps(value), encoding="utf-8")

    def fake_modules(self):
        numpy = types.ModuleType("numpy")
        numpy.int64 = object()
        numpy.asarray = lambda value, dtype=None: value if isinstance(value, FakeArray) else FakeArray(value)

        tokenizers = types.ModuleType("tokenizers")

        class Tokenizer:
            @classmethod
            def from_file(cls, path):
                if Path(path) != self.root / "tokenizer.json":
                    raise AssertionError("unexpected tokenizer path")
                return cls()

            def id_to_token(inner_self, token_id):
                return "<pad>" if token_id == 0 else None

            def enable_truncation(inner_self, **kwargs):
                inner_self.max_length = kwargs["max_length"]
                inner_self.truncation = kwargs

            def enable_padding(inner_self, **kwargs):
                inner_self.padding = kwargs

            def encode_batch(inner_self, texts, add_special_tokens):
                if not add_special_tokens:
                    raise AssertionError("special tokens must be enabled")
                length = inner_self.max_length + RuntimeState.tokenizer_length_delta
                return [FakeEncoding(length) for _ in texts]

        tokenizers.Tokenizer = Tokenizer

        ort = types.ModuleType("onnxruntime")

        class SessionOptions:
            pass

        class ExecutionMode:
            ORT_SEQUENTIAL = "sequential"

        class InferenceSession:
            def __init__(inner_self, path, sess_options, providers):
                inner_self.path = path
                inner_self.options = sess_options
                inner_self.requested_providers = providers
                inner_self.fallback_disabled = False
                inner_self.run_calls = []
                RuntimeState.sessions.append(inner_self)

            def disable_fallback(inner_self):
                inner_self.fallback_disabled = True

            def get_providers(inner_self):
                return RuntimeState.providers

            def get_inputs(inner_self):
                return RuntimeState.inputs

            def get_outputs(inner_self):
                return RuntimeState.outputs

            def run(inner_self, output_names, feeds):
                inner_self.run_calls.append((output_names, feeds))
                if RuntimeState.output_value is not None:
                    return RuntimeState.output_value
                batch, sequence = feeds["input_ids"].shape
                vector = [3.0, 4.0] + [0.0] * 766
                row = [vector] + [[9.0] * 768 for _ in range(sequence - 1)]
                return [[row for _ in range(batch)]]

        ort.SessionOptions = SessionOptions
        ort.ExecutionMode = ExecutionMode
        ort.InferenceSession = InferenceSession
        return {"numpy": numpy, "tokenizers": tokenizers, "onnxruntime": ort}

    def call(self, texts=("hello",), threads=3):
        with mock.patch.dict(sys.modules, self.fake_modules()):
            return granite.embed_texts(self.root, texts, threads)

    def test_happy_path_is_cls_pooled_normalized_cpu_only_and_bounded(self):
        result = self.call(tuple(f"text {index}" for index in range(9)), threads=3)
        self.assertEqual(len(result), 9)
        self.assertEqual(result[0][:3], [0.6, 0.8, 0.0])
        self.assertTrue(math.isclose(math.sqrt(sum(item * item for item in result[0])), 1.0))
        session = RuntimeState.sessions[0]
        self.assertEqual(session.requested_providers, ["CPUExecutionProvider"])
        self.assertTrue(session.fallback_disabled)
        self.assertEqual(session.options.intra_op_num_threads, 3)
        self.assertEqual(session.options.inter_op_num_threads, 1)
        self.assertEqual(session.options.execution_mode, "sequential")
        self.assertEqual([call[1]["input_ids"].shape for call in session.run_calls], [(8, 512), (1, 512)])

    def test_required_model_file_is_fail_closed(self):
        os.remove(self.root / "tokenizer.json")
        with self.assertRaisesRegex(ValueError, "missing required model files: tokenizer.json"):
            self.call()

    def test_pooling_config_rejects_dimension_and_mode_drift(self):
        for mutation, message in (
            ({"word_embedding_dimension": 384}, "pooling dimension must be 768"),
            ({"pooling_mode_mean_tokens": True}, "CLS pooling only"),
        ):
            with self.subTest(mutation=mutation):
                config = {
                    "word_embedding_dimension": 768,
                    "pooling_mode_cls_token": True,
                    "pooling_mode_mean_tokens": False,
                    "pooling_mode_max_tokens": False,
                    "pooling_mode_mean_sqrt_len_tokens": False,
                    "pooling_mode_weightedmean_tokens": False,
                    "pooling_mode_lasttoken": False,
                }
                config.update(mutation)
                self.write_json("1_Pooling/config.json", config)
                with self.assertRaisesRegex(ValueError, message):
                    self.call()

    def test_model_config_rejects_hidden_size_and_length_drift(self):
        for config, message in (
            ({"hidden_size": 1024, "max_position_embeddings": 32768, "pad_token_id": 0},
             "hidden_size must be 768"),
            ({"hidden_size": 768, "max_position_embeddings": 511, "pad_token_id": 0},
             "below the execution truncation length"),
            ({"hidden_size": 768, "max_position_embeddings": 32767, "pad_token_id": 0},
             "max_position_embeddings must be 32768"),
        ):
            with self.subTest(config=config):
                self.write_json("config.json", config)
                with self.assertRaisesRegex(ValueError, message):
                    self.call()

    def test_provider_drift_is_rejected(self):
        RuntimeState.providers = ["CPUExecutionProvider", "CUDAExecutionProvider"]
        with self.assertRaisesRegex(RuntimeError, "CPUExecutionProvider only"):
            self.call()

    def test_onnx_input_drift_is_rejected(self):
        RuntimeState.inputs.append(FakeNode("token_type_ids", [None, None], "tensor(int64)"))
        with self.assertRaisesRegex(ValueError, "exactly input_ids and attention_mask"):
            self.call()

    def test_onnx_output_metadata_shape_drift_is_rejected(self):
        RuntimeState.outputs = [FakeNode("output", [None, 768], "tensor(float)")]
        with self.assertRaisesRegex(ValueError, "one rank-3 output"):
            self.call()

    def test_runtime_output_shape_drift_is_rejected(self):
        RuntimeState.output_value = [[[[1.0] * 767 for _ in range(4)]]]
        with self.assertRaisesRegex(ValueError, r"\[batch, sequence, 768\]"):
            self.call()

    def test_tokenizer_padding_drift_is_rejected(self):
        RuntimeState.tokenizer_length_delta = -1
        with self.assertRaisesRegex(ValueError, "fixed-length padding and truncation"):
            self.call()

    def test_nonfinite_and_zero_cls_vectors_are_rejected(self):
        for vector, message in (
            ([float("nan")] + [0.0] * 767, "non-finite values"),
            ([0.0] * 768, "zero or non-finite norm"),
        ):
            with self.subTest(message=message):
                RuntimeState.output_value = [
                    [[vector] + [[1.0] * 768 for _ in range(511)]]
                ]
                with self.assertRaisesRegex(ValueError, message):
                    self.call()

    def test_input_and_thread_bounds_are_rejected_before_dependency_loading(self):
        cases = (
            ((), 1, ValueError),
            (("   ",), 1, ValueError),
            (("ok",), 0, ValueError),
            (("ok",), True, TypeError),
            (tuple("x" for _ in range(257)), 1, ValueError),
        )
        for texts, threads, error in cases:
            with self.subTest(count=len(texts), threads=threads):
                with self.assertRaises(error):
                    granite.embed_texts(self.root, texts, threads)


if __name__ == "__main__":
    unittest.main(verbosity=2)
