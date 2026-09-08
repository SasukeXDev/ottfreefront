# Deploying the Ottfree frontend

This ships as a small Node app: `server.js` serves the static files and also
reverse-proxies API calls to your backend so the browser never hits CORS
errors (see the README's "Why there's a server.js at all" section). Both
guides below run that same server — Render as a hosted process, Termux as a
process on your phone.

Out of the box, everything already points at `https://ucapi-jtrl.onrender.com`.
Override it with the `OTTFREE_API_URL` environment variable wherever you
deploy — no code changes needed.

---

## Deploy to Render

**Option A — Blueprint (one click, recommended).** This repo includes a
`render.yaml` that provisions a free Node Web Service running `server.js`.

1. Push this project to a GitHub or GitLab repo.
2. In the Render dashboard: **New → Blueprint**, pick the repo. Render reads
   `render.yaml` automatically.
3. When prompted, fill in `OTTFREE_TMDB_API_KEY` if you have one (optional —
   `OTTFREE_API_URL` is already set to the default backend in the blueprint,
   change it there too if you're pointing somewhere else).
4. Click **Apply**. Render runs `npm install && npm run build` then
   `npm start`.
5. Your site is live at `https://<service-name>.onrender.com` — open it,
   you'll land on the sign-in page.

**Option B — Manual Web Service (no `render.yaml`).**

1. **New → Web Service**, connect your repo.
2. Build Command: `npm install && npm run build`
3. Start Command: `npm start`
4. Under **Environment**, add `OTTFREE_API_URL` (and `OTTFREE_TMDB_API_KEY`
   if you have one).
5. Deploy.

**Option C — Static Site instead (no proxy, needs backend CORS).** Cheaper,
but there's no process to proxy through, so the browser calls your backend
directly and it must send CORS headers back. See "Direct mode" below before
choosing this.

1. **New → Static Site**, connect your repo.
2. Build Command: `OTTFREE_USE_PROXY=false OTTFREE_API_URL=https://your-backend npm install && npm run build`
   (bakes the backend URL straight into `BASE_URL` instead of `/api-proxy`).
3. Publish Directory: `.`
4. Your backend needs to answer with
   `Access-Control-Allow-Origin: https://<service-name>.onrender.com` and
   `Access-Control-Allow-Credentials: true` on every response, or the login
   session cookie won't be sent/accepted.

---

## Run it in Termux (Android)

This turns your phone into the host — handy for testing, or for keeping a
personal copy running on a home network.

1. **Install Termux from F-Droid**, not the Play Store (the Play Store build
   is outdated and no longer updated).
   https://f-droid.org/en/packages/com.termux/

2. **Update packages and install Node.js:**
   ```sh
   pkg update && pkg upgrade -y
   pkg install -y nodejs git unzip
   ```

3. **Get the project onto the phone.** Pick one:
   - Via git (if you've pushed this to a repo):
     ```sh
     git clone <your-repo-url> ottfree-frontend
     cd ottfree-frontend
     ```
   - Via the zip file: first run `termux-setup-storage` once (grants Termux
     access to your phone's normal storage) and accept the Android
     permission prompt, then, assuming the zip is in your Downloads folder:
     ```sh
     termux-setup-storage
     unzip ~/storage/downloads/ottfree-frontend.zip -d ~/ottfree-frontend
     cd ~/ottfree-frontend
     ```

4. **(Optional) Configure it.** Only needed if you want a different backend
   or a TMDb key — the defaults work with no config at all:
   ```sh
   cp .env.example .env
   pkg install -y nano
   nano .env
   # e.g. set OTTFREE_API_URL if you're not using the default backend
   ```

5. **Start the server:**
   ```sh
   npm start
   ```
   You'll see something like:
   ```
   Ottfree frontend is running.
     Local:   http://localhost:8080
     Network: http://192.168.1.42:8080
     Proxying /api-proxy/* -> https://ucapi-jtrl.onrender.com
   ```
   Open the `localhost` link in Chrome on the same phone, or the `Network`
   link from any other device on the same Wi-Fi (laptop, TV browser, etc).
   You'll land on the sign-in page — demo login `user` / `user` on the
   default backend.

6. **Keep it running:**
   - Run `termux-wake-lock` in the same session so Android doesn't suspend
     Termux and kill the server.
   - Closing the Termux app usually kills the process. To survive that,
     install `tmux` (`pkg install tmux`), start a session with `tmux`, run
     `npm start` inside it, then detach with `Ctrl+B` then `D`. Reattach
     later with `tmux attach`.
   - For it to start automatically on boot, look into the separate
     **Termux:Boot** app — that's beyond this guide's scope but well
     documented on the Termux wiki.

7. **Optional — share it outside your Wi-Fi.** The `Network` URL above only
   works on the same local network. To get a public URL without configuring
   router port-forwarding, use a tunnel:
   ```sh
   pkg install -y cloudflared
   cloudflared tunnel --url http://localhost:8080
   ```
   It'll print a temporary `https://*.trycloudflare.com` URL. Because the
   proxy already handles CORS, this works with no extra backend
   configuration.

---

## Direct mode (skip the proxy)

If you'd rather call the backend straight from the browser — e.g. you've
already fixed CORS on the backend itself, or you're deploying to a host that
can't run Node at all (GitHub Pages, S3, plain nginx) — set:

```sh
OTTFREE_USE_PROXY=false
OTTFREE_API_URL=https://your-backend.example.com
```

then run `npm run build` (or hand-edit `js/config.js`'s `BASE_URL` to the
same URL). The backend must respond with:

```
Access-Control-Allow-Origin: https://your-frontend-origin
Access-Control-Allow-Credentials: true
```

on every response, including the `401`/error ones, or the browser will
block the response before your JS ever sees it — and it must echo back the
*specific* origin, not `*`, since `*` is incompatible with credentialed
requests (which this frontend always sends, for the session cookie).

---

## Anywhere else (with the proxy)

`server.js` has zero dependencies and just needs a Node runtime and a `PORT`
env var (or it defaults to 8080), so it runs unmodified on Railway, Fly.io, a
plain VPS with `pm2`/`systemd`, or literally any machine with Node installed:

```sh
npm install
npm run build   # optional — only needed for TMDb key / direct mode
npm start
```
