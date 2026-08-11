import { createConnection, type Socket } from "node:net";

/**
 * AppSocket / JetDirect — "port 9100".
 *
 * <p>There is no protocol here. You open a TCP connection, you write bytes, the printer prints
 * them (research §5.1). There is no handshake, no status, and — the part that shapes this whole
 * file — <b>no acknowledgement</b>. The same research section quotes CUPS on the complete absence
 * of security in the scheme.
 *
 * <h2>What a resolved promise means, and what it does not</h2>
 *
 * <p>It means: the connection opened, every byte was handed to the kernel, the socket was
 * half-closed cleanly, and the peer closed without error. It does <b>NOT</b> mean paper moved. The
 * caller records this as `SENT`, never `PRINTED`, because a printer that is out of paper, jammed,
 * or has its cover open accepts the bytes exactly like one that is working.
 *
 * <h2>No connection pooling, deliberately</h2>
 *
 * <p>One connection per job, opened and closed. These devices commonly drop idle connections
 * without telling anyone, and a pooled socket that the printer quietly abandoned strands the NEXT
 * job behind a write that never completes. The cost of reconnecting is a few milliseconds; the cost
 * of a stuck queue is a kitchen that stops printing.
 */

export class TransportError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export interface Tcp9100Target {
  host: string;
  port: number;
  connectTimeoutMs: number;
  writeTimeoutMs: number;
}

export function sendOverTcp9100(bytes: Uint8Array, target: Tcp9100Target): Promise<void> {
  const where = `${target.host}:${target.port}`;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let socket: Socket;

    const fail = (detail: string, cause?: unknown): void => {
      if (settled) return;
      settled = true;
      // destroy(), not end(): the connection is already in a state we do not trust, and a
      // half-closed socket to a hung printer is one more thing holding a file descriptor.
      socket?.destroy();
      reject(new TransportError(`printer at ${where}: ${detail}`, cause));
    };

    const succeed = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      socket = createConnection({ host: target.host, port: target.port });
    } catch (err) {
      // A synchronous throw (a malformed host, for instance) must still surface as a transport
      // failure rather than as an exception escaping into the drain loop.
      reject(new TransportError(`printer at ${where}: could not open a socket`, err));
      return;
    }

    // Inactivity timeout. Until the connection is up this bounds the CONNECT; afterwards it is
    // reset to bound the write and the peer's close. A printer that accepts a connection and then
    // hangs — firmware wedged, which is a real failure on these devices — is caught here and
    // nowhere else.
    socket.setTimeout(target.connectTimeoutMs);

    socket.once("error", (err) => fail(describe(err), err));

    socket.once("timeout", () =>
      fail(
        `timed out after ${socket.connecting ? target.connectTimeoutMs : target.writeTimeoutMs}ms ` +
          `(${socket.connecting ? "connecting" : "writing"}). The job is NOT delivered.`,
      ),
    );

    socket.once("connect", () => {
      socket.setTimeout(target.writeTimeoutMs);
      socket.write(bytes, (err) => {
        if (err) {
          fail("the write failed part-way through; the job must be retried", err);
          return;
        }
        // Half-close. On a 9100 device this is what says "the job ends here".
        socket.end();
      });
    });

    socket.once("close", (hadError) => {
      // BACKSTOP, not the primary path — and the test suite does not independently cover it.
      // Node emits `error` before `close`, so for every failure this transport actually meets
      // (refused, reset, EPIPE) the error handler above has already settled the promise and this
      // branch never runs. Verified by deleting it: the suite stayed green. It is kept because a
      // close-with-error that somehow arrives WITHOUT a preceding `error` event must not resolve
      // as a successful delivery — but that is a defensive belief, not a tested one, and saying
      // otherwise would put it on the list of things here that looked rigorous and could not fail.
      if (hadError) {
        fail("the connection closed with an error before the job was fully written");
        return;
      }
      succeed();
    });
  });
}

function describe(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  switch (code) {
    case "ECONNREFUSED":
      return "connection refused — nothing is listening. Check the printer is powered on and on this address.";
    case "EHOSTUNREACH":
      return "host unreachable — the printer is not on this network segment.";
    case "ENOTFOUND":
      return "host not found — the name does not resolve.";
    case "ECONNRESET":
    case "EPIPE":
      return "the printer closed the connection mid-job; the receipt is at best half printed and must be retried";
    default:
      return `connection failed (${code ?? String(err)})`;
  }
}
