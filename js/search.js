(function () {
  const U = OttfreeUtils;
  const q = U.getParam("q");
  const grid = document.getElementById("grid");
  const titleEl = document.getElementById("search-title");

  async function main() {
    if (!(await U.requireAuth())) return;
    U.initChrome();
    document.querySelector("[data-nav-search] input").value = q || "";
    if (!q) {
      titleEl.textContent = "Search";
      grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1">Type something in the search box above.</div>`;
      return;
    }
    titleEl.textContent = `Results for "${q}"`;
    grid.innerHTML = Array(8).fill(`<div class="skeleton" style="aspect-ratio:2/3"></div>`).join("");

    const { data: home, ok } = await OttfreeAPI.home();
    if (!ok || !home) {
      grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1">Couldn't reach the backend.</div>`;
      return;
    }
    const channels = home.channels || [];
    if (!channels.length) {
      grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1">No channels to search.</div>`;
      return;
    }

    const results = await Promise.all(
      channels.map(async (ch) => {
        const cid = ch.public_id ?? ch.chat_id;
        try {
          const { data, ok } = await OttfreeAPI.searchChannel(cid, q, 1);
          if (!ok || !data) return [];
          return U.filterListable(data.files || []).map((f) => ({
            ...f,
            public_chat_id: f.public_chat_id || data.public_chat_id || cid,
          }));
        } catch (e) {
          return [];
        }
      })
    );

    const files = U.dedupeById(results.flat());
    if (!files.length) {
      grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1"><strong>No matches.</strong>Try a different search term.</div>`;
      return;
    }
    grid.innerHTML = files.map((f) => U.cardHtml(f, f.public_chat_id)).join("");
    U.wireCardStash(grid, files);
  }

  main();
})();
