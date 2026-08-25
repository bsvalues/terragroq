#!/bin/sh
# Install the current store's Ollama manifests into the FORGE archive WITHOUT deleting the archive.
#
# This exists as its own file, invoked over ssh by `sync-models-to-forge.ps1`, for one reason: the
# thing it replaced was a single remote line --
#
#     sudo rm -rf $remote/models/manifests && sudo mv /tmp/manifests-sync $remote/models/manifests
#
# -- which deleted every manifest FORGE held and installed only the ones the current store knows
# about. Blob sync is additive by design, so every blob from every store this archive ever held
# survived while the metadata naming which blobs compose which model did not. ATLAS holds twelve
# container-era blobs and three manifests from the green runs through 2026-08-23; the first repaired
# run under that line would have orphaned all twelve, and the by-name completion check verified blobs
# only, so it would have logged OK. A blob without its manifest is unusable for restore -- the
# comment above that line said so, and the line beneath it manufactured exactly that condition.
#
# Split out here so it can be executed and tested directly rather than only reasoned about in a
# quoted one-liner: see `tests/lab-control-forge-manifest-install.test.ts`, which runs THIS FILE.
#
# Contract:
#   - Nothing under $DEST is ever removed. New manifests are added; existing paths not present in the
#     staged tree are left exactly as they are.
#   - A manifest the staged tree would overwrite with DIFFERENT bytes is copied aside to $HIST first,
#     so the superseded metadata survives even when a tag is re-pointed.
#   - The only thing deleted is $STAGE, this run's own staging tree under /tmp.
#   - The staged layout is asserted before anything is installed. `scp -r src dest` nests when `dest`
#     already exists, and a nested tree installs manifests one level too deep at a path no restore
#     would look at -- silently, since blob verification cannot see it.
#
# usage: install-forge-manifests.sh <STAGE> <DEST> <HIST>          (SUDO= to run unprivileged)
set -eu

STAGE="${1:?STAGE required}"
DEST="${2:?DEST required}"
HIST="${3:?HIST required}"
SUDO="${SUDO-sudo}"

if [ ! -d "$STAGE/manifests" ]; then
  echo "STAGING_LAYOUT_UNEXPECTED: $STAGE/manifests is not a directory; refusing to install an unverified layout" >&2
  exit 3
fi

$SUDO mkdir -p "$DEST"

# Copy aside anything this run would overwrite with different bytes, BEFORE any of it is overwritten.
superseded=0
cd "$STAGE/manifests"
for f in $(find . -type f | sed 's|^\./||'); do
  old="$DEST/$f"
  if [ -f "$old" ] && ! $SUDO cmp -s "$f" "$old"; then
    $SUDO mkdir -p "$HIST/$(dirname "$f")"
    $SUDO cp -p "$old" "$HIST/$f"
    superseded=$((superseded + 1))
    echo "superseded $f"
  fi
done

# Overlay. `cp -a src/. dest/` adds and replaces; it does not remove what dest already holds.
$SUDO cp -a "$STAGE/manifests/." "$DEST/"

cd /
rm -rf "$STAGE"

echo "installed superseded=$superseded dest=$DEST"
