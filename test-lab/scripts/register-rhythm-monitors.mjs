#!/usr/bin/env node

const rhythmURL = (process.env.RHYTHM_API_URL ?? "http://localhost:3100").replace(/\/$/, "")
const targetURL = (process.env.TEST_LAB_TARGET_URL ?? "http://host.docker.internal:9080").replace(/\/$/, "")
const runAfterCreate = process.argv.includes("--run")

function assertion(type, expected, expression = "", operator = "") {
  return { enabled: true, type, expression, expected, ...(operator ? { operator } : {}) }
}

function extractor(source, variable, expression, sensitive = false) {
  return { enabled: true, source, variable, expression, sensitive }
}

function step(id, name, method, path, options = {}) {
  return {
    id,
    name,
    type: "HTTP_REQUEST",
    enabled: true,
    timeoutMs: options.timeoutMs ?? 5000,
    request: {
      method,
      url: `${targetURL}${path}`,
      params: options.params ?? [],
      headers: options.headers ?? [],
      cookies: options.cookies ?? [],
      persistCookies: options.persistCookies ?? false,
      auth: options.auth ?? { type: "none", fields: {} },
      body: options.body ?? { type: "none", content: "" },
      preRequest: options.preRequest ?? [],
      ...(options.preRequestScript
        ? {
            preRequestScript: {
              enabled: true,
              language: "javascript",
              runtimeVersion: "rhythm-js-1",
              code: options.preRequestScript,
            },
          }
        : {}),
      extractors: options.extractors ?? [],
      assertions: options.assertions ?? [assertion("status", "200")],
      settings: {
        followRedirects: options.followRedirects ?? true,
        maxRedirects: options.maxRedirects ?? 10,
        compression: true,
        timeoutMs: options.timeoutMs ?? 5000,
        captureBody: true,
        maxBodyBytes: options.maxBodyBytes ?? 65536,
        retries: options.retries ?? 0,
        retryBackoff: options.retryBackoff ?? "100ms",
      },
      tls: { minimumVersion: "TLS1.2" },
      proxy: { mode: "none" },
    },
    actions: [],
  }
}

const hmacScript = String.raw`
const clientId = "rhythm-client";
const timestamp = Date.now().toString();
const signature = CryptoJS.enc.Base64.stringify(
  CryptoJS.HmacSHA256(clientId + "-" + timestamp, "rhythm-hmac-secret")
);
pm.request.headers.upsert({key:"X-Client-ID", value:clientId});
pm.request.headers.upsert({key:"X-Timestamp", value:timestamp});
pm.request.headers.upsert({key:"X-Signature", value:signature});
pm.test("signature created", () => pm.expect(signature.length).to.be.above(20));`

const macScript = String.raw`
const key = "rhythm-mac-key";
const secret = "rhythm-mac-secret";
const ts = Date.now().toString();
const nonce = rhythm.random.string(36);
const url = new URL(pm.request.url.toString());
const payload = pm.request.body.raw;
const bodyHash = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(payload, secret));
const port = url.port || (url.protocol === "http:" ? "80" : "443");
const canonical = ts + "\n" + nonce + "\n" + pm.request.method + "\n" +
  url.pathname + url.search + "\n" + url.hostname + "\n" + port + "\n" + bodyHash + "\n";
const mac = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(canonical, secret));
pm.request.headers.upsert({
  key:"Authorization",
  value:'MAC id="' + key + '",ts="' + ts + '",nonce="' + nonce +
    '",bodyhash="' + bodyHash + '",mac="' + mac + '"'
});`

const tokenChainScript = `
const clientId = "rhythm-app-client";
const version = "2";
const timestamp = Date.now().toString();
const secret = CryptoJS.enc.Base64.parse("cmh5dGhtLWFwcC1zZWNyZXQ=");
let signature = CryptoJS.enc.Base64.stringify(
  CryptoJS.HmacSHA256(clientId + "-" + version + "-" + timestamp, secret)
);
signature = signature.replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
const response = await rhythm.sendRequest({
  url: ${JSON.stringify(targetURL + "/auth/application-token")},
  method: "POST",
  headers: {
    "Content-Type":"application/json",
    "X-Auth-AppID":clientId,
    "X-Auth-Version":version,
    "X-Auth-Timestamp":timestamp,
    "X-Auth-Signature":signature
  },
  body: {scope:["*"]}
});
pm.test("token dependency succeeded", () => pm.expect(response.statusCode).to.equal(200));
pm.request.headers.upsert({
  key:"Authorization",
  value:"Bearer " + response.json().authorization_token
});`

const dynamicBodyScript = String.raw`
pm.variables.set("transactionId", crypto.randomUUID());
pm.variables.set("transactionTimestamp", Date.now().toString());
pm.test("dynamic values created", () => {
  pm.expect(pm.variables.get("transactionId")).to.match(/^[0-9a-f-]{36}$/);
});`

const monitors = [
  {
    name: "API Test Lab — HTTP foundations",
    slug: "api-test-lab-http-foundations",
    description: "Health, request construction, query encoding, JSON and compression fixtures.",
    steps: [
      step("health", "Health is ready", "GET", "/health", {
        assertions: [assertion("status", "200"), assertion("jsonpath", "healthy", "$.status")],
      }),
      step("echo", "Request echo", "POST", "/api/echo?duplicate=one&duplicate=two&encoded=hello%20rhythm", {
        headers: [
          { enabled: true, key: "Content-Type", value: "application/json", sensitive: false },
          { enabled: true, key: "X-Test-Lab", value: "Rhythm", sensitive: false },
        ],
        body: { type: "json", content: '{"source":"rhythm","active":true}' },
        assertions: [assertion("status", "200"), assertion("jsonpath", "POST", "$.method")],
      }),
      step("deep-json", "Deep JSON response", "GET", "/response/json/deep", {
        assertions: [assertion("status", "200"), assertion("jsonpath", "2", "$.data.metrics.count")],
      }),
      step("gzip", "Gzip response", "GET", "/compression/gzip", {
        assertions: [assertion("status", "200"), assertion("jsonpath", "true", "$.compressed")],
      }),
      step("unicode", "Unicode response", "GET", "/response/unicode", {
        assertions: [assertion("status", "200"), assertion("jsonpath", "Rhythm", "$.english")],
      }),
    ],
  },
  {
    name: "API Test Lab — Authentication",
    slug: "api-test-lab-authentication",
    description: "Basic, Bearer, API key, HMAC, MAC and auxiliary token-chain authentication.",
    steps: [
      step("basic", "Basic authentication", "GET", "/auth/basic", {
        headers: [{ enabled: true, key: "Authorization", value: "Basic cmh5dGhtOnJoeXRobS10ZXN0", sensitive: true }],
        assertions: [assertion("status", "200"), assertion("jsonpath", "true", "$.authenticated")],
      }),
      step("bearer", "Bearer authentication", "GET", "/auth/bearer", {
        headers: [{ enabled: true, key: "Authorization", value: "Bearer rhythm-test-token", sensitive: true }],
        assertions: [assertion("status", "200"), assertion("jsonpath", "true", "$.authenticated")],
      }),
      step("api-key", "API key authentication", "GET", "/auth/api-key", {
        headers: [{ enabled: true, key: "X-API-Key", value: "rhythm-api-key", sensitive: true }],
        assertions: [assertion("status", "200"), assertion("jsonpath", "api-key", "$.type")],
      }),
      step("hmac", "HMAC SHA-256", "POST", "/auth/hmac", {
        headers: [{ enabled: true, key: "Content-Type", value: "application/json", sensitive: false }],
        body: { type: "json", content: '{"source":"rhythm"}' },
        preRequestScript: hmacScript,
        assertions: [assertion("status", "200"), assertion("jsonpath", "true", "$.signatureValid")],
      }),
      step("mac", "MAC canonical request", "POST", "/auth/mac?source=rhythm", {
        headers: [{ enabled: true, key: "Content-Type", value: "application/json", sensitive: false }],
        body: { type: "json", content: '{"amount":10}' },
        preRequestScript: macScript,
        assertions: [assertion("status", "200"), assertion("jsonpath", "true", "$.macValid")],
      }),
      step("token-chain", "Auxiliary token request", "GET", "/protected/keysets", {
        preRequestScript: tokenChainScript,
        assertions: [assertion("status", "200"), assertion("body-contains", "TEST_KEYSET_01")],
      }),
    ],
  },
  {
    name: "API Test Lab — Cookies and workflows",
    slug: "api-test-lab-cookies-workflows",
    description: "Run-local cookie persistence and extracted multi-step workflow state.",
    steps: [
      step("login", "Create cookie session", "POST", "/cookies/login", {
        persistCookies: true,
        headers: [{ enabled: true, key: "Content-Type", value: "application/json", sensitive: false }],
        body: { type: "json", content: '{"username":"rhythm","password":"rhythm-test"}' },
        assertions: [assertion("status", "200"), assertion("jsonpath", "true", "$.authenticated")],
      }),
      step("profile", "Reuse cookie session", "GET", "/cookies/profile", {
        persistCookies: true,
        assertions: [assertion("status", "200"), assertion("jsonpath", "rhythm", "$.username")],
      }),
      step("workflow-start", "Start workflow", "POST", "/workflow/start", {
        extractors: [
          extractor("jsonpath", "workflowId", "$.workflowId"),
          extractor("jsonpath", "workflowToken", "$.token", true),
        ],
        assertions: [assertion("status", "201")],
      }),
      step("workflow-step", "Advance workflow", "POST", "/workflow/{{workflowId}}/step", {
        preRequestScript: `pm.request.headers.upsert({key:"Authorization", value:"Bearer " + pm.variables.get("workflowToken")});`,
        assertions: [assertion("status", "202"), assertion("jsonpath", "accepted", "$.status")],
      }),
      step("workflow-result", "Verify workflow", "GET", "/workflow/{{workflowId}}/result", {
        assertions: [assertion("status", "200"), assertion("jsonpath", "completed", "$.status")],
      }),
    ],
  },
  {
    name: "API Test Lab — Extractors and checks",
    slug: "api-test-lab-extractors-checks",
    description: "JSONPath, header, cookie, regular-expression, XML and schema evidence.",
    steps: [
      step("json-extract", "JSONPath extraction", "GET", "/extract/json", {
        extractors: [extractor("jsonpath", "testUserId", "$.data.user.id"), extractor("jsonpath", "testToken", "$.data.token", true)],
        assertions: [assertion("status", "200"), assertion("jsonpath", "78291", "$.data.user.id")],
      }),
      step("header-extract", "Header extraction", "GET", "/extract/header", {
        extractors: [extractor("header", "testHeaderToken", "X-Test-Token", true)],
        assertions: [assertion("status", "200"), assertion("header", "header-extractor-token", "X-Test-Token")],
      }),
      step("cookie-extract", "Cookie extraction", "GET", "/extract/cookie", {
        extractors: [extractor("cookie", "fixtureCookie", "extractor_token", true)],
        assertions: [assertion("status", "200")],
      }),
      step("regex-extract", "Regex extraction", "GET", "/extract/regex", {
        extractors: [extractor("regex", "regexToken", "token=(regex-extractor-token)", true)],
        assertions: [assertion("status", "200"), assertion("body-contains", "token=regex-extractor-token")],
      }),
      step("xml", "XML response", "GET", "/extract/xml", {
        assertions: [assertion("status", "200"), assertion("body-contains", "xml-extractor-token")],
      }),
      step("schema", "JSON schema assertion", "GET", "/validation/schema", {
        assertions: [
          assertion("status", "200"),
          assertion("json-schema", "", JSON.stringify({ type: "object", required: ["id", "name", "active", "count"] })),
        ],
      }),
    ],
  },
  {
    name: "API Test Lab — Reliability and transport",
    slug: "api-test-lab-reliability-transport",
    description: "Redirects, latency, retry attempts, response headers and malformed payload evidence.",
    steps: [
      step("redirect", "Follow three redirects", "GET", "/redirect/3", {
        assertions: [assertion("status", "200"), assertion("jsonpath", "true", "$.final")],
      }),
      step("latency", "Controlled latency", "GET", "/delay-ms/150", {
        assertions: [assertion("status", "200"), assertion("jsonpath", "150", "$.delayMs")],
      }),
      step("retry", "Retry until success", "GET", "/unstable/3?clientId={{$uuid}}", {
        retries: 2,
        retryBackoff: "50ms",
        assertions: [assertion("status", "200"), assertion("jsonpath", "3", "$.attempt")],
      }),
      step("response-headers", "Response header evidence", "GET", "/response/headers", {
        assertions: [assertion("status", "200"), assertion("header", "DEV", "X-Test-Environment")],
      }),
      step("malformed", "Malformed JSON remains inspectable", "GET", "/response/malformed-json", {
        assertions: [assertion("status", "200"), assertion("body-contains", "broken")],
      }),
    ],
  },
  {
    name: "API Test Lab — Dynamic requests",
    slug: "api-test-lab-dynamic-requests",
    description: "Pre-request variables, dynamic JSON bodies, correlation IDs and generated nonces.",
    steps: [
      step("dynamic-body", "Build a dynamic request body", "POST", "/validate/dynamic-body", {
        headers: [{ enabled: true, key: "Content-Type", value: "application/json", sensitive: false }],
        body: { type: "json", content: '{"transactionId":"{{transactionId}}","timestamp":{{transactionTimestamp}},"environment":"DEV"}' },
        preRequestScript: dynamicBodyScript,
        assertions: [assertion("status", "200"), assertion("jsonpath", "true", "$.valid")],
      }),
      step("correlation", "Send a generated correlation ID", "GET", "/trace/correlation", {
        headers: [{ enabled: true, key: "X-Correlation-ID", value: "{{$uuid}}", sensitive: false }],
        assertions: [assertion("status", "200"), assertion("jsonpath", "", "$.correlationId", "exists")],
      }),
      step("nonce", "Send a generated nonce", "GET", "/trace/nonce", {
        headers: [{ enabled: true, key: "X-Nonce", value: "{{$uuid}}", sensitive: false }],
        assertions: [assertion("status", "200"), assertion("jsonpath", "true", "$.valid")],
      }),
      step("variables", "Render path and query variables", "GET", "/variables/DEV/78291?trace={{$uuid}}", {
        assertions: [assertion("status", "200"), assertion("jsonpath", "DEV", "$.environment"), assertion("jsonpath", "78291", "$.userId")],
      }),
    ],
  },
]

async function request(path, init = {}) {
  const response = await fetch(`${rhythmURL}${path}`, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(payload)}`)
  }
  return payload.data
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== "_rhythmCreation")
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  }
  return value
}

function definitionsMatch(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

const results = []
const existingMonitors = await request("/api/v1/monitors?limit=200")
const monitorBySlug = new Map(existingMonitors.map((monitor) => [monitor.slug, monitor]))
for (const fixture of monitors) {
  const definition = { schemaVersion: 2, steps: fixture.steps }
  let current = monitorBySlug.get(fixture.slug)
  let changed = true
  if (current) {
    if (current.latestPublishedRevisionId) {
      const revision = await request(
        `/api/v1/monitors/${encodeURIComponent(current.id)}/revisions/${encodeURIComponent(current.latestPublishedRevisionId)}`
      )
      changed = !definitionsMatch(revision.definition, definition)
    }
    if (changed) {
      const saved = await request(`/api/v1/monitors/${encodeURIComponent(current.id)}/draft`, {
        method: "PUT",
        body: JSON.stringify({ definition }),
      })
      current = saved.monitor
    }
  } else {
    current = await request("/api/v1/monitors", {
      method: "POST",
      headers: { "Idempotency-Key": `rhythm-${fixture.slug}-v2` },
      body: JSON.stringify({
        name: fixture.name,
        slug: fixture.slug,
        description: fixture.description,
        ownerId: "rhythm-test-lab",
        tags: ["test-lab", "local", "integration"],
        definition,
      }),
    })
  }

  if (changed || !current.latestPublishedRevisionId) {
    const published = await request(`/api/v1/monitors/${encodeURIComponent(current.id)}/publish`, {
      method: "POST",
      body: JSON.stringify({ changeSummary: "Synchronized from the local API Test Lab fixture bundle" }),
    })
    current = published.monitor
  }

  let run
  if (runAfterCreate) {
    const execution = await request(`/api/v1/monitors/${encodeURIComponent(current.id)}/runs?revision=published&wait=true`, {
      method: "POST",
      body: "{}",
    })
    run = execution.run
  }
  results.push({ id: current.id, name: current.name, state: current.state, runId: run?.id, runStatus: run?.status })
}

console.log(JSON.stringify({ rhythmURL, targetURL, monitors: results }, null, 2))
