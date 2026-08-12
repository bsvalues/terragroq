#!/usr/bin/python3
import json, os, socket, struct, sys

EXPECTED_UID = 999
EXPECTED_EXE = "/usr/bin/node"
EXPECTED_SCRIPT = "/usr/local/libexec/williamos-aegis-remote-dev-ssh-entrypoint.mjs"

def blocked(detail):
    sys.stdout.write(json.dumps({"activationAuthorized": False, "detail": detail, "executionAuthorized": False, "reasonCode": "ACTIVATION_CALLER_REJECTED", "status": "BLOCKED"}, separators=(",", ":"), sort_keys=True) + "\n")
    raise SystemExit(2)

sock = socket.fromfd(0, socket.AF_UNIX, socket.SOCK_STREAM)
pid, uid, gid = struct.unpack("3i", sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
if uid != EXPECTED_UID or gid <= 0 or pid <= 1:
    blocked("peer identity differs")
if os.path.realpath(f"/proc/{pid}/exe") != EXPECTED_EXE:
    blocked("peer executable differs")
argv = open(f"/proc/{pid}/cmdline", "rb").read().split(b"\0")
if len(argv) < 2 or argv[0] != b"/usr/bin/node" or argv[1] != EXPECTED_SCRIPT.encode():
    blocked("peer command differs")
def parent_of(value):
    for line in open(f"/proc/{value}/status", encoding="utf8"):
        if line.startswith("PPid:"):
            return int(line.split()[1])
    blocked("peer ancestry unavailable")

session_pid = parent_of(pid)
if os.path.realpath(f"/proc/{session_pid}/exe") != "/usr/sbin/sshd":
    blocked("peer SSH ancestor executable differs")
session_argv = open(f"/proc/{session_pid}/cmdline", "rb").read().rstrip(b"\0").split(b"\0")
if session_argv != [b"sshd: williamos-fabric@notty"]:
    blocked("peer SSH ancestor command differs")
inodes = set()
for name in os.listdir(f"/proc/{session_pid}/fd"):
    try:
        target = os.readlink(f"/proc/{session_pid}/fd/{name}")
    except FileNotFoundError:
        continue
    if target.startswith("socket:[") and target.endswith("]"):
        inodes.add(target[8:-1])
def ipv4(value):
    raw = bytes.fromhex(value)
    return ".".join(str(part) for part in raw[::-1])
matched = False
for table in ("/proc/net/tcp", "/proc/net/tcp6"):
    for line in open(table, encoding="ascii").read().splitlines()[1:]:
        fields = line.split()
        if len(fields) < 10 or fields[9] not in inodes or fields[3] != "01":
            continue
        local_hex, local_port = fields[1].split(":")
        remote_hex, remote_port = fields[2].split(":")
        if table.endswith("tcp") and ipv4(local_hex) == "192.168.88.6" and int(local_port, 16) == 22 and ipv4(remote_hex) == "192.168.88.9":
            matched = True
if not matched:
    blocked("peer SSH socket does not prove Hermes to AEGIS")
os.execve("/usr/bin/node", ["/usr/bin/node", "/usr/local/libexec/williamos-aegis-remote-dev-activation-host.mjs", "serve"], {
    "HOME": "/nonexistent", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C",
})
