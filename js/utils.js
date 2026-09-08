(function () {
  /**
   * Rule from the brief: a listing (Home, Channel, Search, Playlist) should
   * never show an episode file unless it's episode 1 — episode 1 stands in
   * as the "open this show" card. Movies (episode == null) always pass.
   * Full episode browsing happens on the watch page instead.
   */
  function filterListable(files) {
    return (files || []).filter((f) => f.episode == null || Number(f.episode) === 1);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function dedupeById(files) {
    const seen = new Set();
    const out = [];
    for (const f of files) {
      const key = String(f.id ?? f.file_id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }

  function posterFor(file) {
    return file.poster_url || file.thumbnail || "";
  }

  function displayTitle(file) {
    return file.title || file.tmdb_title || file.name || file.telegram_title || "Untitled";
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function qs(params) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") p.set(k, v);
    });
    return p.toString();
  }

  function getParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  // ---- TMDb (client-side, optional — only runs if TMDB_API_KEY is set) ----
  const TMDB_BASE = "https://api.themoviedb.org/3";

  async function tmdbFetch(path) {
    const key = window.OTTFREE_CONFIG.TMDB_API_KEY;
    if (!key) return null;
    try {
      const res = await fetch(`${TMDB_BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${key}&language=en-US`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function tmdbImg(path, size = "w500") {
    if (!path) return "";
    return `${window.OTTFREE_CONFIG.TMDB_IMG}/${size}${path}`;
  }

  // ---- session/watch-meta passing between pages ----
  function stashFile(file) {
    try {
      sessionStorage.setItem(
        "ottfree:lastFile:" + String(file.id ?? file.file_id),
        JSON.stringify(file)
      );
    } catch (e) {}
  }

  function unstashFile(id) {
    try {
      const raw = sessionStorage.getItem("ottfree:lastFile:" + String(id));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function watchHref(file, chatId) {
    const cid = chatId || file.public_chat_id || file.chat_id;
    return `watch.html?${qs({ chat_id: cid, id: file.file_id ?? file.id, hash: file.hash })}`;
  }

  // ---- session/auth state shared across pages ----

  /**
   * Gate a page behind login. Call this first thing in a page's main().
   * Redirects to the login page (index.html) with ?next= set to return here
   * on success. Returns true if the page should continue rendering.
   */
  async function requireAuth() {
    try {
      const { data, ok } = await OttfreeAPI.loginState();
      if (ok && data && data.authenticated) return true;
    } catch (e) {}
    const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
    location.replace(`index.html?next=${next}`);
    return false;
  }

  async function refreshSessionBadge() {
    const nav = document.querySelector("[data-nav-auth]");
    if (!nav) return;
    const { data } = await OttfreeAPI.loginState();
    const authed = !!(data && data.authenticated);
    const isAdmin = sessionStorage.getItem("ottfree:isAdmin") === "1";
    if (authed) {
      nav.innerHTML = `
        ${isAdmin ? '<a href="admin.html" class="nav-link">Admin</a>' : ""}
        <button class="nav-link nav-link--btn" data-logout>Sign out</button>
      `;
      const btn = nav.querySelector("[data-logout]");
      if (btn) btn.addEventListener("click", async () => {
        await OttfreeAPI.logout();
        sessionStorage.removeItem("ottfree:isAdmin");
        location.href = "index.html";
      });
    } else {
      const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      nav.innerHTML = `<a href="index.html?next=${next}" class="nav-link nav-link--btn">Sign in</a>`;
      sessionStorage.removeItem("ottfree:isAdmin");
    }
    return authed;
  }

  function wireNavSearch() {
    const form = document.querySelector("[data-nav-search]");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = form.querySelector("input").value.trim();
      if (!q) return;
      location.href = `search.html?${qs({ q })}`;
    });
  }

  function initChrome() {
    wireNavSearch();
    refreshSessionBadge();
    const menuBtn = document.querySelector("[data-menu-toggle]");
    const nav = document.querySelector(".site-nav");
    if (menuBtn && nav) {
      menuBtn.addEventListener("click", () => nav.classList.toggle("is-open"));
    }
  }

  function cardHtml(file, chatId) {
    const title = escapeHtml(displayTitle(file));
    const poster = resolveUrl(posterFor(file));
    const isSeries = file.tmdb_type === "tv" || (file.season != null);
    const href = watchHref(file, chatId);
    const sub = file.season != null ? `Season ${file.season}` : (file.tmdb_type ? "" : "");
    return `
      <a class="card" href="${href}" data-stash-id="${escapeHtml(String(file.file_id ?? file.id))}">
        <div class="card__poster">
          ${poster ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy" />` : `<div class="skeleton" style="position:absolute;inset:0;"></div>`}
          ${isSeries ? `<span class="card__badge">Series</span>` : ""}
        </div>
        <div class="card__title">${title}</div>
        ${sub ? `<div class="card__sub">${escapeHtml(sub)}</div>` : ""}
      </a>`;
  }

  function resolveUrl(u) {
    if (!u) return "";
    return u.startsWith("http") ? u : OttfreeAPI.streamUrl(u);
  }

  function channelCardHtml(ch) {
    const thumb = resolveUrl(ch.thumbnail) || OttfreeAPI.thumbUrl(ch.public_id ?? ch.chat_id);
    return `
      <a class="card channel-card" href="channel.html?${qs({ chat_id: ch.public_id ?? ch.chat_id })}">
        <div class="card__poster">
          ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" />` : `<div class="skeleton" style="position:absolute;inset:0;"></div>`}
        </div>
        <div class="card__title">${escapeHtml(ch.title)}</div>
      </a>`;
  }

  function folderTileHtml(pl) {
    return `
      <a class="folder-tile" href="playlist.html?${qs({ db: pl.id })}">
        <span class="folder-tile__icon">📁</span>
        <span class="folder-tile__name">${escapeHtml(pl.title || pl.name)}</span>
      </a>`;
  }

  function wireCardStash(root, files) {
    const byId = {};
    files.forEach((f) => (byId[String(f.file_id ?? f.id)] = f));
    root.querySelectorAll("[data-stash-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const f = byId[el.getAttribute("data-stash-id")];
        if (f) stashFile(f);
      });
    });
  }

  window.OttfreeUtils = {
    filterListable,
    shuffle,
    dedupeById,
    posterFor,
    displayTitle,
    escapeHtml,
    qs,
    getParam,
    requireAuth,
    tmdbFetch,
    tmdbImg,
    stashFile,
    unstashFile,
    watchHref,
    refreshSessionBadge,
    initChrome,
    resolveUrl,
    cardHtml,
    channelCardHtml,
    folderTileHtml,
    wireCardStash,
  };
})();
