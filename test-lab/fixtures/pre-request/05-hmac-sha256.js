// TEST ONLY credentials matching POST /auth/hmac.
const clientId = "rhythm-client";
const secret = "rhythm-hmac-secret";
const timestamp = Date.now().toString();
const signature = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(`${clientId}-${timestamp}`, secret));
pm.request.headers.upsert({ key: "X-Client-ID", value: clientId });
pm.request.headers.upsert({ key: "X-Timestamp", value: timestamp });
pm.request.headers.upsert({ key: "X-Signature", value: signature });

