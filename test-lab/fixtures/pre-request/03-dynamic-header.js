const correlationId = crypto.randomUUID();
pm.variables.set("correlation_id", correlationId);
pm.request.headers.upsert({ key: "X-Correlation-ID", value: correlationId });

