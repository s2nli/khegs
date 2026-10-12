(function () {
  "use strict";
  /* Batch page (chapters -> lectures/notes -> player). UI = cww-main; data = live Khan Global Studies API (kgs-api.js). */
  const $ = (s) => document.querySelector(s);
  const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const K = window.KGS;
  const params = new URLSearchParams(location.search);
  const batchId = params.get("id") || "";
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const slug = params.get("slug") || (lsGet("cx-kgs-slugs", {}) || {})[batchId] || batchId;
  const ICON = {
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
  };
  const SV = {
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'
  };
  const stripHtml = (t) => String(t == null ? "" : t).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

  let detail = null, batch = null, meta = null, rooms = [];
  let state = { tab: "lectures", s: null };
  let curList = [], filterText = "";

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200); }

  /* ---------- data layer (live API) ---------- */
  async function init() {
    if (!K) return fail("Course API module missing.");
    if (!/^[A-Za-z0-9_.\-]+$/.test(batchId)) return fail("Batch not found.");
    $("#page").innerHTML = '<div class="list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    try {
      detail = await K.api("/api/courses/" + encodeURIComponent(slug));
    } catch (e) { return fail("This batch could not be loaded. Check your connection and try again.", true); }
    detail = detail || {};
    rooms = (Array.isArray(detail.classrooms) ? detail.classrooms : []).map((r) => ({ id: String(r.id), name: r.name || "Subject", cnt: Number(r.video) || 0, ncnt: Number(r.note) || 0, vids: null, notes: null, loading: null }));
    const teachers = (Array.isArray(detail.teachers) ? detail.teachers : []).map((t) => (t && (t.name || t.title)) || (typeof t === "string" ? t : "")).filter(Boolean);
    const price = detail.price != null && detail.price !== "" ? (Number(detail.price) === 0 ? "Free" : "\u20b9" + Number(detail.price).toLocaleString("en-IN")) : "";
    batch = {
      name: detail.title || "Batch",
      by: teachers.slice(0, 4).join(", ") || (rooms.length + (rooms.length === 1 ? " subject" : " subjects")),
      about: stripHtml(detail.description || detail.short_description || detail.about || ""),
      price
    };
    meta = { previewImage: K.safeUrl(detail.image) || "", language: /[\u0900-\u097F]|hindi/i.test(batch.name) ? "Hindi" : "" };
    document.title = batch.name + " — CODEX STUDYS";
    trackRecent();
    state = readHash();
    history.replaceState(state, "");
    const dl = location.hash.match(/[#&]lec=([^&]+)/);
    if (dl) {
      const lecId = decodeURIComponent(dl[1]), gm = location.hash.match(/[#&]g=([^&]+)/);
      let gi = gm ? rooms.findIndex((r) => r.id === decodeURIComponent(gm[1])) : -1;
      if (gi >= 0) state = { tab: "lectures", s: gi };
      history.replaceState(state, "", "#tab=" + state.tab + (state.s !== null ? "&s=" + state.s : ""));
      render();
      if (gi < 0) gi = await findRoomOf(lecId);
      if (gi >= 0) openLecture(gi, lecId, { startAt: resumePos(lecId), autoplay: true });
      return;
    }
    render();
  }

  function fail(msg, retry) {
    $("#topTitle").textContent = "Batch";
    $("#page").innerHTML = '<div class="empty">' + esc(msg) + (retry ? '<div style="margin-top:14px"><button class="pill-btn solid" id="retryBtn" type="button">Try again</button></div>' : "") + "</div>";
    const b = $("#retryBtn"); if (b) b.addEventListener("click", init);
  }

  function cacheIds(g) { try { localStorage.setItem("cx-kgs-ids:" + batchId + ":" + g.id, JSON.stringify(g.vids.map((v) => v.id))); } catch (e) {} }
  function cachedIds(g) { const a = lsGet("cx-kgs-ids:" + batchId + ":" + g.id, []); return Array.isArray(a) ? a : []; }

  function loadRoom(gi) {
    const g = rooms[gi];
    if (!g) return Promise.reject(new Error("no room"));
    if (g.vids) return Promise.resolve(g);
    if (g.loading) return g.loading;
    g.loading = (async () => {
      const courseId = (detail && detail.id) || batchId;
      const d = await K.api("/api/courses/" + encodeURIComponent(courseId) + "/" + encodeURIComponent(g.id));
      g.vids = (Array.isArray(d && d.videos) ? d.videos : []).map((v) => ({ id: String(v.id), title: v.name || "Lecture", thumb: K.safeUrl(v.thumb), g: gi }));
      g.notes = (Array.isArray(d && d.notes) ? d.notes : []).map((n) => ({ id: String(n.id), title: n.name || "Notes", type: String(n.type || "pdf") }));
      cacheIds(g);
      return g;
    })();
    g.loading.then(() => { g.loading = null; }, () => { g.loading = null; });
    return g.loading;
  }

  // deep link without a room id: look through the subjects one by one
  async function findRoomOf(lecId) {
    for (let gi = 0; gi < rooms.length && gi < 60; gi++) {
      try { const g = await loadRoom(gi); if (g.vids.some((v) => v.id === lecId)) return gi; } catch (e) {}
    }
    return -1;
  }

  function collectPdfs(d) {
    const out = [];
    if (d && Array.isArray(d.pdfs)) d.pdfs.forEach((p) => { const u = K.safeUrl(p && (p.url || p.link)); if (u) out.push({ title: (p && p.title) || "PDF", url: u }); });
    ["pdf_url", "pdf", "file", "url", "note_url"].forEach((k) => { const u = d && typeof d[k] === "string" ? K.safeUrl(d[k]) : ""; if (u && /\.pdf(\?|$)/i.test(u) && !out.some((o) => o.url === u)) out.push({ title: "PDF", url: u }); });
    return out;
  }

  // stream URLs for one lecture -> what LecturePlayer wants (videoUrl + quality map)
  async function getSources(id) {
    const d = await K.api("/api/courses/video/" + encodeURIComponent(id));
    const found = K.scanUrls(d, { hls: [], files: [] }, "", 0);
    const declared = K.safeUrl(d && (d.video_url || d.hls_url || d.url));
    const main = declared || found.hls[0] || "";
    const files = [];
    Object.entries((d && d.mp4s && typeof d.mp4s === "object" && !Array.isArray(d.mp4s)) ? d.mp4s : {}).forEach(([q, u]) => { const url = K.safeUrl(u); if (url) files.push({ q, url }); });
    found.files.forEach((f) => { if (!files.some((m) => m.url === f.url) && f.url !== main) files.push({ q: f.q, url: f.url }); });
    files.sort((a, b) => (parseInt(a.q, 10) || 0) - (parseInt(b.q, 10) || 0));
    const quality = {};
    files.forEach((f) => { const n = parseInt(f.q, 10); if ([360, 480, 720, 1080].includes(n)) quality[n + "p"] = f.url; });
    const isHls = !!main && /\.m3u8(\?|$)/i.test(main);
    const best = files.length ? files[files.length - 1].url : "";
    const videoUrl = main || best;
    return { videoUrl, quality, downloadUrl: (!isHls && main) || best || null, pdfs: collectPdfs(d) };
  }

  /* ---------- nav ---------- */
  function readHash() {
    const m = location.hash.match(/tab=(lectures|notes|about)(?:&s=(\d+))?/);
    return { tab: m ? m[1] : "lectures", s: m && m[2] !== undefined ? +m[2] : null };
  }
  function go(tab, s) {
    state = { tab, s: s === undefined ? null : s };
    filterText = "";
    history.pushState(state, "", "#tab=" + tab + (state.s !== null ? "&s=" + state.s : ""));
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", (e) => {
    if ($("#lv").classList.contains("open") && !(e.state && e.state.p)) closeOverlay(true);
    state = (e.state && e.state.tab) ? { tab: e.state.tab, s: e.state.s === undefined ? null : e.state.s } : readHash();
    filterText = ""; if (batch) render();
  });
  $("#backBtn").addEventListener("click", () => {
    if (state.s !== null) { history.back(); return; }
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) history.back();
    else location.href = "index.html#courses";
  });

  function trackRecent() {
    try {
      const k = "codex-studys-recent";
      const arr = JSON.parse(localStorage.getItem(k) || "[]").filter((x) => x._id !== batchId);
      arr.unshift({ _id: batchId, id: detail.id || batchId, slug, name: batch.name, byName: batch.by || "", language: (meta && meta.language) || "", previewImage: (meta && meta.previewImage) || "" });
      localStorage.setItem(k, JSON.stringify(arr.slice(0, 8)));
      const m = lsGet("cx-kgs-slugs", {}) || {}; m[batchId] = slug; localStorage.setItem("cx-kgs-slugs", JSON.stringify(m));
    } catch (e) {}
  }

  /* ---------- render ---------- */
  const countOf = (g, notes) => notes ? (g.notes ? g.notes.length : g.ncnt) : (g.vids ? g.vids.length : g.cnt);

  function render() {
    const page = $("#page");
    const notesTab = state.tab === "notes";
    const g = state.s !== null && state.tab !== "about" ? rooms[state.s] : null;
    $("#topTitle").textContent = g ? g.name : batch.name;
    if (g) {
      if (!g.vids) {
        const gi = state.s, tab = state.tab;
        page.innerHTML = '<p class="crumb">' + esc(batch.name) + " › " + (notesTab ? "Notes" : "Lectures") + " › " + esc(g.name) + '</p><div class="list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
        loadRoom(gi).then(() => { if (state.s === gi && state.tab === tab) render(); }).catch(() => {
          if (state.s !== gi) return;
          page.innerHTML = '<div class="empty">Couldn\'t load this subject.<div style="margin-top:14px"><button class="pill-btn solid" id="retryRoom" type="button">Try again</button></div></div>';
          const b = $("#retryRoom"); if (b) b.addEventListener("click", render);
        });
        return;
      }
      page.innerHTML = renderItems(g); bindItems(g); return;
    }
    const img = (meta && meta.previewImage) || "assets/codex-telegram.png";
    let html = '<div class="hero"><img class="hero-img" src="' + esc(img) + '" alt="' + esc(batch.name) + '" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src=\'assets/codex-telegram.png\'">' +
      '<div class="hero-body"><h2 class="hero-title">' + esc(batch.name) + '</h2><p class="hero-sub">' + esc(batch.by || "") + '</p>' +
      '<div class="badges"><span class="badge accent">Recorded</span>' + (batch.price ? '<span class="badge">' + esc(batch.price) + "</span>" : "") + ((meta && meta.language) ? '<span class="badge">' + esc(meta.language) + "</span>" : "") + '</div></div></div>' +
      '<div class="tabs">' + ["lectures", "notes", "about"].map((t) => '<button class="tab' + (state.tab === t ? " active" : "") + '" data-tab="' + t + '" type="button">' + t[0].toUpperCase() + t.slice(1) + "</button>").join("") + "</div>";
    if (state.tab === "about") html += renderAbout();
    else html += '<div class="list">' + (rooms.length ? rooms.map((r, i) => subjectRow(r, i)).join("") : '<div class="empty">No subjects have been published for this batch yet.</div>') + "</div>";
    page.innerHTML = html;
    page.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab !== state.tab) go(b.dataset.tab); }));
    page.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => go(state.tab, +b.dataset.s)));
  }

  function subjectRow(g, i) {
    const notes = state.tab === "notes";
    const n = countOf(g, notes);
    if (notes) return '<button class="row" type="button" data-s="' + i + '"><span class="ico pdf">' + ICON.doc + '</span><span class="row-main"><span class="row-name">' + esc(g.name) +
      '</span><div class="row-sub">' + n + (n === 1 ? " note" : " notes") + "</div></span>" + ICON.chev + "</button>";
    const st = chapterStats(i), pct = st.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : 0;
    return '<button class="row chapter" type="button" data-s="' + i + '"><span class="row-main"><span class="row-name">' + esc(g.name) +
      '</span><span class="row-sub">' + st.total + (st.total === 1 ? " Lecture" : " Lectures") + (st.notes ? " | " + st.notes + (st.notes === 1 ? " Note" : " Notes") : "") + '</span>' +
      '<span class="ch-prog"><span class="ch-bar"><i style="width:' + pct + '%"></i></span><b>' + pct + "%</b></span></span>" + ICON.chev + "</button>";
  }

  function renderAbout() {
    const tl = rooms.reduce((n, g) => n + g.cnt, 0), tn = rooms.reduce((n, g) => n + g.ncnt, 0);
    return '<div class="stats" style="grid-template-columns:repeat(4,1fr)"><div class="stat"><b>' + tl + '</b><span>Lectures</span></div><div class="stat"><b>' + tn + '</b><span>Notes</span></div><div class="stat"><b id="lvAbDone">' + batchDoneCount() + '</b><span>Completed</span></div><div class="stat"><b>' + rooms.length + '</b><span>Subjects</span></div></div>' +
      '<div class="about-card"><h3>About this batch</h3><p>' + esc(batch.about || "") + '</p></div>' +
      '<div class="about-card" style="margin-top:14px"><h3>Subjects</h3><div class="tags">' + rooms.map((g) => '<span class="tag">' + esc(g.name) + "</span>").join("") + "</div></div>";
  }

  function renderItems(g) {
    const notes = state.tab === "notes";
    const arr = notes ? g.notes : g.vids;
    let h = '<p class="crumb">' + esc(batch.name) + " › " + (notes ? "Notes" : "Lectures") + " › " + esc(g.name) + "</p>";
    if (arr.length > 10) h += '<input class="search" id="itemSearch" type="search" placeholder="Search in ' + esc(g.name) + '…" autocomplete="off" value="' + esc(filterText) + '">';
    if (!notes) {
      const st = chapterStats(state.s), pct = st.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : 0;
      h = h.replace("</p>", '</p><div class="lv-prog' + (st.total && st.done >= st.total ? " full" : "") + '" id="lvProg"><div class="lv-prog-top"><span id="lvProgTxt">' + st.done + "/" + st.total + ' lectures done</span><b id="lvProgPct">' + pct + '%</b></div><div class="lv-bar"><i id="lvProgFill" style="width:' + pct + '%"></i></div></div>');
    }
    h += '<div class="list" id="itemList"></div>';
    return h;
  }

  function bindItems(g) {
    const notes = state.tab === "notes";
    const arr = notes ? g.notes : g.vids;
    const list = $("#itemList");
    const draw = () => {
      const q = filterText.trim().toLowerCase();
      const rows = [];
      arr.forEach((it, idx) => { if (!q || it.title.toLowerCase().includes(q)) rows.push([it, idx]); });
      curList = rows.map((r) => ({ it: r[0], idx: r[1] }));
      list.innerHTML = rows.length ? rows.map(([it, idx], n) => itemRow(it, idx, n, notes)).join("") : '<div class="empty">' + (arr.length ? "No results found." : (notes ? "No notes in this subject yet." : "No lectures in this subject yet.")) + "</div>";
      const openRow = (el, a) => {
        const n = +el.dataset.n;
        if (notes) { openNote(curList[n].it, a && a.dataset.act); return; }
        openLecture(state.s, curList[n].it.id);
      };
      list.querySelectorAll("[data-n]").forEach((el) => {
        el.addEventListener("click", (e) => {
          const c = e.target.closest("[data-chk]");
          if (c) { e.stopPropagation(); const id = c.dataset.chk; setDone(id, !isDone(id)); return; }
          openRow(el, e.target.closest("[data-act]"));
        });
        el.addEventListener("keydown", (e) => {
          if (e.target !== el) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(el, null); }
        });
      });
    };
    const search = $("#itemSearch");
    if (search) search.addEventListener("input", () => { filterText = search.value; draw(); });
    draw();
  }

  function itemRow(it, idx, n, notes) {
    if (notes) return '<div class="row item" data-n="' + n + '" role="button" tabindex="0"><span class="ico pdf" style="width:42px;height:42px;border-radius:13px">' + ICON.doc + '</span><span class="row-main"><span class="row-name">' + esc(it.title) + '</span></span><span class="act"><button class="pill-btn solid" data-act="view" type="button">View</button><button class="pill-btn" data-act="dl" type="button">Download</button></span></div>';
    const done = isDone(it.id);
    return '<div class="row item' + (done ? " done" : "") + '" data-n="' + n + '" data-fi="' + esc(it.id) + '" data-num="' + (idx + 1) + '" role="button" tabindex="0"><span class="num">' + (done ? "✓" : idx + 1) + '</span><span class="row-main"><span class="row-name">' + esc(it.title) + '</span></span><span class="play">' + ICON.play + '</span><button class="lv-chk" type="button" data-chk="' + esc(it.id) + '" aria-pressed="' + (done ? "true" : "false") + '" aria-label="' + (done ? "Mark as not complete" : "Mark as complete") + '">' + SV.tick + "</button></div>";
  }

  // notes: the PDF link comes from the note's own API record, so resolve it on tap
  async function openNote(n, act) {
    const w = window.open("about:blank", "_blank");
    try {
      const d = await K.api("/api/courses/video/" + encodeURIComponent(n.id));
      const pdfs = collectPdfs(d);
      if (!pdfs.length) throw new Error("no pdf");
      if (w) { w.opener = null; w.location.href = pdfs[0].url; if (act === "dl") toast("PDF opened — use Download there"); }
      else toast("Pop-up blocked — allow pop-ups to open the PDF.");
    } catch (e) {
      if (w) w.close();
      toast("Couldn't find a PDF link for “" + (n.title || "this note") + "”.");
    }
  }

  /* ---------- lecture completion ---------- */
  const DONE_KEY = "cx-done";
  const RECENT_KEY = "codex-studys-recent-lectures";
  const readDone = () => { const m = lsGet(DONE_KEY, {}); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; };
  let doneMap = readDone();
  const lkey = (id) => batchId + "-" + id;
  const isDone = (id) => !!doneMap[lkey(id)];
  const batchDoneCount = () => { doneMap = readDone(); const p = batchId + "-"; return Object.keys(doneMap).filter((k) => k.indexOf(p) === 0).length; };
  let vids = [], lite = [], curG = -1, player = null, cur = -1, playTok = 0;

  function chapterStats(gi) {
    const g = rooms[gi];
    const ids = g.vids ? g.vids.map((v) => v.id) : cachedIds(g);
    const total = g.vids ? g.vids.length : g.cnt;
    return { total, done: ids.reduce((n, id) => n + (isDone(id) ? 1 : 0), 0), notes: g.notes ? g.notes.length : g.ncnt };
  }

  // the lecture screen only ever shows the lectures of the subject being watched
  function setGroup(gi) {
    if (gi === curG) return;
    curG = gi;
    vids = rooms[gi].vids;
    lite = vids.map((f) => ({ id: lkey(f.id), idx: f.id, title: f.title }));
  }

  function setDone(id, on) {
    const m = readDone(), k = lkey(id);
    if (on) m[k] = 1; else delete m[k];
    doneMap = m;
    try { localStorage.setItem(DONE_KEY, JSON.stringify(m)); } catch (e) {}
    document.querySelectorAll("[data-fi]").forEach((r) => {
      if (r.dataset.fi !== String(id)) return;
      r.classList.toggle("done", !!on);
      const n = r.querySelector(".num"); if (n) n.textContent = on ? "✓" : r.dataset.num;
      const c = r.querySelector("[data-chk]"); if (c) { c.setAttribute("aria-pressed", on ? "true" : "false"); c.setAttribute("aria-label", on ? "Mark as not complete" : "Mark as complete"); }
    });
    updateProgressDom();
  }

  function updateProgressDom() {
    const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
    if (state.s !== null && state.tab === "lectures" && rooms[state.s]) {
      const st = chapterStats(state.s), pct = st.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : 0;
      set("lvProgTxt", (el) => { el.textContent = st.done + "/" + st.total + " lectures done"; });
      set("lvProgPct", (el) => { el.textContent = pct + "%"; });
      set("lvProgFill", (el) => { el.style.width = pct + "%"; });
      set("lvProg", (el) => el.classList.toggle("full", st.total > 0 && st.done >= st.total));
    }
    set("lvAbDone", (el) => { el.textContent = String(batchDoneCount()); });
  }

  function resumePos(id) {
    const p = +lsGet("lp:pos:" + lkey(id), 0) || 0;
    return p > 10 ? p : 0;
  }

  /* ---------- recently watched (lecture level) ---------- */
  function trackLecture(f) {
    try {
      const thumb = f.thumb || (meta && meta.previewImage) || "";
      const arr = lsGet(RECENT_KEY, []).filter((x) => !(x && x.b === batchId && String(x.i) === String(f.id)));
      arr.unshift({ b: batchId, i: f.id, t: f.title, bn: batch.name, th: thumb, s: slug, g: rooms[f.g].id, at: Date.now() });
      localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, 10)));
    } catch (e) {}
  }

  /* ---------- lecture screen ---------- */
  function lecData(pos, o, src) {
    const f = vids[pos];
    return {
      id: lkey(f.id), idx: f.id, kind: "v", title: f.title,
      videoUrl: src.videoUrl, downloadUrl: src.downloadUrl,
      quality: src.quality, chapters: [],
      attachments: src.pdfs.map((p) => ({ title: p.title, url: p.url })),
      course: { title: batch.name },
      lectures: lite,
      previousLecture: pos > 0 ? lite[pos - 1] : null,
      nextLecture: pos < vids.length - 1 ? lite[pos + 1] : null,
      startAt: o.startAt || 0, autoplay: o.autoplay !== false
    };
  }

  const playerOpts = {
    onBack: () => closeOverlay(false),
    onNavigate: (n) => { if (n) openLecture(curG, n.idx, {}); },
    onSelectLecture: (l) => { if (l) openLecture(curG, l.idx, {}); },
    onEnded: (d) => { if (d && d.idx != null) setDone(d.idx, true); }
  };

  async function openLecture(gi, id, o) {
    o = o || {};
    const tok = ++playTok;
    let pos;
    try {
      await loadRoom(gi);
      setGroup(gi);
      pos = vids.findIndex((f) => f.id === String(id));
      if (pos < 0) return toast("Lecture not found.");
      if ($("#lv").classList.contains("open")) toast("Loading lecture…");
      const src = await getSources(vids[pos].id);
      if (tok !== playTok) return;
      if (!src.videoUrl) return toast(src.pdfs.length ? "No video for this item — notes are in the Notes tab." : "No playable stream was returned for this lecture.");
      const ov = $("#lv");
      if (!ov.classList.contains("open")) {
        history.pushState(Object.assign({}, state, { p: 1 }), "");
        ov.classList.add("open"); document.body.style.overflow = "hidden";
      }
      cur = pos;
      trackLecture(vids[pos]);
      const d = lecData(pos, o, src);
      if (!player) {
        player = new LecturePlayer($("#lvRoot"), d, playerOpts);
        try { LecturePlayer.mediaSession(player, "assets/icon-192.png"); } catch (e) {}
      } else player.load(d);
    } catch (e) {
      if (tok === playTok) toast("Couldn't load this lecture. Please try again.");
    }
  }

  function closeOverlay(fromPop) {
    const ov = $("#lv"); if (!ov.classList.contains("open")) return;
    playTok++;
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    if (player) { try { player.v.pause(); player.save(); } catch (e) {} }
    ov.classList.remove("open"); document.body.style.overflow = "";
    if (!fromPop && history.state && history.state.p) history.back();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$("#lv").classList.contains("open")) return;
    if (document.fullscreenElement || (player && player.menu)) return;
    closeOverlay(false);
  });
  window.addEventListener("storage", (e) => { if (e.key === DONE_KEY && batch) { doneMap = readDone(); updateProgressDom(); } });

  init();
})();
