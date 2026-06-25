import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

// Dev-only browser worker. Started by the MswProvider when NEXT_PUBLIC_ENABLE_MSW
// is "true" — never bundled into a production runtime.
export const worker = setupWorker(...handlers);
