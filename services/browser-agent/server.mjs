import http from "node:http"
import dns from "node:dns/promises"
import net from "node:net"
import { chromium } from "playwright"
import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"
import {
  createArtifactUploader,
  downloadArtifact,
} from "./artifact-transfer.mjs"

const host = process.env.RHYTHM_BROWSER_AGENT_ADDR || "0.0.0.0"
const port = Number(process.env.RHYTHM_BROWSER_AGENT_PORT || 8091)
const token =
  process.env.RHYTHM_BROWSER_AGENT_TOKEN ||
  process.env.RHYTHM_BROWSER_RUNNER_TOKEN ||
  "rhythm-local-browser-token"
const imageVersion =
  process.env.RHYTHM_BROWSER_AGENT_IMAGE_VERSION || "playwright-1.62.0"
const allowPrivateTargets =
  String(
    process.env.RHYTHM_BROWSER_ALLOW_PRIVATE_TARGETS ||
      process.env.RHYTHM_ALLOW_PRIVATE_TARGETS ||
      ""
  ).toLowerCase() === "true"
const maximumBodyBytes = 20 * 1024 * 1024
const maximumConcurrency = Math.max(
  1,
  Number(process.env.RHYTHM_BROWSER_MAX_CONCURRENCY || 2)
)
const chromiumSandbox =
  String(process.env.RHYTHM_CHROMIUM_SANDBOX || "true").toLowerCase() !==
  "false"
let activeExecutions = 0
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox,
  args: ["--disable-dev-shm-usage"],
})

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    return json(response, 200, {
      status: "ok",
      service: "rhythm-browser-agent",
      browser: "chromium",
      version: browser.version(),
      imageVersion,
    })
  }
  if (request.method !== "POST" || request.url !== "/v1/execute") {
    return json(response, 404, { error: "not found" })
  }
  if (!constantTimeEqual(request.headers.authorization || "", `Bearer ${token}`)) {
    return json(response, 401, { error: "browser agent credential is invalid" })
  }
  if (activeExecutions >= maximumConcurrency) {
    response.setHeader("Retry-After", "1")
    return json(response, 429, {
      error: "browser agent is at its configured capacity",
    })
  }
  activeExecutions++
  try {
    const input = await readJSON(request)
    const result = await execute(input)
    return json(response, 200, result)
  } catch (error) {
    return json(response, 422, {
      error: safeMessage(error),
    })
  } finally {
    activeExecutions--
  }
})

server.listen(port, host, () => {
  process.stdout.write(
    JSON.stringify({
      level: "info",
      message: "Rhythm browser agent listening",
      host,
      port,
      browserVersion: browser.version(),
      imageVersion,
    }) + "\n"
  )
})

async function execute(input) {
  validateInput(input)
  const definition = input.definition
  await validateTarget(render(definition.startUrl, input.variables), definition.allowedOrigins)

  const startedAt = new Date()
  const started = performance.now()
  const events = [
    event("BROWSER_CONTEXT_CREATING", "Creating an isolated Chromium context."),
  ]
  const consoleEvents = []
  const network = {
    requests: 0,
    responses: 0,
    failedRequests: 0,
    httpErrors: 0,
    transferredBytes: 0,
    byType: {},
    slowest: [],
    failures: [],
  }
  const capturedResponses = []
  const artifacts = []
  const artifactUploader = createArtifactUploader(input.artifactUploads)
  const visualEvidence = []
  const graphEvidence = []
  const steps = []
  let warningCount = 0
  let context
  let page

  try {
    context = await browser.newContext({
      viewport: {
        width: definition.profile.viewportWidth,
        height: definition.profile.viewportHeight,
      },
      deviceScaleFactor: definition.profile.deviceScaleFactor || 1,
      isMobile: Boolean(definition.profile.isMobile),
      locale: definition.profile.locale || "en-US",
      timezoneId: definition.profile.timezone || "UTC",
      colorScheme: definition.profile.colorScheme || "light",
      userAgent: definition.profile.userAgent || undefined,
      serviceWorkers: "block",
      ignoreHTTPSErrors: false,
      storageState: input.storageState
        ? JSON.parse(input.storageState)
        : undefined,
    })
    await context.addInitScript(performanceBootstrap)
    page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.setDefaultNavigationTimeout(30_000)

    page.on("console", (message) => {
      const type = message.type()
      if (!["error", "warning"].includes(type)) return
      consoleEvents.push({
        type,
        text: maskText(message.text(), input.sensitiveValues),
        url: safeURL(page.url()),
        occurredAt: new Date().toISOString(),
      })
    })
    page.on("pageerror", (error) => {
      consoleEvents.push({
        type: "pageerror",
        text: maskText(error.message, input.sensitiveValues),
        url: safeURL(page.url()),
        occurredAt: new Date().toISOString(),
      })
    })
    page.on("request", (browserRequest) => {
      network.requests++
      const resourceType = browserRequest.resourceType()
      network.byType[resourceType] = (network.byType[resourceType] || 0) + 1
    })
    page.on("requestfailed", (browserRequest) => {
      network.failedRequests++
      network.failures.push({
        method: browserRequest.method(),
        url: safeURL(browserRequest.url()),
        resourceType: browserRequest.resourceType(),
        error: browserRequest.failure()?.errorText || "Request failed",
      })
    })
    page.on("response", async (browserResponse) => {
      network.responses++
      if (browserResponse.status() >= 400) {
        network.httpErrors++
        network.failures.push({
          method: browserResponse.request().method(),
          url: safeURL(browserResponse.url()),
          resourceType: browserResponse.request().resourceType(),
          status: browserResponse.status(),
        })
      }
      const contentLength = Number(
        (await browserResponse.headerValue("content-length")) || 0
      )
      if (Number.isFinite(contentLength)) network.transferredBytes += contentLength
      const contentType =
        (await browserResponse.headerValue("content-type")) || ""
      if (
        contentType.includes("json") &&
        capturedResponses.length < 25 &&
        contentLength <= 2 * 1024 * 1024
      ) {
        try {
          capturedResponses.push({
            url: browserResponse.url(),
            status: browserResponse.status(),
            body: await browserResponse.json(),
          })
        } catch {
          // A response may claim JSON while carrying no body.
        }
      }
    })

    events.push(event("BROWSER_LAUNCHED", "Chromium is ready."))
    await page.goto(render(definition.startUrl, input.variables), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    })
    events.push(event("PAGE_READY", "The start page reached DOMContentLoaded."))

    for (let index = 0; index < definition.steps.length; index++) {
      const definitionStep = definition.steps[index]
      if (!definitionStep.enabled) continue
      const result = await executeStep({
        page,
        definitionStep,
        input,
        index,
        network,
        consoleEvents,
        capturedResponses,
        artifacts,
        artifactUploader,
        visualEvidence,
        graphEvidence,
      })
      steps.push(result)
      events.push(
        event(
          result.status === "SUCCESS" ? "STEP_COMPLETED" : "STEP_FAILED",
          result.status === "SUCCESS"
            ? `${definitionStep.name} completed.`
            : result.failureReason,
          definitionStep.id,
          result.failureCategory,
          result.durationMs
        )
      )
      warningCount += result.checkResults.filter(
        (check) => !check.passed && check.gateMode === "ADVISORY"
      ).length
      const blockingFailure =
        result.status !== "SUCCESS" ||
        result.checkResults.some(
          (check) => !check.passed && check.gateMode === "BLOCKING"
        )
      if (blockingFailure) {
        const finalArtifact = await captureArtifact(
          page,
          input,
          "FAILURE_SCREENSHOT",
          "failure-final",
          definition.maskSelectors || [],
          true,
          artifactUploader
        )
        if (finalArtifact) artifacts.push(finalArtifact.payload)
        return finish({
          status: "FAILED",
          started,
          steps,
          events,
          warningCount,
          failureCategory:
            result.failureCategory ||
            result.checkResults.find(
              (check) => !check.passed && check.gateMode === "BLOCKING"
            )?.kind ||
            "ASSERTION_FAILED",
          failureReason:
            result.failureReason ||
            result.checkResults.find(
              (check) => !check.passed && check.gateMode === "BLOCKING"
            )?.error ||
            "A blocking browser checkpoint failed.",
          failedStepId: definitionStep.id,
          page,
          network,
          consoleEvents,
          graphEvidence,
          visualEvidence,
          artifacts,
          artifactUploader,
          startedAt,
        })
      }
    }

    const finalArtifact = await captureArtifact(
      page,
      input,
      "SUCCESS_SCREENSHOT",
      "final",
      definition.maskSelectors || [],
      true,
      artifactUploader
    )
    if (finalArtifact) artifacts.push(finalArtifact.payload)
    return finish({
      status: warningCount ? "SUCCESS_WITH_WARNINGS" : "SUCCESS",
      started,
      steps,
      events,
      warningCount,
      page,
      network,
      consoleEvents,
      graphEvidence,
      visualEvidence,
      artifacts,
      artifactUploader,
      startedAt,
    })
  } catch (error) {
    const category = classifyError(error)
    if (page) {
      const finalArtifact = await captureArtifact(
        page,
        input,
        "FAILURE_SCREENSHOT",
        "failure-final",
        definition.maskSelectors || [],
        true,
        artifactUploader
      ).catch(() => null)
      if (finalArtifact) artifacts.push(finalArtifact.payload)
    }
    return finish({
      status: "FAILED",
      started,
      steps,
      events: [
        ...events,
        event("RUN_FAILED", safeMessage(error), "", category),
      ],
      warningCount,
      failureCategory: category,
      failureReason: safeMessage(error),
      failedStepId: steps.at(-1)?.stepDefinitionId || "",
      page,
      network,
      consoleEvents,
      graphEvidence,
      visualEvidence,
      artifacts,
      artifactUploader,
      startedAt,
    })
  } finally {
    if (context) await context.close().catch(() => {})
  }
}

async function executeStep({
  page,
  definitionStep: step,
  input,
  index,
  network,
  consoleEvents,
  capturedResponses,
  artifacts,
  artifactUploader,
  visualEvidence,
  graphEvidence,
}) {
  const startedAt = new Date()
  const started = performance.now()
  const timeout = Math.min(Math.max(Number(step.timeoutMs || 15_000), 100), 120_000)
  const locator = step.locator ? buildLocator(page, step.locator) : null
  const checkResults = []
  const locatorEvidence = step.locator
    ? {
        strategy: step.locator.strategy,
        value: step.sensitive ? "MASKED" : step.locator.value,
        name: step.locator.name,
      }
    : {}
  let failureCategory = ""
  let failureReason = ""

  try {
    switch (step.type) {
      case "NAVIGATE": {
        const target = render(step.url || step.value, input.variables)
        await validateTarget(target, input.definition.allowedOrigins)
        await page.goto(target, {
          waitUntil: step.waitUntil || "domcontentloaded",
          timeout,
        })
        break
      }
      case "RELOAD":
        await page.reload({ waitUntil: "domcontentloaded", timeout })
        break
      case "GO_BACK":
        await page.goBack({ waitUntil: "domcontentloaded", timeout })
        break
      case "GO_FORWARD":
        await page.goForward({ waitUntil: "domcontentloaded", timeout })
        break
      case "CLICK":
        await locator.click({ timeout })
        break
      case "DOUBLE_CLICK":
        await locator.dblclick({ timeout })
        break
      case "FILL":
        await locator.fill(render(step.value, input.variables), { timeout })
        break
      case "CLEAR":
        await locator.clear({ timeout })
        break
      case "SELECT":
        await locator.selectOption(render(step.value, input.variables), {
          timeout,
        })
        break
      case "CHECK":
        await locator.check({ timeout })
        break
      case "UNCHECK":
        await locator.uncheck({ timeout })
        break
      case "PRESS":
        await locator.press(step.key || step.value, { timeout })
        break
      case "HOVER":
        await locator.hover({ timeout })
        break
      case "FOCUS":
        await locator.focus({ timeout })
        break
      case "SCROLL":
        if (locator) await locator.scrollIntoViewIfNeeded({ timeout })
        else
          await page.evaluate((value) => window.scrollBy(0, Number(value) || 500), step.value)
        break
      case "WAIT":
        if (locator) await locator.waitFor({ state: "visible", timeout })
        else await page.waitForTimeout(Math.min(Number(step.value || 500), timeout))
        break
      case "EXTRACT":
      case "ASSERT":
      case "SCREENSHOT":
      case "GRAPH_CHECK":
        break
      default:
        throw new Error(`Unsupported browser step type ${step.type}.`)
    }

    for (const check of step.checks || []) {
      if (!check.enabled) continue
      checkResults.push(
        await evaluateCheck({
          page,
          check,
          input,
          network,
          consoleEvents,
        })
      )
    }

    if (step.graph) {
      const graphResult = await evaluateGraph({
        page,
        step,
        input,
        capturedResponses,
      })
      graphEvidence.push(graphResult.evidence)
      checkResults.push(graphResult.check)
    }

    if (step.screenshot) {
      const artifact = await captureArtifact(
        page,
        input,
        "CHECKPOINT_SCREENSHOT",
        step.screenshot.checkpointId || step.id,
        [
          ...(input.definition.maskSelectors || []),
          ...(step.screenshot.maskSelectors || []),
        ],
        Boolean(step.screenshot.fullPage),
        artifactUploader
      )
      if (artifact) {
        artifacts.push(artifact.payload)
        const baseline = (input.baselines || []).find(
          (item) =>
            item.checkpointId ===
            (step.screenshot.checkpointId || step.id)
        )
        if (baseline) {
          const comparison = comparePNGs(
            artifact.bytes,
            await downloadArtifact(baseline),
            Number(step.screenshot.diffThreshold || 0.01)
          )
          visualEvidence.push({
            checkpointId: step.screenshot.checkpointId || step.id,
            passed: comparison.passed,
            diffPixels: comparison.diffPixels,
            diffRatio: comparison.diffRatio,
            threshold: Number(step.screenshot.diffThreshold || 0.01),
            baselineFingerprint: baseline.fingerprint,
          })
          checkResults.push({
            id: `${step.id}-visual`,
            name: `${step.name} visual baseline`,
            kind: "VISUAL_REGRESSION",
            gateMode: "BLOCKING",
            passed: comparison.passed,
            expected: `Difference at or below ${Number(step.screenshot.diffThreshold || 0.01) * 100}%`,
            observed: `${(comparison.diffRatio * 100).toFixed(2)}%`,
            error: comparison.passed
              ? ""
              : "The selected UI region changed beyond its approved visual tolerance.",
          })
          if (comparison.diff) {
            const diffArtifact = await artifactUploader.upload(
              {
                kind: "VISUAL_DIFF",
                checkpointId: step.screenshot.checkpointId || step.id,
                contentType: "image/png",
                masked: true,
              },
              comparison.diff
            )
            if (diffArtifact) artifacts.push(diffArtifact)
          }
        } else {
          visualEvidence.push({
            checkpointId: step.screenshot.checkpointId || step.id,
            passed: true,
            state: "BASELINE_NOT_APPROVED",
          })
        }
      } else {
        checkResults.push({
          id: `${step.id}-visual-evidence`,
          name: `${step.name} visual evidence`,
          kind: "ARTIFACT_POLICY_BLOCKED",
          gateMode: "BLOCKING",
          passed: false,
          expected: "A masked checkpoint screenshot",
          observed: "Not captured",
          error:
            "The checkpoint screenshot could not be stored within the configured artifact policy.",
        })
      }
    }
  } catch (error) {
    failureCategory = classifyError(error)
    failureReason = safeMessage(error)
  }

  const endedAt = new Date()
  const durationMs = Math.round(performance.now() - started)
  return {
    id: crypto.randomUUID(),
    stepDefinitionId: step.id,
    stepOrder: index + 1,
    name: step.name,
    type: step.type,
    status: failureCategory ? "FAILED" : "SUCCESS",
    durationMs,
    locatorEvidence,
    checkResults,
    timing: { actionMs: durationMs },
    failureCategory,
    failureReason,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
  }
}

async function evaluateCheck({ page, check, input, network, consoleEvents }) {
  const locator = check.locator ? buildLocator(page, check.locator) : null
  let observed
  let passed = false
  try {
    switch (check.kind) {
      case "ELEMENT_VISIBLE":
        observed = await locator.isVisible()
        passed = observed === true
        break
      case "ELEMENT_HIDDEN":
        observed = await locator.isHidden()
        passed = observed === true
        break
      case "ELEMENT_ENABLED":
        observed = await locator.isEnabled()
        passed = observed === true
        break
      case "TEXT":
        observed = await locator.innerText()
        passed = compare(observed, render(check.expected, input.variables), check.operator)
        break
      case "COUNT":
        observed = await locator.count()
        passed = compareNumber(observed, Number(check.threshold), check.operator)
        break
      case "URL":
        observed = page.url()
        passed = compare(observed, render(check.expected, input.variables), check.operator)
        break
      case "TITLE":
        observed = await page.title()
        passed = compare(observed, render(check.expected, input.variables), check.operator)
        break
      case "NO_JS_ERRORS":
        observed = consoleEvents.filter(
          (item) => item.type === "error" || item.type === "pageerror"
        ).length
        passed = observed === 0
        break
      case "NO_FAILED_REQUESTS":
        observed = network.failedRequests
        passed = observed === 0
        break
      case "ACCESSIBILITY_SNAPSHOT":
        observed = await (locator || page.locator("body")).ariaSnapshot()
        passed = compare(observed, check.expected || "", check.operator || "CONTAINS")
        break
      case "PERFORMANCE_BUDGET": {
        const metrics = await collectPerformance(page)
        observed = Number(metrics[check.expected] || 0)
        passed = compareNumber(observed, Number(check.threshold), check.operator)
        break
      }
      default:
        throw new Error(`Unsupported checkpoint kind ${check.kind}.`)
    }
    return {
      id: check.id,
      name: check.name,
      kind: check.kind,
      gateMode: check.gateMode || "BLOCKING",
      passed,
      expected:
        check.kind === "PERFORMANCE_BUDGET" ? check.threshold : check.expected,
      observed: maskValue(observed, input.sensitiveValues),
      error: passed
        ? ""
        : `${check.name || check.kind} did not meet its expected condition.`,
    }
  } catch (error) {
    return {
      id: check.id,
      name: check.name,
      kind: check.kind,
      gateMode: check.gateMode || "BLOCKING",
      passed: false,
      expected: check.expected || check.threshold,
      error: safeMessage(error),
    }
  }
}

async function evaluateGraph({ page, step, input, capturedResponses }) {
  const graph = step.graph
  let observed
  let sourceState = "CAPTURED"
  if (graph.source === "NETWORK_JSON") {
    const response = [...capturedResponses]
      .reverse()
      .find((item) => matchPattern(item.url, graph.responseUrlPattern))
    if (!response) {
      sourceState = "NOT_CAPTURED"
    } else {
      observed = getPath(response.body, graph.valuePath)
    }
  } else {
    const locator = step.locator ? buildLocator(page, step.locator) : null
    if (!locator) {
      sourceState = "NOT_CAPTURED"
    } else {
      const raw =
        graph.source === "ACCESSIBILITY"
          ? await locator.getAttribute("aria-valuenow")
          : await locator.innerText()
      observed = parseNumeric(raw)
    }
  }
  const numericObserved = parseNumeric(observed)
  const passed =
    sourceState === "CAPTURED" &&
    Number.isFinite(numericObserved) &&
    compareNumber(numericObserved, Number(graph.threshold), graph.operator)
  const evidence = {
    checkpointId: step.id,
    name: step.name,
    source: graph.source,
    sourceState,
    aggregation: graph.aggregation || "LATEST",
    operator: graph.operator,
    threshold: graph.threshold,
    observed: Number.isFinite(numericObserved) ? numericObserved : null,
    passed,
    confidence: graph.source === "VISUAL" ? 0.5 : 1,
  }
  return {
    evidence,
    check: {
      id: `${step.id}-graph`,
      name: step.name,
      kind: sourceState === "CAPTURED" ? "GRAPH_REGRESSION" : "GRAPH_SOURCE_MISSING",
      gateMode:
        graph.source === "VISUAL" ? "ADVISORY" : graph.gateMode || "BLOCKING",
      passed,
      expected: `${graph.operator} ${graph.threshold}`,
      observed: evidence.observed,
      error: passed
        ? ""
        : sourceState === "CAPTURED"
          ? "The graph or KPI value did not meet its configured condition."
          : "The configured graph data source was not observed during this run.",
    },
  }
}

async function captureArtifact(
  page,
  input,
  kind,
  checkpointId,
  selectors,
  fullPage,
  artifactUploader
) {
  await markSensitiveText(page, input.sensitiveValues)
  const mask = [
    page.locator(
      'input[type="password"], input[autocomplete*="password"], [data-rhythm-sensitive="true"], [data-rhythm-runtime-mask="true"]'
    ),
  ]
  for (const selector of selectors || []) {
    if (typeof selector === "string" && selector.trim()) {
      mask.push(page.locator(selector))
    }
  }
  const bytes = await page.screenshot({
    type: "png",
    fullPage,
    animations: "disabled",
    caret: "hide",
    mask,
    maskColor: "#4b5563",
    timeout: 15_000,
  })
  if (bytes.byteLength > 10 * 1024 * 1024) return null
  const payload = await artifactUploader.upload(
    {
      kind,
      checkpointId,
      contentType: "image/png",
      masked: true,
    },
    bytes
  )
  if (!payload) return null
  return {
    payload,
    bytes,
  }
}

async function markSensitiveText(page, sensitiveValues = []) {
  const values = sensitiveValues
    .filter((value) => typeof value === "string" && value.length >= 3)
    .slice(0, 50)
  if (!values.length) return
  await page.evaluate((secrets) => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT
    )
    let node
    while ((node = walker.nextNode())) {
      const text = node.childElementCount === 0 ? node.textContent || "" : ""
      if (text && secrets.some((secret) => text.includes(secret))) {
        node.setAttribute("data-rhythm-runtime-mask", "true")
      }
    }
  }, values)
}

async function finish({
  status,
  started,
  steps,
  events,
  warningCount,
  failureCategory = "",
  failureReason = "",
  failedStepId = "",
  page,
  network,
  consoleEvents,
  graphEvidence,
  visualEvidence,
  artifacts,
  artifactUploader,
  startedAt,
}) {
  const metrics = page ? await collectPerformance(page).catch(() => ({})) : {}
  events.push(
    event(
      status === "SUCCESS" || status === "SUCCESS_WITH_WARNINGS"
        ? "RUN_COMPLETED"
        : "RUN_FAILED",
      status === "SUCCESS"
        ? "Browser journey completed successfully."
        : failureReason || "Browser journey completed with warnings.",
      failedStepId,
      failureCategory
    )
  )
  return {
    status,
    browserName: "chromium",
    browserVersion: browser.version(),
    agentImageVersion: imageVersion,
    durationMs: Math.round(performance.now() - started),
    warningCount,
    failureCategory,
    failureReason,
    failedStepId,
    metrics,
    graphEvidence,
    visualEvidence,
    networkSummary: {
      requests: network.requests,
      responses: network.responses,
      failedRequests: network.failedRequests,
      httpErrors: network.httpErrors,
      transferredBytes: network.transferredBytes,
      byType: network.byType,
      failures: network.failures.slice(0, 50),
    },
    consoleEvents: consoleEvents.slice(0, 100),
    events,
    steps,
    artifacts,
    artifactUploadFailures: artifactUploader.failures,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
  }
}

async function collectPerformance(page) {
  return page.evaluate(() => {
    const state = window.__rhythmPerformance || {
      fcpMs: null,
      lcpMs: null,
      cls: 0,
      longTasks: [],
      interactions: [],
    }
    const navigation = performance.getEntriesByType("navigation")[0]
    const resources = performance.getEntriesByType("resource")
    const tbtMs = (state.longTasks || []).reduce(
      (total, duration) => total + Math.max(0, duration - 50),
      0
    )
    return {
      dnsMs: navigation
        ? Math.max(0, navigation.domainLookupEnd - navigation.domainLookupStart)
        : null,
      tcpMs: navigation
        ? Math.max(0, navigation.connectEnd - navigation.connectStart)
        : null,
      tlsMs:
        navigation && navigation.secureConnectionStart > 0
          ? Math.max(
              0,
              navigation.connectEnd - navigation.secureConnectionStart
            )
          : null,
      ttfbMs: navigation
        ? Math.max(0, navigation.responseStart - navigation.requestStart)
        : null,
      domContentLoadedMs: navigation
        ? Math.max(0, navigation.domContentLoadedEventEnd - navigation.startTime)
        : null,
      loadMs:
        navigation && navigation.loadEventEnd > 0
          ? Math.max(0, navigation.loadEventEnd - navigation.startTime)
          : null,
      fcpMs: state.fcpMs,
      lcpMs: state.lcpMs,
      cls: state.cls,
      tbtMs,
      longTaskCount: (state.longTasks || []).length,
      interactionMs: Math.max(0, ...(state.interactions || [0])),
      resourceCount: resources.length,
      transferredBytes: resources.reduce(
        (total, item) => total + (item.transferSize || 0),
        0
      ),
      evidenceType: "SYNTHETIC_LAB",
    }
  })
}

function buildLocator(page, locator) {
  let scope = page
  if (locator.frame) scope = page.frameLocator(locator.frame)
  switch (String(locator.strategy || "").toUpperCase()) {
    case "ROLE":
      return scope.getByRole(locator.value, {
        name: locator.name || undefined,
        exact: Boolean(locator.exact),
      })
    case "LABEL":
      return scope.getByLabel(locator.value, { exact: Boolean(locator.exact) })
    case "TEST_ID":
      return scope.getByTestId(locator.value)
    case "TEXT":
      return scope.getByText(locator.value, { exact: Boolean(locator.exact) })
    case "PLACEHOLDER":
      return scope.getByPlaceholder(locator.value, {
        exact: Boolean(locator.exact),
      })
    case "CSS":
      return scope.locator(locator.value)
    case "XPATH":
      return scope.locator(`xpath=${locator.value}`)
    default:
      throw new Error(`Unsupported locator strategy ${locator.strategy}.`)
  }
}

function compare(observed, expected, operator = "EQUALS") {
  const actual = String(observed ?? "")
  const wanted = String(expected ?? "")
  switch (operator) {
    case "CONTAINS":
      return actual.includes(wanted)
    case "NOT_CONTAINS":
      return !actual.includes(wanted)
    case "MATCHES":
      return new RegExp(wanted).test(actual)
    case "NOT_EQUALS":
      return actual !== wanted
    default:
      return actual === wanted
  }
}

function compareNumber(observed, expected, operator = "LESS_THAN") {
  if (!Number.isFinite(observed) || !Number.isFinite(expected)) return false
  switch (operator) {
    case "GREATER_THAN":
      return observed > expected
    case "GREATER_THAN_OR_EQUAL":
      return observed >= expected
    case "LESS_THAN_OR_EQUAL":
      return observed <= expected
    case "EQUALS":
      return observed === expected
    case "NOT_EQUALS":
      return observed !== expected
    default:
      return observed < expected
  }
}

function comparePNGs(actualBytes, expectedBytes, threshold) {
  try {
    const actual = PNG.sync.read(actualBytes)
    const expected = PNG.sync.read(expectedBytes)
    if (actual.width !== expected.width || actual.height !== expected.height) {
      return { passed: false, diffPixels: actual.width * actual.height, diffRatio: 1 }
    }
    const diff = new PNG({ width: actual.width, height: actual.height })
    const diffPixels = pixelmatch(
      expected.data,
      actual.data,
      diff.data,
      actual.width,
      actual.height,
      { threshold: 0.15, includeAA: false }
    )
    const diffRatio = diffPixels / (actual.width * actual.height)
    return {
      passed: diffRatio <= threshold,
      diffPixels,
      diffRatio,
      diff: PNG.sync.write(diff),
    }
  } catch {
    return { passed: false, diffPixels: 0, diffRatio: 1 }
  }
}

function getPath(value, path) {
  if (!path || path === "$") return value
  const segments = String(path)
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
  let current = value
  for (const segment of segments) {
    if (current == null) return undefined
    current = current[segment]
  }
  return current
}

function parseNumeric(value) {
  if (typeof value === "number") return value
  const match = String(value ?? "")
    .replace(/,/g, "")
    .match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : Number.NaN
}

function render(value, variables = {}) {
  return String(value || "").replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name)
        ? String(variables[name])
        : match
  )
}

function matchPattern(value, pattern) {
  if (!pattern) return false
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
  return new RegExp(`^${escaped}$`).test(value)
}

function maskText(value, sensitiveValues = []) {
  let output = String(value || "")
  for (const secret of sensitiveValues || []) {
    if (typeof secret === "string" && secret.length >= 3) {
      output = output.split(secret).join("MASKED")
    }
  }
  return output.slice(0, 2000)
}

function maskValue(value, sensitiveValues) {
  if (typeof value === "string") return maskText(value, sensitiveValues)
  return value
}

function safeURL(raw) {
  try {
    const parsed = new URL(raw)
    for (const key of parsed.searchParams.keys()) {
      if (/token|secret|password|auth|key|session/i.test(key)) {
        parsed.searchParams.set(key, "MASKED")
      }
    }
    parsed.username = ""
    parsed.password = ""
    return parsed.toString()
  } catch {
    return ""
  }
}

function safeMessage(error) {
  return String(error?.message || error || "Browser execution failed.")
    .replace(
      /(authorization|cookie|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=MASKED"
    )
    .slice(0, 1000)
}

function classifyError(error) {
  const message = String(error?.message || error || "").toLowerCase()
  if (message.includes("artifact")) return "ARTIFACT_POLICY_BLOCKED"
  if (message.includes("timeout")) return "TIMED_OUT"
  if (message.includes("strict mode violation")) return "SELECTOR_AMBIGUOUS"
  if (
    message.includes("locator") ||
    message.includes("waiting for") ||
    message.includes("not found")
  )
    return "SELECTOR_NOT_FOUND"
  if (message.includes("navigation") || message.includes("net::"))
    return "NAVIGATION_FAILED"
  if (message.includes("target closed") || message.includes("browser"))
    return "BROWSER_CRASH"
  if (message.includes("allowed origin") || message.includes("private target"))
    return "POLICY_VIOLATION"
  return "ACTION_FAILED"
}

function event(
  type,
  message,
  stepId = "",
  category = "",
  durationMs = 0
) {
  return {
    type,
    message,
    stepId,
    category,
    durationMs,
    occurredAt: new Date().toISOString(),
  }
}

function validateInput(input) {
  if (!input?.runId || !input?.monitorId || !input?.definition) {
    throw new Error("runId, monitorId, and definition are required.")
  }
  if (!Array.isArray(input.definition.steps) || !input.definition.steps.length) {
    throw new Error("Browser journey has no executable steps.")
  }
  if (input.definition.steps.length > 100) {
    throw new Error("Browser journey exceeds the 100-step limit.")
  }
}

async function validateTarget(raw, allowedOrigins = []) {
  const target = new URL(raw)
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Only HTTP and HTTPS browser targets are allowed.")
  }
  if (
    allowedOrigins.length &&
    !allowedOrigins.some((origin) => new URL(origin).origin === target.origin)
  ) {
    throw new Error("Navigation target is outside the monitor's allowed origins.")
  }
  const addresses = await dns.lookup(target.hostname, { all: true })
  if (
    !allowPrivateTargets &&
    addresses.some((address) => isPrivateAddress(address.address))
  ) {
    throw new Error("Navigation resolved to a private target blocked by policy.")
  }
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number)
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  const normalized = address.toLowerCase()
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  )
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return crypto.subtle
    ? timingSafeLoop(a, b)
    : left === right
}

function timingSafeLoop(left, right) {
  let difference = 0
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

function json(response, status, body) {
  const encoded = JSON.stringify(body)
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(encoded),
    "Cache-Control": "no-store",
  })
  response.end(encoded)
}

async function readJSON(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maximumBodyBytes) throw new Error("Request body is too large.")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

const performanceBootstrap = `(() => {
  window.__rhythmPerformance = { fcpMs: null, lcpMs: null, cls: 0, longTasks: [], interactions: [] };
  const state = window.__rhythmPerformance;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') state.fcpMs = entry.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) state.lcpMs = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) state.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.interactions.push(entry.duration);
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch {}
})();`

process.on("SIGTERM", async () => {
  await browser.close().catch(() => {})
  server.close(() => process.exit(0))
})
