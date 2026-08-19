const started = await rhythm.sendRequest({ url: "{{test_lab_url}}/chain/start", method: "POST" });
const chainId = started.json().chainId;
const tokenResponse = await rhythm.sendRequest({ url: `{{test_lab_url}}/chain/token?chainId=${chainId}` });
const token = tokenResponse.json().token;
const sessionResponse = await rhythm.sendRequest({ url: `{{test_lab_url}}/chain/session?chainId=${chainId}`, headers: { Authorization: `Bearer ${token}` } });
pm.variables.set("chain_id", chainId);
pm.request.setUrl(`{{test_lab_url}}/chain/protected?chainId=${chainId}`);
pm.request.headers.upsert({ key: "X-Session-ID", value: sessionResponse.json().sessionId });

