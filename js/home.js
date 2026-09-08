(function () {
  const { filterListable, shuffle, dedupeById, cardHtml, channelCardHtml, folderTileHtml,
          wireCardStash, resolveUrl, escapeHtml, displayTitle, initChrome, requireAuth } = OttfreeUtils;

  let heroItems = [];
  let heroIndex = 0;
  let heroTimer = null;

  function renderHeroSlide(file) {
    const slot = document.getElementById("hero-slot");
    const backdrop = resolveUrl(file.poster_url || file.thumbnail);
    const title = displayTitle(file);
    const kind = file.tmdb_type === "tv" ? "Series" : "Feature";
    slot.innerHTML = `
      <section class="hero">
        <div class="hero__backdrop" style="background-image:url('${backdrop}')"></div>
        <div class="hero__scrim"></div>
        <div class="hero__content">
          <div class="hero__tag">On air now</div>
          <h1 class="hero__title">${escapeHtml(title)}</h1>
          <div class="hero__meta">${kind}${file.season ? ` · Season ${file.season}` : ""}</div>
          <p class="hero__desc">${escapeHtml(file.telegram_title || "")}</p>
          <div class="hero__actions">
            <a class="btn btn--primary" href="${OttfreeUtils.watchHref(file)}" data-hero-play>▶ Play</a>
          </div>
        </div>
        <div class="hero__dots" data-hero-dots></div>
      </section>`;
    const playBtn = slot.querySelector("[data-hero-play]");
    playBtn.addEventListener("click", () => OttfreeUtils.stashFile(file));
    const dots = slot.querySelector("[data-hero-dots]");
    dots.innerHTML = heroItems
      .map((_, i) => `<button aria-label="Slide ${i + 1}" class="${i === heroIndex ? "is-active" : ""}" data-i="${i}"></button>`)
      .join("");
    dots.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        heroIndex = Number(b.dataset.i);
        renderHeroSlide(heroItems[heroIndex]);
        resetHeroTimer();
      })
    );
  }

  function resetHeroTimer() {
    clearInterval(heroTimer);
    if (heroItems.length < 2) return;
    heroTimer = setInterval(() => {
      heroIndex = (heroIndex + 1) % heroItems.length;
      renderHeroSlide(heroItems[heroIndex]);
    }, 7000);
  }

  function renderShelf(elId, num, title, files, opts = {}) {
    const el = document.getElementById(elId);
    if (!files.length) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="shelf">
        <div class="shelf__head">
          <span class="shelf__num">${num}</span>
          <h2 class="shelf__title">${escapeHtml(title)}</h2>
        </div>
        <div class="shelf__track">${files.map((f) => cardHtml(f, opts.chatId || f.public_chat_id || f.chat_id)).join("")}</div>
      </div>`;
    wireCardStash(el, files);
  }

  function renderChannelShelf(channels) {
    const el = document.getElementById("channels-shelf");
    if (!channels.length) return;
    el.innerHTML = `
      <div class="shelf">
        <div class="shelf__head">
          <span class="shelf__num">01</span>
          <h2 class="shelf__title">Channels</h2>
        </div>
        <div class="shelf__track">${channels.map(channelCardHtml).join("")}</div>
      </div>`;
  }

  function renderPlaylistShelf(playlists) {
    const el = document.getElementById("playlists-shelf");
    if (!playlists.length) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="shelf">
        <div class="shelf__head">
          <span class="shelf__num">05</span>
          <h2 class="shelf__title">Your playlists</h2>
        </div>
        <div class="folder-row">${playlists.map(folderTileHtml).join("")}</div>
      </div>`;
  }

  async function loadAggregatedRows(channels) {
    const sample = channels.slice(0, window.OTTFREE_CONFIG.HOME_CHANNEL_SAMPLE);
    const results = await Promise.all(
      sample.map(async (ch) => {
        try {
          const cid = ch.public_id ?? ch.chat_id;
          const { data, ok } = await OttfreeAPI.channel(cid, 1);
          if (!ok || !data) return [];
          return filterListable(data.files || []).map((f) => ({
            ...f,
            public_chat_id: f.public_chat_id || data.public_chat_id || cid,
            chat_id: f.chat_id || data.chat_id,
          }));
        } catch (e) {
          return [];
        }
      })
    );
    return dedupeById(results.flat());
  }

  function sortByRecency(files) {
    return files.slice().sort((a, b) => {
      const ai = parseInt(String(a.file_id ?? a.id).replace(/\D/g, ""), 10) || 0;
      const bi = parseInt(String(b.file_id ?? b.id).replace(/\D/g, ""), 10) || 0;
      return bi - ai;
    });
  }

  async function main() {
    if (!(await requireAuth())) return;
    initChrome();
    const { data, ok } = await OttfreeAPI.home();
    if (!ok || !data) {
      document.getElementById("hero-slot").innerHTML =
        `<div class="state-msg"><strong>Couldn't reach the backend.</strong>Check js/config.js — BASE_URL should point at your API.</div>`;
      return;
    }

    const channels = data.channels || [];
    const playlists = data.playlists || [];
    renderChannelShelf(channels);
    renderPlaylistShelf(playlists);

    if (!channels.length) {
      document.getElementById("hero-slot").innerHTML =
        `<div class="state-msg"><strong>No channels yet.</strong>Once channels are added they'll show up here.</div>`;
      return;
    }

    const pool = await loadAggregatedRows(channels);
    const withPoster = pool.filter((f) => f.poster_url || f.thumbnail);

    const recent = sortByRecency(pool).slice(0, 20);
    const trending = shuffle(pool).slice(0, 20);
    const featuredPool = shuffle(withPoster.length ? withPoster : pool).slice(0, 20);

    heroItems = featuredPool.slice(0, 5);
    if (heroItems.length) {
      renderHeroSlide(heroItems[0]);
      resetHeroTimer();
    } else {
      document.getElementById("hero-slot").innerHTML = "";
    }

    renderShelf("new-releases-shelf", "02", "New signals", recent);
    renderShelf("trending-shelf", "03", "Trending frequencies", trending);
    renderShelf("featured-shelf", "04", "Featured", featuredPool);
  }

  main();
})();
