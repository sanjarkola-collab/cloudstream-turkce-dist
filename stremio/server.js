/**
 * CloudStream & Stremio Turkish Master Hub - Zero-Dependency Stremio Addon Server
 * 
 * Can be run locally: node server.js
 * Or deployed to any Node host (Render, Railway, Heroku, Docker).
 * 
 * Features:
 * - 100% immune to 404 search errors: missing searches return HTTP 200 {"metas": []}
 * - Real-time case-insensitive & Turkish diacritic fuzzy search (e.g. "bein", "trt", "sinema")
 * - Serves manifest, catalog, meta, stream according to Stremio Addon v3 Protocol
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 7000;
const ROOT_DIR = __dirname;

// In-memory catalog database
let db = {
    manifest: null,
    catalogs: {},
    metas: {},
    streams: {}
};

function loadDatabase() {
    try {
        const manifestPath = path.join(ROOT_DIR, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            db.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            // In dynamic mode, ensure search and skip extras are explicitly enabled
            if (db.manifest.catalogs) {
                db.manifest.catalogs.forEach(cat => {
                    cat.extra = [
                        { name: "search", isRequired: false },
                        { name: "skip", isRequired: false }
                    ];
                });
            }
        }

        // Load base catalogs
        const catalogDir = path.join(ROOT_DIR, 'catalog');
        if (fs.existsSync(catalogDir)) {
            ['tv', 'movie', 'series'].forEach(type => {
                const typeDir = path.join(catalogDir, type);
                if (fs.existsSync(typeDir)) {
                    fs.readdirSync(typeDir).forEach(file => {
                        if (file.endsWith('.json') && !file.includes('=')) {
                            const catId = file.replace('.json', '');
                            try {
                                const content = JSON.parse(fs.readFileSync(path.join(typeDir, file), 'utf8'));
                                db.catalogs[`${type}/${catId}`] = content.metas || [];
                            } catch (e) {}
                        }
                    });
                }
            });
        }

        // Load metas
        const metaDir = path.join(ROOT_DIR, 'meta');
        if (fs.existsSync(metaDir)) {
            ['tv', 'movie', 'series'].forEach(type => {
                const typeDir = path.join(metaDir, type);
                if (fs.existsSync(typeDir)) {
                    fs.readdirSync(typeDir).forEach(file => {
                        if (file.endsWith('.json')) {
                            const id = file.replace('.json', '');
                            try {
                                db.metas[`${type}/${id}`] = JSON.parse(fs.readFileSync(path.join(typeDir, file), 'utf8'));
                            } catch (e) {}
                        }
                    });
                }
            });
        }

        // Load streams
        const streamDir = path.join(ROOT_DIR, 'stream');
        if (fs.existsSync(streamDir)) {
            ['tv', 'movie', 'series'].forEach(type => {
                const typeDir = path.join(streamDir, type);
                if (fs.existsSync(typeDir)) {
                    fs.readdirSync(typeDir).forEach(file => {
                        if (file.endsWith('.json')) {
                            const id = file.replace('.json', '');
                            try {
                                db.streams[`${type}/${id}`] = JSON.parse(fs.readFileSync(path.join(typeDir, file), 'utf8'));
                            } catch (e) {}
                        }
                    });
                }
            });
        }

        console.log(`[Stremio] Loaded ${Object.keys(db.catalogs).length} catalogs, ${Object.keys(db.metas).length} metas, ${Object.keys(db.streams).length} streams.`);
    } catch (err) {
        console.error('[Stremio] Error loading database:', err);
    }
}

function normalizeSearch(str) {
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

function handleRequest(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    // 1. Manifest
    if (pathname === '/manifest.json' || pathname === '/') {
        return res.end(JSON.stringify(db.manifest || { id: "error", version: "1.0.0", name: "Error" }, null, 2));
    }

    // 2. Catalog: /catalog/{type}/{id}.json OR /catalog/{type}/{id}/{extra}.json
    const catalogMatch = pathname.match(/^\/catalog\/([^\/]+)\/([^\/\.]+)(?:\/([^\/]+))?\.json$/);
    if (catalogMatch) {
        const type = catalogMatch[1];
        const id = catalogMatch[2];
        const extraRaw = catalogMatch[3] || '';

        const allItems = db.catalogs[`${type}/${id}`] || [];
        
        let filtered = [...allItems];
        let skip = 0;

        if (extraRaw) {
            const extraParams = new URLSearchParams(extraRaw);
            const searchQuery = extraParams.get('search');
            const skipVal = parseInt(extraParams.get('skip'), 10);
            if (!isNaN(skipVal)) skip = skipVal;

            if (searchQuery) {
                const normQuery = normalizeSearch(searchQuery);
                filtered = filtered.filter(item => {
                    const normName = normalizeSearch(item.name || '');
                    const normDesc = normalizeSearch(item.description || '');
                    const normId = normalizeSearch(item.id || '');
                    return normName.includes(normQuery) || normDesc.includes(normQuery) || normId.includes(normQuery);
                });
            }
        }

        const paginated = filtered.slice(skip, skip + 100);
        return res.end(JSON.stringify({ metas: paginated }));
    }

    // 3. Meta: /meta/{type}/{id}.json
    const metaMatch = pathname.match(/^\/meta\/([^\/]+)\/([^\/\.]+)\.json$/);
    if (metaMatch) {
        const type = metaMatch[1];
        const id = metaMatch[2];
        const metaObj = db.metas[`${type}/${id}`];
        if (metaObj) {
            return res.end(JSON.stringify(metaObj));
        }
        // Fallback meta
        return res.end(JSON.stringify({
            meta: {
                id: id,
                type: type,
                name: id.replace(/_/g, ' '),
                posterShape: "square"
            }
        }));
    }

    // 4. Stream: /stream/{type}/{id}.json
    const streamMatch = pathname.match(/^\/stream\/([^\/]+)\/([^\/\.]+)\.json$/);
    if (streamMatch) {
        const type = streamMatch[1];
        const id = streamMatch[2];
        const streamObj = db.streams[`${type}/${id}`];
        if (streamObj) {
            return res.end(JSON.stringify(streamObj));
        }
        return res.end(JSON.stringify({ streams: [] }));
    }

    // Unknown endpoint: Return safe empty JSON rather than 404 to satisfy Stremio clients
    res.end(JSON.stringify({ metas: [], streams: [] }));
}

loadDatabase();

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
    console.log(`🚀 Stremio Turkish Master Hub running at: http://localhost:${PORT}/manifest.json`);
});
