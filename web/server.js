#!/usr/bin/env node
/* Tiny local server (no dependencies):
   - serves this website on http://127.0.0.1:8080
   - forwards /proxy/* to https://api.derivws.com so the browser avoids CORS problems.
   It binds to 127.0.0.1 only, so nobody else on your network can reach it.
   Your token passes through this process to Deriv and is never stored or logged. */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const TARGET = process.env.DERIV_REST_HOST || "api.derivws.com";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon",
};

http.createServer((req, res) => {
  if (req.url.startsWith("/proxy/")) {
    const headers = { host: TARGET };
    for (const k of ["authorization", "deriv-app-id", "content-type"]) if (req.headers[k]) headers[k] = req.headers[k];
    const up = https.request({ host: TARGET, path: req.url.slice("/proxy".length), method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode, { "content-type": r.headers["content-type"] || "application/json" });
      r.pipe(res);
    });
    up.on("error", (e) => { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ errors: [{ message: e.message }] })); });
    req.pipe(up);
    return;
  }
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}mock${path.sep}`) || file.endsWith("server.js")) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`Deriv Digit Bot site: http://127.0.0.1:${PORT}`));
