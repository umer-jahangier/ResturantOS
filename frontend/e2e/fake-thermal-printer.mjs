// A captured "thermal printer": accepts raw ESC/POS on a TCP port and appends every byte to a file.
//
//   node e2e/fake-thermal-printer.mjs 9100 /tmp/receipt-printer.bin &
//   node e2e/fake-thermal-printer.mjs 9101 /tmp/kitchen-printer.bin &
//
// This is what makes `verify-s1-06-printers.mjs` runnable on a machine with no printer attached,
// and it is the difference between "the request was accepted" and "these are the bytes the printer
// received". The agent's TCP transport cannot tell this from a Star or an Epson: it opens a socket
// to host:9100 and writes, which is the whole protocol.
//
// Read the capture with the ESC/POS control bytes stripped:
//   python3 -c "import re,sys;print(re.sub(rb'\x1b.|\x1d.',b'',open(sys.argv[1],'rb').read()).decode('latin1'))" /tmp/receipt-printer.bin
import { createServer } from "node:net";
import { appendFileSync, writeFileSync } from "node:fs";

const port = Number(process.argv[2]);
const out = process.argv[3];

if (!Number.isInteger(port) || !out) {
  console.error("usage: node e2e/fake-thermal-printer.mjs <port> <capture-file>");
  process.exit(2);
}

// Truncated on start, so a run's assertions are about a run's bytes.
writeFileSync(out, "");

createServer((socket) => {
  console.log(`[${port}] connection`);
  // Appended synchronously: the assertion reads this file the moment the agent reports the job
  // sent, and a buffered write would make a real delivery look like a missing one.
  socket.on("data", (chunk) => appendFileSync(out, chunk));
  socket.on("end", () => console.log(`[${port}] end`));
  socket.on("error", (e) => console.log(`[${port}] socket error: ${e.message}`));
}).listen(port, "127.0.0.1", () => console.log(`fake thermal printer on 127.0.0.1:${port} -> ${out}`));
