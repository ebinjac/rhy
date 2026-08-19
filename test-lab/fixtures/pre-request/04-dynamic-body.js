const transactionId = crypto.randomUUID();
const requestTimestamp = Date.now();
pm.variables.set("transactionId", transactionId);
pm.variables.set("requestTimestamp", requestTimestamp);
pm.request.body.raw = JSON.stringify({ transactionId, timestamp: requestTimestamp, environment: pm.environment.get("environment") || "DEV" });

