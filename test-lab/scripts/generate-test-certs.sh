#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
mkdir -p certs/generated
TEST_LAB_CERT_DIR="$(pwd)/certs/generated" go run ./cmd/certgen
printf '%s\n' "Generated local-only certificates in $(pwd)/certs/generated"
