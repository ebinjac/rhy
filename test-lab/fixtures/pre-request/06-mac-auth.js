// TEST ONLY MAC signature matching POST /auth/mac.
const key = "rhythm-mac-key";
const secret = "rhythm-mac-secret";
const ts = Date.now().toString();
const nonce = rhythm.random.string(36);
const requestUrl = new URL(pm.variables.replaceIn(pm.request.url.toString()));
const payload = pm.request.body && pm.request.body.raw ? pm.variables.replaceIn(pm.request.body.raw) : "";
const bodyHash = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(payload, secret));
const port = requestUrl.port || (requestUrl.protocol === "http:" ? "80" : "443");
const canonical = `${ts}\n${nonce}\n${pm.request.method}\n${requestUrl.pathname}${requestUrl.search}\n${requestUrl.hostname}\n${port}\n${bodyHash}\n`;
const mac = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(canonical, secret));
pm.request.headers.upsert({ key: "Authorization", value: `MAC id="${key}",ts="${ts}",nonce="${nonce}",bodyhash="${bodyHash}",mac="${mac}"` });

