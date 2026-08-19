const response = await rhythm.sendRequest({ url: "{{test_lab_url}}/auth/jwt/token", method: "POST", headers: { "Content-Type": "application/json" }, body: { algorithm: "HS256" } });
if (response.statusCode !== 200) throw new Error("JWT issuance failed");
pm.variables.set("jwt_token", response.json().token);
pm.request.headers.upsert({ key: "Authorization", value: `Bearer ${response.json().token}` });

