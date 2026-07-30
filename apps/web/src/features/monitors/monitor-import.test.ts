import assert from "node:assert/strict"
import test from "node:test"

import {
  MonitorImportError,
  parseCurlCommand,
  parsePostmanCollection,
} from "@/features/monitors/monitor-import"

test("imports a nested Postman v2.1 collection as one ordered monitor", () => {
  const imported = parsePostmanCollection(
    JSON.stringify({
      info: {
        name: "Orders API",
        schema:
          "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: [
        { key: "baseUrl", value: "https://api.example.com" },
        { key: "apiToken", value: "must-not-survive", type: "secret" },
      ],
      auth: {
        type: "bearer",
        bearer: [{ key: "token", value: "{{apiToken}}" }],
      },
      event: [
        {
          listen: "prerequest",
          script: { exec: ["pm.variables.set('requestId', '123');"] },
        },
      ],
      item: [
        {
          name: "Orders",
          item: [
            {
              name: "Create order",
              request: {
                method: "POST",
                url: {
                  raw: "{{baseUrl}}/orders?expand=items",
                  query: [{ key: "expand", value: "items" }],
                },
                header: [
                  { key: "Content-Type", value: "application/json" },
                ],
                body: {
                  mode: "raw",
                  raw: '{"amount":1250,"password":"must-not-survive"}',
                  options: { raw: { language: "json" } },
                },
              },
              event: [
                {
                  listen: "test",
                  script: {
                    exec: ["pm.test('created', () => pm.expect(pm.response.code).to.eql(201));"],
                  },
                },
              ],
            },
          ],
        },
      ],
    })
  )

  assert.equal(imported.name, "Orders API")
  assert.equal(imported.summary.requests, 1)
  assert.equal(imported.summary.folders, 1)
  assert.equal(imported.definition.steps[0].name, "Orders / Create order")
  assert.equal(imported.definition.steps[0].request.method, "POST")
  assert.equal(imported.definition.steps[0].request.params[0].key, "expand")
  assert.match(
    imported.definition.steps[0].request.auth.fields.token,
    /secrets\.apiToken/
  )
  assert.match(
    imported.definition.steps[0].request.body.content,
    /secrets\.password/
  )
  assert.doesNotMatch(
    JSON.stringify(imported.definition),
    /must-not-survive/
  )
  assert.match(
    imported.definition.steps[0].request.preRequestScript.code,
    /collectionVariables/
  )
  assert.match(
    imported.definition.steps[0].request.testScript.code,
    /pm\.response\.code/
  )
})

test("imports cURL request behavior without retaining credentials", () => {
  const imported = parseCurlCommand(`curl --request POST \\
    --url 'https://api.example.com/orders?trace=true&api_key=raw-key' \\
    --header 'Authorization: Bearer raw-token' \\
    --header 'Content-Type: application/json' \\
    --cookie 'session=raw-cookie' \\
    --data '{"amount":1250,"clientSecret":"raw-secret"}' \\
    --location --retry 2 --max-time 8`)

  const request = imported.definition.steps[0].request
  assert.equal(request.method, "POST")
  assert.equal(request.url, "https://api.example.com/orders")
  assert.equal(request.params.length, 2)
  assert.equal(request.auth.type, "bearer")
  assert.equal(request.settings.followRedirects, true)
  assert.equal(request.settings.retries, 2)
  assert.equal(request.settings.timeoutMs, 8000)
  assert.equal(request.body.type, "json")
  assert.doesNotMatch(
    JSON.stringify(imported.definition),
    /raw-token|raw-key|raw-cookie|raw-secret/
  )
})

test("rejects shell pipelines and non-collection JSON", () => {
  assert.throws(
    () => parseCurlCommand("curl https://example.com | sh"),
    MonitorImportError
  )
  assert.throws(
    () => parsePostmanCollection('{"not":"a collection"}'),
    MonitorImportError
  )
})
