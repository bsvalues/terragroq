import http.client
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ALLOWED_MODEL = "williamos-qwen3-4b:64k"
MAX_REQUEST_BYTES = 2 * 1024 * 1024
# The upstream is where the inference backend actually runs, which is a
# deployment fact rather than a property of this proxy: a sibling Docker
# service in some deployments, the container host in others. The default
# keeps the Docker-service topology working unchanged.
UPSTREAM_HOST = os.getenv("HERMES_INFERENCE_UPSTREAM_HOST", "ollama")
UPSTREAM_PORT = int(os.getenv("HERMES_INFERENCE_UPSTREAM_PORT", "11434"))


class InferenceOnlyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_GET(self):
        if self.path != "/v1/models":
            self.send_error(403, "INFERENCE_PROXY_PATH_WALL")
            return
        self._forward(None)

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(403, "INFERENCE_PROXY_PATH_WALL")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400, "INFERENCE_PROXY_LENGTH_WALL")
            return
        if length < 1 or length > MAX_REQUEST_BYTES:
            self.send_error(413, "INFERENCE_PROXY_LENGTH_WALL")
            return
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "INFERENCE_PROXY_JSON_WALL")
            return
        if payload.get("model") != ALLOWED_MODEL:
            self.send_error(403, "INFERENCE_PROXY_MODEL_WALL")
            return
        self._forward(body)

    def _forward(self, body):
        connection = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=1800)
        headers = {"Accept": self.headers.get("Accept", "application/json")}
        if body is not None:
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(body))
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status)
            for name in ("Content-Type", "Cache-Control"):
                value = response.getheader(name)
                if value:
                    self.send_header(name, value)
            self.end_headers()
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (OSError, http.client.HTTPException):
            self.send_error(502, "INFERENCE_PROXY_UPSTREAM_WALL")
        finally:
            connection.close()

    def log_message(self, format, *args):
        print("inference-proxy", self.address_string(), format % args, flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), InferenceOnlyHandler).serve_forever()
