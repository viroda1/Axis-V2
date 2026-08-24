// ─── Axis v4 Service Worker ───
const ADBLOCK = {
    blocked: [
        'googlevideo.com/videoplayback',
        'youtube.com/get_video_info',
        'youtube.com/api/stats/ads',
        'youtube.com/pagead',
        'youtube.com/api/stats',
        'youtube.com/get_midroll',
        'youtube.com/ptracking',
        'youtube.com/youtubei/v1/player',
        'youtube.com/s/player',
        'youtube.com/api/timedtext',
        'facebook.com/ads',
        'facebook.com/tr',
        'fbcdn.net/ads',
        'graph.facebook.com/ads',
        'graph.facebook.com/pixel',
        'ads-api.twitter.com',
        'analytics.twitter.com',
        'twitter.com/i/ads',
        'ads.yahoo.com',
        'advertising.com',
        'adtechus.com',
        'amazon-adsystem.com',
        'adnxs.com',
        'doubleclick.net',
        'googlesyndication.com',
        'googleadservices.com',
        'rubiconproject.com',
        'pubmatic.com',
        'criteo.com',
        'openx.net',
        'taboola.com',
        'outbrain.com',
        'moatads.com',
        'casalemedia.com',
        'unityads.unity3d.com',
        '/ads/',
        '/adserver/',
        '/banner/',
        '/promo/',
        '/tracking/',
        '/beacon/',
        '/metrics/',
        'adsafeprotected.com',
        'chartbeat.com',
        'scorecardresearch.com',
        'quantserve.com',
        'krxd.net',
        'demdex.net'
    ]
};

function isAdBlocked(url) {
    const urlStr = url.toString().toLowerCase();
    return ADBLOCK.blocked.some(pattern => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\./g, '\\.').replace(/\?/g, '\\?'), 'i');
        return regex.test(urlStr);
    });
}

const swPath = self.location.pathname;
const basePath = swPath.substring(0, swPath.lastIndexOf('/') + 1);
self.basePath = self.basePath || basePath;

self.$scramjet = {
    files: {
        wasm: 'https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.wasm.wasm',
        sync: 'https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.sync.js',
    }
};

importScripts('https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.all.js');
importScripts('https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux/dist/index.js');

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker({ prefix: basePath + 'scramjet/' });

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ─── Wisp config ───
let wispConfig = { wispurl: null, servers: [], autoswitch: true };
let serverHealth = new Map();
let currentServerStartTime = null;
const MAX_CONSECUTIVE_FAILURES = 2;
const PING_TIMEOUT = 3000;

let resolveConfigReady;
const configReadyPromise = new Promise(resolve => resolveConfigReady = resolve);

async function pingServer(url) {
    return new Promise((resolve) => {
        const start = Date.now();
        try {
            const ws = new WebSocket(url);
            const timeout = setTimeout(() => {
                try { ws.close(); } catch {}
                resolve({ url, success: false, latency: null });
            }, PING_TIMEOUT);
            ws.onopen = () => {
                clearTimeout(timeout);
                resolve({ url, success: true, latency: Date.now() - start });
                ws.close();
            };
            ws.onerror = () => {
                clearTimeout(timeout);
                resolve({ url, success: false, latency: null });
            };
        } catch {
            resolve({ url, success: false, latency: null });
        }
    });
}

async function getBestServer() {
    const servers = wispConfig.servers.length ? wispConfig.servers : [{ url: wispConfig.wispurl }];
    const results = await Promise.all(servers.map(s => pingServer(s.url)));
    const healthy = results.filter(r => r.success).sort((a, b) => (a.latency || Infinity) - (b.latency || Infinity));
    return healthy.length ? healthy[0].url : null;
}

self.addEventListener('message', (event) => {
    if (event.data?.type === 'wispConfig') {
        wispConfig = event.data.config;
        resolveConfigReady();
    }
});

// ─── Fetch handler ───
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Block ads
    if (isAdBlocked(url)) {
        return event.respondWith(new Response('Blocked by Axis adblock', { status: 403 }));
    }

    // Skip non-HTTP requests
    if (!url.protocol.startsWith('http')) return;

    // Let Scramjet handle it
    event.respondWith(
        (async () => {
            await configReadyPromise;

            // Auto-switch if current server is failing
            if (wispConfig.autoswitch) {
                const health = serverHealth.get(wispConfig.wispurl) || { failures: 0 };
                if (health.failures >= MAX_CONSECUTIVE_FAILURES) {
                    const best = await getBestServer();
                    if (best && best !== wispConfig.wispurl) {
                        wispConfig.wispurl = best;
                        console.log('[SW] Auto-switched to:', best);
                    }
                }
            }

            try {
                const response = await scramjet.fetch(event.request);
                // Track success
                const health = serverHealth.get(wispConfig.wispurl) || { failures: 0 };
                health.failures = 0;
                serverHealth.set(wispConfig.wispurl, health);
                return response;
            } catch (err) {
                // Track failure
                const health = serverHealth.get(wispConfig.wispurl) || { failures: 0 };
                health.failures++;
                serverHealth.set(wispConfig.wispurl, health);
                console.warn('[SW] Fetch failed, trying fallback...', err);

                // Try fallback
                const fallback = await getBestServer();
                if (fallback && fallback !== wispConfig.wispurl) {
                    wispConfig.wispurl = fallback;
                    try {
                        return await scramjet.fetch(event.request);
                    } catch { /* fall through to error */ }
                }
                return new Response('Proxy error', { status: 502 });
            }
        })()
    );
});
