import { existsSync, readFileSync } from "node:fs";

/**
 * The agent's own settings.
 *
 * <p>Read from a JSON file and overridable by environment variables, because a till is configured
 * by whoever set it up and a container is configured by whoever deployed it, and neither should
 * have to fight the other.
 *
 * <p>The printer registry is supplied LOCALLY in this plan. Plan 26-11 lets the agent pull it from
 * the server; the shape here is the one 26-02 defined, so that change is a source swap and not a
 * re-model.
 */

export type PrinterRole = "RECEIPT" | "KITCHEN";
export type PrinterTransport = "TCP" | "SYSTEM";
export type CutMode = "NONE" | "PARTIAL" | "FULL";

/** The subset of 26-02's `PrinterEntry` the agent acts on. Field names match that plan exactly. */
export interface PrinterEntry {
  id: string;
  terminalId: string | null;
  role: PrinterRole;
  stationCode: string | null;
  transport: PrinterTransport;
  host: string | null;
  port: number | null;
  systemPrinterName: string | null;
  widthMm: number;
  columns: number;
  columnsMeasured: boolean;
  codepage: string;
  cut: CutMode;
  drawerPin: number | null;
  drawerPulseMs: number | null;
}

export interface AgentConfig {
  /**
   * LOOPBACK BY DEFAULT. This is a write endpoint with no user authentication on it, and binding
   * it to the wildcard address by default would expose "print anything on this branch's printers"
   * to every device on the LAN — including the guest wifi, on most restaurant networks.
   */
  bindAddress: string;
  port: number;
  /**
   * Required as soon as the bind address is not loopback. Enforced in {@link loadConfig} rather
   * than at request time, so a misconfigured agent refuses to START instead of running wide open.
   */
  sharedSecret: string | null;
  journalPath: string;
  /** Mirrors the POS offline outbox's `MAX_ATTEMPTS = 5`, so the two queues in this product fail alike. */
  maxAttempts: number;
  /** How long a terminal record is kept before compaction may drop it. */
  retentionMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  connectTimeoutMs: number;
  writeTimeoutMs: number;
  printers: PrinterEntry[];
}

export class ConfigError extends Error {
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = "ConfigError";
  }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export const DEFAULTS = {
  bindAddress: "127.0.0.1",
  port: 7654,
  maxAttempts: 5,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  baseBackoffMs: 1_000,
  maxBackoffMs: 5 * 60 * 1000,
  connectTimeoutMs: 5_000,
  writeTimeoutMs: 10_000,
} as const;

export function loadConfig(
  filePath: string | null,
  env: NodeJS.ProcessEnv = process.env,
): AgentConfig {
  const fromFile: Record<string, unknown> =
    filePath !== null && existsSync(filePath)
      ? (JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>)
      : {};

  const bindAddress = str(env.PRINT_AGENT_BIND ?? fromFile.bindAddress, DEFAULTS.bindAddress);
  const sharedSecret = optionalStr(env.PRINT_AGENT_SECRET ?? fromFile.sharedSecret);

  if (!LOOPBACK.has(bindAddress) && (sharedSecret === null || sharedSecret.length === 0)) {
    throw new ConfigError(
      "sharedSecret",
      `the agent is configured to bind ${bindAddress}, which is not loopback, and no shared ` +
        "secret is set. Refusing to start: an unauthenticated print endpoint on a restaurant LAN " +
        "lets anything on the network — guest wifi included — print on the branch's printers.",
    );
  }

  const config: AgentConfig = {
    bindAddress,
    port: num(env.PRINT_AGENT_PORT ?? fromFile.port, DEFAULTS.port, "port"),
    sharedSecret,
    journalPath: str(env.PRINT_AGENT_JOURNAL ?? fromFile.journalPath, "./.print-agent/queue.jsonl"),
    maxAttempts: num(env.PRINT_AGENT_MAX_ATTEMPTS ?? fromFile.maxAttempts, DEFAULTS.maxAttempts, "maxAttempts"),
    retentionMs: num(fromFile.retentionMs, DEFAULTS.retentionMs, "retentionMs"),
    baseBackoffMs: num(fromFile.baseBackoffMs, DEFAULTS.baseBackoffMs, "baseBackoffMs"),
    maxBackoffMs: num(fromFile.maxBackoffMs, DEFAULTS.maxBackoffMs, "maxBackoffMs"),
    connectTimeoutMs: num(fromFile.connectTimeoutMs, DEFAULTS.connectTimeoutMs, "connectTimeoutMs"),
    writeTimeoutMs: num(fromFile.writeTimeoutMs, DEFAULTS.writeTimeoutMs, "writeTimeoutMs"),
    printers: parsePrinters(fromFile.printers),
  };

  if (config.maxAttempts < 1) {
    throw new ConfigError("maxAttempts", `must be at least 1; received ${config.maxAttempts}`);
  }
  return config;
}

export function isLoopback(address: string): boolean {
  return LOOPBACK.has(address);
}

/**
 * Transport consistency is checked HERE, at load, not at print time.
 *
 * <p>A printer entry missing its host is a mistake somebody made while configuring a branch. If it
 * surfaces when a customer is standing at the counter waiting for a receipt, it has surfaced in the
 * worst possible place. The agent refuses to start instead.
 */
function parsePrinters(raw: unknown): PrinterEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ConfigError("printers", "must be an array");

  return raw.map((entry, index) => {
    const path = `printers[${index}]`;
    const p = entry as Record<string, unknown>;
    const transport = p.transport;
    if (transport !== "TCP" && transport !== "SYSTEM") {
      throw new ConfigError(
        `${path}.transport`,
        `"${String(transport)}" is not a transport this agent can drive. Known: TCP, SYSTEM.`,
      );
    }
    if (transport === "TCP" && (typeof p.host !== "string" || p.host.length === 0)) {
      throw new ConfigError(`${path}.host`, "a TCP printer needs a host");
    }
    if (transport === "TCP" && typeof p.port !== "number") {
      throw new ConfigError(`${path}.port`, "a TCP printer needs a port");
    }
    if (transport === "SYSTEM" && (typeof p.systemPrinterName !== "string" || p.systemPrinterName.length === 0)) {
      throw new ConfigError(`${path}.systemPrinterName`, "a SYSTEM printer needs a queue name");
    }
    if (typeof p.columns !== "number" || !Number.isInteger(p.columns) || p.columns < 1) {
      throw new ConfigError(`${path}.columns`, "a measured column count is required");
    }
    return {
      id: String(p.id ?? ""),
      terminalId: p.terminalId == null ? null : String(p.terminalId),
      role: p.role === "KITCHEN" ? "KITCHEN" : "RECEIPT",
      stationCode: p.stationCode == null ? null : String(p.stationCode),
      transport,
      host: p.host == null ? null : String(p.host),
      port: p.port == null ? null : Number(p.port),
      systemPrinterName: p.systemPrinterName == null ? null : String(p.systemPrinterName),
      widthMm: Number(p.widthMm ?? 80),
      columns: p.columns,
      columnsMeasured: Boolean(p.columnsMeasured),
      codepage: String(p.codepage ?? "CP437"),
      cut: (p.cut as CutMode) ?? "PARTIAL",
      drawerPin: p.drawerPin == null ? null : Number(p.drawerPin),
      drawerPulseMs: p.drawerPulseMs == null ? null : Number(p.drawerPulseMs),
    };
  });
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new ConfigError(field, `expected a number, received ${String(value)}`);
  return n;
}
