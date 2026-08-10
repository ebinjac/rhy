import { env, uniqueSlug } from "./env.mjs"

export function targetURL(path = "/health") {
  const base = env.testTargetURL.replace(/\/$/, "")
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${base}${suffix}`
}

export function targetHTTPSURL(path = "/health") {
  const base = env.testTargetHTTPSURL.replace(/\/$/, "")
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${base}${suffix}`
}

/**
 * Minimal HTTP_REQUEST step.
 * @param {string} id
 * @param {string} url
 * @param {Partial<{ method: string, name: string, headers: any[], auth: any, extractors: any[], assertions: any[], testScript: any, preRequestScript: any, cookies: any[], persistCookies: boolean, tls: any, proxy: any, settings: any }>} [extra]
 */
export function httpStep(id, url, extra = {}) {
  const {
    method = "GET",
    name = id,
    headers = [],
    auth,
    extractors = [],
    assertions = [{ enabled: true, type: "status", expected: "200" }],
    testScript,
    preRequestScript,
    cookies,
    persistCookies,
    tls,
    proxy,
    settings = { timeoutMs: 8000 },
  } = extra
  return {
    id,
    name,
    type: "HTTP_REQUEST",
    enabled: true,
    timeoutMs: settings.timeoutMs || 8000,
    request: {
      method,
      url,
      headers,
      ...(auth ? { auth } : {}),
      ...(extractors.length ? { extractors } : {}),
      assertions,
      ...(testScript ? { testScript } : {}),
      ...(preRequestScript ? { preRequestScript } : {}),
      ...(cookies ? { cookies } : {}),
      ...(persistCookies !== undefined ? { persistCookies } : {}),
      ...(tls ? { tls } : {}),
      ...(proxy ? { proxy } : {}),
      settings,
    },
  }
}

/**
 * @param {string} namePrefix
 * @param {any[]} steps
 * @param {Partial<{ slug: string, description: string }>} [meta]
 */
export function monitorBody(namePrefix, steps, meta = {}) {
  const slug = meta.slug || uniqueSlug(namePrefix)
  return {
    name: meta.description || `${namePrefix} ${slug}`,
    slug,
    definition: {
      schemaVersion: 1,
      steps,
    },
  }
}

export function healthMonitorBody() {
  return monitorBody("scenario-health", [
    httpStep("health", targetURL("/health"), {
      name: "Health",
      assertions: [
        { enabled: true, type: "status", expected: "200" },
        {
          enabled: true,
          type: "jsonpath",
          expression: "$.ok",
          expected: "true",
        },
      ],
    }),
  ])
}

/**
 * Auth credential fields are resolved as secret aliases (profile names).
 * @param {string} usernameAlias
 * @param {string} passwordAlias
 */
export function basicAuthMonitorBody(usernameAlias, passwordAlias) {
  return monitorBody("scenario-basic-auth", [
    httpStep("basic", targetURL("/basic-auth"), {
      name: "Basic auth",
      auth: {
        type: "basic",
        fields: { username: usernameAlias, password: passwordAlias },
      },
    }),
  ])
}

/**
 * @param {string} tokenAlias
 */
export function bearerAuthMonitorBody(tokenAlias) {
  return monitorBody("scenario-bearer", [
    httpStep("bearer", targetURL("/bearer"), {
      name: "Bearer auth",
      auth: {
        type: "bearer",
        fields: { token: tokenAlias },
      },
    }),
  ])
}

/**
 * @param {string} secretAlias profile name used as {{secrets.alias}}
 */
export function secretHeaderMonitorBody(secretAlias) {
  return monitorBody("scenario-secrets", [
    httpStep("secret-header", targetURL("/echo"), {
      name: "Secret header",
      headers: [
        {
          enabled: true,
          key: "X-Scenario-Secret",
          value: `{{secrets.${secretAlias}}}`,
          sensitive: true,
        },
      ],
      assertions: [
        { enabled: true, type: "status", expected: "200" },
        {
          enabled: true,
          type: "jsonpath",
          expression: "$.headers.x-scenario-secret",
          expected: "scenario-secret-value",
        },
      ],
    }),
  ])
}

export function extractorsMonitorBody() {
  return monitorBody("scenario-extractors", [
    httpStep("fetch-json", targetURL("/json"), {
      name: "Fetch JSON",
      extractors: [
        {
          enabled: true,
          source: "jsonpath",
          variable: "orderId",
          expression: "$.orderId",
        },
        {
          enabled: true,
          source: "jsonpath",
          variable: "userName",
          expression: "$.user.name",
        },
      ],
      assertions: [{ enabled: true, type: "status", expected: "200" }],
    }),
    httpStep(
      "use-extract",
      targetURL("/echo") + "?orderId={{ steps.fetch-json.outputs.orderId }}",
      {
        name: "Use extractor",
        assertions: [
          { enabled: true, type: "status", expected: "200" },
          {
            enabled: true,
            type: "jsonpath",
            expression: "$.query.orderId",
            expected: "ORD-1001",
          },
        ],
      }
    ),
  ])
}

export function scriptsPassMonitorBody() {
  return monitorBody("scenario-scripts-pass", [
    httpStep("scripted", targetURL("/health"), {
      name: "Script pass",
      testScript: {
        enabled: true,
        language: "javascript",
        runtimeVersion: "rhythm-js-2",
        code: `pm.test("ok is true", () => {
  pm.expect(pm.response.json().ok).to.equal(true);
});`,
      },
    }),
  ])
}

export function scriptsFailMonitorBody() {
  return monitorBody("scenario-scripts-fail", [
    httpStep("scripted", targetURL("/health"), {
      name: "Script fail",
      testScript: {
        enabled: true,
        language: "javascript",
        runtimeVersion: "rhythm-js-2",
        code: `pm.test("intentional failure", () => {
  pm.expect(pm.response.json().ok).to.equal(false);
});`,
      },
    }),
  ])
}

export function cookiesMonitorBody() {
  return monitorBody("scenario-cookies", [
    httpStep("set", targetURL("/set-cookie"), {
      name: "Set cookie",
      persistCookies: true,
    }),
    httpStep("echo", targetURL("/cookie-echo"), {
      name: "Echo cookie",
      persistCookies: true,
      assertions: [
        { enabled: true, type: "status", expected: "200" },
        {
          enabled: true,
          type: "jsonpath",
          expression: "$.cookie",
          expected: "session=test-session",
        },
      ],
    }),
  ])
}

export function failingAssertionMonitorBody() {
  return monitorBody("scenario-alerts-fail", [
    httpStep("fail", targetURL("/health"), {
      name: "Fail assertion",
      assertions: [
        { enabled: true, type: "status", expected: "200" },
        {
          enabled: true,
          type: "jsonpath",
          expression: "$.ok",
          expected: "false",
        },
      ],
    }),
  ])
}

/**
 * @param {string} caProfileId
 */
export function certsMonitorBody(caProfileId) {
  return monitorBody("scenario-certs", [
    httpStep("tls", targetHTTPSURL("/health"), {
      name: "Custom CA HTTPS",
      tls: {
        caProfileId,
        minimumVersion: "TLS 1.2",
      },
      settings: { timeoutMs: 10_000 },
    }),
  ])
}

/**
 * @param {string} startUrl
 */
export function browserMonitorBody(startUrl) {
  const slug = uniqueSlug("scenario-browser")
  return {
    name: `scenario browser ${slug}`,
    slug,
    description: "scenario browser monitor",
    applicationId: "",
    serviceId: "",
    environmentProfileId: "",
    frequencySeconds: 300,
    enabled: false,
    definition: {
      schemaVersion: 1,
      startUrl,
      allowedOrigins: [new URL(startUrl).origin],
      profile: {
        browser: "chromium",
        viewportWidth: 1280,
        viewportHeight: 720,
        deviceScaleFactor: 1,
        isMobile: false,
        locale: "en-US",
        timezone: "UTC",
        colorScheme: "light",
        networkProfile: "NONE",
      },
      agent: {},
      steps: [
        {
          id: "navigate-home",
          name: "Open home",
          type: "NAVIGATE",
          enabled: true,
          url: startUrl,
          timeoutMs: 15000,
          waitUntil: "load",
          checks: [
            {
              id: "title-check",
              name: "Has heading text",
              kind: "TEXT",
              operator: "CONTAINS",
              expected: "Rhythm Test Target",
              gateMode: "BLOCKING",
              enabled: true,
            },
          ],
        },
      ],
      artifactPolicy: {
        successScreenshotHours: 24,
        failureEvidenceDays: 7,
        captureTraceOnFailure: false,
      },
      maskSelectors: [],
    },
  }
}
