import { setupServer } from "msw/node";
import { handlers } from "./handlers";

// Node request-interception server used by Vitest (lifecycle in vitest.setup.ts).
export const server = setupServer(...handlers);
