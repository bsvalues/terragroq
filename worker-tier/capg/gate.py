"""CAPG — Command Approval Policy Gate.

A deterministic, auditable classifier that maps a shell command to a verdict of
DENY / ASK / ALLOW. It exists because Hermes' own approval classifier misclassifies
exfiltration and lateral-movement as ALLOW (Pilot-0 finding). Two design commitments:

  1. FAIL-CLOSED DEFAULT: anything not recognised as clearly-safe returns ASK, never ALLOW.
     (Hermes' defect was the opposite default.)
  2. EXPLAINABLE: every verdict names the rule + category that produced it, so decisions
     are auditable and testable.

This gate is advisory-to-strict policy for our execution framework — it is consulted BEFORE
a command runs (e.g. a Hermes pre-command hook) and its verdict overrides the model/runtime.
It is a heuristic over shell text, so it is deliberately conservative; the external cage
(host-enforced deny-egress) remains the backstop, not a substitute for this gate.
"""
from __future__ import annotations

import os
import re
import shlex
from dataclasses import dataclass, field
from enum import IntEnum

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "::", ""}

EGRESS_TOOLS = {"curl", "wget", "nc", "ncat", "netcat", "socat", "telnet", "ftp", "tftp"}
REMOTE_TOOLS = {"ssh", "scp", "sftp", "rsync", "telnet"}  # lateral movement vectors
SHELL_TOOLS = {"sh", "bash", "zsh", "dash", "ksh", "python", "python3", "perl", "ruby", "node"}

# Files/paths whose contents are sensitive (secrets, credentials, identity).
SENSITIVE_RE = re.compile(
    r"(/etc/shadow|/etc/passwd|/etc/sudoers|/etc/gshadow"
    r"|(^|/)\.ssh(/|\b)|id_rsa|id_ed25519|id_ecdsa|id_dsa"
    r"|\.pem\b|\.key\b|\.p12\b|\.pfx\b|\.netrc\b|/root/"
    r"|\.aws/credentials|\.git-credentials|\.env\b|credentials?\b|secret|token|password|api[_-]?key)",
    re.IGNORECASE,
)

# Dangerous recursive/force removal targets.
_RM_DANGER_TARGET = re.compile(r"(^|[\s'\"])(/|~|\$HOME|/etc|/usr|/var|/bin|/boot|/lib|/root|\*|\.\.)($|[\s/'\"])")


class Decision(IntEnum):
    ALLOW = 1
    ASK = 2
    DENY = 3


@dataclass
class Verdict:
    decision: Decision
    category: str
    reason: str
    rule: str

    def to_dict(self) -> dict:
        return {"decision": self.decision.name, "category": self.category,
                "reason": self.reason, "rule": self.rule}


@dataclass
class Segment:
    raw: str
    argv: list[str]

    @property
    def name(self) -> str:
        return os.path.basename(self.argv[0]) if self.argv else ""


@dataclass
class Command:
    """Parsed features of a shell command line, computed once for the rules to read."""
    raw: str
    segments: list[Segment] = field(default_factory=list)
    devtcp_hosts: list[str] = field(default_factory=list)

    @staticmethod
    def parse(raw: str) -> "Command":
        segs = _split_segments(raw)
        segments = []
        for s in segs:
            try:
                argv = shlex.split(s, posix=True)
            except ValueError:
                argv = s.split()
            segments.append(Segment(s.strip(), argv))
        devtcp = re.findall(r"/dev/tcp/([^/\s'\"]+)", raw)
        return Command(raw=raw, segments=segments, devtcp_hosts=devtcp)

    # ---- feature helpers -------------------------------------------------
    def names(self) -> list[str]:
        return [s.name for s in self.segments]

    def reads_sensitive(self) -> bool:
        return bool(SENSITIVE_RE.search(self.raw))

    def _hosts_for(self, tools: set[str]) -> list[str]:
        hosts = []
        for seg in self.segments:
            if seg.name not in tools:
                continue
            for tok in seg.argv[1:]:
                if tok.startswith("-"):
                    continue
                h = _host_of(tok)
                if h is not None:
                    hosts.append(h)
        return hosts

    def remote_hosts(self) -> list[str]:
        """Non-local hosts targeted by ssh/scp/rsync/etc. ssh's destination is the first non-option
        positional arg — a HOST even when it's a single label (`ssh myserver ...`), which the generic
        URL-style `_host_of` misses. scp/rsync/sftp carry the host in a `host:path` / `user@host:path`
        token."""
        hosts: list[str] = []
        # ssh-family options that consume the following token as a value (so it isn't the host)
        _val_opts = {"-p", "-i", "-o", "-l", "-F", "-b", "-c", "-m", "-w", "-W",
                     "-D", "-L", "-R", "-e", "-J", "-Q", "-S", "-B", "-P"}
        for seg in self.segments:
            if seg.name not in REMOTE_TOOLS:
                continue
            positional: list[str] = []
            skip = False
            for a in seg.argv[1:]:
                if skip:
                    skip = False
                    continue
                if a.startswith("-"):
                    if a in _val_opts:
                        skip = True
                    continue
                positional.append(a)
            if not positional:
                continue
            if seg.name in ("scp", "rsync", "sftp"):
                for a in positional:
                    if "://" in a:
                        continue
                    if ":" in a:                       # host:path or user@host:path
                        left = a.split(":", 1)[0]
                        if left:
                            hosts.append(left.split("@")[-1])
            else:  # ssh / telnet — the destination is the first positional
                dest = positional[0].split("@")[-1]
                dest = dest.split(":", 1)[0] if dest.count(":") == 1 else dest  # strip :port
                if dest:
                    hosts.append(dest)
        return [h for h in hosts if h and not _is_local(h)]

    def egress_external(self) -> list[str]:
        """Non-local hosts/URLs targeted by curl/wget/nc/etc."""
        return [h for h in self._hosts_for(EGRESS_TOOLS) if not _is_local(h)]

    def uploads_data(self) -> bool:
        for seg in self.segments:
            if seg.name not in ("curl", "wget"):
                continue
            joined = " ".join(seg.argv)
            if re.search(r"(^|\s)(-d|--data|--data-binary|--data-raw|--data-urlencode|-F|--form|-T|--upload-file)\b", joined):
                return True
            if re.search(r"(^|\s)-X\s*(POST|PUT|PATCH)\b", joined, re.IGNORECASE):
                return True
            if re.search(r"@\S", joined):  # -d @file / --data @-
                return True
        return False

    def pipes_into_egress(self) -> bool:
        """Local sensitive data read in one pipeline stage and piped OUT through a later
        egress/remote sink (a real multi-stage pipeline: `cat /etc/passwd | curl ...`)."""
        if len(self.segments) < 2:
            return False
        sink_tools = EGRESS_TOOLS | REMOTE_TOOLS
        saw_sensitive = False
        for seg in self.segments:
            if saw_sensitive and seg.name in sink_tools:
                return True
            if SENSITIVE_RE.search(seg.raw):
                saw_sensitive = True
        return False

    def raw_socket_external(self) -> bool:
        """A raw socket (nc/ncat/socat/telnet) opened to a non-local host, excluding listeners.
        Sending data to a bare external socket is an exfil / C2 vector."""
        for seg in self.segments:
            if seg.name not in ("nc", "ncat", "netcat", "socat", "telnet"):
                continue
            if any(a == "-l" or a.startswith("-l") or a in ("--listen",) for a in seg.argv[1:]):
                continue  # a listener, not an outbound socket
            for tok in seg.argv[1:]:
                if tok.startswith("-"):
                    continue
                h = _host_of(tok)
                if h is not None and not _is_local(h):
                    return True
        return False

    def remote_reads_sensitive(self) -> bool:
        """ssh/rsync/scp to a remote host that touches a sensitive path (e.g. `ssh h cat /root/x`)."""
        if not self.remote_hosts():
            return False
        return self.reads_sensitive()


# ---- parsing helpers -----------------------------------------------------

def _split_segments(raw: str) -> list[str]:
    """Split on unquoted shell control operators (| || && ; & newline), respecting quotes."""
    segs, buf, i, n, quote = [], "", 0, len(raw), None
    while i < n:
        c = raw[i]
        if quote:
            buf += c
            if c == quote:
                quote = None
            i += 1
            continue
        if c in ('"', "'"):
            quote = c
            buf += c
            i += 1
            continue
        if raw[i:i + 2] in ("||", "&&"):
            segs.append(buf)
            buf = ""
            i += 2
            continue
        if c in ("|", ";", "&", "\n"):
            segs.append(buf)
            buf = ""
            i += 1
            continue
        buf += c
        i += 1
    segs.append(buf)
    return [s for s in segs if s.strip()]


def _host_of(token: str) -> str | None:
    """Extract a hostname from a curl/ssh/scp-style argument, or None if it isn't a host ref."""
    t = token.strip()
    m = re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://([^/:\s]+)", t)  # scheme://host/...
    if m:
        return m.group(1).split("@")[-1]
    if "://" in t:
        return None
    if ":" in t and not t.startswith("-"):        # scp/rsync  user@host:path  or host:path
        left = t.split(":", 1)[0]
        if left and "/" not in left and "." not in left[:1]:
            return left.split("@")[-1]
    if "@" in t and "/" not in t:                 # ssh user@host
        return t.split("@")[-1]
    if re.match(r"^[a-zA-Z0-9.\-]+$", t) and ("." in t or t.lower() in _KNOWN_HOSTS):
        return t                                   # bare hostname/IP or known lab node
    return None


_KNOWN_HOSTS = {"localhost", "atlas", "aegis", "forge", "hermes", "cockpit", "omen"}


def _is_local(host: str) -> bool:
    h = (host or "").lower()
    return h in LOCAL_HOSTS or h.startswith("127.")


# ---- rule engine ---------------------------------------------------------

@dataclass
class Rule:
    name: str
    category: str
    decision: Decision
    reason: str
    pred: object  # Callable[[Command], bool]


def classify(command: str, rules: list[Rule] | None = None) -> Verdict:
    """Return the most severe matching verdict; default ASK (fail-closed) if nothing matches."""
    from .rules import DEFAULT_RULES
    rules = rules if rules is not None else DEFAULT_RULES
    cmd = Command.parse(command)
    matches = []
    errored = False
    for r in rules:
        try:
            if r.pred(cmd):
                matches.append(r)
        except Exception:  # noqa: BLE001 - a rule bug must never crash the gate...
            errored = True  # ...but a rule we could NOT evaluate must never yield ALLOW (fail-closed)
    if not matches:
        if errored:
            return Verdict(Decision.ASK, "rule-error",
                           "a policy rule failed to evaluate; requires approval (fail-closed)", "rule-error")
        return Verdict(Decision.ASK, "unrecognized",
                       "command not recognised as clearly-safe; requires approval (fail-closed default)",
                       "default-ask")
    best = max(matches, key=lambda r: (int(r.decision), -rules.index(r)))
    if errored and best.decision < Decision.ASK:
        # some rule threw; the surviving matches only justify ALLOW — do not allow on partial evaluation
        return Verdict(Decision.ASK, "rule-error",
                       "a policy rule failed to evaluate; not eligible for ALLOW (fail-closed)", "rule-error")
    return Verdict(best.decision, best.category, best.reason, best.name)
