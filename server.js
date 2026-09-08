#!/usr/bin/env node
/**
 * Static file server + same-origin reverse proxy.
 *
 * Why this exists: the Ottfree backend (aiohttp) doesn't send CORS headers,
 * so calling it directly from a browser on a different origin fails outright.
 * Rather than depend on the backend adding CORS support, this process serves
 * the frontend AND transparently proxies every "/api-proxy/*" request to the
 * real backend server-side (no browser involved in that hop, so CORS doesn't
 * apply). The browser only ever talks to this one origin.
 *
 * Used for:
 *  - Render "Web Service" deploys (reads PORT from the environment)
 *  - Local hosting, including inside Termux on Android
 *  - Any other plain Node host (a VPS, Fly.io, Railway, etc.)
 *
 * Render "Static Site" deploys don't run this file — see DEPLOY.md for why
 * that mode needs the backend's CORS fixed instead, since there's no process
 * to proxy through.
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");

const ROOT = __dirname;

// Minimal .env support (no dependency) so `npm start` alone picks up
// OTTFREE_API_URL / OTTFREE_PORT without requiring `npm run build` first.
// Real environment variables (e.g. set in Render's dashboard) always win.
(function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const PORT = process.env.PORT || process.env.OTTFREE_PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";

// The real backend. Defaults to the API this project ships pointed at;
// override with OTTFREE_API_URL (Render dashboard, or a local .env — see
// .env.example) without touching any code.
const API_TARGET = normalizeTarget(process.env.OTTFREE_API_URL || "https://ucapi-jtrl.onrender.com");
const API_PREFIX = "/api-proxy"; // internal mount point the browser calls, distinct from the backend's own "/api/thumb" route

function normalizeTarget(u) {
  const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  return withProto.replace(/\/+$/, "");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root)) return null; // block path traversal
  return resolved;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

// ---------------------------------------------------------------------
// Reverse proxy: browser -> this server -> real backend, no CORS involved
// on either hop.
// ---------------------------------------------------------------------

function rewriteSetCookie(values) {
  return values.map((v) =>
    v
      .replace(/;\s*Domain=[^;]+/i, "") // scope the cookie to whatever host is actually serving the browser
      .replace(/;\s*Secure/i, "") // allow it to stick even over plain http (e.g. local/Termux testing)
  );
}

function proxyRequest(req, res) {
  const upstreamPath = req.url.slice(API_PREFIX.length) || "/";
  const targetUrl = new URL(upstreamPath, API_TARGET + "/");

  const headers = { ...req.headers, host: targetUrl.host };
  delete headers["origin"]; // this is now a server-to-server hop, not a browser request

  const mod = targetUrl.protocol === "https:" ? https : http;
  const proxyReq = mod.request(
    targetUrl,
    { method: req.method, headers },
    (proxyRes) => {
      const outHeaders = { ...proxyRes.headers };
      if (outHeaders["set-cookie"]) {
        outHeaders["set-cookie"] = rewriteSetCookie(proxyRes.headers["set-cookie"]);
      }
      // The backend sends Content-Disposition: attachment on media routes,
      // which makes some browsers force-download instead of playing inline
      // in <video>. Since this is our own reverse proxy, fix that in flight.
      if (outHeaders["content-disposition"]) {
        outHeaders["content-disposition"] = outHeaders["content-disposition"].replace(/^attachment/i, "inline");
      }
      res.writeHead(proxyRes.statusCode, outHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    send(res, 502, JSON.stringify({ error: "Upstream request failed", detail: String((err && err.message) || err) }), {
      "Content-Type": "application/json",
    });
  });

  req.pipe(proxyReq);
}

// ---------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------

function serveStatic(req, res) {
  let filePath = safeJoin(ROOT, req.url === "/" ? "/index.html" : req.url);
  if (!filePath) return send(res, 400, "Bad request");

  fs.stat(filePath, (err, stats) => {
    if (err) return send(res, 404, "404 — not found");
    if (stats.isDirectory()) filePath = path.join(filePath, "index.html");

    fs.readFile(filePath, (err, data) => {
      if (err) return send(res, 404, "404 — not found");
      const ext = path.extname(filePath).toLowerCase();
      send(res, 200, data, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      });
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.url === API_PREFIX || req.url.startsWith(API_PREFIX + "/") || req.url.startsWith(API_PREFIX + "?")) {
    return proxyRequest(req, res);
  }
  serveStatic(req, res);
});

function localIPs() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log(`\nOttfree frontend is running.`);
  console.log(`  Local:   http://localhost:${PORT}`);
  localIPs().forEach((ip) => console.log(`  Network: http://${ip}:${PORT}`));
  console.log(`  Proxying ${API_PREFIX}/* -> ${API_TARGET}`);
  console.log(`\nPress Ctrl+C to stop.\n`);
});
