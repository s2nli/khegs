// Cloudflare Worker entry: serves the static site (assets binding) and the read-only /api/kgs proxy.
// (functions/api/kgs.js only runs on Cloudflare *Pages*; on a plain Worker this file does the same job.)
const UPSTREAM = "https://apicf.udemylover.workers.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/kgs" || url.pathname.endsWith("/api/kgs")) {
      const path = url.searchParams.get("path") || "";
      if (!/^\/api\/courses\/[A-Za-z0-9_\-\/?=&%.]*$/.test(path) || path.includes("..") || path.includes("//")) {
        return new Response(JSON.stringify({ success: false, message: "Bad path" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      try {
        const r = await fetch(UPSTREAM + path, {
          headers: {
            Accept: "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
            Origin: "https://darkuniversekgs.vercel.app",
            Referer: "https://darkuniversekgs.vercel.app/"
          }
        });
        return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, message: "Upstream unavailable" }), { status: 502, headers: { "content-type": "application/json" } });
      }
    }
    return env.ASSETS.fetch(request);
  }
};
