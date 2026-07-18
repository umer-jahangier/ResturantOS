// Measures elapsed ms between a real POS order close and the dashboard WebSocket tile push.
// Connects DIRECTLY to reporting-service (bypassing the gateway) because the gateway's
// JwtGlobalFilter has no query-param JWT fallback and neither /api/v1/reporting/dashboard nor
// /api/v1/kitchen is in its PUBLIC_PATHS allowlist — see 12-E2E-EVIDENCE.md for the full finding.
//
// Usage: node _ws_close_latency.mjs <branchId> <ownerJwt> <gatewayBaseUrl> <reportingDirectBaseUrl>
const [, , branchId, token, gatewayBase, reportingDirectBase] = process.argv;
const wsBase = (reportingDirectBase || "http://localhost:8092").replace(/^http/, "ws");
const httpBase = gatewayBase || "http://localhost:8080";

// The gateway's Resilience4j circuit breaker on a cold/idle lb://<service> pool intermittently
// answers the FIRST request after a quiet period with its own SERVICE_UNAVAILABLE fallback even
// though the request landed and the backend processed it correctly (the 10-13-H/10-14-E failure
// mode). Retry once before treating it as a real failure.
async function post(path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${httpBase}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (json?.error?.code === "SERVICE_UNAVAILABLE" && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (json?.data === undefined && json?.error) {
      throw new Error(`${path} -> ${JSON.stringify(json.error)}`);
    }
    return json;
  }
}

async function main() {
  const ws = new WebSocket(`${wsBase}/api/v1/reporting/dashboard/${branchId}?token=${token}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
    setTimeout(() => reject(new Error("WS did not open in 5s")), 5000);
  });
  console.log("WS OPEN (direct to reporting-service)");

  const clientOrderId = crypto.randomUUID();
  const order = await post("/api/v1/pos/orders", {
    branchId,
    clientOrderId,
    type: "DINE_IN",
    coverCount: 1,
  });
  const orderId = order.data.id;
  const itemResp = await post(`/api/v1/pos/orders/${orderId}/items`, {
    menuItemId: "e2e00002-0000-4000-8000-000000000001",
    branchId,
    quantity: 1,
  });
  const lineId = itemResp.data.items[0].id;
  await post(`/api/v1/pos/orders/${orderId}/send-to-kds`);
  await post(`/api/v1/pos/orders/${orderId}/items/${lineId}/serve`);

  const closeStart = Date.now();
  await post(`/api/v1/pos/orders/${orderId}/payments`, { method: "CASH", amountPaisa: 11000 });

  const messagePromise = new Promise((resolve, reject) => {
    ws.addEventListener("message", (ev) => resolve({ ts: Date.now(), data: ev.data }));
    setTimeout(() => reject(new Error("no push within 10s")), 10000);
  });

  try {
    const { ts, data } = await messagePromise;
    const elapsedMs = ts - closeStart;
    console.log(`PUSH RECEIVED elapsedMs=${elapsedMs}`);
    console.log(`Tile payload: ${data}`);
    if (elapsedMs < 5000) {
      console.log(`PASS: dashboard tile pushed in ${elapsedMs}ms (< 5000ms)`);
    } else {
      console.log(`FAIL: dashboard tile pushed in ${elapsedMs}ms (>= 5000ms)`);
      process.exitCode = 1;
    }
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    process.exitCode = 1;
  } finally {
    ws.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
