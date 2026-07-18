import { setupServer } from "msw/node";
import { handlers } from "./handlers";
import { purchasingHandlers } from "./purchasing.handlers";
import { financeHandlers } from "./finance.handlers";
import { reportingHandlers } from "./reporting";
import { nlqHandlers } from "./nlq";

// Node request-interception server used by Vitest (lifecycle in vitest.setup.ts).
export const server = setupServer(
  ...handlers,
  ...purchasingHandlers,
  ...financeHandlers,
  ...reportingHandlers,
  ...nlqHandlers,
);
