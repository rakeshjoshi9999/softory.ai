#!/usr/bin/env sh
# Runs oasdiff (Apache-2.0, https://github.com/oasdiff/oasdiff) at a pinned version.
# Built from the Go module proxy on first use and cached by Go; needs a Go toolchain on PATH.
set -eu
command -v go >/dev/null 2>&1 || { echo "oasdiff: Go is required (https://go.dev/dl/)" >&2; exit 127; }
exec go run github.com/oasdiff/oasdiff@v1.32.1 "$@"
