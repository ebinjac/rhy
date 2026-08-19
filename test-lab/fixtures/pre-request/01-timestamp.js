// Adds a millisecond timestamp to the current request.
const timestamp = Date.now().toString();
pm.environment.set("timestamp", timestamp);
pm.request.headers.upsert({ key: "X-Timestamp", value: timestamp });

