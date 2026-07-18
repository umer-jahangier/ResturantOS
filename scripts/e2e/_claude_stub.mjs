// A tiny local stand-in for the Anthropic Messages API, used ONLY for driving the NLQ negative
// security controls (scripts/e2e/phase12-nlq-security-e2e.sh Part B3). It returns
// attacker-chosen SQL verbatim, from a file that the driving bash script rewrites before each
// call — a faithful model of a hallucinating or prompt-injected Claude. The 7-stage AST validator
// in nlq-service must reject hostile SQL regardless of where it came from.
//
// Usage: node _claude_stub.mjs <port> <sqlFilePath>
import http from "node:http";
import fs from "node:fs";

const PORT = process.argv[2] || 9911;
const SQL_FILE = process.argv[3] || "/tmp/nlq-e2e-next-sql.txt";

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/v1/messages" && req.method === "POST") {
      let sql = "SELECT 1";
      try {
        sql = fs.readFileSync(SQL_FILE, "utf8").trim();
      } catch {
        // default
      }
      const payload = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: sql }],
        model: "claude-sonnet-stub",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
});

server.listen(PORT, () => {
  console.log(`claude-stub listening on :${PORT}, reading SQL from ${SQL_FILE}`);
});
