import { initialRequestDefinition } from "@/features/monitors/request-definition"
import type {
  KeyValueRow,
  RequestDefinition,
} from "@/features/monitors/request-definition"

const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_STEPS = 50
const SENSITIVE_KEY =
  /(authorization|cookie|password|passwd|secret|token|api[-_ ]?key|private[-_ ]?key|credential|signature|session)/i

export type MonitorImportWarning = {
  code: string
  message: string
  location?: string
}

export type ImportedMonitorDraft = {
  source: "postman" | "curl"
  name: string
  description: string
  definition: RequestDefinition
  warnings: MonitorImportWarning[]
  summary: {
    requests: number
    folders: number
    scripts: number
    variables: number
  }
}

type PostmanValue = {
  key?: string
  value?: unknown
  disabled?: boolean
  description?: unknown
  type?: string
}

type PostmanScript = {
  exec?: string | string[]
}

type PostmanEvent = {
  listen?: string
  script?: PostmanScript
}

type PostmanAuth = {
  type?: string
  [key: string]: unknown
}

type PostmanItem = {
  name?: string
  description?: unknown
  disabled?: boolean
  item?: PostmanItem[]
  event?: PostmanEvent[]
  auth?: PostmanAuth | null
  request?: {
    method?: string
    header?: PostmanValue[]
    body?: Record<string, unknown>
    auth?: PostmanAuth | null
    url?: unknown
    description?: unknown
  }
  response?: unknown[]
}

type PostmanCollection = {
  info?: {
    name?: string
    description?: unknown
    schema?: string
  }
  item?: PostmanItem[]
  event?: PostmanEvent[]
  auth?: PostmanAuth | null
  variable?: PostmanValue[]
}

type InheritedPostmanContext = {
  path: string[]
  auth?: PostmanAuth | null
  preRequest: string[]
  tests: string[]
}

export class MonitorImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MonitorImportError"
  }
}

export function parsePostmanCollection(source: string): ImportedMonitorDraft {
  assertSourceSize(source)
  let collection: PostmanCollection
  try {
    collection = JSON.parse(source) as PostmanCollection
  } catch {
    throw new MonitorImportError(
      "This file is not valid JSON. Export the collection from Postman as Collection v2.1 JSON and try again."
    )
  }
  if (!collection.info || !Array.isArray(collection.item)) {
    throw new MonitorImportError(
      "This JSON is not a Postman collection. A collection must contain info and item fields."
    )
  }

  const warnings: MonitorImportWarning[] = []
  const schema = collection.info.schema ?? ""
  if (schema && !/v2\.(0|1)\.0/.test(schema)) {
    warnings.push({
      code: "POSTMAN_SCHEMA",
      message:
        "This is not a Postman Collection v2.0/v2.1 export. Rhythm will attempt a compatible import; Postman v3 multi-file collections should be exported as v2.1 JSON first.",
    })
  } else if (!schema) {
    warnings.push({
      code: "POSTMAN_SCHEMA_MISSING",
      message:
        "The collection does not identify its schema version. Rhythm treated it as a Postman v2.1-compatible collection.",
    })
  }

  const collectionVariables = (collection.variable ?? []).filter(
    (variable) => variable.key && !variable.disabled
  )
  const sensitiveVariableKeys = new Set<string>()
  const safeVariables: Record<string, string> = {}
  for (const variable of collectionVariables) {
    const key = variable.key ?? ""
    const value = stringValue(variable.value)
    if (isSensitive(key, variable.type)) {
      sensitiveVariableKeys.add(key)
      warnings.push({
        code: "SECRET_VARIABLE",
        location: `Variable ${key}`,
        message: `The value of “${key}” was not imported. Create a Rhythm secret and keep the {{${key}}} reference, or set it in a pre-request script.`,
      })
      continue
    }
    safeVariables[key] = value
  }

  const steps: RequestDefinition["steps"] = []
  let folders = 0
  let scriptCount = eventScripts(collection.event).count
  const rootEvents = eventScripts(collection.event)

  const visit = (
    items: PostmanItem[],
    inherited: InheritedPostmanContext
  ) => {
    for (const item of items) {
      const itemName = item.name?.trim() || "Untitled request"
      const events = eventScripts(item.event)
      scriptCount += events.count
      if (Array.isArray(item.item)) {
        folders += 1
        visit(item.item, {
          path: [...inherited.path, itemName],
          auth:
            item.auth === undefined || item.auth?.type === "inherit"
              ? inherited.auth
              : item.auth,
          preRequest: [...inherited.preRequest, ...events.preRequest],
          tests: [...events.tests, ...inherited.tests],
        })
        continue
      }
      if (!item.request) {
        warnings.push({
          code: "EMPTY_ITEM",
          location: [...inherited.path, itemName].join(" / "),
          message: "This collection item has no HTTP request and was skipped.",
        })
        continue
      }
      if (steps.length >= MAX_STEPS) {
        throw new MonitorImportError(
          `This collection contains more than ${MAX_STEPS} requests. Split it into smaller collections before importing.`
        )
      }
      const location = [...inherited.path, itemName].join(" / ")
      const requestAuth =
        item.request.auth === undefined ||
        item.request.auth === null ||
        item.request.auth?.type === "inherit"
          ? inherited.auth
          : item.request.auth
      const preRequest = [
        ...inherited.preRequest,
        ...events.preRequest,
      ].filter(Boolean)
      const tests = [...events.tests, ...inherited.tests].filter(Boolean)
      const step = makeHTTPDefinitionStep(
        steps.length,
        location,
        item.request.method ?? "GET"
      )
      step.enabled = item.disabled !== true
      mapPostmanRequest(
        step,
        item.request,
        requestAuth,
        preRequest,
        tests,
        warnings,
        location
      )
      if (Array.isArray(item.response) && item.response.length) {
        warnings.push({
          code: "EXAMPLES_NOT_IMPORTED",
          location,
          message: `${item.response.length} saved response example${item.response.length === 1 ? " was" : "s were"} not imported because monitor revisions store live execution evidence instead.`,
        })
      }
      steps.push(step)
    }
  }

  visit(collection.item, {
    path: [],
    auth: collection.auth,
    preRequest: rootEvents.preRequest,
    tests: rootEvents.tests,
  })

  if (!steps.length) {
    throw new MonitorImportError(
      "The collection does not contain any importable HTTP requests."
    )
  }

  const variableSetup = buildCollectionVariableSetup(safeVariables)
  if (variableSetup) {
    const first = steps[0]
    first.request.preRequestScript = scriptDefinition(
      [variableSetup, first.request.preRequestScript.code]
        .filter(Boolean)
        .join("\n\n")
    )
  }
  for (const step of steps) {
    replaceSensitivePostmanReferences(step, sensitiveVariableKeys)
  }

  return {
    source: "postman",
    name: collection.info.name?.trim() || "Imported Postman collection",
    description:
      descriptionText(collection.info.description) ||
      "Imported from a Postman collection.",
    definition: {
      ...clone(initialRequestDefinition),
      steps,
    },
    warnings,
    summary: {
      requests: steps.length,
      folders,
      scripts: scriptCount,
      variables: collectionVariables.length,
    },
  }
}

export function parseCurlCommand(source: string): ImportedMonitorDraft {
  assertSourceSize(source)
  const tokens = tokenizeShell(source.replace(/\\\r?\n/g, " "))
  if (!tokens.length || !/^curl(?:\.exe)?$/i.test(tokens[0])) {
    throw new MonitorImportError(
      "Paste a cURL command beginning with curl. Shell scripts and commands are not executed."
    )
  }
  if (tokens.some((token) => ["&&", "||", "|", ";"].includes(token))) {
    throw new MonitorImportError(
      "Import one cURL command at a time. Shell operators are not supported or executed."
    )
  }

  const warnings: MonitorImportWarning[] = []
  let method = ""
  let url = ""
  let body = ""
  let bodyType = "none"
  let username = ""
  let password = ""
  let followRedirects = false
  let compression = true
  let timeoutMs = 15000
  let retries = 0
  let insecure = false
  let proxyURL = ""
  const rawHeaders: Array<[string, string]> = []
  const cookies: Array<[string, string]> = []
  const formFields: string[] = []
  const dataParts: string[] = []
  const requestValue = (index: number, option: string) => {
    const value = tokens[index + 1]
    if (value === undefined || value.startsWith("-")) {
      throw new MonitorImportError(`${option} requires a value.`)
    }
    return value
  }

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    const [option, inlineValue] = splitLongOption(token)
    const take = () => {
      if (inlineValue !== undefined) return inlineValue
      const value = requestValue(index, option)
      index += 1
      return value
    }
    if (["-X", "--request"].includes(option)) method = take().toUpperCase()
    else if (["--url"].includes(option)) url = take()
    else if (["-H", "--header"].includes(option)) {
      const header = take()
      const separator = header.indexOf(":")
      if (separator < 1) {
        warnings.push({
          code: "INVALID_HEADER",
          message: `Header “${header}” was skipped because it has no name/value separator.`,
        })
      } else {
        rawHeaders.push([
          header.slice(0, separator).trim(),
          header.slice(separator + 1).trim(),
        ])
      }
    } else if (
      ["-d", "--data", "--data-raw", "--data-binary", "--data-ascii"].includes(
        option
      )
    ) {
      const value = take()
      if (value.startsWith("@")) {
        warnings.push({
          code: "LOCAL_FILE",
          message:
            "Local file data was not read. Replace the imported body placeholder with content or a safe runtime variable.",
        })
        dataParts.push("{{ importedFileBody }}")
      } else dataParts.push(value)
    } else if (option === "--data-urlencode") {
      dataParts.push(take())
      bodyType = "form"
    } else if (["-F", "--form"].includes(option)) {
      const value = take()
      if (value.includes("=@") || value.startsWith("@")) {
        warnings.push({
          code: "LOCAL_FILE",
          message:
            "A multipart file path was not imported. Configure the file body explicitly in Rhythm.",
        })
      } else formFields.push(value)
      bodyType = "multipart"
    } else if (["-u", "--user"].includes(option)) {
      const value = take()
      const separator = value.indexOf(":")
      username = separator < 0 ? value : value.slice(0, separator)
      password = separator < 0 ? "" : value.slice(separator + 1)
    } else if (["-b", "--cookie"].includes(option)) {
      for (const pair of take().split(";")) {
        const separator = pair.indexOf("=")
        if (separator > 0)
          cookies.push([
            pair.slice(0, separator).trim(),
            pair.slice(separator + 1).trim(),
          ])
      }
    } else if (["-A", "--user-agent"].includes(option))
      rawHeaders.push(["User-Agent", take()])
    else if (["-e", "--referer"].includes(option))
      rawHeaders.push(["Referer", take()])
    else if (["-L", "--location"].includes(option)) followRedirects = true
    else if (["-I", "--head"].includes(option)) method = "HEAD"
    else if (option === "--compressed") compression = true
    else if (option === "--max-time")
      timeoutMs = Math.max(100, Math.round(Number(take()) * 1000) || 15000)
    else if (option === "--retry")
      retries = Math.min(10, Math.max(0, Number.parseInt(take(), 10) || 0))
    else if (["-x", "--proxy"].includes(option)) proxyURL = take()
    else if (["-k", "--insecure"].includes(option)) insecure = true
    else if (["--cert", "--key", "--cacert"].includes(option)) {
      take()
      warnings.push({
        code: "LOCAL_CERTIFICATE",
        message: `${option} references a local file. Select an uploaded Rhythm certificate profile after import.`,
      })
    } else if (
      ["-s", "--silent", "-S", "--show-error", "-i", "--include"].includes(
        option
      )
    ) {
      // Output-only flags do not affect a monitor request.
    } else if (option.startsWith("-")) {
      warnings.push({
        code: "UNSUPPORTED_CURL_OPTION",
        message: `cURL option “${option}” is not supported and was ignored.`,
      })
    } else if (!url) url = token
    else {
      warnings.push({
        code: "EXTRA_ARGUMENT",
        message: `Extra argument “${maskInlineValue(token)}” was ignored.`,
      })
    }
  }

  if (!url) throw new MonitorImportError("The cURL command has no URL.")
  const embeddedCredentials = removeURLCredentials(url)
  url = embeddedCredentials.url
  if (!username && embeddedCredentials.username) {
    username = embeddedCredentials.username
    password = embeddedCredentials.password
    warnings.push({
      code: "URL_CREDENTIALS",
      message:
        "Credentials embedded in the URL were moved to Basic Auth and the password was replaced with a secret placeholder.",
    })
  }
  if (dataParts.length) {
    body = dataParts.join("&")
    if (bodyType === "none") bodyType = inferBodyType(body, rawHeaders)
  }
  if (formFields.length)
    body = formFields
      .map((field) => {
        const separator = field.indexOf("=")
        const key = separator < 0 ? field : field.slice(0, separator)
        const value = separator < 0 ? "" : field.slice(separator + 1)
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      })
      .join("&")
  if (!method) method = bodyType === "none" ? "GET" : "POST"

  const step = makeHTTPDefinitionStep(0, "Imported cURL request", method)
  const parsedURL = splitURLQuery(url)
  step.request.url = parsedURL.url
  step.request.params = parsedURL.params
  for (const parameter of step.request.params) {
    parameter.value = protectSecretValue(
      parameter.key,
      parameter.value,
      warnings
    )
    parameter.sensitive = isSensitive(parameter.key)
  }
  step.request.headers = rawHeaders
    .filter(([key]) => !/^cookie$/i.test(key))
    .map(([key, value], index) =>
      row(
        `header-import-${index + 1}`,
        key,
        protectSecretValue(key, value, warnings)
      )
    )
  step.request.cookies = cookies.map(([key], index) => ({
    ...row(
      `cookie-import-${index + 1}`,
      key,
      secretPlaceholder(key || "cookie")
    ),
    domain: "",
    path: "/",
    sensitive: true,
  }))
  if (cookies.length) {
    warnings.push({
      code: "COOKIE_SECRET",
      message:
        "Cookie values were replaced with secret placeholders. Map them to Rhythm secrets before running the monitor.",
    })
  }

  const authorization = rawHeaders.find(([key]) =>
    /^authorization$/i.test(key)
  )
  if (username || password) {
    step.request.auth = {
      type: "basic",
      fields: {
        username,
        password: password ? "{{ secrets.importedPassword }}" : "",
      },
    }
    if (password)
      warnings.push({
        code: "BASIC_SECRET",
        message:
          "The Basic Auth password was replaced with {{ secrets.importedPassword }}.",
      })
  } else if (authorization?.[1].match(/^Bearer\s+(.+)$/i)) {
    step.request.headers = step.request.headers.filter(
      (header) => !/^authorization$/i.test(header.key)
    )
    step.request.auth = {
      type: "bearer",
      fields: { token: "{{ secrets.importedBearerToken }}" },
    }
    warnings.push({
      code: "BEARER_SECRET",
      message:
        "The bearer token was replaced with {{ secrets.importedBearerToken }}.",
    })
  }
  step.request.body = { type: bodyType, content: protectBody(body, warnings) }
  step.request.settings.followRedirects = followRedirects
  step.request.settings.compression = compression
  step.request.settings.timeoutMs = timeoutMs
  step.timeoutMs = timeoutMs
  step.request.settings.retries = retries
  step.request.tls.verifyHostname = !insecure
  if (insecure) {
    warnings.push({
      code: "INSECURE_TLS",
      message:
        "cURL disabled TLS verification. Rhythm imported that choice; enable hostname verification before production use.",
    })
  }
  if (proxyURL) {
    const proxyScheme = proxyURL.split(":")[0]?.toLowerCase()
    step.request.proxy.mode = ["http", "https", "socks5"].includes(proxyScheme)
      ? proxyScheme
      : "http"
    step.request.proxy.url = proxyURL.replace(/\/\/[^/@]+@/, "//")
    if (proxyURL !== step.request.proxy.url)
      warnings.push({
        code: "PROXY_SECRET",
        message:
          "Proxy credentials embedded in the URL were removed. Select secret references in the Proxy section.",
      })
  }

  const host = safeHost(parsedURL.url)
  return {
    source: "curl",
    name: host ? `Imported request · ${host}` : "Imported cURL request",
    description: "Imported from a cURL command.",
    definition: { ...clone(initialRequestDefinition), steps: [step] },
    warnings,
    summary: { requests: 1, folders: 0, scripts: 0, variables: 0 },
  }
}

function mapPostmanRequest(
  step: RequestDefinition["steps"][number],
  request: NonNullable<PostmanItem["request"]>,
  auth: PostmanAuth | null | undefined,
  preRequest: string[],
  tests: string[],
  warnings: MonitorImportWarning[],
  location: string
) {
  const parsedURL = postmanURL(request.url)
  step.request.url = parsedURL.url
  step.request.params = parsedURL.params
  for (const parameter of step.request.params) {
    parameter.value = protectSecretValue(
      parameter.key,
      parameter.value,
      warnings,
      location
    )
    parameter.sensitive = isSensitive(parameter.key)
  }
  const cookieHeader: string[] = []
  step.request.headers = (request.header ?? [])
    .filter((header) => {
      if (/^cookie$/i.test(header.key ?? "")) {
        cookieHeader.push(stringValue(header.value))
        return false
      }
      return Boolean(header.key)
    })
    .map((header, index) => ({
      ...row(
        `header-import-${step.id}-${index + 1}`,
        header.key ?? "",
        protectSecretValue(
          header.key ?? "",
          stringValue(header.value),
          warnings,
          location
        ),
        header.disabled !== true,
        descriptionText(header.description)
      ),
      sensitive: isSensitive(header.key ?? "", header.type),
    }))
  step.request.cookies = cookieHeader
    .flatMap((value) => value.split(";"))
    .map((value, index) => {
      const separator = value.indexOf("=")
      const key = separator < 0 ? value.trim() : value.slice(0, separator).trim()
      return {
        ...row(
          `cookie-import-${step.id}-${index + 1}`,
          key,
          secretPlaceholder(key || "cookie")
        ),
        domain: "",
        path: "/",
        sensitive: true,
      }
    })
    .filter((cookie) => cookie.key)
  if (step.request.cookies.length)
    warnings.push({
      code: "COOKIE_SECRET",
      location,
      message:
        "Cookie values were replaced with Rhythm secret placeholders during import.",
    })
  step.request.auth = mapPostmanAuth(auth, warnings, location)
  step.request.body = mapPostmanBody(request.body, warnings, location)
  step.request.preRequestScript = scriptDefinition(preRequest.join("\n\n"))
  step.request.testScript = scriptDefinition(tests.join("\n\n"))
  step.request.assertions = []
}

function mapPostmanAuth(
  auth: PostmanAuth | null | undefined,
  warnings: MonitorImportWarning[],
  location: string
): { type: string; fields: Record<string, string> } {
  if (!auth || !auth.type || auth.type === "noauth")
    return { type: "none", fields: {} }
  const values = Object.fromEntries(
    (Array.isArray(auth[auth.type]) ? (auth[auth.type] as PostmanValue[]) : [])
      .filter((entry) => entry.key)
      .map((entry) => [entry.key ?? "", stringValue(entry.value)])
  )
  if (auth.type === "basic") {
    warnAuthSecret(values.password, "Basic Auth password", warnings, location)
    return {
      type: "basic",
      fields: {
        username: values.username ?? "",
        password: values.password
          ? secretOrTemplate(values.password, "importedPassword")
          : "",
      },
    }
  }
  if (auth.type === "bearer") {
    warnAuthSecret(values.token, "bearer token", warnings, location)
    return {
      type: "bearer",
      fields: {
        token: secretOrTemplate(values.token ?? "", "importedBearerToken"),
      },
    }
  }
  if (auth.type === "apikey") {
    const key = values.key || "X-API-Key"
    warnAuthSecret(values.value, `API key “${key}”`, warnings, location)
    return {
      type: "apiKey",
      fields: {
        name: key,
        value: secretOrTemplate(values.value ?? "", toAlias(key)),
        location: values.in === "query" ? "query" : "header",
      },
    }
  }
  if (auth.type === "oauth2" && values.accessToken) {
    warnAuthSecret(
      values.accessToken,
      "OAuth 2.0 access token",
      warnings,
      location
    )
    return {
      type: "bearer",
      fields: {
        token: secretOrTemplate(values.accessToken, "importedAccessToken"),
      },
    }
  }
  warnings.push({
    code: "UNSUPPORTED_AUTH",
    location,
    message: `Postman auth type “${auth.type}” is not supported by the controlled importer. Configure it in the Auth or Pre-request section.`,
  })
  return { type: "none", fields: {} }
}

function mapPostmanBody(
  body: Record<string, unknown> | undefined,
  warnings: MonitorImportWarning[],
  location: string
) {
  if (!body || body.disabled === true) return { type: "none", content: "" }
  const mode = typeof body.mode === "string" ? body.mode : "none"
  if (mode === "raw") {
    const content = stringValue(body.raw)
    const language =
      typeof body.options === "object" &&
      body.options &&
      typeof (body.options as Record<string, unknown>).raw === "object"
        ? stringValue(
            (
              (body.options as Record<string, unknown>)
                .raw as Record<string, unknown>
            ).language
          )
        : ""
    return {
      type:
        language === "json" || /^(?:\[|\{)/.test(content.trim())
          ? "json"
          : "raw",
      content: protectBody(content, warnings, location),
    }
  }
  if (mode === "urlencoded") {
    const fields = Array.isArray(body.urlencoded)
      ? (body.urlencoded as PostmanValue[])
      : []
    return {
      type: "form",
      content: fields
        .filter((field) => !field.disabled && field.key)
        .map(
          (field) =>
            `${encodeURIComponent(field.key ?? "")}=${encodeURIComponent(
              protectSecretValue(
                field.key ?? "",
                stringValue(field.value),
                warnings,
                location
              )
            )}`
        )
        .join("&"),
    }
  }
  if (mode === "formdata") {
    const fields = Array.isArray(body.formdata)
      ? (body.formdata as PostmanValue[])
      : []
    const supported = fields.filter(
      (field) => !field.disabled && field.key && field.type !== "file"
    )
    if (fields.some((field) => field.type === "file"))
      warnings.push({
        code: "POSTMAN_FILE",
        location,
        message:
          "Postman multipart file paths were not imported. Configure file content explicitly in the Body section.",
      })
    return {
      type: "multipart",
      content: supported
        .map(
          (field) =>
            `${encodeURIComponent(field.key ?? "")}=${encodeURIComponent(
              protectSecretValue(
                field.key ?? "",
                stringValue(field.value),
                warnings,
                location
              )
            )}`
        )
        .join("&"),
    }
  }
  if (mode === "graphql") {
    const graphql =
      typeof body.graphql === "object" && body.graphql
        ? (body.graphql as Record<string, unknown>)
        : {}
    return { type: "graphql", content: stringValue(graphql.query) }
  }
  if (mode === "file")
    warnings.push({
      code: "POSTMAN_FILE",
      location,
      message:
        "A local file body cannot be imported from a Postman export. Configure the body explicitly.",
    })
  return { type: "none", content: "" }
}

function postmanURL(value: unknown) {
  if (typeof value === "string") return splitURLQuery(value)
  if (!value || typeof value !== "object") return { url: "", params: [] }
  const url = value as Record<string, unknown>
  const raw = stringValue(url.raw)
  const query = Array.isArray(url.query) ? (url.query as PostmanValue[]) : []
  if (!query.length) return splitURLQuery(raw || buildPostmanURL(url))
  return {
    url: stripQuery(raw || buildPostmanURL(url)),
    params: query
      .filter((parameter) => parameter.key)
      .map((parameter, index) =>
        row(
          `param-import-${index + 1}`,
          parameter.key ?? "",
          stringValue(parameter.value),
          parameter.disabled !== true,
          descriptionText(parameter.description)
        )
      ),
  }
}

function buildPostmanURL(url: Record<string, unknown>) {
  const protocol = stringValue(url.protocol) || "https"
  const host = Array.isArray(url.host)
    ? url.host.map(stringValue).join(".")
    : stringValue(url.host)
  const path = Array.isArray(url.path)
    ? url.path.map(stringValue).join("/")
    : stringValue(url.path)
  return host ? `${protocol}://${host}/${path}` : ""
}

function splitURLQuery(raw: string) {
  const separator = raw.indexOf("?")
  if (separator < 0) return { url: raw, params: [] as KeyValueRow[] }
  const query = raw.slice(separator + 1)
  return {
    url: raw.slice(0, separator),
    params: query
      .split("&")
      .filter(Boolean)
      .map((pair, index) => {
        const equals = pair.indexOf("=")
        return row(
          `param-import-${index + 1}`,
          safeDecode(equals < 0 ? pair : pair.slice(0, equals)),
          safeDecode(equals < 0 ? "" : pair.slice(equals + 1))
        )
      }),
  }
}

function makeHTTPDefinitionStep(index: number, name: string, method: string) {
  const step = clone(initialRequestDefinition.steps[0])
  step.id = `step-import-${index + 1}`
  step.name = name
  step.request.method = method.toUpperCase()
  step.request.url = ""
  step.request.params = []
  step.request.headers = []
  step.request.cookies = []
  step.request.assertions = []
  return step
}

function eventScripts(events: PostmanEvent[] | undefined) {
  const result = { preRequest: [] as string[], tests: [] as string[], count: 0 }
  for (const event of events ?? []) {
    const source = scriptSource(event.script)
    if (!source) continue
    if (event.listen === "prerequest") result.preRequest.push(source)
    else if (event.listen === "test") result.tests.push(source)
    else continue
    result.count += 1
  }
  return result
}

function buildCollectionVariableSetup(variables: Record<string, string>) {
  const entries = Object.entries(variables)
  if (!entries.length) return ""
  return [
    "// Imported non-sensitive Postman collection variables.",
    `const importedCollectionVariables = ${JSON.stringify(variables, null, 2)};`,
    "for (const [key, value] of Object.entries(importedCollectionVariables)) {",
    "  pm.collectionVariables.set(key, value);",
    "}",
  ].join("\n")
}

function replaceSensitivePostmanReferences(
  step: RequestDefinition["steps"][number],
  keys: Set<string>
) {
  if (!keys.size) return
  const replace = (value: string) => {
    let result = value
    for (const key of keys) {
      result = result.replaceAll(`{{${key}}}`, secretPlaceholder(key))
      result = result.replaceAll(`{{ ${key} }}`, secretPlaceholder(key))
    }
    return result
  }
  step.request.url = replace(step.request.url)
  for (const row of [
    ...step.request.params,
    ...step.request.headers,
    ...step.request.cookies,
  ]) {
    row.value = replace(row.value)
  }
  step.request.body.content = replace(step.request.body.content)
  step.request.auth.fields = Object.fromEntries(
    Object.entries(step.request.auth.fields).map(([key, value]) => [
      key,
      replace(value),
    ])
  )
}

function warnAuthSecret(
  value: string | undefined,
  label: string,
  warnings: MonitorImportWarning[],
  location: string
) {
  if (!value || isTemplate(value)) return
  warnings.push({
    code: "AUTH_SECRET",
    location,
    message: `The ${label} was replaced with a Rhythm secret placeholder.`,
  })
}

function scriptDefinition(code: string) {
  return {
    enabled: Boolean(code.trim()),
    language: "javascript" as const,
    code,
    runtimeVersion: "rhythm-js-2" as const,
  }
}

function row(
  id: string,
  key: string,
  value: string,
  enabled = true,
  description = ""
): KeyValueRow {
  return { id, enabled, key, value, description }
}

function protectSecretValue(
  key: string,
  value: string,
  warnings: MonitorImportWarning[],
  location?: string
) {
  if (!isSensitive(key) || isTemplate(value)) return value
  const placeholder = secretPlaceholder(key)
  warnings.push({
    code: "SECRET_VALUE",
    location,
    message: `The value of sensitive field “${key}” was replaced with ${placeholder}.`,
  })
  return placeholder
}

function protectBody(
  body: string,
  warnings: MonitorImportWarning[],
  location?: string
) {
  if (!body.trim()) return body
  try {
    const parsed = JSON.parse(body) as unknown
    let changed = false
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(visit)
      if (!value || typeof value !== "object") return value
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => {
          if (isSensitive(key) && typeof child === "string" && !isTemplate(child)) {
            changed = true
            return [key, secretPlaceholder(key)]
          }
          return [key, visit(child)]
        })
      )
    }
    const safe = visit(parsed)
    if (changed) {
      warnings.push({
        code: "SECRET_BODY",
        location,
        message:
          "Likely credential values in the JSON body were replaced with Rhythm secret placeholders.",
      })
      return JSON.stringify(safe, null, 2)
    }
  } catch {
    // Non-JSON bodies remain unchanged because guessing can corrupt payloads.
  }
  return body
}

function secretOrTemplate(value: string, alias: string) {
  return !value || isTemplate(value) ? value : `{{ secrets.${toAlias(alias)} }}`
}

function secretPlaceholder(key: string) {
  return `{{ secrets.${toAlias(key)} }}`
}

function toAlias(value: string) {
  const words = value
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, character: string) =>
      character.toUpperCase()
    )
    .replace(/^[^a-zA-Z]+/, "")
  return words
    ? words.charAt(0).toLowerCase() + words.slice(1)
    : "importedCredential"
}

function isSensitive(key: string, type?: string) {
  return type === "secret" || SENSITIVE_KEY.test(key)
}

function isTemplate(value: string) {
  return /\{\{[^}]+\}\}/.test(value)
}

function tokenizeShell(source: string) {
  const tokens: string[] = []
  let token = ""
  let quote: "'" | '"' | "" = ""
  let escaped = false
  for (const character of source.trim()) {
    if (escaped) {
      token += character
      escaped = false
      continue
    }
    if (character === "\\" && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = ""
      else token += character
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (token) {
        tokens.push(token)
        token = ""
      }
      continue
    }
    token += character
  }
  if (quote)
    throw new MonitorImportError("The cURL command contains an unclosed quote.")
  if (escaped) token += "\\"
  if (token) tokens.push(token)
  return tokens
}

function splitLongOption(value: string): [string, string?] {
  if (!value.startsWith("--") || !value.includes("=")) return [value]
  const separator = value.indexOf("=")
  return [value.slice(0, separator), value.slice(separator + 1)]
}

function inferBodyType(body: string, headers: Array<[string, string]>) {
  const contentType =
    headers.find(([key]) => /^content-type$/i.test(key))?.[1] ?? ""
  if (/json/i.test(contentType) || /^(?:\[|\{)/.test(body.trim()))
    return "json"
  if (/x-www-form-urlencoded/i.test(contentType)) return "form"
  return "raw"
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "))
  } catch {
    return value
  }
}

function safeHost(value: string) {
  try {
    return new URL(value.replace(/\{\{[^}]+\}\}/g, "placeholder")).host
  } catch {
    return ""
  }
}

function removeURLCredentials(value: string) {
  try {
    const parsed = new URL(value)
    const username = decodeURIComponent(parsed.username)
    const password = decodeURIComponent(parsed.password)
    if (!username && !password) return { url: value, username: "", password: "" }
    parsed.username = ""
    parsed.password = ""
    return { url: parsed.toString(), username, password }
  } catch {
    return { url: value, username: "", password: "" }
  }
}

function stripQuery(value: string) {
  const index = value.indexOf("?")
  return index < 0 ? value : value.slice(0, index)
}

function scriptSource(script: PostmanScript | undefined) {
  if (Array.isArray(script?.exec)) return script.exec.join("\n")
  return typeof script?.exec === "string" ? script.exec : ""
}

function descriptionText(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const content = (value as Record<string, unknown>).content
    return typeof content === "string" ? content : ""
  }
  return ""
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  return String(value)
}

function assertSourceSize(source: string) {
  if (!source.trim()) throw new MonitorImportError("Paste or choose a file to import.")
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES)
    throw new MonitorImportError("Import files are limited to 2 MB.")
}

function maskInlineValue(value: string) {
  return value.length > 24 ? `${value.slice(0, 8)}…` : value
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
