#!/usr/bin/env node
/**
 * CI entry for scenario tests.
 * Does not start Docker Compose — document compose up separately.
 * Applies host-run defaults and executes node:test with concurrency 1.
 */
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

process.env.RHYTHM_API_URL ??= "http://localhost:18080"
process.env.RHYTHM_TEST_TARGET_URL ??= "http://host.docker.internal:18090"
process.env.RHYTHM_TEST_TARGET_HTTPS_URL ??= "https://host.docker.internal:18443"
process.env.RHYTHM_TEST_TARGET_PROBE_URL ??= "http://localhost:18090"
process.env.RHYTHM_TEST_TARGET_HTTPS_PROBE_URL ??= "https://localhost:18443"

const pattern = join(root, "tests/scenarios/**/*.test.mjs")
const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", pattern],
  { stdio: "inherit", cwd: root, env: process.env }
)

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
