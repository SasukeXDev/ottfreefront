(function () {
  const { filterListable, cardHtml, folderTileHtml, wireCardStash, initChrome, getParam, requireAuth } = OttfreeUtils;

  const db = getParam("db");
  const grid = document.getElementById("grid");
  const foldersSlot = document.getElementById("folders-slot");
  const filesLabel = document.getElementById("files-label");
  const loadMoreEl = document.getElementById("load-more");
  const titleEl = document.getElementById("playlist-title");

  let page = 1;
  let query = null;
  let loading = false;
  let exhausted = false;

  function renderFolders(playlists) {
    if (!playlists || !playlists.length) { foldersSlot.innerHTML = ""; return; }
    foldersSlot.innerHTML = `
      <div class="section-label">Folders</div>
      <div class="folder-row">${playlists.map(folderTileHtml).join("")}</div>`;
  }

  function renderFiles(files) {
    const filtered = filterListable(files);
    filesLabel.style.display = filtered.length || page > 1 ? "block" : "none";
    if (!filtered.length && page === 1) {
      if (!foldersSlot.innerHTML) {
        grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1"><strong>Empty playlist.</strong>${query ? "Try a different search." : "Nothing has been added here yet."}</div>`;
      }
      return;
    }
    grid.insertAdjacentHTML("beforeend", filtered.map((f) => cardHtml(f)).join(""));
    wireCardStash(grid, filtered);
  }

  async function loadNext() {
    if (loading || exhausted || !db) return;
    loading = true;
    try {
      const { data, ok } = query
        ? await OttfreeAPI.searchPlaylist(db, query, page)
        : await OttfreeAPI.playlist(db, page);
      if (!ok || !data) { exhausted = true; loadMoreEl.innerHTML = ""; return; }
      if (page === 1) {
        titleEl.textContent = data.message || "Playlist";
        renderFolders(query ? null : data.playlists);
      }
      const files = data.files || [];
      if (!files.length) {
        exhausted = true;
        loadMoreEl.innerHTML = page === 1 ? "" : `<span class="state-msg">That's everything.</span>`;
        if (page === 1) renderFiles([]);
        return;
      }
      renderFiles(files);
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
    const form = document.querySelector("[data-playlist-search]");
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
    if (!db) {
      titleEl.textContent = "Missing playlist";
      grid.innerHTML = `<div class="state-msg" style="grid-column:1/-1">No playlist id was given in the URL.</div>`;
      return;
    }
    wireSearch();
    wireInfiniteScroll();
    loadNext();
  }

  main();
})();
