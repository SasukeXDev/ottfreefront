(function () {
  const U = OttfreeUtils;
  const chatId = U.getParam("chat_id");
  const fileId = U.getParam("id");
  const hash = U.getParam("hash");

  let player = null;
  let currentMeta = null;

  // ---------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------

  function volumeKey() { return "ottfree:volume"; }
  function positionKey(id) { return "ottfree:pos:" + id; }

  function initPlayer() {
    player = videojs("player", {
      fluid: false,
      responsive: true,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      preload: "auto",
      html5: { vhs: { overrideNative: true } },
      plugins: {},
    });

    // Restore volume preference
    try {
      const saved = JSON.parse(localStorage.getItem(volumeKey()) || "null");
      if (saved) {
        player.volume(saved.volume);
        player.muted(saved.muted);
      }
    } catch (e) {}

    player.on("volumechange", () => {
      try {
        localStorage.setItem(volumeKey(), JSON.stringify({ volume: player.volume(), muted: player.muted() }));
      } catch (e) {}
    });

    // --- plugins (loaded via CDN in watch.html; guard in case one fails) ---
    if (typeof player.hotkeys === "function") {
      player.hotkeys({
        volumeStep: 0.1,
        seekStep: 10,
        enableModifiersForNumbers: false,
        enableVolumeScroll: true,
        enableHoverScroll: true,
      });
    }
    if (typeof player.mobileUi === "function") {
      player.mobileUi({ fullscreen: { enterOnRotate: true, lockOnRotate: true } });
    }
    if (typeof player.landscapeFullscreen === "function") {
      player.landscapeFullscreen({ fullscreen: { enterOnRotate: true, exitOnRotate: true, alwaysInLandscapeMode: true } });
    }

    player.on("timeupdate", () => {
      if (!currentMeta) return;
      const t = player.currentTime();
      if (t > 3) {
        try { localStorage.setItem(positionKey(currentMeta._localId), String(t)); } catch (e) {}
      }
    });

    player.on("ended", () => {
      if (currentMeta) { try { localStorage.removeItem(positionKey(currentMeta._localId)); } catch (e) {} }
      maybeAutoAdvance();
    });
  }

  function loadSource(meta, { autoplay } = { autoplay: false }) {
    currentMeta = meta;
    const src = OttfreeAPI.streamUrl(meta.stream_url);
    const type = meta.mime_type || meta.file_type || "video/mp4";
    player.poster(U.resolveUrl(U.posterFor(meta)));
    player.src([{ src, type }]);

    const localId = meta._localId;
    let resumeAt = 0;
    try { resumeAt = parseFloat(localStorage.getItem(positionKey(localId)) || "0"); } catch (e) {}

    player.one("loadedmetadata", () => {
      if (resumeAt > 5 && resumeAt < player.duration() - 10) {
        player.currentTime(resumeAt);
      }
      if (autoplay) player.play().catch(() => {});
    });
  }

  // ---------------------------------------------------------------------
  // Page chrome: title / tags / overview
  // ---------------------------------------------------------------------

  function renderInfo(meta, tmdbDetails) {
    document.getElementById("w-title").textContent = U.displayTitle(meta) + (meta.season ? ` · S${meta.season}${meta.episode ? "E" + meta.episode : ""}` : "");
    document.title = U.displayTitle(meta) + " — Ottfree";
    document.getElementById("w-sub").textContent = meta.telegram_title && meta.telegram_title !== U.displayTitle(meta) ? meta.telegram_title : "";

    const tags = [];
    if (meta.tmdb_type) tags.push(meta.tmdb_type === "tv" ? "Series" : "Movie");
    if (meta.file_size || meta.size) tags.push(meta.file_size || meta.size);
    if (tmdbDetails && tmdbDetails.vote_average) tags.push(`★ ${tmdbDetails.vote_average.toFixed(1)}`);
    if (tmdbDetails && (tmdbDetails.release_date || tmdbDetails.first_air_date)) {
      tags.push((tmdbDetails.release_date || tmdbDetails.first_air_date).slice(0, 4));
    }
    if (tmdbDetails && tmdbDetails.genres && tmdbDetails.genres.length) {
      tags.push(...tmdbDetails.genres.slice(0, 3).map((g) => g.name));
    }
    document.getElementById("w-tags").innerHTML = tags.map((t) => `<span class="tag">${U.escapeHtml(t)}</span>`).join("");
    document.getElementById("w-overview").textContent = (tmdbDetails && tmdbDetails.overview) || "";
  }

  // ---------------------------------------------------------------------
  // Episodes (TV only)
  // ---------------------------------------------------------------------

  let episodeAvailability = {}; // episode_number -> file meta
  let tvDetails = null;

  async function scanChannelForSeason(cid, tmdbId, seasonNum) {
    const map = {};
    for (let p = 1; p <= window.OTTFREE_CONFIG.MAX_EPISODE_SCAN_PAGES; p++) {
      let res;
      try { res = await OttfreeAPI.channel(cid, p); } catch (e) { break; }
      if (!res.ok || !res.data || !res.data.files || !res.data.files.length) break;
      res.data.files.forEach((f) => {
        if (String(f.tmdb_id) === String(tmdbId) && Number(f.season) === Number(seasonNum) && f.episode != null) {
          map[Number(f.episode)] = { ...f, public_chat_id: res.data.public_chat_id || cid, chat_id: res.data.chat_id };
        }
      });
    }
    return map;
  }

  function episodeRowHtml(ep, fileMatch, isCurrent) {
    const still = U.tmdbImg(ep.still_path, "w300");
    const available = !!fileMatch;
    return `
      <button class="episode-row ${isCurrent ? "is-current" : ""} ${available ? "" : "is-unavailable"}"
              data-episode="${ep.episode_number}" ${available ? "" : "disabled"}>
        <div class="episode-row__thumb">${still ? `<img src="${still}" alt="" loading="lazy" />` : ""}</div>
        <div>
          <div class="episode-row__num">E${ep.episode_number}${available ? "" : " · Unavailable"}</div>
          <div class="episode-row__title">${U.escapeHtml(ep.name || "")}</div>
          <div class="episode-row__overview">${U.escapeHtml(ep.overview || "")}</div>
        </div>
      </button>`;
  }

  async function renderSeason(seasonNum) {
    const list = document.getElementById("episodes-list");
    list.innerHTML = `<div class="skeleton" style="height:80px;margin:8px;"></div>`.repeat(4);

    const [seasonData, availability] = await Promise.all([
      U.tmdbFetch(`/tv/${currentMeta.tmdb_id}/season/${seasonNum}`),
      scanChannelForSeason(chatId, currentMeta.tmdb_id, seasonNum),
    ]);
    episodeAvailability = availability;

    const episodes = (seasonData && seasonData.episodes) || Object.values(availability).map((f) => ({
      episode_number: f.episode, name: U.displayTitle(f), overview: "", still_path: null,
    }));

    if (!episodes.length) {
      list.innerHTML = `<div class="state-msg">No episode data found.</div>`;
      return;
    }

    list.innerHTML = episodes
      .slice()
      .sort((a, b) => a.episode_number - b.episode_number)
      .map((ep) => episodeRowHtml(ep, availability[ep.episode_number], Number(currentMeta.episode) === ep.episode_number && Number(currentMeta.season) === seasonNum))
      .join("");

    list.querySelectorAll(".episode-row[data-episode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const epNum = Number(btn.dataset.episode);
        const file = availability[epNum];
        if (!file) return;
        playEpisode(file);
      });
    });
  }

  function playEpisode(file) {
    file._localId = String(file.file_id ?? file.id);
    U.stashFile(file);
    const cid = file.public_chat_id || chatId;
    history.replaceState(null, "", `watch.html?${U.qs({ chat_id: cid, id: file.file_id ?? file.id, hash: file.hash })}`);
    loadSource(file, { autoplay: true });
    renderInfo(file, tvDetails);
    document.querySelectorAll(".episode-row").forEach((r) => r.classList.remove("is-current"));
    const row = document.querySelector(`.episode-row[data-episode="${file.episode}"]`);
    if (row) row.classList.add("is-current");
  }

  function maybeAutoAdvance() {
    if (!currentMeta || currentMeta.tmdb_type !== "tv") return;
    const next = episodeAvailability[Number(currentMeta.episode) + 1];
    if (next) playEpisode(next);
  }

  async function setupEpisodesPanel(meta) {
    if (meta.tmdb_type !== "tv" || !meta.tmdb_id) return;
    const panel = document.getElementById("episodes-panel");
    panel.style.display = "flex";

    tvDetails = await U.tmdbFetch(`/tv/${meta.tmdb_id}`);
    const select = document.getElementById("season-select");
    const seasons = ((tvDetails && tvDetails.seasons) || []).filter((s) => s.season_number > 0);
    const seasonNums = seasons.length ? seasons.map((s) => s.season_number) : [meta.season || 1];
    select.innerHTML = seasonNums
      .map((n) => `<option value="${n}" ${n === Number(meta.season || 1) ? "selected" : ""}>Season ${n}</option>`)
      .join("");
    select.addEventListener("change", () => renderSeason(Number(select.value)));

    renderInfo(meta, tvDetails);
    await renderSeason(Number(meta.season || 1));
  }

  // ---------------------------------------------------------------------
  // Related row
  // ---------------------------------------------------------------------

  async function renderRelated(meta, cid) {
    const slot = document.getElementById("related-slot");
    try {
      const { data, ok } = await OttfreeAPI.channel(cid, 1);
      if (!ok || !data) return;
      const files = U.filterListable(data.files || []).filter(
        (f) => String(f.id) !== String(meta.id) && String(f.file_id) !== String(meta.file_id)
      );
      if (!files.length) return;
      slot.innerHTML = `
        <div class="shelf" style="margin-top:8px;">
          <div class="shelf__head" style="padding:0"><h2 class="shelf__title">More from this channel</h2></div>
          <div class="shelf__track" style="padding:4px 0 12px;">${files.slice(0, 16).map((f) => U.cardHtml(f, cid)).join("")}</div>
        </div>`;
      U.wireCardStash(slot, files);
    } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  async function main() {
    if (!(await U.requireAuth())) return;
    U.initChrome();

    if (!chatId || !fileId || !hash) {
      document.getElementById("w-title").textContent = "Missing playback details";
      document.getElementById("w-sub").textContent = "This link is missing chat_id, id, or hash.";
      return;
    }

    const stashed = U.unstashFile(fileId) || {};
    const { data: watchData, ok } = await OttfreeAPI.watch(chatId, fileId, hash);
    if (!ok || !watchData) {
      document.getElementById("w-title").textContent = "Couldn't load this title";
      document.getElementById("w-sub").textContent = "The link may have expired or the hash is invalid.";
      return;
    }

    const meta = {
      ...stashed,
      chat_id: watchData.chat_id,
      public_chat_id: watchData.public_chat_id,
      file_id: watchData.file_id,
      hash: watchData.hash,
      stream_url: watchData.stream_url,
    };
    meta._localId = String(meta.file_id ?? meta.id ?? fileId);

    initPlayer();
    loadSource(meta);
    renderInfo(meta, null);

    if (meta.tmdb_id && meta.tmdb_type === "tv") {
      await setupEpisodesPanel(meta);
    } else if (meta.tmdb_id) {
      const details = await U.tmdbFetch(`/movie/${meta.tmdb_id}`);
      renderInfo(meta, details);
    }

    renderRelated(meta, meta.public_chat_id || chatId);
  }

  main();
})();
