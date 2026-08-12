#!/usr/bin/env python3
"""Minimal OpenAI-compatible /v1/embeddings server backed by sentence-transformers, so HF-only
embedding models (e.g. Granite R2 multilingual, not on Ollama) can be scored by the same bake-off
harness. Stdlib http.server; sentence-transformers is installed in a throwaway venv for the run.

  HF_MODEL=ibm-granite/granite-embedding-311m-multilingual-r2 PORT=11600 python hf_embed_server.py
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from sentence_transformers import SentenceTransformer

MODEL_ID = os.environ["HF_MODEL"]
_model = SentenceTransformer(MODEL_ID, trust_remote_code=True, device="cpu")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not self.path.rstrip("/").endswith("/embeddings"):
            self.send_response(404); self.end_headers(); return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        inp = body.get("input")
        if isinstance(inp, str):
            inp = [inp]
        vecs = _model.encode(inp, convert_to_numpy=True, normalize_embeddings=False)
        data = [{"object": "embedding", "index": i, "embedding": v.tolist()} for i, v in enumerate(vecs)]
        out = json.dumps({"object": "list", "data": data, "model": MODEL_ID}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(os.environ.get("PORT", "11600"))), Handler).serve_forever()
