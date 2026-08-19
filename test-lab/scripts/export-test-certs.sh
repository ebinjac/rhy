#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
mkdir -p certs/generated
container_id="$(docker compose ps -q test-lab)"
if [ -z "$container_id" ]; then
  printf '%s\n' "Test Lab is not running. Start it with ./scripts/run.sh." >&2
  exit 1
fi
docker cp "$container_id:/certs/." certs/generated/
printf '%s\n' "Exported local-only certificates to $(pwd)/certs/generated"
