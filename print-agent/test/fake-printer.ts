import { createServer, type Server, type Socket } from "node:net";

/**
 * A fake thermal printer on an ephemeral TCP port.
 *
 * <p>The emulator's transport-level sibling. The emulator proves the renderer produced the right
 * bytes; this proves those bytes survive a socket — and because the assertion decodes what the
 * SERVER RECEIVED rather than what the renderer returned, a renderer bug and a transport bug
 * cannot cancel each other out.
 *
 * <p>It can also misbehave in the three ways a real printer on a restaurant LAN misbehaves:
 * refuse the connection, accept and then stall, and close mid-stream. Each of those is a way a job
 * can fail, and each must be reported as a FAILURE rather than quietly counted as printed.
 */
export type FakePrinterMode = "accept" | "stall" | "close-mid-stream";

export class FakePrinter {
  private server: Server | null = null;
  private readonly chunks: Buffer[] = [];
  private readonly sockets = new Set<Socket>();

  /** How many separate TCP connections have been accepted. Proves there is no pooling. */
  connectionCount = 0;

  constructor(
    private mode: FakePrinterMode = "accept",
    /** For `close-mid-stream`: destroy the socket once this many bytes have arrived. */
    private readonly closeAfterBytes = 0,
  ) {}

  async listen(): Promise<number> {
    this.server = createServer((socket) => {
      this.connectionCount += 1;
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      // A stalled printer accepts the connection and then does nothing at all — no reads, no
      // close. This is the shape of a device whose firmware has hung, and it is the failure that
      // wedges a queue if the client has no timeout.
      if (this.mode === "stall") {
        socket.pause();
        return;
      }
      let received = 0;
      socket.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (this.mode === "close-mid-stream" && received >= this.closeAfterBytes) {
          socket.destroy();
          return;
        }
        this.chunks.push(chunk);
      });
      socket.on("error", () => {
        /* a client vanishing is not this fake's problem */
      });
      // Mirror a real 9100 device: when the client half-closes, the job is over.
      socket.on("end", () => socket.end());
    });

    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server!.address();
    if (address === null || typeof address === "string") {
      throw new Error("the fake printer did not get a TCP port");
    }
    return address.port;
  }

  /**
   * A port with NOTHING listening on it, so a connection is genuinely refused by the kernel.
   *
   * <p>Binding and immediately closing is the reliable way to obtain one — asking for a port
   * nobody happens to be using is a race.
   */
  static async refusedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const port = address.port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  received(): Uint8Array {
    return new Uint8Array(Buffer.concat(this.chunks));
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (this.server !== null) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }
}
