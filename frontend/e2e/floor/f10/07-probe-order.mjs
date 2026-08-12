/* Why did the close not produce a journal entry? Ask pos-service what state the order is in. */
import { PEOPLE, newBrowser, newPage, login, apiGet, loadState, log } from "./lib.mjs";

const st = loadState();
const ORDER_ID = process.argv[2] ?? st.finalProof?.orderId;
const browser = await newBrowser();
try {
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);
  const r = await apiGet(cash, `/api/v1/pos/orders/${ORDER_ID}`);
  const o = r.body?.data ?? r.body;
  log("status:", r.status);
  log(
    JSON.stringify(
      {
        orderNo: o?.orderNo,
        status: o?.status,
        paymentStatus: o?.paymentStatus,
        totalPaisa: o?.totalPaisa,
        paidPaisa: o?.paidPaisa,
        closedAt: o?.closedAt,
        businessDate: o?.businessDate,
      },
      null,
      1,
    ),
  );
} finally {
  await browser.close();
}
