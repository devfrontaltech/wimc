import {
  onAuth, logoutUser,
  listenCars, addCar, updateCar, deleteCar,
  saveParking, deleteParking,
  reverseGeocode,
} from "./firebase.js";
import { t, lang } from "./i18n.js";

// ─────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────
let currentUser    = null;
let cars           = [];
let selectedCarId  = null;
let map            = null;
let markers        = {};
let pendingLatLng  = null;
let editingCarId   = null;
let unsubCars      = null;
let panelOpen      = true;
let searchDebounce = null;
let userMarker     = null;
let watchId        = null;

const CAR_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316",
];

// ─────────────────────────────────────────────────────────
//  Auth guard
// ─────────────────────────────────────────────────────────
onAuth((user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  initApp();
});

// ─────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────
function initApp() {
  applyI18nStatic();
  initMap();
  listenToCars();
  bindUI();
}

// Apply static i18n strings to HTML elements
function applyI18nStatic() {
  document.getElementById("search-input").placeholder  = t.searchPlaceholder;
  document.getElementById("logout-btn").title          = t.logout;
  document.querySelector("#panel .brand-small-name").textContent = t.brand;
  document.querySelector("#panel .section-label").textContent    = t.myCars;
  document.getElementById("add-car-btn").lastChild.textContent   = " " + t.addCar;
  document.querySelectorAll(".section-label")[1].textContent     = t.currentParking;
  document.getElementById("save-gps-btn").lastChild.textContent  = " " + t.parkHereGps;
  document.getElementById("map-hint").textContent                = t.mapClickHint;
  // Modals
  document.getElementById("modal-title").textContent            = t.addCarTitle;
  document.querySelector("#car-modal label[for='car-name-input']").textContent = t.carNameLabel;
  document.getElementById("car-name-input").placeholder         = t.carNamePlaceholder;
  document.querySelector("#car-modal .field:nth-child(3) label").textContent  = t.colorLabel;
  document.getElementById("modal-delete-btn").textContent       = t.deleteCar;
  document.getElementById("modal-save-btn").textContent         = t.save;
  document.querySelector("#confirm-modal h2").textContent       = t.confirmParkingTitle;
  document.getElementById("confirm-address").textContent        = t.gettingAddress;
  document.querySelector("#confirm-modal label[for='confirm-reference-input']").textContent = t.referenceLabel;
  document.getElementById("confirm-reference-input").placeholder = t.referencePlaceholder;
  document.getElementById("confirm-cancel-btn").textContent     = t.cancel;
  document.getElementById("confirm-save-btn").textContent       = t.save;
  document.querySelector("#logout-modal h2").textContent        = t.logoutTitle;
  document.querySelector("#logout-modal p").textContent         = t.logoutConfirmText;
  document.getElementById("logout-cancel-btn").textContent      = t.cancel;
  document.getElementById("logout-confirm-btn").textContent     = t.logoutConfirm;
}

// ─────────────────────────────────────────────────────────
//  Map
// ─────────────────────────────────────────────────────────
function initMap() {
  map = L.map("map", { zoomControl: false }).setView([40.416, -3.703], 6);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(map);

  if (navigator.geolocation) {
    let firstFix = true;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (firstFix) {
          map.setView([lat, lng], 15);
          firstFix = false;
        }
        updateUserMarker(lat, lng);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  }

  map.on("click", (e) => {
    if (!selectedCarId) {
      showHint(t.hintSelectCar);
      return;
    }
    openConfirmModal(e.latlng.lat, e.latlng.lng);
  });
}

function updateUserMarker(lat, lng) {
  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.circleMarker([lat, lng], {
      radius:      9,
      color:       "#fff",
      weight:      2.5,
      fillColor:   "#3b82f6",
      fillOpacity: 1,
      pane:        "markerPane",
    }).addTo(map);
  }
}

function makeMarker(car) {
  if (!car.parking) return null;
  const { lat, lng } = car.parking;

  const icon = L.divIcon({
    className: "",
    iconSize:  [34, 34],
    iconAnchor:[17, 34],
    popupAnchor:[0, -34],
    html: `
      <div class="custom-pin">
        <div class="pin-pulse" style="background:${car.color}40;"></div>
        <div class="pin-body"  style="background:${car.color};"></div>
      </div>`,
  });

  const marker = L.marker([lat, lng], { icon }).addTo(map);
  marker.bindPopup(buildPopup(car), { maxWidth: 240 });
  return marker;
}

function buildPopup(car) {
  const p = car.parking;
  const locale = lang + (lang === "es" ? "-ES" : lang === "ca" ? "-ES" : "-GB");
  const time = p?.savedAt
    ? new Date(p.savedAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })
    : "";
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  return `
    <div class="popup-car-name" style="color:${car.color}">${car.name}</div>
    ${p?.reference ? `<div class="popup-address" style="font-weight:500;color:var(--text)">${escHtml(p.reference)}</div>` : ""}
    <div class="popup-address">${p?.address || t.noAddress}</div>
    ${time ? `<div class="popup-time">${t.parkedOn} ${time}</div>` : ""}
    <a class="popup-directions-btn" href="${gmapsUrl}" target="_blank" rel="noopener">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
      </svg>
      ${t.directions}
    </a>
  `;
}

function refreshMarkers() {
  Object.values(markers).forEach((m) => m && m.remove());
  markers = {};
  cars.forEach((car) => {
    if (car.parking) markers[car.id] = makeMarker(car);
  });
}

// ─────────────────────────────────────────────────────────
//  Legend
// ─────────────────────────────────────────────────────────
function renderLegend() {
  const legend = document.getElementById("map-legend");
  const parked = cars.filter((c) => c.parking?.reference);

  if (!parked.length) {
    legend.classList.add("hidden");
    return;
  }

  legend.classList.remove("hidden");
  legend.innerHTML = parked.map((car) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${car.color}"></span>
      <span class="legend-label">${escHtml(car.parking.reference)}</span>
    </div>
  `).join("");
}

// ─────────────────────────────────────────────────────────
//  Panel toggle
// ─────────────────────────────────────────────────────────
function togglePanel() {
  panelOpen = !panelOpen;
  const panel     = document.getElementById("panel");
  const toggle    = document.getElementById("panel-toggle");
  const container = document.getElementById("map-container");

  panel.classList.toggle("collapsed", !panelOpen);
  toggle.classList.toggle("collapsed", !panelOpen);
  container.classList.toggle("panel-hidden", !panelOpen);

  setTimeout(() => map.invalidateSize(), 310);
}

// ─────────────────────────────────────────────────────────
//  Street search
// ─────────────────────────────────────────────────────────
function initSearch() {
  const input   = document.getElementById("search-input");
  const results = document.getElementById("search-results");

  input.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (!q) { results.classList.add("hidden"); results.innerHTML = ""; return; }
    searchDebounce = setTimeout(() => doSearch(q), 400);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      results.classList.add("hidden");
      results.innerHTML = "";
    }
  });
}

async function doSearch(query) {
  const results = document.getElementById("search-results");
  results.innerHTML = `<div class="panel-search-spinner">${t.searching}</div>`;
  results.classList.remove("hidden");

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1`;
    const res  = await fetch(url, { headers: { "Accept-Language": lang } });
    const data = await res.json();

    if (!data.length) {
      results.innerHTML = `<div class="panel-search-spinner">${t.noResults}</div>`;
      return;
    }

    results.innerHTML = "";
    data.forEach((place) => {
      const item = document.createElement("div");
      item.className = "panel-search-result";

      const parts = place.display_name.split(",");
      const title = parts[0].trim();
      const sub   = parts.slice(1, 3).join(",").trim();

      item.innerHTML = `<strong>${escHtml(title)}</strong>${sub ? escHtml(sub) : ""}`;
      item.addEventListener("click", () => {
        map.flyTo([parseFloat(place.lat), parseFloat(place.lon)], 16, { duration: 1.2 });
        document.getElementById("search-input").value = title;
        results.classList.add("hidden");
      });
      results.appendChild(item);
    });
  } catch {
    results.innerHTML = `<div class="panel-search-spinner">${t.searchError}</div>`;
  }
}

// ─────────────────────────────────────────────────────────
//  Cars (Firestore listener)
// ─────────────────────────────────────────────────────────
function listenToCars() {
  if (unsubCars) unsubCars();
  unsubCars = listenCars(currentUser.uid, (updatedCars) => {
    cars = updatedCars.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (selectedCarId && !cars.find((c) => c.id === selectedCarId)) {
      selectedCarId = cars[0]?.id || null;
    }
    if (!selectedCarId && cars.length) selectedCarId = cars[0].id;
    renderCarsList();
    refreshMarkers();
    renderParkingInfo();
    renderLegend();
    updateSaveBtn();
  });
}

// ─────────────────────────────────────────────────────────
//  Render
// ─────────────────────────────────────────────────────────
function renderCarsList() {
  const list = document.getElementById("cars-list");
  list.innerHTML = "";

  if (!cars.length) {
    list.innerHTML = `<p style="font-size:12px;color:var(--text-muted);padding:4px 2px">${t.addCar}.</p>`;
    return;
  }

  cars.forEach((car) => {
    const item = document.createElement("div");
    item.className = "car-item" + (car.id === selectedCarId ? " active" : "");
    item.dataset.id = car.id;
    item.innerHTML = `
      <span class="car-dot" style="background:${car.color};color:${car.color}"></span>
      <span class="car-name">${escHtml(car.name)}</span>
      ${car.parking ? `<span class="car-parked-badge">${t.parkedBadge}</span>` : ""}
      <button class="car-edit-btn" title="${t.editCarTitle}" data-edit="${car.id}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>`;
    list.appendChild(item);
  });
}

function renderParkingInfo() {
  const info = document.getElementById("parking-info");
  const car  = cars.find((c) => c.id === selectedCarId);

  if (!car) {
    info.innerHTML = `<p class="parking-empty">${t.selectCarParking}</p>`;
    return;
  }

  if (!car.parking) {
    info.innerHTML = `<p class="parking-empty">${t.noParking(escHtml(car.name))}</p>`;
    return;
  }

  const p    = car.parking;
  const locale = lang + (lang === "es" ? "-ES" : lang === "ca" ? "-ES" : "-GB");
  const time = p.savedAt
    ? new Date(p.savedAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })
    : "";

  info.innerHTML = `
    <div class="parking-detail">
      ${p.reference ? `<div class="parking-address" style="color:var(--accent)">📍 ${escHtml(p.reference)}</div>` : ""}
      <div class="parking-address">${escHtml(p.address || t.noAddress)}</div>
      ${time ? `<div class="parking-time">${t.parkedOn} ${time}</div>` : ""}
      <div class="parking-coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
      <button class="btn-delete-parking" id="delete-parking-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/></svg>
        ${t.deleteParking}
      </button>
    </div>`;

  document.getElementById("delete-parking-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setSpinner(btn, true, t.deleteParking);
    try {
      await deleteParking(currentUser.uid, car.id);
    } finally {
      setSpinner(btn, false, t.deleteParking);
    }
  });
}

function updateSaveBtn() {
  document.getElementById("save-gps-btn").disabled = !selectedCarId;
}

// ─────────────────────────────────────────────────────────
//  Spinner helper
// ─────────────────────────────────────────────────────────
function setSpinner(btn, on, label) {
  btn.disabled = on;
  if (on) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-spinner-ring"></span>${t.saving}`;
  } else {
    btn.innerHTML = btn.dataset.originalHtml || label;
    delete btn.dataset.originalHtml;
  }
}

// ─────────────────────────────────────────────────────────
//  UI bindings
// ─────────────────────────────────────────────────────────
function bindUI() {
  document.getElementById("panel-toggle").addEventListener("click", togglePanel);

  document.getElementById("cars-list").addEventListener("click", (e) => {
    const editId = e.target.closest("[data-edit]")?.dataset.edit;
    if (editId) { openCarModal(editId); return; }
    const item = e.target.closest(".car-item");
    if (!item) return;
    selectedCarId = item.dataset.id;
    renderCarsList();
    renderParkingInfo();
    updateSaveBtn();
    const car = cars.find((c) => c.id === selectedCarId);
    if (car?.parking) map.flyTo([car.parking.lat, car.parking.lng], 16, { duration: 1 });
  });

  document.getElementById("add-car-btn").addEventListener("click", () => openCarModal(null));

  document.getElementById("save-gps-btn").addEventListener("click", () => {
    if (!selectedCarId) return;
    if (!navigator.geolocation) { alert(t.noGeoSupport); return; }
    const btn = document.getElementById("save-gps-btn");
    setSpinner(btn, true, t.parkHereGps);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSpinner(btn, false, t.parkHereGps);
        openConfirmModal(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setSpinner(btn, false, t.parkHereGps);
        alert(t.noGeoPermission);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  // Logout modal
  const openLogoutModal  = () => document.getElementById("logout-modal-overlay").classList.remove("hidden");
  const closeLogoutModal = () => document.getElementById("logout-modal-overlay").classList.add("hidden");

  document.getElementById("logout-btn").addEventListener("click", openLogoutModal);
  document.getElementById("logout-modal-close").addEventListener("click", closeLogoutModal);
  document.getElementById("logout-cancel-btn").addEventListener("click", closeLogoutModal);
  document.getElementById("logout-modal-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeLogoutModal();
  });
  document.getElementById("logout-confirm-btn").addEventListener("click", async () => {
    const btn = document.getElementById("logout-confirm-btn");
    setSpinner(btn, true, t.logoutConfirm);
    if (unsubCars) unsubCars();
    await logoutUser();
  });

  // Car modal
  document.getElementById("modal-close").addEventListener("click", closeCarModal);
  document.getElementById("car-modal-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeCarModal();
  });
  document.getElementById("modal-save-btn").addEventListener("click", saveCarModal);
  document.getElementById("modal-delete-btn").addEventListener("click", deleteCarModal);

  // Confirm parking modal
  document.getElementById("confirm-modal-close").addEventListener("click", closeConfirmModal);
  document.getElementById("confirm-cancel-btn").addEventListener("click", closeConfirmModal);
  document.getElementById("confirm-save-btn").addEventListener("click", confirmSaveParking);
  document.getElementById("confirm-modal-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeConfirmModal();
  });

  document.getElementById("confirm-reference-input").addEventListener("input", () => {
    const input = document.getElementById("confirm-reference-input");
    input.classList.remove("input-error");
    input.closest(".field").classList.remove("field-error");
  });

  initSearch();
}

// ─────────────────────────────────────────────────────────
//  Car modal
// ─────────────────────────────────────────────────────────
function openCarModal(carId) {
  editingCarId = carId;
  const car    = cars.find((c) => c.id === carId);

  document.getElementById("modal-title").textContent = car ? t.editCarTitle : t.addCarTitle;
  document.getElementById("car-name-input").value    = car?.name || "";
  document.getElementById("modal-error").classList.add("hidden");
  document.getElementById("modal-delete-btn").style.display = car ? "block" : "none";
  // Reset save button
  const saveBtn = document.getElementById("modal-save-btn");
  saveBtn.disabled = false;
  saveBtn.textContent = t.save;

  const picker     = document.getElementById("color-picker");
  picker.innerHTML = "";
  const usedColors   = cars.filter((c) => c.id !== carId).map((c) => c.color);
  const defaultColor = car?.color || CAR_COLORS.find((c) => !usedColors.includes(c)) || CAR_COLORS[0];

  CAR_COLORS.forEach((color) => {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "color-swatch" + (color === defaultColor ? " selected" : "");
    sw.style.background = color;
    sw.dataset.color = color;
    sw.title = color;
    sw.addEventListener("click", () => {
      picker.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
      sw.classList.add("selected");
    });
    picker.appendChild(sw);
  });

  document.getElementById("car-modal-overlay").classList.remove("hidden");
  setTimeout(() => document.getElementById("car-name-input").focus(), 50);
}

function closeCarModal() {
  document.getElementById("car-modal-overlay").classList.add("hidden");
  editingCarId = null;
}

async function saveCarModal() {
  const name  = document.getElementById("car-name-input").value.trim();
  const color = document.querySelector(".color-swatch.selected")?.dataset.color || CAR_COLORS[0];
  const errEl = document.getElementById("modal-error");

  if (!name) { errEl.textContent = t.errorEmptyName; errEl.classList.remove("hidden"); return; }
  errEl.classList.add("hidden");

  const btn = document.getElementById("modal-save-btn");
  setSpinner(btn, true, t.save);

  try {
    if (editingCarId) {
      await updateCar(currentUser.uid, editingCarId, { name, color });
    } else {
      const newId = await addCar(currentUser.uid, name, color);
      selectedCarId = newId;
    }
    closeCarModal();
  } catch {
    errEl.textContent = t.errorSave;
    errEl.classList.remove("hidden");
  } finally {
    setSpinner(btn, false, t.save);
  }
}

async function deleteCarModal() {
  if (!editingCarId) return;
  const car = cars.find((c) => c.id === editingCarId);
  if (!confirm(t.deletingCar(car?.name || ""))) return;

  const btn = document.getElementById("modal-delete-btn");
  setSpinner(btn, true, t.deleteCar);
  try {
    await deleteCar(currentUser.uid, editingCarId);
    if (selectedCarId === editingCarId) selectedCarId = cars.find((c) => c.id !== editingCarId)?.id || null;
    closeCarModal();
  } finally {
    setSpinner(btn, false, t.deleteCar);
  }
}

// ─────────────────────────────────────────────────────────
//  Confirm parking modal
// ─────────────────────────────────────────────────────────
async function openConfirmModal(lat, lng) {
  pendingLatLng = { lat, lng };
  const car = cars.find((c) => c.id === selectedCarId);

  document.getElementById("confirm-car-name").textContent = car?.name || "";
  document.getElementById("confirm-address").textContent  = t.gettingAddress;

  const refInput = document.getElementById("confirm-reference-input");
  refInput.value = "";
  refInput.classList.remove("input-error");
  refInput.closest(".field").classList.remove("field-error");

  // Reset save btn
  const saveBtn = document.getElementById("confirm-save-btn");
  saveBtn.disabled = false;
  saveBtn.textContent = t.save;

  document.getElementById("confirm-modal-overlay").classList.remove("hidden");

  if (markers["_pending"]) markers["_pending"].remove();
  markers["_pending"] = L.circleMarker([lat, lng], {
    radius: 8, color: car?.color || "#3b82f6", fillColor: car?.color || "#3b82f6", fillOpacity: 0.5,
  }).addTo(map);
  map.panTo([lat, lng]);

  const address = await reverseGeocode(lat, lng);
  document.getElementById("confirm-address").textContent = address;
  pendingLatLng.address = address;

  setTimeout(() => refInput.focus(), 50);
}

function closeConfirmModal() {
  document.getElementById("confirm-modal-overlay").classList.add("hidden");
  if (markers["_pending"]) { markers["_pending"].remove(); delete markers["_pending"]; }
  pendingLatLng = null;
}

async function confirmSaveParking() {
  if (!pendingLatLng || !selectedCarId) return;

  const refInput = document.getElementById("confirm-reference-input");
  const reference = refInput.value.trim();
  if (!reference) {
    refInput.classList.add("input-error");
    refInput.closest(".field").classList.add("field-error");
    refInput.focus();
    return;
  }

  const btn = document.getElementById("confirm-save-btn");
  setSpinner(btn, true, t.save);

  try {
    await saveParking(
      currentUser.uid,
      selectedCarId,
      pendingLatLng.lat,
      pendingLatLng.lng,
      pendingLatLng.address || "",
      reference
    );
    closeConfirmModal();
  } catch {
    alert(t.errorConnection);
  } finally {
    setSpinner(btn, false, t.save);
  }
}

// ─────────────────────────────────────────────────────────
//  Hint toast
// ─────────────────────────────────────────────────────────
let hintTimer = null;
function showHint(msg) {
  const el = document.getElementById("map-hint");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}

// ─────────────────────────────────────────────────────────
//  Util
// ─────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}