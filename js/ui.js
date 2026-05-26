// ── ui.js ──────────────────────────────────────────────────────
// Sidebar rendering, control wiring, settings modals, raw-data
// modal, confirmation modal, winner history, mute, and wheel list.
//
// LOAD ORDER: must come after constants.js, state.js, storage.js,
//             emoji.js, audio.js, wheel.js, spin.js.
// Reads:   COLORS, SETTINGS_DEFAULTS, DEFAULT_SOUNDS, SOUND_LABELS,
//          IMAGE_STATE_LABELS, DEFAULT_IMAGES, SLOT_KEY, EMOJI,
//          DEFAULT_ENTRANTS (constants.js)
//          EMOJI_VARIANTS (emoji.js)
// Reads/mutates: entrants, settings, slotTitle, spinning, winnerShowing,
//                nobodyWinsActive, currentRotation, wheelWrap, winnerOverlay,
//                winnerTitle, winnerName, winnerBox, wheelListEl, sidebarWrapper,
//                panelToggle, sidebarVisible, winnerHistory, wheelList, activeSlot,
//                muted, bgFadeId, audioCtx, rawDataOverlay, rawDataText,
//                rawDataError, rawDataFileInput (state.js)
// Calls:   setEmoji, rebuildEmojiVariantsFromSettings (emoji.js)
//          reloadSounds, initAudio, stopBg (audio.js)
//          drawWheel, updateWheelTitle, startIdleRotation, stopIdleRotation,
//          totalWeight, resizeCanvas (wheel.js)
//          stopConfettiBursts (spin.js)
//          activateSlot, saveCurrentSlot, saveWheelList, loadSlotData,
//          saveEntrants, newSlotId, defaultSlotData (storage.js)
//
// PITFALL — stopConfettiBursts is declared in spin.js, which loads before
// this file. If the load order ever changes, resetWheelState() will throw
// a "not defined" error at the first call that reaches that branch.
//
// PITFALL — spinWheel() is declared in spin.js and called from the canvas
// onclick handler here. Both are safe because handlers only fire after all
// scripts have evaluated (guaranteed by the HTML <script> load order).

// ── Local DOM ref ─────────────────────────────────────────────
// settingsOverlay is used in several files. Declaring it here as a global
// const (no 'var'/'let') so boot.js and spin.js can reference it too.
// spin.js currently uses document.getElementById() inline, which is fine.
const settingsOverlay = document.getElementById("settingsOverlay");

// ── Wheel list ────────────────────────────────────────────────
function renderWheelList() {
  wheelListEl.innerHTML = "";
  wheelList.forEach(wheel => {
    const row = document.createElement("div");
    row.className = "wheel-row" + (wheel.id === activeSlot ? " active-wheel" : "");

    const radio    = document.createElement("input");
    radio.type     = "radio";
    radio.name     = "activeWheel";
    radio.checked  = wheel.id === activeSlot;
    radio.onchange = () => {
      if (spinning) return;
      saveCurrentSlot();
      activateSlot(wheel.id);
    };

    const titleInput       = document.createElement("input");
    titleInput.type           = "text";
    titleInput.name           = "bw-wheel-title-row";
    titleInput.autocomplete   = "off";
    titleInput.autocapitalize = "off";
    titleInput.spellcheck     = false;
    titleInput.readOnly       = true; // Safari contact-autofill suppression
    titleInput.setAttribute("autocorrect",       "off");
    titleInput.setAttribute("aria-autocomplete", "none");
    titleInput.addEventListener("focus", () => { titleInput.readOnly = false; }, { once: true });
    titleInput.className   = "wheel-title-edit";
    titleInput.value       = wheel.title;
    titleInput.placeholder = "Wheel title…";
    titleInput.oninput     = () => {
      wheel.title = titleInput.value;
      saveWheelList();
      if (wheel.id === activeSlot) {
        slotTitle = wheel.title;
        updateWheelTitle();
        saveCurrentSlot();
      } else {
        // Persist the new title into the slot's own storage entry so that
        // loadSlotData() returns the correct title when this wheel is activated.
        const slotData = loadSlotData(wheel.id);
        slotData.title = wheel.title;
        localStorage.setItem(SLOT_KEY(wheel.id), JSON.stringify(slotData));
      }
    };

    const deleteBtn       = document.createElement("button");
    deleteBtn.className   = "remove-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.onclick     = () => deleteWheel(wheel.id);

    row.appendChild(radio);
    row.appendChild(titleInput);
    row.appendChild(deleteBtn);
    wheelListEl.appendChild(row);
  });
  requestAnimationFrame(updateWheelScrollFades);
}

function addWheel(title) {
  const id       = newSlotId();
  const newTitle = title.trim() || `Wheel ${wheelList.length + 1}`;
  wheelList.push({ id, title: newTitle });
  localStorage.setItem(SLOT_KEY(id), JSON.stringify({
    title:    newTitle,
    entrants: JSON.parse(JSON.stringify(DEFAULT_ENTRANTS)),
    settings: { ...SETTINGS_DEFAULTS },
  }));
  saveWheelList();
  saveCurrentSlot();
  activateSlot(id);
  wheelListEl.scrollTop = wheelListEl.scrollHeight;
}

function cloneWheel(sourceId) {
  const source = wheelList.find(w => w.id === sourceId);
  if (!source) return;
  const id       = newSlotId();
  const newTitle = source.title ? source.title + " (copy)" : "Copy";
  const srcData  = loadSlotData(sourceId);
  wheelList.push({ id, title: newTitle });
  localStorage.setItem(SLOT_KEY(id), JSON.stringify({ ...srcData, title: newTitle }));
  saveWheelList();
  saveCurrentSlot();
  activateSlot(id);
  wheelListEl.scrollTop = wheelListEl.scrollHeight;
}

function deleteWheel(id) {
  if (wheelList.length <= 1) {
    const idx = wheelList.findIndex(w => w.id === id);
    if (idx === -1) return;
    localStorage.removeItem(SLOT_KEY(id));
    wheelList.splice(idx, 1);
    saveWheelList();
    addWheel("Wheel 1");
    return;
  }
  const idx = wheelList.findIndex(w => w.id === id);
  if (idx === -1) return;
  wheelList.splice(idx, 1);
  localStorage.removeItem(SLOT_KEY(id));
  saveWheelList();
  if (activeSlot === id) {
    activateSlot(wheelList[Math.min(idx, wheelList.length - 1)].id);
  } else {
    renderWheelList();
  }
}

// ── Entrant list ──────────────────────────────────────────────
function renderEntrants() {
  entrantListEl.innerHTML = "";
  entrants.forEach((entrant, index) => {
    const row = document.createElement("div");
    row.className = "entrant";

    const nameInput       = document.createElement("input");
    nameInput.value          = entrant.name;
    nameInput.maxLength      = 256;
    nameInput.name           = "bw-entrant-row";
    nameInput.autocomplete   = "off";
    nameInput.autocapitalize = "off";
    nameInput.spellcheck     = false;
    nameInput.readOnly       = true; // Safari contact-autofill suppression
    nameInput.setAttribute("autocorrect",       "off");
    nameInput.setAttribute("aria-autocomplete", "none");
    nameInput.addEventListener("focus", () => { nameInput.readOnly = false; }, { once: true });
    nameInput.oninput = () => { entrant.name = nameInput.value; saveEntrants(); resetWheelState(); };

    const ctrl  = document.createElement("div");
    ctrl.className = "weight-control";

    const minus  = document.createElement("button");
    minus.className = "weight-btn"; minus.textContent = "−";
    const plus   = document.createElement("button");
    plus.className  = "weight-btn"; plus.textContent  = "+";
    const wInput = document.createElement("input");
    wInput.type = "number"; wInput.className = "weight-input"; wInput.value = entrant.weight;

    minus.onclick = () => {
      entrant.weight = Math.max(1, entrant.weight - 1);
      wInput.value   = entrant.weight;
      saveEntrants(); updateStats(); resetWheelState();
    };
    plus.onclick = () => {
      entrant.weight++;
      wInput.value = entrant.weight;
      saveEntrants(); updateStats(); resetWheelState();
    };
    wInput.oninput = () => {
      entrant.weight = Math.max(1, parseInt(wInput.value) || 1);
      wInput.value   = entrant.weight;
      saveEntrants(); updateStats(); resetWheelState();
    };

    ctrl.appendChild(minus); ctrl.appendChild(wInput); ctrl.appendChild(plus);

    const removeBtn       = document.createElement("button");
    removeBtn.className   = "remove-btn"; removeBtn.textContent = "✕";
    removeBtn.onclick     = () => {
      entrants.splice(index, 1);
      saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
    };

    row.appendChild(nameInput); row.appendChild(ctrl); row.appendChild(removeBtn);
    entrantListEl.appendChild(row);
  });
  requestAnimationFrame(updateScrollFades);
}

function updateStats() {
  statsDiv.innerHTML = `Total Entrants: <b>${entrants.length}</b> Total Weight: <b>${totalWeight()}</b>`;
}

function resetWheelState() {
  stopIdleRotation();
  stopConfettiBursts();
  currentRotation  = 0;
  spinning         = false;
  wasNearEdge      = false;
  nobodyWinsActive = false;
  winnerShowing    = false;
  wheelWrap.classList.remove("flames-paused");
  previousSliceIdx = -1;
  prevTickRotation = null;
  setEmoji("idle");
  winnerOverlay.classList.remove("show");
  drawWheel();
  startIdleRotation();
}

function parseEntrantInput(text) {
  let name = text.trim(), weight = 1;
  const m  = name.match(/^(.*?),\s*(\d+)$/);
  if (m) { name = m[1].trim(); weight = Math.max(1, parseInt(m[2])); }
  return { name, weight };
}

function addEntrant() {
  const raw = document.getElementById("nameInput").value.trim();
  if (!raw) return;
  entrants.push(parseEntrantInput(raw));
  saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
  document.getElementById("nameInput").value = "";
}

function dismissWinner() {
  winnerShowing    = false;
  nobodyWinsActive = false;
  wheelWrap.classList.remove("flames-paused");
  stopConfettiBursts();
  winnerOverlay.classList.remove("show");
  setEmoji("idle");
  startIdleRotation();
}

// ── Settings ──────────────────────────────────────────────────
function applySettingsToInputs() {
  Object.keys(SETTINGS_DEFAULTS).forEach(k => {
    if (k === "customImages" || k === "customSounds") return;
    document.getElementById(k).value = settings[k];
  });
  renderSoundSettings();
  renderImageSettings();
}

function updateSettingsFades() {
  const el  = document.getElementById("settingsPanelBody");
  const top = document.getElementById("settingsTopFade");
  const bot = document.getElementById("settingsBottomFade");
  if (!el || !top || !bot) return;
  top.classList.toggle("show", el.scrollTop > 4);
  bot.classList.toggle("show", el.scrollTop + el.clientHeight < el.scrollHeight - 4);
}

document.getElementById("settingsPanelBody").addEventListener("scroll", updateSettingsFades);

document.getElementById("settingsBtn").onclick = () => {
  if (winnerShowing) dismissWinner();
  settingsOverlay.classList.toggle("hidden");
  if (!settingsOverlay.classList.contains("hidden")) {
    renderImageSettings();
    requestAnimationFrame(updateSettingsFades);
  }
};

settingsOverlay.addEventListener("click", e => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add("hidden");
});

// PITFALL — SETTINGS_DEFAULTS includes customImages and customSounds, which
// have no matching <input> elements. Guard against null.addEventListener().
Object.keys(SETTINGS_DEFAULTS).forEach(k => {
  if (k === "customImages" || k === "customSounds") return;
  document.getElementById(k).addEventListener("input", () => {
    settings[k] = Math.max(0, parseInt(document.getElementById(k).value) || 0);
    saveCurrentSlot();
  });
});

document.getElementById("defaultsBtn").onclick = () => {
  const { customImages } = settings;
  settings = { ...SETTINGS_DEFAULTS, customImages };
  applySettingsToInputs();
  saveCurrentSlot();
};

document.getElementById("restoreImagesBtn").onclick = () => {
  if (!settings.customImages) settings.customImages = {};
  Object.keys(EMOJI).forEach(state => {
    settings.customImages[state] = [...DEFAULT_IMAGES[state]];
  });
  rebuildEmojiVariantsFromSettings();
  saveCurrentSlot();
  renderImageSettings();
};

// ── Sound settings UI ─────────────────────────────────────────
function renderSoundSettings() {
  const container = document.getElementById("sndSettingsContainer");
  if (!container) return;
  container.innerHTML = "";
  Object.keys(SOUND_LABELS).forEach(key => {
    const row = document.createElement("div");
    row.className = "snd-row";

    const label = document.createElement("div");
    label.className   = "snd-label";
    label.textContent = SOUND_LABELS[key];

    const effective = (settings.customSounds && key in settings.customSounds)
      ? settings.customSounds[key]
      : DEFAULT_SOUNDS[key];

    const input = document.createElement("input");
    input.type        = "text";
    input.className   = "snd-url-input";
    input.value       = effective;
    input.placeholder = DEFAULT_SOUNDS[key] || "sounds/file.wav or https://…";

    const commit = () => {
      const val     = input.value.trim();
      const current = (settings.customSounds && key in settings.customSounds)
        ? settings.customSounds[key] : DEFAULT_SOUNDS[key];
      if (val === current) return;
      if (!settings.customSounds) settings.customSounds = {};
      settings.customSounds[key] = val;
      saveCurrentSlot();
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter")  input.blur();
      if (e.key === "Escape") { input.value = effective; input.blur(); }
    });

    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  });
  requestAnimationFrame(updateSettingsFades);
}

document.getElementById("restoreSoundsBtn").onclick = () => {
  settings.customSounds = {};
  saveCurrentSlot();
  renderSoundSettings();
  if (audioCtx) reloadSounds();
};

// ── Image settings UI ─────────────────────────────────────────
function renderImageSettings() {
  const container = document.getElementById("imgSettingsContainer");
  if (!container) return;
  container.innerHTML = "";
  requestAnimationFrame(updateSettingsFades);

  Object.keys(IMAGE_STATE_LABELS).forEach(state => {
    const urls    = settings.customImages?.[state] ?? [];
    const section = document.createElement("div");
    section.className = "img-state-section";

    const header = document.createElement("div");
    header.className   = "img-state-header";
    header.textContent = IMAGE_STATE_LABELS[state];
    section.appendChild(header);

    if (urls.length > 0) {
      const list = document.createElement("div");
      list.className = "img-url-list";
      urls.forEach((url, idx) => list.appendChild(makeUrlRow(state, url, idx)));
      section.appendChild(list);
    }

    const addRow  = document.createElement("div");
    addRow.className = "img-add-row";
    const input   = document.createElement("input");
    input.type        = "text";
    input.className   = "img-url-input";
    input.placeholder = "images/relative.png  or full https://…";
    const addBtn  = document.createElement("button");
    addBtn.textContent = "Add";
    addBtn.className   = "primary img-add-btn";
    addBtn.onclick = () => {
      const val = input.value.trim();
      if (!val) return;
      if (!settings.customImages) settings.customImages = {};
      if (!Array.isArray(settings.customImages[state])) settings.customImages[state] = [];
      settings.customImages[state].push(val);
      input.value = "";
      rebuildEmojiVariantsFromSettings();
      saveCurrentSlot();
      renderImageSettings();
    };
    input.addEventListener("keydown", e => { if (e.key === "Enter") addBtn.click(); });

    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    section.appendChild(addRow);
    container.appendChild(section);
  });
}

function makeUrlRow(state, url, idx) {
  const row = document.createElement("div");
  row.className = "img-url-item";

  const input = document.createElement("input");
  input.type      = "text";
  input.className = "img-url-edit";
  input.value     = url;
  input.title     = url;

  const commit = () => {
    const val = input.value.trim();
    if (val === url) return;
    if (val) {
      settings.customImages[state][idx] = val;
    } else {
      settings.customImages[state].splice(idx, 1);
    }
    rebuildEmojiVariantsFromSettings();
    saveCurrentSlot();
    renderImageSettings();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter")  input.blur();
    if (e.key === "Escape") { input.value = url; input.blur(); }
  });

  const removeBtn       = document.createElement("button");
  removeBtn.textContent = "✕";
  removeBtn.className   = "img-remove-btn";
  removeBtn.onmousedown = e => e.preventDefault(); // keep input focused until click fires
  removeBtn.onclick     = () => {
    settings.customImages[state].splice(idx, 1);
    rebuildEmojiVariantsFromSettings();
    saveCurrentSlot();
    renderImageSettings();
  };

  row.appendChild(input);
  row.appendChild(removeBtn);
  return row;
}

// ── Scroll fades ──────────────────────────────────────────────
function updateScrollFades() {
  const { scrollTop, scrollHeight, clientHeight } = entrantListEl;
  topFade.classList.toggle("show",    scrollTop > 2);
  bottomFade.classList.toggle("show", scrollTop + clientHeight < scrollHeight - 2);
}
entrantListEl.addEventListener("scroll", updateScrollFades);

function updateWheelScrollFades() {
  const { scrollTop, scrollHeight, clientHeight } = wheelListEl;
  wheelTopFade.classList.toggle("show",    scrollTop > 2);
  wheelBottomFade.classList.toggle("show", scrollTop + clientHeight < scrollHeight - 2);
}
wheelListEl.addEventListener("scroll", updateWheelScrollFades);

// ── Confirmation modal ────────────────────────────────────────
function confirmDialog(message, onConfirm) {
  document.getElementById("modalMsg").textContent = message;
  document.getElementById("modalConfirm").onclick = () => { closeModal(); onConfirm(); };
  document.getElementById("modalOverlay").classList.add("show");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("show");
}

document.getElementById("modalCancel").onclick = closeModal;
document.getElementById("modalOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modalOverlay")) closeModal();
});

// ── Raw data backup / restore ─────────────────────────────────
function exportAllData() {
  saveCurrentSlot(); // flush in-memory state into localStorage first
  const wheels = wheelList.map(w => {
    let slot = defaultSlotData();
    try {
      const raw = localStorage.getItem(SLOT_KEY(w.id));
      if (raw) slot = JSON.parse(raw);
    } catch {}
    return { id: w.id, title: w.title, entrants: slot.entrants, settings: slot.settings };
  });
  return { version: 1, activeSlot, wheels };
}

function importAllData(payload) {
  if (!payload || typeof payload !== "object")
    throw new Error("Top-level value must be an object.");
  if (!Array.isArray(payload.wheels))
    throw new Error("'wheels' must be an array.");
  const cleaned = payload.wheels.filter(w => w && typeof w.id === "string" && w.id);
  if (!cleaned.length)
    throw new Error("'wheels' must contain at least one entry with a string 'id'.");

  // Wipe old per-slot keys so deletions are honoured
  wheelList.forEach(w => localStorage.removeItem(SLOT_KEY(w.id)));

  wheelList = cleaned.map(w => ({
    id:    w.id,
    title: typeof w.title === "string" ? w.title : "",
  }));
  cleaned.forEach(w => {
    const slot = {
      title:    typeof w.title === "string" ? w.title : "",
      entrants: Array.isArray(w.entrants) ? w.entrants : JSON.parse(JSON.stringify(DEFAULT_ENTRANTS)),
      settings: {
        ...SETTINGS_DEFAULTS,
        ...(w.settings && typeof w.settings === "object" ? w.settings : {}),
        customImages: { ...(w.settings?.customImages ?? {}) },
        customSounds: { ...(w.settings?.customSounds ?? {}) },
      },
    };
    localStorage.setItem(SLOT_KEY(w.id), JSON.stringify(slot));
  });
  saveWheelList();

  const targetActive = (typeof payload.activeSlot === "string"
    && wheelList.find(x => x.id === payload.activeSlot))
    ? payload.activeSlot
    : wheelList[0].id;
  activateSlot(targetActive);
  renderWheelList();
}

function openRawData() {
  rawDataText.value        = JSON.stringify(exportAllData(), null, 2);
  rawDataError.textContent = "";
  rawDataOverlay.classList.add("show");
}

function closeRawData() {
  rawDataOverlay.classList.remove("show");
  rawDataError.textContent = "";
  settingsOverlay.classList.add("hidden");
}

function applyRawData() {
  let parsed;
  try   { parsed = JSON.parse(rawDataText.value); }
  catch (e) { rawDataError.textContent = "Invalid JSON: " + e.message; return false; }
  try   { importAllData(parsed); }
  catch (e) { rawDataError.textContent = "Import failed: " + e.message; return false; }
  return true;
}

document.getElementById("rawDataBtn").onclick    = openRawData;
document.getElementById("rawDataApply").onclick  = () => { if (applyRawData()) closeRawData(); };
document.getElementById("rawDataCancel").onclick = closeRawData;
rawDataOverlay.addEventListener("click", e => {
  if (e.target === rawDataOverlay) closeRawData();
});

document.getElementById("rawDataSaveBtn").onclick = () => {
  const blob  = new Blob([rawDataText.value], { type: "application/json" });
  const url   = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const a     = document.createElement("a");
  a.href      = url;
  a.download  = `bascawheel-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

document.getElementById("rawDataLoadBtn").onclick = () => rawDataFileInput.click();
rawDataFileInput.onchange = async () => {
  const file = rawDataFileInput.files[0];
  if (!file) return;
  try {
    rawDataText.value        = await file.text();
    rawDataError.textContent = "";
  } catch (e) {
    rawDataError.textContent = "Could not read file: " + e.message;
  }
  rawDataFileInput.value = ""; // reset so re-selecting the same file fires change
};

// ── Control wiring ────────────────────────────────────────────
document.getElementById("addBtn").onclick = addEntrant;

document.getElementById("minusAllBtn").onclick = () => {
  entrants.forEach(e => { e.weight = Math.max(1, e.weight - 1); });
  saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
};

document.getElementById("plusAllBtn").onclick = () => {
  entrants.forEach(e => { e.weight++; });
  saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
};

document.getElementById("clearBtn").onclick = () => {
  confirmDialog("Clear all entrants from this wheel?", () => {
    entrants = []; saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
  });
};

document.getElementById("randomizeBtn").onclick = () => {
  if (entrants.length < 2) return;
  for (let i = entrants.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entrants[i], entrants[j]] = [entrants[j], entrants[i]];
  }
  saveEntrants(); renderEntrants(); resetWheelState();
};

document.getElementById("cloneActiveWheelBtn").onclick = () => cloneWheel(activeSlot);

document.getElementById("clearWheelsBtn").onclick = () => {
  confirmDialog("Delete all wheels and start fresh with one empty wheel?", () => {
    wheelList.forEach(w => localStorage.removeItem(SLOT_KEY(w.id)));
    const id = newSlotId();
    wheelList = [{ id, title: "Default" }];
    localStorage.setItem(SLOT_KEY(id), JSON.stringify(defaultSlotData()));
    saveWheelList();
    activateSlot(id);
  });
};

canvas.onclick = () => {
  settingsOverlay.classList.add("hidden");
  if (winnerShowing) { dismissWinner(); return; }
  spinWheel();
};

document.getElementById("nameInput").addEventListener("keydown", e => {
  if (e.key === "Enter") addEntrant();
});

document.getElementById("addWheelBtn").onclick = () => {
  const input = document.getElementById("wheelNameInput");
  addWheel(input.value);
  input.value = "";
};

document.getElementById("wheelNameInput").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    addWheel(e.target.value);
    e.target.value = "";
  }
});

// ── Sidebar toggle ────────────────────────────────────────────
panelToggle.onclick = () => {
  sidebarVisible = !sidebarVisible;
  if (!sidebarVisible) {
    sidebarWrapper.style.overflow = "hidden";
    sidebarWrapper.style.width    = "0px";
    document.querySelector(".app").classList.add("sidebar-collapsed");
    panelToggle.textContent = ">";
    panelToggle.title       = "Show panel";
  } else {
    sidebarWrapper.style.width = "520px";
    document.querySelector(".app").classList.remove("sidebar-collapsed");
    panelToggle.textContent = "<";
    panelToggle.title       = "Hide panel";
    sidebarWrapper.addEventListener("transitionend", function restore() {
      sidebarWrapper.style.overflow = "";
      sidebarWrapper.removeEventListener("transitionend", restore);
    });
  }
  sidebarWrapper.addEventListener("transitionend", function onDone() {
    resizeCanvas();
    sidebarWrapper.removeEventListener("transitionend", onDone);
  });
};

// ── Winner history ────────────────────────────────────────────
function renderHistory() {
  historyList.innerHTML = "";
  // Prepend each entry so DOM order is newest-first; column-reverse layout
  // then renders newest at the bottom (closest to the button).
  winnerHistory.forEach(name => {
    const item = document.createElement("div");
    item.className   = "history-item";
    item.textContent = name;
    historyList.insertBefore(item, historyList.firstChild);
  });
}

function addToHistory(name) {
  winnerHistory.push(name);
  renderHistory();
}

historyBtn.onclick = () => {
  const nowHidden = historyList.classList.toggle("hidden");
  historyBtn.classList.toggle("active", !nowHidden);
};

// ── Mute ──────────────────────────────────────────────────────
muteBtn.onclick = () => {
  muted = !muted;
  muteBtn.textContent = muted ? "🔇" : "🔊";
  muteBtn.title       = muted ? "Unmute sounds" : "Mute sounds";
  if (muted) {
    if (bgFadeId) { clearTimeout(bgFadeId); bgFadeId = null; }
    stopBg();
  } else if (spinning) {
    initAudio().then(startBg);
  }
};
