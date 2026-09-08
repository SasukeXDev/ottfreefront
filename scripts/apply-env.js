#!/usr/bin/env node
/**
 * Bakes deployment settings into js/config.js at build time.
 *
 * This only matters for BASE_URL when you're running in "direct" mode
 * (OTTFREE_USE_PROXY=false) or deploying as a plain static site with no
 * Node process — in the default proxy setup, server.js reads OTTFREE_API_URL
 * itself at request time and nothing needs to be baked in. See config.js.
 *
 * Reads from real environment variables (Render's dashboard) or from a
 * local .env file (see .env.example) — either works. Safe to run any number
 * of times; vars that aren't set are left untouched, so hand-editing
 * js/config.js directly still works if you'd rather do that instead.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "js", "config.js");

function loadDotEnv() {
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
}

function setStringField(src, key, value) {
  if (value === undefined) return src;
  const re = new RegExp(`(${key}:\\s*")[^"]*(")`);
  if (!re.test(src)) {
    console.warn(`[ottfree] Couldn't find a "${key}" field in js/config.js — skipping.`);
    return src;
  }
  return src.replace(re, `$1${value.replace(/"/g, '\\"')}$2`);
}

function setNumberField(src, key, value) {
  if (value === undefined) return src;
  const num = Number(value);
  if (Number.isNaN(num)) return src;
  const re = new RegExp(`(${key}:\\s*)\\d+`);
  return re.test(src) ? src.replace(re, `$1${num}`) : src;
}

loadDotEnv();

let src = fs.readFileSync(CONFIG_PATH, "utf8");
const before = src;

const useProxy = (process.env.OTTFREE_USE_PROXY || "true").toLowerCase() !== "false";

if (!useProxy) {
  if (process.env.OTTFREE_API_URL) {
    // Direct mode: the browser calls the backend's real URL itself, so it
    // needs the backend to send proper CORS headers back.
    src = setStringField(src, "BASE_URL", process.env.OTTFREE_API_URL);
  } else {
    console.warn("[ottfree] OTTFREE_USE_PROXY=false but OTTFREE_API_URL isn't set — leaving BASE_URL as-is.");
  }
} else {
  // Proxy mode (default): BASE_URL stays "/api-proxy". server.js reads
  // OTTFREE_API_URL itself at request time to know where to forward to —
  // nothing to bake in here.
  src = setStringField(src, "BASE_URL", "/api-proxy");
}

src = setStringField(src, "TMDB_API_KEY", process.env.OTTFREE_TMDB_API_KEY);
src = setNumberField(src, "HOME_CHANNEL_SAMPLE", process.env.OTTFREE_HOME_CHANNEL_SAMPLE);
src = setNumberField(src, "MAX_EPISODE_SCAN_PAGES", process.env.OTTFREE_MAX_EPISODE_SCAN_PAGES);

if (src !== before) {
  fs.writeFileSync(CONFIG_PATH, src);
  console.log("[ottfree] js/config.js updated from environment variables.");
} else {
  console.log("[ottfree] No matching environment variables set — js/config.js left as-is.");
}
