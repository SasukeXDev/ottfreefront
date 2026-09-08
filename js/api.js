/**
 * Thin wrapper around every endpoint documented in site.md.
 * Every call sends cookies (credentials: "include") so the session set by
 * POST /login is carried automatically.
 */
(function () {
  const BASE = () => window.OTTFREE_CONFIG.BASE_URL || "";

  async function request(path, opts = {}) {
    const res = await fetch(BASE() + path, {
      credentials: "include",
      ...opts,
    });

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      // non-JSON response (binary/media endpoints) — caller handles res directly
      return { ok: res.ok, status: res.status, res, data: null };
    }

    // Admin routes return 200 with {"msg":"Who the hell you are"} when logged out.
    const isAdminLockout = data && data.msg === "Who the hell you are";

    return { ok: res.ok && !isAdminLockout, status: res.status, res, data, isAdminLockout };
  }

  function form(obj) {
    const p = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => {
      if (v !== undefined && v !== null) p.append(k, v);
    });
    return p;
  }

  window.OttfreeAPI = {
    // ---- auth ----
    loginState: () => request("/login"),
    login: (username, password) =>
      request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ username, password }),
      }),
    logout: () => request("/logout", { method: "POST" }),

    // ---- browse ----
    home: () => request("/"),
    channel: (chatId, page = 1) => request(`/channel/${encodeURIComponent(chatId)}?page=${page}`),
    searchChannel: (chatId, q, page = 1) =>
      request(`/search/${encodeURIComponent(chatId)}?q=${encodeURIComponent(q)}&page=${page}`),
    playlist: (db, page = 1) => request(`/playlist?db=${encodeURIComponent(db)}&page=${page}`),
    searchPlaylist: (parent, q, page = 1) =>
      request(`/search/db/${encodeURIComponent(parent)}?q=${encodeURIComponent(q)}&page=${page}`),

    // ---- delivery ----
    watch: (chatId, id, hash) =>
      request(`/watch/${encodeURIComponent(chatId)}?id=${encodeURIComponent(id)}&hash=${encodeURIComponent(hash)}`),
    thumbUrl: (chatId, id) =>
      BASE() + `/api/thumb/${encodeURIComponent(chatId)}` + (id ? `?id=${encodeURIComponent(id)}` : ""),
    streamUrl: (relativeUrl) => (relativeUrl ? BASE() + relativeUrl : ""),

    // ---- admin ----
    createFolder: (folderName, thumbnail, parentDir) =>
      request("/create", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ folderName, thumbnail, parent_dir: parentDir }),
      }),
    deleteEntry: (deleteId, parent) =>
      request("/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete_id: deleteId, parent }),
      }),
    editFolder: (folderId, folderName, thumbnail, parent) =>
      request("/edit", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ folder_id: folderId, folderName, thumbnail, parent }),
      }),
    editPost: (fileId, fileName, filethumbnail, fileFolderId) =>
      request("/edit_post", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ file_id: fileId, fileName, filethumbnail, file_folder_id: fileFolderId }),
      }),
    searchDbFolders: (query) => request(`/searchDbFol?query=${encodeURIComponent(query)}`),
    send: (chatId, folderId, selectedIds) =>
      request("/send", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ chatId, folderId, selectedIds }),
      }),
    reload: (chatId) => request(`/reload?chatId=${encodeURIComponent(chatId)}`),
    config: (channel, theme) =>
      request("/config", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ channel, theme }),
      }),
  };
})();
