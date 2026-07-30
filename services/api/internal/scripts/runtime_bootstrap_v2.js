"use strict";

const __clone = (value) =>
  value == null ? value : JSON.parse(JSON.stringify(value));
const __contextError = (api, context) => {
  const error = new Error(
    `${api} is unavailable during ${context || __initial.info?.eventName || "this"} scripts.`,
  );
  error.code = "SCRIPT_CONTEXT_UNAVAILABLE";
  return error;
};
const __blocked = (message) => {
  const error = new Error(message);
  error.code = "SCRIPT_POLICY_VIOLATION";
  return error;
};

globalThis.__stores = {
  variables: __clone(__initial.variables || {}),
  environment: __clone(__initial.environment || {}),
  collection: __clone(__initial.collection || {}),
  globals: __clone(__initial.globals || {}),
  cookies: __clone(__initial.cookies || {}),
  state: __clone(__initial.state || {}),
  iterationData: __clone(__initial.iterationData || {}),
};
globalThis.__request = __clone(__initial.request);
globalThis.__response = __clone(__initial.response);
globalThis.__testResults = [];
globalThis.__pendingTests = [];
globalThis.__tests = "[]";
globalThis.__visualizer = null;
globalThis.__execution = {};

const __dynamicVar = (key) => {
  const name = String(key).trim();
  if (name === "$guid" || name === "$uuid") return __host.randomUUID();
  if (name === "$timestamp") return String(Math.floor(Date.now() / 1000));
  if (name === "$isoTimestamp") return new Date().toISOString();
  if (name === "$randomInt") return String(Math.floor(Math.random() * 1000));
  return undefined;
};
const __replaceIn = (text, resolve) =>
  String(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
    const dynamic = __dynamicVar(key);
    if (dynamic !== undefined) return dynamic;
    const value = resolve(String(key).trim());
    return value == null ? "" : String(value);
  });
const __scope = (store, writable = true) => ({
  has: (key) => Object.prototype.hasOwnProperty.call(store, String(key)),
  get: (key) => store[String(key)],
  set: (key, value) => {
    if (!writable) throw __blocked("This variable scope is read-only.");
    store[String(key)] = value == null ? "" : String(value);
  },
  unset: (key) => {
    if (!writable) throw __blocked("This variable scope is read-only.");
    delete store[String(key)];
  },
  clear: () => {
    if (!writable) throw __blocked("This variable scope is read-only.");
    for (const key of Object.keys(store)) delete store[key];
  },
  replaceIn: (text) => __replaceIn(text, (key) => store[key]),
  toObject: () => __clone(store),
});
const __resolved = {
  has: (key) =>
    [
      __stores.variables,
      __stores.iterationData,
      __stores.environment,
      __stores.collection,
      __stores.globals,
    ].some((store) =>
      Object.prototype.hasOwnProperty.call(store, String(key)),
    ),
  get: (key) => {
    for (const store of [
      __stores.variables,
      __stores.iterationData,
      __stores.environment,
      __stores.collection,
      __stores.globals,
    ]) {
      if (Object.prototype.hasOwnProperty.call(store, String(key))) {
        return store[String(key)];
      }
    }
    return undefined;
  },
  set: (key, value) => {
    __stores.variables[String(key)] = value == null ? "" : String(value);
  },
  unset: (key) => {
    delete __stores.variables[String(key)];
  },
  clear: () => {
    for (const key of Object.keys(__stores.variables))
      delete __stores.variables[key];
  },
  replaceIn: (text) => __replaceIn(text, (key) => __resolved.get(key)),
  toObject: () =>
    Object.assign(
      {},
      __stores.globals,
      __stores.collection,
      __stores.environment,
      __stores.iterationData,
      __stores.variables,
    ),
};

const __entry = (item) => ({
  key: String(item?.key ?? item?.name ?? ""),
  value: String(item?.value ?? ""),
  sensitive: Boolean(item?.sensitive),
  disabled: Boolean(item?.disabled),
});
const __list = (entries) => {
  const list = {
    add(item) {
      entries.push(__entry(item));
      return list;
    },
    append(item) {
      return list.add(item);
    },
    upsert(item) {
      const next = __entry(item);
      const found = entries.find(
        (entry) => entry.key.toLowerCase() === next.key.toLowerCase(),
      );
      if (found) Object.assign(found, next);
      else entries.push(next);
      return list;
    },
    remove(key) {
      const normalized = String(key).toLowerCase();
      for (let index = entries.length - 1; index >= 0; index--) {
        if (entries[index].key.toLowerCase() === normalized)
          entries.splice(index, 1);
      }
      return list;
    },
    get(key) {
      return entries.find(
        (entry) => entry.key.toLowerCase() === String(key).toLowerCase(),
      )?.value;
    },
    has(key) {
      return entries.some(
        (entry) => entry.key.toLowerCase() === String(key).toLowerCase(),
      );
    },
    all() {
      return entries.map(__clone);
    },
    each(callback) {
      entries.forEach((entry, index) => callback(__clone(entry), index));
      return list;
    },
    count() {
      return entries.length;
    },
    clear() {
      entries.splice(0, entries.length);
      return list;
    },
    toObject() {
      return Object.fromEntries(
        entries
          .filter((entry) => !entry.disabled)
          .map((entry) => [entry.key, entry.value]),
      );
    },
    toJSON() {
      return entries.map(__clone);
    },
  };
  return list;
};

const __cookies = {
  has: (name) =>
    Object.prototype.hasOwnProperty.call(__stores.cookies, String(name)),
  get: (name) => __stores.cookies[String(name)],
  set: (name, value) => {
    __stores.cookies[String(name)] = value == null ? "" : String(value);
  },
  unset: (name) => {
    delete __stores.cookies[String(name)];
  },
  clear: () => {
    for (const name of Object.keys(__stores.cookies))
      delete __stores.cookies[name];
  },
  toObject: () => __clone(__stores.cookies),
  jar: () => ({
    get(_url, name, callback) {
      const value = __stores.cookies[String(name)];
      if (callback) {
        callback(null, value);
        return;
      }
      return Promise.resolve(value);
    },
    getAll(_url, callback) {
      const value = Object.entries(__stores.cookies).map(([name, value]) => ({
        name,
        value,
      }));
      if (callback) {
        callback(null, value);
        return;
      }
      return Promise.resolve(value);
    },
    set(_url, cookie, callback) {
      try {
        const name = String(cookie?.name ?? cookie?.key ?? "");
        if (!name) throw new Error("Cookie name is required.");
        __stores.cookies[name] = String(cookie?.value ?? "");
        if (callback) {
          callback(null, __clone(cookie));
          return;
        }
        return Promise.resolve(__clone(cookie));
      } catch (error) {
        if (callback) {
          callback(error);
          return;
        }
        return Promise.reject(error);
      }
    },
    unset(_url, name, callback) {
      delete __stores.cookies[String(name)];
      if (callback) {
        callback(null);
        return;
      }
      return Promise.resolve();
    },
    clear(_url, callback) {
      for (const name of Object.keys(__stores.cookies))
        delete __stores.cookies[name];
      if (callback) {
        callback(null);
        return;
      }
      return Promise.resolve();
    },
  }),
};

if (__request) {
  globalThis.__requestHeaderEntries = __request.headers || [];
  globalThis.__requestQueryEntries = __request.query || [];
  __request.body = __request.body || {};
  globalThis.__requestURLValue = String(__request.url || "");
  globalThis.__requestURL = {
    toString: () => __requestURLValue,
    toJSON: () => __requestURLValue,
    getQueryString: () => {
      const index = __requestURLValue.indexOf("?");
      return index >= 0 ? __requestURLValue.slice(index + 1).split("#")[0] : "";
    },
    addQueryParams: (items) => {
      const target = new URL(__requestURLValue);
      const values = Array.isArray(items) ? items : [items];
      for (const item of values) {
        if (typeof item === "string") {
          for (const [key, value] of new URLSearchParams(item))
            target.searchParams.append(key, value);
        } else {
          target.searchParams.append(
            String(item?.key ?? item?.name ?? ""),
            String(item?.value ?? ""),
          );
        }
      }
      __requestURLValue = target.toString();
      return __requestURL;
    },
    removeQueryParams: (names) => {
      const target = new URL(__requestURLValue);
      for (const name of Array.isArray(names) ? names : [names])
        target.searchParams.delete(String(name?.key ?? name));
      __requestURLValue = target.toString();
      return __requestURL;
    },
  };
  Object.defineProperty(__request, "url", {
    get: () => __requestURL,
    set: (value) => {
      __requestURLValue = String(value);
    },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(__request.body, "raw", {
    get: () => String(__request.body.content ?? ""),
    set: (value) => {
      __request.body.content = String(value ?? "");
    },
    enumerable: false,
    configurable: true,
  });
  __request.body.update = (value) => {
    __request.body.content = String(value ?? "");
    return __request.body;
  };
  Object.defineProperty(__request, "headers", {
    value: __list(__requestHeaderEntries),
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(__request, "query", {
    value: __list(__requestQueryEntries),
    enumerable: false,
    configurable: true,
  });
}
globalThis.__serializeRequest = () =>
  __request
    ? Object.assign({}, __request, {
        url: __requestURLValue,
        headers: __requestHeaderEntries,
        query: __requestQueryEntries,
      })
    : null;

const __deepEqual = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);
const __expect = (actual) => {
  let negate = false;
  const api = {};
  const chain = [
    "to",
    "be",
    "been",
    "is",
    "that",
    "which",
    "and",
    "has",
    "have",
    "with",
    "at",
    "of",
    "same",
  ];
  for (const name of chain)
    Object.defineProperty(api, name, { get: () => api });
  Object.defineProperty(api, "not", {
    get() {
      negate = !negate;
      return api;
    },
  });
  const check = (passed, message) => {
    if (negate) passed = !passed;
    negate = false;
    if (!passed) throw new Error(message);
    return api;
  };
  api.equal = (expected) =>
    check(
      actual === expected,
      `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
    );
  api.eql = api.deepEqual = (expected) =>
    check(
      __deepEqual(actual, expected),
      `expected ${JSON.stringify(actual)} to deeply equal ${JSON.stringify(expected)}`,
    );
  api.include = api.contain = (expected) =>
    check(
      (typeof actual?.includes === "function" && actual.includes(expected)) ||
        (actual &&
          typeof actual === "object" &&
          Object.keys(expected || {}).every((key) =>
            __deepEqual(actual[key], expected[key]),
          )),
      `expected value to include ${JSON.stringify(expected)}`,
    );
  api.property = (key, value) => {
    const present =
      actual != null && Object.prototype.hasOwnProperty.call(actual, key);
    check(present, `expected value to have property ${String(key)}`);
    if (arguments.length > 1)
      check(
        __deepEqual(actual[key], value),
        `expected property ${String(key)} to equal ${JSON.stringify(value)}`,
      );
    return api;
  };
  api.keys = (...keys) =>
    check(
      keys.flat().every((key) => Object.prototype.hasOwnProperty.call(actual, key)),
      `expected value to contain keys ${keys.flat().join(", ")}`,
    );
  api.above = api.greaterThan = (expected) =>
    check(actual > expected, `expected ${actual} to be above ${expected}`);
  api.below = api.lessThan = (expected) =>
    check(actual < expected, `expected ${actual} to be below ${expected}`);
  api.atLeast = (expected) =>
    check(actual >= expected, `expected ${actual} to be at least ${expected}`);
  api.atMost = (expected) =>
    check(actual <= expected, `expected ${actual} to be at most ${expected}`);
  api.match = (pattern) =>
    check(pattern.test(actual), `expected ${actual} to match ${pattern}`);
  api.lengthOf = (expected) =>
    check(
      actual?.length === expected,
      `expected length ${actual?.length} to equal ${expected}`,
    );
  api.a = api.an = (type) => {
    const normalized = String(type).toLowerCase();
    const actualType = Array.isArray(actual) ? "array" : typeof actual;
    return check(
      actualType === normalized,
      `expected ${actualType} to be ${normalized}`,
    );
  };
  Object.defineProperties(api, {
    ok: { get: () => check(Boolean(actual), "expected value to be truthy") },
    true: { get: () => check(actual === true, "expected value to be true") },
    false: { get: () => check(actual === false, "expected value to be false") },
    null: { get: () => check(actual === null, "expected value to be null") },
    undefined: {
      get: () => check(actual === undefined, "expected value to be undefined"),
    },
    empty: {
      get: () =>
        check(
          actual != null && Object.keys(actual).length === 0,
          "expected value to be empty",
        ),
    },
  });
  return api;
};

const __recordTest = (name, error, skipped = false) => {
  __testResults.push({
    name: String(name),
    passed: !error && !skipped,
    skipped,
    ...(error ? { error: String(error?.message || error) } : {}),
  });
  globalThis.__tests = JSON.stringify(__testResults);
};
const __test = (name, callback) => {
  let finished = false;
  const done = (error) => {
    if (finished) return;
    finished = true;
    __recordTest(name, error);
  };
  try {
    const returned = callback.length > 0 ? callback(done) : callback();
    if (returned && typeof returned.then === "function") {
      const pending = Promise.resolve(returned).then(
        () => done(),
        (error) => done(error),
      );
      __pendingTests.push(pending);
    } else if (callback.length === 0) {
      done();
    }
  } catch (error) {
    done(error);
  }
  return pm;
};
__test.skip = (name) => {
  __recordTest(name, null, true);
  return pm;
};

const __headerMap = (headers) => {
  const entries = Object.entries(headers || {}).map(([key, value]) => ({
    key,
    value: String(value),
  }));
  return __list(entries);
};
const __scriptResponse = (raw) => {
  const headers = __headerMap(raw.headers || {});
  return {
    code: Number(raw.code || 0),
    status: String(raw.status || ""),
    headers,
    responseTime: Number(raw.responseTimeMs || 0),
    responseSize: Number(raw.responseSize || String(raw.body || "").length),
    stream: Uint8Array.from(
      Array.from(unescape(encodeURIComponent(String(raw.body || "")))).map(
        (character) => character.charCodeAt(0),
      ),
    ),
    text: () => String(raw.body || ""),
    json: () => JSON.parse(String(raw.body || "")),
    toJSON: () => __clone(raw),
  };
};
const __normalizeSendRequest = (config) => {
  if (typeof config === "string") return config;
  const next = __clone(config) || {};
  if (next.headers != null && next.header == null) next.header = next.headers;
  return next;
};
const __sendRequest = (config, callback) => {
  try {
    const raw = __host.sendRequest(__normalizeSendRequest(config));
    const response = __scriptResponse(raw);
    if (callback) {
      callback(null, response);
      return;
    }
    return Promise.resolve(response);
  } catch (error) {
    if (callback) {
      callback(error);
      return;
    }
    return Promise.reject(error);
  }
};

const __pmResponse = __response ? __scriptResponse(__response) : undefined;
if (__pmResponse) {
  __pmResponse.to = {
    have: {
      status(code) {
        __expect(__pmResponse.code).to.equal(code);
      },
      header(name, value) {
        __expect(__pmResponse.headers.has(name)).to.equal(true);
        if (arguments.length > 1)
          __expect(__pmResponse.headers.get(name)).to.equal(value);
      },
      jsonBody(path, value) {
        let current = __pmResponse.json();
        if (path) {
          for (const segment of String(path).split(".")) current = current?.[segment];
        }
        if (arguments.length > 1) __expect(current).to.eql(value);
        else __expect(current).to.not.equal(undefined);
      },
      body(value) {
        __expect(__pmResponse.text()).to.include(value);
      },
    },
    be: {
      get success() {
        __expect(__pmResponse.code >= 200 && __pmResponse.code < 400).to.equal(
          true,
        );
      },
      get error() {
        __expect(__pmResponse.code >= 400).to.equal(true);
      },
      get clientError() {
        __expect(__pmResponse.code >= 400 && __pmResponse.code < 500).to.equal(
          true,
        );
      },
      get serverError() {
        __expect(__pmResponse.code >= 500).to.equal(true);
      },
    },
  };
}

const __state = {
  get: (key) => Promise.resolve(__clone(__stores.state[String(key)])),
  set: (key, value) => {
    __stores.state[String(key)] = __clone(value);
    return Promise.resolve();
  },
  delete: (key) => {
    const normalized = String(key);
    const existed = Object.prototype.hasOwnProperty.call(
      __stores.state,
      normalized,
    );
    delete __stores.state[normalized];
    return Promise.resolve(existed);
  },
  keys: () => Promise.resolve(Object.keys(__stores.state)),
  size: () => Promise.resolve(Object.keys(__stores.state).length),
  has: (key) =>
    Promise.resolve(
      Object.prototype.hasOwnProperty.call(__stores.state, String(key)),
    ),
  clear: () => {
    for (const key of Object.keys(__stores.state)) delete __stores.state[key];
    return Promise.resolve();
  },
  toObject: () => Promise.resolve(__clone(__stores.state)),
  replace: (value) => {
    __stores.state = __clone(value || {});
    return Promise.resolve();
  },
  increment: (key, amount = 1) => {
    const next = Number(__stores.state[String(key)] || 0) + Number(amount);
    __stores.state[String(key)] = next;
    return Promise.resolve(next);
  },
  push: (key, ...items) => {
    const normalized = String(key);
    const current = __stores.state[normalized];
    if (current != null && !Array.isArray(current))
      return Promise.reject(
        new TypeError(`pm.state value '${normalized}' is not an array.`),
      );
    const next = Array.isArray(current) ? current : [];
    const additions =
      items.length === 1 && Array.isArray(items[0]) ? items[0] : items;
    next.push(...__clone(additions));
    __stores.state[normalized] = next;
    return Promise.resolve(next.length);
  },
  addToSet: (key, item) => {
    const normalized = String(key);
    const current = __stores.state[normalized];
    if (current != null && !Array.isArray(current))
      return Promise.reject(
        new TypeError(`pm.state value '${normalized}' is not an array.`),
      );
    const next = Array.isArray(current) ? current : [];
    const exists = next.some((candidate) => __deepEqual(candidate, item));
    if (!exists) next.push(__clone(item));
    __stores.state[normalized] = next;
    return Promise.resolve(!exists);
  },
};
__state.unset = __state.delete;

const __currentDataset = {
  id: "current-iteration",
  name: "Current iteration",
  data: [__clone(__stores.iterationData)],
};
const __datasetRows = (rows) => ({
  columns: Object.keys(rows[0] || {}),
  rows: rows.map(__clone),
});
const __datasetHandle = (datasetId) => {
  const id = String(datasetId);
  const requireCurrent = (operation) => {
    if (id !== "current-iteration")
      throw __contextError(
        `pm.datasets('${id}').${operation}`,
        "a configured Rhythm run dataset",
      );
    return __currentDataset.data.map(__clone);
  };
  return {
    executeView(viewId, _params = []) {
      const rows = requireCurrent("executeView");
      const normalizedView = String(viewId || "all");
      if (normalizedView !== "all" && normalizedView !== "current")
        return Promise.reject(
          __contextError(
            `pm.datasets('${id}').executeView('${normalizedView}')`,
            "the current-iteration all view",
          ),
        );
      return Promise.resolve(__datasetRows(rows));
    },
    executeQuery(sql, params = []) {
      let rows = requireCurrent("executeQuery");
      const source = String(sql).trim();
      const match = source.match(
        /^select\s+\*\s+from\s+(?:current_iteration|dataset)(?:\s+where\s+([A-Za-z_$][\w$]*)\s*=\s*\?)?\s*;?$/i,
      );
      if (!match)
        return Promise.reject(
          __blocked(
            "Rhythm datasets accept SELECT * FROM current_iteration with an optional field = ? predicate.",
          ),
        );
      if (match[1]) {
        const expected = params[0];
        rows = rows.filter((row) => __deepEqual(row[match[1]], expected));
      }
      return Promise.resolve(__datasetRows(rows));
    },
  };
};
const __datasets = Object.assign(
  (datasetId) => __datasetHandle(datasetId),
  {
  getAll: () =>
    Promise.resolve([
      __clone(__currentDataset),
    ]),
  getOne: (id) =>
    String(id) === "current-iteration"
      ? Promise.resolve(__clone(__currentDataset))
      : Promise.reject(__contextError("pm.datasets.getOne", "monitor runs")),
  getData: (id) =>
    String(id) === "current-iteration"
      ? Promise.resolve([__clone(__stores.iterationData)])
      : Promise.reject(__contextError("pm.datasets.getData", "monitor runs")),
  getDataByRowIdentifier: (id, row) =>
    String(id) === "current-iteration" && Number(row) === 0
      ? Promise.resolve(__clone(__stores.iterationData))
      : Promise.resolve(undefined),
  getDataByColumnIdentifier: (id, column) =>
    String(id) === "current-iteration"
      ? Promise.resolve([__stores.iterationData[String(column)]])
      : Promise.resolve([]),
  },
);

const __lodash = (() => {
  const get = (object, path, fallback) => {
    const parts = Array.isArray(path)
      ? path
      : String(path)
          .replace(/\[(\d+)\]/g, ".$1")
          .split(".")
          .filter(Boolean);
    let current = object;
    for (const part of parts) {
      if (current == null || !(part in Object(current))) return fallback;
      current = current[part];
    }
    return current;
  };
  const set = (object, path, value) => {
    const parts = Array.isArray(path) ? path : String(path).split(".");
    let current = object;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) current[part] = value;
      else current = current[part] ||= {};
    });
    return object;
  };
  const groupBy = (items, iteratee) =>
    (items || []).reduce((output, item) => {
      const key =
        typeof iteratee === "function" ? iteratee(item) : get(item, iteratee);
      (output[key] ||= []).push(item);
      return output;
    }, {});
  return {
    VERSION: "rhythm-compatible",
    get,
    set,
    has: (object, path) => get(object, path, Symbol.for("missing")) !== Symbol.for("missing"),
    cloneDeep: __clone,
    isEqual: __deepEqual,
    merge: (...objects) => Object.assign({}, ...objects),
    map: (items, iteratee) =>
      Object.values(items || {}).map((item, index) =>
        typeof iteratee === "function" ? iteratee(item, index) : get(item, iteratee),
      ),
    filter: (items, iteratee) =>
      Object.values(items || {}).filter((item, index) =>
        typeof iteratee === "function"
          ? iteratee(item, index)
          : Boolean(get(item, iteratee)),
      ),
    find: (items, iteratee) =>
      Object.values(items || {}).find((item, index) =>
        typeof iteratee === "function"
          ? iteratee(item, index)
          : Boolean(get(item, iteratee)),
      ),
    reduce: (items, iteratee, initial) =>
      Object.values(items || {}).reduce(iteratee, initial),
    uniq: (items) => Array.from(new Set(items || [])),
    uniqBy: (items, iteratee) => {
      const seen = new Set();
      return (items || []).filter((item) => {
        const key =
          typeof iteratee === "function" ? iteratee(item) : get(item, iteratee);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    groupBy,
    keyBy: (items, iteratee) =>
      Object.fromEntries(
        (items || []).map((item) => [
          typeof iteratee === "function" ? iteratee(item) : get(item, iteratee),
          item,
        ]),
      ),
    chunk: (items, size = 1) => {
      const output = [];
      for (let index = 0; index < (items || []).length; index += size)
        output.push(items.slice(index, index + size));
      return output;
    },
    compact: (items) => (items || []).filter(Boolean),
    flatten: (items) => (items || []).flat(),
    flattenDeep: (items) => (items || []).flat(Infinity),
    orderBy: (items, iteratees, orders) =>
      [...(items || [])].sort((left, right) => {
        for (let index = 0; index < iteratees.length; index++) {
          const leftValue =
            typeof iteratees[index] === "function"
              ? iteratees[index](left)
              : get(left, iteratees[index]);
          const rightValue =
            typeof iteratees[index] === "function"
              ? iteratees[index](right)
              : get(right, iteratees[index]);
          if (leftValue === rightValue) continue;
          return (leftValue < rightValue ? -1 : 1) *
            (orders?.[index] === "desc" ? -1 : 1);
        }
        return 0;
      }),
  };
})();

const __moment = (input = undefined) => {
  const date = input === undefined ? new Date() : new Date(input);
  const api = {
    isValid: () => !Number.isNaN(date.getTime()),
    toDate: () => new Date(date),
    toISOString: () => date.toISOString(),
    valueOf: () => date.getTime(),
    unix: () => Math.floor(date.getTime() / 1000),
    clone: () => __moment(date),
    add(amount, unit) {
      const multiplier = {
        millisecond: 1,
        milliseconds: 1,
        second: 1000,
        seconds: 1000,
        minute: 60000,
        minutes: 60000,
        hour: 3600000,
        hours: 3600000,
        day: 86400000,
        days: 86400000,
      }[String(unit)] || 1;
      date.setTime(date.getTime() + Number(amount) * multiplier);
      return api;
    },
    subtract(amount, unit) {
      return api.add(-Number(amount), unit);
    },
    diff(other, unit = "milliseconds") {
      const raw = date.getTime() - new Date(other?.valueOf?.() ?? other).getTime();
      return Math.trunc(
        raw /
          ({
            seconds: 1000,
            minutes: 60000,
            hours: 3600000,
            days: 86400000,
          }[unit] || 1),
      );
    },
    isBefore: (other) => date.getTime() < new Date(other).getTime(),
    isAfter: (other) => date.getTime() > new Date(other).getTime(),
    format(pattern = "YYYY-MM-DDTHH:mm:ssZ") {
      const values = {
        YYYY: String(date.getUTCFullYear()),
        MM: String(date.getUTCMonth() + 1).padStart(2, "0"),
        DD: String(date.getUTCDate()).padStart(2, "0"),
        HH: String(date.getUTCHours()).padStart(2, "0"),
        mm: String(date.getUTCMinutes()).padStart(2, "0"),
        ss: String(date.getUTCSeconds()).padStart(2, "0"),
        SSS: String(date.getUTCMilliseconds()).padStart(3, "0"),
        Z: "Z",
      };
      return Object.keys(values).reduce(
        (output, token) => output.replaceAll(token, values[token]),
        pattern,
      );
    },
  };
  return api;
};
__moment.utc = __moment;
__moment.isMoment = (value) => Boolean(value?.toDate && value?.format);

const __csvParse = (input, options = {}) => {
  const delimiter = String(options.delimiter || ",");
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  const text = String(input);
  for (let index = 0; index <= text.length; index++) {
    const character = text[index] ?? "\n";
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      row.push(value);
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (options.columns && rows.length) {
    const columns = options.columns === true ? rows.shift() : options.columns;
    return rows.map((values) =>
      Object.fromEntries(columns.map((column, index) => [column, values[index]])),
    );
  }
  return rows;
};

const __simpleXML = (xml) => {
  const text = String(xml).trim();
  const root = text.match(/^<([\w:-]+)(?:\s[^>]*)?>([\s\S]*)<\/\1>$/);
  if (!root) return { _: text.replace(/<[^>]+>/g, "") };
  const output = {};
  const pattern = /<([\w:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = pattern.exec(root[2]))) {
    const value = /<[\w:-]+/.test(match[2])
      ? __simpleXML(`<${match[1]}>${match[2]}</${match[1]}>`)[match[1]]
      : match[2];
    if (output[match[1]] === undefined) output[match[1]] = value;
    else if (Array.isArray(output[match[1]])) output[match[1]].push(value);
    else output[match[1]] = [output[match[1]], value];
  }
  return { [root[1]]: Object.keys(output).length ? output : root[2] };
};
const __xml2js = {
  parseString(xml, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    try {
      callback(null, __simpleXML(xml));
    } catch (error) {
      callback(error);
    }
  },
  parseStringPromise: (xml) => Promise.resolve(__simpleXML(xml)),
  Builder: class {
    buildObject(value) {
      const build = (name, item) =>
        `<${name}>${
          item && typeof item === "object"
            ? Object.entries(item)
                .map(([key, child]) => build(key, child))
                .join("")
            : String(item ?? "")
        }</${name}>`;
      return Object.entries(value)
        .map(([key, item]) => build(key, item))
        .join("");
    }
  },
};

const __EventEmitter = class {
  constructor() {
    this._events = {};
  }
  on(name, callback) {
    (this._events[name] ||= []).push(callback);
    return this;
  }
  once(name, callback) {
    const wrapped = (...args) => {
      this.off(name, wrapped);
      callback(...args);
    };
    return this.on(name, wrapped);
  }
  off(name, callback) {
    this._events[name] = (this._events[name] || []).filter(
      (item) => item !== callback,
    );
    return this;
  }
  emit(name, ...args) {
    for (const callback of this._events[name] || []) callback(...args);
    return (this._events[name] || []).length > 0;
  }
};

const __assert = (condition, message = "Assertion failed") => {
  if (!condition) throw new Error(message);
};
__assert.equal = (actual, expected, message) =>
  __assert(actual == expected, message || `${actual} != ${expected}`);
__assert.strictEqual = (actual, expected, message) =>
  __assert(actual === expected, message || `${actual} !== ${expected}`);
__assert.deepEqual = (actual, expected, message) =>
  __assert(__deepEqual(actual, expected), message || "Values are not equal");
__assert.ok = __assert;

const __path = {
  sep: "/",
  delimiter: ":",
  join: (...parts) =>
    parts
      .filter(Boolean)
      .join("/")
      .replace(/\/+/g, "/"),
  normalize: (value) =>
    String(value)
      .split("/")
      .reduce((parts, part) => {
        if (part === "..") parts.pop();
        else if (part && part !== ".") parts.push(part);
        return parts;
      }, [])
      .join("/"),
  basename: (value, extension = "") => {
    const name = String(value).split("/").pop() || "";
    return extension && name.endsWith(extension)
      ? name.slice(0, -extension.length)
      : name;
  },
  dirname: (value) => String(value).split("/").slice(0, -1).join("/") || ".",
  extname: (value) => {
    const name = String(value).split("/").pop() || "";
    const index = name.lastIndexOf(".");
    return index > 0 ? name.slice(index) : "";
  },
  isAbsolute: (value) => String(value).startsWith("/"),
  resolve: (...parts) => "/" + __path.normalize(parts.join("/")),
};
__path.posix = __path;

const __objectURLs = new Map();
const __bytes = (value) => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Expected an ArrayBuffer or typed array.");
};
const __isAscii = (value) => Array.from(__bytes(value)).every((byte) => byte < 128);
const __isUtf8 = (value) => {
  const bytes = __bytes(value);
  for (let index = 0; index < bytes.length; index++) {
    const first = bytes[index];
    if (first <= 0x7f) continue;
    let continuation = 0;
    let minimum = 0;
    let codePoint = 0;
    if (first >= 0xc2 && first <= 0xdf) {
      continuation = 1;
      minimum = 0x80;
      codePoint = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      continuation = 2;
      minimum = 0x800;
      codePoint = first & 0x0f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      continuation = 3;
      minimum = 0x10000;
      codePoint = first & 0x07;
    } else {
      return false;
    }
    if (index + continuation >= bytes.length) return false;
    for (let offset = 1; offset <= continuation; offset++) {
      const next = bytes[index + offset];
      if ((next & 0xc0) !== 0x80) return false;
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    )
      return false;
    index += continuation;
  }
  return true;
};
const __normalizeEncoding = (encoding) => {
  const normalized = String(encoding || "utf8")
    .toLowerCase()
    .replace(/[-_]/g, "");
  if (normalized === "utf8" || normalized === "utf") return "utf8";
  if (
    normalized === "utf16le" ||
    normalized === "ucs2" ||
    normalized === "ucs2le"
  )
    return "utf16le";
  if (normalized === "latin1" || normalized === "binary") return "latin1";
  if (normalized === "ascii") return "ascii";
  throw new TypeError(`Unsupported buffer encoding '${encoding}'.`);
};
const __decodeBuffer = (value, encoding) => {
  const bytes = __bytes(value);
  const normalized = __normalizeEncoding(encoding);
  if (normalized === "utf8") {
    if (!__isUtf8(bytes)) throw new TypeError("Input is not valid UTF-8.");
    return decodeURIComponent(
      escape(String.fromCharCode(...Array.from(bytes))),
    );
  }
  if (normalized === "utf16le") {
    let output = "";
    for (let index = 0; index + 1 < bytes.length; index += 2)
      output += String.fromCharCode(bytes[index] | (bytes[index + 1] << 8));
    return output;
  }
  return String.fromCharCode(
    ...Array.from(bytes, (byte) =>
      normalized === "ascii" ? byte & 0x7f : byte,
    ),
  );
};
const __encodeBuffer = (value, encoding) => {
  const normalized = __normalizeEncoding(encoding);
  if (normalized === "utf8")
    return Uint8Array.from(
      Array.from(unescape(encodeURIComponent(String(value)))).map((character) =>
        character.charCodeAt(0),
      ),
    );
  if (normalized === "utf16le") {
    const output = new Uint8Array(String(value).length * 2);
    for (let index = 0; index < String(value).length; index++) {
      const code = String(value).charCodeAt(index);
      output[index * 2] = code & 0xff;
      output[index * 2 + 1] = code >> 8;
    }
    return output;
  }
  return Uint8Array.from(
    Array.from(String(value), (character) => {
      const code = character.charCodeAt(0);
      return normalized === "ascii" ? code & 0x7f : code & 0xff;
    }),
  );
};

const __Buffer = class extends Uint8Array {
  static from(value, encoding = "utf8") {
    if (typeof value !== "string") return new __Buffer(value);
    if (encoding === "base64")
      return new __Buffer(
        Array.from(atob(value)).map((character) => character.charCodeAt(0)),
      );
    if (encoding === "hex") {
      const output = [];
      for (let index = 0; index < value.length; index += 2)
        output.push(parseInt(value.slice(index, index + 2), 16));
      return new __Buffer(output);
    }
    return new __Buffer(new TextEncoder().encode(value));
  }
  static alloc(size, fill = 0) {
    const output = new __Buffer(Number(size));
    output.fill(fill);
    return output;
  }
  static isBuffer(value) {
    return value instanceof __Buffer;
  }
  static copyBytesFrom(view, offset = 0, length = undefined) {
    if (!ArrayBuffer.isView(view))
      throw new TypeError("Buffer.copyBytesFrom expects a typed array.");
    const elementSize = Number(view.BYTES_PER_ELEMENT || 1);
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    const available = Math.max(0, Number(view.length ?? view.byteLength) - normalizedOffset);
    const normalizedLength =
      length == null ? available : Math.max(0, Math.min(available, Number(length) || 0));
    return new __Buffer(
      new Uint8Array(
        view.buffer,
        view.byteOffset + normalizedOffset * elementSize,
        normalizedLength * elementSize,
      ),
    );
  }
  static isAscii(value) {
    return __isAscii(value);
  }
  static isUtf8(value) {
    return __isUtf8(value);
  }
  toString(encoding = "utf8") {
    if (encoding === "base64")
      return btoa(String.fromCharCode(...Array.from(this)));
    if (encoding === "hex")
      return Array.from(this, (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    return new TextDecoder().decode(this);
  }
};

const __packageCatalog = {
  ajv: class Ajv {
    compile(schema) {
      const validate = (value) => {
        const errors = [];
        const visit = (candidate, rule, path = "") => {
          if (!rule || typeof rule !== "object") return;
          const type = Array.isArray(candidate)
            ? "array"
            : candidate === null
              ? "null"
              : typeof candidate;
          if (rule.type && type !== rule.type)
            errors.push({
              instancePath: path,
              keyword: "type",
              message: `must be ${rule.type}`,
            });
          if (
            rule.enum &&
            !rule.enum.some((item) => __deepEqual(item, candidate))
          )
            errors.push({
              instancePath: path,
              keyword: "enum",
              message: "must be equal to one of the allowed values",
            });
          if (type === "object") {
            for (const required of rule.required || [])
              if (!Object.prototype.hasOwnProperty.call(candidate, required))
                errors.push({
                  instancePath: path,
                  keyword: "required",
                  message: `must have required property '${required}'`,
                });
            for (const [key, childRule] of Object.entries(
              rule.properties || {},
            ))
              if (Object.prototype.hasOwnProperty.call(candidate, key))
                visit(candidate[key], childRule, `${path}/${key}`);
          }
          if (type === "array" && rule.items)
            candidate.forEach((item, index) =>
              visit(item, rule.items, `${path}/${index}`),
            );
          if (type === "string") {
            if (rule.minLength != null && candidate.length < rule.minLength)
              errors.push({
                instancePath: path,
                keyword: "minLength",
                message: `must NOT have fewer than ${rule.minLength} characters`,
              });
            if (rule.maxLength != null && candidate.length > rule.maxLength)
              errors.push({
                instancePath: path,
                keyword: "maxLength",
                message: `must NOT have more than ${rule.maxLength} characters`,
              });
            if (rule.pattern && !new RegExp(rule.pattern).test(candidate))
              errors.push({
                instancePath: path,
                keyword: "pattern",
                message: `must match pattern ${rule.pattern}`,
              });
          }
          if (type === "number") {
            if (rule.minimum != null && candidate < rule.minimum)
              errors.push({
                instancePath: path,
                keyword: "minimum",
                message: `must be >= ${rule.minimum}`,
              });
            if (rule.maximum != null && candidate > rule.maximum)
              errors.push({
                instancePath: path,
                keyword: "maximum",
                message: `must be <= ${rule.maximum}`,
              });
          }
        };
        visit(value, schema);
        validate.errors = errors.length ? errors : null;
        return errors.length === 0;
      };
      validate.errors = null;
      return validate;
    }
    validate(schema, value) {
      const validate = this.compile(schema);
      const valid = validate(value);
      this.errors = validate.errors;
      return valid;
    }
  },
  chai: {
    expect: __expect,
    assert: __assert,
  },
  cheerio: {
    load(html) {
      const source = String(html);
      const select = (selector) => {
        const tag = String(selector).replace(/[^a-zA-Z0-9_-].*$/, "");
        const pattern = tag
          ? new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi")
          : null;
        const matches = pattern ? Array.from(source.matchAll(pattern)) : [];
        return {
          length: matches.length,
          text: () =>
            matches
              .map((match) => match[1].replace(/<[^>]+>/g, ""))
              .join(""),
          html: () => matches[0]?.[1] ?? null,
          first: () => select(selector),
          each: (callback) =>
            matches.forEach((match, index) =>
              callback(index, { html: match[0], text: match[1] }),
            ),
          attr: (name) => {
            const attribute = matches[0]?.[0].match(
              new RegExp(`${String(name)}=["']([^"']*)["']`, "i"),
            );
            return attribute?.[1];
          },
        };
      };
      select.html = () => source;
      select.root = () => ({ html: () => source });
      return select;
    },
  },
  "csv-parse/lib/sync": __csvParse,
  "csv-parse/sync": { parse: __csvParse },
  lodash: __lodash,
  moment: __moment,
  "postman-collection": {
    Request: class Request {
      constructor(value) {
        Object.assign(this, __clone(value || {}));
        this.headers = __list(this.headers || this.header || []);
      }
      toJSON() {
        return __clone(this);
      }
    },
    HeaderList: class HeaderList {
      constructor(_parent, values = []) {
        return __list(values);
      }
    },
    VariableScope: class VariableScope {
      constructor(_parent, values = []) {
        const store = Object.fromEntries(
          values.map((item) => [item.key, item.value]),
        );
        return __scope(store);
      }
    },
  },
  uuid: {
    v4: () => __host.randomUUID(),
    validate: (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value),
      ),
  },
  xml2js: __xml2js,
  path: __path,
  assert: __assert,
  buffer: {
    Buffer: __Buffer,
    isAscii: __isAscii,
    isUtf8: __isUtf8,
    transcode: (source, fromEncoding, toEncoding) =>
      new __Buffer(
        __encodeBuffer(
          __decodeBuffer(source, fromEncoding),
          toEncoding,
        ),
      ),
    resolveObjectURL: (id) => __objectURLs.get(String(id)),
  },
  util: {
    format: (format, ...values) => {
      let index = 0;
      return String(format).replace(/%[sdijoO%]/g, (token) => {
        if (token === "%%") return "%";
        const value = values[index++];
        return token === "%j" || token === "%o" || token === "%O"
          ? JSON.stringify(value)
          : token === "%d" || token === "%i"
            ? String(Number(value))
            : String(value);
      });
    },
    inspect: (value) => JSON.stringify(value, null, 2),
    types: {
      isDate: (value) => value instanceof Date,
      isRegExp: (value) => value instanceof RegExp,
      isPromise: (value) => Boolean(value?.then),
    },
    promisify: (fn) =>
      (...args) =>
        new Promise((resolve, reject) =>
          fn(...args, (error, value) => (error ? reject(error) : resolve(value))),
        ),
  },
  url: {
    get URL() {
      return globalThis.URL;
    },
    get URLSearchParams() {
      return globalThis.URLSearchParams;
    },
    parse: (value) => new globalThis.URL(value),
    format: (value) => String(value?.href || value),
    resolve: (from, to) => new globalThis.URL(to, from).toString(),
  },
  punycode: {
    toASCII: (value) => String(value),
    toUnicode: (value) => String(value),
    encode: (value) => String(value),
    decode: (value) => String(value),
  },
  querystring: {
    parse: (value) => Object.fromEntries(new URLSearchParams(String(value))),
    decode: (value) => Object.fromEntries(new URLSearchParams(String(value))),
    stringify: (value) => new URLSearchParams(value || {}).toString(),
    encode: (value) => new URLSearchParams(value || {}).toString(),
    escape: encodeURIComponent,
    unescape: decodeURIComponent,
  },
  "string-decoder": {
    StringDecoder: class StringDecoder {
      write(value) {
        return new TextDecoder().decode(value);
      }
      end(value) {
        return value ? new TextDecoder().decode(value) : "";
      }
    },
  },
  stream: {
    Readable: class Readable extends __EventEmitter {
      constructor(options = {}) {
        super();
        this.options = options;
      }
      push(value) {
        if (value == null) this.emit("end");
        else this.emit("data", value);
      }
      pipe(destination) {
        this.on("data", (chunk) => destination.write(chunk));
        this.on("end", () => destination.end?.());
        return destination;
      }
    },
    Writable: class Writable extends __EventEmitter {
      write(chunk) {
        this.emit("data", chunk);
        return true;
      }
      end(chunk) {
        if (chunk != null) this.write(chunk);
        this.emit("finish");
      }
    },
    Transform: class Transform extends __EventEmitter {},
  },
  timers: {
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    setImmediate: (callback, ...args) =>
      globalThis.setTimeout(callback, 0, ...args),
    clearImmediate: (...args) => globalThis.clearTimeout(...args),
  },
  events: Object.assign(__EventEmitter, { EventEmitter: __EventEmitter }),
};

const __normalizePackageName = (specifier) => {
  let value = String(specifier).trim();
  if (value.startsWith("npm:")) value = value.slice(4);
  if (value.startsWith("jsr:")) value = value.slice(4);
  if (value.startsWith("@")) {
    const secondAt = value.indexOf("@", 1);
    if (secondAt > value.indexOf("/")) value = value.slice(0, secondAt);
  } else {
    const at = value.indexOf("@");
    if (at > 0) value = value.slice(0, at);
  }
  return value;
};
const __require = (specifier) => {
  const requested = String(specifier).trim();
  if (
    requested.startsWith("npm:") ||
    requested.startsWith("jsr:") ||
    requested.startsWith("@")
  ) {
    const source = __host.requirePackage(requested);
    const namespace = new Function("__rhythmRequire", source)(__require);
    if (
      namespace?.default &&
      (typeof namespace.default === "object" ||
        typeof namespace.default === "function")
    ) {
      return Object.assign(namespace.default, namespace);
    }
    return namespace;
  }
  const name = __normalizePackageName(requested);
  if (Object.prototype.hasOwnProperty.call(__packageCatalog, name))
    return __packageCatalog[name];
  if (name.startsWith("@"))
    throw __blocked(
      `Package ${name} is not installed in the Rhythm Package Library.`,
    );
  throw __blocked(
    `Package ${name} is not in the approved Rhythm sandbox catalog.`,
  );
};
__require.resolve = (specifier) => __normalizePackageName(specifier);
__require.catalog = () => Object.keys(__packageCatalog).sort();

const __executionLocation = [
  String(__initial.info?.monitorId || "Monitor"),
  String(__initial.info?.requestName || __initial.info?.stepId || "Request"),
];
Object.defineProperty(__executionLocation, "current", {
  configurable: false,
  enumerable: false,
  value: __executionLocation[__executionLocation.length - 1],
  writable: false,
});

globalThis.pm = {
  variables: __resolved,
  environment: __scope(__stores.environment),
  collectionVariables: __scope(__stores.collection),
  globals: __scope(__stores.globals),
  iterationData: __scope(__stores.iterationData, false),
  cookies: __cookies,
  vault: {
    get: (alias) => Promise.resolve(__host.vaultGet(String(alias))),
    set: () =>
      Promise.reject(__blocked("Vault writes are blocked by Rhythm policy.")),
    unset: () =>
      Promise.reject(__blocked("Vault writes are blocked by Rhythm policy.")),
  },
  request: __request,
  response: __pmResponse,
  info: Object.assign(
    {
      eventName: "prerequest",
      iteration: 0,
      iterationCount: 1,
      runtimeVersion: "rhythm-js-2",
    },
    __initial.info || {},
  ),
  expect: __expect,
  test: __test,
  sendRequest: __sendRequest,
  visualizer: {
    set(template, data = {}, options = {}) {
      if (!__response)
        throw __contextError("pm.visualizer.set", "pre-request");
      globalThis.__visualizer = {
        template: String(template),
        data: __clone(data || {}),
        options: __clone(options || {}),
      };
    },
  },
  getData: (callback) => {
    const value = __visualizer?.data || {};
    if (callback) {
      callback(null, __clone(value));
      return;
    }
    return Promise.resolve(__clone(value));
  },
  require: __require,
  execution: {
    runRequest() {
      return Promise.reject(
        __contextError(
          "pm.execution.runRequest",
          "saved Postman collection requests; use pm.sendRequest for auxiliary HTTP calls in Rhythm",
        ),
      );
    },
    skipRequest() {
      if (__response) throw __contextError("pm.execution.skipRequest", "Tests");
      __execution.requestSkipped = true;
    },
    setNextRequest(value) {
      __execution.nextRequestSet = true;
      __execution.nextRequest =
        value == null ? "" : String(value?.id ?? value?.name ?? value);
    },
    location: __executionLocation,
  },
  datasets: __datasets,
  state: __state,
};
pm.test.skip = __test.skip;

Object.defineProperty(pm, "message", {
  get() {
    throw __contextError("pm.message", "HTTP scripts");
  },
});
Object.defineProperty(pm, "mock", {
  get() {
    throw __contextError("pm.mock", "HTTP scripts");
  },
});

globalThis.require = __require;
globalThis.console = {
  log: (...args) => __host.log("log", ...args),
  info: (...args) => __host.log("info", ...args),
  warn: (...args) => __host.log("warn", ...args),
  error: (...args) => __host.log("error", ...args),
  debug: (...args) => __host.log("debug", ...args),
  time: (label) => {
    __stores.variables[`__timer.${String(label)}`] = String(Date.now());
  },
  timeEnd: (label) => {
    const key = `__timer.${String(label)}`;
    const start = Number(__stores.variables[key] || Date.now());
    delete __stores.variables[key];
    __host.log("info", `${String(label)}: ${Date.now() - start}ms`);
  },
};

globalThis.setTimeout = (callback, milliseconds = 0, ...args) => {
  __host.sleep(Number(milliseconds));
  callback(...args);
  return 1;
};
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => {
  throw __blocked("setInterval is blocked because scripts must terminate.");
};
globalThis.clearInterval = () => {};
globalThis.queueMicrotask = (callback) => Promise.resolve().then(callback);
globalThis.structuredClone = __clone;
globalThis.atob = (value) => __host.base64Decode(String(value));
globalThis.btoa = (value) => __host.base64Encode(String(value));

globalThis.Event = class Event {
  constructor(type) {
    this.type = String(type);
    this.defaultPrevented = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
};
globalThis.EventTarget = class EventTarget {
  constructor() {
    this._events = {};
  }
  addEventListener(type, callback) {
    (this._events[type] ||= []).push(callback);
  }
  removeEventListener(type, callback) {
    this._events[type] = (this._events[type] || []).filter(
      (item) => item !== callback,
    );
  }
  dispatchEvent(event) {
    for (const callback of this._events[event.type] || []) callback(event);
    return !event.defaultPrevented;
  }
};
globalThis.AbortSignal = class AbortSignal extends EventTarget {
  constructor() {
    super();
    this.aborted = false;
    this.reason = undefined;
  }
  throwIfAborted() {
    if (this.aborted) throw this.reason || new Error("Aborted");
  }
};
globalThis.AbortController = class AbortController {
  constructor() {
    this.signal = new AbortSignal();
  }
  abort(reason = new Error("Aborted")) {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason;
    this.signal.dispatchEvent(new Event("abort"));
  }
};
globalThis.DOMException = class DOMException extends Error {
  constructor(message, name = "Error") {
    super(message);
    this.name = name;
  }
};

globalThis.TextEncoder = class TextEncoder {
  encode(value) {
    return Uint8Array.from(
      Array.from(unescape(encodeURIComponent(String(value)))).map((character) =>
        character.charCodeAt(0),
      ),
    );
  }
};
globalThis.TextDecoder = class TextDecoder {
  decode(value) {
    return decodeURIComponent(
      escape(String.fromCharCode(...Array.from(value || []))),
    );
  }
};
globalThis.TextEncoderStream = class TextEncoderStream {};
globalThis.TextDecoderStream = class TextDecoderStream {};
globalThis.Blob = class Blob {
  constructor(parts = [], options = {}) {
    this.type = String(options.type || "");
    this._bytes = new TextEncoder().encode(
      parts.map((part) => String(part)).join(""),
    );
    this.size = this._bytes.length;
  }
  text() {
    return Promise.resolve(new TextDecoder().decode(this._bytes));
  }
  arrayBuffer() {
    return Promise.resolve(this._bytes.buffer);
  }
  slice(start, end, type) {
    return new Blob([new TextDecoder().decode(this._bytes.slice(start, end))], {
      type,
    });
  }
};
globalThis.File = class File extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = String(name);
    this.lastModified = Number(options.lastModified || Date.now());
  }
};

globalThis.URLSearchParams = class URLSearchParams {
  constructor(init = "") {
    this._pairs = [];
    if (typeof init === "string") {
      for (const part of init.replace(/^\?/, "").split("&")) {
        if (!part) continue;
        const [key, ...rest] = part.split("=");
        this._pairs.push([
          decodeURIComponent(key.replace(/\+/g, " ")),
          decodeURIComponent(rest.join("=").replace(/\+/g, " ")),
        ]);
      }
    } else if (Array.isArray(init)) {
      this._pairs = init.map((pair) => [String(pair[0]), String(pair[1])]);
    } else if (init && typeof init === "object") {
      this._pairs = Object.entries(init).map((pair) => [
        String(pair[0]),
        String(pair[1]),
      ]);
    }
  }
  append(key, value) {
    this._pairs.push([String(key), String(value)]);
  }
  set(key, value) {
    this.delete(key);
    this.append(key, value);
  }
  get(key) {
    return (
      this._pairs.find((pair) => pair[0] === String(key))?.[1] ?? null
    );
  }
  getAll(key) {
    return this._pairs
      .filter((pair) => pair[0] === String(key))
      .map((pair) => pair[1]);
  }
  has(key) {
    return this._pairs.some((pair) => pair[0] === String(key));
  }
  delete(key) {
    this._pairs = this._pairs.filter((pair) => pair[0] !== String(key));
  }
  sort() {
    this._pairs.sort((left, right) => left[0].localeCompare(right[0]));
  }
  toString() {
    return this._pairs
      .map(
        (pair) =>
          `${encodeURIComponent(pair[0]).replace(/%20/g, "+")}=${encodeURIComponent(pair[1]).replace(/%20/g, "+")}`,
      )
      .join("&");
  }
  entries() {
    return this._pairs[Symbol.iterator]();
  }
  keys() {
    return this._pairs.map((pair) => pair[0])[Symbol.iterator]();
  }
  values() {
    return this._pairs.map((pair) => pair[1])[Symbol.iterator]();
  }
  forEach(callback) {
    for (const pair of this._pairs) callback(pair[1], pair[0], this);
  }
  [Symbol.iterator]() {
    return this.entries();
  }
};
globalThis.URL = class URL {
  constructor(raw, base = "") {
    const parsed = __host.parseURL(String(raw), String(base || ""));
    Object.assign(this, parsed);
    this.searchParams = new URLSearchParams(this.search);
  }
  toString() {
    const query = this.searchParams.toString();
    return `${this.origin}${this.pathname}${query ? `?${query}` : ""}${this.hash}`;
  }
  toJSON() {
    return this.toString();
  }
  static createObjectURL(blob) {
    if (!(blob instanceof Blob))
      throw new TypeError("URL.createObjectURL expects a Blob.");
    const id = `blob:rhythm/${__host.randomUUID()}`;
    __objectURLs.set(id, blob);
    return id;
  }
  static revokeObjectURL(id) {
    __objectURLs.delete(String(id));
  }
};

globalThis.ReadableStream = class ReadableStream {
  constructor(source = {}) {
    this._values = [];
    source.start?.({
      enqueue: (value) => this._values.push(value),
      close: () => {},
    });
  }
  getReader() {
    let index = 0;
    return {
      read: () =>
        Promise.resolve(
          index < this._values.length
            ? { value: this._values[index++], done: false }
            : { value: undefined, done: true },
        ),
      releaseLock: () => {},
    };
  }
};
globalThis.WritableStream = class WritableStream {};
globalThis.TransformStream = class TransformStream {};
globalThis.ByteLengthQueuingStrategy = class ByteLengthQueuingStrategy {};
globalThis.CountQueuingStrategy = class CountQueuingStrategy {};
globalThis.CompressionStream = class CompressionStream {
  constructor() {
    throw __blocked(
      "CompressionStream is unavailable in the deterministic runtime.",
    );
  }
};
globalThis.DecompressionStream = class DecompressionStream {
  constructor() {
    throw __blocked(
      "DecompressionStream is unavailable in the deterministic runtime.",
    );
  }
};

globalThis.Crypto = class Crypto {};
globalThis.CryptoKey = class CryptoKey {};
globalThis.SubtleCrypto = class SubtleCrypto {};
globalThis.crypto = {
  randomUUID: () => __host.randomUUID(),
  getRandomValues: (array) => {
    const bytes = __host.randomBytes(array.length);
    for (let index = 0; index < array.length; index++) array[index] = bytes[index];
    return array;
  },
  subtle: {
    digest: async (algorithm, data) =>
      Uint8Array.from(
        __host.digest(
          String(algorithm?.name || algorithm),
          new TextDecoder().decode(data),
        ),
      ).buffer,
    sign: async (algorithm, key, data) => {
      const hash =
        typeof algorithm === "object"
          ? typeof algorithm.hash === "string"
            ? algorithm.hash
            : algorithm.hash?.name
          : algorithm;
      return Uint8Array.from(
        __host.hmac(
          String(hash || "SHA-256"),
          String(key?.value ?? key),
          new TextDecoder().decode(data),
        ),
      ).buffer;
    },
    importKey: async (_format, key) => ({
      type: "secret",
      algorithm: { name: "HMAC" },
      value: new TextDecoder().decode(key),
    }),
  },
};

// Shared memory has deterministic, single-VM semantics in Rhythm. No host
// threads or cross-run memory are exposed.
globalThis.SharedArrayBuffer = ArrayBuffer;
globalThis.Atomics = {
  add(array, index, value) {
    const previous = array[index];
    array[index] += value;
    return previous;
  },
  sub(array, index, value) {
    const previous = array[index];
    array[index] -= value;
    return previous;
  },
  load: (array, index) => array[index],
  store(array, index, value) {
    array[index] = value;
    return value;
  },
  exchange(array, index, value) {
    const previous = array[index];
    array[index] = value;
    return previous;
  },
};

globalThis.fetch = undefined;
globalThis.XMLHttpRequest = undefined;
globalThis.process = undefined;
globalThis.WebAssembly = undefined;
