/**
 * The browser's only conversation with the local print agent.
 *
 * <h2>What this is NOT</h2>
 *
 * <p>It is not the receipt path. Receipts and kitchen tickets reach a printer through the SERVER:
 * pos-service writes a `print_jobs` row on close and on fire, and the agent claims it on its own
 * poll. That is the shipped architecture and it is why the register's "browser requests to :7654 =
 * 0" was measuring the wrong thing — nothing is supposed to be printing from the tab.
 *
 * <p>This file exists for the two things the server genuinely cannot do, because both are
 * diagnostics ABOUT the local machine and neither belongs to an order:
 *
 * <ul>
 *   <li><b>Is the agent on this machine running?</b> A `lastSeenAt` on the server proves an agent
 *       somewhere in the branch is polling. It does not prove the one in front of you is.</li>
 *   <li><b>Test print / column ruler.</b> A calibration page has no order, and `print_jobs.order_id`
 *       is NOT NULL, so it has no row to be. The agent renders it itself (26-06's
 *       {@code renderTestPage}) and the browser asks for it.</li>
 * </ul>
 *
 * <h2>Every failure is named, and none of them is fatal</h2>
 *
 * <p>Research §6.2 records that Chrome's local-network-access denial surfaces as an ordinary
 * network error, indistinguishable from "no agent installed" unless handled deliberately, and that
 * Safari has no such permission at all and blocks the loopback call as mixed content. One is an
 * install, one is a click, one is a browser that will never do this. They get three messages.
 *
 * <p>Nothing here throws into a settlement. This module is only reachable from the Printers screen.
 */

export type AgentReachability =
  | "REACHABLE"
  | "NOT_RUNNING"
  | "BLOCKED_MIXED_CONTENT"
  | "BLOCKED_LOCAL_NETWORK"
  | "REFUSED_SECRET";

export interface AgentHealth {
  reachability: AgentReachability;
  /** What to say to the person standing at the till. Never a stack trace. */
  detail: string;
  version?: string;
  printerIds?: string[];
}

export type TestPrintOutcome = "DELIVERED" | "QUEUED" | "UNKNOWN_PRINTER" | "UNREACHABLE";

export interface TestPrintResult {
  outcome: TestPrintOutcome;
  detail: string;
}

const TIMEOUT_MS = 4_000;

function isMixedContentBlocked(baseUrl: string): boolean {
  // An https page calling http://127.0.0.1 is blocked outright by Safari and by any browser with
  // strict mixed-content upgrading. Detectable BEFORE the request, which is the only way to give
  // the user a message that is true rather than "network error".
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:" && baseUrl.startsWith("http://");
}

async function withTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal, mode: "cors" });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeAgent(baseUrl: string): Promise<AgentHealth> {
  const url = baseUrl.replace(/\/+$/, "");
  if (isMixedContentBlocked(url)) {
    return {
      reachability: "BLOCKED_MIXED_CONTENT",
      detail:
        "This page is served over HTTPS and the agent listens on plain HTTP loopback, so the " +
        "browser blocks the call before it is made. This is not a permission you can grant. " +
        "Printing itself is unaffected — the agent collects jobs from the server on its own.",
    };
  }
  try {
    const response = await withTimeout(`${url}/health`);
    if (response.status === 401) {
      return {
        reachability: "REFUSED_SECRET",
        detail:
          "The agent answered but refused the request: it is configured with a shared secret " +
          "this browser does not send. Bind the agent to loopback, or clear PRINT_AGENT_SECRET.",
      };
    }
    if (!response.ok) {
      return { reachability: "NOT_RUNNING", detail: `The agent answered HTTP ${response.status}.` };
    }
    const body = (await response.json()) as {
      version?: string;
      printers?: { id: string }[];
    };
    return {
      reachability: "REACHABLE",
      detail: "The print agent on this machine is running.",
      version: body.version,
      printerIds: (body.printers ?? []).map((p) => p.id),
    };
  } catch {
    // Genuinely ambiguous: no agent, or a local-network-access denial. Say both, in that order,
    // because the first is overwhelmingly the common case and the second is a click if it is not.
    return {
      reachability: "NOT_RUNNING",
      detail:
        "No print agent answered on this machine. Either it is not running here, or this " +
        "browser refused the local-network request — check the address bar for a blocked-request " +
        "icon. Jobs already queued are not lost: the agent collects them when it starts.",
    };
  }
}

/**
 * Ask the agent for its calibration page.
 *
 * <p>Reports what the AGENT said, in the agent's own three states. A 202 means the job is on the
 * agent's disk and the printer did not answer — which is not a failure and must not be shown as
 * one, because the drain loop will keep trying and the paper will appear.
 *
 * <p>It never reports "printed". Neither a TCP socket nor a spooler tells anyone that paper moved.
 */
export async function requestTestPrint(
  baseUrl: string,
  targetPrinterId: string,
): Promise<TestPrintResult> {
  const url = baseUrl.replace(/\/+$/, "");
  try {
    const response = await withTimeout(`${url}/test-print`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetPrinterId }),
    });
    if (response.status === 404) {
      return {
        outcome: "UNKNOWN_PRINTER",
        detail:
          `The agent does not yet know a printer called "${targetPrinterId}". It learns the ` +
          "registry from the server on its next poll — save first, then wait a few seconds.",
      };
    }
    const body = (await response.json()) as { state?: string; reason?: string };
    if (response.status === 202 || body.state === "QUEUED") {
      return {
        outcome: "QUEUED",
        detail:
          "Accepted and written to the agent's queue, but the printer did not answer" +
          (body.reason ? ` — ${body.reason}` : "") +
          ". The agent will keep trying.",
      };
    }
    return {
      outcome: "DELIVERED",
      detail:
        "The bytes reached the printer. That is not the same as paper moving — go and look at " +
        "the ruler line, and correct the column count if it does not end where it says it does.",
    };
  } catch {
    return {
      outcome: "UNREACHABLE",
      detail:
        "No print agent answered on this machine, so nothing was sent. Start the agent here, or " +
        "run this test from the till the printer is attached to.",
    };
  }
}
