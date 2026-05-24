if (!window.LumenFirebase) {
    alert("Firebase non e' stato caricato. Controlla la connessione internet e ricarica Lumen.");
    throw new Error("LumenFirebase non disponibile.");
}

const {
    auth,
    db,
    onAuthStateChanged,
    signOut,
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} = window.LumenFirebase;

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const ADMIN_UID = "AtcZn3udwkY80yPeA55qu28PLis2";
const LUMEN_BOT_UID = "lumen-official-bot";
const LUMEN_BOT_LOGO_PATH = "./Logo/logo.png";

const REPORT_STATUS_LABELS = {
    resolved: "Risolta",
    unresolved: "Non risolta",
    rejected: "Rifiutata",
    received: "Ricevuta"
};

const state = {
    currentUser: null,
    activeChat: null,
    activeChatUnsubscribe: null,
    directMessagesUnsubscribe: null,
    friendUnsubscribers: [],
    groupMessageUnsubscribers: [],
    groupSnapshots: new Map(),
    firstFriendsSnapshot: true,
    firstInviteSnapshot: true,
    lastPendingRequests: new Set(),
    lastGroupInvites: new Set(),
    latestFriendsList: [],
    selectedColor: "purple",
    avatarDataUrl: "",
    selectedGroupId: null,
    friendAliases: {},
    pendingFriendAction: null,
    avatarCrop: null,
    audioContext: null,
    ownProfileUnsubscribe: null,
    presenceHeartbeatId: null,
    friendPresenceMap: new Map(),
    missedAlerts: [],
    homeNotifications: [],
    friendUnreadMap: new Map(),
    notificationsPanelOpen: false,
    voiceMicMuted: false,
    voiceDeafened: false,
    pendingLeaveGroupId: null,
    adminUsersCache: [],
    adminUsersUnsubscribe: null,
    adminReportsUnsubscribe: null,
    adminReportsCache: [],
    adminReportTab: "user",
    pendingReportEvidence: [],
    pendingAdminReportAction: null,
    botProfile: null,
    botUnsubscribe: null,
    currentBan: null,
    previousBan: null,
    banReleaseContext: null,
    banAcknowledgementPending: false,
    banStatusUnsubscribe: null,
    banExpiryTimeoutId: null,
    userAppealsUnsubscribe: null,
    adminAppealsUnsubscribe: null,
    userAppeals: [],
    adminAppeals: [],
    activeDropdown: null
};

function snapExists(snapshot) {
    if (!snapshot) return false;
    return typeof snapshot.exists === "function" ? snapshot.exists() : Boolean(snapshot.exists);
}

function snapData(snapshot) {
    if (!snapshot) return null;
    return typeof snapshot.data === "function" ? snapshot.data() : snapshot.data ?? null;
}

const dom = {
    navButtons: $$(".nav-btn"),
    panels: $$(".panel-content"),
    chatWindow: $("#chat-window-content"),
    homeDashboard: $("#lumen-home-dashboard"),
    activeChatContainer: $("#active-chat-container"),
    settingsContent: $("#section-settings-content"),
    chatPlaceholder: $("#chat-placeholder"),
    messagesContainer: $(".chat-messages"),
    messageInput: $("#message-input"),
    activeChatTitle: $(".chat-header h3"),
    activeChatSubtitle: $("#active-chat-subtitle"),
    activeChatAvatar: $("#active-chat-avatar")
};

function refreshIcons() {
    if (window.lucide?.createIcons) {
        window.lucide.createIcons();
    }
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function getDisplayName(data, fallback = "Utente Lumen") {
    return data?.nickname || data?.name || fallback;
}

function isLumenBot(uid) {
    return uid === LUMEN_BOT_UID;
}

function isVerifiedUser(data, uid = "") {
    return Boolean(data?.isVerified || data?.isOfficial || isLumenBot(uid));
}

function getVerifiedBadgeHtml() {
    return '<span class="lumen-verified-badge" title="Account verificato"><i data-lucide="badge-check"></i></span>';
}

function formatDisplayNameHtml(data, uid = "", fallback = "Utente Lumen") {
    const name = escapeHtml(getDisplayName(data, fallback));
    return isVerifiedUser(data, uid) ? `${name} ${getVerifiedBadgeHtml()}` : name;
}

function isReportActive(report) {
    return !report.status || report.status === "open";
}

function getInitial(name) {
    return (name || "L").trim().charAt(0).toUpperCase() || "L";
}

function normalizeNicknameKey(nickname) {
    return String(nickname ?? "").trim().toLowerCase();
}

async function isNicknameAvailable(nickname, excludeUid = null) {
    const nicknameLower = normalizeNicknameKey(nickname);

    if (!nicknameLower || nicknameLower.length < 2) {
        return false;
    }

    const nicknameQuery = query(
        collection(db, "users"),
        where("nicknameLower", "==", nicknameLower)
    );
    const snapshot = await getDocs(nicknameQuery);

    let taken = false;
    snapshot.forEach((userDoc) => {
        if (userDoc.id !== excludeUid) taken = true;
    });

    return !taken;
}

function showNicknameError(message = "") {
    const errorEl = $("#nickname-error");
    if (!errorEl) return;

    if (!message) {
        errorEl.textContent = "";
        errorEl.classList.add("hidden");
        $("#nickname-input")?.classList.remove("input-error");
        return;
    }

    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
    $("#nickname-input")?.classList.add("input-error");
}

function parseBanDuration(input) {
    const raw = String(input ?? "").trim().toLowerCase();

    if (!raw || ["perm", "perma", "permanent", "permanente", "forever", "infinito", "∞"].includes(raw)) {
        return { ms: null, label: "permanente" };
    }

    const compact = raw.replace(/\s+/g, "");
    const match = compact.match(/^(\d+(?:[.,]\d+)?)(s|sec|secs|secondi|m|min|mins|minuti|h|hr|ore|d|g|gg|giorni|w|wk|settimana|settimane|sett|mo|mese|mesi|y|anno|anni)?$/i);

    if (!match) {
        return { error: "Formato durata non valido. Esempi: 30m, 12h, 7d, 2 settimane, permanente." };
    }

    const amount = Number(match[1].replace(",", "."));
    const unit = (match[2] || "h").toLowerCase();

    const unitMs = {
        s: 1000,
        sec: 1000,
        secs: 1000,
        secondi: 1000,
        m: 60 * 1000,
        min: 60 * 1000,
        mins: 60 * 1000,
        minuti: 60 * 1000,
        h: 60 * 60 * 1000,
        hr: 60 * 60 * 1000,
        ore: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        g: 24 * 60 * 60 * 1000,
        gg: 24 * 60 * 60 * 1000,
        giorni: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
        wk: 7 * 24 * 60 * 60 * 1000,
        settimana: 7 * 24 * 60 * 60 * 1000,
        settimane: 7 * 24 * 60 * 60 * 1000,
        sett: 7 * 24 * 60 * 60 * 1000,
        mo: 30 * 24 * 60 * 60 * 1000,
        mese: 30 * 24 * 60 * 60 * 1000,
        mesi: 30 * 24 * 60 * 60 * 1000,
        y: 365 * 24 * 60 * 60 * 1000,
        anno: 365 * 24 * 60 * 60 * 1000,
        anni: 365 * 24 * 60 * 60 * 1000
    };

    const multiplier = unitMs[unit];
    if (!multiplier || amount <= 0) {
        return { error: "Unita' di tempo non riconosciuta." };
    }

    return {
        ms: Math.round(amount * multiplier),
        label: raw
    };
}

function getPrivateChatId(userId, friendId) {
    return userId < friendId ? `${userId}_${friendId}` : `${friendId}_${userId}`;
}

function getBanUniqueId(ban, uid) {
    if (!ban) return null;
    if (ban.banId) return ban.banId;
    const bannedAtMs = ban.bannedAt?.toDate ? ban.bannedAt.toDate().getTime() : (ban.bannedAt instanceof Date ? ban.bannedAt.getTime() : null);
    return uid && bannedAtMs ? `${uid}_${bannedAtMs}` : uid || null;
}

function accentColorToCss(color) {
    const colors = {
        purple: "#6366f1",
        teal: "#14b8a6",
        pink: "#ec4899",
        orange: "#f97316"
    };

    return colors[color] || color || colors.purple;
}

function readPreference(key, fallback = "") {
    try {
        return localStorage.getItem(key) || fallback;
    } catch {
        return fallback;
    }
}

function writePreference(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* Local storage can be unavailable in some restricted local-file contexts. */
    }
}

function readJsonPreference(key, fallback = {}) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
}

function getBanReentryStorageKey(uid) {
    return uid ? `lumen-ban-reentry-pending-${uid}` : null;
}

function loadBanReentryPending(uid) {
    const key = getBanReentryStorageKey(uid);
    if (!key) return false;
    return localStorage.getItem(key) === "true";
}

function saveBanReentryPending(uid, value) {
    const key = getBanReentryStorageKey(uid);
    if (!key) return;
    if (value) {
        localStorage.setItem(key, "true");
    } else {
        localStorage.removeItem(key);
    }
}

function aliasStorageKey() {
    return state.currentUser ? `lumen-friend-aliases-${state.currentUser.uid}` : "lumen-friend-aliases";
}

function loadFriendAliases() {
    state.friendAliases = readJsonPreference(aliasStorageKey(), {});
}

function saveFriendAliases() {
    writePreference(aliasStorageKey(), JSON.stringify(state.friendAliases));
}

function getFriendDisplayName(friendId, userData) {
    return state.friendAliases[friendId] || getDisplayName(userData, "Amico Lumen");
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
}

function ensureToastStack() {
    let stack = $(".lumen-toast-stack");

    if (!stack) {
        stack = document.createElement("div");
        stack.className = "lumen-toast-stack";
        document.body.appendChild(stack);
    }

    return stack;
}

function playNotificationSound(type = "default") {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        if (!state.audioContext) {
            state.audioContext = new AudioContext();
        }

        const context = state.audioContext;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        const frequencies = {
            message: [660, 880],
            friend: [520, 740],
            group: [420, 630],
            system: [360, 540],
            default: [560, 760]
        };
        const sequence = frequencies[type] || frequencies.default;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(sequence[0], now);
        oscillator.frequency.exponentialRampToValueAtTime(sequence[1], now + 0.09);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.24);
    } catch {
        /* Browsers can block audio until the user interacts with the page. */
    }
}

function isMobileView() {
    return window.matchMedia("(max-width: 900px)").matches;
}

function openMobilePanel() {
    if (!isMobileView()) return;
    document.body.classList.add("mobile-panel-open");
    $("#mobile-panel-backdrop")?.classList.remove("hidden");
    $("#mobile-panel-toggle")?.setAttribute("aria-expanded", "true");
}

function closeMobilePanel() {
    document.body.classList.remove("mobile-panel-open");
    $("#mobile-panel-backdrop")?.classList.add("hidden");
    $("#mobile-panel-toggle")?.setAttribute("aria-expanded", "false");
}

function setMobileListMode(active) {
    document.body.classList.toggle("mobile-list-active", active);
}

function addHomeNotification({ id, icon = "bell", title, text, type = "system", action = null, persist = true }) {
    if (!title) return;

    const notificationId = id || `${type}-${title}-${Date.now()}`;
    const entry = {
        id: notificationId,
        icon,
        title,
        text: text || "",
        type,
        action,
        createdAt: Date.now()
    };

    if (persist) {
        const existingIndex = state.homeNotifications.findIndex((item) => item.id === notificationId);
        if (existingIndex >= 0) {
            state.homeNotifications[existingIndex] = { ...state.homeNotifications[existingIndex], ...entry };
        } else {
            state.homeNotifications.unshift(entry);
            state.homeNotifications = state.homeNotifications.slice(0, 20);
        }
    }

    renderHomeSidebarAlerts();
}

function showNotification({
    title,
    message,
    type = "system",
    icon = "bell",
    sound = true,
    addToHome = true,
    homeId = null,
    homeAction = null
} = {}) {
    const stack = ensureToastStack();
    const toast = document.createElement("div");
    toast.className = `lumen-toast ${type}`;
    toast.innerHTML = `
        <div class="lumen-toast-icon"><i data-lucide="${escapeHtml(icon)}"></i></div>
        <div class="lumen-toast-body">
            <strong>${escapeHtml(title || "Lumen")}</strong>
            <p>${escapeHtml(message || "")}</p>
        </div>
        <button class="lumen-toast-close" type="button" title="Chiudi"><i data-lucide="x"></i></button>
    `;

    const closeToast = () => {
        toast.classList.add("leaving");
        window.setTimeout(() => toast.remove(), 240);
    };

    $(".lumen-toast-close", toast).addEventListener("click", closeToast);
    stack.appendChild(toast);
    refreshIcons();

    if (sound) {
        playNotificationSound(type);
    }

    if (addToHome) {
        addHomeNotification({
            id: homeId || `${type}-${title}`,
            icon,
            title,
            text: message,
            type,
            action: homeAction
        });
    }

    window.setTimeout(closeToast, 5200);
}

function bindAudioUnlock() {
    window.addEventListener("pointerdown", () => {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            if (!state.audioContext) {
                state.audioContext = new AudioContext();
            }
            if (state.audioContext.state === "suspended") {
                state.audioContext.resume();
            }
        } catch {
            /* Audio is optional. */
        }
    }, { once: true });
}

function applyAvatarElement(element, name, color, avatarDataUrl) {
    element.style.backgroundColor = accentColorToCss(color);
    element.style.backgroundImage = "";
    element.style.backgroundSize = "cover";
    element.style.backgroundPosition = "center";
    element.style.backgroundRepeat = "no-repeat";
    element.textContent = getInitial(name);

    if (avatarDataUrl) {
        element.style.backgroundImage = `url("${avatarDataUrl}")`;
        element.textContent = "";
    }
}

function setTheme(theme, persist = true) {
    const validThemes = ["dark", "light", "neon", "lumen", "custom"];
    const selectedTheme = validThemes.includes(theme) ? theme : "dark";

    document.body.classList.remove("dark-theme", "light-theme", "neon-theme", "lumen-theme", "custom-theme");
    document.body.classList.add(`${selectedTheme}-theme`);

    $$(".theme-btn").forEach((button) => {
        button.classList.toggle("active", button.dataset.theme === selectedTheme);
    });

    if (selectedTheme === "custom") {
        applyCustomThemeStyles();
        if (persist) {
            $("#modal-custom-theme").classList.remove("hidden");
        }
    } else {
        document.body.removeAttribute("style");
    }

    if (persist) {
        writePreference("lumen-theme", selectedTheme);
    }
}

function applyCustomThemeStyles() {
    const bg = readPreference("lumen-custom-bg", "#080c12");
    const card = readPreference("lumen-custom-card", "#18202e");
    const accent = readPreference("lumen-custom-accent", "#6366f1");
    const text = readPreference("lumen-custom-text", "#f8fafc");

    const style = document.body.style;
    style.setProperty("--bg-dark", bg);
    style.setProperty("--bg-sidebar", bg);
    style.setProperty("--bg-panel", card);
    style.setProperty("--bg-card", card);
    style.setProperty("--bg-soft", hexToRgba(card, 0.12));
    style.setProperty("--text-main", text);
    style.setProperty("--text-card", text);
    style.setProperty("--text-muted", hexToRgba(text, 0.7));
    style.setProperty("--text-muted-on-card", hexToRgba(text, 0.65));
    style.setProperty("--accent", accent);
    style.setProperty("--accent-hover", accent);
    style.setProperty("--accent-transparent", hexToRgba(accent, 0.15));
    style.setProperty("--border-color", hexToRgba(text, 0.1));
    style.setProperty("--border-subtle", hexToRgba(text, 0.2));
    
    updateThemePreview(bg, card, accent, text);
}

function updateThemePreview(bg, card, accent, text) {
    const mockup = $("#theme-preview-mockup");
    if (!mockup) return;

    mockup.style.setProperty("--preview-bg", bg);
    mockup.style.setProperty("--preview-card", card);
    mockup.style.setProperty("--preview-accent", accent);
    mockup.style.setProperty("--preview-text", text);
    mockup.style.setProperty("--preview-border", hexToRgba(text, 0.1));
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyStoredPreferences() {
    setTheme(readPreference("lumen-theme", "dark"), false);

    if (readPreference("lumen-compact-mode", "false") === "true") {
        document.body.classList.add("compact-mode");
        $("#compact-mode-toggle").checked = true;
    }
}

function setRightView(viewName) {
    dom.homeDashboard.classList.toggle("hidden", viewName !== "home");
    dom.activeChatContainer.classList.toggle("hidden", viewName !== "chat");
    dom.settingsContent.classList.toggle("hidden", viewName !== "settings");
    dom.chatPlaceholder.classList.add("hidden");
    dom.chatWindow.classList.toggle("empty", viewName !== "chat");
}

function showPanel(panelId) {
    let changed = false;
    dom.panels.forEach((panel) => {
        const isActive = panel.id === panelId;
        if (panel.classList.contains("active") !== isActive) {
            panel.classList.toggle("hidden", !isActive);
            panel.classList.toggle("active", isActive);
            changed = true;
        }
    });

    dom.navButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.target === panelId);
    });

    if (panelId === "section-settings-menu") {
        setRightView("settings");
        return;
    }

    if (!state.activeChat || panelId === "section-home") {
        setRightView("home");
    }
}

function handleNavSelection(panelId) {
    showPanel(panelId);

    if (!isMobileView()) {
        if (panelId === "section-settings-menu") {
            setRightView("settings");
        } else if (panelId === "section-home" || !state.activeChat) {
            setRightView("home");
        }
        return;
    }

    if (panelId === "section-home") {
        setMobileListMode(false);
        closeMobilePanel();
        state.activeChat = null;
        if (state.activeChatUnsubscribe) {
            state.activeChatUnsubscribe();
            state.activeChatUnsubscribe = null;
        }
        setRightView("home");
        return;
    }

    if (panelId === "section-settings-menu") {
        setMobileListMode(false);
        closeMobilePanel();
        setRightView("settings");
        return;
    }

    setMobileListMode(true);
    closeMobilePanel();

    if (state.activeChat) {
        state.activeChat = null;
        if (state.activeChatUnsubscribe) {
            state.activeChatUnsubscribe();
            state.activeChatUnsubscribe = null;
        }
    }

    dom.homeDashboard.classList.add("hidden");
    dom.activeChatContainer.classList.add("hidden");
    dom.settingsContent.classList.add("hidden");
    dom.chatWindow.classList.remove("empty");
}

function bindNavigation() {
    dom.navButtons.forEach((button) => {
        button.addEventListener("click", () => handleNavSelection(button.dataset.target));
    });
}

function bindMobileNavigation() {
    const toggle = $("#mobile-panel-toggle");
    const backdrop = $("#mobile-panel-backdrop");

    toggle?.addEventListener("click", () => {
        if (document.body.classList.contains("mobile-list-active")) {
            setMobileListMode(false);
            closeMobilePanel();
            setRightView(state.activeChat ? "chat" : "home");
            return;
        }

        const willOpen = !document.body.classList.contains("mobile-panel-open");
        if (willOpen) {
            openMobilePanel();
            const activeNavBtn = $(".nav-btn.active");
            const currentTarget = activeNavBtn ? activeNavBtn.dataset.target : "section-home";
            showPanel(currentTarget);
        } else {
            closeMobilePanel();
            setRightView(state.activeChat ? "chat" : "home");
        }
    });

    backdrop?.addEventListener("click", () => {
        closeMobilePanel();
        if (!document.body.classList.contains("mobile-list-active")) {
            setRightView(state.activeChat ? "chat" : "home");
        }
    });

    window.addEventListener("resize", () => {
        if (!isMobileView()) {
            setMobileListMode(false);
            closeMobilePanel();
        }
    });
}

function bindSettingsMenu() {
    const buttons = $$(".settings-menu-btn");
    const panels = $$(".sub-settings-panel");

    buttons.forEach((button) => {
        button.addEventListener("click", () => {
            buttons.forEach((item) => item.classList.remove("active"));
            button.classList.add("active");

            panels.forEach((panel) => panel.classList.add("hidden"));
            document.getElementById(button.dataset.settingsTarget)?.classList.remove("hidden");
        });
    });
}

async function observeAuthState() {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = "index.html";
            return;
        }

        state.currentUser = user;
        const profile = await loadUserProfile(user.uid);
        loadFriendAliases();
        const presenceVisible = profile.presenceVisible !== false;

        updateDoc(doc(db, "users", user.uid), {
            status: presenceVisible ? "online" : "offline",
            lastSeenAt: serverTimestamp()
        }).catch(console.error);

        window.addEventListener("beforeunload", () => {
            updateDoc(doc(db, "users", user.uid), {
                status: "offline",
                lastSeenAt: serverTimestamp()
            }).catch(() => {});
        });

        const ban = await checkUserBan(user.uid);
        if (ban) {
            state.currentBan = ban;
            showBanOverlay(ban);
        }

        updateWelcomeTitle(profile);
        listenToOwnProfile();
        startPresenceHeartbeat();
        await ensureLumenBotProfile();
        setupAdminPanel();
        listenToBanStatus();
        listenToUserAppeals();
        listenToFriendsAndRequests();
        listenToGroups();
        listenToGroupInvites();
        listenToDirectMessageNotifications();
        renderHomeDashboard();
        renderHomeSidebarAlerts(profile.pendingRequests?.length || 0, 0);
    });
}

function listenToOwnProfile() {
    if (state.ownProfileUnsubscribe) {
        state.ownProfileUnsubscribe();
    }

    state.ownProfileUnsubscribe = onSnapshot(doc(db, "users", state.currentUser.uid), (snapshot) => {
        if (!snapExists(snapshot)) return;

        const data = snapData(snapshot);
        state.selectedColor = data.accentColor || "purple";
        state.avatarDataUrl = data.avatarDataUrl || "";
        $("#profile-name").textContent = getDisplayName(data, "Utente");
        $("#nickname-input").value = data.nickname || "";
        $("#voice-widget-nickname").textContent = getDisplayName(data, "Utente");
        applyAvatarColor(state.selectedColor);
        $$(".color-option").forEach((option) => {
            option.classList.toggle("selected", option.dataset.color === state.selectedColor);
        });
        $("#presence-toggle").checked = data.presenceVisible !== false;
    });
}

function startPresenceHeartbeat() {
    if (state.presenceHeartbeatId) {
        clearInterval(state.presenceHeartbeatId);
    }

    const pingPresence = () => {
        if (!state.currentUser) return;

        const presenceVisible = $("#presence-toggle")?.checked !== false;
        updateDoc(doc(db, "users", state.currentUser.uid), {
            status: presenceVisible ? "online" : "offline",
            lastSeenAt: serverTimestamp()
        }).catch(() => {});
    };

    pingPresence();
    state.presenceHeartbeatId = setInterval(pingPresence, 45000);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") pingPresence();
    });
}

function isFriendOnline(friendData) {
    if (!friendData || friendData.presenceVisible === false) return false;
    return friendData.status === "online";
}

function renderHomeDashboard() {
    const onlineList = $("#dashboard-online-friends");
    const suggestionsList = $("#dashboard-suggestions");
    if (!onlineList) return;

    const onlineFriends = state.latestFriendsList
        .map((friendId) => {
            const data = state.friendPresenceMap.get(friendId);
            if (!data || !isFriendOnline(data)) return null;
            return {
                id: friendId,
                name: getFriendDisplayName(friendId, data),
                accentColor: data.accentColor || "purple",
                avatarDataUrl: data.avatarDataUrl || ""
            };
        })
        .filter(Boolean);

    if (onlineFriends.length === 0) {
        onlineList.innerHTML = `
            <li class="list-item">
                <div class="avatar-small dashboard-avatar-placeholder"></div>
                <span>Nessun amico online al momento.</span>
            </li>
        `;
    } else {
        onlineList.innerHTML = onlineFriends.map((friend) => `
            <li class="list-item dashboard-friend-online" data-friend-id="${escapeHtml(friend.id)}">
                <div class="avatar-small dashboard-friend-avatar" data-color="${escapeHtml(friend.accentColor)}"></div>
                <span>${escapeHtml(friend.name)}</span>
                <span class="status-dot online dashboard-online-dot"></span>
            </li>
        `).join("");

        $$(".dashboard-friend-online", onlineList).forEach((item) => {
            const friendId = item.dataset.friendId;
            const friendData = state.friendPresenceMap.get(friendId);
            const avatarEl = $(".dashboard-friend-avatar", item);
            applyAvatarElement(avatarEl, item.querySelector("span")?.textContent || "?", friendData?.accentColor || "purple", friendData?.avatarDataUrl || "");
            item.addEventListener("click", () => {
                if (!friendData) return;
                showPanel("section-messages");
                openChatWith(friendId, getFriendDisplayName(friendId, friendData), friendData);
            });
        });
    }

    if (suggestionsList) {
        const pendingCount = $("#pending-list .friend-request-box")?.length || 0;
        const inviteCount = $("#group-invites-list .invite-card")?.length || 0;
        const suggestions = [];

        if (pendingCount > 0) {
            suggestions.push("Hai richieste di amicizia in sospeso nella sezione Amici.");
        }
        if (inviteCount > 0) {
            suggestions.push("Controlla gli inviti ai gruppi nella sezione Gruppi.");
        }
        if (state.latestFriendsList.length === 0) {
            suggestions.push("Aggiungi il tuo primo amico usando il Codice ID.");
        }
        if (suggestions.length === 0) {
            suggestions.push("Personalizza il tema in Impostazioni → Aspetto.");
            suggestions.push("Prova la modalità compatta per liste più dense.");
        }

        suggestionsList.innerHTML = suggestions
            .map((text) => `<li class="list-item"><i data-lucide="lightbulb" class="icon-small"></i><span>${escapeHtml(text)}</span></li>`)
            .join("");
    }

    refreshIcons();
}

function getPendingFriendsCount() {
    return $("#pending-list .friend-request-box")?.length || 0;
}

function getPendingInvitesCount() {
    return $("#group-invites-list .invite-card")?.length || 0;
}

function getUnreadMessagesCount() {
    let total = 0;
    state.friendUnreadMap.forEach((count) => {
        total += count;
    });
    return total;
}

function buildHomeAlertsList(pendingFriends = getPendingFriendsCount(), pendingInvites = getPendingInvitesCount()) {
    const alerts = [];

    if (pendingFriends > 0) {
        alerts.push({
            id: "pending-friends",
            icon: "user-plus",
            title: "Richieste amicizia",
            text: `${pendingFriends} in attesa di risposta`,
            action: () => handleNavSelection("section-friends")
        });
    }

    if (pendingInvites > 0) {
        alerts.push({
            id: "pending-invites",
            icon: "users",
            title: "Inviti gruppo",
            text: `${pendingInvites} invito/i da gestire`,
            action: () => handleNavSelection("section-groups")
        });
    }

    const unreadTotal = getUnreadMessagesCount();
    if (unreadTotal > 0) {
        alerts.push({
            id: "unread-messages",
            icon: "message-square",
            title: "Messaggi non letti",
            text: `${unreadTotal} messaggio/i da leggere`,
            action: () => handleNavSelection("section-messages")
        });
    }

    state.homeNotifications.forEach((alert) => {
        // Mostra solo notifiche di tipo 'message'
        if (alert.type === "message" && !alerts.some((item) => item.id === alert.id)) {
            alerts.push(alert);
        }
    });

    return alerts;
}

function setHomeNotificationsOpen(isOpen) {
    const body = $("#home-notifications-body");
    const toggle = $("#home-notifications-toggle");
    if (!body || !toggle) return;

    state.notificationsPanelOpen = isOpen;
    body.classList.toggle("is-open", isOpen);
    toggle.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
}

function removeHomeNotification(id) {
    state.homeNotifications = state.homeNotifications.filter((n) => n.id !== id);
    renderHomeSidebarAlerts();
}

function renderHomeSidebarAlerts(pendingFriends = getPendingFriendsCount(), pendingInvites = getPendingInvitesCount()) {
    const container = $("#home-missed-alerts");
    const badge = $("#home-notifications-badge");
    if (!container) return;

    const alerts = buildHomeAlertsList(pendingFriends, pendingInvites);
    const totalCount = alerts.length;

    if (badge) {
        badge.textContent = String(totalCount);
        badge.classList.toggle("hidden", totalCount === 0);
    }

    if (totalCount === 0) {
        container.innerHTML = `<p class="secondary-text home-alert-empty">Nessuna notifica al momento.</p>`;
        setHomeNotificationsOpen(false);
        refreshIcons();
        return;
    }

    if (!state.notificationsPanelOpen && totalCount > 0) {
        setHomeNotificationsOpen(true);
    }

    container.innerHTML = alerts.map((alert, index) => `
        <button class="home-alert-item" type="button" data-alert-index="${index}">
            <i data-lucide="${escapeHtml(alert.icon || "bell")}"></i>
            <span>
                <strong>${escapeHtml(alert.title)}</strong>
                <small>${escapeHtml(alert.text)}</small>
            </span>
        </button>
    `).join("");

    container.onclick = (event) => {
        const button = event.target.closest(".home-alert-item");
        if (!button) return;

        event.preventDefault();
        event.stopPropagation();

        const alert = alerts[Number(button.dataset.alertIndex)];
        alert?.action?.();
        closeMobilePanel();
    };

    refreshIcons();
}

function pushMissedAlert(alert) {
    state.missedAlerts.unshift(alert);
    state.missedAlerts = state.missedAlerts.slice(0, 8);
    renderHomeSidebarAlerts();
}

function bindHomeNotifications() {
    const toggle = $("#home-notifications-toggle");

    toggle?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setHomeNotificationsOpen(!state.notificationsPanelOpen);
    });
}

async function loadUserProfile(uid) {
    const userDoc = await getDoc(doc(db, "users", uid));
    const data = snapExists(userDoc) ? snapData(userDoc) : {
        uid,
        nickname: state.currentUser.email?.split("@")[0] || "Utente",
        email: state.currentUser.email || "",
        friends: [],
        pendingRequests: [],
        status: "online",
        presenceVisible: true,
        accentColor: "purple",
        avatarDataUrl: "",
        createdAt: serverTimestamp()
    };

    if (!snapExists(userDoc)) {
        await setDoc(doc(db, "users", uid), data);
    }

    const nickname = getDisplayName(data, "Utente");
    const nicknameLower = data.nicknameLower || normalizeNicknameKey(data.nickname || nickname);

    if (snapExists(userDoc) && !data.nicknameLower && nicknameLower) {
        await updateDoc(doc(db, "users", uid), { nicknameLower }).catch(console.error);
    }
    const accentColor = data.accentColor || "purple";
    const avatarDataUrl = data.avatarDataUrl || "";

    $("#profile-name").textContent = nickname;
    $("#profile-email").textContent = state.currentUser.email;
    $("#nickname-input").value = data.nickname || "";
    $("#friend-code-display").textContent = `${uid.substring(0, 8)}...`;
    $("#copy-my-id-btn").dataset.uid = uid;

    state.selectedColor = accentColor;
    state.avatarDataUrl = avatarDataUrl;
    applyAvatarColor(accentColor);
    $$(".color-option").forEach((option) => {
        option.classList.toggle("selected", option.dataset.color === accentColor);
    });

    $("#presence-toggle").checked = data.presenceVisible !== false;

    return data;
}

function updateWelcomeTitle(profile) {
    const title = $("#dashboard-welcome-title");
    const nickname = profile?.nickname;

    if (title && nickname) {
        title.innerHTML = `<img src="./Logo/logo.png" alt="Lumen" class="dashboard-welcome-logo"> Bentornato su Lumen, ${escapeHtml(nickname)}`;
        refreshIcons();
    }
}

function showBanOverlay(ban, options = {}) {
    const overlay = $("#ban-overlay");
    if (!overlay || !ban) return;

    overlay.classList.remove("hidden");
    document.body.classList.add("banned-user");

    const isResolved = options.resolved || !ban.active;
    const isManualUnban = Boolean(options.manualUnban);
    const resolvedLabel = isManualUnban ? "Sospensione revocata" : "Sospensione terminata";
    const title = isResolved
        ? "Il tuo account è stato riattivato"
        : "Il tuo account è stato sospeso";
    const description = isResolved
        ? "L'accesso a Lumen è stato ripristinato. Premi Riaccedi per completare il rientro." 
        : "Accesso a Lumen bloccato finché la sospensione è attiva. Non è possibile continuare ad usare l'app fino a revoca ban.";

    $("#ban-overlay-title").textContent = title;
    $("#ban-overlay-description").textContent = description;
    $("#ban-status-label").textContent = isResolved ? resolvedLabel : "Sospensione attiva";
    $("#ban-reason").textContent = ban.reason || "Violazione delle regole";
    $("#ban-duration").textContent = ban.duration || "Permanente";
    $("#ban-created-at").textContent = formatFirestoreDate(ban.bannedAt);
    $("#ban-expires-at").textContent = ban.expiresAt ? formatFirestoreDate(ban.expiresAt) : "Permanente";
    $("#ban-admin-id").textContent = ban.bannedBy || "—";

    const unbanNote = options.unbanNote || ban.unbanNote;
    const hasNote = isResolved && Boolean(unbanNote);
    const unbanNoteRow = $("#ban-unban-note-row");
    if (unbanNoteRow) {
        unbanNoteRow.classList.toggle("hidden", !hasNote);
        if (hasNote) {
            $("#ban-unban-note").textContent = unbanNote;
        }
    }

    $("#ban-education-copy").classList.toggle("hidden", !isResolved);
    $("#ban-ended-actions").classList.toggle("hidden", !isResolved);
    $("#ban-active-actions").classList.toggle("hidden", isResolved);
    $("#ban-reentry-button").classList.toggle("hidden", !isResolved);

    renderBanAppeals(state.userAppeals || []);
}

function hideBanOverlay() {
    const overlay = $("#ban-overlay");
    if (!overlay) return;

    overlay.classList.add("hidden");
    document.body.classList.remove("banned-user");
}

function renderBanAppeals(appeals) {
    const container = $("#ban-appeal-status-body");
    if (!container) return;

    const currentBan = state.currentBan || state.previousBan;
    const currentBanId = getBanUniqueId(currentBan, state.currentUser?.uid);
    const currentBanCreatedAtMs = currentBan?.bannedAt?.toDate ? currentBan.bannedAt.toDate().getTime() : (currentBan?.bannedAt instanceof Date ? currentBan.bannedAt.getTime() : null);

    const filteredAppeals = appeals.filter((appeal) => {
        if (!currentBan) return false;
        if (currentBanId && appeal.banId === currentBanId) return true;

        const appealBanCreatedAtMs = appeal.banCreatedAt?.toDate ? appeal.banCreatedAt.toDate().getTime() : (appeal.banCreatedAt instanceof Date ? appeal.banCreatedAt.getTime() : null);
        if (currentBanCreatedAtMs && appealBanCreatedAtMs && currentBanCreatedAtMs === appealBanCreatedAtMs) return true;

        const appealCreatedAtMs = appeal.createdAt?.toDate ? appeal.createdAt.toDate().getTime() : (appeal.createdAt instanceof Date ? appeal.createdAt.getTime() : null);
        return currentBanCreatedAtMs && appealCreatedAtMs && appealCreatedAtMs >= currentBanCreatedAtMs;
    });

    if (!filteredAppeals || filteredAppeals.length === 0) {
        container.innerHTML = '<p class="secondary-text">Nessun appeal inviato. Puoi richiedere la revisione usando il pulsante qui sotto.</p>';
        return;
    }

    const cards = filteredAppeals
        .sort((a, b) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0))
        .map((appeal) => {
            const statusLabel = appeal.status === "pending"
                ? "In elaborazione"
                : appeal.status === "accepted"
                    ? "Accettato"
                    : appeal.status === "partial"
                        ? "Riduzione ban"
                        : appeal.status === "denied"
                            ? "Negato"
                            : "Ignorato";

            const decisionTime = appeal.resolvedAt?.toDate ? formatFirestoreDate(appeal.resolvedAt) : appeal.resolvedAt || null;
            const resolvedNote = appeal.adminNote ? `Nota moderazione: ${escapeHtml(appeal.adminNote)}` : "";
            const statusSummary = appeal.status === "partial"
                ? `Durata ban ridotta a ${escapeHtml(appeal.newDurationLabel || appeal.banDuration || "—")}`
                : appeal.status === "ignored"
                    ? "Appello ignorato. La sospensione continua." 
                    : appeal.status === "accepted"
                        ? "Ban rimosso. Accesso ripristinato." 
                        : "In attesa di revisione del team moderazione.";

            const details = [statusSummary, resolvedNote, decisionTime ? `Decisione: ${escapeHtml(decisionTime)}` : ""]
                .filter(Boolean)
                .join(" ");

            return `
                <article class="user-appeal-card" data-appeal-id="${escapeHtml(appeal.id)}">
                    <div class="user-appeal-card-head">
                        <strong>${escapeHtml(statusLabel)}</strong>
                        <span>${escapeHtml(formatFirestoreDate(appeal.createdAt))}</span>
                    </div>
                    <p class="appeal-meta">${escapeHtml(appeal.appealReason || "Appello inviato")}</p>
                    <p>${escapeHtml(details)}</p>
                </article>
            `;
        })
        .join("");

    container.innerHTML = cards;
    $$(".user-appeal-card", container).forEach((card) => {
        card.addEventListener("click", () => openUserAppealDetail(card.dataset.appealId));
    });
}

function bindBanOverlayControls() {
    $("#ban-logout-button")?.addEventListener("click", async () => {
        if (state.currentUser) {
            await updateDoc(doc(db, "users", state.currentUser.uid), { status: "offline" }).catch(() => {});
        }
        await signOut(auth);
        window.location.href = "index.html";
    });

    $("#ban-appeal-open")?.addEventListener("click", () => {
        showLayeredModal("modal-appeal-request");
    });

    $("#ban-reentry-button")?.addEventListener("click", () => {
        const modalMessage = $("#ban-reentry-message");
        if (!modalMessage) return;

        if (state.banReleaseContext?.manualUnban) {
            modalMessage.textContent = "Il tuo ban è stato rimosso manualmente dal team moderazione. Questa misura serve a mantenere la community sicura e rispettosa. Ti invitiamo a leggere il regolamento per evitare future violazioni.";
        } else {
            modalMessage.textContent = "Il tuo ban è scaduto automaticamente e l'accesso può essere ripristinato. Questa misura serve a mantenere la community sicura e rispettosa. Ti invitiamo a leggere il regolamento per evitare future violazioni.";
        }

        showLayeredModal("modal-ban-reentry");
    });

    $("#ban-reentry-confirm")?.addEventListener("click", () => {
        state.banAcknowledgementPending = false;
        state.previousBan = null;
        state.banReleaseContext = null;
        saveBanReentryPending(state.currentUser?.uid, false);
        hideBanOverlay();
        hideLayeredModal("modal-ban-reentry");
        showNotification({
            title: "Accesso ripristinato",
            message: "Hai completato il processo di rientro. Buon ritorno su Lumen.",
            type: "system",
            icon: "check-circle"
        });
    });
}

function listenToBanStatus() {
    if (!state.currentUser) return;
    if (state.banStatusUnsubscribe) {
        state.banStatusUnsubscribe();
        state.banStatusUnsubscribe = null;
    }

    const banRef = doc(db, "bans", state.currentUser.uid);
    const clearBanExpiryTimer = () => {
        if (state.banExpiryTimeoutId) {
            clearTimeout(state.banExpiryTimeoutId);
            state.banExpiryTimeoutId = null;
        }
    };

    const scheduleExpiry = (expiresAt) => {
        clearBanExpiryTimer();
        if (!expiresAt) return;

        const expiresMs = expiresAt.toDate ? expiresAt.toDate().getTime() : (expiresAt instanceof Date ? expiresAt.getTime() : null);
        if (!expiresMs) return;

        const delay = expiresMs - Date.now();
        if (delay <= 0) {
            updateDoc(banRef, {
                active: false,
                unbanNote: "Ban terminato automaticamente.",
                unbannedAt: serverTimestamp()
            }).catch(console.error);
            return;
        }

        state.banExpiryTimeoutId = setTimeout(() => {
            updateDoc(banRef, {
                active: false,
                unbanNote: "Ban terminato automaticamente.",
                unbannedAt: serverTimestamp()
            }).catch(console.error);
        }, delay + 500);
    };

    state.banStatusUnsubscribe = onSnapshot(banRef, async (snapshot) => {
        const ban = snapExists(snapshot) ? snapData(snapshot) : null;
        const activeBan = ban && ban.active ? ban : null;
        const lastBan = state.currentBan || state.previousBan;
        const now = Date.now();
        const banJustEnded = lastBan && !activeBan && lastBan.active && !state.banAcknowledgementPending;

        if (activeBan && activeBan.expiresAt) {
            const expiresAtMs = activeBan.expiresAt.toDate ? activeBan.expiresAt.toDate().getTime() : (activeBan.expiresAt instanceof Date ? activeBan.expiresAt.getTime() : null);
            if (expiresAtMs && expiresAtMs <= now) {
                await updateDoc(banRef, {
                    active: false,
                    unbanNote: "Ban terminato automaticamente.",
                    unbannedAt: serverTimestamp()
                }).catch(console.error);
                return;
            }
            scheduleExpiry(activeBan.expiresAt);
        } else {
            clearBanExpiryTimer();
        }

        if (activeBan && !activeBan.banId) {
            const banId = getBanUniqueId(activeBan, state.currentUser.uid);
            if (banId) {
                updateDoc(banRef, { banId }).catch(console.error);
            }
        }

        if (banJustEnded) {
            const expiresAt = lastBan.expiresAt?.toDate ? lastBan.expiresAt.toDate().getTime() : null;
            const isExpired = expiresAt && expiresAt <= now;
            const isManualUnban = Boolean(ban && ban.active === false && !isExpired);
            const unbanNote = ban?.unbanNote || (isManualUnban ? "Ban rimosso manualmente." : "Ban terminato automaticamente.");

            state.previousBan = {
                ...lastBan,
                active: false,
                manualUnban: isManualUnban,
                unbanNote,
                endedAt: now
            };

            state.banReleaseContext = {
                manualUnban: isManualUnban,
                unbanNote,
                resolvedAt: now
            };
            state.banAcknowledgementPending = true;
            state.currentBan = null;
            saveBanReentryPending(state.currentUser.uid, true);

            if (isExpired) {
                await sendBotBanExpiryMessage(state.currentUser.uid, lastBan).catch(console.error);
            } else {
                await sendBotManualUnbanMessage(state.currentUser.uid, lastBan, unbanNote).catch(console.error);
            }

            showBanOverlay(state.previousBan, {
                resolved: true,
                manualUnban: isManualUnban,
                unbanNote
            });
            return;
        }

        state.currentBan = activeBan;

        if (state.currentBan) {
            state.previousBan = null;
            state.banAcknowledgementPending = false;
            state.banReleaseContext = null;
            saveBanReentryPending(state.currentUser.uid, false);
            showBanOverlay(state.currentBan, { resolved: false });
        } else if (state.banAcknowledgementPending && state.previousBan) {
            showBanOverlay(state.previousBan, {
                resolved: true,
                manualUnban: state.banReleaseContext?.manualUnban,
                unbanNote: state.banReleaseContext?.unbanNote
            });
        } else if (!state.currentBan && ban && ban.active === false && loadBanReentryPending(state.currentUser.uid)) {
            const isManualUnban = Boolean(ban.unbannedAt && ban.expiresAt && ban.expiresAt.toDate ? ban.expiresAt.toDate().getTime() > Date.now() : false);
            const unbanNote = ban.unbanNote || (isManualUnban ? "Ban rimosso manualmente." : "Ban terminato automaticamente.");
            state.previousBan = {
                ...ban,
                active: false,
                manualUnban: isManualUnban,
                unbanNote,
                endedAt: ban.unbannedAt?.toDate ? ban.unbannedAt.toDate().getTime() : Date.now()
            };
            state.banReleaseContext = {
                manualUnban: isManualUnban,
                unbanNote,
                resolvedAt: Date.now()
            };
            state.banAcknowledgementPending = true;
            showBanOverlay(state.previousBan, {
                resolved: true,
                manualUnban: isManualUnban,
                unbanNote
            });
        } else {
            hideBanOverlay();
        }
    });
}

function listenToUserAppeals() {
    if (!state.currentUser) return;
    if (state.userAppealsUnsubscribe) {
        state.userAppealsUnsubscribe();
        state.userAppealsUnsubscribe = null;
    }

    const appealsQuery = query(
        collection(db, "appeals"),
        where("userId", "==", state.currentUser.uid)
    );

    state.userAppealsUnsubscribe = onSnapshot(appealsQuery, (snapshot) => {
        const appeals = [];
        snapshot.forEach((doc) => appeals.push({ id: doc.id, ...doc.data() }));
        appeals.sort((a, b) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
        state.userAppeals = appeals;
        renderBanAppeals(appeals);
    }, (error) => {
        console.error("Errore listener appeal utente:", error);
        renderBanAppeals([]);
    });
}

async function submitBanAppeal(event) {
    event.preventDefault();
    if (!state.currentUser || !state.currentBan) return;

    const reason = $("#appeal-reason").value.trim();
    const details = $("#appeal-details").value.trim();
    const files = $("#appeal-attachments").files || [];

    if (!reason || !details) {
        alert("Compila tutti i campi obbligatori.");
        return;
    }

    const attachments = [];
    for (const file of Array.from(files)) {
        try {
            const dataUrl = await compressReportImage(file);
            attachments.push({ name: file.name, type: file.type, dataUrl });
        } catch {
            console.warn("Impossibile salvare allegato appeal", file.name);
        }
    }

    const currentBanId = getBanUniqueId(state.currentBan, state.currentUser.uid);
    await addDoc(collection(db, "appeals"), {
        userId: state.currentUser.uid,
        banId: currentBanId,
        banReason: state.currentBan.reason || "—",
        banDuration: state.currentBan.duration || "Permanente",
        banExpiresAt: state.currentBan.expiresAt || null,
        banCreatedAt: state.currentBan.bannedAt || null,
        appealReason: reason,
        appealDetails: details,
        attachments,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    showNotification({
        title: "Appeal inviato",
        message: "La tua richiesta di revisione è stata inviata al team moderazione.",
        type: "system",
        icon: "mail"
    });

    hideLayeredModal("modal-appeal-request");
    $("#appeal-reason").value = "";
    $("#appeal-details").value = "";
    $("#appeal-attachments").value = "";
}

function bindAppealControls() {
    $("#appeal-request-form")?.addEventListener("submit", submitBanAppeal);
    $("#appeal-attachments")?.addEventListener("change", (event) => {
        const input = event.target;
        const preview = $("#appeal-attachments-preview");
        if (!preview) return;
        preview.innerHTML = "";
        const files = input.files || [];
        Array.from(files).forEach((file) => {
            const item = document.createElement("div");
            item.className = "report-evidence-item";
            item.textContent = file.name;
            preview.appendChild(item);
        });
    });
}

async function listenToAdminAppeals() {
    if (state.adminAppealsUnsubscribe) {
        state.adminAppealsUnsubscribe();
        state.adminAppealsUnsubscribe = null;
    }

    const appealsQuery = query(collection(db, "appeals"), orderBy("createdAt", "desc"));
    state.adminAppealsUnsubscribe = onSnapshot(appealsQuery, (snapshot) => {
        const appeals = [];
        snapshot.forEach((doc) => appeals.push({ id: doc.id, ...doc.data() }));
        const visibleAppeals = appeals.filter((appeal) => appeal.adminVisible !== false && appeal.status === "pending");
        state.adminAppeals = visibleAppeals;
        renderAdminAppealsList(visibleAppeals);
        const pendingCount = visibleAppeals.length;
        $("#admin-stat-appeals").textContent = String(pendingCount);
    });
}

function renderAdminAppealsList(appeals) {
    const container = $("#admin-appeals-list");
    if (!container) return;

    if (!appeals || appeals.length === 0) {
        container.innerHTML = '<p class="secondary-text">Nessun appeal disponibile.</p>';
        return;
    }

    container.innerHTML = appeals.map((appeal) => {
        const statusLabel = appeal.status === "pending"
            ? "In elaborazione"
            : appeal.status === "accepted"
                ? "Accettato"
                : appeal.status === "partial"
                    ? "Riduzione ban"
                    : appeal.status === "denied"
                        ? "Negato"
                        : "Ignorato";
        return `
            <article class="admin-appeal-card">
                <div class="admin-appeal-card-head">
                    <strong>${escapeHtml(appeal.userId || "Utente")}</strong>
                    <span class="admin-appeal-badge">${escapeHtml(statusLabel)}</span>
                </div>
                <p><span>Motivo ban:</span> ${escapeHtml(appeal.banReason || "—")}</p>
                <p><span>Richiesta:</span> ${escapeHtml(appeal.appealReason || "—")}</p>
                <p class="appeal-meta">${escapeHtml(formatFirestoreDate(appeal.createdAt))}</p>
                <button class="btn-secondary btn-admin-appeal-open" type="button" data-appeal-id="${escapeHtml(appeal.id)}">Apri</button>
            </article>
        `;
    }).join("");

    $$(".btn-admin-appeal-open", container).forEach((button) => {
        button.addEventListener("click", () => openAdminAppealDetail(button.dataset.appealId));
    });
}

async function openAdminAppealDetail(appealId) {
    const appeal = state.adminAppeals.find((item) => item.id === appealId);
    if (!appeal) return;

    const body = $("#admin-appeal-detail-body");
    if (!body) return;

    const statusLabel = appeal.status === "pending"
        ? "In elaborazione"
        : appeal.status === "accepted"
            ? "Accettato"
            : appeal.status === "partial"
                ? "Riduzione ban"
                : appeal.status === "denied"
                    ? "Negato"
                    : "Ignorato";

    const banExpiresAt = appeal.banExpiresAt?.toDate ? appeal.banExpiresAt.toDate() : appeal.banExpiresAt;
    const banActive = !banExpiresAt || banExpiresAt.getTime() > Date.now();
    const banStateLabel = banActive ? "Attivo" : "Scaduto";
    const appealHistory = await fetchAppealHistory(appeal.id, appeal.userId);

    body.innerHTML = `
        <div class="admin-detail-section">
            <h4>Utente</h4>
            <p>${escapeHtml(appeal.userId || "—")}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Motivo ban originale</h4>
            <p>${escapeHtml(appeal.banReason || "—")}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Contenuto appeal</h4>
            <p>${escapeHtml(appeal.appealDetails || "—")}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Stato appeal</h4>
            <p>${escapeHtml(statusLabel)}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Stato ban corrente</h4>
            <p>${escapeHtml(banStateLabel)} - ${escapeHtml(appeal.banDuration || "Permanente")}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Data e ora</h4>
            <p>${escapeHtml(formatFirestoreDate(appeal.createdAt))}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Allegati</h4>
            <p>${appeal.attachments?.length ? escapeHtml(appeal.attachments.map((item) => item.name).join(", ")) : "Nessun allegato."}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Storico moderazione</h4>
            ${appealHistory.length > 0 ? appealHistory.map((log) => `
                <div class="admin-log-item">
                    <strong>${escapeHtml(log.action || "Azione")}</strong>
                    <span>${escapeHtml(formatFirestoreDate(log.createdAt))}</span>
                    <p>${escapeHtml(log.details || "")}</p>
                </div>
            `).join("") : `<p class="secondary-text">Nessuno storico moderazione.</p>`}
        </div>
    `;

    $("#admin-appeal-accept").dataset.appealId = appeal.id;
    $("#admin-appeal-ignore").dataset.appealId = appeal.id;
    showLayeredModal("modal-admin-appeal-detail");
}

function openUserAppealDetail(appealId) {
    const appeal = state.userAppeals?.find((item) => item.id === appealId);
    if (!appeal) return;

    const body = $("#user-appeal-detail-body");
    if (!body) return;

    const statusLabel = appeal.status === "pending"
        ? "In elaborazione"
        : appeal.status === "accepted"
            ? "Accettato"
            : appeal.status === "partial"
                ? "Riduzione ban"
                : appeal.status === "denied"
                    ? "Negato"
                    : "Ignorato";

    const resolutionDetails = appeal.status === "pending"
        ? "Il tuo appeal è ancora in attesa di revisione da parte del team moderazione."
        : appeal.status === "accepted"
            ? "Il ban è stato rimosso e il tuo account è stato riattivato."
            : appeal.status === "partial"
                ? `Durata ban ridotta a ${escapeHtml(appeal.newDurationLabel || appeal.banDuration || "—")}.`
                : appeal.status === "ignored"
                    ? "Il tuo appeal è stato ignorato. La sospensione continua fino alla scadenza prevista."
                    : "Il tuo appeal è stato aggiornato.";

    body.innerHTML = `
        <div class="admin-detail-section">
            <h4>Stato appeal</h4>
            <p>${escapeHtml(statusLabel)}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Richiesta inviata</h4>
            <p>${escapeHtml(formatFirestoreDate(appeal.createdAt))}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Motivo appeal</h4>
            <p>${escapeHtml(appeal.appealReason || "—")}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Dettagli</h4>
            <p>${escapeHtml(appeal.appealDetails || "—")}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Durata ban originale</h4>
            <p>${escapeHtml(appeal.banDuration || "Permanente")}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Scadenza ban</h4>
            <p>${escapeHtml(appeal.banExpiresAt?.toDate ? formatFirestoreDate(appeal.banExpiresAt) : appeal.banExpiresAt || "Permanente")}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Esito</h4>
            <p>${escapeHtml(resolutionDetails)}</p>
        </div>
        ${appeal.adminNote ? `<div class="admin-detail-section"><h4>Nota admin</h4><p>${escapeHtml(appeal.adminNote)}</p></div>` : ""}
    `;

    showLayeredModal("modal-user-appeal-detail");
}

async function updateAppealStatus(appealId, status, adminNote = "", options = {}) {
    if (!appealId) return;

    const appealRef = doc(db, "appeals", appealId);
    const appealSnap = await getDoc(appealRef);
    if (!snapExists(appealSnap)) return;

    const appeal = snapData(appealSnap);
    const { partialBan = false, banDurationMs = null, banDurationLabel = "Permanente" } = options;

    const updateData = {
        status: partialBan ? "partial" : status,
        adminNote,
        newDurationLabel: partialBan ? banDurationLabel : null,
        newExpiresAt: partialBan ? new Date(Date.now() + banDurationMs).toISOString() : null,
        resolvedBy: state.currentUser.uid,
        resolvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        adminVisible: false
    };

    if (status === "ignored") {
        await updateDoc(appealRef, {
            ...updateData,
            status: "ignored"
        });

        await appendModerationLog({
            action: `appeal_ignored`,
            targetUid: appeal.userId,
            details: `IGNORED — ${adminNote}`,
            adminUid: state.currentUser.uid,
            appealId: appeal.id
        });

        await sendBotAppealMessage(appeal.userId, {
            appeal,
            resolutionStatus: "ignored",
            adminNote
        });

        showNotification({
            title: "Appeal ignorato",
            message: "L'appeal è stato ignorato e non sarà più visibile nell'interfaccia admin.",
            type: "system",
            icon: "shield-off"
        });
        return;
    }

    await updateDoc(appealRef, updateData);

    await appendModerationLog({
        action: `appeal_${status}`,
        targetUid: appeal.userId,
        details: `${status.toUpperCase()}${partialBan ? " parziale" : ""} — ${adminNote}`,
        adminUid: state.currentUser.uid,
        appealId: appeal.id
    });

    if (status === "accepted" && partialBan && banDurationMs !== null) {
        await updateBanDuration(appeal.userId, banDurationMs, banDurationLabel);
        await sendBotAppealMessage(appeal.userId, {
            appeal,
            resolutionStatus: "partial",
            adminNote,
            newDurationLabel: banDurationLabel,
            newExpiresAt: new Date(Date.now() + banDurationMs).toISOString()
        });

        showNotification({
            title: "Ban ridotto",
            message: "L'utente rimane bannato con nuova scadenza.",
            type: "system",
            icon: "shield-alert"
        });
    } else if (status === "accepted") {
        await unbanUser(appeal.userId, adminNote || "Ban rimosso dopo appeal accettato.");
        await sendBotAppealMessage(appeal.userId, {
            appeal,
            resolutionStatus: "accepted",
            adminNote
        });

        showNotification({
            title: "Utente sbloccato",
            message: "L'utente è stato sbannato e l'accesso è stato ripristinato.",
            type: "system",
            icon: "shield-check"
        });
    }
}

async function sendBotAppealMessage(targetUserId, { appeal, resolutionStatus, adminNote = "", newDurationLabel = "", newExpiresAt = "" }) {
    if (!targetUserId || !appeal) return;

    await ensureLumenBotProfile();
    const chatId = getPrivateChatId(targetUserId, LUMEN_BOT_UID);
    const statusLabel = resolutionStatus === "accepted"
        ? "Riattivato"
        : resolutionStatus === "partial"
            ? "Accettato parzialmente"
            : resolutionStatus === "denied"
                ? "Negato"
                : resolutionStatus === "ignored"
                    ? "Ignorato"
                    : "In elaborazione";

    const createdAtLabel = new Date().toLocaleString("it-IT", {
        dateStyle: "short",
        timeStyle: "medium"
    });

    const appealCard = {
        appealId: appeal.id,
        status: resolutionStatus,
        statusLabel,
        appealReason: appeal.appealReason || "—",
        appealDetails: appeal.appealDetails || "—",
        adminNote,
        createdAtLabel,
        newDurationLabel,
        newExpiresAt
    };

    let messageText = `Il tuo appeal è stato aggiornato: ${statusLabel}.`;
    if (resolutionStatus === "accepted") {
        messageText = `Il tuo account è stato riattivato. Motivo: ${adminNote || "Nessuna motivazione aggiunta."}`;
    } else if (resolutionStatus === "ignored") {
        messageText = `Il tuo appeal è stato ignorato e la sospensione rimane attiva.`;
    } else if (resolutionStatus === "partial") {
        messageText = `Il tuo appeal è stato approvato parzialmente. Nuova durata ban: ${newDurationLabel || "—"}. Motivo admin: ${adminNote || "Nessuna motivazione aggiunta."}`;
        if (newExpiresAt) {
            messageText += ` Nuova scadenza: ${new Date(newExpiresAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" })}.`;
        }
    }

    await addDoc(collection(db, "messages"), {
        chatId,
        senderId: LUMEN_BOT_UID,
        receiverId: targetUserId,
        text: messageText,
        messageType: "appeal_update",
        appealCard,
        isBot: true,
        isRead: false,
        timestamp: serverTimestamp()
    });
}

async function fetchAppealHistory(appealId, targetUid) {
    try {
        const historyQuery = query(
            collection(db, "moderation_logs"),
            where("targetUid", "==", targetUid),
            orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(historyQuery);
        return snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() }));
    } catch (error) {
        console.error("Errore caricamento storico appeal", error);
        return [];
    }
}

async function getLatestIgnoredAppeal(targetUserId) {
    if (!targetUserId) return null;

    const ignoredQuery = query(
        collection(db, "appeals"),
        where("userId", "==", targetUserId),
        where("status", "==", "ignored"),
        orderBy("resolvedAt", "desc")
    );
    const snapshot = await getDocs(ignoredQuery);
    if (snapshot.docs.length === 0) return null;
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

async function sendBotBanExpiryMessage(targetUserId, ban) {
    if (!targetUserId || !ban) return;
    if (!ban.expiresAt) return;

    await ensureLumenBotProfile();
    const chatId = getPrivateChatId(targetUserId, LUMEN_BOT_UID);
    const banCreatedAt = ban.bannedAt?.toDate ? formatFirestoreDate(ban.bannedAt) : "—";
    const banExpiresAt = ban.expiresAt?.toDate ? formatFirestoreDate(ban.expiresAt) : "—";

    const banSummary = {
        userId: targetUserId,
        reason: ban.reason || "Violazione delle regole",
        duration: ban.duration || "Permanente",
        startedAt: banCreatedAt,
        endedAt: banExpiresAt
    };

    const ignoredAppeal = await getLatestIgnoredAppeal(targetUserId);
    let messageText = `Il tuo ban temporaneo è terminato automaticamente. Dettagli: motivo ${banSummary.reason}, inizio ${banSummary.startedAt}, durata ${banSummary.duration}.`;
    if (ignoredAppeal) {
        messageText = `Il tuo appeal è stato ignorato. ${messageText} Fine ban: ${banSummary.endedAt}.`;
        if (ignoredAppeal.adminNote) {
            messageText += ` Nota admin: ${ignoredAppeal.adminNote}.`;
        }
    }

    await addDoc(collection(db, "messages"), {
        chatId,
        senderId: LUMEN_BOT_UID,
        receiverId: targetUserId,
        text: messageText,
        messageType: "ban_expired",
        banSummary,
        isBot: true,
        isRead: false,
        timestamp: serverTimestamp()
    });
}

async function sendBotManualUnbanMessage(targetUserId, ban, unbanNote) {
    if (!targetUserId || !ban) return;

    await ensureLumenBotProfile();
    const chatId = getPrivateChatId(targetUserId, LUMEN_BOT_UID);
    const banCreatedAt = ban.bannedAt?.toDate ? formatFirestoreDate(ban.bannedAt) : "—";
    const banExpiresAt = ban.expiresAt?.toDate ? formatFirestoreDate(ban.expiresAt) : "—";

    const banSummary = {
        userId: targetUserId,
        reason: ban.reason || "Violazione delle regole",
        duration: ban.duration || "Permanente",
        startedAt: banCreatedAt,
        endedAt: banExpiresAt,
        unbanNote: unbanNote || "Nessuna nota amministrativa."
    };

    await addDoc(collection(db, "messages"), {
        chatId,
        senderId: LUMEN_BOT_UID,
        receiverId: targetUserId,
        text: `Il tuo account è stato sbloccato manualmente. Dettagli: motivo ${banSummary.reason}, inizio ${banSummary.startedAt}, durata ${banSummary.duration}. Nota admin: ${banSummary.unbanNote}`,
        messageType: "ban_unbanned",
        banSummary,
        isBot: true,
        isRead: false,
        timestamp: serverTimestamp()
    });
}

function bindAdminAppealActions() {
    $("#admin-appeal-accept")?.addEventListener("click", (event) => {
        const appealId = event.currentTarget.dataset.appealId;
        if (!appealId) return;
        state.pendingAppealAction = { appealId };
        $("#admin-appeal-confirm-note").value = "";
        $("#admin-appeal-reduce-ban").checked = false;
        $("#admin-appeal-new-duration").value = "";
        $("#admin-appeal-reduce-duration-group").classList.add("hidden");
        showLayeredModal("modal-admin-appeal-confirm");
    });

    $("#admin-appeal-ignore")?.addEventListener("click", async (event) => {
        const appealId = event.currentTarget.dataset.appealId;
        if (!appealId) return;
        const adminNote = prompt("Motivazione admin per l'ignore:", "Appeal ignorato.") || "Appeal ignorato.";
        await updateAppealStatus(appealId, "ignored", adminNote);
        hideLayeredModal("modal-admin-appeal-detail");
    });
}

function bindAdminAppealConfirmActions() {
    $("#admin-appeal-reduce-ban")?.addEventListener("change", (event) => {
        const checked = event.target.checked;
        const group = $("#admin-appeal-reduce-duration-group");
        if (!group) return;
        group.classList.toggle("hidden", !checked);
    });

    $("#admin-appeal-accept-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.pendingAppealAction?.appealId) return;

        const appealId = state.pendingAppealAction.appealId;
        const adminNote = $("#admin-appeal-confirm-note").value.trim();
        const reduceBan = $("#admin-appeal-reduce-ban").checked;
        const durationValue = $("#admin-appeal-new-duration").value.trim();

        if (!adminNote) {
            alert("La motivazione admin è obbligatoria.");
            return;
        }

        if (!reduceBan) {
            await updateAppealStatus(appealId, "accepted", adminNote);
        } else {
            if (!durationValue) {
                alert("Inserisci la nuova durata ban.");
                return;
            }

            const parsed = parseBanDuration(durationValue);
            if (parsed.error) {
                alert(parsed.error);
                return;
            }

            await updateAppealStatus(appealId, "accepted", adminNote, {
                partialBan: true,
                banDurationMs: parsed.ms,
                banDurationLabel: parsed.label
            });
        }

        hideLayeredModal("modal-admin-appeal-confirm");
        hideLayeredModal("modal-admin-appeal-detail");
        state.pendingAppealAction = null;
    });
}

async function updateBanDuration(uid, durationMs, durationLabel) {
    if (!uid || durationMs === null) return;

    const banRef = doc(db, "bans", uid);
    const banSnap = await getDoc(banRef);
    if (!snapExists(banSnap)) return;

    const ban = snapData(banSnap);
    if (!ban?.active) return;

    const expiresAt = durationMs ? new Date(Date.now() + durationMs) : null;
    await updateDoc(banRef, {
        duration: durationLabel,
        expiresAt: expiresAt || null,
        updatedAt: serverTimestamp()
    });
}

function bindFriendControls() {
    $("#add-friend-action-btn").addEventListener("click", sendFriendRequest);
    $("#friend-id-input-real").addEventListener("keydown", (event) => {
        if (event.key === "Enter") sendFriendRequest();
    });

    $("#copy-my-id-btn").addEventListener("click", async function () {
        const fullUid = this.dataset.uid;
        if (!fullUid) return;

        await copyTextToClipboard(fullUid);
        alert("Codice Amico copiato negli appunti.");
    });

    const tabs = $$(".tab-item");
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            tabs.forEach((item) => item.classList.remove("active"));
            tab.classList.add("active");

            $("#friends-list-real").classList.add("hidden");
            $("#pending-list").classList.add("hidden");
            document.getElementById(tab.dataset.tab)?.classList.remove("hidden");
        });
    });

    $("#btn-remove-friend-no").addEventListener("click", () => {
        $("#modal-remove-friend").classList.add("hidden");
        state.pendingFriendAction = null;
    });

    $("#btn-remove-friend-yes").addEventListener("click", async () => {
        if (!state.pendingFriendAction) return;

        const { friendId } = state.pendingFriendAction;
        await removeFriend(friendId);
        $("#modal-remove-friend").classList.add("hidden");
        state.pendingFriendAction = null;
    });

    $("#btn-friend-alias-save").addEventListener("click", () => {
        if (!state.pendingFriendAction) return;

        saveFriendAlias(state.pendingFriendAction.friendId, $("#friend-alias-input").value);
        $("#modal-friend-alias").classList.add("hidden");
        state.pendingFriendAction = null;
    });

    $("#btn-friend-alias-clear").addEventListener("click", () => {
        if (!state.pendingFriendAction) return;

        saveFriendAlias(state.pendingFriendAction.friendId, "");
        $("#modal-friend-alias").classList.add("hidden");
        state.pendingFriendAction = null;
    });

    $("#friend-alias-input").addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || !state.pendingFriendAction) return;

        saveFriendAlias(state.pendingFriendAction.friendId, $("#friend-alias-input").value);
        $("#modal-friend-alias").classList.add("hidden");
        state.pendingFriendAction = null;
    });
}

async function sendFriendRequest() {
    if (!state.currentUser) return;

    const input = $("#friend-id-input-real");
    const friendId = input.value.trim();

    if (!friendId) {
        alert("Inserisci un ID valido.");
        return;
    }

    if (friendId === state.currentUser.uid) {
        alert("Non puoi aggiungere te stesso.");
        return;
    }

    try {
        const friendRef = doc(db, "users", friendId);
        const friendDoc = await getDoc(friendRef);

        if (!friendDoc.exists()) {
            alert("Nessun utente trovato con questo ID.");
            return;
        }

        const myDoc = await getDoc(doc(db, "users", state.currentUser.uid));
        const myFriends = myDoc.data()?.friends || [];

        if (myFriends.includes(friendId)) {
            alert("Siete gia' amici.");
            return;
        }

        await updateDoc(friendRef, {
            pendingRequests: arrayUnion(state.currentUser.uid)
        });

        input.value = "";
        alert("Richiesta di amicizia inviata.");
    } catch (error) {
        console.error(error);
        alert("Errore durante l'invio della richiesta.");
    }
}

function listenToFriendsAndRequests() {
    const myRef = doc(db, "users", state.currentUser.uid);

    onSnapshot(myRef, async (snapshot) => {
        if (!snapExists(snapshot)) return;

        const data = snapData(snapshot);
        const friendsList = data.friends || [];
        const pendingRequests = data.pendingRequests || [];

        if (state.firstFriendsSnapshot) {
            state.lastPendingRequests = new Set(pendingRequests);
            state.firstFriendsSnapshot = false;
        } else {
            const newRequests = pendingRequests.filter((requesterId) => !state.lastPendingRequests.has(requesterId));

            for (const requesterId of newRequests) {
                const requesterSnap = await getDoc(doc(db, "users", requesterId));
                const requesterName = getDisplayName(requesterSnap.exists() ? requesterSnap.data() : null);

                showNotification({
                    title: "Nuova richiesta amicizia",
                    message: `${requesterName} vuole aggiungerti su Lumen.`,
                    type: "friend",
                    icon: "user-plus",
                    homeId: `friend-request-${requesterId}`,
                    homeAction: () => handleNavSelection("section-friends")
                });
            }

            state.lastPendingRequests = new Set(pendingRequests);
        }

        renderFriendTabs(friendsList.length, pendingRequests.length);
        await renderPendingRequests(pendingRequests);
        renderFriendsAndConversations(friendsList);
        renderHomeSidebarAlerts(pendingRequests.length, state.lastGroupInvites?.size || 0);
        renderHomeDashboard();
    });
}

function renderFriendTabs(friendsCount, pendingCount) {
    const tabs = $$(".tab-item");

    if (tabs.length >= 2) {
        tabs[0].innerHTML = `<i data-lucide="user-check"></i> Friends (${friendsCount})`;
        tabs[1].innerHTML = `<i data-lucide="clock"></i> Pending (${pendingCount})`;
        refreshIcons();
    }
}

async function renderPendingRequests(pendingRequests) {
    const container = $("#pending-list");

    if (pendingRequests.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="clock"></i>
                <p class="secondary-text">Nessuna richiesta in attesa.</p>
            </div>
        `;
        refreshIcons();
        return;
    }

    container.innerHTML = "";

    for (const requesterId of pendingRequests) {
        const userDoc = await getDoc(doc(db, "users", requesterId));
        const name = getDisplayName(userDoc.exists() ? userDoc.data() : null);
        const item = document.createElement("div");
        item.className = "friend-request-box";
        item.innerHTML = `
            <div class="friend-request-top">
                <div class="chat-item-avatar">${escapeHtml(getInitial(name))}</div>
                <div class="friend-details">
                    <h4>${escapeHtml(name)}</h4>
                    <p>Ti ha inviato una richiesta</p>
                </div>
            </div>
            <div class="friend-request-actions">
                <button class="btn-danger btn-req-reject" type="button">Rifiuta</button>
                <button class="btn-primary btn-req-accept" type="button">Accetta</button>
            </div>
        `;

        $(".btn-req-accept", item).addEventListener("click", () => acceptFriendRequest(requesterId));
        $(".btn-req-reject", item).addEventListener("click", () => rejectFriendRequest(requesterId));
        container.appendChild(item);
    }
}

async function acceptFriendRequest(friendId) {
    await updateDoc(doc(db, "users", state.currentUser.uid), {
        pendingRequests: arrayRemove(friendId),
        friends: arrayUnion(friendId)
    });

    await updateDoc(doc(db, "users", friendId), {
        friends: arrayUnion(state.currentUser.uid)
    });

    showNotification({
        title: "Amico aggiunto",
        message: "La richiesta e' stata accettata.",
        type: "friend",
        icon: "user-check"
    });
}

async function rejectFriendRequest(friendId) {
    await updateDoc(doc(db, "users", state.currentUser.uid), {
        pendingRequests: arrayRemove(friendId)
    });
}

function openRemoveFriendModal(friendId, friendName) {
    state.pendingFriendAction = { friendId, friendName };
    $("#remove-friend-message").textContent = `Vuoi rimuovere ${friendName} dalla lista amici?`;
    $("#modal-remove-friend").classList.remove("hidden");
}

function openFriendAliasModal(friendId, realName) {
    state.pendingFriendAction = { friendId, friendName: realName };
    $("#friend-alias-input").value = state.friendAliases[friendId] || "";
    $("#friend-alias-input").placeholder = realName;
    $("#modal-friend-alias").classList.remove("hidden");
    $("#friend-alias-input").focus();
}

async function removeFriend(friendId) {
    await updateDoc(doc(db, "users", state.currentUser.uid), {
        friends: arrayRemove(friendId)
    });

    await updateDoc(doc(db, "users", friendId), {
        friends: arrayRemove(state.currentUser.uid)
    }).catch(() => {});

    delete state.friendAliases[friendId];
    saveFriendAliases();
    renderFriendsAndConversations(state.latestFriendsList.filter((id) => id !== friendId));

    if (state.activeChat?.type === "private" && state.activeChat.id === friendId) {
        state.activeChat = null;
        if (state.activeChatUnsubscribe) {
            state.activeChatUnsubscribe();
            state.activeChatUnsubscribe = null;
        }
        setRightView("home");
    }

    showNotification({
        title: "Amico rimosso",
        message: "La lista amici e' stata aggiornata.",
        type: "friend",
        icon: "user-minus"
    });
}

function saveFriendAlias(friendId, alias) {
    const cleanedAlias = alias.trim();

    if (cleanedAlias) {
        state.friendAliases[friendId] = cleanedAlias;
    } else {
        delete state.friendAliases[friendId];
    }

    saveFriendAliases();
    renderFriendsAndConversations(state.latestFriendsList);

    if (state.activeChat?.type === "private" && state.activeChat.id === friendId) {
        state.activeChat.name = cleanedAlias || state.pendingFriendAction?.friendName || state.activeChat.name;
        dom.activeChatTitle.textContent = state.activeChat.name;
        applyAvatarElement(dom.activeChatAvatar, state.activeChat.name, state.activeChat.accentColor || "purple", state.activeChat.avatarDataUrl || "");
    }

    showNotification({
        title: cleanedAlias ? "Soprannome salvato" : "Soprannome rimosso",
        message: cleanedAlias || "Ora vedrai il nome originale.",
        type: "system",
        icon: "badge-check"
    });
}

function renderFriendsAndConversations(friendsList) {
    const friendsContainer = $("#friends-list-real");
    const messagesContainer = $("#messages-list");

    state.latestFriendsList = friendsList;
    state.friendUnsubscribers.forEach((unsubscribe) => unsubscribe());
    state.friendUnsubscribers = [];

    if (friendsList.length === 0) {
        friendsContainer.innerHTML = `
            <div class="empty-state">
                <i data-lucide="user-x"></i>
                <p class="primary-text">Nessun amico</p>
                <p class="secondary-text">Usa il codice ID per aggiungerne uno.</p>
            </div>
        `;
        messagesContainer.innerHTML = `
            <div class="empty-state">
                <i data-lucide="message-square"></i>
                <p class="primary-text">Nessuna conversazione</p>
            </div>
        `;
        state.friendUnreadMap.clear();
        renderHomeSidebarAlerts();
        injectBotConversationCard(messagesContainer);
        refreshIcons();
        return;
    }

    friendsContainer.innerHTML = "";
    messagesContainer.innerHTML = "";
    state.friendUnreadMap.clear();

    const cardState = new Map();

    friendsList.forEach((friendId) => {
        const friendCard = document.createElement("div");
        const messageCard = document.createElement("div");

        friendCard.className = "friend-item-card";
        messageCard.className = "friend-item-card";
        friendsContainer.appendChild(friendCard);
        messagesContainer.appendChild(messageCard);

        cardState.set(friendId, {
            friendCard,
            messageCard,
            data: null,
            unread: 0
        });

        const friendUserRef = doc(db, "users", friendId);
        const chatId = getPrivateChatId(state.currentUser.uid, friendId);

        const friendUnsubscribe = onSnapshot(friendUserRef, (friendSnap) => {
            if (!snapExists(friendSnap)) return;
            const card = cardState.get(friendId);
            const friendData = snapData(friendSnap);
            card.data = friendData;
            state.friendPresenceMap.set(friendId, friendData);
            drawFriendCard(friendId, card);
            renderHomeDashboard();
        });

        const unreadQuery = query(
            collection(db, "messages"),
            where("chatId", "==", chatId),
            where("senderId", "==", friendId),
            where("isRead", "==", false)
        );

        const unreadUnsubscribe = onSnapshot(unreadQuery, (unreadSnapshot) => {
            const card = cardState.get(friendId);
            if (!card) return;
            card.unread = unreadSnapshot.size;

            const isCurrentlyChatting = state.activeChat?.type === "private" && state.activeChat.id === friendId;

            if (card.unread > 0 && !isCurrentlyChatting) {
                state.friendUnreadMap.set(friendId, card.unread);
            } else {
                state.friendUnreadMap.delete(friendId);
            }

            drawFriendCard(friendId, card);
            renderHomeSidebarAlerts();
        });

        state.friendUnsubscribers.push(friendUnsubscribe, unreadUnsubscribe);
    });

    injectBotConversationCard(messagesContainer);
}

function drawFriendCard(friendId, card) {
    if (!card.data) return;

    const realName = getDisplayName(card.data, "Amico Lumen");
    const name = getFriendDisplayName(friendId, card.data);
    const hasAlias = name !== realName;
    const canShowPresence = card.data.presenceVisible !== false;
    const isOnline = canShowPresence && card.data.status === "online";
    const accentColor = card.data.accentColor || "purple";
    const statusLabel = canShowPresence ? (isOnline ? "Online" : "Offline") : "Privato";
    const badge = card.unread > 0 ? `<span class="unread-badge-lumen">${card.unread}</span>` : "";
    const markup = `
        <div class="friend-card-main">
            <div class="chat-item-avatar friend-avatar">${escapeHtml(getInitial(name))}</div>
            <div class="friend-details">
                <h4>${escapeHtml(name)}</h4>
                ${hasAlias ? `<p class="friend-real-name">${escapeHtml(realName)}</p>` : ""}
                <div class="status-indicator">
                    <span class="status-dot ${isOnline ? "online" : "offline"}"></span>
                    <span class="status-text ${isOnline ? "online" : "offline"}">${statusLabel}</span>
                </div>
            </div>
        </div>
        ${badge}
        <div class="dots-menu-container friend-actions-menu">
            <button class="btn-dots-trigger friend-menu-trigger" type="button" title="Azioni amico">
                <i data-lucide="more-vertical"></i>
            </button>
            <div class="lumen-dropdown-menu">
                <button class="dropdown-item btn-copy-uid" type="button">
                    <i data-lucide="copy"></i>
                    Copia UID
                </button>
                <button class="dropdown-item btn-friend-alias" type="button">
                    <i data-lucide="pencil"></i>
                    Imposta soprannome
                </button>
                <button class="dropdown-item btn-report-friend" type="button">
                    <i data-lucide="flag"></i>
                    Segnala utente
                </button>
                <button class="dropdown-item text-danger btn-remove-friend" type="button">
                    <i data-lucide="user-minus"></i>
                    Rimuovi amico
                </button>
            </div>
        </div>
    `;

    [card.friendCard, card.messageCard].forEach((element) => {
        element.innerHTML = markup;
        applyAvatarElement($(".friend-avatar", element), name, accentColor, card.data.avatarDataUrl || "");
        element.dataset.name = name.toLowerCase();
        element.onclick = (event) => {
            if (event.target.closest(".dots-menu-container")) return;
            openChatWith(friendId, name, card.data);
        };

        $(".friend-menu-trigger", element).addEventListener("click", (event) => {
            event.stopPropagation();
            const menu = $(".lumen-dropdown-menu", element);
            const isOpen = menu.classList.contains("show");
            closeDropdowns();
            if (!isOpen) openDropdownMenu(event.currentTarget, menu, element);
        });

        $(".btn-copy-uid", element).addEventListener("click", async (event) => {
            event.stopPropagation();
            closeDropdowns();
            const ok = await copyTextToClipboard(friendId);
            if (ok) {
                showNotification({
                    title: "ID Copiato",
                    message: `UID di ${name} copiato negli appunti.`,
                    icon: "copy",
                    addToHome: false
                });
            }
        });

        $(".btn-friend-alias", element).addEventListener("click", (event) => {
            event.stopPropagation();
            closeDropdowns();
            openFriendAliasModal(friendId, realName);
        });

        $(".btn-report-friend", element).addEventListener("click", (event) => {
            event.stopPropagation();
            closeDropdowns();
            openReportUserModal(friendId);
        });

        $(".btn-remove-friend", element).addEventListener("click", (event) => {
            event.stopPropagation();
            closeDropdowns();
            openRemoveFriendModal(friendId, name);
        });
    });

    refreshIcons();
    renderHomeSidebarAlerts();
}

function bindChatHeaderMenu() {
    const trigger = $("#chat-header-menu-trigger");
    const menu = $("#chat-header-dropdown");
    const copyBtn = $("#btn-chat-copy-uid");
    const reportBtn = $("#btn-chat-report-user");

    trigger?.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = menu.classList.contains("show");
        closeDropdowns();
        if (!isOpen) openDropdownMenu(event.currentTarget, menu);
    });

    copyBtn?.addEventListener("click", async (event) => {
        event.stopPropagation();
        closeDropdowns();
        if (state.activeChat && state.activeChat.type === "private") {
            const ok = await copyTextToClipboard(state.activeChat.id);
            if (ok) {
                showNotification({
                    title: "ID Copiato",
                    message: `UID di ${state.activeChat.name} copiato negli appunti.`,
                    icon: "copy",
                    addToHome: false
                });
            }
        }
    });

    reportBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        closeDropdowns();
        if (state.activeChat && state.activeChat.type === "private") {
            openReportUserModal(state.activeChat.id);
        }
    });
}

function bindMessageSearch() {
    $("#search-messages").addEventListener("input", (event) => {
        const term = event.target.value.trim().toLowerCase();

        $$("#messages-list .friend-item-card").forEach((card) => {
            card.classList.toggle("hidden", term && !card.dataset.name.includes(term));
        });
    });
}

function openChatWith(friendId, friendName, friendData = {}) {
    if (isLumenBot(friendId)) {
        friendName = "Lumen";
        friendData = state.botProfile || friendData;
    }

    // Evita caricamenti inutili se la chat è già attiva
    if (state.activeChat?.type === "private" && state.activeChat.id === friendId) {
        setRightView("chat");
        if (isMobileView()) {
            setMobileListMode(false);
            closeMobilePanel();
        }
        return;
    }

    state.activeChat = {
        type: "private",
        id: friendId,
        name: friendName,
        avatarDataUrl: friendData.avatarDataUrl || "",
        accentColor: friendData.accentColor || "purple",
        isBot: isLumenBot(friendId)
    };

    updateDoc(doc(db, "users", state.currentUser.uid), {
        activeChatWith: friendId
    }).catch(console.error);

    openMessagesForActiveChat();
}

function openGroupChat(groupId, groupName) {
    state.activeChat = {
        type: "group",
        id: groupId,
        name: groupName,
        avatarDataUrl: "",
        accentColor: "purple"
    };

    openMessagesForActiveChat();
}

function openMessagesForActiveChat() {
    const chat = state.activeChat;
    const chatId = chat.type === "group" ? `GROUP_${chat.id}` : getPrivateChatId(state.currentUser.uid, chat.id);
    const isBotChat = chat.type === "private" && isLumenBot(chat.id);
    const chatInputContainer = $(".chat-input-container");

    if (isMobileView()) {
        setMobileListMode(false);
        closeMobilePanel();
    }

    setRightView("chat");

    if (isBotChat) {
        const botData = state.botProfile || { nickname: "Lumen", isVerified: true };
        dom.activeChatTitle.innerHTML = formatDisplayNameHtml(botData, LUMEN_BOT_UID, "Lumen");
        dom.activeChatSubtitle.innerHTML = `Account ufficiale ${getVerifiedBadgeHtml()}`;
    } else {
        dom.activeChatTitle.textContent = chat.name;
        dom.activeChatSubtitle.textContent = chat.type === "group" ? "Chat gruppo" : "Chat privata";
    }

    applyAvatarElement(dom.activeChatAvatar, chat.name, chat.accentColor || "purple", chat.avatarDataUrl || "");

    const dotsMenu = $("#chat-header-menu-trigger")?.closest(".dots-menu-container");
    if (chat.type === "group") {
        dotsMenu?.classList.add("hidden");
    } else {
        dotsMenu?.classList.remove("hidden");
    }

    if (isBotChat) {
        $("#chat-call-btn")?.classList.add("hidden");
        dom.messageInput.disabled = true;
        dom.messageInput.placeholder = "Non puoi scrivere a Lumen — solo messaggi in arrivo";
        $("#send-message-btn")?.setAttribute("disabled", "true");
        chatInputContainer?.classList.add("chat-readonly");
    } else {
        $("#chat-call-btn")?.classList.remove("hidden");
        dom.messageInput.disabled = false;
        dom.messageInput.placeholder = "Scrivi un messaggio...";
        $("#send-message-btn")?.removeAttribute("disabled");
        chatInputContainer?.classList.remove("chat-readonly");
    }

    dom.messagesContainer.innerHTML = '<div class="system-message">Caricamento messaggi...</div>';

    if (state.activeChatUnsubscribe) {
        state.activeChatUnsubscribe();
    }

    if (chat.type === "private") {
        const targetId = isBotChat ? LUMEN_BOT_UID : chat.id;
        markMessagesAsRead(chatId, targetId);
        removeHomeNotification(`message-${targetId}`);
    }

    const messagesQuery = query(
        collection(db, "messages"),
        where("chatId", "==", chatId),
        orderBy("timestamp", "asc")
    );

    state.activeChatUnsubscribe = onSnapshot(messagesQuery, (snapshot) => {
        renderMessages(snapshot);
        if (chat.type === "private") {
            markMessagesAsRead(chatId, isBotChat ? LUMEN_BOT_UID : chat.id);
        }
    });

    refreshIcons();
}

async function markMessagesAsRead(chatId, senderId) {
    const unreadQuery = query(
        collection(db, "messages"),
        where("chatId", "==", chatId),
        where("senderId", "==", senderId),
        where("receiverId", "==", state.currentUser.uid),
        where("isRead", "==", false)
    );

    const snapshot = await getDocs(unreadQuery);
    snapshot.forEach((messageDoc) => {
        updateDoc(doc(db, "messages", messageDoc.id), { isRead: true }).catch(console.error);
    });
}

function renderMessages(snapshot) {
    dom.messagesContainer.innerHTML = "";

    if (snapshot.empty) {
        dom.messagesContainer.innerHTML = '<div class="system-message">Nessun messaggio in questa chat.</div>';
        return;
    }

    snapshot.forEach((messageDoc) => {
        const data = messageDoc.data();
        const messageElement = document.createElement("div");
        const isSent = data.senderId === state.currentUser.uid;
        const time = data.timestamp?.toDate
            ? data.timestamp.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "";

        const isBotMessage = data.isBot || data.senderId === LUMEN_BOT_UID;
        messageElement.className = `message-bubble ${isSent ? "sent" : "received"}${isBotMessage ? " bot-message" : ""}`;
        messageElement.id = messageDoc.id;

        const textElement = document.createElement("div");
        textElement.className = "message-text";
        textElement.textContent = data.text || "";

        const metaElement = document.createElement("div");
        metaElement.className = "message-meta";
        metaElement.innerHTML = `
            <span>${escapeHtml(time)}</span>
            ${isSent ? `<span class="lumen-status-dot ${data.isRead ? "read" : "delivered"}"></span>` : ""}
        `;

        messageElement.appendChild(textElement);

        if (data.messageType === "report_update" && data.reportCard) {
            const card = data.reportCard;
            const cardButton = document.createElement("button");
            cardButton.type = "button";
            cardButton.className = "report-message-card";
            cardButton.innerHTML = `
                <div class="report-message-card-head">
                    <i data-lucide="flag"></i>
                    <div>
                        <strong>${escapeHtml(card.title || "Segnalazione")}</strong>
                        <span class="report-status-pill ${escapeHtml(card.status || "")}">${escapeHtml(card.statusLabel || "")}</span>
                    </div>
                </div>
                <p class="report-message-card-hint">Tocca per vedere tutti i dettagli</p>
                ${card.adminNote ? `<p class="report-message-card-note">${escapeHtml(card.adminNote)}</p>` : ""}
            `;
            cardButton.addEventListener("click", () => openReportCardFromMessage(card));
            messageElement.appendChild(cardButton);
        }

        messageElement.appendChild(metaElement);
        dom.messagesContainer.appendChild(messageElement);
    });

    dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
    refreshIcons();
}

async function sendMessage() {
    const chat = state.activeChat;
    const text = dom.messageInput.value.trim();

    if (!chat || !text) return;

    if (chat.type === "private" && isLumenBot(chat.id)) {
        showNotification({
            title: "Chat di sola lettura",
            message: "Non puoi inviare messaggi all'account ufficiale Lumen.",
            type: "system",
            icon: "bot",
            addToHome: false
        });
        return;
    }

    const isGroup = chat.type === "group";
    const chatId = isGroup ? `GROUP_${chat.id}` : getPrivateChatId(state.currentUser.uid, chat.id);

    dom.messageInput.value = "";

    await addDoc(collection(db, "messages"), {
        chatId,
        senderId: state.currentUser.uid,
        receiverId: isGroup ? null : chat.id,
        groupId: isGroup ? chat.id : null,
        isGroup,
        text,
        timestamp: serverTimestamp(),
        isRead: false
    });
}

function listenToDirectMessageNotifications() {
    if (state.directMessagesUnsubscribe) {
        state.directMessagesUnsubscribe();
    }

    let firstSnapshot = true;
    const messagesQuery = query(
        collection(db, "messages"),
        where("receiverId", "==", state.currentUser.uid)
    );

    state.directMessagesUnsubscribe = onSnapshot(messagesQuery, async (snapshot) => {
        const changes = snapshot.docChanges ? snapshot.docChanges() : [];

        if (firstSnapshot) {
            firstSnapshot = false;
            return;
        }

        for (const change of changes) {
            if (change.type !== "added") continue;

            const message = change.doc.data();
            if (!message.senderId || message.senderId === state.currentUser.uid) continue;

            const isOpenChat = state.activeChat?.type === "private" && state.activeChat.id === message.senderId;
            if (isOpenChat && document.visibilityState === "visible") continue;

            const senderSnap = await getDoc(doc(db, "users", message.senderId));
            const senderData = senderSnap.exists() ? senderSnap.data() : {};
            const senderName = getFriendDisplayName(message.senderId, senderData);

            showNotification({
                title: `Nuovo messaggio da ${senderName}`,
                message: message.text || "Hai ricevuto un nuovo messaggio.",
                type: "message",
                icon: "message-circle",
                homeId: `message-${message.senderId}`,
                homeAction: () => openChatWith(message.senderId, senderName, senderData)
            });
        }
    });
}

function bindChatInput() {
    $("#send-message-btn").addEventListener("click", sendMessage);
    dom.messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") sendMessage();
    });
}

function listenToGroups() {
    const groupsQuery = query(
        collection(db, "groups"),
        where("members", "array-contains", state.currentUser.uid)
    );

    onSnapshot(groupsQuery, async (snapshot) => {
        const groupsList = $("#groups-list");
        groupsList.innerHTML = "";
        state.groupMessageUnsubscribers.forEach((unsubscribe) => unsubscribe());
        state.groupMessageUnsubscribers = [];

        if (snapshot.empty) {
            groupsList.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="users"></i>
                    <p class="secondary-text">Nessun gruppo attivo.</p>
                </div>
            `;
            refreshIcons();
            return;
        }

        snapshot.forEach(async (groupDoc) => {
            const groupData = groupDoc.data();
            const groupName = groupData.name || "Gruppo Lumen";
            const groupId = groupDoc.id;
            const previousGroup = state.groupSnapshots.get(groupId);
            const currentMembers = groupData.members || [];

            if (previousGroup) {
                const previousMembers = new Set(previousGroup.members || []);
                const addedMembers = currentMembers.filter((memberId) => !previousMembers.has(memberId));

                for (const memberId of addedMembers) {
                    const memberSnap = await getDoc(doc(db, "users", memberId));
                    const memberName = getDisplayName(memberSnap.exists() ? memberSnap.data() : null);

                    showNotification({
                        title: "Membro aggiunto",
                        message: `${memberName} e' entrato in ${groupName}.`,
                        type: "group",
                        icon: "user-plus"
                    });
                }

                if (previousGroup.createdBy && previousGroup.createdBy !== groupData.createdBy) {
                    showNotification({
                        title: "Leader gruppo aggiornato",
                        message: `Il ruolo leader e' cambiato in ${groupName}.`,
                        type: "group",
                        icon: "crown"
                    });
                }
            }

            state.groupSnapshots.set(groupId, {
                members: currentMembers,
                createdBy: groupData.createdBy
            });
            watchGroupMessages(groupId, groupName);

            const item = document.createElement("div");
            item.className = "group-item-card";
            item.innerHTML = `
                <button class="group-clickable-zone" type="button">
                    <div class="chat-item-avatar group-avatar">G</div>
                    <div class="friend-details">
                        <h4>${escapeHtml(groupName)}</h4>
                        <p>${(groupData.members || []).length} membri</p>
                    </div>
                </button>
                <div class="dots-menu-container">
                    <button class="btn-dots-trigger" type="button" title="Azioni gruppo">
                        <i data-lucide="more-vertical"></i>
                    </button>
                    <div class="lumen-dropdown-menu">
                        <button class="dropdown-item btn-menu-view-members" type="button">
                            <i data-lucide="users"></i>
                            Membri
                        </button>
                        <button class="dropdown-item btn-menu-leave-group" type="button">
                            <i data-lucide="log-out"></i>
                            Lascia gruppo
                        </button>
                        <button class="dropdown-item text-danger btn-menu-delete-group" type="button">
                            <i data-lucide="trash-2"></i>
                            Elimina gruppo
                        </button>
                    </div>
                </div>
            `;

            $(".group-clickable-zone", item).addEventListener("click", () => openGroupChat(groupId, groupName));
            $(".btn-dots-trigger", item).addEventListener("click", (event) => {
                event.stopPropagation();
                const menu = $(".lumen-dropdown-menu", item);
                const isOpen = menu.classList.contains("show");
                closeDropdowns();
                if (!isOpen) openDropdownMenu(event.currentTarget, menu, item);
            });
            $(".btn-menu-leave-group", item).addEventListener("click", () => {
                closeDropdowns();
                openLeaveGroupModal(groupId, groupName);
            });
            $(".btn-menu-view-members", item).addEventListener("click", () => {
                closeDropdowns();
                openMembersModal(groupId, groupData);
            });
            $(".btn-menu-delete-group", item).addEventListener("click", () => {
                closeDropdowns();
                if (groupData.createdBy !== state.currentUser.uid) {
                    alert("Solo il leader del gruppo puo' eliminarlo.");
                    return;
                }

                state.selectedGroupId = groupId;
                $("#modal-delete-group").classList.remove("hidden");
            });

            groupsList.appendChild(item);
            refreshIcons();
        });

        refreshIcons();
        renderHomeDashboard();
    });
}

function watchGroupMessages(groupId, groupName) {
    let firstSnapshot = true;
    const groupMessagesQuery = query(
        collection(db, "messages"),
        where("chatId", "==", `GROUP_${groupId}`)
    );

    const unsubscribe = onSnapshot(groupMessagesQuery, async (snapshot) => {
        const changes = snapshot.docChanges ? snapshot.docChanges() : [];

        if (firstSnapshot) {
            firstSnapshot = false;
            return;
        }

        for (const change of changes) {
            if (change.type !== "added") continue;

            const message = change.doc.data();
            if (message.senderId === state.currentUser.uid) continue;

            const isOpenChat = state.activeChat?.type === "group" && state.activeChat.id === groupId;
            if (isOpenChat && document.visibilityState === "visible") continue;

            const senderSnap = await getDoc(doc(db, "users", message.senderId));
            const senderName = getDisplayName(senderSnap.exists() ? senderSnap.data() : null);

            showNotification({
                title: `${groupName}`,
                message: `${senderName}: ${message.text || "Nuovo messaggio"}`,
                type: "message",
                icon: "messages-square"
            });
        }
    });

    state.groupMessageUnsubscribers.push(unsubscribe);
}

function listenToGroupInvites() {
    const invitesQuery = query(
        collection(db, "groups"),
        where("invited", "array-contains", state.currentUser.uid)
    );

    onSnapshot(invitesQuery, (snapshot) => {
        const list = $("#group-invites-list");
        list.innerHTML = "";
        const currentInviteIds = new Set();

        if (snapshot.empty) {
            list.innerHTML = '<div class="empty-state compact-empty"><p class="secondary-text">Nessun invito in sospeso.</p></div>';
            state.lastGroupInvites = currentInviteIds;
            state.firstInviteSnapshot = false;
            return;
        }

        snapshot.forEach((docSnap) => {
            const groupData = docSnap.data();
            const groupId = docSnap.id;
            currentInviteIds.add(groupId);

            if (!state.firstInviteSnapshot && !state.lastGroupInvites.has(groupId)) {
                showNotification({
                    title: "Nuovo invito gruppo",
                    message: `Sei stato invitato in ${groupData.name || "un gruppo"}.`,
                    type: "group",
                    icon: "users"
                });
            }

            const item = document.createElement("div");
            item.className = "group-item-card invite-card";
            item.innerHTML = `
                <div class="friend-details">
                    <h4>${escapeHtml(groupData.name || "Gruppo Lumen")}</h4>
                    <p>Ti ha invitato ad unirti</p>
                </div>
                <div class="invite-actions">
                    <button class="btn-primary btn-accept-invite" type="button">Accetta</button>
                    <button class="btn-secondary btn-reject-invite" type="button">Rifiuta</button>
                </div>
            `;

            $(".btn-accept-invite", item).addEventListener("click", async () => {
                await updateDoc(doc(db, "groups", groupId), {
                    members: arrayUnion(state.currentUser.uid),
                    invited: arrayRemove(state.currentUser.uid)
                });

                showNotification({
                    title: "Invito accettato",
                    message: `Sei entrato in ${groupData.name || "un gruppo"}.`,
                    type: "group",
                    icon: "user-check"
                });
            });

            $(".btn-reject-invite", item).addEventListener("click", async () => {
                await updateDoc(doc(db, "groups", groupId), {
                    invited: arrayRemove(state.currentUser.uid)
                });
            });

            list.appendChild(item);
        });

        state.lastGroupInvites = currentInviteIds;
        state.firstInviteSnapshot = false;
        renderHomeSidebarAlerts(
            $("#pending-list .friend-request-box")?.length || 0,
            currentInviteIds.size
        );
        renderHomeDashboard();
    });
}

async function openMembersModal(groupId, groupData) {
    state.selectedGroupId = groupId;
    $("#members-modal-title").textContent = `Membri di: ${groupData.name || "Gruppo"}`;
    $("#modal-group-members").classList.remove("hidden");

    const container = $("#group-members-list-container");
    container.innerHTML = '<p class="secondary-text">Caricamento membri...</p>';
    $("#btn-open-invite-friends").onclick = () => openInviteFriendsModal(groupId, groupData);

    let markup = "";
    for (const memberId of groupData.members || []) {
        const userSnap = await getDoc(doc(db, "users", memberId));
        const userData = snapExists(userSnap) ? snapData(userSnap) : {};
        const name = getDisplayName(userData);
        const isLeader = groupData.createdBy === memberId;
        const isSelf = memberId === state.currentUser.uid;
        const showAdminActions = groupData.createdBy === state.currentUser.uid && !isSelf;
        const showMemberMenu = !isSelf;

        markup += `
            <div class="member-item-row" data-member-id="${escapeHtml(memberId)}">
                <div class="member-profile">
                    <div class="chat-item-avatar member-row-avatar">${escapeHtml(getInitial(name))}</div>
                    <span>${escapeHtml(name)}</span>
                </div>
                <div class="member-actions">
                    <span class="member-role-badge ${isLeader ? "leader" : "membro"}">${isLeader ? "Leader" : "Membro"}</span>
                    ${showMemberMenu ? `
                        <div class="dots-menu-container">
                            <button class="btn-dots-trigger member-menu-trigger" type="button">
                                <i data-lucide="more-vertical"></i>
                            </button>
                            <div class="lumen-dropdown-menu">
                                <button class="dropdown-item btn-copy-uid-member" type="button" data-uid="${escapeHtml(memberId)}" data-name="${escapeHtml(name)}">
                                    <i data-lucide="copy"></i>
                                    Copia UID
                                </button>
                                <button class="dropdown-item btn-report-member" type="button" data-uid="${escapeHtml(memberId)}">
                                    <i data-lucide="flag"></i>
                                    Segnala utente
                                </button>
                                ${showAdminActions ? `
                                    <button class="dropdown-item btn-make-leader" type="button" data-uid="${escapeHtml(memberId)}">Nomina Leader</button>
                                    <button class="dropdown-item text-danger btn-kick-member" type="button" data-uid="${escapeHtml(memberId)}">Espelli</button>
                                ` : ""}
                            </div>
                        </div>
                    ` : ""}
                </div>
            </div>
        `;
    }

    container.innerHTML = markup || '<p class="secondary-text">Nessun membro trovato.</p>';

    $$(".member-menu-trigger", container).forEach((button) => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            const menu = button.nextElementSibling;
            const row = button.closest(".member-item-row");
            const isOpen = menu.classList.contains("show");
            closeDropdowns();
            if (!isOpen) openDropdownMenu(event.currentTarget, menu, row);
        });
    });

    $$(".btn-copy-uid-member", container).forEach((button) => {
        button.addEventListener("click", async (event) => {
            event.stopPropagation();
            closeDropdowns();
            const uid = button.dataset.uid;
            const name = button.dataset.name;
            const ok = await copyTextToClipboard(uid);
            if (ok) {
                showNotification({
                    title: "ID Copiato",
                    message: `UID di ${name} copiato negli appunti.`,
                    icon: "copy",
                    addToHome: false
                });
            }
        });
    });

    $$(".btn-make-leader", container).forEach((button) => {
        button.addEventListener("click", async () => {
            await updateDoc(doc(db, "groups", groupId), { createdBy: button.dataset.uid });
            $("#modal-group-members").classList.add("hidden");
        });
    });

    $$(".btn-kick-member", container).forEach((button) => {
        button.addEventListener("click", async () => {
            await updateDoc(doc(db, "groups", groupId), {
                members: arrayRemove(button.dataset.uid)
            });
            $("#modal-group-members").classList.add("hidden");
            showNotification({
                title: "Membro rimosso",
                message: "Il membro e' stato espulso dal gruppo.",
                type: "group",
                icon: "user-minus"
            });
        });
    });

    $$(".btn-report-member", container).forEach((button) => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            closeDropdowns();
            openReportUserModal(button.dataset.uid);
        });
    });

    for (const memberId of groupData.members || []) {
        const row = container.querySelector(`[data-member-id="${memberId}"]`);
        if (!row) continue;
        const userSnap = await getDoc(doc(db, "users", memberId));
        if (!snapExists(userSnap)) continue;
        const data = snapData(userSnap);
        applyAvatarElement($(".member-row-avatar", row), getDisplayName(data), data.accentColor || "purple", data.avatarDataUrl || "");
    }

    refreshIcons();
}

async function openInviteFriendsModal(groupId, groupData) {
    $("#modal-invite-friends").classList.remove("hidden");
    const container = $("#invite-friends-list-container");
    container.innerHTML = '<p class="secondary-text">Caricamento amici...</p>';

    const myUserSnap = await getDoc(doc(db, "users", state.currentUser.uid));
    const friends = myUserSnap.data()?.friends || [];

    if (friends.length === 0) {
        container.innerHTML = '<p class="secondary-text">Non hai amici da invitare.</p>';
        return;
    }

    let markup = "";
    for (const friendId of friends) {
        if ((groupData.members || []).includes(friendId) || (groupData.invited || []).includes(friendId)) continue;

        const friendSnap = await getDoc(doc(db, "users", friendId));
        const friendName = getDisplayName(friendSnap.exists() ? friendSnap.data() : null, "Amico Lumen");
        markup += `
            <div class="member-item-row">
                <span>${escapeHtml(friendName)}</span>
                <button class="btn-primary btn-execute-invite" type="button" data-fid="${escapeHtml(friendId)}">Invita</button>
            </div>
        `;
    }

    container.innerHTML = markup || "<p class=\"secondary-text\">Tutti i tuoi amici sono gia' nel gruppo o invitati.</p>";
    $$(".btn-execute-invite", container).forEach((button) => {
        button.addEventListener("click", async () => {
            await updateDoc(doc(db, "groups", groupId), {
                invited: arrayUnion(button.dataset.fid)
            });

            $("#modal-invite-friends").classList.add("hidden");
            showNotification({
                title: "Invito inviato",
                message: "L'invito al gruppo e' stato inviato.",
                type: "group",
                icon: "send"
            });
        });
    });
}

function bindGroupControls() {
    $("#lumen-open-create-group").addEventListener("click", () => {
        $("#group-modal").classList.remove("hidden");
        $("#group-name-input").focus();
    });

    $("#confirm-create-group").addEventListener("click", createGroup);
    $("#group-name-input").addEventListener("keydown", (event) => {
        if (event.key === "Enter") createGroup();
    });

    $("#btn-confirm-delete-no").addEventListener("click", () => {
        $("#modal-delete-group").classList.add("hidden");
    });

    $("#btn-confirm-delete-yes").addEventListener("click", async () => {
        if (!state.selectedGroupId) return;

        await deleteDoc(doc(db, "groups", state.selectedGroupId));
        state.selectedGroupId = null;
        $("#modal-delete-group").classList.add("hidden");
        showNotification({
            title: "Gruppo eliminato",
            message: "Il gruppo e' stato eliminato.",
            type: "group",
            icon: "trash-2"
        });
    });
}

async function createGroup() {
    const input = $("#group-name-input");
    const groupName = input.value.trim();

    if (!groupName) {
        alert("Inserisci un nome valido.");
        return;
    }

    await addDoc(collection(db, "groups"), {
        name: groupName,
        createdBy: state.currentUser.uid,
        members: [state.currentUser.uid],
        invited: [],
        createdAt: serverTimestamp()
    });

    input.value = "";
    $("#group-modal").classList.add("hidden");
    showNotification({
        title: "Gruppo creato",
        message: `${groupName} e' pronto.`,
        type: "group",
        icon: "users"
    });
}

function readImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function openAvatarCropper(file) {
    const dataUrl = await readImageFile(file);
    const image = new Image();

    image.onload = () => {
        $("#avatar-crop-image").src = dataUrl;
        $("#avatar-zoom-range").value = "1";
        $("#avatar-crop-modal").classList.remove("hidden");

        requestAnimationFrame(() => {
            const stage = $("#avatar-crop-stage");
            const stageRect = stage.getBoundingClientRect();
            const stageSize = stageRect.width || 280;
            const baseScale = Math.max(stageSize / image.naturalWidth, stageSize / image.naturalHeight);

            state.avatarCrop = {
                image,
                dataUrl,
                baseScale,
                zoom: 1,
                scale: baseScale,
                x: (stageSize - image.naturalWidth * baseScale) / 2,
                y: (stageSize - image.naturalHeight * baseScale) / 2,
                dragging: false,
                startX: 0,
                startY: 0,
                startImageX: 0,
                startImageY: 0
            };

            updateAvatarCropper();
        });
    };

    image.onerror = () => {
        alert("Non riesco a leggere questa immagine.");
    };

    image.src = dataUrl;
}

function boundAvatarCropPosition() {
    const crop = state.avatarCrop;
    if (!crop) return;

    const stage = $("#avatar-crop-stage");
    const stageSize = stage.getBoundingClientRect().width || 280;
    const imageWidth = crop.image.naturalWidth * crop.scale;
    const imageHeight = crop.image.naturalHeight * crop.scale;

    crop.x = Math.min(0, Math.max(stageSize - imageWidth, crop.x));
    crop.y = Math.min(0, Math.max(stageSize - imageHeight, crop.y));
}

function updateAvatarCropper() {
    const crop = state.avatarCrop;
    if (!crop) return;

    const cropImage = $("#avatar-crop-image");
    const stage = $("#avatar-crop-stage");
    const stageSize = stage.getBoundingClientRect().width || 280;

    boundAvatarCropPosition();
    cropImage.style.width = `${crop.image.naturalWidth * crop.scale}px`;
    cropImage.style.height = `${crop.image.naturalHeight * crop.scale}px`;
    cropImage.style.transform = `translate(${crop.x}px, ${crop.y}px)`;
    drawAvatarCropPreview(stageSize);
}

function drawAvatarCropPreview(stageSize) {
    const crop = state.avatarCrop;
    if (!crop) return;

    const canvas = $("#avatar-crop-preview");
    const context = canvas.getContext("2d");
    const outputSize = canvas.width;
    const sourceX = -crop.x / crop.scale;
    const sourceY = -crop.y / crop.scale;
    const sourceSize = stageSize / crop.scale;

    context.clearRect(0, 0, outputSize, outputSize);
    context.save();
    context.beginPath();
    context.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
    context.clip();
    context.drawImage(crop.image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
    context.restore();
}

function confirmAvatarCrop() {
    const crop = state.avatarCrop;
    if (!crop) return;

    const stage = $("#avatar-crop-stage");
    const stageSize = stage.getBoundingClientRect().width || 280;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const outputSize = 256;
    const sourceX = -crop.x / crop.scale;
    const sourceY = -crop.y / crop.scale;
    const sourceSize = stageSize / crop.scale;

    canvas.width = outputSize;
    canvas.height = outputSize;
    context.drawImage(crop.image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
    state.avatarDataUrl = canvas.toDataURL("image/jpeg", 0.86);
    state.avatarCrop = null;
    $("#avatar-crop-modal").classList.add("hidden");
    applyAvatarColor(state.selectedColor);
}

function cancelAvatarCrop() {
    state.avatarCrop = null;
    $("#avatar-crop-modal").classList.add("hidden");
    $("#avatar-file-input").value = "";
}

function setAvatarCropZoom(nextZoom) {
    const crop = state.avatarCrop;
    if (!crop) return;

    const stage = $("#avatar-crop-stage");
    const stageSize = stage.getBoundingClientRect().width || 280;
    const oldScale = crop.scale;
    const centerX = (stageSize / 2 - crop.x) / oldScale;
    const centerY = (stageSize / 2 - crop.y) / oldScale;

    crop.zoom = Number(nextZoom);
    crop.scale = crop.baseScale * crop.zoom;
    crop.x = stageSize / 2 - centerX * crop.scale;
    crop.y = stageSize / 2 - centerY * crop.scale;
    updateAvatarCropper();
}

function bindAvatarCropControls() {
    const stage = $("#avatar-crop-stage");

    stage.addEventListener("pointerdown", (event) => {
        const crop = state.avatarCrop;
        if (!crop) return;

        crop.dragging = true;
        crop.startX = event.clientX;
        crop.startY = event.clientY;
        crop.startImageX = crop.x;
        crop.startImageY = crop.y;
        stage.setPointerCapture(event.pointerId);
    });

    stage.addEventListener("pointermove", (event) => {
        const crop = state.avatarCrop;
        if (!crop?.dragging) return;

        crop.x = crop.startImageX + event.clientX - crop.startX;
        crop.y = crop.startImageY + event.clientY - crop.startY;
        updateAvatarCropper();
    });

    stage.addEventListener("pointerup", (event) => {
        if (state.avatarCrop) {
            state.avatarCrop.dragging = false;
        }
        if (stage.hasPointerCapture(event.pointerId)) {
            stage.releasePointerCapture(event.pointerId);
        }
    });

    stage.addEventListener("pointercancel", () => {
        if (state.avatarCrop) {
            state.avatarCrop.dragging = false;
        }
    });

    $("#avatar-zoom-range").addEventListener("input", (event) => {
        setAvatarCropZoom(event.target.value);
    });

    $("#avatar-crop-confirm").addEventListener("click", confirmAvatarCrop);
    $("#avatar-crop-cancel").addEventListener("click", cancelAvatarCrop);
}

function bindProfileControls() {
    $$(".color-option").forEach((option) => {
        option.addEventListener("click", () => {
            $$(".color-option").forEach((item) => item.classList.remove("selected"));
            option.classList.add("selected");
            state.selectedColor = option.dataset.color;
            applyAvatarColor(state.selectedColor);
        });
    });

    $("#avatar-file-input").addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            await openAvatarCropper(file);
        } catch (error) {
            console.error("Errore avatar:", error);
            alert("Non riesco a leggere questa immagine.");
        }
    });

    $("#clear-avatar-btn").addEventListener("click", () => {
        state.avatarDataUrl = "";
        $("#avatar-file-input").value = "";
        applyAvatarColor(state.selectedColor);
    });

    $("#nickname-input").addEventListener("input", () => showNicknameError(""));

    $("#save-settings-btn").addEventListener("click", async () => {
        const nickname = $("#nickname-input").value.trim();

        if (!nickname || nickname.length < 2) {
            showNicknameError("Il nickname deve avere almeno 2 caratteri.");
            return;
        }

        const available = await isNicknameAvailable(nickname, state.currentUser.uid);
        if (!available) {
            showNicknameError("Questo nickname e' gia' in uso. Scegline un altro.");
            return;
        }

        showNicknameError("");

        await updateDoc(doc(db, "users", state.currentUser.uid), {
            nickname,
            nicknameLower: normalizeNicknameKey(nickname),
            accentColor: state.selectedColor,
            avatarDataUrl: state.avatarDataUrl
        });

        $("#profile-name").textContent = nickname;
        $("#voice-widget-nickname").textContent = nickname;
        updateWelcomeTitle({ nickname });
        applyAvatarColor(state.selectedColor);
        alert("Profilo aggiornato.");
    });
}

function applyAvatarColor(color) {
    const name = $("#nickname-input").value.trim() || $("#profile-name").textContent || "Utente";
    applyAvatarElement($("#profile-avatar"), name, color, state.avatarDataUrl);
}

function bindAppearanceControls() {
    $$(".theme-btn").forEach((button) => {
        button.addEventListener("click", () => setTheme(button.dataset.theme));
    });

    $$(".font-size-btn").forEach((button) => {
        button.addEventListener("click", () => {
            $$(".font-size-btn").forEach((item) => item.classList.remove("active"));
            button.classList.add("active");

            if (button.id === "text-size-small") document.documentElement.style.fontSize = "12px";
            if (button.id === "text-size-medium") document.documentElement.style.fontSize = "14px";
            if (button.id === "text-size-large") document.documentElement.style.fontSize = "16px";
        });
    });

    $("#compact-mode-toggle").addEventListener("change", (event) => {
        document.body.classList.toggle("compact-mode", event.target.checked);
        writePreference("lumen-compact-mode", String(event.target.checked));
    });
}

function bindCustomThemeControls() {
    const bgInput = $("#custom-theme-bg");
    const cardInput = $("#custom-theme-card");
    const accentInput = $("#custom-theme-accent");
    const textInput = $("#custom-theme-text");
    const saveBtn = $("#btn-custom-theme-save");
    const randomBtn = $("#btn-custom-theme-random");

    const syncPreview = () => {
        updateThemePreview(bgInput.value, cardInput.value, accentInput.value, textInput.value);
    };

    [bgInput, cardInput, accentInput, textInput].forEach(input => {
        input?.addEventListener("input", syncPreview);
    });

    const loadInputs = () => {
        bgInput.value = readPreference("lumen-custom-bg", "#080c12");
        cardInput.value = readPreference("lumen-custom-card", "#18202e");
        accentInput.value = readPreference("lumen-custom-accent", "#6366f1");
        textInput.value = readPreference("lumen-custom-text", "#f8fafc");
        syncPreview();
    };

    saveBtn?.addEventListener("click", () => {
        writePreference("lumen-custom-bg", bgInput.value);
        writePreference("lumen-custom-card", cardInput.value);
        writePreference("lumen-custom-accent", accentInput.value);
        writePreference("lumen-custom-text", textInput.value);
        applyCustomThemeStyles();
        $("#modal-custom-theme").classList.add("hidden");
        showNotification({
            title: "Tema salvato",
            message: "Le tue preferenze sono state applicate.",
            type: "system",
            icon: "palette",
            addToHome: false
        });
    });

    randomBtn?.addEventListener("click", () => {
        const randomHex = () => "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");
        bgInput.value = randomHex();
        cardInput.value = randomHex();
        accentInput.value = randomHex();
        textInput.value = "#f8fafc";
        syncPreview();
    });

    loadInputs();
}

function bindPrivacyControls() {
    $("#presence-toggle").addEventListener("change", async (event) => {
        const presenceVisible = event.target.checked;

        await updateDoc(doc(db, "users", state.currentUser.uid), {
            presenceVisible,
            status: presenceVisible ? "online" : "offline",
            lastSeenAt: serverTimestamp()
        });
    });
}

function bindAccountControls() {
    $("#logout-btn-real").addEventListener("click", async () => {
        if (state.currentUser) {
            await updateDoc(doc(db, "users", state.currentUser.uid), { status: "offline" }).catch(() => {});
        }

        await signOut(auth);
        window.location.href = "index.html";
    });
}

function showLayeredModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    document.body.appendChild(modal);
    modal.classList.remove("hidden");
    refreshIcons();
}

function hideLayeredModal(modalId) {
    document.getElementById(modalId)?.classList.add("hidden");
}

function bindModalControls() {
    $$("[data-close-modal]").forEach((button) => {
        button.addEventListener("click", () => {
            if (button.dataset.closeModal === "avatar-crop-modal") {
                cancelAvatarCrop();
                return;
            }
            hideLayeredModal(button.dataset.closeModal);
        });
    });

    document.addEventListener("click", (event) => {
        if (event.target.closest(".lumen-dropdown-menu") || event.target.closest(".btn-dots-trigger")) {
            return;
        }
        closeDropdowns();
    });
}

function openDropdownMenu(trigger, menu, rowElement) {
    if (!menu || !trigger) return;

    closeDropdowns();

    rowElement?.classList.add("dropdown-row-active");
    $(".friend-actions-menu", rowElement)?.classList.add("menu-open");

    if (!menu._portalHome) {
        menu._portalHome = {
            parent: menu.parentElement,
            nextSibling: menu.nextElementSibling
        };
    }

    document.body.appendChild(menu);
    menu.classList.add("show", "dropdown-portaled");

    const positionMenu = () => {
        menu.style.visibility = "hidden";
        menu.style.display = "block";

        const triggerRect = trigger.getBoundingClientRect();
        const menuWidth = menu.offsetWidth || 188;
        const menuHeight = menu.offsetHeight || 120;
        const gap = 4;
        const margin = 8;

        let top = triggerRect.bottom + gap;
        let left = triggerRect.right - menuWidth;

        if (top + menuHeight > window.innerHeight - margin) {
            top = triggerRect.top - menuHeight - gap;
        }

        if (left < margin) {
            left = triggerRect.left;
        }

        if (left + menuWidth > window.innerWidth - margin) {
            left = window.innerWidth - menuWidth - margin;
        }

        menu.style.position = "fixed";
        menu.style.top = `${Math.max(margin, top)}px`;
        menu.style.left = `${Math.max(margin, left)}px`;
        menu.style.right = "auto";
        menu.style.zIndex = "13000";
        menu.style.visibility = "visible";
    };

    requestAnimationFrame(() => {
        positionMenu();
        requestAnimationFrame(positionMenu);
    });

    state.activeDropdown = { menu, trigger, rowElement, positionMenu };
    menu._repositionHandler = positionMenu;
    window.addEventListener("scroll", positionMenu, true);
    window.addEventListener("resize", positionMenu);
}

function closeDropdowns() {
    const active = state.activeDropdown;
    if (active?.menu) {
        restoreDropdownMenu(active.menu, active.rowElement);
    }

    $$(".lumen-dropdown-menu").forEach((menu) => {
        if (menu.classList.contains("dropdown-portaled")) {
            restoreDropdownMenu(menu);
        }
    });

    state.activeDropdown = null;
    $$(".friend-actions-menu").forEach((menu) => menu.classList.remove("menu-open"));
}

function restoreDropdownMenu(menu, rowElement = menu._rowElement) {
    menu.classList.remove("show", "dropdown-portaled");
    menu.style.cssText = "";

    if (menu._repositionHandler) {
        window.removeEventListener("scroll", menu._repositionHandler, true);
        window.removeEventListener("resize", menu._repositionHandler);
        menu._repositionHandler = null;
    }

    if (menu._portalHome?.parent) {
        const { parent, nextSibling } = menu._portalHome;
        if (nextSibling && nextSibling.parentElement === parent) {
            parent.insertBefore(menu, nextSibling);
        } else {
            parent.appendChild(menu);
        }
    }

    rowElement?.classList.remove("dropdown-row-active");
    menu._rowElement = null;
}

function openLeaveGroupModal(groupId, groupName) {
    state.pendingLeaveGroupId = groupId;
    $("#leave-group-message").textContent = `Vuoi uscire da "${groupName}"?`;
    $("#modal-leave-group").classList.remove("hidden");
}

async function leaveGroup(groupId) {
    if (!groupId || !state.currentUser) return;

    await updateDoc(doc(db, "groups", groupId), {
        members: arrayRemove(state.currentUser.uid),
        invited: arrayRemove(state.currentUser.uid)
    });

    if (state.activeChat?.type === "group" && state.activeChat.id === groupId) {
        state.activeChat = null;
        if (state.activeChatUnsubscribe) {
            state.activeChatUnsubscribe();
            state.activeChatUnsubscribe = null;
        }
        setRightView("home");
    }

    showNotification({
        title: "Hai lasciato il gruppo",
        message: "La lista gruppi e' stata aggiornata.",
        type: "group",
        icon: "log-out"
    });
}


async function checkUserBan(uid) {
    const banDoc = await getDoc(doc(db, "bans", uid));
    if (!snapExists(banDoc)) return null;

    const ban = snapData(banDoc);
    if (!ban?.active) return null;

    if (ban.expiresAt?.toDate) {
        const expiresAt = ban.expiresAt.toDate();
        if (expiresAt.getTime() <= Date.now()) {
            await updateDoc(doc(db, "bans", uid), { active: false }).catch(() => {});
            return null;
        }
    } else if (ban.expiresAt instanceof Date && ban.expiresAt.getTime() <= Date.now()) {
        await updateDoc(doc(db, "bans", uid), { active: false }).catch(() => {});
        return null;
    }

    return ban;
}

async function appendModerationLog(entry) {
    await addDoc(collection(db, "moderation_logs"), {
        ...entry,
        createdAt: serverTimestamp()
    }).catch(console.error);
}

function formatFirestoreDate(value) {
    if (!value) return "—";
    const date = value.toDate ? value.toDate() : (value instanceof Date ? value : null);
    if (!date) return "—";
    return date.toLocaleString("it-IT", {
        dateStyle: "short",
        timeStyle: "medium"
    });
}

function compressReportImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const image = new Image();
            image.onload = () => {
                const maxEdge = 1280;
                let width = image.naturalWidth;
                let height = image.naturalHeight;

                if (width > maxEdge || height > maxEdge) {
                    if (width >= height) {
                        height = Math.round((height / width) * maxEdge);
                        width = maxEdge;
                    } else {
                        width = Math.round((width / height) * maxEdge);
                        height = maxEdge;
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                canvas.getContext("2d").drawImage(image, 0, 0, width, height);
                resolve(canvas.toDataURL("image/jpeg", 0.78));
            };
            image.onerror = reject;
            image.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function processReportEvidenceFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 4);
    const images = [];

    for (const file of files) {
        if (!file.type?.startsWith("image/")) continue;
        if (file.size > 10 * 1024 * 1024) continue;
        try {
            images.push(await compressReportImage(file));
        } catch (error) {
            console.warn("Immagine report non valida:", error);
        }
    }

    return images;
}

function renderReportEvidencePreview(container, images) {
    if (!container) return;

    if (!images.length) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = images.map((src, index) => `
        <div class="report-evidence-thumb">
            <img src="${src}" alt="Prova ${index + 1}">
        </div>
    `).join("");
}

function resetReportUserForm() {
    $("#report-user-uid").value = "";
    $("#report-user-reason").value = "";
    $("#report-user-evidence").value = "";
    state.pendingReportEvidence = [];
    renderReportEvidencePreview($("#report-user-evidence-preview"), []);
}

function resetReportBugForm() {
    $("#report-bug-area").value = "";
    $("#report-bug-description").value = "";
    $("#report-bug-evidence").value = "";
    state.pendingReportEvidence = [];
    renderReportEvidencePreview($("#report-bug-evidence-preview"), []);
}

function openReportUserModal(prefillUid = "") {
    resetReportUserForm();
    if (prefillUid) {
        $("#report-user-uid").value = prefillUid;
    }
    showLayeredModal("modal-report-user");
}

function openReportBugModal() {
    resetReportBugForm();
    showLayeredModal("modal-report-bug");
}

async function loadLogoAsDataUrl() {
    try {
        const response = await fetch(LUMEN_BOT_LOGO_PATH);
        if (!response.ok) return "";
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch {
        return "";
    }
}

async function ensureLumenBotProfile() {
    const botRef = doc(db, "users", LUMEN_BOT_UID);
    const botSnap = await getDoc(botRef);
    let logoDataUrl = state.botProfile?.avatarDataUrl || "";

    if (!logoDataUrl) {
        logoDataUrl = await loadLogoAsDataUrl();
    }

    const botData = {
        uid: LUMEN_BOT_UID,
        nickname: "Lumen",
        nicknameLower: "lumen",
        email: "official@lumen.app",
        isBot: true,
        isOfficial: true,
        isVerified: true,
        accentColor: "purple",
        avatarDataUrl: logoDataUrl || "",
        status: "online",
        presenceVisible: true,
        friends: [],
        createdAt: snapExists(botSnap) ? snapData(botSnap)?.createdAt : serverTimestamp()
    };

    if (snapExists(botSnap)) {
        await updateDoc(botRef, {
            nickname: botData.nickname,
            nicknameLower: botData.nicknameLower,
            isBot: true,
            isOfficial: true,
            isVerified: true,
            avatarDataUrl: logoDataUrl || snapData(botSnap)?.avatarDataUrl || "",
            status: "online",
            presenceVisible: true
        }).catch(() => {});
    } else {
        await setDoc(botRef, botData);
    }

    state.botProfile = { id: LUMEN_BOT_UID, ...botData, avatarDataUrl: logoDataUrl || botData.avatarDataUrl };
}

function getBotIntroMessage(resolutionStatus) {
    const intros = {
        resolved: "La tua segnalazione e' stata esaminata ed e' stata risolta dal team Lumen.",
        unresolved: "Abbiamo esaminato la tua segnalazione, ma al momento non e' stata risolta.",
        rejected: "La tua segnalazione e' stata esaminata e non e' stata accettata.",
        received: "Abbiamo ricevuto la tua segnalazione. Il team Lumen la esaminera' a breve."
    };
    return intros[resolutionStatus] || "Aggiornamento dalla piattaforma Lumen.";
}

function buildReportCardPayload(report, resolutionStatus, adminNote = "", actionTaken = "") {
    const title = report.type === "user"
        ? `Segnalazione utente: ${report.reportedUserNickname || report.reportedUserId || "—"}`
        : `Segnalazione bug: ${report.bugArea || "—"}`;

    return {
        reportId: report.id,
        type: report.type,
        status: resolutionStatus,
        statusLabel: REPORT_STATUS_LABELS[resolutionStatus] || resolutionStatus,
        title,
        reason: report.reason || "",
        bugArea: report.bugArea || null,
        reportedUserId: report.reportedUserId || null,
        adminNote,
        actionTaken,
        createdAtLabel: formatFirestoreDate(report.createdAt)
    };
}

async function sendBotReportMessage(targetUserId, { report, resolutionStatus, adminNote = "", actionTaken = "" }) {
    if (!targetUserId || !report) return;

    await ensureLumenBotProfile();

    const chatId = getPrivateChatId(targetUserId, LUMEN_BOT_UID);
    const intro = getBotIntroMessage(resolutionStatus);
    const reportCard = buildReportCardPayload(report, resolutionStatus, adminNote, actionTaken);

    await addDoc(collection(db, "messages"), {
        chatId,
        senderId: LUMEN_BOT_UID,
        receiverId: targetUserId,
        text: intro,
        messageType: "report_update",
        reportCard,
        isBot: true,
        isRead: false,
        timestamp: serverTimestamp()
    });
}

async function removeUserReportLogs(reportId, reportedUserId) {
    if (!reportedUserId) return;

    try {
        const logSnap = await db.collection("users").doc(reportedUserId).collection("reports_received").get();
        const batchDeletes = [];
        logSnap.forEach((logDoc) => {
            const log = logDoc.data();
            if (log.reportId === reportId) {
                batchDeletes.push(logDoc.ref.delete());
            }
        });
        await Promise.all(batchDeletes);
    } catch (error) {
        console.warn("Impossibile rimuovere log segnalazione utente:", error);
    }
}

async function finalizeReportAction(reportId, resolutionStatus, adminNote, actionTaken = "") {
    const report = state.adminReportsCache.find((item) => item.id === reportId);
    if (!report) return;

    const resolvedBy = state.currentUser.uid;
    const updatePayload = {
        status: resolutionStatus,
        resolvedAt: serverTimestamp(),
        resolvedBy,
        adminNote,
        actionTaken: actionTaken || null
    };

    if (resolutionStatus === "rejected") {
        await removeUserReportLogs(reportId, report.reportedUserId);
        await deleteDoc(doc(db, "reports", reportId));
    } else {
        await updateDoc(doc(db, "reports", reportId), updatePayload);
    }

    await appendModerationLog({
        action: `report_${resolutionStatus}`,
        targetUid: report.reporterId,
        details: `${report.type} — ${adminNote}`,
        adminUid: resolvedBy,
        reportId
    });

    await sendBotReportMessage(report.reporterId, {
        report: { ...report, id: reportId },
        resolutionStatus,
        adminNote,
        actionTaken
    });

    hideLayeredModal("modal-admin-report-action");
    hideLayeredModal("modal-admin-report-detail");

    showNotification({
        title: "Segnalazione aggiornata",
        message: `Stato impostato su: ${REPORT_STATUS_LABELS[resolutionStatus] || resolutionStatus}. Messaggio Lumen inviato.`,
        type: "system",
        icon: "bot",
        addToHome: false
    });
}

function openAdminReportActionModal(reportId, actionType) {
    const report = state.adminReportsCache.find((item) => item.id === reportId);
    if (!report) return;

    state.pendingAdminReportAction = { reportId, actionType };

    const titleMap = {
        resolved: "Segna come risolto",
        unresolved: "Segna come non risolto",
        rejected: "Rifiuta segnalazione"
    };
    const hintMap = {
        resolved: "L'utente ricevera' un messaggio da Lumen con l'esito positivo.",
        unresolved: "Spiega perche' la segnalazione non puo' essere risolta.",
        rejected: "La segnalazione verra' eliminata definitivamente. Motivazione obbligatoria."
    };

    $("#admin-report-action-title").textContent = titleMap[actionType] || "Azione segnalazione";
    $("#admin-report-action-hint").textContent = hintMap[actionType] || "";
    $("#admin-report-action-note").value = "";
    $("#admin-report-action-taken").value = "nessuna_azione";
    $("#admin-report-ban-duration").value = "";

    const extra = $("#admin-report-action-extra");
    const showExtra = actionType === "resolved" && report.type === "user";
    extra?.classList.toggle("hidden", !showExtra);

    $("#admin-report-action-note-label").textContent = actionType === "resolved"
        ? "Cosa e' stato fatto? (obbligatorio) *"
        : "Motivazione per l'utente *";

    const confirmBtn = $("#admin-report-action-confirm");
    if (confirmBtn) {
        confirmBtn.className = actionType === "rejected" ? "btn-danger" : "btn-primary";
        confirmBtn.textContent = actionType === "rejected" ? "Rifiuta" : "Conferma";
    }

    showLayeredModal("modal-admin-report-action");
}

function bindAdminReportActionForm() {
    $("#admin-report-action-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const pending = state.pendingAdminReportAction;
        if (!pending) return;

        const adminNote = $("#admin-report-action-note").value.trim();
        if (!adminNote) {
            alert("Inserisci una nota/motivazione per l'utente.");
            return;
        }

        const report = state.adminReportsCache.find((item) => item.id === pending.reportId);
        let actionTaken = "";

        if (pending.actionType === "resolved" && report?.type === "user") {
            actionTaken = $("#admin-report-action-taken").value;
            const duration = $("#admin-report-ban-duration").value.trim();

            if (actionTaken === "ban_temporaneo" && duration) {
                actionTaken = `ban_temporaneo (${duration})`;
                if (report.reportedUserId && report.reportedUserId !== ADMIN_UID) {
                    const banned = await banUser(report.reportedUserId, duration, adminNote);
                    if (!banned) return;
                }
            } else if (actionTaken === "ban_permanente" && report.reportedUserId && report.reportedUserId !== ADMIN_UID) {
                const banned = await banUser(report.reportedUserId, "permanente", adminNote);
                if (!banned) return;
            }
        }

        await finalizeReportAction(pending.reportId, pending.actionType, adminNote, actionTaken);
        state.pendingAdminReportAction = null;
    });
}

function renderReportCardViewBody(report, reportCard = null) {
    const body = $("#report-card-view-body");
    const title = $("#report-card-view-title");
    if (!body) return;

    const card = reportCard || {};
    const status = card.status || report?.status || "open";
    const statusLabel = card.statusLabel || REPORT_STATUS_LABELS[status] || status;

    if (title) {
        title.textContent = card.title || "Dettaglio segnalazione";
    }

    body.innerHTML = `
        <div class="admin-detail-section">
            <h4>Stato</h4>
            <p><span class="report-status-pill ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span></p>
        </div>
        <div class="admin-detail-section">
            <h4>Dettagli</h4>
            <p><span>Tipo:</span> ${report?.type === "user" || card.type === "user" ? "Utente" : "Bug"}</p>
            <p><span>Data:</span> ${escapeHtml(card.createdAtLabel || formatFirestoreDate(report?.createdAt))}</p>
            ${card.adminNote ? `<p><span>Nota team:</span> ${escapeHtml(card.adminNote)}</p>` : ""}
            ${card.actionTaken ? `<p><span>Azione:</span> ${escapeHtml(card.actionTaken)}</p>` : ""}
        </div>
        <div class="admin-detail-section">
            <h4>Contenuto</h4>
            <p class="admin-detail-text">${escapeHtml(card.reason || report?.reason || "—")}</p>
        </div>
    `;
}

async function openReportCardFromMessage(reportCard) {
    if (!reportCard?.reportId) return;

    let report = state.adminReportsCache.find((item) => item.id === reportCard.reportId);

    if (!report) {
        try {
            const reportSnap = await getDoc(doc(db, "reports", reportCard.reportId));
            if (snapExists(reportSnap)) {
                report = { id: reportCard.reportId, ...snapData(reportSnap) };
            }
        } catch {
            report = null;
        }
    }

    renderReportCardViewBody(
        report || { reason: reportCard.reason, type: reportCard.type, createdAt: null },
        reportCard
    );
    showLayeredModal("modal-report-card-view");
}

function injectBotConversationCard(messagesContainer) {
    if (!state.currentUser || !messagesContainer) return;

    if ($(".bot-conversation-card", messagesContainer)) {
        return;
    }

    const botData = state.botProfile || { nickname: "Lumen", accentColor: "purple" };

    const card = document.createElement("div");
    card.className = "friend-item-card bot-conversation-card";
    card.dataset.name = "lumen bot";
    card.innerHTML = `
        <div class="friend-card-main">
            <div class="chat-item-avatar friend-avatar bot-avatar">${escapeHtml(getInitial("Lumen"))}</div>
            <div class="friend-details">
                <h4>${formatDisplayNameHtml(botData, LUMEN_BOT_UID)}</h4>
                <p>Account ufficiale Lumen</p>
                <div class="status-indicator">
                    <span class="status-dot online"></span>
                    <span class="status-text online">Online</span>
                </div>
            </div>
        </div>
    `;

    const updateBotCard = (data) => {
        applyAvatarElement($(".bot-avatar", card), "Lumen", data.accentColor || "purple", data.avatarDataUrl || "");
        $(".friend-details h4", card).innerHTML = formatDisplayNameHtml(data, LUMEN_BOT_UID);
    };

    if (!state.botProfile) {
        ensureLumenBotProfile().then(() => {
            if (state.botProfile) updateBotCard(state.botProfile);
        });
    } else {
        updateBotCard(state.botProfile);
    }

    if (state.botUnsubscribe) {
        state.botUnsubscribe();
    }

    const chatId = getPrivateChatId(state.currentUser.uid, LUMEN_BOT_UID);
    const unreadQuery = query(
        collection(db, "messages"),
        where("chatId", "==", chatId),
        where("senderId", "==", LUMEN_BOT_UID),
        where("receiverId", "==", state.currentUser.uid),
        where("isRead", "==", false)
    );

    state.botUnsubscribe = onSnapshot(unreadQuery, (snapshot) => {
        const count = snapshot.size;
        const isCurrentlyChatting = state.activeChat?.type === "private" && state.activeChat.id === LUMEN_BOT_UID;

        if (count > 0 && !isCurrentlyChatting) {
            state.friendUnreadMap.set(LUMEN_BOT_UID, count);
        } else {
            state.friendUnreadMap.delete(LUMEN_BOT_UID);
        }

        const existingBadge = $(".unread-badge-lumen", card);
        if (count > 0) {
            if (existingBadge) {
                existingBadge.textContent = count;
            } else {
                const badge = document.createElement("span");
                badge.className = "unread-badge-lumen";
                badge.textContent = count;
                card.appendChild(badge);
            }
        } else if (existingBadge) {
            existingBadge.remove();
        }

        renderHomeSidebarAlerts();
    });

    card.addEventListener("click", () => openChatWith(LUMEN_BOT_UID, "Lumen", state.botProfile || botData));
    messagesContainer.prepend(card);
}

async function appendUserReportLog(reportedUserId, payload) {
    try {
        await db.collection("users").doc(reportedUserId).collection("reports_received").add({
            ...payload,
            createdAt: serverTimestamp()
        });
    } catch (error) {
        console.warn("Log segnalazione utente non salvato:", error);
    }
}

async function submitUserReport(event) {
    event?.preventDefault();

    const reportedUserId = $("#report-user-uid").value.trim();
    const reason = $("#report-user-reason").value.trim();

    if (!reportedUserId) {
        alert("Inserisci l'UID dell'utente da segnalare.");
        return;
    }

    if (!reason) {
        alert("La motivazione e' obbligatoria.");
        return;
    }

    if (reportedUserId === state.currentUser.uid) {
        alert("Non puoi segnalare te stesso.");
        return;
    }

    const reportedSnap = await getDoc(doc(db, "users", reportedUserId));
    if (!snapExists(reportedSnap)) {
        alert("Nessun utente trovato con questo UID.");
        return;
    }

    const reporterSnap = await getDoc(doc(db, "users", state.currentUser.uid));
    const reporterData = snapExists(reporterSnap) ? snapData(reporterSnap) : {};
    const reportedData = snapData(reportedSnap);
    const evidenceImages = state.pendingReportEvidence.length
        ? state.pendingReportEvidence
        : await processReportEvidenceFiles($("#report-user-evidence").files);

    const reportRef = await addDoc(collection(db, "reports"), {
        type: "user",
        reporterId: state.currentUser.uid,
        reporterNickname: getDisplayName(reporterData),
        reportedUserId,
        reportedUserNickname: getDisplayName(reportedData),
        bugArea: null,
        reason,
        evidenceImages,
        status: "open",
        createdAt: serverTimestamp()
    });

    await appendUserReportLog(reportedUserId, {
        reportId: reportRef.id,
        reporterId: state.currentUser.uid,
        reporterNickname: getDisplayName(reporterData),
        reason
    });

    $("#modal-report-user").classList.add("hidden");
    resetReportUserForm();

    showNotification({
        title: "Segnalazione inviata",
        message: "Grazie. Il team Lumen esaminera' la segnalazione.",
        type: "system",
        icon: "flag",
        addToHome: false
    });
}

async function submitBugReport(event) {
    event?.preventDefault();

    const bugArea = $("#report-bug-area").value.trim();
    const description = $("#report-bug-description").value.trim();

    if (!bugArea) {
        alert("Seleziona l'area del bug.");
        return;
    }

    if (!description) {
        alert("Inserisci una descrizione del bug.");
        return;
    }

    const reporterSnap = await getDoc(doc(db, "users", state.currentUser.uid));
    const reporterData = snapExists(reporterSnap) ? snapData(reporterSnap) : {};
    const evidenceImages = state.pendingReportEvidence.length
        ? state.pendingReportEvidence
        : await processReportEvidenceFiles($("#report-bug-evidence").files);

    await addDoc(collection(db, "reports"), {
        type: "bug",
        reporterId: state.currentUser.uid,
        reporterNickname: getDisplayName(reporterData),
        reportedUserId: null,
        reportedUserNickname: null,
        bugArea,
        reason: description,
        evidenceImages,
        status: "open",
        createdAt: serverTimestamp()
    });

    $("#modal-report-bug").classList.add("hidden");
    resetReportBugForm();

    showNotification({
        title: "Bug segnalato",
        message: "Grazie per il feedback. Lo esamineremo al piu' presto.",
        type: "system",
        icon: "bug",
        addToHome: false
    });
}

function bindReportSystem() {
    $("#btn-open-report-user")?.addEventListener("click", () => openReportUserModal());
    $("#btn-open-report-bug")?.addEventListener("click", () => openReportBugModal());

    $("#report-user-form")?.addEventListener("submit", submitUserReport);
    $("#report-bug-form")?.addEventListener("submit", submitBugReport);

    $("#report-user-evidence")?.addEventListener("change", async (event) => {
        state.pendingReportEvidence = await processReportEvidenceFiles(event.target.files);
        renderReportEvidencePreview($("#report-user-evidence-preview"), state.pendingReportEvidence);
    });

    $("#report-bug-evidence")?.addEventListener("change", async (event) => {
        state.pendingReportEvidence = await processReportEvidenceFiles(event.target.files);
        renderReportEvidencePreview($("#report-bug-evidence-preview"), state.pendingReportEvidence);
    });

    bindAdminReportActionForm();
}

function listenToAdminReports() {
    if (state.adminReportsUnsubscribe) {
        state.adminReportsUnsubscribe();
    }

    state.adminReportsUnsubscribe = onSnapshot(collection(db, "reports"), (snapshot) => {
        const reports = [];
        snapshot.forEach((reportDoc) => {
            reports.push({ id: reportDoc.id, ...reportDoc.data() });
        });

        reports.sort((a, b) => {
            const aTime = a.createdAt?.toDate?.()?.getTime?.() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime?.() || 0;
            return bTime - aTime;
        });

        state.adminReportsCache = reports;
        $("#admin-stat-reports").textContent = String(reports.filter(isReportActive).length);
        renderAdminReportsList();
    });
}

function renderAdminReportsList() {
    const container = $("#admin-reports-list");
    if (!container) return;

    const tab = state.adminReportTab;
    const filtered = state.adminReportsCache.filter((report) => report.type === tab && isReportActive(report));

    if (filtered.length === 0) {
        container.innerHTML = `<p class="secondary-text">Nessuna segnalazione ${tab === "user" ? "utente" : "bug"}.</p>`;
        return;
    }

    container.innerHTML = filtered.map((report) => {
        const title = report.type === "user"
            ? `Utente: ${report.reportedUserNickname || report.reportedUserId || "—"}`
            : `Bug: ${report.bugArea || "Area sconosciuta"}`;
        const when = formatFirestoreDate(report.createdAt);

        return `
            <button class="admin-report-card" type="button" data-report-id="${escapeHtml(report.id)}">
                <div class="admin-report-card-head">
                    <strong>${escapeHtml(title)}</strong>
                    <span class="admin-report-type-badge ${escapeHtml(report.type)}">${report.type === "user" ? "Utente" : "Bug"}</span>
                </div>
                <p class="admin-report-card-meta">Da: ${escapeHtml(report.reporterNickname || report.reporterId || "—")}</p>
                <p class="admin-report-card-meta">${escapeHtml(when)}</p>
            </button>
        `;
    }).join("");

    $$(".admin-report-card", container).forEach((button) => {
        button.addEventListener("click", () => openAdminReportDetail(button.dataset.reportId));
    });
}

function bindAdminReportTabs() {
    $$(".admin-report-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            $$(".admin-report-tab").forEach((item) => item.classList.remove("active"));
            tab.classList.add("active");
            state.adminReportTab = tab.dataset.reportTab;
            renderAdminReportsList();
        });
    });
}

async function openAdminReportDetail(reportId) {
    const report = state.adminReportsCache.find((item) => item.id === reportId);
    if (!report) return;

    const body = $("#admin-report-detail-body");
    const title = $("#admin-report-detail-title");
    if (!body || !title) return;

    title.textContent = report.type === "user" ? "Segnalazione utente" : "Segnalazione bug";

    const evidenceMarkup = (report.evidenceImages || []).length
        ? (report.evidenceImages || []).map((src, index) => `
            <a class="report-evidence-link" href="${src}" target="_blank" rel="noopener">
                <img src="${src}" alt="Prova ${index + 1}">
            </a>
        `).join("")
        : '<p class="secondary-text">Nessun allegato.</p>';

    body.innerHTML = `
        <div class="admin-detail-section">
            <h4>Informazioni generali</h4>
            <p><span>Tipo:</span> ${report.type === "user" ? "Utente" : "Bug"}</p>
            <p><span>Stato:</span> ${escapeHtml(report.status || "open")}</p>
            <p><span>Data/ora:</span> ${escapeHtml(formatFirestoreDate(report.createdAt))}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Segnalatore</h4>
            <p><span>Nickname:</span> ${escapeHtml(report.reporterNickname || "—")}</p>
            <p><span>UID:</span> <code>${escapeHtml(report.reporterId || "—")}</code></p>
        </div>
        ${report.type === "user" ? `
            <div class="admin-detail-section">
                <h4>Utente segnalato</h4>
                <p><span>Nickname:</span> ${escapeHtml(report.reportedUserNickname || "—")}</p>
                <p><span>UID:</span> <code>${escapeHtml(report.reportedUserId || "—")}</code></p>
            </div>
        ` : `
            <div class="admin-detail-section">
                <h4>Area bug</h4>
                <p>${escapeHtml(report.bugArea || "—")}</p>
            </div>
        `}
        <div class="admin-detail-section">
            <h4>${report.type === "user" ? "Motivazione" : "Descrizione"}</h4>
            <p class="admin-detail-text">${escapeHtml(report.reason || "—")}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Prove allegate</h4>
            <div class="report-evidence-gallery">${evidenceMarkup}</div>
        </div>
        ${report.type === "user" && report.reportedUserId ? `
            <button class="btn-secondary btn-open-reported-user" type="button" data-uid="${escapeHtml(report.reportedUserId)}">
                Apri profilo utente segnalato
            </button>
        ` : ""}
        ${isReportActive(report) ? `
            <div class="admin-report-actions">
                <button class="btn-primary admin-report-action-btn" type="button" data-report-action="resolved" data-report-id="${escapeHtml(report.id)}">
                    <i data-lucide="check-circle"></i> Risolto
                </button>
                <button class="btn-secondary admin-report-action-btn" type="button" data-report-action="unresolved" data-report-id="${escapeHtml(report.id)}">
                    <i data-lucide="alert-circle"></i> Non risolto
                </button>
                <button class="btn-danger admin-report-action-btn" type="button" data-report-action="rejected" data-report-id="${escapeHtml(report.id)}">
                    <i data-lucide="x-circle"></i> Rifiuta
                </button>
            </div>
        ` : `
            <p class="secondary-text">Segnalazione chiusa (${escapeHtml(REPORT_STATUS_LABELS[report.status] || report.status || "—")}).</p>
        `}
    `;

    $(".btn-open-reported-user", body)?.addEventListener("click", (event) => {
        openAdminUserDetail(event.currentTarget.dataset.uid);
    });

    $$(".admin-report-action-btn", body).forEach((button) => {
        button.addEventListener("click", () => {
            openAdminReportActionModal(button.dataset.reportId, button.dataset.reportAction);
        });
    });

    showLayeredModal("modal-admin-report-detail");
}

async function fetchUserReportsReceived(userId) {
    const reports = state.adminReportsCache.filter(
        (report) => report.type === "user" && report.reportedUserId === userId
    );

    if (reports.length > 0) return reports;

    try {
        const logSnap = await db.collection("users").doc(userId).collection("reports_received").orderBy("createdAt", "desc").limit(25).get();
        const logs = [];
        logSnap.forEach((docSnap) => logs.push({ id: docSnap.id, ...docSnap.data() }));
        return logs;
    } catch {
        return [];
    }
}

async function fetchUserBanHistory(userId) {
    const banSnap = await getDoc(doc(db, "bans", userId));
    if (!snapExists(banSnap)) return null;
    return snapData(banSnap);
}

async function fetchUserModerationLogs(userId) {
    const logs = [];
    const snapshot = await getDocs(collection(db, "moderation_logs"));
    snapshot.forEach((logDoc) => {
        const log = logDoc.data();
        if (log.targetUid === userId) {
            logs.push({ id: logDoc.id, ...log });
        }
    });

    logs.sort((a, b) => {
        const aTime = a.createdAt?.toDate?.()?.getTime?.() || 0;
        const bTime = b.createdAt?.toDate?.()?.getTime?.() || 0;
        return bTime - aTime;
    });

    return logs.slice(0, 15);
}

async function openAdminUserDetail(userId) {
    const body = $("#admin-user-detail-body");
    if (!body) return;

    body.innerHTML = '<p class="secondary-text">Caricamento profilo...</p>';
    showLayeredModal("modal-admin-user-detail");

    const userSnap = await getDoc(doc(db, "users", userId));
    if (!snapExists(userSnap)) {
        body.innerHTML = '<p class="secondary-text">Utente non trovato.</p>';
        return;
    }

    const user = { id: userId, ...snapData(userSnap) };
    const name = getDisplayName(user);
    const online = user.presenceVisible !== false && user.status === "online";
    const reports = await fetchUserReportsReceived(userId);
    const ban = await fetchUserBanHistory(userId);
    const modLogs = await fetchUserModerationLogs(userId);

    const reportsMarkup = reports.length
        ? reports.map((report) => `
            <article class="admin-mini-log-item">
                <strong>${escapeHtml(report.reporterNickname || report.reporterId || "Segnalatore")}</strong>
                <span>${escapeHtml(formatFirestoreDate(report.createdAt))}</span>
                <p>${escapeHtml(report.reason || "—")}</p>
            </article>
        `).join("")
        : '<p class="secondary-text">Nessuna segnalazione ricevuta.</p>';

    const banMarkup = ban
        ? `<p><span>Stato:</span> ${ban.active ? "Attivo" : "Non attivo"}</p>
           <p><span>Motivo:</span> ${escapeHtml(ban.reason || "—")}</p>
           <p><span>Durata:</span> ${escapeHtml(ban.duration || "—")}</p>
           <p><span>Da:</span> ${escapeHtml(formatFirestoreDate(ban.bannedAt))}</p>
           <p><span>Scadenza:</span> ${escapeHtml(formatFirestoreDate(ban.expiresAt) === "—" ? "Permanente" : formatFirestoreDate(ban.expiresAt))}</p>`
        : '<p class="secondary-text">Nessun ban registrato.</p>';

    const modLogsMarkup = modLogs.length
        ? modLogs.map((log) => `
            <article class="admin-mini-log-item">
                <strong>${escapeHtml(log.action || "Azione")}</strong>
                <span>${escapeHtml(formatFirestoreDate(log.createdAt))}</span>
                <p>${escapeHtml(log.details || "")}</p>
            </article>
        `).join("")
        : '<p class="secondary-text">Nessun log moderazione.</p>';

    body.innerHTML = `
        <div class="admin-user-detail-header">
            <div class="chat-item-avatar admin-user-detail-avatar">${escapeHtml(getInitial(name))}</div>
            <div>
                <h4>${escapeHtml(name)}</h4>
                <span class="admin-user-status ${online ? "online" : "offline"}">${online ? "Online" : "Offline"}</span>
            </div>
        </div>
        <div class="admin-detail-section">
            <h4>Account</h4>
            <p><span>UID:</span> <code>${escapeHtml(userId)}</code></p>
            <p><span>Email:</span> ${escapeHtml(user.email || "—")}</p>
            <p><span>Creato:</span> ${escapeHtml(formatFirestoreDate(user.createdAt))}</p>
            <p><span>Ultima attivita':</span> ${escapeHtml(formatFirestoreDate(user.lastSeenAt))}</p>
        </div>
        <div class="admin-detail-section">
            <h4>Storico segnalazioni ricevute (${reports.length})</h4>
            <div class="admin-mini-log-list">${reportsMarkup}</div>
        </div>
        <div class="admin-detail-section">
            <h4>Ban / moderazione</h4>
            ${banMarkup}
        </div>
        <div class="admin-detail-section">
            <h4>Log sistema</h4>
            <div class="admin-mini-log-list">${modLogsMarkup}</div>
        </div>
    `;

    applyAvatarElement($(".admin-user-detail-avatar", body), name, user.accentColor || "purple", user.avatarDataUrl || "");
    refreshIcons();
}

function setupAdminPanel() {
    const adminBtn = $("#settings-admin-btn");
    const isAdmin = state.currentUser?.uid === ADMIN_UID;

    adminBtn?.classList.toggle("hidden", !isAdmin);

    if (!isAdmin) return;

    listenToAdminData();
    listenToAdminUsers();
    listenToAdminReports();
    listenToAdminAppeals();
    bindAdminReportTabs();
    bindAdminAppealActions();
    bindAdminControls();
}

function listenToAdminData() {
    onSnapshot(collection(db, "bans"), (snapshot) => {
        const activeBans = [];
        snapshot.forEach((banDoc) => {
            const ban = banDoc.data();
            if (ban?.active) activeBans.push({ id: banDoc.id, ...ban });
        });

        $("#admin-stat-banned").textContent = String(activeBans.length);
        renderAdminBannedList(activeBans);
    });

    onSnapshot(query(collection(db, "users"), where("status", "==", "online")), (snapshot) => {
        let onlineCount = 0;
        snapshot.forEach((userDoc) => {
            const data = userDoc.data();
            if (data?.presenceVisible === false) return;
            onlineCount += 1;
        });

        $("#admin-stat-online").textContent = String(onlineCount);
    });

    onSnapshot(collection(db, "moderation_logs"), (snapshot) => {
        const container = $("#admin-mod-log");
        if (!container) return;

        if (snapshot.empty) {
            container.innerHTML = '<p class="secondary-text">Nessun log ancora.</p>';
            return;
        }

        const logDocs = [];
        snapshot.forEach((logDoc) => logDocs.push(logDoc));
        logDocs.sort((a, b) => {
            const aTime = a.data()?.createdAt?.toDate?.()?.getTime?.() || 0;
            const bTime = b.data()?.createdAt?.toDate?.()?.getTime?.() || 0;
            return bTime - aTime;
        });

        let markup = "";
        logDocs.slice(0, 25).forEach((logDoc) => {
            const log = logDoc.data();
            const when = log.createdAt?.toDate
                ? log.createdAt.toDate().toLocaleString()
                : "Adesso";
            markup += `
                <div class="admin-log-item">
                    <strong>${escapeHtml(log.action || "Azione")}</strong>
                    <span>${escapeHtml(when)}</span>
                    <p>${escapeHtml(log.details || "")}</p>
                </div>
            `;
        });

        container.innerHTML = markup;
    });
}

function renderAdminBannedList(bans) {
    const container = $("#admin-banned-list");
    if (!container) return;

    if (bans.length === 0) {
        container.innerHTML = '<p class="secondary-text">Nessun ban attivo.</p>';
        return;
    }

    container.innerHTML = bans.map((ban) => {
        const bannedAt = ban.bannedAt?.toDate ? ban.bannedAt.toDate().toLocaleString() : "—";
        const expiresAt = ban.expiresAt?.toDate
            ? ban.expiresAt.toDate().toLocaleString()
            : (ban.duration === "permanent" || !ban.expiresAt ? "Permanente" : "—");

        return `
            <article class="admin-ban-card">
                <div class="admin-ban-head">
                    <strong>${escapeHtml(ban.userId || ban.id)}</strong>
                    <span class="admin-ban-badge">${escapeHtml(ban.duration || "custom")}</span>
                </div>
                <p><span>Motivo:</span> ${escapeHtml(ban.reason || "—")}</p>
                <p><span>Admin:</span> ${escapeHtml(ban.bannedBy || "—")}</p>
                <p><span>Data:</span> ${escapeHtml(bannedAt)}</p>
                <p><span>Scadenza:</span> ${escapeHtml(expiresAt)}</p>
                <button class="btn-secondary btn-admin-unban-inline" type="button" data-uid="${escapeHtml(ban.userId || ban.id)}">Unban</button>
            </article>
        `;
    }).join("");

    $$(".btn-admin-unban-inline", container).forEach((button) => {
        button.addEventListener("click", () => unbanUser(button.dataset.uid));
    });
}

function renderAdminUsersList(users, searchTerm = "") {
    const container = $("#admin-users-list");
    if (!container) return;

    const term = searchTerm.trim().toLowerCase();
    const filtered = users.filter((user) => {
        if (!term) return true;
        const name = getDisplayName(user).toLowerCase();
        return name.includes(term) || user.id.toLowerCase().includes(term);
    });

    if (filtered.length === 0) {
        container.innerHTML = '<p class="secondary-text">Nessun utente trovato.</p>';
        return;
    }

    container.innerHTML = filtered.map((user) => {
        const online = user.presenceVisible !== false && user.status === "online";
        const accentColor = user.accentColor || "purple";
        const name = getDisplayName(user);

        return `
            <button class="admin-user-row" type="button" data-user-id="${escapeHtml(user.id)}">
                <div class="chat-item-avatar admin-user-avatar">${escapeHtml(getInitial(name))}</div>
                <div class="admin-user-meta">
                    <strong>${escapeHtml(name)}</strong>
                    <code>${escapeHtml(user.id)}</code>
                </div>
                <span class="admin-user-status ${online ? "online" : "offline"}">${online ? "Online" : "Offline"}</span>
            </button>
        `;
    }).join("");

    $$(".admin-user-row", container).forEach((row, index) => {
        const user = filtered[index];
        applyAvatarElement($(".admin-user-avatar", row), getDisplayName(user), user.accentColor || "purple", user.avatarDataUrl || "");
        row.addEventListener("click", () => openAdminUserDetail(user.id));
    });
}

function listenToAdminUsers() {
    if (state.adminUsersUnsubscribe) {
        state.adminUsersUnsubscribe();
    }

    state.adminUsersUnsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
        const users = [];
        snapshot.forEach((userDoc) => {
            if (userDoc.id === LUMEN_BOT_UID) return;
            const data = userDoc.data();
            if (data?.isBot) return;
            users.push({ id: userDoc.id, ...data });
        });

        users.sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b), "it"));
        state.adminUsersCache = users;

        if (!$("#modal-admin-users")?.classList.contains("hidden")) {
            renderAdminUsersList(users, $("#admin-users-search")?.value || "");
        }
    });
}

async function banUser(uid, durationInput, reason) {
    const parsed = parseBanDuration(durationInput);
    if (parsed.error) {
        alert(parsed.error);
        return false;
    }

    const expiresAt = parsed.ms ? new Date(Date.now() + parsed.ms) : null;

    await setDoc(doc(db, "bans", uid), {
        userId: uid,
        banId: `${uid}_${Date.now()}`,
        reason,
        bannedBy: state.currentUser.uid,
        bannedAt: serverTimestamp(),
        expiresAt: expiresAt || null,
        duration: parsed.label,
        active: true
    });

    await updateDoc(doc(db, "users", uid), { status: "offline" }).catch(() => {});

    await appendModerationLog({
        action: "ban",
        targetUid: uid,
        details: `${parsed.label} — ${reason}`,
        adminUid: state.currentUser.uid
    });

    showNotification({
        title: "Ban applicato",
        message: `Utente ${uid} bannato.`,
        type: "system",
        icon: "shield-ban"
    });

    return true;
}

async function unbanUser(uid, note = "Ban rimosso manualmente.") {
    if (!uid) return;

    const banRef = doc(db, "bans", uid);
    const banSnap = await getDoc(banRef);
    if (snapExists(banSnap)) {
        await updateDoc(banRef, {
            active: false,
            expiresAt: null,
            unbanNote: note,
            unbannedAt: serverTimestamp(),
            unbannedBy: state.currentUser.uid
        });
    }

    await appendModerationLog({
        action: "unban",
        targetUid: uid,
        details: note,
        adminUid: state.currentUser.uid
    });

    showNotification({
        title: "Unban completato",
        message: `Ban rimosso per ${uid}.`,
        type: "system",
        icon: "shield-check"
    });
}

function bindAdminControls() {
    $("#admin-ban-submit")?.addEventListener("click", async () => {
        const uid = $("#admin-ban-uid").value.trim();
        const duration = $("#admin-ban-duration").value;
        const reason = $("#admin-ban-reason").value.trim();

        if (!uid) {
            alert("Inserisci un UID valido.");
            return;
        }

        if (!reason) {
            alert("La motivazione e' obbligatoria.");
            return;
        }

        if (uid === ADMIN_UID) {
            alert("Non puoi bannare l'account admin.");
            return;
        }

        const banned = await banUser(uid, duration, reason);
        if (!banned) return;

        $("#admin-ban-uid").value = "";
        $("#admin-ban-duration").value = "";
        $("#admin-ban-reason").value = "";
    });

    $("#admin-open-users-panel")?.addEventListener("click", () => {
        showLayeredModal("modal-admin-users");
        renderAdminUsersList(state.adminUsersCache, $("#admin-users-search")?.value || "");
    });

    $("#admin-users-search")?.addEventListener("input", (event) => {
        renderAdminUsersList(state.adminUsersCache, event.target.value);
    });

    $("#admin-unban-submit")?.addEventListener("click", async () => {
        const uid = $("#admin-unban-uid").value.trim();
        if (!uid) {
            alert("Inserisci un UID valido.");
            return;
        }
        await unbanUser(uid);
        $("#admin-unban-uid").value = "";
    });
}

function bindHomeQuickLinks() {
    $$(".home-quick-link").forEach((button) => {
        button.addEventListener("click", () => handleNavSelection(button.dataset.target));
    });
}

function bindLeaveGroupModal() {
    $("#btn-leave-group-no")?.addEventListener("click", () => {
        $("#modal-leave-group").classList.add("hidden");
        state.pendingLeaveGroupId = null;
    });

    $("#btn-leave-group-yes")?.addEventListener("click", async () => {
        const groupId = state.pendingLeaveGroupId;
        $("#modal-leave-group").classList.add("hidden");
        state.pendingLeaveGroupId = null;
        if (groupId) await leaveGroup(groupId);
    });
}

function bindVoiceWidget() {
    const widgetPfp = $("#voice-widget-pfp");
    const micBtn = $("#voice-mic-toggle");
    const headsetBtn = $("#voice-headset-toggle");
    const micStatus = $("#voice-mic-status");
    const headsetStatus = $("#voice-headset-status");

    const refreshVoiceUi = () => {
        const name = $("#nickname-input")?.value.trim() || $("#profile-name")?.textContent || "Utente";
        $("#voice-widget-nickname").textContent = name;
        applyAvatarElement(widgetPfp, name, state.selectedColor, state.avatarDataUrl);

        micBtn?.classList.toggle("muted", state.voiceMicMuted);
        headsetBtn?.classList.toggle("deafened", state.voiceDeafened);
        micStatus?.classList.toggle("muted", state.voiceMicMuted);
        headsetStatus?.classList.toggle("deafened", state.voiceDeafened);

        if (micStatus) {
            micStatus.innerHTML = state.voiceMicMuted
                ? '<i data-lucide="mic-off"></i>'
                : '<i data-lucide="mic"></i>';
        }

        if (headsetStatus) {
            headsetStatus.innerHTML = state.voiceDeafened
                ? '<i data-lucide="volume-x"></i>'
                : '<i data-lucide="headphones"></i>';
        }

        if (micBtn) {
            micBtn.innerHTML = state.voiceMicMuted
                ? '<i data-lucide="mic-off"></i>'
                : '<i data-lucide="mic"></i>';
        }

        if (headsetBtn) {
            headsetBtn.innerHTML = state.voiceDeafened
                ? '<i data-lucide="volume-x"></i>'
                : '<i data-lucide="headphones"></i>';
        }

        refreshIcons();
    };

    micBtn?.addEventListener("click", () => {
        state.voiceMicMuted = !state.voiceMicMuted;
        refreshVoiceUi();
        showNotification({
            title: state.voiceMicMuted ? "Microfono disattivato" : "Microfono attivo",
            message: "Controlli voce UI (nessuna chiamata reale ancora).",
            type: "system",
            icon: state.voiceMicMuted ? "mic-off" : "mic"
        });
    });

    headsetBtn?.addEventListener("click", () => {
        state.voiceDeafened = !state.voiceDeafened;
        refreshVoiceUi();
        showNotification({
            title: state.voiceDeafened ? "Audio chiamate disattivato" : "Audio chiamate attivo",
            message: "Controlli voce UI (nessuna chiamata reale ancora).",
            type: "system",
            icon: state.voiceDeafened ? "volume-x" : "headphones"
        });
    });

    $("#chat-call-btn")?.addEventListener("click", () => {
        showNotification({
            title: "Chiamate in arrivo",
            message: "Le chiamate vocali saranno disponibili in un prossimo aggiornamento.",
            type: "system",
            icon: "phone"
        });
    });

    refreshVoiceUi();
    setInterval(refreshVoiceUi, 5000);
}

bindNavigation();
bindMobileNavigation();
bindHomeNotifications();
bindReportSystem();
bindHomeQuickLinks();
bindLeaveGroupModal();
bindVoiceWidget();
bindSettingsMenu();
bindFriendControls();
bindBanOverlayControls();
bindAppealControls();
bindAdminAppealConfirmActions();
bindChatHeaderMenu();
bindMessageSearch();
bindChatInput();
bindGroupControls();
bindProfileControls();
bindAvatarCropControls();
bindAppearanceControls();
bindCustomThemeControls();
bindPrivacyControls();
bindAccountControls();
bindModalControls();
bindAudioUnlock();
applyStoredPreferences();
refreshIcons();
observeAuthState();
