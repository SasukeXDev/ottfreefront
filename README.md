# Ottfree frontend

A frontend for the Ottfree/Surf-TG backend API. Plain HTML/CSS/JS, no build
framework — the only Node involved is a small built-in server that also
doubles as a CORS-fixing reverse proxy (see below).

**Deploying?** See [DEPLOY.md](./DEPLOY.md) for step-by-step guides for
**Render** and **Termux** (running it on an Android phone), plus a shorter
note for any other Node host or static file host.

## How it works out of the box

This ships already pointed at `https://ucapi-jtrl.onrender.com`. To run it:

```sh
npm start
```

That's it — open `http://localhost:8080`. You'll land on the sign-in page
first (demo login: `user` / `user` on the default backend); the whole site
requires a session before it'll show anything, matching the backend's own
auth rules.

Want to point at a different backend, or add a TMDb key? Copy
`.env.example` to `.env`, fill in what you need, and run `npm start` again
(no separate build step needed for the proxy target — see below).

## Why there's a server.js at all

The backend doesn't send CORS headers, so calling it directly from a browser
on a different origin fails outright ("blocked by CORS policy"). Rather than
requiring backend changes, `server.js` serves the frontend **and**
transparently forwards every `/api-proxy/*` request to the real backend
server-side — browser-to-frontend and frontend-to-backend are each same-
process/same-origin hops, so CORS never applies. `js/config.js`'s `BASE_URL`
points at `/api-proxy` by default for exactly this reason.

It also fixes two things noticed while re-reading the backend's API docs:
- The backend's session cookie is set with `Secure` and sometimes a `Domain`
  attribute that don't survive being proxied cleanly — `server.js` strips
  both so login actually sticks.
- The backend sends `Content-Disposition: attachment` on every media
  response, which can make browsers force-download instead of playing
  inline. `server.js` rewrites that to `inline` so the Video.js player works.

Deploying somewhere that can't run `server.js` (a plain static host)? See
"Direct mode" in [DEPLOY.md](./DEPLOY.md) — it still works, but then the
backend itself needs proper CORS headers.

## Pages

| File | Purpose |
|---|---|
| `index.html` | **Sign-in page — this is the site's root.** Every other page redirects here first if there's no active session (demo: `user` / `user`). |
| `home.html` | Channel shelf, playlist shelf, and aggregated New Signals / Trending / Featured rows built client-side (the backend's `GET /` only returns channels + playlists, so rows are assembled from the first page of a sample of channels — see `OTTFREE_CONFIG.HOME_CHANNEL_SAMPLE`). |
| `channel.html?chat_id=` | Browse one channel, paginated with infinite scroll, plus in-channel search. |
| `playlist.html?db=` | Browse a playlist/folder: subfolders + files, plus search within it. |
| `search.html?q=` | Aggregated search. The API only exposes per-channel/per-playlist search, so this fans a query out across every channel from `GET /` and merges the results. |
| `watch.html?chat_id=&id=&hash=` | Video.js player + details + (for TV) an episode list. |
| `admin.html` | Create/edit/delete folders, edit file listings, send files to a playlist, reload cache, and edit site config. |

## Login-first flow

`index.html` is the root and only ever shows the sign-in form. Every other
page calls a shared `OttfreeUtils.requireAuth()` guard as the first thing in
its `main()`: it checks `GET /login`'s session state and, if there's no
active session, redirects to `index.html?next=<page>` — so signing in sends
you right back to what you were trying to open. `admin.html` additionally
probes an admin-only route to confirm the session is actually an admin, not
just any logged-in user.

## The episode-filtering rule

Listings never show an episode file unless `episode` is `1` (or the file is
a movie, i.e. `episode` is `null`). That episode-1 card is the show's entry
point everywhere except the watch page. This is implemented once, in
`OttfreeUtils.filterListable()`, and applied on Home, Channel, Playlist, and
Search. The **watch page is the exception** — it deliberately fetches the
*full* episode list for the current season (TMDb metadata merged with
whichever episodes actually exist in that channel) so people can jump between
episodes without leaving the player.

## How the watch page finds episodes

The backend has no "list all episodes of season N" endpoint, so `watch.js`:
1. Fetches season metadata (names, overviews, still images) from TMDb using
   the file's `tmdb_id` + `season`.
2. Pages through `GET /channel/{chat_id}` (up to `MAX_EPISODE_SCAN_PAGES`,
   configurable in `config.js`) looking for files that match the same
   `tmdb_id` and `season`, to know which episode numbers are actually
   playable and with what `id`/`hash`.
3. Merges the two: every TMDb-listed episode renders, playable ones link to
   their file, others show as "Unavailable".

This means episode discovery only looks inside the *same channel* as the
episode you opened. If a series is split across multiple channels, episodes
from the other channel won't appear in the list.

## Video.js setup

`watch.html` loads Video.js 8 plus:
- **videojs-hotkeys** — space/arrow-key/volume shortcuts.
- **videojs-mobile-ui** — larger touch controls and tap-to-seek on phones.
- **videojs-landscape-fullscreen** — auto-rotates to fullscreen landscape on
  mobile when playback starts.

Plus custom (non-plugin) behavior in `watch.js`: resume-from-last-position
and remembered volume via `localStorage`, and auto-advance to the next
episode on `ended` for TV files.

There's no adaptive-bitrate/HLS involved because the backend serves a single
progressive MP4 per file via range requests — if you later add multiple
qualities per file, wire in `videojs-contrib-quality-levels` +
`videojs-http-source-selector` and expose the extra sources from the API.

## Responsive & TV-friendly

`css/style.css` has three tiers: mobile (`≤640px`), the default
laptop/desktop layout, and a `≥1600px` tier with larger type, larger cards,
and a thicker focus ring for D-pad/remote navigation. All interactive
elements use `:focus-visible` so keyboard/remote users always see where they
are.

## Configuration reference

Set these as real environment variables (Render dashboard) or in a local
`.env` (copy `.env.example`) — full details in [DEPLOY.md](./DEPLOY.md).

| Variable | Read by | Purpose |
|---|---|---|
| `OTTFREE_API_URL` | `server.js` (runtime) | The real backend to proxy to. Defaults to `https://ucapi-jtrl.onrender.com`. |
| `OTTFREE_USE_PROXY` | `npm run build` | Set to `false` to disable proxying and bake `OTTFREE_API_URL` straight into `BASE_URL` (direct mode — needs backend CORS). Default `true`. |
| `OTTFREE_TMDB_API_KEY` | `npm run build` | Baked into `js/config.js`'s `TMDB_API_KEY`. |
| `OTTFREE_HOME_CHANNEL_SAMPLE` / `OTTFREE_MAX_EPISODE_SCAN_PAGES` | `npm run build` | Optional tuning knobs, same defaults as before. |
| `PORT` / `OTTFREE_PORT` | `server.js` (runtime) | Listen port. Render sets `PORT` itself. |

## Known limitations / things to wire up as you go

- `POST /send` is documented as **currently public** by the backend. The
  admin panel still gates it behind the admin UI for convenience, but it
  isn't actually protected until the backend requires auth on that route.
- The admin access check calls `GET /searchDbFol` as a probe (since
  `GET /login` doesn't return `is_admin` after the fact) — if you add a
  dedicated "am I admin" endpoint, swap `checkAccess()` in `js/admin.js` to
  use it instead.
- TMDb calls are made directly from the browser with the API key visible in
  `config.js`. That's normal for TMDb's free v3 key (rate-limited, not billed),
  but don't reuse a paid/read-access-token that you want to keep private.
- Episode discovery only scans the channel the episode was opened from (see
  above) — cross-channel series aren't merged.
