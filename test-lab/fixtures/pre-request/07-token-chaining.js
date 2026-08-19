// HMAC dependency request -> token extraction -> main Bearer request.
const clientId = pm.environment.get("test_client_id") || "rhythm-app-client";
const secret = pm.environment.get("test_client_secret") || "cmh5dGhtLWFwcC1zZWNyZXQ=";
const version = "2";
const timestamp = Date.now().toString();
const secretBytes = CryptoJS.enc.Base64.parse(secret);
let signature = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(`${clientId}-${version}-${timestamp}`, secretBytes));
signature = signature.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const response = await rhythm.sendRequest({
  url: "{{test_lab_url}}/auth/application-token",
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Auth-AppID": clientId, "X-Auth-Signature": signature, "X-Auth-Timestamp": timestamp, "X-Auth-Version": version },
  body: { scope: ["*"] },
});
if (response.statusCode !== 200) throw new Error(`Authentication failed: ${response.statusCode}`);
const token = response.json().authorization_token;
pm.environment.set("test_auth_token", token);
pm.request.headers.upsert({ key: "Authorization", value: `Bearer ${token}` });

