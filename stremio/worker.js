/**
 * Cloudflare Worker for Stremio Turkish Master Hub
 * 
 * Free serverless deployment for Stremio.
 * - Proxies static metadata from GitHub Pages
 * - Handles ANY search query dynamically with case-insensitive / Turkish diacritics fuzzy search
 * - NEVER returns 404: unknown searches return HTTP 200 {"metas": []}
 */

const GITHUB_PAGES_BASE = "https://sanjarkola-collab.github.io/cloudstream-turkce-dist/stremio";

function normalizeTurkish(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/[ıİ]/g, 'i')
        .replace(/[üÜ]/g, 'u')
        .replace(/[öÖ]/g, 'o')
        .replace(/[şŞ]/g, 's')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[çÇ]/g, 'c')
        .replace(/[^a-z0-9]/g, '');
}

export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Range",
            "Content-Type": "application/json; charset=utf-8"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = decodeURIComponent(url.pathname);

        // 1. Manifest
        if (path === "/manifest.json" || path === "/") {
            const resp = await fetch(`${GITHUB_PAGES_BASE}/manifest.json`);
            if (resp.ok) {
                const manifest = await resp.json();
                // Add search extras dynamically
                if (manifest.catalogs) {
                    manifest.catalogs.forEach(c => {
                        c.extra = [
                            { name: "search", isRequired: false },
                            { name: "skip", isRequired: false }
                        ];
                    });
                }
                return new Response(JSON.stringify(manifest), { headers: corsHeaders });
            }
        }

        // 2. Dynamic Catalog & Search handler
        const catalogMatch = path.match(/^\/catalog\/([^\/]+)\/([^\/\.]+)(?:\/([^\/]+))?\.json$/);
        if (catalogMatch) {
            const type = catalogMatch[1];
            const id = catalogMatch[2];
            const extraRaw = catalogMatch[3] || "";

            // Fetch the full base catalog from GitHub Pages
            const baseResp = await fetch(`${GITHUB_PAGES_BASE}/catalog/${type}/${id}.json`);
            if (!baseResp.ok) {
                return new Response(JSON.stringify({ metas: [] }), { headers: corsHeaders });
            }

            const data = await baseResp.json();
            let items = data.metas || [];

            if (extraRaw) {
                const params = new URLSearchParams(extraRaw);
                const search = params.get("search");
                const skip = parseInt(params.get("skip") || "0", 10);

                if (search) {
                    const q = normalizeTurkish(search);
                    items = items.filter(it => {
                        const name = normalizeTurkish(it.name || "");
                        const desc = normalizeTurkish(it.description || "");
                        const itemId = normalizeTurkish(it.id || "");
                        return name.includes(q) || desc.includes(q) || itemId.includes(q);
                    });
                }

                items = items.slice(skip, skip + 100);
            }

            return new Response(JSON.stringify({ metas: items }), { headers: corsHeaders });
        }

        // 3. Fallback: Proxy directly from GitHub Pages
        const targetUrl = `${GITHUB_PAGES_BASE}${path}`;
        const proxyResp = await fetch(targetUrl);
        if (proxyResp.ok) {
            return new Response(proxyResp.body, {
                status: 200,
                headers: {
                    ...corsHeaders,
                    "Content-Type": proxyResp.headers.get("Content-Type") || "application/json"
                }
            });
        }

        // If target was not found, return clean empty metas or streams rather than 404
        if (path.includes("/stream/")) {
            return new Response(JSON.stringify({ streams: [] }), { headers: corsHeaders });
        }
        return new Response(JSON.stringify({ metas: [] }), { headers: corsHeaders });
    }
};
