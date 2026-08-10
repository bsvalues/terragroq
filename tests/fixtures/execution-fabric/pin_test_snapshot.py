#!/usr/bin/env python3
"""Create canonical test snapshots with the production RFC 8785 dependency."""
import hashlib, json, os, re, sys, rfc8785

if len(sys.argv) != 3:
    raise SystemExit("usage: pin_test_snapshot.py <feed.json> <snapshots_root>")
feed_path, snapshot_root = sys.argv[1:3]
with open(feed_path, encoding="utf-8") as handle:
    feed = json.load(handle)
unsigned = dict(feed)
unsigned.pop("snapshot_sha256", None)
digest = hashlib.sha256(rfc8785.dumps(unsigned)).hexdigest()
feed["snapshot_sha256"] = digest
node = feed["node"]
if not isinstance(node, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", node):
    raise SystemExit("feed node must match [a-z0-9][a-z0-9-]*")
resolved_root = os.path.realpath(snapshot_root)
directory = os.path.realpath(os.path.join(resolved_root, node))
if os.path.commonpath([resolved_root, directory]) != resolved_root:
    raise SystemExit("snapshot path escapes root")
os.makedirs(directory, exist_ok=True)
with open(os.path.join(directory, digest + ".json"), "w", encoding="utf-8", newline="\n") as handle:
    json.dump(feed, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
print(digest)
