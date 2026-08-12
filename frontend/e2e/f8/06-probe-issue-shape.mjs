/*
 * Step 6 — is the RUNNING pos-service serving the new issue shape? Probe it on the persona's own
 * bearer rather than reading the source, because a jar on disk is not a jar in a JVM.
 */
import { newBrowser, newPage, login, PEOPLE, apiGet, apiSend } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);

  const branches = await apiGet(page, "/api/v1/branches");
  const branch = (branches.body?.data ?? []).find((b) => b.isHq);
  console.log("branch:", branch?.id, branch?.name);

  const orders = await apiGet(
    page,
    `/api/v1/pos/orders?branchId=${branch.id}&page=0&size=5&status=CLOSED`,
  );
  const list = orders.body?.data?.content ?? orders.body?.data ?? [];
  console.log("orders status:", orders.status, "count:", Array.isArray(list) ? list.length : "?");
  const order = Array.isArray(list) ? list[0] : null;
  if (!order) {
    console.log("body:", JSON.stringify(orders.body).slice(0, 800));
    throw new Error("no closed order to issue a bill for");
  }
  console.log("order:", order.orderId, order.orderNo);

  const issued = await apiSend(
    page,
    "POST",
    `/api/v1/pos/orders/${order.orderId}/print-jobs?branchId=${branch.id}`,
    undefined,
  );
  const d = issued.body?.data;
  console.log("issue status:", issued.status);
  console.log(
    "shape:",
    JSON.stringify({
      printJobId: d?.printJobId,
      targetPrinterId: d?.targetPrinterId,
      status: d?.status,
      agent: d?.agent,
    }),
  );
  if (d?.agent === undefined || d?.status === undefined) {
    console.log("=> the running pos-service does NOT carry the F8 fields yet");
  } else {
    console.log("=> the running pos-service DOES carry the F8 fields");
  }
} finally {
  await browser.close();
}
