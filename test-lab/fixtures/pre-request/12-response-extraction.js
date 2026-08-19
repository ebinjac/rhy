const response = await rhythm.sendRequest({ url: "{{test_lab_url}}/extract/json" });
pm.variables.set("extracted_token", response.json().data.token);
pm.request.headers.upsert({ key: "Authorization", value: `Bearer ${response.json().data.token}` });

