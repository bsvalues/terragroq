"""The default CAPG rule set (ordered, auditable).

Severity aggregation is handled by the engine (most-severe match wins; no match -> ASK).
Each rule is a small, readable predicate over parsed Command features so the policy is
reviewable line-by-line. Categories: destructive, exfiltration, lateral-movement,
remote-exec, secret-access, privilege, mutate-system, network-egress, safe-read.
"""
from __future__ import annotations

import re

from .gate import Command, Decision, Rule

# ---------- DENY: destructive ----------

_DD_DISK = re.compile(r"\bdd\b[^\n;|]*\bof=/dev/(sd|nvme|vd|hd|xvd|mmcblk|disk|loop)", re.IGNORECASE)
_MKFS = re.compile(r"\b(mkfs\S*|wipefs|blkdiscard|fdisk|parted)\b[^\n]*\b/dev/", re.IGNORECASE)
_SHRED_DEV = re.compile(r"\bshred\b[^\n]*\b/dev/", re.IGNORECASE)
_REDIR_DISK = re.compile(r">\s*/dev/(sd|nvme|vd|hd|xvd|mmcblk)", re.IGNORECASE)
_FORKBOMB = re.compile(r":\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:")
_CHMOD_ROOT = re.compile(r"\b(chmod|chown)\b[^\n]*\s-\w*R\w*\s[^\n]*\s(/|/etc|/usr|/bin|/boot)(\s|$)", re.IGNORECASE)


def _rm_rf_danger(c: Command) -> bool:
    from .gate import _RM_DANGER_TARGET
    for seg in c.segments:
        # match `rm` anywhere in the argv, not only argv[0], so wrappers like
        # `sudo rm -rf /`, `env X=1 rm -rf /`, `nice rm -rf ~`, `xargs rm -rf` are caught too.
        if "rm" not in seg.argv:
            continue
        flag_tokens = [t for t in seg.argv if t.startswith("-")]
        flags = "".join(flag_tokens).lower()
        recursive = ("r" in flags) or ("--recursive" in seg.argv)
        force = ("f" in flags) or ("--force" in seg.argv)
        if recursive and force and _RM_DANGER_TARGET.search(seg.raw):
            return True
    return False


# ---------- DENY: exfiltration ----------

def _exfil(c: Command) -> bool:
    # (a) curl/wget uploading data to an external host
    if c.egress_external() and c.uploads_data():
        return True
    # (b) any pipeline that reads a sensitive source and sinks into an egress/remote tool
    if c.pipes_into_egress():
        return True
    # (c) redirect of data to /dev/tcp on a non-local host
    if any(not _dev_local(h) for h in c.devtcp_hosts):
        return True
    # (d) a raw outbound socket to an external host (nc/ncat/socat/telnet) — exfil / C2 vector
    if c.raw_socket_external():
        return True
    return False


def _dev_local(host: str) -> bool:
    from .gate import _is_local
    return _is_local(host)


# ---------- DENY: lateral movement touching secrets ----------

def _lateral_secret(c: Command) -> bool:
    return c.remote_reads_sensitive()


# ---------- ASK: lateral movement (general) ----------

def _lateral_general(c: Command) -> bool:
    return bool(c.remote_hosts())


# ---------- ASK: remote-code-exec (curl|sh) ----------

def _curl_pipe_shell(c: Command) -> bool:
    names = c.names()
    has_fetch = any(n in ("curl", "wget") for n in names)
    has_shell = any(n in ("sh", "bash", "zsh", "dash", "ksh") for n in names)
    return has_fetch and has_shell and c.egress_external() != []


# ---------- ASK: local secret access (read only, no egress) ----------

def _secret_local(c: Command) -> bool:
    return c.reads_sensitive() and not c.egress_external() and not c.remote_hosts() and not c.devtcp_hosts


# ---------- ASK: privilege / force-push / mutate-system / plain egress ----------

def _force_push(c: Command) -> bool:
    for seg in c.segments:
        if seg.name == "git" and "push" in seg.argv:
            if "--force" in seg.argv or "-f" in seg.argv or any(a.startswith("--force") for a in seg.argv):
                return True
    return False


def _privilege(c: Command) -> bool:
    return any(n in ("sudo", "su", "doas", "pkexec") for n in c.names())


_PKG = re.compile(r"\b(apt|apt-get|yum|dnf|pacman|apk|brew|pip|pip3|npm|yarn|pnpm|gem|cargo|go)\b[^\n]*\b(install|add|-S|-U|get)\b", re.IGNORECASE)
_SVC = re.compile(r"\b(systemctl|service|launchctl)\b[^\n]*\b(start|stop|restart|enable|disable|mask)\b", re.IGNORECASE)
_WRITE_SYS = re.compile(r"(>|>>|\btee\b[^\n]*)\s*/(etc|usr|bin|boot|lib|sbin)/", re.IGNORECASE)


def _plain_egress(c: Command) -> bool:
    # external network access without matching a stricter rule -> still needs approval
    return bool(c.egress_external()) or bool(c.devtcp_hosts)


# ---------- ALLOW: clearly-safe read-only ----------

# Read-only, non-mutating, non-executing utilities only. Deliberately EXCLUDES:
#   find  (-exec/-delete run/mutate), sed (-i mutates), awk (system()/print-to-file execute),
#   env   (runs the command that follows it), python/python3/pytest (execute arbitrary code).
# Those fall through to the fail-closed ASK default rather than being blanket-allowed.
_SAFE = {"ls", "pwd", "whoami", "id", "echo", "printf", "date", "uname", "hostname",
         "cat", "head", "tail", "grep", "egrep", "fgrep", "wc", "file", "stat",
         "diff", "cut", "sort", "uniq", "tr", "which", "type", "printenv",
         "true", "false", "test", "basename", "dirname", "realpath", "readlink", "tree", "du", "df"}
_SAFE_GIT = {"status", "diff", "log", "show", "branch", "remote", "rev-parse", "describe", "config"}


def _safe_read(c: Command) -> bool:
    if not c.segments:
        return False
    if c.reads_sensitive() or c.egress_external() or c.remote_hosts() or c.devtcp_hosts:
        return False
    if _WRITE_SYS.search(c.raw) or _REDIR_DISK.search(c.raw):
        return False
    # a genuinely read-only command neither redirects output nor runs command substitution;
    # an allowlisted NAME is not enough — args carrying `>`, `` ` `` or `$( )` are not safe-read.
    if ">" in c.raw or "`" in c.raw or "$(" in c.raw:
        return False
    for seg in c.segments:
        n = seg.name
        if n in _SAFE:
            continue
        if n == "git" and len(seg.argv) > 1 and seg.argv[1] in _SAFE_GIT:
            continue
        return False
    return True


DEFAULT_RULES: list[Rule] = [
    # DENY — destructive
    Rule("destructive-rm", "destructive", Decision.DENY, "recursive+force removal of a critical path", _rm_rf_danger),
    Rule("disk-destroy", "destructive", Decision.DENY, "writes/formats a raw block device",
         lambda c: bool(_DD_DISK.search(c.raw) or _MKFS.search(c.raw) or _SHRED_DEV.search(c.raw) or _REDIR_DISK.search(c.raw))),
    Rule("fork-bomb", "destructive", Decision.DENY, "fork bomb", lambda c: bool(_FORKBOMB.search(c.raw))),
    Rule("chmod-root", "destructive", Decision.DENY, "recursive perm/owner change on a system root", lambda c: bool(_CHMOD_ROOT.search(c.raw))),
    # DENY — exfiltration & lateral-with-secrets
    Rule("exfiltration", "exfiltration", Decision.DENY, "sends local/sensitive data to an external destination", _exfil),
    Rule("lateral-secret", "lateral-movement", Decision.DENY, "remote host access that reads/copies sensitive data", _lateral_secret),
    # ASK — lateral / remote-exec / secrets / privilege / mutations / egress
    Rule("lateral-movement", "lateral-movement", Decision.ASK, "connects to another host (ssh/scp/rsync)", _lateral_general),
    Rule("remote-code-exec", "remote-exec", Decision.ASK, "pipes remotely-fetched content into a shell", _curl_pipe_shell),
    Rule("secret-access", "secret-access", Decision.ASK, "reads sensitive/credential material", _secret_local),
    Rule("privilege", "privilege", Decision.ASK, "privilege escalation", _privilege),
    Rule("force-push", "mutate-remote", Decision.ASK, "force push rewrites remote history", _force_push),
    Rule("pkg-install", "mutate-system", Decision.ASK, "installs packages", lambda c: bool(_PKG.search(c.raw))),
    Rule("service-control", "mutate-system", Decision.ASK, "changes system services", lambda c: bool(_SVC.search(c.raw))),
    Rule("write-system", "mutate-system", Decision.ASK, "writes to a system path", lambda c: bool(_WRITE_SYS.search(c.raw))),
    Rule("network-egress", "network-egress", Decision.ASK, "external network access", _plain_egress),
    # ALLOW — clearly-safe read-only
    Rule("safe-read", "safe-read", Decision.ALLOW, "read-only, local, non-sensitive", _safe_read),
]
