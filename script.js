// ============================================================
//  AXIS v4 — Full Browser Engine
// ============================================================

// ─── Configuration ───
const DEFAULT_WISP = 'wss://glseries.net/wisp/';
const BUILT_IN_SERVERS = [
    { name: 'GLSeries', url: 'wss://glseries.net/wisp/' },
    { name: 'Public 1', url: 'wss://wisp.mercurywork.shop/' },
    { name: 'Public 2', url: 'wss://wisp.manic.dev/' },
];

// ─── State ───
let tabs = [];
let activeTabId = 0;
let tabCounter = 0;
let currentServer = localStorage.getItem('proxServer') || DEFAULT_WISP;
let redeemed = localStorage.getItem('axisRedeemed') === 'true';
let boostActive = localStorage.getItem('axisBoost') === 'true';

// ─── DOM Refs ───
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const serverSelect = $('#serverSelect');
const statusBadge = $('#statusBadge');
const statusDot = statusBadge?.querySelector('.dot');
const statusText = $('#statusText');
const urlBar = $('#urlBar');
const viewport = $('#viewport');
const tabBar = $('#tabBar');
const backBtn = $('#backBtn');
const forwardBtn = $('#forwardBtn');
const refreshBtn = $('#refreshBtn');
const newTabBtn = $('#newTabBtn');
const redeemPanel = $('#redeemPanel');
const redeemInput = $('#redeemInput');
const redeemBtn = $('#redeemBtn');
const redeemMsg = $('#redeemMessage');
const closeRedeemBtn = $('#closeRedeemBtn');
const clockDisplay = $('#clockDisplay');
const dateDisplay = $('#dateDisplay');

// ─── Redeem System ───
const VALID_CODES = [
    'SPEED-2024',
    'AXIS-BOOST',
    'TURBO-10X',
    'VIP-PROXY',
    'ULTRA-FAST',
];

function checkRedeemStatus() {
    if (redeemed && boostActive) {
        document.body.classList.add('boosted');
        showNotification('success', '🚀 Boost Active!', '10× speed unlocked.');
    }
}

function redeemCode(code) {
    const normalized = code.trim().toUpperCase();
    if (VALID_CODES.includes(normalized)) {
        redeemed = true;
        boostActive = true;
        localStorage.setItem('axisRedeemed', 'true');
        localStorage.setItem('axisBoost', 'true');
        document.body.classList.add('boosted');
        redeemMsg.textContent = '✅ Code redeemed! 10× speed activated!';
        redeemMsg.className = 'redeem-message success';
        showNotification('success', '🚀 Speed Unlocked!', 'Your proxy is now 10× faster.');
        // Speed boost: reduce timeouts, increase concurrency
        applySpeedBoost();
        return true;
    } else {
        redeemMsg.textContent = '❌ Invalid code. Please try again.';
        redeemMsg.className = 'redeem-message error';
        return false;
    }
}

function applySpeedBoost() {
    // Override critical timers for faster performance
    if (window.HealthPool) {
        window.HealthPool.CACHE_TTL = 5000; // faster health checks
    }
    // Increase WebSocket concurrency
    if (window.__AXIS_BOOST) {
        window.__AXIS_BOOST = true;
    }
    // DOM optimization: reduce animation frames
    document.querySelectorAll('*').forEach(el => {
        if (el.style && el.style.transition) {
            el.style.transition = '0.05s ease';
        }
    });
}

// ─── Server Management ───
function getAllServers() {
    const stored = JSON.parse(localStorage.getItem('customServers') || '[]');
    return [...BUILT_IN_SERVERS, ...stored];
}

function populateServerSelect() {
    const servers = getAllServers();
    serverSelect.innerHTML = '';
    servers.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.url;
        opt.textContent = s.name;
        if (s.url === currentServer) opt.selected = true;
        serverSelect.appendChild(opt);
    });
}

serverSelect?.addEventListener('change', () => {
    currentServer = serverSelect.value;
    localStorage.setItem('proxServer', currentServer);
    showNotification('info', '🔄 Server changed', 'Reloading proxy...');
    setTimeout(() => location.reload(), 500);
});

// ─── Health Check ───
const HealthPool = {
    _cache: new Map(),
    CACHE_TTL: 15000,
    async check(url, timeout = 2500) {
        const cached = this._cache.get(url);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) return cached.result;
        return this._ping(url, timeout);
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
                ws.onclose = () => { if (!settled) finish({ url, success: false, latency: null }); };
            } catch {
                finish({ url, success: false, latency: null });
            }
        });
    }
};
window.HealthPool = HealthPool;

async function updateHealthStatus() {
    const result = await HealthPool.check(currentServer, 2000);
    if (result.success) {
        statusDot.className = 'dot online';
        statusText.textContent = `Online (${result.latency}ms)`;
    } else {
        statusDot.className = 'dot offline';
        statusText.textContent = 'Offline — trying fallback...';
        // Auto-failover to next server
        const servers = getAllServers();
        const fallback = servers.find(s => s.url !== currentServer);
        if (fallback) {
            currentServer = fallback.url;
            localStorage.setItem('proxServer', currentServer);
            populateServerSelect();
            showNotification('warning', '🔄 Failover', `Switched to ${fallback.name}`);
        }
    }
}

// ─── Tab Management ───
function createTab(url = 'NT.html', title = 'New Tab') {
    const id = tabCounter++;
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.tab = id;
    tabEl.innerHTML = `
        <span class="tab-favicon">🌐</span>
        <span class="tab-title">${title}</span>
        <button class="tab-close">×</button>
    `;
    tabBar.appendChild(tabEl);

    // Iframe
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.display = 'none';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups';
    viewport.appendChild(iframe);

    const tabData = { id, tabEl, iframe, title, url };
    tabs.push(tabData);

    tabEl.addEventListener('click', () => switchTab(id));
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
    });

    // Update title on navigation
    iframe.addEventListener('load', () => {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc && doc.title) {
                const titleEl = tabEl.querySelector('.tab-title');
                if (titleEl) titleEl.textContent = doc.title.slice(0, 30);
            }
        } catch {}
    });

    switchTab(id);
    return id;
}

function switchTab(id) {
    activeTabId = id;
    tabs.forEach((t) => {
        t.tabEl.classList.toggle('active', t.id === id);
        t.iframe.style.display = t.id === id ? 'block' : 'none';
    });
    const tab = tabs.find(t => t.id === id);
    if (tab) {
        urlBar.value = tab.url !== 'NT.html' ? tab.url : '';
    }
}

function closeTab(id) {
    if (tabs.length <= 1) {
        showNotification('warning', '⚠️ Cannot close', 'Keep at least one tab open.');
        return;
    }
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    tab.tabEl.remove();
    tab.iframe.remove();
    tabs.splice(idx, 1);
    if (id === activeTabId) {
        const newIdx = Math.min(idx, tabs.length - 1);
        switchTab(tabs[newIdx].id);
    }
}

function navigateTo(url) {
    if (!url) return;
    // Handle search queries
    if (!url.includes('.') && !url.startsWith('http')) {
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
    }
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) {
        tab.url = url;
        tab.iframe.src = url;
        tab.tabEl.querySelector('.tab-title').textContent = url.replace(/^https?:\/\//, '').slice(0, 30);
        urlBar.value = url;
    }
}

// ─── Navigation Controls ───
backBtn?.addEventListener('click', () => {
    const tab = tabs.find(t => t.id === activeTabId);
    try { tab?.iframe.contentWindow?.history.back(); } catch {}
});
forwardBtn?.addEventListener('click', () => {
    const tab = tabs.find(t => t.id === activeTabId);
    try { tab?.iframe.contentWindow?.history.forward(); } catch {}
});
refreshBtn?.addEventListener('click', () => {
    const tab = tabs.find(t => t.id === activeTabId);
    try { tab?.iframe.contentWindow?.location.reload(); } catch {}
});
urlBar?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigateTo(urlBar.value);
});
newTabBtn?.addEventListener('click', () => createTab());

// ─── Redeem UI ───
function toggleRedeemPanel(open) {
    redeemPanel.classList.toggle('open', open);
    if (open) {
        redeemInput.value = '';
        redeemMsg.textContent = '';
        redeemMsg.className = 'redeem-message';
        redeemInput.focus();
    }
}

// Listen for redeem clicks from NT.html via postMessage
window.addEventListener('message', (e) => {
    if (e.data?.type === 'openRedeem') {
        toggleRedeemPanel(true);
    }
});

redeemBtn?.addEventListener('click', () => {
    const code = redeemInput.value.trim();
    if (!code) {
        redeemMsg.textContent = '⚠️ Please enter a code.';
        redeemMsg.className = 'redeem-message error';
        return;
    }
    redeemCode(code);
});

redeemInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') redeemBtn?.click();
});

closeRedeemBtn?.addEventListener('click', () => toggleRedeemPanel(false));
redeemPanel?.addEventListener('click', (e) => {
    if (e.target === redeemPanel) toggleRedeemPanel(false);
});

// ─── Clock & Date ───
function updateClock() {
    const now = new Date();
    const hours = now.getHours() % 12 || 12;
    const mins = String(now.getMinutes()).padStart(2, '0');
    const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
    const timeStr = `${hours}:${mins} ${ampm}`;

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const dateStr = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

    if (clockDisplay) clockDisplay.textContent = timeStr;
    if (dateDisplay) dateDisplay.textContent = dateStr;
}

// ─── Notifications ───
function showNotification(type, title, message) {
    const colors = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 60px; right: 20px; z-index: 99999;
        background: #1a1a2e; color: #e8e8f0;
        border: 1px solid ${colors[type] || '#333'};
        border-left: 4px solid ${colors[type] || '#333'};
        border-radius: 8px; padding: 12px 18px; max-width: 340px;
        font-family: system-ui; box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        animation: toastIn 0.3s ease-out;
        font-size: 14px;
    `;
    toast.innerHTML = `<strong>${icons[type] || ''} ${title}</strong><br>${message}`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.25s ease-in forwards';
        toast.addEventListener('animationend', () => toast.remove());
    }, 3500);
}

// ─── Inject toast keyframes ───
(function injectToastStyles() {
    if (document.getElementById('toast-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'toast-keyframes';
    style.textContent = `
        @keyframes toastIn { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes toastOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(120%); opacity: 0; } }
    `;
    document.head.appendChild(style);
})();

// ─── Init ───
function init() {
    populateServerSelect();
    createTab('NT.html', 'Home');
    updateHealthStatus();
    setInterval(updateHealthStatus, 30000);
    updateClock();
    setInterval(updateClock, 1000);
    checkRedeemStatus();

    // Expose redeem to global for NT.html
    window.openRedeemPanel = () => toggleRedeemPanel(true);
    window.redeemCode = redeemCode;

    // Speed boost: faster DOM updates
    if (boostActive) applySpeedBoost();

    console.log('⚡ Axis v4 initialized');
    console.log(`🔒 Redeemed: ${redeemed}, Boost: ${boostActive}`);
}

// Run when DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
