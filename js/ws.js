// ── ws.js ──────────────────────────────────────────────────────
// Optional WebSocket integration with BasecaBot. Connects to the bot's hub as
// the "baseca-wheel" room and turns Twitch chat commands (!wheel title / add /
// spin) into wheel actions, and can announce winners / limit events back to
// chat. All settings live in the GLOBAL settings menu and persist globally
// (not per-wheel) under basca_ws_config.
//
// LOAD ORDER: after ui.js (calls its render/save helpers) and before boot.js.
// Reads/mutates: entrants, slotTitle, activeSlot, wheelList (state.js).
// Calls:   spinWheel (spin.js); saveEntrants, renderEntrants, updateStats,
//          resetWheelState, renderWheelList, updateWheelTitle (ui.js/wheel.js);
//          saveWheelList, saveCurrentSlot (storage.js); safeSetItem (storage.js).
// Exposes (for spin.js): wsSendResult(name), wsSendNobody().
//
// PROTOCOL: see docs/basecawheel-integration.md. Every message is
// { type, room:"baseca-wheel", payload, ts }. We receive type "wheel" and may
// send "announce" / "result".
//
// SECURITY NOTE: the hub secret is stored in localStorage in plaintext — this
// is a local streamer tool talking to the user's own bot, so that's acceptable,
// but it is not a place for a sensitive shared credential.

const WS_CONFIG_KEY = "basca_ws_config";
const WS_ROOM       = "baseca-wheel";
// Commands with their own configurable permission row in the UI.
const WS_COMMANDS   = ["add", "spin", "title"];
// Which configured permission each accepted command uses. `clear` piggybacks
// on `add`'s level, `clearall` on `title`'s (so they share, not duplicate, config).
const WS_PERM_SOURCE = { title: "title", add: "add", spin: "spin", clear: "add", clearall: "title" };
// Index = PermissionLevel from the bot's enum (0 = lowest).
const WS_PERM_FULL  = ["Viewer", "Subscriber", "VIP", "Moderator", "Broadcaster", "Admin"];
const WS_PERM_SHORT = ["Viewer", "Sub", "VIP", "Mod", "Caster", "Admin"];

const WS_DEFAULTS = {
  url:              "wss://bot.edmorex.com/ws?room=baseca-wheel",
  secret:           "",
  perms:            { add: 0, spin: 3, title: 3 }, // minimum PermissionLevel per command
  maxPerUser:       1,                             // 0 = unlimited
  limitMode:        "replace",                     // "reject" | "replace"
  appendUsername:   true,                          // append " (user)" to each entry
  announceWinner:   true,
  announceReplaced: true, // "Replace oldest": tell the user their oldest entry was replaced
  announceRejected: true, // tell the user when a command was rejected (limit/permission/spinning)
};

// ── Config (global, persisted) ────────────────────────────────
let wsConfig = { ...WS_DEFAULTS };
try {
  const raw = localStorage.getItem(WS_CONFIG_KEY);
  if (raw) {
    const d = JSON.parse(raw);
    // Migrate the old combined "announceLimit" flag into the two new flags.
    if (d.announceLimit !== undefined) {
      if (d.announceReplaced === undefined) d.announceReplaced = d.announceLimit;
      if (d.announceRejected === undefined) d.announceRejected = d.announceLimit;
    }
    wsConfig = { ...WS_DEFAULTS, ...d, perms: { ...WS_DEFAULTS.perms, ...(d.perms || {}) } };
  }
} catch {}

function wsSaveConfig() { safeSetItem(WS_CONFIG_KEY, JSON.stringify(wsConfig)); }

// ── Connection ────────────────────────────────────────────────
let ws              = null;
let wsWantConnected = false; // user intends to be connected (drives auto-reconnect)
let wsReconnectId   = null;
let wsBackoff       = 1000;

function wsBuildUrl() {
  const u = wsConfig.url.trim();
  if (!u) return "";
  // Ensure room is present, then append the secret. Handles URLs that already
  // carry a query string or the room param.
  const extra = [];
  if (!/[?&]room=/.test(u)) extra.push("room=" + encodeURIComponent(WS_ROOM));
  extra.push("secret=" + encodeURIComponent(wsConfig.secret));
  const sep = u.includes("?") ? "&" : "?";
  return u + sep + extra.join("&");
}

function wsOpenSocket() {
  if (ws) { try { ws.close(); } catch {} ws = null; }
  const full = wsBuildUrl();
  if (!full) { wsSetStatus("set a Hub URL", "err"); return; }

  wsSetStatus("connecting…", "");
  try {
    ws = new WebSocket(full);
  } catch {
    wsSetStatus("invalid URL", "err");
    return;
  }

  ws.onopen = () => {
    wsBackoff = 1000;
    wsSetStatus("connected", "ok");
    wsUpdateButtons();
  };
  ws.onclose = (ev) => {
    ws = null;
    // 4001 = bad/absent secret, 4002 = missing room (see the spec). These are
    // config errors — stop and let the user fix them rather than reconnecting
    // in a tight loop. Any other close while the user wants to be connected
    // (e.g. bot restart) triggers a backoff reconnect.
    if (ev.code === 4001 || ev.code === 4002) {
      wsWantConnected = false;
      wsSetStatus(ev.code === 4001 ? "rejected — bad secret (4001)"
                                   : "rejected — missing room (4002)", "err");
    } else if (wsWantConnected) {
      wsSetStatus(`reconnecting… (closed ${ev.code})`, "err");
      wsReconnectId = setTimeout(wsOpenSocket, wsBackoff);
      wsBackoff = Math.min(wsBackoff * 2, 15000);
    } else {
      wsSetStatus("disconnected", "");
    }
    wsUpdateButtons();
  };
  ws.onerror = () => {}; // errors surface as a close; a bad secret closes 4001
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg && msg.type === "wheel" && msg.payload) wsHandleWheel(msg.payload);
  };
  wsUpdateButtons();
}

function wsConnect() {
  wsWantConnected = true;
  if (wsReconnectId) { clearTimeout(wsReconnectId); wsReconnectId = null; }
  wsBackoff = 1000;
  wsOpenSocket();
  wsUpdateButtons();
}

function wsDisconnect() {
  wsWantConnected = false;
  if (wsReconnectId) { clearTimeout(wsReconnectId); wsReconnectId = null; }
  if (ws) { try { ws.close(); } catch {} ws = null; }
  wsSetStatus("disconnected", "");
  wsUpdateButtons();
}

function wsSend(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, room: WS_ROOM, payload, ts: Date.now() }));
  }
}

// Applied whenever a wheel becomes active (activateSlot). Per-wheel setting:
//   autoConnect === true  → connect if we're not already connected/trying and
//                           a URL + secret are saved.
//   autoConnect === false → disconnect if we currently have a connection intent.
function wsApplyWheelPolicy(autoConnect) {
  if (autoConnect) {
    if (!wsWantConnected && wsConfig.url.trim() && wsConfig.secret.trim()) wsConnect();
  } else {
    if (wsWantConnected) wsDisconnect();
  }
}

// ── Inbound command handling ──────────────────────────────────
// Per-user submission tracking for the entry limit. Maps a lowercased user
// name to the entrant objects they've added via the bot. References are pruned
// against the live `entrants` array on each use, so clearing entrants or
// switching wheels effectively resets everyone's count automatically.
const wsUserEntries = new Map();

function wsHandleWheel(p) {
  const command    = p.command;
  const text       = typeof p.text === "string" ? p.text : "";
  const user       = typeof p.user === "string" ? p.user : "";
  const permission = Number(p.permission) || 0; // unknown/other → treat as lowest

  const permSrc = WS_PERM_SOURCE[command];
  if (permSrc === undefined) return;              // unknown command
  if (permission < wsConfig.perms[permSrc]) {     // permission too low
    wsRejectMsg(user, `you don't have permission to use !wheel ${command}.`);
    return;
  }

  if (command === "title") {
    if (spinning) { wsRejectMsg(user, WS_SPINNING_MSG); return; } // title locked while spinning
    wsSetActiveTitle(text);
  } else if (command === "add") {
    if (spinning) { wsRejectMsg(user, WS_SPINNING_MSG); return; } // no adding mid-spin
    wsHandleAdd(text, user);
  } else if (command === "clear") {
    if (spinning) { wsRejectMsg(user, WS_SPINNING_MSG); return; } // no editing mid-spin
    wsHandleClearUser(user); // remove this user's own entries
  } else if (command === "clearall") {
    if (spinning) { wsRejectMsg(user, WS_SPINNING_MSG); return; } // no editing mid-spin
    wsHandleReset(); // wipe every entry on the wheel
  } else if (command === "spin") {
    // If a winner / nobody-wins result is on screen, return to idle first so
    // its state (confetti, overlay, emoji, cached face) is cleaned up, then spin.
    if (winnerShowing) dismissWinner();
    spinWheel(); // winner announced from finishSpin
  }
}

const WS_SPINNING_MSG = "the wheel is spinning — try again after it lands.";

// Announce a command rejection back to chat (if enabled).
function wsRejectMsg(user, reason) {
  if (wsConfig.announceRejected) wsSend("announce", { text: `@${user} ${reason}` });
}

function wsSetActiveTitle(text) {
  slotTitle = text;
  const w = wheelList.find(x => x.id === activeSlot);
  if (w) w.title = text;
  updateWheelTitle();
  saveWheelList();
  saveCurrentSlot();
  renderWheelList();
}

function wsAfterEntrantsChange() {
  // wsHandleAdd is guarded against running while spinning, so this always runs
  // from a non-spinning state.
  saveEntrants();
  renderEntrants();
  updateStats();
  resetWheelState(); // resets rotation, rebuilds the face, returns to idle
}

function wsHandleAdd(text, user) {
  if (!text.trim()) return;
  const key   = user.toLowerCase();
  const limit = Math.max(0, Number(wsConfig.maxPerUser) || 0);
  // The name that lands on the wheel — optionally tagged with the submitter.
  const entryName = wsConfig.appendUsername && user ? `${text} (${user})` : text;

  // Current entries by this user that still exist on the wheel.
  let list = (wsUserEntries.get(key) || []).filter(e => entrants.includes(e));
  wsUserEntries.set(key, list);

  if (limit > 0 && list.length >= limit) {
    if (wsConfig.limitMode === "replace") {
      const oldest = list.shift();
      const idx = entrants.indexOf(oldest);
      if (idx !== -1) entrants.splice(idx, 1);
      const ent = { name: entryName, weight: 1 };
      entrants.unshift(ent);
      list.push(ent);
      wsAfterEntrantsChange();
      if (wsConfig.announceReplaced) {
        wsSend("announce", { text: `@${user} your oldest entry was replaced with "${text}".` });
      }
    } else {
      // reject after limit
      wsRejectMsg(user, `you've hit the entry limit (${limit}).`);
    }
    return;
  }

  const ent = { name: entryName, weight: 1 };
  entrants.unshift(ent);
  list.push(ent);
  wsAfterEntrantsChange();
}

// !wheel clear — remove only the entries THIS user added via the bot.
function wsHandleClearUser(user) {
  const key  = user.toLowerCase();
  const list = (wsUserEntries.get(key) || []).filter(e => entrants.includes(e));
  wsUserEntries.set(key, []);
  if (!list.length) return; // nothing of theirs on the wheel
  list.forEach(e => {
    const idx = entrants.indexOf(e);
    if (idx !== -1) entrants.splice(idx, 1);
  });
  wsAfterEntrantsChange();
}

// !wheel clearall — wipe every entry on the wheel and forget all per-user counts.
function wsHandleReset() {
  entrants = [];
  wsUserEntries.clear();
  wsAfterEntrantsChange();
}

// ── Outbound announcements (called from spin.js) ──────────────
function wsSendResult(name) {
  if (wsConfig.announceWinner) wsSend("result", { winner: name });
}
function wsSendNobody() {
  if (wsConfig.announceWinner) wsSend("announce", { text: "Uh oh, It's broken! Nobody wins!" });
}

// ── Settings UI (global menu) + quick button (sidebar footer) ──
function wsSetStatus(text, cls) {
  const className = "ws-status" + (cls ? " " + cls : "");
  // Same status shown in the global menu and the sidebar-footer quick button.
  ["wsStatus", "wsStatusFooter"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className   = className;
  });
}

function wsUpdateButtons() {
  const connectBtn    = document.getElementById("wsConnectBtn");
  const disconnectBtn = document.getElementById("wsDisconnectBtn");
  if (connectBtn && disconnectBtn) {
    connectBtn.disabled    = wsWantConnected;
    disconnectBtn.disabled = !wsWantConnected;
  }
  const quickBtn = document.getElementById("wsQuickBtn");
  if (quickBtn) {
    const connected = !!(ws && ws.readyState === WebSocket.OPEN);
    quickBtn.classList.toggle("connected", connected);
    quickBtn.title = wsWantConnected ? "Disconnect from bot" : "Connect to bot";
  }
}

// Sidebar quick button: toggle the connection based on the user's intent.
function wsToggleConnection() {
  if (wsWantConnected) wsDisconnect();
  else                 wsConnect();
}

function wsBuildPermGrid() {
  const grid = document.getElementById("wsPermGrid");
  if (!grid) return;
  grid.innerHTML = "";

  // Header row: empty corner + level names.
  grid.appendChild(document.createElement("div"));
  WS_PERM_SHORT.forEach((short, lvl) => {
    const h = document.createElement("div");
    h.className   = "ws-perm-head";
    h.textContent = short;
    h.title       = `${WS_PERM_FULL[lvl]} (level ${lvl})`;
    grid.appendChild(h);
  });

  // One row per command: label + a radio per level (min level required).
  WS_COMMANDS.forEach(cmd => {
    const label = document.createElement("div");
    label.className   = "ws-perm-cmd";
    label.textContent = cmd;
    grid.appendChild(label);

    WS_PERM_SHORT.forEach((_, lvl) => {
      const cell = document.createElement("div");
      cell.className = "ws-perm-cell";
      const radio = document.createElement("input");
      radio.type     = "radio";
      radio.name     = "wsperm-" + cmd;
      radio.checked  = wsConfig.perms[cmd] === lvl;
      radio.title    = `${cmd}: require ${WS_PERM_FULL[lvl]} or higher`;
      radio.onchange = () => { wsConfig.perms[cmd] = lvl; wsSaveConfig(); };
      cell.appendChild(radio);
      grid.appendChild(cell);
    });
  });
}

function wsPopulateInputs() {
  document.getElementById("wsUrl").value          = wsConfig.url;
  document.getElementById("wsSecret").value       = wsConfig.secret;
  document.getElementById("wsMaxPerUser").value   = wsConfig.maxPerUser;
  document.getElementById("wsLimitReject").checked  = wsConfig.limitMode === "reject";
  document.getElementById("wsLimitReplace").checked = wsConfig.limitMode === "replace";
  document.getElementById("wsAppendUsername").checked = !!wsConfig.appendUsername;
  document.getElementById("wsAnnounceWinner").checked   = !!wsConfig.announceWinner;
  document.getElementById("wsAnnounceReplaced").checked  = !!wsConfig.announceReplaced;
  document.getElementById("wsAnnounceRejected").checked  = !!wsConfig.announceRejected;
  wsBuildPermGrid();
  wsUpdateButtons();
  wsSetStatus("disconnected", "");
}

// ── Wire up ───────────────────────────────────────────────────
(function initWs() {
  wsPopulateInputs();

  const urlEl    = document.getElementById("wsUrl");
  const secretEl = document.getElementById("wsSecret");
  const maxEl    = document.getElementById("wsMaxPerUser");

  urlEl.addEventListener("input", () => { wsConfig.url = urlEl.value; wsSaveConfig(); });
  // The secret stays type="password" at all times — never revealed, even while
  // focused/typing, so an onlooker can't read it off the screen.
  secretEl.addEventListener("input", () => { wsConfig.secret = secretEl.value; wsSaveConfig(); });

  maxEl.addEventListener("input", () => {
    wsConfig.maxPerUser = Math.max(0, parseInt(maxEl.value) || 0);
    wsSaveConfig();
  });

  document.getElementById("wsLimitReject").addEventListener("change", e => {
    if (e.target.checked) { wsConfig.limitMode = "reject"; wsSaveConfig(); }
  });
  document.getElementById("wsLimitReplace").addEventListener("change", e => {
    if (e.target.checked) { wsConfig.limitMode = "replace"; wsSaveConfig(); }
  });
  document.getElementById("wsAppendUsername").addEventListener("change", e => {
    wsConfig.appendUsername = e.target.checked; wsSaveConfig();
  });
  document.getElementById("wsAnnounceWinner").addEventListener("change", e => {
    wsConfig.announceWinner = e.target.checked; wsSaveConfig();
  });
  document.getElementById("wsAnnounceReplaced").addEventListener("change", e => {
    wsConfig.announceReplaced = e.target.checked; wsSaveConfig();
  });
  document.getElementById("wsAnnounceRejected").addEventListener("change", e => {
    wsConfig.announceRejected = e.target.checked; wsSaveConfig();
  });

  document.getElementById("wsConnectBtn").onclick    = wsConnect;
  document.getElementById("wsDisconnectBtn").onclick = wsDisconnect;

  const quickBtn = document.getElementById("wsQuickBtn");
  if (quickBtn) quickBtn.onclick = wsToggleConnection;
})();
