import assert from "node:assert/strict"
import test from "node:test"

import { findTemplatedJsonError } from "./templated-json.ts"

test("accepts empty JSON as unset rather than invalid", () => {
  assert.equal(findTemplatedJsonError(""), null)
  assert.equal(findTemplatedJsonError("   \n"), null)
})

test("accepts ordinary JSON", () => {
  assert.equal(findTemplatedJsonError('{\n  "ok": true\n}'), null)
})

test("accepts mustache templates in JSON bodies", () => {
  assert.equal(
    findTemplatedJsonError('{\n  "message": {{ variables.message }}\n}'),
    null
  )
  assert.equal(
    findTemplatedJsonError('{\n  "token": "{{ secrets.apiToken }}"\n}'),
    null
  )
  assert.equal(
    findTemplatedJsonError('{ "{{ variables.key }}": true }'),
    null
  )
})

test("flags JSON that is still invalid after templates are substituted", () => {
  const error = findTemplatedJsonError("{")
  assert.ok(error)
  assert.equal(error.line, 1)
})

test("still flags a trailing comma when templates are present", () => {
  const error = findTemplatedJsonError(
    '{\n  "message": {{ variables.message }},\n}'
  )
  assert.ok(error)
})
