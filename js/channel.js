(function () {
  const { filterListable, cardHtml, wireCardStash, escapeHtml, initChrome, getParam, requireAuth } = OttfreeUtils;

  const chatId = getParam("chat_id");
  const grid = document.getElementById("grid");
  const loadMoreEl = document.getElementById("load-more");
  const titleEl = document.getElementById("channel-title");

  let page = 1;
  let query = null;
  let loading = false;
  let exhausted = false;

  function renderPage(files) {
    const filtered = filterListable(files);
    if (!filtered.length && page === 1) {
      grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1"><strong>Nothing here yet.</strong>${query ? "Try a different search." : "This channel has no browsable titles."}</div>`;
      return;
    }
    grid.insertAdjacentHTML("beforeend", filtered.map((f) => cardHtml(f, chatId)).join(""));
    wireCardStash(grid, filtered);
  }

  async function loadNext() {
    if (loading || exhausted || !chatId) return;
    loading = true;
    loadMoreEl.innerHTML = `<div class="skeleton" style="width:160px;height:36px;border-radius:6px;"></div>`;
    try {
      const { data, ok } = query
        ? await OttfreeAPI.searchChannel(chatId, query, page)
        : await OttfreeAPI.channel(chatId, page);
      if (!ok || !data) { exhausted = true; loadMoreEl.innerHTML = ""; return; }
      const files = data.files || [];
      if (!files.length) {
        exhausted = true;
        loadMoreEl.innerHTML = page === 1 ? "" : `<span class="state-msg">That's everything.</span>`;
        if (page === 1) renderPage([]);
        return;
      }
      if (page === 1 && titleEl) titleEl.textContent = data.title || data.message || "Channel";
      renderPage(files);
      page += 1;
      loadMoreEl.innerHTML = `<button class="btn" data-load-more>Load more</button>`;
      loadMoreEl.querySelector("[data-load-more]").addEventListener("click", loadNext);
    } finally {
      loading = false;
    }
  }

  function resetAndLoad(newQuery) {
    query = newQuery || null;
    page = 1;
    exhausted = false;
    grid.innerHTML = "";
    loadMoreEl.innerHTML = "";
    loadNext();
  }

  function wireSearch() {
    const form = document.querySelector("[data-channel-search]");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = form.querySelector("input").value.trim();
      resetAndLoad(q || null);
    });
  }

  function wireInfiniteScroll() {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadNext();
    }, { rootMargin: "600px" });
    io.observe(loadMoreEl);
  }

  async function main() {
    if (!(await requireAuth())) return;
    initChrome();
    if (!chatId) {
      titleEl.textContent = "Missing channel";
      grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1">No channel id was given in the URL.</div>`;
      return;
    }
    wireSearch();
    wireInfiniteScroll();
    loadNext();
  }

  main();
})();
