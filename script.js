// ==========================================
// HARDCODED PROXY — no user-facing field needed
// ==========================================
const PROXY_URL = "https://madara-backend-proxy.onrender.com/proxy";
const PROXY_ORIGIN = PROXY_URL.replace(/\/proxy$/, "");

// ==========================================
// CATEGORY COLORS (used everywhere a category shows on a graph)
// ==========================================
const CATEGORY_COLORS = {
  views: "#22c55e",
  likes: "#3b82f6",
  share: "#a855f7",
  save: "#f59e0b",
  comments: "#facc15",
  repost: "#fb7185",
  followers: "#33d17a",
  other: "#9a8286",
};

function colorForCategory(cat) {
  return CATEGORY_COLORS[cat] || CATEGORY_COLORS.other;
}

// ==========================================
// DEMO CATALOG (used until a real panel is connected)
// Includes min/max like a real panel would return.
// ==========================================
const DEMO_CATALOG = {
  views: [
    { id: 3546, name: "Instagram Views [Real, Fast]", rate: 6, min: 100, max: 100000 },
    { id: 3612, name: "Instagram Views [HQ, Refill]", rate: 9, min: 100, max: 500000 },
    { id: 3720, name: "Instagram Reel Views [Instant]", rate: 7, min: 500, max: 200000 },
  ],
  likes: [
    { id: 4108, name: "Instagram Likes [Real Users]", rate: 12, min: 10, max: 50000 },
    { id: 4190, name: "Instagram Likes [Instant]", rate: 10, min: 20, max: 20000 },
  ],
  followers: [
    { id: 5021, name: "Instagram Followers [HQ, No Drop]", rate: 20, min: 50, max: 100000 },
    { id: 5099, name: "Instagram Followers [Real, Refill 30d]", rate: 26, min: 100, max: 50000 },
  ],
  repost: [
    { id: 6011, name: "Instagram Repost [Real Accounts]", rate: 15, min: 5, max: 10000 },
  ],
  comments: [
    { id: 7001, name: "Instagram Comments [Custom, Real]", rate: 25, min: 5, max: 5000 },
    { id: 7002, name: "Instagram Comments [Emoji, Fast]", rate: 15, min: 10, max: 10000 },
  ],
  share: [
    { id: 8001, name: "Instagram Shares [Real]", rate: 8, min: 10, max: 20000 },
  ],
  save: [
    { id: 9001, name: "Instagram Saves [Real]", rate: 10, min: 10, max: 20000 },
  ],
};

let CATALOG = DEMO_CATALOG;
let ORDER_MODE = "auto";
let PROFILES = []; // [{ id, name, baseUrl, apiKey, connected, catalog }]
let PANEL = { baseUrl: "", apiKey: "", connected: false }; // "primary" profile — used by Manual tab

const PROFILES_KEY = "madara_panel_profiles";
const ACTIVE_PROFILE_KEY = "madara_panel_active_profile";
let ACTIVE_PROFILE_ID = (() => { try { return localStorage.getItem(ACTIVE_PROFILE_KEY) || ""; } catch { return ""; } })();

function saveProfiles() {
  try {
    const toSave = PROFILES.map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey }));
    localStorage.setItem(PROFILES_KEY, JSON.stringify(toSave));
  } catch {
    /* storage unavailable — ignore */
  }
}

function loadProfilesFromStorage() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ==========================================
// BUILT-IN DELIVERY CURVES (20 points each, weight 0-100)
// ==========================================
const GRAPH_PRESETS = {
  steady: { name: "Steady Drip", points: Array(20).fill(50) },
  burst: { name: "Instant Burst", points: [95,90,84,78,72,65,58,52,46,40,34,29,24,20,16,13,10,8,6,5] },
  late: { name: "Late Spike", points: [5,6,8,10,13,16,20,24,29,34,40,46,52,58,65,72,78,84,90,95] },
  organic1: { name: "Organic — Morning Rise", points: [8,10,14,20,28,38,50,62,72,80,85,88,88,85,80,74,68,62,58,55] },
  organic2: { name: "Organic — Evening Wave", points: [15,25,35,45,40,30,22,18,22,30,42,55,68,80,90,88,78,65,50,38] },
};

// ==========================================
// SAVED CUSTOM GRAPHS (persisted in localStorage)
// ==========================================
const CUSTOM_GRAPHS_KEY = "madara_panel_custom_graphs";

function loadSavedGraphs() {
  try {
    const raw = localStorage.getItem(CUSTOM_GRAPHS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSavedGraphs(list) {
  try {
    localStorage.setItem(CUSTOM_GRAPHS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — ignore */
  }
}

let SAVED_GRAPHS = loadSavedGraphs();

// ==========================================
// DELIVERY HISTORY (persisted per link, 7-day rolling window)
// ==========================================
const HISTORY_KEY = "madara_panel_history";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Automatically purge legacy history keys on fresh load
try {
  localStorage.removeItem("km_panel_history");
  localStorage.removeItem("km_panel_profiles");
  localStorage.removeItem("km_panel_custom_graphs");
} catch (e) {}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable — ignore */
  }
}

function pruneOldHistory() {
  const history = loadHistory();
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  let changed = false;

  Object.keys(history).forEach((link) => {
    const before = history[link].length;
    history[link] = history[link].filter((entry) => entry.timestamp >= cutoff);
    if (history[link].length !== before) changed = true;
    if (history[link].length === 0) {
      delete history[link];
      changed = true;
    }
  });

  if (changed) saveHistory(history);
}

function recordDelivery(link, category, amount) {
  if (!link) return;
  const history = loadHistory();
  if (!history[link]) history[link] = [];
  history[link].push({ category, amount, timestamp: Date.now() });
  saveHistory(history);
}

function getHistoryForLink(link) {
  const history = loadHistory();
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const entries = history[link] || [];
  return entries.filter((entry) => entry.timestamp >= cutoff);
}

// ==========================================
// ELEMENT REFERENCES
// ==========================================
const servicesContainer = document.getElementById("servicesContainer");
const extraServicesContainer = document.getElementById("extraServicesContainer");
const extraServicesHead = document.getElementById("extraServicesHead");
const extraServicesCount = document.getElementById("extraServicesCount");
const addServiceBtn = document.getElementById("addServiceBtn");
const serviceTemplate = document.getElementById("serviceTemplate");

const totalQtyEl = document.getElementById("totalQty");
const totalCostEl = document.getElementById("totalCost");
const balanceValueEl = document.getElementById("balanceValue");

const activityLogTableEl = document.getElementById("activityLogTable");
const ordersListEl = document.getElementById("ordersList");
const refreshActivityBtn = document.getElementById("refreshActivityBtn");
const logsList = document.getElementById("logsList");

const tabButtons = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".panel");

const presetsBtn = document.getElementById("presetsBtn");
const submitOrderBtn = document.getElementById("submitOrderBtn");
const orderStatusEl = document.getElementById("orderStatus");

const apiBaseUrlInput = document.getElementById("apiBaseUrl");
const apiKeyInputEl = document.getElementById("apiKeyInput");
const connectBtn = document.getElementById("connectBtn");
const connectStatusEl = document.getElementById("connectStatus");
const fetchedServicesListEl = document.getElementById("fetchedServicesList");

const graphModal = document.getElementById("graphModal");
const closeGraphModal = document.getElementById("closeGraphModal");
const saveGraphBtn = document.getElementById("saveGraphBtn");
const customGraphSvg = document.getElementById("customGraphSvg");
const customGraphNameInput = document.getElementById("customGraphName");

const trackerLinkInput = document.getElementById("trackerLink");
const trackBtn = document.getElementById("trackBtn");
const trackerEmptyEl = document.getElementById("trackerEmpty");

const schedulesLocked = document.getElementById("schedulesLocked");
const schedulesContent = document.getElementById("schedulesContent");
const schedulesPasswordInput = document.getElementById("schedulesPassword");
const unlockSchedulesBtn = document.getElementById("unlockSchedulesBtn");
const lockErrorEl = document.getElementById("lockError");

const SCHEDULES_PASSWORD = "010";

let slotCounter = 0;
const logEntries = [];
let editingCard = null;

// ==========================================
// TABS
// ==========================================
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "logs") renderDeliveryHistory();
    if (btn.dataset.tab === "schedules" && schedulesContent.style.display === "block") {
      loadOrders();
      loadActivityLog();
    }
  });
});

async function renderDeliveryHistory() {
  const el = document.getElementById("deliveryHistoryList");
  el.innerHTML = `<div class="summary-empty">Loading...</div>`;

  const history = loadHistory();
  const cutoff = Date.now() - SEVEN_DAYS_MS;

  const flat = [];
  Object.keys(history).forEach((link) => {
    history[link].forEach((entry) => {
      if (entry.timestamp >= cutoff) flat.push({ ...entry, link });
    });
  });

  try {
    const res = await fetch(`${PROXY_ORIGIN}/delivered-log`);
    if (res.ok) {
      const serverEntries = await res.json();
      flat.push(...serverEntries);
    }
  } catch {
    // server unreachable — local history still shows below
  }

  flat.sort((a, b) => b.timestamp - a.timestamp);

  if (flat.length === 0) {
    el.innerHTML = `<div class="summary-empty">No deliveries recorded yet.</div>`;
    return;
  }

  el.innerHTML = flat
    .slice(0, 100)
    .map((entry) => {
      const time = new Date(entry.timestamp).toLocaleString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      return `
        <div class="log-row">
          <span class="log-time">${time}</span>
          <span class="log-text">${entry.amount.toLocaleString()} ${capitalize(entry.category)} → ${entry.link}</span>
        </div>
      `;
    })
    .join("");
}

// ==========================================
// LOGGING
// ==========================================
function addLog(message) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  logEntries.unshift({ time, message });
  renderLogs();
}

function renderLogs() {
  if (logEntries.length === 0) {
    logsList.innerHTML = `<div class="summary-empty">No activity yet.</div>`;
    return;
  }
  logsList.innerHTML = logEntries
    .map((entry) => `
      <div class="log-row">
        <span class="log-time">${entry.time}</span>
        <span class="log-text">${entry.message}</span>
      </div>
    `)
    .join("");
}

// ==========================================
// PANEL CALL — always through the hardcoded proxy
// ==========================================
async function callPanelAPI(baseUrl, apiKey, actionParams) {
  const params = { key: apiKey, ...actionParams };
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, params }),
  });

  let data;
  const responseText = await res.text();
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    let preview = responseText.slice(0, 240).replace(/\s+/g, " ");
    if (apiKey) preview = preview.split(apiKey).join("[redacted]");
    throw new Error(`Proxy returned non-JSON data (HTTP ${res.status}): ${preview || res.statusText}`);
  }

  if (data && data.code === "UPSTREAM_TIMEOUT") {
    const timeoutSeconds = Number(data.timeoutMs) > 0 ? Math.round(Number(data.timeoutMs) / 1000) : 30;
    const action = data.action || actionParams.action || "request";
    const providerName = data.provider === "organic-smm" || /\/functions\/v1\/public-api\/?$/i.test(new URL(baseUrl).pathname)
      ? "Organic SMM API"
      : "Provider API";
    const timeoutError = new Error(
      `${providerName} timed out during the "${action}" action after ${timeoutSeconds} seconds. This is an upstream timeout, not proof that the API key is invalid. Ask the provider to verify API availability and access from your Render server.`
    );
    timeoutError.code = "UPSTREAM_TIMEOUT";
    throw timeoutError;
  }

  const details = data && typeof data === "object" ? data.details : null;
  const providerMessage =
    (data && (data.error || data.message || (data.success === false && data.error_description))) ||
    (details && typeof details === "object" && (details.error || details.message || details.msg)) ||
    (typeof details === "string" ? details : "");
  const failedStatus = data && typeof data.status === "string" && data.status.toLowerCase() === "error";

  if (!res.ok || providerMessage || (data && data.success === false) || failedStatus) {
    let message = providerMessage || `HTTP ${res.status} ${res.statusText}`;
    if (typeof details === "string" && details && details !== message) message += ` — ${details}`;
    else if (details && typeof details === "object") {
      const detailText = details.error || details.message || details.msg;
      if (detailText && detailText !== message) message += ` — ${detailText}`;
    }
    if (apiKey) message = message.split(apiKey).join("[redacted]");
    throw new Error(message.slice(0, 500));
  }
  return data;
}

// ==========================================
// PANEL CONNECT
// ==========================================
connectBtn.addEventListener("click", () => {
  const name = document.getElementById("profileNameInput").value.trim() || `Panel ${PROFILES.length + 1}`;
  attemptConnect(name, apiBaseUrlInput.value.trim(), apiKeyInputEl.value.trim(), false);
});

async function attemptConnect(name, baseUrl, apiKey, silent) {
  if (!baseUrl) {
    if (!silent) {
      connectStatusEl.textContent = "Enter the panel's API URL first.";
      connectStatusEl.className = "connect-status error";
    }
    return;
  }

  if (!silent) {
    connectStatusEl.textContent = "Connecting...";
    connectStatusEl.className = "connect-status";
  }

  try {
    const balanceData = await callPanelAPI(baseUrl, apiKey, { action: "balance" });
    const servicesResponse = await callPanelAPI(baseUrl, apiKey, { action: "services" });
    // Organic SMM returns { status: "ok", services: [...] }; traditional panels
    // often return the services as a raw array. Accept both response shapes.
    const servicesData = Array.isArray(servicesResponse)
      ? servicesResponse
      : (servicesResponse && Array.isArray(servicesResponse.services)
        ? servicesResponse.services
        : null);
    if (!Array.isArray(servicesData)) {
      const message = servicesResponse && (servicesResponse.error || servicesResponse.message)
        ? (servicesResponse.error || servicesResponse.message)
        : 'Provider returned an invalid services response.';
      throw new Error(message);
    }

    const currency = balanceData && balanceData.currency ? balanceData.currency : "$";
    const balanceText = balanceData && balanceData.balance !== undefined
      ? `${currency}${parseFloat(balanceData.balance).toFixed(2)}`
      : "Balance unavailable";

    const profileCatalog = groupServicesByCategory(servicesData);
    Object.keys(profileCatalog).forEach((cat) => {
      profileCatalog[cat].forEach((svc) => {
        svc._baseUrl = baseUrl;
        svc._apiKey = apiKey;
      });
    });

    let profile = PROFILES.find((p) => p.baseUrl === baseUrl && p.apiKey === apiKey);
    if (profile) {
      profile.name = name;
      profile.connected = true;
      profile.catalog = profileCatalog;
      profile.balanceText = balanceText;
    } else {
      profile = { id: `profile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, baseUrl, apiKey, connected: true, catalog: profileCatalog, balanceText };
      PROFILES.push(profile);
    }

    const shouldActivate = !silent ||
      (ACTIVE_PROFILE_ID && profile.id === ACTIVE_PROFILE_ID) ||
      (!PANEL.connected && !ACTIVE_PROFILE_ID);
    if (shouldActivate) setActiveProfile(profile, true);

    saveProfiles();
    renderProfilesList();
    if (PANEL.baseUrl === baseUrl && PANEL.apiKey === apiKey) {
      renderFetchedServices(servicesData);
      rebuildAllCategoryDropdowns();
      renderFixedCards();
      refreshAutoTab();
      connectStatusEl.textContent = `Connected "${name}" — balance and services loaded.`;
      connectStatusEl.className = "connect-status ok";
    }
    addLog(`Connected to panel "${name}" at ${baseUrl}`);
  } catch (err) {
    if (!silent) {
      connectStatusEl.textContent = err.code === "UPSTREAM_TIMEOUT"
        ? err.message
        : `Couldn\'t get a valid response from that panel (${err.message}). Double-check the URL/key and try again.`;
      connectStatusEl.className = "connect-status error";
    }
    addLog(`Connect failed for ${baseUrl}${silent ? " (auto-reconnect)" : ""}`);
  }
}

function mergeAllProfileCatalogs() {
  const merged = {};
  PROFILES.filter((p) => p.connected).forEach((p) => {
    Object.keys(p.catalog || {}).forEach((cat) => {
      if (!merged[cat]) merged[cat] = [];
      merged[cat] = merged[cat].concat(p.catalog[cat]);
    });
  });
  return Object.keys(merged).length > 0 ? merged : DEMO_CATALOG;
}

function setActiveProfile(profile, updateInputs = true) {
  if (!profile) return;
  PANEL = { baseUrl: profile.baseUrl, apiKey: profile.apiKey, connected: Boolean(profile.connected) };
  ACTIVE_PROFILE_ID = profile.id;
  try { localStorage.setItem(ACTIVE_PROFILE_KEY, ACTIVE_PROFILE_ID); } catch {}
  CATALOG = profile.connected && Object.keys(profile.catalog || {}).length ? profile.catalog : DEMO_CATALOG;
  balanceValueEl.textContent = profile.balanceText || "—";
  if (updateInputs) {
    document.getElementById("profileNameInput").value = profile.name || "";
    apiBaseUrlInput.value = profile.baseUrl || '';
    apiKeyInputEl.value = profile.apiKey || '';
  }
  const services = Object.values(profile.catalog || {}).flat().map((svc) => ({ service: svc.id, name: svc.name, rate: svc.rate }));
  renderFetchedServices(services);
}

function renderProfilesList() {
  const el = document.getElementById("profilesList");
  if (!el) return;
  el.replaceChildren();
  if (PROFILES.length === 0) {
    const empty = document.createElement("div");
    empty.className = "summary-empty";
    empty.textContent = "No panels saved yet — connect one above.";
    el.appendChild(empty);
    return;
  }

  PROFILES.forEach((profile) => {
    const row = document.createElement("div");
    row.className = "profile-row";
    const details = document.createElement("div");
    details.className = "profile-details";
    const name = document.createElement("b");
    name.textContent = profile.name || "Unnamed panel";
    const url = document.createElement("span");
    url.className = "profile-url";
    url.textContent = profile.baseUrl;
    const balance = document.createElement("span");
    balance.className = "profile-balance";
    balance.textContent = profile.connected ? (profile.balanceText || "Balance unavailable") : "Not connected";
    details.append(name, url, balance);
    const actions = document.createElement("div");
    actions.className = "profile-actions";
    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "profile-use-btn";
    const isActive = PANEL.baseUrl === profile.baseUrl && PANEL.apiKey === profile.apiKey && PANEL.connected;
    useButton.textContent = isActive ? "Active" : "Use";
    useButton.disabled = isActive || !profile.connected;
    useButton.addEventListener("click", () => {
      setActiveProfile(profile, true);
      renderProfilesList();
      rebuildAllCategoryDropdowns();
      renderFixedCards();
      refreshAutoTab();
      connectStatusEl.textContent = `Using "${profile.name}" — ${profile.balanceText || "balance unavailable"}.`;
      connectStatusEl.className = "connect-status ok";
      addLog(`Switched active panel to "${profile.name}"`);
    });
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "profile-remove-btn";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      const removedActive = PANEL.baseUrl === profile.baseUrl && PANEL.apiKey === profile.apiKey;
      PROFILES = PROFILES.filter((item) => item.id !== profile.id);
      if (removedActive) {
        const replacement = [...PROFILES].reverse().find((item) => item.connected);
        if (replacement) {
          setActiveProfile(replacement, true);
        } else {
          PANEL = { baseUrl: "", apiKey: "", connected: false };
          ACTIVE_PROFILE_ID = "";
          try { localStorage.removeItem(ACTIVE_PROFILE_KEY); } catch {}
          CATALOG = DEMO_CATALOG;
          balanceValueEl.textContent = "—";
          apiBaseUrlInput.value = "";
          apiKeyInputEl.value = "";
          fetchedServicesListEl.textContent = "No panel connected — connect a panel above.";
        }
      }
      if (!removedActive) {
        const active = PROFILES.find((item) => item.baseUrl === PANEL.baseUrl && item.apiKey === PANEL.apiKey);
        if (active) CATALOG = active.catalog || DEMO_CATALOG;
      }
      saveProfiles();
      renderProfilesList();
      rebuildAllCategoryDropdowns();
      renderFixedCards();
      refreshAutoTab();
      addLog(`Removed saved panel "${profile.name}"`);
    });
    actions.append(useButton, removeButton);
    row.append(details, actions);
    el.appendChild(row);
  });
}

function groupServicesByCategory(list) {
  const groups = {};
  list.forEach((svc) => {
    const haystack = `${svc.name || ""} ${svc.category || ""} ${svc.type || ""}`.toLowerCase();
    let bucket = "other";
    if (haystack.includes("view")) bucket = "views";
    else if (haystack.includes("like")) bucket = "likes";
    else if (haystack.includes("follow")) bucket = "followers";
    else if (haystack.includes("comment")) bucket = "comments";
    else if (haystack.includes("share") || haystack.includes("repost")) bucket = "repost";

    if (!groups[bucket]) groups[bucket] = [];
    groups[bucket].push({
      id: svc.service,
      name: svc.name,
      rate: parseFloat(svc.rate) || 0.01,
      min: parseInt(svc.min, 10) || 1,
      max: parseInt(svc.max, 10) || 1000000,
    });
  });
  return groups;
}

function renderFetchedServices(list) {
  if (list.length === 0) {
    fetchedServicesListEl.innerHTML = `<div class="summary-empty">Panel returned no services.</div>`;
    return;
  }
  fetchedServicesListEl.innerHTML = list
    .slice(0, 40)
    .map(
      (svc) => `
      <div class="fetched-service-row">
        <span>#${svc.service} — ${svc.name}</span>
        <span class="mono">$${svc.rate}/1000</span>
      </div>
    `
    )
    .join("");
}

function rebuildAllCategoryDropdowns() {
  getAllServiceCards().forEach((card) => {
    populateCategorySelect(card.querySelector(".category-select"));
  });
  refreshEverything();
}

function populateCategorySelect(select) {
  const previous = select.value;
  select.innerHTML = Object.keys(CATALOG)
    .map((cat) => `<option value="${cat}">${capitalize(cat)}</option>`)
    .join("");
  if (Object.keys(CATALOG).includes(previous)) select.value = previous;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatRate(rate) {
  const n = parseFloat(rate) || 0;
  return n < 0.01 ? n.toFixed(4) : n.toFixed(3);
}

function formatCost(cost) {
  return cost > 0 && cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

// ==========================================
// GRAPH SELECT (built-in presets + saved custom curves)
// ==========================================
function populateGraphSelect(select, currentValue) {
  const builtIns = Object.entries(GRAPH_PRESETS)
    .map(([key, preset]) => `<option value="${key}">${preset.name}</option>`)
    .join("");

  const savedOptions = SAVED_GRAPHS.map(
    (g, i) => `<option value="saved_${i}">💾 ${g.name}</option>`
  ).join("");

  select.innerHTML =
    builtIns +
    (savedOptions ? `<optgroup label="My saved curves">${savedOptions}</optgroup>` : "") +
    `<option value="custom">Custom (edit below)</option>`;

  if (currentValue) select.value = currentValue;
}

function refreshAllGraphSelects() {
  getAllServiceCards().forEach((card) => {
    card.querySelectorAll(".graph-select").forEach((select) => {
      populateGraphSelect(select, select.value);
    });
  });
}

function getAllServiceCards() {
  return [
    ...servicesContainer.querySelectorAll(".service-card"),
    ...extraServicesContainer.querySelectorAll(".service-card"),
  ];
}

// ==========================================
// CREATE A NEW SERVICE SLOT
// ==========================================
function createServiceSlot() {
  slotCounter += 1;

  const fragment = serviceTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".service-card");
  card.dataset.id = slotCounter;
  card.dataset.selectedServiceId = "";
  card.dataset.selectedRate = "0";
  card.dataset.selectedMin = "1";
  card.dataset.selectedMax = "1000000";
  card.customGraphPoints = null;

  const isFirstSlot = servicesContainer.children.length === 0;
  if (isFirstSlot) {
    servicesContainer.appendChild(card);
  } else {
    extraServicesContainer.appendChild(card);
  }
  card.querySelector(".slot-label").textContent = `Slot ${slotCounter}`;

  const categorySelect = card.querySelector(".category-select");
  const searchInput = card.querySelector(".service-search");
  const dropdown = card.querySelector(".service-dropdown");
  const noteEl = card.querySelector(".selected-service-note");
  const qtyInput = card.querySelector(".qty");
  const durationInput = card.querySelector(".duration");
  const randomnessInput = card.querySelector(".randomness");
  const randomnessReadout = card.querySelector(".randomness-readout");
  const graphSelect = card.querySelector(".graph-select");
  const editGraphBtn = card.querySelector(".edit-graph-btn");

  const showLegsToggle = card.querySelector(".show-legs-toggle");

  populateCategorySelect(categorySelect);
  populateGraphSelect(graphSelect, "organic1");

  function renderDropdown(query) {
    const category = categorySelect.value;
    const list = CATALOG[category] || [];
    const q = (query || "").toLowerCase().trim();
    const filtered = list.filter(
      (svc) => !q || String(svc.id).includes(q) || svc.name.toLowerCase().includes(q)
    );

    dropdown.innerHTML = filtered.length
      ? filtered
          .map(
            (svc) => `
            <div class="service-option" data-id="${svc.id}" data-rate="${svc.rate}" data-name="${svc.name}" data-min="${svc.min}" data-max="${svc.max}" data-base-url="${encodeURIComponent(svc._baseUrl || "")}">
              <span class="opt-id">#${svc.id}</span>${svc.name}
              <span class="opt-rate">$${formatRate(svc.rate)}/1000</span>
              <br><span class="opt-limits">Min ${svc.min.toLocaleString()} · Max ${svc.max.toLocaleString()}</span>
            </div>
          `
          )
          .join("")
      : `<div class="service-option">No matching services</div>`;
    dropdown.classList.add("open");
  }

  function selectService(id, rate, name, min, max, baseUrl) {
    card.dataset.selectedServiceId = id;
    card.dataset.selectedRate = rate;
    card.dataset.selectedMin = min;
    card.dataset.selectedMax = max;
    card._selectedProvider = {
      baseUrl: baseUrl ? decodeURIComponent(baseUrl) : "",
    };
    searchInput.value = `#${id} — ${name}`;
    noteEl.innerHTML = `Selected: ${name} · $${formatRate(rate)}/1000<br><b>Min ${parseInt(min).toLocaleString()} · Max ${parseInt(max).toLocaleString()}</b>`;
    noteEl.classList.add("filled");
    dropdown.classList.remove("open");
    refreshEverything();
  }

  searchInput.addEventListener("focus", () => renderDropdown(searchInput.value));
  searchInput.addEventListener("input", () => renderDropdown(searchInput.value));

  document.addEventListener("click", (e) => {
    if (!card.contains(e.target)) dropdown.classList.remove("open");
  });

  dropdown.addEventListener("click", (e) => {
    const opt = e.target.closest(".service-option");
    if (!opt || !opt.dataset.id) return;
    selectService(
      opt.dataset.id,
      opt.dataset.rate,
      opt.dataset.name,
      opt.dataset.min,
      opt.dataset.max,
      opt.dataset.baseUrl || ""
    );
  });

  categorySelect.addEventListener("change", () => {
    card.dataset.selectedServiceId = "";
    card.dataset.selectedRate = "0";
    card.dataset.selectedMin = "1";
    card.dataset.selectedMax = "1000000";
    card._selectedProvider = null;
    searchInput.value = "";
    noteEl.textContent = "No service selected yet";
    noteEl.classList.remove("filled");
    refreshEverything();
  });

  randomnessInput.addEventListener("input", () => {
    const value = parseInt(randomnessInput.value, 10);
    randomnessReadout.textContent = value >= 40 ? "40% (Full Random)" : `${value}%`;
    refreshEverything();
  });

  [qtyInput, durationInput, graphSelect].forEach((input) => {
    input.addEventListener("input", () => refreshEverything());
    input.addEventListener("change", () => refreshEverything());
  });

  editGraphBtn.addEventListener("click", () => openGraphModal(card));
  showLegsToggle.addEventListener("change", () => refreshEverything());

  card.querySelector(".remove-btn").addEventListener("click", () => {
    card.remove();
    addLog(`Removed slot ${card.dataset.id}`);
    updateExtraServicesHeader();
    refreshEverything();
  });

  updateCardPreview(card);
  updateExtraServicesHeader();
  addLog(`Added slot ${slotCounter}`);
}

function updateExtraServicesHeader() {
  const count = extraServicesContainer.children.length;
  extraServicesHead.style.display = count > 0 ? "flex" : "none";
  extraServicesCount.textContent = count > 0 ? `(${count})` : "";
  if (count === 0) extraServicesContainer.style.display = "none";
}

const extraServicesToggleBtn = document.getElementById("extraServicesToggle");
extraServicesToggleBtn.addEventListener("click", () => {
  const isOpen = extraServicesContainer.style.display === "flex";
  extraServicesContainer.style.display = isOpen ? "none" : "flex";
  extraServicesToggleBtn.classList.toggle("open", !isOpen);
});

// ==========================================
// AUTO TAB — fixed 6-service toggle cards
// Fully automatic: quantity/legs/duration/service-pool are all computed,
// matching the reference panel's engagement-ratio formulas.
// ==========================================
const FIXED_SERVICES = [
  { key: "views", emoji: "👁", label: "Views", primary: true, defaultOn: true, defaultQty: 5000 },
  { key: "likes", emoji: "❤️", label: "Like", defaultOn: true },
  { key: "share", emoji: "📤", label: "Share" },
  { key: "save", emoji: "🔖", label: "Save" },
  { key: "comments", emoji: "💬", label: "Comments" },
  { key: "repost", emoji: "🔁", label: "Repost" },
];

const MIN_VIEWS_QTY_AUTO = 5000;
const ENGAGEMENT_PERCENT = { likes: 0.047, share: 0.034, comments: 0.0023, repost: 0.0057, save: 0.012 };
const VIEWS_LEGS_PER_1000 = 5;
const DEFAULT_MIN_GAP_MIN = 8;
const DEFAULT_MAX_GAP_MIN = 14;

let GAP_MODE = "auto"; // 'auto' (8-14min randomized) or 'manual' (fixed, no jitter)

const autoFixedCardsEl = document.getElementById("autoFixedCards");
const gapAutoBtn = document.getElementById("gapAutoBtn");
const gapManualBtn = document.getElementById("gapManualBtn");
const autoExtraLegsHead = document.getElementById("autoExtraLegsHead");
const autoExtraLegsCount = document.getElementById("autoExtraLegsCount");
const autoExtraLegsToggle = document.getElementById("autoExtraLegsToggle");
const autoExtraLegsList = document.getElementById("autoExtraLegsList");

const legOverrides = {}; // { serviceKey: number|null } manual override from the Extra Services panel

function calcEngagementLegs(qty, slotType) {
  if (!qty || qty <= 0) return 1;
  if (slotType === "comments") return Math.max(1, Math.round((qty / 10) * 7));
  if (slotType === "repost") return Math.max(1, Math.round((qty / 100) * 15));
  return Math.max(1, Math.round((qty / 100) * 7));
}

function autoCalcLegs(qty, minQ, slotType) {
  const safeMin = minQ || 1;
  const maxPossible = Math.max(1, Math.floor((qty || 0) / safeMin));
  if (maxPossible <= 1) {
    if (slotType === "repost" && (qty || 0) >= safeMin * 2) return 2;
    return 1;
  }
  return Math.max(1, Math.min(calcEngagementLegs(qty, slotType), maxPossible));
}

function getActiveGapRange() {
  return GAP_MODE === "manual"
    ? { min: DEFAULT_MIN_GAP_MIN, max: DEFAULT_MIN_GAP_MIN }
    : { min: DEFAULT_MIN_GAP_MIN, max: DEFAULT_MAX_GAP_MIN };
}

function getServicePool(key) {
  if (PANEL.connected && CATALOG[key] && CATALOG[key].length > 0) {
    return CATALOG[key];
  }
  const manualSelect = document.getElementById(`manualSvc-${key}`);
  if (manualSelect && manualSelect.value) {
    const chosen = (DEMO_CATALOG[key] || []).find((s) => String(s.id) === manualSelect.value);
    if (chosen) return [chosen];
  }
  return DEMO_CATALOG[key] || [];
}

function renderFixedCards() {
  autoFixedCardsEl.innerHTML = FIXED_SERVICES.map((svc) => {
    const showManualPicker = !PANEL.connected;
    const demoOptions = (DEMO_CATALOG[svc.key] || [])
      .map((s) => `<option value="${s.id}">${s.name}</option>`)
      .join("");

    const manualPickerHtml = showManualPicker
      ? `
        <label class="field">
          <span class="field-label">Service (no panel connected — pick one)</span>
          <select class="input full manual-svc-select" id="manualSvc-${svc.key}">${demoOptions}</select>
        </label>
      `
      : `<div class="auto-service-note" id="autoServiceNote-${svc.key}"></div>`;

    return `
      <div class="fixed-svc-card ${svc.defaultOn ? "" : "disabled"}" id="svcCard-${svc.key}" style="--tc:${colorForCategory(svc.key)}">
        <div class="fixed-svc-head">
          <span class="fixed-svc-badge">${svc.emoji} ${svc.label}${svc.primary ? '<span class="fixed-svc-primary-tag">PRIMARY</span>' : ""}</span>
          <label class="svc-toggle">
            <input type="checkbox" class="svc-enable-toggle" data-key="${svc.key}" ${svc.defaultOn ? "checked" : ""}>
            <span class="svc-toggle-track"></span>
          </label>
        </div>
        <div class="fixed-svc-body">
          <label class="field">
            <span class="field-label">Quantity${svc.primary ? "" : " (auto-filled from Views — editable)"}</span>
            <input class="input full auto-qty" type="number" min="1" value="${svc.defaultQty || ""}" placeholder="${svc.primary ? "" : "auto"}">
          </label>
          ${manualPickerHtml}
          <div class="min-warning-line" id="minWarn-${svc.key}"></div>
        </div>
      </div>
    `;
  }).join("");

  FIXED_SERVICES.forEach((svc) => {
    const card = document.getElementById(`svcCard-${svc.key}`);
    const toggle = card.querySelector(".svc-enable-toggle");
    const qtyInput = card.querySelector(".auto-qty");
    const manualSelect = card.querySelector(".manual-svc-select");

    toggle.addEventListener("change", () => {
      card.classList.toggle("disabled", !toggle.checked);
      refreshAutoTab();
    });

    if (svc.primary) {
      qtyInput.addEventListener("input", () => refreshAutoTab());
    } else {
      qtyInput.addEventListener("input", () => {
        qtyInput.dataset.userEdited = "1";
        refreshAutoTab();
      });
    }

    if (manualSelect) manualSelect.addEventListener("change", () => refreshAutoTab());
  });
}

gapAutoBtn.addEventListener("click", () => {
  GAP_MODE = "auto";
  gapAutoBtn.classList.add("active");
  gapManualBtn.classList.remove("active");
  Object.keys(legOverrides).forEach((k) => delete legOverrides[k]);
  refreshAutoTab();
});
gapManualBtn.addEventListener("click", () => {
  GAP_MODE = "manual";
  gapManualBtn.classList.add("active");
  gapAutoBtn.classList.remove("active");
  Object.keys(legOverrides).forEach((k) => delete legOverrides[k]);
  refreshAutoTab();
});

autoExtraLegsToggle.addEventListener("click", () => {
  const isOpen = autoExtraLegsList.style.display === "flex";
  autoExtraLegsList.style.display = isOpen ? "none" : "flex";
  autoExtraLegsToggle.classList.toggle("open", !isOpen);
});

function getFixedServiceInputs(key) {
  const card = document.getElementById(`svcCard-${key}`);
  return {
    card,
    enabled: card.querySelector(".svc-enable-toggle").checked,
    qtyInput: card.querySelector(".auto-qty"),
    qty: Math.max(0, parseInt(card.querySelector(".auto-qty").value, 10) || 0),
  };
}

function assignRoundRobin(pool, count) {
  return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
}

function generateAutoLegs(quantity, legsCount, totalMinutes, gapMode, minQty) {
  const variance = gapMode === "manual" ? 0 : 22;
  const base = Math.floor(quantity / legsCount);
  let remaining = quantity;
  let legs = [];

  for (let i = 0; i < legsCount; i++) {
    const isLast = i === legsCount - 1;
    let amount = isLast ? remaining : base;
    if (!isLast && variance > 0) amount = Math.max(0, Math.round(jitter(amount, variance)));
    remaining -= isLast ? 0 : amount;

    let minutesAt = legsCount > 1 ? (i / (legsCount - 1)) * totalMinutes : 0;
    if (variance > 0 && i > 0 && !isLast) {
      const avgGap = totalMinutes / (legsCount - 1 || 1);
      minutesAt += (Math.random() * 2 - 1) * avgGap * (variance / 40);
    }
    minutesAt = Math.max(0, Math.round(minutesAt));

    legs.push({ index: i + 1, amount, minutesAt });
  }

  legs = legs.filter((l) => l.amount > 0);
  legs.sort((a, b) => a.minutesAt - b.minutesAt);
  legs.forEach((l, idx) => (l.index = idx + 1));

  const sumSoFar = legs.reduce((a, l) => a + l.amount, 0);
  if (legs.length > 0) legs[legs.length - 1].amount += quantity - sumSoFar;

  legs = enforceMinimum(legs, minQty);
  return legs;
}

function refreshAutoTab() {
  const viewsState = getFixedServiceInputs("views");
  const viewsPool = getServicePool("views");
  const viewsMinQty = Math.max(...viewsPool.map((s) => s.min), 1);

  const viewsNoteEl = document.getElementById("autoServiceNote-views");
  if (viewsNoteEl) {
    viewsNoteEl.textContent =
      viewsPool.length > 1
        ? `🔀 Auto round-robin across ${viewsPool.length} connected services`
        : viewsPool.length === 1
        ? `Using: ${viewsPool[0].name}`
        : "";
  }

  document.getElementById("minWarn-views").textContent =
    viewsState.qty > 0 && viewsState.qty < MIN_VIEWS_QTY_AUTO
      ? `⚠️ Below the ${MIN_VIEWS_QTY_AUTO.toLocaleString()} minimum — it'll be rounded up to ${MIN_VIEWS_QTY_AUTO.toLocaleString()} when the order is created.`
      : "";

  let viewsLegs = [];
  let totalMinutes = 0;
  const gapRange = getActiveGapRange();

  if (viewsState.enabled && viewsState.qty > 0) {
    const effectiveQty = Math.max(viewsState.qty, MIN_VIEWS_QTY_AUTO);
    const legsCount = Math.max(1, Math.min(250, Math.round((effectiveQty / 1000) * VIEWS_LEGS_PER_1000)));
    totalMinutes = Math.ceil(gapRange.min * legsCount * 1.3);

    viewsLegs = generateAutoLegs(effectiveQty, legsCount, totalMinutes, GAP_MODE, viewsMinQty);
    const assigned = assignRoundRobin(viewsPool, viewsLegs.length);
    viewsLegs = viewsLegs.map((l, i) => ({ ...l, serviceLabel: "Views", category: "views", serviceId: assigned[i].id, baseUrl: assigned[i]._baseUrl, apiKey: assigned[i]._apiKey }));
  }

  let allLegs = [...viewsLegs];
  const extraOverrideRows = [];

  FIXED_SERVICES.filter((s) => !s.primary).forEach((svc) => {
    const state = getFixedServiceInputs(svc.key);
    const pool = getServicePool(svc.key);
    const minQty = Math.max(...pool.map((s) => s.min), 1);

    const noteEl = document.getElementById(`autoServiceNote-${svc.key}`);
    if (noteEl) {
      noteEl.textContent =
        pool.length > 1
          ? `🔀 Auto round-robin across ${pool.length} connected services`
          : pool.length === 1
          ? `Using: ${pool[0].name}`
          : "";
    }

    if (!state.qtyInput.dataset.userEdited && viewsState.qty > 0) {
      const basePct = ENGAGEMENT_PERCENT[svc.key] || 0.01;
      const baseQty = Math.round(viewsState.qty * basePct);
      const randomizedQty = Math.max(1, Math.round(jitter(baseQty, 20)));
      state.qtyInput.value = randomizedQty;
      state.qty = randomizedQty;
    }

    document.getElementById(`minWarn-${svc.key}`).textContent =
      state.qty > 0 && state.qty < minQty ? `⚠️ Below minimum (${minQty.toLocaleString()}) for this service.` : "";

    if (!state.enabled || state.qty <= 0 || viewsLegs.length === 0) return;

    let legsCount = autoCalcLegs(state.qty, minQty, svc.key);
    const override = legOverrides[svc.key];
    if (override) legsCount = Math.min(override, legsCount);

    const result = generateSyncedLegsWithReduction(
      state.qty,
      minQty,
      viewsLegs.length > legsCount
        ? viewsLegs.filter((_, i) => i % Math.ceil(viewsLegs.length / legsCount) === 0).slice(0, legsCount)
        : viewsLegs
    );
    let legs = result.legs;

    const assigned2 = assignRoundRobin(pool, legs.length);
    legs = legs.map((l, i) => ({ ...l, serviceLabel: capitalize(svc.key), category: svc.key, serviceId: assigned2[i].id, baseUrl: assigned2[i]._baseUrl, apiKey: assigned2[i]._apiKey }));
    allLegs = allLegs.concat(legs);

    const naturalMax = Math.max(1, Math.floor(state.qty / minQty));
    if (naturalMax < viewsLegs.length) {
      extraOverrideRows.push({ key: svc.key, label: svc.label, emoji: svc.emoji, max: naturalMax, current: legs.length });
    } else {
      delete legOverrides[svc.key];
    }
  });

  if (extraOverrideRows.length > 0) {
    autoExtraLegsHead.style.display = "flex";
    autoExtraLegsCount.textContent = `(${extraOverrideRows.length})`;
    autoExtraLegsList.innerHTML = extraOverrideRows
      .map((row) => {
        const options = Array.from({ length: row.max }, (_, i) => i + 1)
          .map((n) => `<option value="${n}" ${n === row.current ? "selected" : ""}>${n}</option>`)
          .join("");
        return `
          <div class="svc-leg-select-row">
            <span>${row.emoji} ${row.label} <span style="color:#ffb42d;font-weight:600;">(max ${row.max})</span></span>
            <select data-key="${row.key}" class="leg-override-select">${options}</select>
          </div>
        `;
      })
      .join("");

    autoExtraLegsList.querySelectorAll(".leg-override-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        legOverrides[sel.dataset.key] = parseInt(sel.value, 10);
        refreshAutoTab();
      });
    });
  } else {
    Object.keys(legOverrides).forEach((k) => delete legOverrides[k]);
    autoExtraLegsHead.style.display = "none";
    autoExtraLegsList.style.display = "none";
    autoExtraLegsList.innerHTML = "";
  }

  window._autoTabLegs = allLegs;

  let totalQty = 0;
  let totalCost = 0;
  allLegs.forEach((l) => {
    totalQty += l.amount;
    const pool = CATALOG[l.category] || DEMO_CATALOG[l.category] || [];
    const rate = pool.length ? pool.reduce((a, s) => a + s.rate, 0) / pool.length : 10;
    totalCost += (l.amount / 1000) * rate;
  });
  totalQtyEl.textContent = totalQty.toLocaleString();
  totalCostEl.textContent = formatCost(totalCost);

  updateGraph(allLegs);
}

function computeAutoTabLegs(link) {
  refreshAutoTab();
  const legs = window._autoTabLegs || [];
  return legs.map((l) => ({
    serviceId: l.serviceId,
    link,
    quantity: l.amount,
    category: l.category,
    serviceLabel: l.serviceLabel,
    baseUrl: l.baseUrl,
    apiKey: l.apiKey,
    fireInMs: l.minutesAt * 60000,
  }));
}

// ==========================================
// LEG GENERATION
// ==========================================
function getCurveForCard(card) {
  const graphSelect = card.querySelector(".graph-select");
  const value = graphSelect.value;

  if (value === "custom") return card.customGraphPoints || Array(20).fill(50);
  if (value.startsWith("saved_")) {
    const idx = parseInt(value.split("_")[1], 10);
    return (SAVED_GRAPHS[idx] && SAVED_GRAPHS[idx].points) || Array(20).fill(50);
  }
  return (GRAPH_PRESETS[value] && GRAPH_PRESETS[value].points) || Array(20).fill(50);
}

function jitter(value, percent) {
  const range = value * (percent / 100);
  return value + (Math.random() * 2 - 1) * range;
}

function enforceMinimum(legs, minQty) {
  if (!minQty || minQty <= 1) return legs;

  let arr = legs.map((l) => ({ ...l }));
  let changed = true;

  while (changed && arr.length > 1) {
    changed = false;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].amount > 0 && arr[i].amount < minQty) {
        const j = i < arr.length - 1 ? i + 1 : i - 1;
        arr[j].amount += arr[i].amount;
        arr.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  arr.forEach((l, idx) => (l.index = idx + 1));
  return arr;
}

function generateSyncedLegsWithReduction(quantity, minQty, referenceLegs) {
  const maxLegsAllowed = minQty > 0 ? Math.max(1, Math.floor(quantity / minQty)) : referenceLegs.length;
  let reference = referenceLegs;
  let reduced = false;
  let neededQtyForFull = null;

  if (maxLegsAllowed < referenceLegs.length) {
    reduced = true;
    neededQtyForFull = minQty * referenceLegs.length;
    const step = referenceLegs.length / maxLegsAllowed;
    reference = [];
    for (let i = 0; i < maxLegsAllowed; i++) {
      reference.push(referenceLegs[Math.min(referenceLegs.length - 1, Math.round(i * step))]);
    }
  }

  const weightSum = reference.reduce((a, l) => a + l.amount, 0) || 1;
  let remaining = quantity;
  let legs = reference.map((refLeg, i) => {
    const isLast = i === reference.length - 1;
    const amount = isLast ? remaining : Math.round((refLeg.amount / weightSum) * quantity);
    remaining -= isLast ? 0 : amount;
    return { index: i + 1, amount, minutesAt: refLeg.minutesAt };
  });
  legs = legs.filter((l) => l.amount > 0);
  legs = enforceMinimum(legs, minQty);

  return { legs, reduced, fromCount: referenceLegs.length, toCount: legs.length, neededQtyForFull };
}

function resampleCurve(points, targetCount) {
  if (targetCount === points.length) return points;
  const result = [];
  const lastIndex = points.length - 1;
  for (let i = 0; i < targetCount; i++) {
    const pos = (i / Math.max(1, targetCount - 1)) * lastIndex;
    const lower = Math.floor(pos);
    const upper = Math.min(lastIndex, lower + 1);
    const frac = pos - lower;
    result.push(points[lower] * (1 - frac) + points[upper] * frac);
  }
  return result;
}

function generateLegs(quantity, durationHours, randomness, curvePoints, minQty) {
  let legs = [];

  if (randomness >= 40) {
    const totalMinutes = durationHours * 60;
    const maxLegsAllowed = minQty > 0 ? Math.max(1, Math.floor(quantity / minQty)) : 28;
    const legCount = Math.min(maxLegsAllowed, 14 + Math.floor(Math.random() * 14));

    const rawWeights = Array.from({ length: legCount }, () => Math.random() + 0.15);
    const weightSum = rawWeights.reduce((a, b) => a + b, 0);

    const rawTimes = [0];
    for (let i = 1; i < legCount; i++) {
      rawTimes.push(rawTimes[i - 1] + Math.random() * (totalMinutes / legCount) * 1.8);
    }
    const maxTime = rawTimes[rawTimes.length - 1] || 1;
    const times = rawTimes.map((t) => Math.round((t / maxTime) * totalMinutes));

    let remaining = quantity;
    rawWeights.forEach((w, i) => {
      const isLast = i === legCount - 1;
      const amount = isLast ? remaining : Math.max(1, Math.round((w / weightSum) * quantity));
      remaining -= amount;
      legs.push({ index: i + 1, amount: Math.max(0, amount), minutesAt: times[i] });
    });
  } else {
    const maxLegsAllowed = minQty > 0 ? Math.max(1, Math.floor(quantity / minQty)) : 250;
    const effectiveCount = Math.min(250, maxLegsAllowed);
    const usedPoints = resampleCurve(curvePoints, effectiveCount);

    const weightSum = usedPoints.reduce((a, b) => a + b, 0) || 1;
    let remaining = quantity;
    const totalMinutes = durationHours * 60;
    const avgGap = usedPoints.length > 1 ? totalMinutes / (usedPoints.length - 1) : totalMinutes;

    usedPoints.forEach((weight, i) => {
      const isLast = i === usedPoints.length - 1;
      let amount = isLast ? remaining : Math.round((weight / weightSum) * quantity);
      if (!isLast && randomness > 0) {
        amount = Math.max(0, Math.round(jitter(amount, randomness)));
      }
      remaining -= isLast ? 0 : amount;

      let minutesAt = usedPoints.length > 1 ? (i / (usedPoints.length - 1)) * totalMinutes : 0;
      if (randomness > 0 && i > 0 && !isLast) {
        const timeJitterRange = avgGap * (randomness / 40);
        minutesAt += (Math.random() * 2 - 1) * timeJitterRange;
      }
      minutesAt = Math.max(0, Math.round(minutesAt));

      legs.push({ index: i + 1, amount, minutesAt });
    });

    legs.sort((a, b) => a.minutesAt - b.minutesAt);
    legs.forEach((l, idx) => (l.index = idx + 1));

    const sumSoFar = legs.reduce((a, l) => a + l.amount, 0);
    legs[legs.length - 1].amount += quantity - sumSoFar;
  }

  legs = legs.filter((l) => l.amount > 0);
  legs = enforceMinimum(legs, minQty);
  return legs;
}

// ==========================================
// CARD PREVIEW
// ==========================================
function updateCardPreview(card) {
  const categorySelect = card.querySelector(".category-select");
  const qtyInput = card.querySelector(".qty");
  const durationInput = card.querySelector(".duration");
  const randomnessInput = card.querySelector(".randomness");
  const previewBox = card.querySelector(".legs-preview");
  const previewCostEl = card.querySelector(".preview-cost");
  const qtyWarningEl = card.querySelector(".qty-warning");
  const showLegsToggle = card.querySelector(".show-legs-toggle");
  const summaryNoteEl = card.querySelector(".legs-summary-note");

  const category = categorySelect.value || "views";
  const serviceLabel = capitalize(category);
  const rate = parseFloat(card.dataset.selectedRate) || 0;
  const minQty = parseInt(card.dataset.selectedMin, 10) || 1;
  const maxQty = parseInt(card.dataset.selectedMax, 10) || 1000000;

  const quantity = Math.max(0, parseInt(qtyInput.value, 10) || 0);
  const durationHours = Math.max(1, parseInt(durationInput.value, 10) || 24);
  const randomness = Math.min(40, Math.max(1, parseInt(randomnessInput.value, 10) || 1));

  if (quantity > 0 && quantity < minQty) {
    qtyWarningEl.textContent = `Below this service's minimum of ${minQty.toLocaleString()} — the panel will reject this order.`;
  } else if (quantity > maxQty) {
    qtyWarningEl.textContent = `Above this service's maximum of ${maxQty.toLocaleString()}.`;
  } else {
    qtyWarningEl.textContent = "";
  }

  const allCards = getAllServiceCards();
  const isFirstCard = allCards[0] === card;
  const referenceCard = allCards[0];

  let legs;
  let syncInfo = null;

  if (!isFirstCard && referenceCard && referenceCard._lastLegs && referenceCard._lastLegs.length > 0) {
    const result = generateSyncedLegsWithReduction(quantity, minQty, referenceCard._lastLegs);
    legs = result.legs;
    syncInfo = result;
  } else {
    const curvePoints = getCurveForCard(card);
    legs = generateLegs(quantity, durationHours, randomness, curvePoints, minQty);
  }

  const selectedServiceId = String(card.dataset.selectedServiceId || "");
  const selectedBaseUrl = card._selectedProvider?.baseUrl || "";
  let selectedProvider = card._selectedProvider || {};

  if (selectedBaseUrl) {
    const candidates = (CATALOG[category] || []).filter((svc) =>
      String(svc.id) === selectedServiceId && String(svc._baseUrl || "") === selectedBaseUrl
    );
    if (candidates[0]) {
      selectedProvider = {
        baseUrl: candidates[0]._baseUrl || selectedBaseUrl,
        apiKey: candidates[0]._apiKey || "",
      };
    }
  }

  legs = legs.map((l) => ({
    ...l,
    serviceLabel,
    category,
    serviceId: selectedServiceId,
    baseUrl: selectedProvider.baseUrl || "",
    apiKey: selectedProvider.apiKey || "",
  }));
  card._lastLegs = legs;

  if (showLegsToggle && showLegsToggle.checked) {
    previewBox.style.display = "flex";
    previewBox.innerHTML = legs
      .map(
        (leg) => `
        <div class="leg-row">
          <span class="leg-dot" style="background:${colorForCategory(category)}"></span>
          <span class="leg-label">Leg ${leg.index}</span>
          <span class="leg-amount">${leg.amount.toLocaleString()} ${serviceLabel}</span>
          <span class="leg-time mono">${formatMinutes(leg.minutesAt)}</span>
        </div>
      `
      )
      .join("");
  } else if (previewBox) {
    previewBox.style.display = "none";
    previewBox.innerHTML = "";
  }

  if (summaryNoteEl) {
    if (syncInfo && syncInfo.reduced) {
      summaryNoteEl.textContent = `⚠️ Synced to Slot 1's timing, but legs reduced from ${syncInfo.fromCount} to ${syncInfo.toCount} — need at least ${syncInfo.neededQtyForFull.toLocaleString()} quantity to match all ${syncInfo.fromCount} legs.`;
      summaryNoteEl.classList.add("warning");
    } else if (!isFirstCard && legs.length > 0) {
      summaryNoteEl.textContent = `🔗 Synced with Slot 1's timing — ${legs.length} legs.`;
      summaryNoteEl.classList.remove("warning");
    } else {
      summaryNoteEl.textContent = `${legs.length} leg${legs.length === 1 ? "" : "s"} planned.`;
      summaryNoteEl.classList.remove("warning");
    }
  }

  const cost = (quantity / 1000) * rate;
  previewCostEl.textContent = formatCost(cost);

  return { serviceLabel, category, quantity, cost, legs, serviceId: card.dataset.selectedServiceId };
}

function formatMinutes(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ==========================================
// SUMMARY
// ==========================================
function updateSummary() {
  const cards = getAllServiceCards();
  let totalQty = 0;
  let totalCost = 0;

  cards.forEach((card) => {
    const qtyInput = card.querySelector(".qty");
    const rate = parseFloat(card.dataset.selectedRate) || 0;
    const quantity = Math.max(0, parseInt(qtyInput.value, 10) || 0);
    totalQty += quantity;
    totalCost += (quantity / 1000) * rate;
  });

  totalQtyEl.textContent = totalQty.toLocaleString();
  totalCostEl.textContent = formatCost(totalCost);
}

// ==========================================
// GROWTH GRAPH — one colored line per category
// ==========================================
function drawMultiLineGraph(linesGroupEl, legendEl, legsByCategory, width, height, padding) {
  linesGroupEl.innerHTML = "";
  legendEl.innerHTML = "";

  const categories = Object.keys(legsByCategory);
  if (categories.length === 0) {
    const flatY = height - padding;
    linesGroupEl.innerHTML = `<line x1="${padding}" y1="${flatY}" x2="${width - padding}" y2="${flatY}" stroke="#2a2a2e" stroke-width="1"></line>`;
    return;
  }

  let maxT = 1;
  let maxV = 1;
  const cumulativeByCategory = {};

  categories.forEach((cat) => {
    const sorted = [...legsByCategory[cat]].sort((a, b) => a.minutesAt - b.minutesAt);
    let cumulative = 0;
    const points = sorted.map((leg) => {
      cumulative += leg.amount;
      return { t: leg.minutesAt, v: cumulative };
    });
    cumulativeByCategory[cat] = points;
    maxT = Math.max(maxT, ...points.map((p) => p.t));
    maxV = Math.max(maxV, ...points.map((p) => p.v));
  });

  const toXY = (p) => [
    padding + (p.t / maxT) * (width - padding * 2),
    height - padding - (p.v / maxV) * (height - padding * 2),
  ];

  categories.forEach((cat) => {
    const points = cumulativeByCategory[cat];
    const coords = points.map(toXY);
    let d = `M ${coords[0][0]} ${coords[0][1]}`;
    coords.slice(1).forEach(([x, y]) => (d += ` L ${x} ${y}`));

    const color = colorForCategory(cat);
    linesGroupEl.innerHTML += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"></path>`;

    const total = points[points.length - 1].v;
    legendEl.innerHTML += `
      <div class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        ${capitalize(cat)} <span class="legend-num">${total.toLocaleString()}</span>
      </div>
    `;
  });

  window._growthGraphHoverData = { cumulativeByCategory, maxT, maxV, width, height, padding, toXY };
}

function updateGraph(allLegs) {
  const linesGroup = document.getElementById("graphLinesGroup");
  const legend = document.getElementById("graphLegend");

  const legsByCategory = {};
  allLegs.forEach((leg) => {
    if (!legsByCategory[leg.category]) legsByCategory[leg.category] = [];
    legsByCategory[leg.category].push(leg);
  });

  drawMultiLineGraph(linesGroup, legend, legsByCategory, 600, 120, 8);
}

// ==========================================
// REFRESH EVERYTHING
// ==========================================
function refreshEverything() {
  const cards = getAllServiceCards();
  let allLegs = [];

  cards.forEach((card) => {
    const { legs } = updateCardPreview(card);
    allLegs = allLegs.concat(legs);
  });

  updateSummary();
  updateGraph(allLegs);
}

// ==========================================
// CUSTOM GRAPH EDITOR (20 draggable dots)
// ==========================================
function openGraphModal(card) {
  editingCard = card;
  const points = card.customGraphPoints ? [...card.customGraphPoints] : Array(20).fill(50);
  customGraphNameInput.value = "";
  renderGraphEditor(points);
  graphModal.classList.add("open");
}

function renderGraphEditor(points) {
  const width = 600, height = 200, padding = 16;
  const stepX = (width - padding * 2) / (points.length - 1);

  const valueToY = (v) => height - padding - (v / 100) * (height - padding * 2);
  const yToValue = (y) => {
    const clampedY = Math.min(height - padding, Math.max(padding, y));
    return Math.round(((height - padding - clampedY) / (height - padding * 2)) * 100);
  };

  function pathD() {
    return points.map((v, i) => `${i === 0 ? "M" : "L"} ${padding + i * stepX} ${valueToY(v)}`).join(" ");
  }

  function draw() {
    const dots = points
      .map((v, i) => `<circle class="graph-dot" data-index="${i}" cx="${padding + i * stepX}" cy="${valueToY(v)}" r="7"></circle>`)
      .join("");
    customGraphSvg.innerHTML = `<path d="${pathD()}" fill="none" stroke="#ff2d43" stroke-width="2"></path>${dots}`;
    attachDragHandlers();
  }

  function attachDragHandlers() {
    customGraphSvg.querySelectorAll(".graph-dot").forEach((dot) => {
      dot.addEventListener("pointerdown", (e) => {
        const index = parseInt(dot.dataset.index, 10);
        dot.setPointerCapture(e.pointerId);

        function onMove(ev) {
          const rect = customGraphSvg.getBoundingClientRect();
          const scaleY = height / rect.height;
          const localY = (ev.clientY - rect.top) * scaleY;
          points[index] = yToValue(localY);
          draw();
        }
        function onUp() {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });
    });
  }

  draw();
  customGraphSvg._points = points;
}

closeGraphModal.addEventListener("click", () => graphModal.classList.remove("open"));

saveGraphBtn.addEventListener("click", () => {
  const points = customGraphSvg._points;
  const name = customGraphNameInput.value.trim();

  if (name) {
    SAVED_GRAPHS.push({ name, points: [...points] });
    saveSavedGraphs(SAVED_GRAPHS);
    refreshAllGraphSelects();
    if (editingCard) {
      editingCard.querySelector(".graph-select").value = `saved_${SAVED_GRAPHS.length - 1}`;
    }
    addLog(`Saved custom curve "${name}" permanently on this device`);
  } else if (editingCard) {
    editingCard.customGraphPoints = [...points];
    editingCard.querySelector(".graph-select").value = "custom";
    addLog("Applied a custom curve to this slot (not saved — no name given)");
  }

  graphModal.classList.remove("open");
  refreshEverything();
});

// ==========================================
// ORDER CREATION / SCHEDULING
// ==========================================
submitOrderBtn.addEventListener("click", async () => {
  const link = document.getElementById("targetLink").value.trim();
  const name = document.getElementById("scheduleName").value.trim() || "Untitled schedule";

  if (!link) {
    orderStatusEl.textContent = "Add a target link first.";
    orderStatusEl.className = "connect-status error";
    return;
  }

  let allLegsForOrder = [];

  if (ORDER_MODE === "auto") {
    allLegsForOrder = computeAutoTabLegs(link);
    if (allLegsForOrder.length === 0) {
      orderStatusEl.textContent = "Turn on at least one service first.";
      orderStatusEl.className = "connect-status error";
      return;
    }
  } else {
    const cards = getAllServiceCards();
    if (cards.length === 0) {
      orderStatusEl.textContent = "Add at least one service slot first.";
      orderStatusEl.className = "connect-status error";
      return;
    }
    cards.forEach((card) => {
      const { legs, serviceLabel, category, serviceId } = updateCardPreview(card);
      legs.forEach((leg) => {
        allLegsForOrder.push({
          serviceId,
          link,
          quantity: leg.amount,
          category,
          serviceLabel,
          baseUrl: leg.baseUrl || "",
          apiKey: leg.apiKey || "",
          fireInMs: leg.minutesAt * 60000,
        });
      });
    });
  }

  allLegsForOrder.forEach((leg) => {
    const fireAtClock = new Date(Date.now() + leg.fireInMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    addLog(`Queued ${leg.quantity.toLocaleString()} ${leg.serviceLabel} for ${fireAtClock}`);
  });

  if (PANEL.connected) {
    orderStatusEl.textContent = "Sending schedule to the server...";
    orderStatusEl.className = "connect-status";
    try {
      const res = await fetch(`${PROXY_ORIGIN}/schedule-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, link, baseUrl: PANEL.baseUrl, apiKey: PANEL.apiKey, legs: allLegsForOrder }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      orderStatusEl.textContent = `Schedule "${name}" is now running on the server (${data.scheduled} legs) — safe to close this tab, delivery continues.`;
      orderStatusEl.className = "connect-status ok";
      addLog(`Order "${name}" handed off to server scheduler (${data.scheduled} legs)`);
      // Refresh both server-backed views immediately; otherwise the activity
      // table remains stale until the user manually refreshes it.
      await Promise.all([loadOrders(), loadActivityLog()]);
    } catch (err) {
      orderStatusEl.textContent = `Couldn't hand the schedule to the server: ${err.message}`;
      orderStatusEl.className = "connect-status error";
      addLog(`Failed to schedule order "${name}" on the server: ${err.message}`);
      await loadActivityLog();
    }
  } else {
    allLegsForOrder.forEach((leg) => {
      setTimeout(
        () => simulateDeliverLeg(leg.serviceLabel, leg.category, leg.quantity, leg.link),
        leg.fireInMs
      );
    });
    orderStatusEl.textContent = `Schedule "${name}" created in demo mode (no panel connected) — ${allLegsForOrder.length} legs will simulate locally while this tab stays open.`;
    orderStatusEl.className = "connect-status ok";
    addLog(`Order created — "${name}" (${allLegsForOrder.length} legs, demo mode)`);
  }
});

function simulateDeliverLeg(serviceLabel, category, amount, link) {
  addLog(`(Simulated) Delivered ${amount.toLocaleString()} ${serviceLabel}`);
  recordDelivery(link, category, amount);
}

// ==========================================
// TRACKER TAB — real saved history only
// ==========================================
let TRACKER_ENTRIES = [];

trackBtn.addEventListener("click", async () => {
  const link = trackerLinkInput.value.trim();
  if (!link) return;

  trackerEmptyEl.style.display = "block";
  trackerEmptyEl.textContent = "Loading...";

  const localEntries = getHistoryForLink(link);
  let serverEntries = [];

  try {
    const res = await fetch(`${PROXY_ORIGIN}/history?link=${encodeURIComponent(link)}`);
    if (res.ok) serverEntries = await res.json();
  } catch {
    // server unreachable — fall back to local-only history silently
  }

  TRACKER_ENTRIES = [...localEntries, ...serverEntries].sort((a, b) => a.timestamp - b.timestamp);

  if (TRACKER_ENTRIES.length === 0) {
    document.getElementById("trackerPills").innerHTML = "";
    document.getElementById("trackerLinesGroup").innerHTML = "";
    document.getElementById("trackerGridGroup").innerHTML = "";
    document.getElementById("trackerAxisGroup").innerHTML = "";
    trackerEmptyEl.style.display = "block";
    trackerEmptyEl.textContent = "No delivery history found for this link in the last 7 days — place an order first.";
    return;
  }

  trackerEmptyEl.style.display = "none";
  renderTrackerPills();
  renderTrackerSelection("all");
  addLog(`Viewed delivery history for ${link}`);
});

function renderTrackerPills() {
  const categories = [...new Set(TRACKER_ENTRIES.map((e) => e.category))];
  const pillsEl = document.getElementById("trackerPills");

  const options = ["all", ...categories];
  pillsEl.innerHTML = options
    .map(
      (opt, i) => `
      <button class="ig-pill ${i === 0 ? "active" : ""}" data-cat="${opt}">
        ${opt === "all" ? "All" : capitalize(opt)}
      </button>
    `
    )
    .join("");

  pillsEl.querySelectorAll(".ig-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      pillsEl.querySelectorAll(".ig-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTrackerSelection(btn.dataset.cat);
    });
  });
}

function niceStep(maxValue) {
  const roughStep = maxValue / 2;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
  const normalized = roughStep / magnitude;
  let niceNormalized;
  if (normalized < 1.5) niceNormalized = 1;
  else if (normalized < 3.5) niceNormalized = 2.5;
  else if (normalized < 7.5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

function formatK(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  return `${Math.round(value)}`;
}

function renderTrackerSelection(catFilter) {
  const filtered = catFilter === "all" ? TRACKER_ENTRIES : TRACKER_ENTRIES.filter((e) => e.category === catFilter);
  if (filtered.length === 0) return;

  const startTime = TRACKER_ENTRIES[0].timestamp;
  let cumulative = 0;
  const points = filtered.map((e) => {
    cumulative += e.amount;
    return { t: (e.timestamp - startTime) / 60000, v: cumulative };
  });

  const width = 700, height = 380;
  const padLeft = 55, padRight = 20, padTop = 20, padBottom = 40;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxT = Math.max(...points.map((p) => p.t), 1);
  const maxV = Math.max(...points.map((p) => p.v), 1);
  const step = niceStep(maxV);
  const gridMax = step * 2;

  const toXY = (p) => [
    padLeft + (p.t / maxT) * plotW,
    padTop + plotH - (p.v / gridMax) * plotH,
  ];

  const coords = points.map(toXY);
  let d = `M ${coords[0][0]} ${coords[0][1]}`;
  coords.slice(1).forEach(([x, y]) => (d += ` L ${x} ${y}`));

  document.getElementById("trackerLinesGroup").innerHTML = `<path class="ig-line-path" d="${d}"></path>`;

  let gridHtml = "";
  [0, step, gridMax].forEach((val) => {
    const y = padTop + plotH - (val / gridMax) * plotH;
    gridHtml += `<line class="ig-grid-line" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}"></line>`;
    gridHtml += `<text class="ig-axis-text" x="${padLeft - 12}" y="${y + 4}" text-anchor="end">${formatK(val)}</text>`;
  });
  document.getElementById("trackerGridGroup").innerHTML = gridHtml;

  const totalHours = maxT / 60;
  let axisHtml = "";
  [0, totalHours / 2, totalHours].forEach((h, i) => {
    const x = padLeft + (i / 2) * plotW;
    const label = h < 0.1 ? "0" : `${Math.round(h)}h`;
    const anchor = i === 0 ? "start" : i === 2 ? "end" : "middle";
    axisHtml += `<text class="ig-axis-text" x="${x}" y="${height - 14}" text-anchor="${anchor}">${label}</text>`;
  });
  document.getElementById("trackerAxisGroup").innerHTML = axisHtml;
}

// ==========================================
// SCHEDULES PASSWORD GATE
// ==========================================
unlockSchedulesBtn.addEventListener("click", () => {
  if (schedulesPasswordInput.value === SCHEDULES_PASSWORD) {
    schedulesLocked.style.display = "none";
    schedulesContent.style.display = "block";
    lockErrorEl.textContent = "";
    loadOrders();
    loadActivityLog();
  } else {
    lockErrorEl.textContent = "Incorrect password.";
  }
});

refreshActivityBtn.addEventListener("click", () => {
  loadOrders();
  loadActivityLog();
});

// ==========================================
// ORDERS (Schedules tab — play / pause / delete)
// ==========================================
async function loadOrders() {
  ordersListEl.innerHTML = `<div class="summary-empty">Loading...</div>`;
  try {
    const res = await fetch(`${PROXY_ORIGIN}/orders`);
    const data = await res.json();
    if (!res.ok) throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
    if (!Array.isArray(data)) throw new Error("Server returned an invalid orders response.");
    renderOrders(data);
  } catch (err) {
    ordersListEl.innerHTML = `<div class="summary-empty">Unable to load scheduled orders: ${err.message}</div>`;
  }
}

function renderOrders(orders) {
  if (!orders || orders.length === 0) {
    ordersListEl.innerHTML = `<div class="summary-empty">No orders yet — create one in the Order tab.</div>`;
    return;
  }

  ordersListEl.innerHTML = orders
    .map((order) => {
      const pct = order.totalLegs > 0 ? Math.round((order.doneLegs / order.totalLegs) * 100) : 0;

      const statsParts = Object.entries(order.byCategory).map(
        ([cat, qty]) => `${categoryEmoji(cat)} ${capitalize(cat)} (${qty.toLocaleString()})`
      );

      const nextText = order.nextFireAt
        ? new Date(order.nextFireAt).toLocaleString([], { month: "numeric", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : "—";

      const isFinished = ["completed", "failed"].includes(order.status);
      const isPaused = order.status === "paused";

      const playPauseBtn = isFinished
        ? ""
        : isPaused
        ? `<button class="order-action-btn play" data-action="resume" data-id="${order.id}" title="Resume">▶</button>`
        : `<button class="order-action-btn pause" data-action="pause" data-id="${order.id}" title="Pause">⏸</button>`;

      return `
        <div class="order-card">
          <div class="order-card-main">
            <div class="order-card-head">
              <span class="order-name">${order.name}</span>
              <span class="order-status-badge ${order.status}">${capitalize(order.status)}</span>
            </div>
            <div class="order-stats-line">${statsParts.join(" · ")}</div>
            <div class="order-progress-line">Done: ${order.doneLegs}/${order.totalLegs} legs · Next: ${nextText}</div>
            <a class="order-link" href="${order.link}" target="_blank" rel="noopener">${order.link}</a>
            <div class="order-progress-bar"><div class="order-progress-fill" style="width:${pct}%"></div></div>
          </div>
          <div class="order-actions">
            ${playPauseBtn}
            <button class="order-action-btn delete" data-action="delete" data-id="${order.id}" title="Delete">🗑</button>
          </div>
        </div>
      `;
    })
    .join("");

  ordersListEl.querySelectorAll(".order-action-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === "delete") {
        await fetch(`${PROXY_ORIGIN}/orders/${id}`, { method: "DELETE" });
        addLog(`Deleted order ${id}`);
      } else {
        await fetch(`${PROXY_ORIGIN}/orders/${id}/${action}`, { method: "POST" });
        addLog(`${capitalize(action)}d order ${id}`);
      }
      await Promise.all([loadOrders(), loadActivityLog()]);
    });
  });
}

function categoryEmoji(cat) {
  const map = { views: "👁", likes: "❤️", followers: "👥", repost: "🔄", comments: "💬" };
  return map[cat] || "•";
}

async function loadActivityLog() {
  activityLogTableEl.innerHTML = `<div class="summary-empty">Loading...</div>`;
  try {
    const res = await fetch(`${PROXY_ORIGIN}/activity-log`);
    const entries = await res.json();
    renderActivityLog(entries);
  } catch (err) {
    activityLogTableEl.innerHTML = `<div class="summary-empty">Couldn't reach the server: ${err.message}</div>`;
  }
}

function renderActivityLog(entries) {
  if (!entries || entries.length === 0) {
    activityLogTableEl.innerHTML = `<div class="summary-empty">No activity recorded yet.</div>`;
    return;
  }

  const headRow = `
    <div class="schedule-row head-row">
      <span>Time</span><span>Website</span><span>API Key</span><span>Detail</span>
    </div>
  `;

  const rows = entries
    .map((e) => {
      const time = new Date(e.timestamp).toLocaleString([], {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      const qty = Number(e.quantity || e.totalQuantity || 0);
      const qtyText = qty ? qty.toLocaleString() : "?";
      const detailByType = {
        connect: "Connected",
        schedule_created: `Scheduled "${e.name || "Order"}" — ${qtyText} units across ${e.legCount || "?"} legs`,
        schedule_rejected: `Rejected "${e.name || "Order"}" — ${e.error || "request validation failed"}`,
        leg_completed: `Submitted ${qtyText} units of ${e.category || "service"}${e.providerOrderId ? ` (provider order #${e.providerOrderId})` : ""}`,
        leg_failed: `Failed ${qtyText} units of ${e.category || "service"}: ${e.error || "provider error"}`,
        schedule_paused: `Paused schedule ${e.orderId || ""}`,
        schedule_resumed: `Resumed schedule ${e.orderId || ""}`,
        schedule_deleted: `Deleted schedule "${e.name || e.orderId || ""}"`,
        schedule_finished: `Schedule ${e.orderId || ""} finished: ${e.status || "done"}`,
      };
      const detail = detailByType[e.type] ||
        `${qtyText} units (${e.legCount || "?"} legs) → ${e.link || e.orderId || "?"}`;

      return `
        <div class="schedule-row">
          <span class="sched-time">${time}</span>
          <span>${e.baseUrl || "—"}</span>
          <span class="mono">${e.apiKey || "—"}</span>
          <span class="sched-status">${detail}</span>
        </div>
      `;
    })
    .join("");

  activityLogTableEl.innerHTML = headRow + rows;
}

schedulesPasswordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlockSchedulesBtn.click();
});

// ==========================================
// MISC
// ==========================================
presetsBtn.addEventListener("click", () => addLog("Opened saved presets"));

// ==========================================
// INIT
// ==========================================
addServiceBtn.addEventListener("click", () => {
  createServiceSlot();
  refreshEverything();
});

const autoModeBtn = document.getElementById("autoModeBtn");
const manualModeBtn = document.getElementById("manualModeBtn");
const autoServicesBlock = document.getElementById("autoServicesBlock");
const manualServicesBlock = document.getElementById("manualServicesBlock");

function setOrderMode(mode) {
  ORDER_MODE = mode;
  autoModeBtn.classList.toggle("active", mode === "auto");
  manualModeBtn.classList.toggle("active", mode === "manual");
  autoServicesBlock.style.display = mode === "auto" ? "block" : "none";
  manualServicesBlock.style.display = mode === "manual" ? "block" : "none";

  if (mode === "auto") {
    refreshAutoTab();
  } else {
    refreshEverything();
  }
}

autoModeBtn.addEventListener("click", () => setOrderMode("auto"));
manualModeBtn.addEventListener("click", () => setOrderMode("manual"));

pruneOldHistory();
addLog("Session started");

const savedProfiles = loadProfilesFromStorage();
PROFILES = savedProfiles.map((profile) => ({ ...profile, connected: false, catalog: {}, balanceText: "" }));
renderProfilesList();
(async function restoreSavedProfiles() {
  for (const profile of savedProfiles) {
    await attemptConnect(profile.name, profile.baseUrl, profile.apiKey, true);
  }
  let active = PROFILES.find((profile) => profile.id === ACTIVE_PROFILE_ID && profile.connected);
  if (!active) active = PROFILES.find((profile) => profile.connected);
  if (active) {
    setActiveProfile(active, false);
    saveProfiles();
    renderProfilesList();
    rebuildAllCategoryDropdowns();
    renderFixedCards();
    refreshAutoTab();
  }
})();

// ==========================================
// GROWTH GRAPH — hover tooltip
// ==========================================
const growthSvgEl = document.getElementById("growthSvg");
const growthTooltipEl = document.getElementById("growthTooltip");

growthSvgEl.addEventListener("mousemove", (e) => {
  const data = window._growthGraphHoverData;
  if (!data) return;

  const rect = growthSvgEl.getBoundingClientRect();
  const scaleX = data.width / rect.width;
  const localX = (e.clientX - rect.left) * scaleX;
  const t = ((localX - data.padding) / (data.width - data.padding * 2)) * data.maxT;

  let nearest = null;
  let nearestDist = Infinity;
  let nearestCat = null;

  Object.entries(data.cumulativeByCategory).forEach(([cat, points]) => {
    points.forEach((p) => {
      const dist = Math.abs(p.t - t);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = p;
        nearestCat = cat;
      }
    });
  });

  if (!nearest) return;

  growthTooltipEl.style.display = "block";
  growthTooltipEl.style.left = `${e.clientX - rect.left + 12}px`;
  growthTooltipEl.style.top = `${e.clientY - rect.top - 10}px`;
  growthTooltipEl.innerHTML = `
    <span class="tt-time">${formatMinutes(Math.round(nearest.t))}</span>
    <b style="color:${colorForCategory(nearestCat)}">${capitalize(nearestCat)}: ${nearest.v.toLocaleString()}</b>
  `;
});

growthSvgEl.addEventListener("mouseleave", () => {
  growthTooltipEl.style.display = "none";
});

createServiceSlot();
renderFixedCards();
setOrderMode("auto");
