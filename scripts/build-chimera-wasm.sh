#!/usr/bin/env bash
# Rebuild the vendored Chimera wasm and copy it into this repo.
#
# The binary at src/audio/vocal/chimera/chimera.wasm is checked in, so CI and
# GitHub Pages do not need Rust. Run this script only when bumping the engine.
#
# Pin: see src/audio/vocal/chimera/COMMIT (jamesondh/chimera-vocal-synth).
# Chimera uses Rust edition 2024 features; rustc 1.85.1 is not enough.
# rustc 1.100.0 is known to work.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${CHIMERA_SRC:-/tmp/chimera-vocal-synth}"
COMMIT="$(tr -d "[:space:]" < "$ROOT/src/audio/vocal/chimera/COMMIT")"

if [[ ! -d "$SRC/.git" ]]; then
  git clone --depth 1 https://github.com/jamesondh/chimera-vocal-synth.git "$SRC"
fi
git -C "$SRC" fetch --depth 1 origin "$COMMIT"
git -C "$SRC" checkout "$COMMIT"

# wasm32-unknown-unknown must be installed (rustup target add wasm32-unknown-unknown)
cargo build -p chimera-wasm --release --target wasm32-unknown-unknown --manifest-path "$SRC/Cargo.toml"
cp "$SRC/target/wasm32-unknown-unknown/release/chimera_wasm.wasm" \
  "$ROOT/src/audio/vocal/chimera/chimera.wasm"
echo "Wrote $ROOT/src/audio/vocal/chimera/chimera.wasm"
