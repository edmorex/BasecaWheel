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
// dragSrcIdx  — list index of the row being dragged; null when idle.
// dragLastY   — last cursor Y (viewport px) seen during any dragover.
// dragScrollId— rAF handle for the auto-scroll loop; null when stopped.
let dragSrcIdx   = null;
let dragLastY    = 0;
let dragScrollId = null;

// Track cursor position globally so the scroll loop can read it even when
// the pointer moves faster than dragover events fire on individual rows.
// passive:true avoids blocking the browser's own scroll handling.
document.addEventListener("dragover", e => { dragLastY = e.clientY; }, { passive: true });

function startDragScroll() {
  const ZONE  = 36; // px from container edge that triggers scrolling
  const SPEED = 10; // max px scrolled per frame (scales with proximity)
  function loop() {
    if (dragSrcIdx === null) { dragScrollId = null; return; }
    const rect = wheelListEl.getBoundingClientRect();
    const relY = dragLastY - rect.top;
    if (relY < ZONE) {
      // Near the top edge — scroll up, faster the closer to the edge.
      wheelListEl.scrollTop -= Math.ceil(SPEED * (1 - relY / ZONE));
    } else if (relY > rect.height - ZONE) {
      // Near the bottom edge — scroll down.
      wheelListEl.scrollTop += Math.ceil(SPEED * (1 - (rect.height - relY) / ZONE));
    }
    dragScrollId = requestAnimationFrame(loop);
  }
  if (dragScrollId === null) dragScrollId = requestAnimationFrame(loop);
}

function stopDragScroll() {
  if (dragScrollId !== null) { cancelAnimationFrame(dragScrollId); dragScrollId = null; }
}

function renderWheelList() {
  wheelListEl.innerHTML = "";
  wheelList.forEach((wheel, idx) => {
    const row = document.createElement("div");
    row.className = "wheel-row" + (wheel.id === activeSlot ? " active-wheel" : "");
    row.draggable = true;

    // ── Drag-and-drop ────────────────────────────────────────
    row.addEventListener("dragstart", e => {
      dragSrcIdx = idx;
      e.dataTransfer.effectAllowed = "move";
      // Defer adding .dragging so the browser can snapshot the un-faded row
      // as the drag ghost image before the style change takes effect.
      setTimeout(() => row.classList.add("dragging"), 0);
      startDragScroll();
    });

    row.addEventListener("dragend", () => {
      dragSrcIdx = null;
      stopDragScroll();
      row.classList.remove("dragging");
      wheelListEl.querySelectorAll(".wheel-row").forEach(r =>
        r.classList.remove("drag-over-top", "drag-over-bottom")
      );
    });

    row.addEventListener("dragover", e => {
      e.preventDefault();
      if (dragSrcIdx === null || dragSrcIdx === idx) return;
      const mid   = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      const isTop = e.clientY < mid;
      wheelListEl.querySelectorAll(".wheel-row").forEach(r =>
        r.classList.remove("drag-over-top", "drag-over-bottom")
      );
      row.classList.add(isTop ? "drag-over-top" : "drag-over-bottom");
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over-top", "drag-over-bottom");
    });

    row.addEventListener("drop", e => {
      e.preventDefault();
      stopDragScroll();
      if (dragSrcIdx === null || dragSrcIdx === idx) return;
      const mid    = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      const isTop  = e.clientY < mid;
      let target   = isTop ? idx : idx + 1;
      if (dragSrcIdx < target) target--; // account for the spliced-out element
      const [moved] = wheelList.splice(dragSrcIdx, 1);
      wheelList.splice(target, 0, moved);
      dragSrcIdx = null;
      saveWheelList();
      renderWheelList();
    });

    // ── Drag handle ──────────────────────────────────────────
    const handle = document.createElement("span");
    handle.className   = "wheel-drag-handle";
    handle.textContent = "⠿";

    // ── Title input ──────────────────────────────────────────
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

    // ── Delete button ─────────────────────────────────────────
    const deleteBtn       = document.createElement("button");
    deleteBtn.className = "remove-btn";
    deleteBtn.innerHTML = '<img src="icons/circle-x.svg" class="btn-icon" alt="">';
    deleteBtn.onclick     = e => { e.stopPropagation(); deleteWheel(wheel.id); };

    // ── Row click activates wheel ─────────────────────────────
    // Clicks on the title input or delete button are handled by those
    // elements directly; clicks everywhere else (handle, padding) switch
    // the active wheel.
    row.addEventListener("click", e => {
      if (e.target === titleInput || e.target === deleteBtn) return;
      if (spinning) return;
      saveCurrentSlot();
      activateSlot(wheel.id);
    });

    row.appendChild(handle);
    row.appendChild(titleInput);
    row.appendChild(deleteBtn);
    wheelListEl.appendChild(row);
  });

  const addInline = document.createElement("div");
  addInline.className   = "wheel-add-inline";
  addInline.textContent = "— Add Wheel —";
  addInline.onclick     = () => addWheel("");
  wheelListEl.appendChild(addInline);

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
  // Save the add-input reference before innerHTML wipes it.
  // Setting innerHTML="" detaches the element but the JS object (and its
  // event listeners) survive; we re-append it as the last child below.
  const addInput = document.getElementById("nameInput");
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
    minus.className = "weight-btn"; minus.innerHTML = '<img src="icons/circle-minus.svg" class="btn-icon" alt="">';
    const plus   = document.createElement("button");
    plus.className  = "weight-btn"; plus.innerHTML  = '<img src="icons/circle-plus.svg"  class="btn-icon" alt="">';
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
    removeBtn.className = "remove-btn"; removeBtn.innerHTML = '<img src="icons/circle-x.svg" class="btn-icon" alt="">';
    removeBtn.onclick     = () => {
      entrants.splice(index, 1);
      saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
    };

    row.appendChild(nameInput); row.appendChild(ctrl); row.appendChild(removeBtn);
    entrantListEl.appendChild(row);
  });
  if (addInput) entrantListEl.appendChild(addInput);
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
  const input = document.getElementById("nameInput");
  const raw   = input.value.trim();
  if (!raw) return;
  entrants.push(parseEntrantInput(raw));
  saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
  input.value = "";
  input.focus();
  // Scroll the list down so the newly added row is visible just above the input.
  requestAnimationFrame(() => {
    entrantListEl.scrollTop = entrantListEl.scrollHeight;
    updateScrollFades();
  });
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
    const el = document.getElementById(k);
    if (el.type === "checkbox") el.checked = !!settings[k];
    else                        el.value   = settings[k];
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

// PITFALL — SETTINGS_DEFAULTS includes customImages, customSounds, and the
// boolean feature flags. Guard against null.addEventListener() for the
// object-valued keys, and read .checked (not .value) for checkboxes.
const WINNER_ACTION_KEYS = ["autoRemoveWinner", "autoDecrementWinner", "setWinnerToOne"];
Object.keys(SETTINGS_DEFAULTS).forEach(k => {
  if (k === "customImages" || k === "customSounds") return;
  const el = document.getElementById(k);
  el.addEventListener("input", () => {
    settings[k] = el.type === "checkbox"
      ? el.checked
      : Math.max(0, parseInt(el.value) || 0);
    // The three winner-action flags are mutually exclusive: turning one on
    // automatically turns the other two off.
    if (WINNER_ACTION_KEYS.includes(k) && el.checked) {
      WINNER_ACTION_KEYS.forEach(other => {
        if (other !== k) {
          settings[other] = false;
          document.getElementById(other).checked = false;
        }
      });
    }
    saveCurrentSlot();
  });
});

// "Restore Weights" resets only the Chances sliders, leaving feature flags
// and custom images/sounds untouched.
document.getElementById("defaultsBtn").onclick = () => {
  ["speedChance","slowChance","swapChance","reverseChance","explodeChance","spinTime"]
    .forEach(k => { settings[k] = SETTINGS_DEFAULTS[k]; });
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
    label.className = "snd-label";
    label.innerHTML = `<img src="icons/${SOUND_LABELS[key].icon}.svg" class="label-icon" alt="">${SOUND_LABELS[key].text}`;

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
    header.className = "img-state-header";
    header.innerHTML = `<img src="icons/${IMAGE_STATE_LABELS[state].icon}.svg" class="label-icon" alt="">${IMAGE_STATE_LABELS[state].text}`;
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
    addBtn.innerHTML = '<img src="icons/circle-plus.svg" class="btn-icon" alt="">';
    addBtn.className = "img-add-btn";
    addBtn.title     = "Add image";
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

    const galleryBtn = document.createElement("button");
    galleryBtn.innerHTML = '<img src="icons/image.svg" class="btn-icon" alt="">';
    galleryBtn.className = "img-gallery-btn";
    galleryBtn.title     = "Browse images folder";
    galleryBtn.onclick   = () => openImageGallery(state);

    addRow.appendChild(input);
    addRow.appendChild(galleryBtn);
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
  removeBtn.innerHTML = '<img src="icons/circle-x.svg" class="btn-icon" alt="">';
  removeBtn.className = "img-remove-btn";
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

// ── Image gallery ─────────────────────────────────────────────
// Browses images/manifest.json (regenerated by serve.py on startup) and
// lets the user pick a bundled image to add to the active image state.
const imageGalleryOverlay = document.getElementById("imageGalleryOverlay");
let galleryState       = null; // which image state the picked image is added to
let gallerySelectedUrl = null;

async function openImageGallery(state) {
  galleryState       = state;
  gallerySelectedUrl = null;
  const grid = document.getElementById("galleryGrid");
  grid.innerHTML = '<div class="gallery-empty">Loading…</div>';
  imageGalleryOverlay.classList.add("show");

  let files = [];
  try {
    const res = await fetch("images/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    files = await res.json();
  } catch {
    grid.innerHTML = '<div class="gallery-empty">Could not load images/manifest.json.<br>Run via serve.py to generate it.</div>';
    return;
  }

  grid.innerHTML = "";
  if (!files.length) {
    grid.innerHTML = '<div class="gallery-empty">No images found.</div>';
    return;
  }

  files.forEach(name => {
    const url  = "images/" + name;
    const cell = document.createElement("div");
    cell.className = "gallery-item";

    const img = document.createElement("img");
    img.src     = url;
    img.alt     = name;
    img.loading = "lazy";

    const cap = document.createElement("div");
    cap.className   = "gallery-caption";
    cap.textContent = name;

    cell.appendChild(img);
    cell.appendChild(cap);
    cell.onclick = () => {
      grid.querySelectorAll(".gallery-item.selected")
          .forEach(c => c.classList.remove("selected"));
      cell.classList.add("selected");
      gallerySelectedUrl = url;
    };
    cell.ondblclick = () => { gallerySelectedUrl = url; confirmImageGallery(); };
    grid.appendChild(cell);
  });
}

function closeImageGallery() {
  imageGalleryOverlay.classList.remove("show");
  galleryState       = null;
  gallerySelectedUrl = null;
}

function confirmImageGallery() {
  if (!gallerySelectedUrl || !galleryState) { closeImageGallery(); return; }
  const state = galleryState;
  if (!settings.customImages) settings.customImages = {};
  if (!Array.isArray(settings.customImages[state])) settings.customImages[state] = [];
  settings.customImages[state].push(gallerySelectedUrl);
  rebuildEmojiVariantsFromSettings();
  saveCurrentSlot();
  closeImageGallery();
  renderImageSettings();
}

document.getElementById("galleryCancel").onclick  = closeImageGallery;
document.getElementById("galleryConfirm").onclick = confirmImageGallery;
imageGalleryOverlay.addEventListener("click", e => {
  if (e.target === imageGalleryOverlay) closeImageGallery();
});

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
function confirmDialog(message, onConfirm, confirmLabel = "Delete") {
  document.getElementById("modalMsg").textContent     = message;
  document.getElementById("modalConfirm").textContent = confirmLabel;
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
    return { id: w.id, title: w.title, entrants: slot.entrants, settings: slot.settings,
             history: Array.isArray(slot.history) ? slot.history : [] };
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
      history: Array.isArray(w.history) ? w.history : [],
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

// rawDataSaveBtn and rawDataLoadBtn removed — file save/load moved to wheel section buttons.

// ── Control wiring ────────────────────────────────────────────
document.getElementById("shuffleBtn").onclick = () => {
  if (entrants.length < 2) return;
  for (let i = entrants.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entrants[i], entrants[j]] = [entrants[j], entrants[i]];
  }
  saveEntrants(); renderEntrants(); resetWheelState();
};

document.getElementById("minusAllBtn").onclick = () => {
  entrants.forEach(e => { e.weight = Math.max(1, e.weight - 1); });
  saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
};

document.getElementById("plusAllBtn").onclick = () => {
  entrants.forEach(e => { e.weight++; });
  saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
};

document.getElementById("allToOneBtn").onclick = () => {
  if (!entrants.length) return;
  confirmDialog("Set all entrant weights to 1?", () => {
    entrants.forEach(e => { e.weight = 1; });
    saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
  }, "Yes");
};

document.getElementById("clearBtn").onclick = () => {
  confirmDialog("Clear all entrants from this wheel?", () => {
    entrants = []; saveEntrants(); renderEntrants(); updateStats(); resetWheelState();
  }, "Yes");
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

document.getElementById("clearHistoryBtn").onclick = () => {
  if (!winnerHistory.length) return;
  confirmDialog("Clear the winner history for this wheel?", () => {
    winnerHistory = [];
    if (settings.keepWinnersLog) saveCurrentSlot();
    renderHistory();
  }, "Yes");
};

document.getElementById("saveWheelsBtn").onclick = () => {
  const blob  = new Blob([JSON.stringify(exportAllData(), null, 2)], { type: "application/json" });
  const url   = URL.createObjectURL(blob);
  const d     = new Date();
  const pad   = n => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const a     = document.createElement("a");
  a.href      = url;
  a.download  = `bascawheel-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

document.getElementById("loadWheelsBtn").onclick = () => rawDataFileInput.click();
rawDataFileInput.onchange = async () => {
  const file = rawDataFileInput.files[0];
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch (e) {
    alert("Could not read file: " + e.message);
    rawDataFileInput.value = "";
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    alert("Invalid JSON: " + e.message);
    rawDataFileInput.value = "";
    return;
  }
  try {
    importAllData(parsed);
  } catch (e) {
    alert("Import failed: " + e.message);
  }
  rawDataFileInput.value = ""; // reset so re-selecting the same file fires change
};

// ── Sidebar toggle ────────────────────────────────────────────
// wheelSnap holds the frozen-canvas <img> while a sidebar transition is
// running. Kept module-level so a rapid double-click can clean it up.
let wheelSnap = null;

panelToggle.onclick = () => {
  // ── Freeze wheel panel ──────────────────────────────────────
  // Clean up any previous snap from a rapid re-click.
  if (wheelSnap) {
    wheelSnap.remove();
    wheelSnap = null;
    canvas.style.opacity     = "";
    wheelEmoji.style.opacity = "";
    pointer.style.opacity    = "";
  }

  // Snapshot the current canvas content into an <img> that covers the
  // entire wheel panel. This stays visible and stable while the grid
  // animates, hiding the stretched live canvas, displaced emoji, and
  // mis-positioned pointer.
  // Capture CSS dimensions before any layout change happens.
  const snapRect = canvas.getBoundingClientRect();
  const snapW    = snapRect.width;
  const snapH    = snapRect.height;

  wheelSnap     = document.createElement("img");
  wheelSnap.src = canvas.toDataURL();
  // Fixed pixel size + centered: the snapshot stays the same visual size
  // throughout the animation while the panel grows/shrinks around it.
  // No object-fit stretching, no oval distortion.
  Object.assign(wheelSnap.style, {
    position:      "absolute",
    top:           "50%",
    left:          "50%",
    transform:     "translate(-50%, -50%)",
    width:         snapW + "px",
    height:        snapH + "px",
    zIndex:        "6",   // above canvas (z-index:5), below title/overlays
    pointerEvents: "none",
    opacity:       "1",
  });
  wheelWrap.appendChild(wheelSnap);

  // Hide the live elements instantly — they'll fade back in after resize.
  canvas.style.opacity     = "0";
  wheelEmoji.style.opacity = "0";
  pointer.style.opacity    = "0";

  // ── Animate sidebar ─────────────────────────────────────────
  sidebarVisible = !sidebarVisible;
  if (!sidebarVisible) {
    sidebarWrapper.style.width = "0px";
    document.querySelector(".app").classList.add("sidebar-collapsed");
    panelToggle.innerHTML = '<img src="icons/chevron-right.svg" class="btn-icon" alt="">';
    panelToggle.title     = "Show panel";
  } else {
    sidebarWrapper.style.width = "520px";
    document.querySelector(".app").classList.remove("sidebar-collapsed");
    panelToggle.innerHTML = '<img src="icons/chevron-left.svg" class="btn-icon" alt="">';
    panelToggle.title     = "Hide panel";
  }

  // ── Restore wheel panel ─────────────────────────────────────
  sidebarWrapper.addEventListener("transitionend", function onDone() {
    sidebarWrapper.removeEventListener("transitionend", onDone);

    // Recompute canvas size and redraw at the new dimensions.
    resizeCanvas();

    // Crossfade: snapshot out, live elements in.
    const FADE = "opacity 0.2s ease";
    const snap = wheelSnap; // capture ref in case of re-click during fade
    if (snap) snap.style.transition = FADE;
    canvas.style.transition     = FADE;
    wheelEmoji.style.transition = FADE;
    pointer.style.transition    = FADE;

    if (snap) snap.style.opacity = "0";
    canvas.style.opacity         = "1";
    wheelEmoji.style.opacity     = "1";
    pointer.style.opacity        = "1";

    setTimeout(() => {
      if (snap) { snap.remove(); if (wheelSnap === snap) wheelSnap = null; }
      canvas.style.transition     = "";
      wheelEmoji.style.transition = "";
      pointer.style.transition    = "";
      canvas.style.opacity        = "";
      wheelEmoji.style.opacity    = "";
      pointer.style.opacity       = "";
    }, 250);
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
  const entry = settings.keepWinnersLog
    ? `${new Date().toLocaleDateString("sv")} ${name}` // "sv" locale gives YYYY-MM-DD
    : name;
  winnerHistory.push(entry);
  if (settings.keepWinnersLog) saveCurrentSlot();
  renderHistory();
}

historyBtn.onclick = () => {
  const nowHidden = historyList.classList.toggle("hidden");
  historyBtn.classList.toggle("active", !nowHidden);
};

// ── Mute ──────────────────────────────────────────────────────
muteBtn.onclick = () => {
  muted = !muted;
  muteBtn.innerHTML = muted
    ? '<img src="icons/volume-x.svg" class="btn-icon" alt="">'
    : '<img src="icons/volume-2.svg" class="btn-icon" alt="">';
  muteBtn.title = muted ? "Unmute sounds" : "Mute sounds";
  if (muted) {
    if (bgFadeId) { clearTimeout(bgFadeId); bgFadeId = null; }
    stopBg();
  } else if (spinning) {
    initAudio().then(startBg);
  }
};

// ── Section divider (wheels ↔ entrants) ──────────────────────
// Persists the wheel-list height in localStorage so the split is
// remembered across page reloads.
const DIVIDER_KEY = "basca_divider_h";
const DIVIDER_MIN = 42; // px — room for at least one row

function applyDividerHeight(h) {
  wheelListEl.style.height = h + "px";
}

// Restore saved height (falls back to 110 — the CSS default).
applyDividerHeight(parseInt(localStorage.getItem(DIVIDER_KEY)) || 110);

(function initDivider() {
  const divider = document.getElementById("sectionDivider");
  let startY  = 0;
  let startH  = 0;
  let maxDragH = 500; // computed fresh each mousedown/touchstart

  function onMove(e) {
    const y    = e.touches ? e.touches[0].clientY : e.clientY;
    const newH = Math.min(maxDragH, Math.max(DIVIDER_MIN, startH + (y - startY)));
    applyDividerHeight(newH);
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup",   onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend",  onUp);
    document.body.classList.remove("resizing-v");
    localStorage.setItem(DIVIDER_KEY, parseInt(wheelListEl.style.height));
    updateWheelScrollFades();
    updateScrollFades();
  }

  function onDown(clientY) {
    startY = clientY;
    startH = parseInt(wheelListEl.style.height) || 110;

    // Max = current wheel-list height + however much the entrant-section can
    // give up before it can no longer show a single entrant row (~44px + padding).
    // Measured once here so the ceiling stays stable for the whole drag gesture.
    const entrantSection = sidebarWrapper.querySelector(".entrant-section");
    const headroom = entrantSection ? Math.max(0, entrantSection.clientHeight - 50) : 0;
    maxDragH = startH + headroom;

    document.body.classList.add("resizing-v");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend",  onUp);
  }

  divider.addEventListener("mousedown",  e => { e.preventDefault(); onDown(e.clientY); });
  divider.addEventListener("touchstart", e => { e.preventDefault(); onDown(e.touches[0].clientY); },
    { passive: false });
})();
