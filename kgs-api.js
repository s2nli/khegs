/* Khan Global Studies live API client (shared by index.html and batch.html). The classroom UI lives in batch.html / batch.js. */
(function () {
  "use strict";

  const API_BASE = "https://apicf.udemylover.workers.dev";
  const PROXY_BASE = "/api/kgs"; // optional Vercel fallback (api/kgs.js) if the browser is blocked by CORS
  const PAGE_LIMIT = 50;

  const memo = new Map();
  let lastGood = "";
  // Last-resort public CORS relays (the API data is public). Only tried if direct + own proxy both fail.
  const PUBLIC_RELAYS = [
    (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u)
  ];

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const safeUrl = (u) => {
    if (u == null || String(u).trim() === "") return "";
    try { const x = new URL(String(u || ""), location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; }
    catch (e) { return ""; }
  };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const fmtDate = (v) => {
    const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };
  /* ---------- API ---------- */
  async function fetchJson(url, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 12000);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json, text/plain, */*" }, signal: ctl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch (e) { throw new Error("not JSON"); }
      if (json && typeof json === "object" && "success" in json) {
        if (!json.success) { const err = new Error(json.message || "API error"); err.api = true; throw err; }
        return json.data;
      }
      return json;
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("timeout");
      throw e;
    } finally { clearTimeout(timer); }
  }

  function proxyBases() {
    const list = [];
    try { list.push(new URL("api/kgs", location.href).pathname); } catch (e) {}
    if (list.indexOf(PROXY_BASE) < 0) list.push(PROXY_BASE);
    return list;
  }

  async function api(path) {
    if (memo.has(path)) return memo.get(path);
    const target = API_BASE + path;
    const routes = [["direct", () => fetchJson(target)]];
    // own proxy: first next to this page (works when the app lives in a sub-folder like /kgs/), then the site root
    proxyBases().forEach((base, n) => routes.push(["own-proxy" + (n || ""), () => fetchJson(base + "?path=" + encodeURIComponent(path))]));
    PUBLIC_RELAYS.forEach((mk, n) => routes.push(["relay" + (n + 1), () => fetchJson(mk(target))]));
    const k = routes.findIndex((r) => r[0] === lastGood); // try the route that worked last time first
    if (k > 0) routes.unshift(routes.splice(k, 1)[0]);
    const failures = [];
    for (const [name, run] of routes) {
      try {
        const data = await run();
        lastGood = name;
        memo.set(path, data);
        return data;
      } catch (e) {
        if (e && e.api) throw e; // the API answered with an error: other routes won't change that
        failures.push(name + ": " + ((e && e.message) || "failed"));
      }
    }
    throw new Error(failures.join(" | "));
  }

  async function fetchBatchPage(page) {
    const data = await api("/api/courses/?page_id=" + encodeURIComponent(page) + "&batch_id=0&limit=" + PAGE_LIMIT);
    return { total: Number(data && data.total) || 0, items: Array.isArray(data && data.items) ? data.items : [] };
  }

  // The video CDN can reject requests carrying a foreign Referer (Dark Universe sends no-referrer on all media too).
  function setReferrer(on) {
    let m = document.querySelector('meta[name="referrer"][data-kgs]');
    if (on && !m) { m = document.createElement("meta"); m.name = "referrer"; m.content = "no-referrer"; m.setAttribute("data-kgs", "1"); document.head.appendChild(m); }
    else if (!on && m) m.remove();
  }

  // Find stream URLs even if the API names its fields differently from the docs.
  function scanUrls(node, out, key, depth) {
    if (depth > 5 || node == null) return out;
    if (typeof node === "string") {
      const u = safeUrl(node);
      if (u && /\.m3u8(\?|$)/i.test(u)) out.hls.push(u);
      else if (u && /\.(mp4|webm|mkv|mov)(\?|$)/i.test(u)) out.files.push({ q: /^\d+p?$/i.test(key || "") ? key : (/\d{3,4}p/i.exec(u) || [key || "MP4"])[0], url: u });
      return out;
    }
    if (Array.isArray(node)) { node.forEach((x) => scanUrls(x, out, key, depth + 1)); return out; }
    if (typeof node === "object") Object.keys(node).forEach((k) => scanUrls(node[k], out, k, depth + 1));
    return out;
  }


  // Opening a batch = go to the batch page (chapters -> lectures -> player). The slug is passed along because the API is keyed by slug.
  function openBatch(batch) {
    const id = batch && (batch._id || batch.id);
    if (!id) return;
    try { const m = JSON.parse(localStorage.getItem("cx-kgs-slugs") || "{}"); if (batch.slug) { m[id] = batch.slug; localStorage.setItem("cx-kgs-slugs", JSON.stringify(m)); } } catch (e) {}
    try { sessionStorage.setItem("cx-scroll", String(Math.round(window.scrollY))); } catch (e) {}
    location.href = "batch.html?id=" + encodeURIComponent(id) + (batch.slug ? "&slug=" + encodeURIComponent(batch.slug) : "");
  }

  window.KGS = { fetchBatchPage, openBatch, api, scanUrls, safeUrl, setReferrer, PAGE_LIMIT };
})();
