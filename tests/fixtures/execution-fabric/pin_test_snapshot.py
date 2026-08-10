#!/usr/bin/env python3
"""Create canonical test snapshots with the production RFC 8785 dependency."""
import hashlib, json, os, sys, rfc8785

feed_path, snapshot_root = sys.argv[1:3]
with open(feed_path, encoding="utf-8") as handle:
    feed = json.load(handle)
unsigned = dict(feed)
unsigned.pop("snapshot_sha256", None)
digest = hashlib.sha256(rfc8785.dumps(unsigned)).hexdigest()
feed["snapshot_sha256"] = digest
node = feed["node"]
directory = os.path.join(snapshot_root, node)
os.makedirs(directory, exist_ok=True)
with open(os.path.join(directory, digest + ".json"), "w", encoding="utf-8", newline="\n") as handle:
    json.dump(feed, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
print(digest)
