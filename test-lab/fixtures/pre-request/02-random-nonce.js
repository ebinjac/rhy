// Generates the 36-character nonce expected by /trace/nonce.
let nonce = "";
const charset = "abcdefghijklmnopqrstuvwxyz0123456789";
for (let index = 0; index < 36; index += 1) nonce += charset.charAt(Math.floor(Math.random() * charset.length));
pm.environment.set("nonce", nonce);
pm.request.headers.upsert({ key: "X-Nonce", value: nonce });

