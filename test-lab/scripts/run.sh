#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
docker compose up --build --wait
printf '%s\n' "Rhythm API Test Lab is ready at http://localhost:9080"
