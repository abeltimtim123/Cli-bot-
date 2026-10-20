/* Fake Deriv server for testing only (never served by server.js).
   REST on :9100 (accounts + OTP), WebSocket on :9100/ws. Needs the `ws` package. */
const http = require("http");
const { WebSocketServer } = require("ws");
const PORT = 9100;
let cid = 1000;

const accounts = [
  { account_id: "DOT90004580", account_type: "demo", currency: "USD", balance: 10000 },
  { account_id: "ROT12345678", account_type: "real", currency: "USD", balance: 50 },
];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,deriv-app-id,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const ok = req.headers.authorization === "Bearer pat_test" && req.headers["deriv-app-id"] === "APPID123";
  if (!ok) { res.writeHead(401, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ errors: [{ status: 401, message: "Invalid or missing authentication credentials" }] })); }
  res.writeHead(200, { ...cors, "content-type": "application/json" });
  if (req.method === "GET" && req.url === "/trading/v1/options/accounts") return res.end(JSON.stringify({ data: accounts }));
  const m = req.url.match(/^\/trading\/v1\/options\/accounts\/([^/]+)\/otp$/);
  if (req.method === "POST" && m) return res.end(JSON.stringify({ data: { url: `ws://127.0.0.1:${PORT}/ws?acct=${m[1]}&otp=x` } }));
  res.end("{}");
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  const acct = new URL(req.url, "http://x").searchParams.get("acct");
  let tickTimer = null, open = [];
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw), id = m.req_id;
    if (m.ping) return send({ ping: "pong" });
    if (m.balance) return send({ balance: { balance: 1000, currency: "USD" }, req_id: id });
    if (m.ticks) {
      let first = true;
      tickTimer = setInterval(() => {
        const q = ((100000 + Math.floor(Math.random() * 99999)) / 100).toFixed(2);
        const digit = Number(q.slice(-1));
        send({ tick: { quote: Number(q), pip_size: 2, symbol: m.ticks, epoch: Date.now() / 1000 | 0 }, ...(first ? { req_id: id } : {}) });
        first = false;
        const still = [];
        for (const c of open) {
          const win = c.type === "DIGITOVER" ? digit > c.barrier : digit < c.barrier;
          const profit = win ? +(c.stake * 0.1).toFixed(2) : -c.stake;
          send({ proposal_open_contract: { contract_id: c.id, is_sold: 1, profit, status: win ? "won" : "lost" } });
        }
        open = still;
      }, 120);
      return;
    }
    if (m.buy) {
      const p = m.parameters;
      if (p.amount > 5) return send({ error: { code: "InvalidStake", message: "stake too high" }, req_id: id });
      const c = { id: ++cid, type: p.contract_type, barrier: Number(p.barrier), stake: p.amount };
      send({ buy: { contract_id: c.id, buy_price: p.amount, payout: p.amount * 1.1 }, req_id: id });
      open.push(c);
      return;
    }
    if (m.proposal_open_contract) return send({ proposal_open_contract: { contract_id: m.contract_id, is_sold: 0 }, req_id: id });
  });
  ws.on("close", () => clearInterval(tickTimer));
});
server.listen(PORT, "127.0.0.1", () => console.log("mock deriv on", PORT));
