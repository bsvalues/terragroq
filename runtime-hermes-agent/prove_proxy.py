import json
import socket
import urllib.error
import urllib.request

PROXY = "http://inference-proxy:8080"


def request(path, method="GET", payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        PROXY + path,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.status, json.loads(response.read())


status, models = request("/v1/models")
assert status == 200
assert any(model.get("id") == "williamos-qwen3-4b:64k" for model in models.get("data", []))

try:
    request("/api/delete", "POST", {"model": "llama3.2:3b"})
except urllib.error.HTTPError as error:
    assert error.code == 403
else:
    raise AssertionError("Ollama management route was reachable")

try:
    socket.getaddrinfo("ollama", 11434)
except socket.gaierror:
    pass
else:
    raise AssertionError("Agent network can resolve Ollama directly")

status, completion = request(
    "/v1/chat/completions",
    "POST",
    {
        "model": "williamos-qwen3-4b:64k",
        "stream": False,
        "max_tokens": 128,
        "messages": [
            {"role": "system", "content": "Use the supplied function for this request."},
            {"role": "user", "content": "Call record_probe with marker HERMES_FREE_AGENT_TOOL_OK."},
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "record_probe",
                    "description": "Record the exact proof marker.",
                    "parameters": {
                        "type": "object",
                        "properties": {"marker": {"type": "string"}},
                        "required": ["marker"],
                    },
                },
            }
        ],
    },
)
assert status == 200
calls = completion["choices"][0]["message"].get("tool_calls", [])
assert calls and calls[0]["function"]["name"] == "record_probe"
arguments = json.loads(calls[0]["function"]["arguments"])
assert arguments["marker"] == "HERMES_FREE_AGENT_TOOL_OK"

print("INFERENCE_PROXY_MODELS_OK")
print("INFERENCE_PROXY_MANAGEMENT_DENIED")
print("INFERENCE_PROXY_DIRECT_OLLAMA_DENIED")
print("LOCAL_MODEL_TOOL_CALL_PROVEN")
