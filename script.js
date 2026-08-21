// =====================================================
// CONFIGURATION
// =====================================================
const DEFAULT_WISP = window.SITE_CONFIG?.defaultWisp ?? "wss://glseries.net/wisp/";
const BUILT_IN_SERVERS = [
    { name: "GLSeries", url: "wss://glseries.net/wisp/" }
];

if (!localStorage.getItem("proxServer")) {
    localStorage.setItem("proxServer", DEFAULT_WISP);
}

function getAllWispServers() {
    return [...BUILT_IN_SERVERS, ...getStoredWisps()];
}

// =====================================================
// NOTIFICATIONS (self-contained fallback)
// =====================================================
const notify = (() => {
    const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
    const colors = { success: "#4ade80", error: "#f87171", warning: "#fbbf24", info: "#60a5fa" };

    return (type, title, message) => {
        if (typeof Notify !== "undefined") return Notify[type]?.(title, message);

        const toast = document.createElement("div");
        toast.cssText = `
            position:fixed; bottom:20px; right:20px; z-index:99999;
            background:#1e1e2e; color:#cdd6f4; border:1px solid #313244;
            border-left:3px solid ${colors[type]}; border-radius:8px;
            padding:12px 18px; max-width:340px; font-family:system-ui;
            box-shadow:0 8px 32px rgba(0,0,0,.4);
            animation:toastIn .3s ease-out;
        `;
        toast.innerHTML = `
            <div style="font-weight:600;font-size:13px;margin-bottom:2px;">
                <span style="color:${colors[type]};margin-right:6px;">${icons[type]}</span>${title}
            </div>
            <div style="font-size:12px;opacity:.75;line-height:1.4;">${message}</div>
        `;
        if (!document.getElementById("toast-keyframes")) {
            const style = document.createElement("style");
            style.id = "toast-keyframes";
            style.textContent = `
                @keyframes toastIn { from { transform:translateX(120%); opacity:0; } to { transform:translateX(0); opacity:1; } }
                @keyframes toastOut { from { transform:translateX(0); opacity:1; } to { transform:translateX(120%); opacity:0; } }
            `;
            document.head.appendChild(style);
        }
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = "toastOut .25s ease-in forwards";
            toast.addEventListener("animationend", () => toast.remove());
        }, 3500);
    };
})();

// =====================================================
// SERVER HEALTH CHECKING (unified, pooled)
// =====================================================
const HealthPool = {
    _cache: new Map(),
    _inflight: new Map(),
    _timers: new Map(),
    CACHE_TTL: 15_000,

    async check(url, timeout = 2500) {
        const cached = this._cache.get(url);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) return cached.result;

        const inflight = this._inflight.get(url);
        if (inflight) return inflight;

        const pending = this._ping(url, timeout);
        this._inflight.set(url, pending);
        try {
            return await pending;
        } finally {
            this._inflight.delete(url);
        }
    },

    _ping(url, timeout) {
        return new Promise((resolve) => {
            const start = Date.now();
            let ws = null;
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { ws?.close(); } catch {}
                const entry = { result, timestamp: Date.now() };
                this._cache.set(url, entry);
                resolve(result);
            };

            const timer = setTimeout(() => finish({ url, success: false, latency: null }), timeout);

            try {
                ws = new WebSocket(url);
                ws.onopen = () => finish({ url, success: true, latency: Date.now() - start });
                ws.onerror = () => finish({ url, success: false, latency: null });
            } catch {
                finish({ url, success: false, latency: null });
            }
        });
    },

    /** Debounced health check for UI — coalesces rapid calls */
    debouncedCheck(url, element, delay = 100) {
        const key = url;
        if (this._timers.has(key)) clearTimeout(this._timers.get(key));
        this._timers.set(key, setTimeout(() => {
            this._timers.delete(key);
            this.check(url).then((result) => this._renderResult(element, result));
        }, delay));
    },

    _renderResult(element, result) {
        const dot = element.querySelector(".status-indicator");
        const text = element.querySelector(".ping-text");
        if (!dot || !text) return;
        dot.classList.toggle("status-success", result.success);
        dot.classList.toggle("status-error", !result.success);
        text.textContent = result.success ? `${result.latency}ms` : "Offline";
    },

    invalidate(url) {
        this._cache.delete(url);
    }
};

// =====================================================
// PROACTIVE SERVER SELECTION
// =====================================================
async function initializeWithBestServer() {
    if (localStorage.getItem("wispAutoswitch") === "false") return;

    const allServers = getAllWispServers();
    if (allServers.length <= 1) return;

    const currentUrl = localStorage.getItem("proxServer") || DEFAULT_WISP;
    const current = await HealthPool.check(currentUrl, 3000);

    if (current.success) {
        console.log(`[init] Current server OK: ${currentUrl} (${current.latency}ms)`);
        return;
    }

    console.log("[init] Current server down, searching alternatives...");
    const results = await Promise.all(allServers.map(s => HealthPool.check(s.url, 3000)));
    const best = results.filter(r => r.success).sort((a, b) => a.latency - b.latency)[0];

    if (best && best.url !== currentUrl) {
        console.log(`[init] Auto-switching to ${best.url} (${best.latency}ms)`);
        localStorage.setItem("proxServer", best.url);
        const name = allServers.find(s => s.url === best.url)?.name || "Faster Server";
        notify("info", "Auto-switched", `Using ${name} for best performance`);
    }
}

// =====================================================
// BROWSER STATE
// =====================================================
const BareMux = window.BareMux ?? { BareMuxConnection: class { async setTransport() {} } };

let sharedScramjet = null;
let sharedConnection = null;
let sharedWispUrl = null; // Track which wisp the connection was built for

let tabs = [];
let activeTabId = null;
let nextTabId = 1;

// =====================================================
// UTILITIES
// =====================================================
const getBasePath = () => {
    const base = location.pathname.replace(/[^/]*$/, "");
    return base.endsWith("/") ? base : base + "/";
};

const getStoredWisps = () => {
    try { return JSON.parse(localStorage.getItem("customWisps") ?? "[]"); }
    catch { return []; }
};

const getActiveTab = () => tabs.find(t => t.id === activeTabId);

function saveStoredWisps(arr) {
    localStorage.setItem("customWisps", JSON.stringify(arr));
}

// =====================================================
// SCRAMJET INITIALIZATION (with recursion guard)
// =====================================================
async function getSharedScramjet() {
    if (sharedScramjet) return sharedScramjet;

    const { ScramjetController } = $scramjetLoadController();
    const basePath = getBasePath();

    const controller = new ScramjetController({
        prefix: basePath + "scramjet/",
        files: {
            wasm: "https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.wasm.wasm",
            all: "https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.all.js",
            sync: "https://cdn.jsdelivr.net/gh/Destroyed12121/Staticsj@main/JS/scramjet.sync.js"
        }
    });

    try {
        await controller.init();
    } catch (err) {
        const msg = err?.message ?? "";
        if (msg.includes("IDBDatabase") || msg.includes("object stores")) {
            console.warn("[scramjet] IndexedDB schema error, clearing and retrying...");
            const dbNames = ["scramjet-data", "scrambase", "ScramjetData"];
            await Promise.allSettled(dbNames.map(name => new Promise((res) => {
                const req = indexedDB.deleteDatabase(name);
                req.onsuccess = req.onerror = () => res();
            })));
            // Single retry — no infinite loop
            try {
                await controller.init();
            } catch (retryErr) {
                console.error("[scramjet] Retry failed:", retryErr);
                throw retryErr;
            }
        } else {
            throw err;
        }
    }

    sharedScramjet = controller;
    return sharedScramjet;
}

// =====================================================
// BAREMUX CONNECTION (handles wisp changes cleanly)
// =====================================================
async function getSharedConnection() {
    const wispUrl = localStorage.getItem("proxServer") ?? DEFAULT_WISP;

    // Rebuild connection if wisp changed
    if (sharedConnection && sharedWispUrl !== wispUrl) {
        console.log(`[mux] Wisp changed ${sharedWispUrl} → ${wispUrl}, rebuilding connection`);
        sharedConnection = null;
        sharedWispUrl = null;
    }

    if (sharedConnection) return sharedConnection;

    const basePath = getBasePath();
    sharedConnection = new BareMux.BareMuxConnection(basePath + "bareworker.js");
    await sharedConnection.setTransport(
        "https://cdn.jsdelivr.net/npm/@mercuryworkshop/epoxy-transport@2.1.28/dist/index.mjs",
        [{ wisp: wispUrl }]
    );
    sharedWispUrl = wispUrl;
    return sharedConnection;
}

// =====================================================
// LOADING BAR (smooth animation)
// =====================================================
const LoadingBar = {
    _raf: null,
    _target: 0,
    _current: 0,

    set(tab, percent) {
        if (tab.id !== activeTabId) return;
        this._target = percent;
        if (!this._raf) this._tick();
    },

    _tick() {
        const diff = this._target - this._current;
        if (Math.abs(diff) < 0.5 && this._target === 0) {
            this._current = 0;
            this._render(0);
            this._raf = null;
            return;
        }

        // Ease toward target, slow creep when stuck loading
        const speed = this._target > this._current && this._target < 90 ? 0.4 : 2.5;
        this._current += diff * 0.08 + (diff > 0 ? speed * 0.1 : 0);
        this._current = Math.min(this._current, 100);

        this._render(this._current);

        // Auto-creep if stuck between 10-85%
        if (this._target > 10 && this._target < 85 && Math.abs(diff) < 2) {
            this._target = Math.min(this._target + 0.3, 85);
        }

        this._raf = requestAnimationFrame(() => this._tick());
    },

    _render(pct) {
        const bar = document.getElementById("loading-bar");
        if (!bar) return;
        bar.style.width = pct + "%";
        bar.style.opacity = pct < 0.5 ? "0" : "1";
    },

    complete(tab) {
        this.set(tab, 100);
        setTimeout(() => this.set(tab, 0), 350);
    },

    reset() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
        this._current = 0;
        this._target = 0;
        this._render(0);
    }
};

// =====================================================
// BROWSER UI
// =====================================================
async function initializeBrowser() {
    const root = document.getElementById("app");
    root.innerHTML = `
        <div class="browser-container">
            <div class="flex tabs" id="tabs-container"></div>
            <div class="flex nav">
                <button id="back-btn" title="Back"><i class="fa-solid fa-chevron-left"></i></button>
                <button id="fwd-btn" title="Forward"><i class="fa-solid fa-chevron-right"></i></button>
                <button id="reload-btn" title="Reload"><i class="fa-solid fa-rotate-right"></i></button>
                <div class="address-wrapper">
                    <input class="bar" id="address-bar" autocomplete="off" placeholder="Search or enter URL" spellcheck="false">
                    <button id="home-btn-nav" title="Home"><i class="fa-solid fa-house"></i></button>
                </div>
                <button id="devtools-btn" title="DevTools"><i class="fa-solid fa-code"></i></button>
                <button id="wisp-settings-btn" title="Proxy Settings"><i class="fa-solid fa-gear"></i></button>
            </div>
            <div class="loading-bar-container"><div class="loading-bar" id="loading-bar"></div></div>
            <div class="iframe-container" id="iframe-container">
                <div id="loading" class="message-container" style="display:none;">
                    <div class="message-content">
                        <div class="spinner"></div>
                        <h1 id="loading-title">Connecting</h1>
                        <p id="loading-url">Initializing proxy...</p>
                        <button id="skip-btn">Skip</button>
                    </div>
                </div>
                <div id="error" class="message-container" style="display:none;">
                    <div class="message-content">
                        <h1>Connection Error</h1>
                        <p id="error-message">An error occurred.</p>
                    </div>
                </div>
            </div>
        </div>`;

    // --- Event binding ---
    const $ = (id) => document.getElementById(id);

    $("back-btn").onclick = () => getActiveTab()?.frame.back();
    $("fwd-btn").onclick = () => getActiveTab()?.frame.forward();
    $("reload-btn").onclick = () => getActiveTab()?.frame.reload();
    $("home-btn-nav").onclick = () => { window.location.href = "../index.html"; };
    $("devtools-btn").onclick = toggleDevTools;
    $("wisp-settings-btn").onclick = openSettings;
    $("skip-btn").onclick = () => {
        const tab = getActiveTab();
        if (tab) { tab.loading = false; showOverlay(false); }
    };

    const addrBar = $("address-bar");
    addrBar.onkeyup = (e) => { if (e.key === "Enter") handleSubmit(); };
    addrBar.onfocus = () => addrBar.select();

    // External navigation messages (e.g. from new tab page)
    window.addEventListener("message", (e) => {
        if (e.data?.type === "navigate") handleSubmit(e.data.url);
    });

    createTab(true);
    checkHashParameters();
}

// =====================================================
// TAB MANAGEMENT
// =====================================================
function createTab(makeActive = true) {
    const frame = sharedScramjet.createFrame();
    const tab = {
        id: nextTabId++,
        title: "New Tab",
        url: "",
        frame,
        loading: false,
        favicon: null,
        skipTimer: null,
        loadStart: null
    };

    frame.frame.src = "NT.html";

    frame.addEventListener("urlchange", (e) => {
        tab.url = e.url;
        tab.loading = true;
        tab.loadStart = Date.now();

        if (tab.id === activeTabId) {
            showOverlay(true, e.url);
            LoadingBar.set(tab, 15);
        }

        try {
            const host = new URL(e.url).hostname;
            tab.title = host;
            tab.favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
        } catch {
            tab.title = "Browsing";
            tab.favicon = null;
        }

        refreshTabStrip();
        syncAddressBar();

        // Show skip button after 3s if still loading
        clearTimeout(tab.skipTimer);
        tab.skipTimer = setTimeout(() => {
            if (tab.loading && tab.id === activeTabId) {
                const btn = document.getElementById("skip-btn");
                if (btn) btn.style.display = "inline-block";
            }
        }, 3000);
    });

    frame.frame.addEventListener("load", () => {
        tab.loading = false;
        clearTimeout(tab.skipTimer);

        if (tab.id === activeTabId) {
            showOverlay(false);
            LoadingBar.complete(tab);
        }

        // Try to grab real page title
        try {
            const docTitle = frame.frame.contentWindow.document.title;
            if (docTitle) tab.title = docTitle;
        } catch { /* cross-origin */ }

        if (frame.frame.contentWindow.location.href.includes("NT.html")) {
            tab.title = "New Tab";
            tab.url = "";
            tab.favicon = null;
        }

        refreshTabStrip();
        syncAddressBar();
    });

    tabs.push(tab);
    document.getElementById("iframe-container").appendChild(frame.frame);
    if (makeActive) switchTab(tab.id);
    return tab;
}

function switchTab(tabId) {
    activeTabId = tabId;
    const tab = getActiveTab();

    tabs.forEach(t => t.frame.frame.classList.toggle("hidden", t.id !== tabId));

    if (tab) {
        showOverlay(tab.loading, tab.url);
        LoadingBar.reset();

        if (tab.loading) {
            LoadingBar.set(tab, 50);
            // Restore skip button visibility
            const btn = document.getElementById("skip-btn");
            if (btn && tab.loadStart && Date.now() - tab.loadStart > 3000) {
                btn.style.display = "inline-block";
            }
        }
    }

    refreshTabStrip();
    syncAddressBar();
}

function closeTab(tabId) {
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const tab = tabs[idx];
    clearTimeout(tab.skipTimer);

    // Clean up iframe
    try {
        tab.frame.frame.src = "about:blank";
        tab.frame.frame.remove();
    } catch (e) {
        console.warn("[tab] Cleanup error:", e);
    }

    tabs.splice(idx, 1);

    if (activeTabId === tabId) {
        if (tabs.length > 0) {
            switchTab(tabs[Math.max(0, idx - 1)].id);
        } else {
            window.location.reload();
        }
    } else {
        refreshTabStrip();
    }
}

function showOverlay(show, url = "") {
    const el = document.getElementById("loading");
    if (!el) return;
    el.style.display = show ? "flex" : "none";
    getActiveTab()?.frame.frame.classList.toggle("loading", show);

    if (show) {
        document.getElementById("loading-title").textContent = "Connecting";
        document.getElementById("loading-url").textContent = url || "Loading content...";
        const skip = document.getElementById("skip-btn");
        if (skip) skip.style.display = "none";
    }
}

function refreshTabStrip() {
    const container = document.getElementById("tabs-container");
    if (!container) return;
    container.innerHTML = "";

    for (const tab of tabs) {
        const el = document.createElement("div");
        el.className = `tab${tab.id === activeTabId ? " active" : ""}`;

        let iconHtml;
        if (tab.loading) {
            iconHtml = `<div class="tab-spinner"></div>`;
        } else if (tab.favicon) {
            iconHtml = `<img src="${tab.favicon}" class="tab-favicon" onerror="this.style.display='none'" loading="lazy">`;
        } else {
            iconHtml = "";
        }

        el.innerHTML = `${iconHtml}<span class="tab-title">${escapeHtml(tab.title)}</span><span class="tab-close">&times;</span>`;

        const closeBtn = el.querySelector(".tab-close");
        el.addEventListener("click", () => switchTab(tab.id));
        closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab.id); });

        container.appendChild(el);
    }

    // New tab button
    const newBtn = document.createElement("button");
    newBtn.className = "new-tab";
    newBtn.innerHTML = "<i class='fa-solid fa-plus'></i>";
    newBtn.addEventListener("click", () => createTab(true));
    container.appendChild(newBtn);
}

function syncAddressBar() {
    const bar = document.getElementById("address-bar");
    const tab = getActiveTab();
    if (!bar || !tab) return;
    bar.value = tab.url && !tab.url.includes("NT.html") ? tab.url : "";
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// =====================================================
// NAVIGATION
// =====================================================
function handleSubmit(url) {
    const tab = getActiveTab();
    if (!tab) return;

    let input = (url ?? document.getElementById("address-bar")?.value)?.trim();
    if (!input) return;

    if (!input.startsWith("http://") && !input.startsWith("https://")) {
        input = (input.includes(".") && !input.includes(" "))
            ? `https://${input}`
            : `https://search.brave.com/search?q=${encodeURIComponent(input)}`;
    }

    tab.loading = true;
    showOverlay(true, input);
    LoadingBar.set(tab, 10);
    tab.frame.go(input);
}

async function checkHashParameters() {
    if (!window.location.hash) return;
    const hash = decodeURIComponent(window.location.hash.substring(1));
    if (hash) handleSubmit(hash);
    history.replaceState(null, "", location.pathname);
}

// =====================================================
// DEVTOOLS
// =====================================================
function toggleDevTools() {
    const win = getActiveTab()?.frame.frame.contentWindow;
    if (!win) return;

    try {
        if (win.eruda) { win.eruda.show(); return; }
    } catch { /* cross-origin, inject won't work */ }

    try {
        const script = win.document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/eruda";
        script.onload = () => { try { win.eruda.init(); win.eruda.show(); } catch {} };
        win.document.body.appendChild(script);
    } catch {
        notify("warning", "DevTools", "Cannot inject into this page (cross-origin)");
    }
}

// =====================================================
// SETTINGS MODAL & WISP MANAGEMENT
// =====================================================
function openSettings() {
    const modal = document.getElementById("wisp-settings-modal");
    if (!modal) return;
    modal.classList.remove("hidden");

    document.getElementById("close-wisp-modal").onclick = () => modal.classList.add("hidden");
    document.getElementById("save-custom-wisp").onclick = saveCustomWisp;

    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
    }, { once: true });

    renderServerList();
}

function renderServerList() {
    const list = document.getElementById("server-list");
    if (!list) return;
    list.innerHTML = "";

    const currentUrl = localStorage.getItem("proxServer") ?? DEFAULT_WISP;
    const allServers = getAllWispServers();

    for (let i = 0; i < allServers.length; i++) {
        const server = allServers[i];
        const isActive = server.url === currentUrl;
        const isCustom = i >= BUILT_IN_SERVERS.length;

        const item = document.createElement("div");
        item.className = `wisp-option${isActive ? " active" : ""}`;
        item.dataset.url = server.url;

        const deleteBtn = isCustom
            ? `<button class="delete-wisp-btn" data-delete="${server.url}"><i class="fa-solid fa-trash"></i></button>`
            : "";

        item.innerHTML = `
            <div class="wisp-option-header">
                <div class="wisp-option-name">
                    ${escapeHtml(server.name)}
                    ${isActive ? '<i class="fa-solid fa-check" style="margin-left:8px;font-size:.7em;color:var(--accent);"></i>' : ""}
                </div>
                <div class="server-status">
                    <span class="ping-text">...</span>
                    <div class="status-indicator"></div>
                    ${deleteBtn}
                </div>
            </div>
            <div class="wisp-option-url">${escapeHtml(server.url)}</div>
        `;

        item.addEventListener("click", (e) => {
            if (e.target.closest(".delete-wisp-btn")) return;
            setWisp(server.url);
        });

        list.appendChild(item);

        // Debounced health check
        HealthPool.debouncedCheck(server.url, item);
    }

    // Autoswitch toggle
    const isAutoswitch = localStorage.getItem("wispAutoswitch") !== "false";
    const toggle = document.createElement("div");
    toggle.className = "wisp-option";
    toggle.style.cssText = "margin-top:10px;cursor:default;";
    toggle.innerHTML = `
        <div class="wisp-option-header" style="justify-content:space-between;">
            <div class="wisp-option-name"><i class="fa-solid fa-rotate" style="margin-right:8px;"></i>Auto-switch on failure</div>
            <div class="toggle-switch${isAutoswitch ? " active" : ""}" id="autoswitch-toggle">
                <div class="toggle-knob"></div>
            </div>
        </div>
    `;

    toggle.addEventListener("click", () => {
        const next = !(localStorage.getItem("wispAutoswitch") !== "false");
        localStorage.setItem("wispAutoswitch", String(next));
        document.getElementById("autoswitch-toggle")?.classList.toggle("active", next);
        navigator.serviceWorker.controller?.postMessage({ type: "config", autoswitch: next });
        notify("success", "Settings Saved", `Autoswitch ${next ? "enabled" : "disabled"}`);
        // Short delay so user sees the toggle flip
        setTimeout(() => location.reload(), 800);
    });

    list.appendChild(toggle);

    // Delete button delegation (instead of inline onclick with string URLs)
    list.addEventListener("click", (e) => {
        const btn = e.target.closest(".delete-wisp-btn");
        if (!btn) return;
        e.stopPropagation();
        deleteCustomWisp(btn.dataset.delete);
    }, { once: true });
}

function saveCustomWisp() {
    const input = document.getElementById("custom-wisp-input");
    if (!input) return;
    const url = input.value.trim();
    if (!url) return;

    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
        notify("error", "Invalid URL", "Must start with wss:// or ws://");
        return;
    }

    const existing = [...BUILT_IN_SERVERS, ...getStoredWisps()];
    if (existing.some(s => s.url === url)) {
        notify("warning", "Duplicate", "This server is already in the list.");
        return;
    }

    const customWisps = getStoredWisps();
    const name = `Custom ${customWisps.length + 1}`;
    customWisps.push({ name, url });
    saveStoredWisps(customWisps);

    HealthPool.invalidate(url);
    setWisp(url);
    input.value = "";
}

function deleteCustomWisp(urlToDelete) {
    const customWisps = getStoredWisps().filter(w => w.url !== urlToDelete);
    saveStoredWisps(customWisps);
    HealthPool.invalidate(urlToDelete);

    if (localStorage.getItem("proxServer") === urlToDelete) {
        setWisp(DEFAULT_WISP);
    } else {
        renderServerList();
    }
}

function setWisp(url) {
    const oldUrl = localStorage.getItem("proxServer");
    localStorage.setItem("proxServer", url);
    HealthPool.invalidate(url);

    if (oldUrl !== url) {
        const name = getAllWispServers().find(s => s.url === url)?.name ?? "Custom Server";
        notify("success", "Proxy Changed", `Switching to ${name}...`);
    }

    navigator.serviceWorker.controller?.postMessage({ type: "config", wispurl: url });

    // Invalidate mux connection so it rebuilds on next use
    sharedConnection = null;
    sharedWispUrl = null;

    setTimeout(() => location.reload(), 600);
}

// =====================================================
// SERVICE WORKER COMMUNICATION
// =====================================================
function sendToSW(msg) {
    const sw = navigator.serviceWorker.controller;
    if (sw) {
        sw.postMessage(msg);
        return true;
    }
    return false;
}

async function setupServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    const basePath = getBasePath();
    const reg = await navigator.serviceWorker.register(basePath + "sw.js", { scope: basePath });
    await navigator.serviceWorker.ready;

    const wispUrl = localStorage.getItem("proxServer") ?? DEFAULT_WISP;
    const config = {
        type: "config",
        wispurl: wispUrl,
        servers: getAllWispServers(),
        autoswitch: localStorage.getItem("wispAutoswitch") !== "false"
    };

    // Reliable config delivery: wait for controller if needed
    if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
            const handler = () => {
                navigator.serviceWorker.removeEventListener("controllerchange", handler);
                resolve();
            };
            navigator.serviceWorker.addEventListener("controllerchange", handler);
            // Timeout fallback
            setTimeout(resolve, 2000);
        });
    }

    // Send config (retry once if controller was null)
    if (!sendToSW(config)) {
        await new Promise((r) => setTimeout(r, 300));
        sendToSW(config);
    }

    // Listen for SW-initiated switches
    navigator.serviceWorker.addEventListener("message", (event) => {
        const { type, url, name, message } = event.data ?? {};

        if (type === "wispChanged") {
            console.log("[sw] Autoswitch:", event.data);
            localStorage.setItem("proxServer", url);
            notify("info", "Autoswitched Proxy", `Now using ${name || url} — previous server was slow or offline.`);
        } else if (type === "wispError") {
            console.error("[sw] Wisp error:", event.data);
            notify("error", "Proxy Error", message || "An unknown proxy error occurred.");
        }
    });

    reg.update();
}

// =====================================================
// MAIN ENTRY POINT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
    try {
        await initializeWithBestServer();
        await getSharedScramjet();
        await getSharedConnection();
        await setupServiceWorker();
        initializeBrowser();
    } catch (err) {
        console.error("[init] Fatal error:", err);

        // Show error in UI if app element exists
        const root = document.getElementById("app");
        if (root) {
            root.innerHTML = `
                <div class="message-container" style="display:flex;">
                    <div class="message-content">
                        <h1>Initialization Failed</h1>
                        <p style="opacity:.7;margin-bottom:12px;">${escapeHtml(err.message || String(err))}</p>
                        <button onclick="location.reload()" style="
                            background:var(--accent);color:#000;border:none;
                            padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:600;
                        ">Retry</button>
                    </div>
                </div>`;
        }
    }
});
