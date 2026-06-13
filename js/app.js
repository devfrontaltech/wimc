import {
  onAuth, logoutUser,
  listenCars, addCar, updateCar, deleteCar,
  saveParking, deleteParking,
  reverseGeocode,
} from "./firebase.js";

// ─────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────
let currentUser   = null;
let cars          = [];         // [{id, name, color, parking}]
let selectedCarId = null;
let map           = null;
let markers       = {};         // carId → L.Marker
let pendingLatLng = null;       // click-on-map coordinates pending confirmation
let editingCarId  = null;       // car being edited in modal
let unsubCars     = null;
let panelOpen     = true;       // panel visibility state
let searchDebounce = null;      // debounce timer for street search

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
  initMap();
  listenToCars();
  bindUI();
}

// ─────────────────────────────────────────────────────────
//  Map
// ─────────────────────────────────────────────────────────
function initMap() {
  map = L.map("map", { zoomControl: false }).setView([40.416, -3.703], 6);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(map);

  // Geolocation on load
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
      () => {},
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }

  // Click on map → park here
  map.on("click", (e) => {
    if (!selectedCarId) {
      showHint("Selecciona primero un coche en el panel.");
      return;
    }
    openConfirmModal(e.latlng.lat, e.latlng.lng);
  });
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
        <div class="pin-pulse"  style="background:${car.color}40;"></div>
        <div class="pin-body"   style="background:${car.color};"></div>
      </div>`,
  });

  const marker = L.marker([lat, lng], { icon }).addTo(map);
  marker.bindPopup(buildPopup(car));
  return marker;
}

function buildPopup(car) {
  const p = car.parking;
  const time = p?.savedAt
    ? new Date(p.savedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })
    : "";
  return `
    <div class="popup-car-name" style="color:${car.color}">${car.name}</div>
    <div class="popup-address">${p?.address || "Sin dirección"}</div>
    ${time ? `<div class="popup-time">Aparcado el ${time}</div>` : ""}
  `;
}

function refreshMarkers() {
  Object.values(markers).forEach((m) => m && m.remove());
  markers = {};
  cars.forEach((car) => {
    if (car.parking) {
      markers[car.id] = makeMarker(car);
    }
  });
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

  // Let map recalculate its size after CSS transition
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
    if (!q) { results.classList.add("hidden"); return; }

    searchDebounce = setTimeout(() => doSearch(q), 400);
  });

  // Close results when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#map-search")) {
      results.classList.add("hidden");
    }
  });

  // Prevent map click from firing when clicking the search widget
  document.getElementById("map-search").addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

async function doSearch(query) {
  const results = document.getElementById("search-results");
  results.innerHTML = `<div class="map-search-spinner">Buscando...</div>`;
  results.classList.remove("hidden");

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
    const res  = await fetch(url, { headers: { "Accept-Language": "es" } });
    const data = await res.json();

    if (!data.length) {
      results.innerHTML = `<div class="map-search-spinner">Sin resultados.</div>`;
      return;
    }

    results.innerHTML = "";
    data.forEach((place) => {
      const item = document.createElement("div");
      item.className = "map-search-result";

      // Build a short display name: first part before the first comma
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
    results.innerHTML = `<div class="map-search-spinner">Error al buscar. Comprueba tu conexión.</div>`;
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
    list.innerHTML = `<p style="font-size:12px;color:var(--text-muted);padding:4px 2px">Añade tu primer coche.</p>`;
    return;
  }

  cars.forEach((car) => {
    const item = document.createElement("div");
    item.className = "car-item" + (car.id === selectedCarId ? " active" : "");
    item.dataset.id = car.id;
    item.innerHTML = `
      <span class="car-dot" style="background:${car.color};color:${car.color}"></span>
      <span class="car-name">${escHtml(car.name)}</span>
      ${car.parking ? '<span class="car-parked-badge">aparcado</span>' : ""}
      <button class="car-edit-btn" title="Editar" data-edit="${car.id}">
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
    info.innerHTML = `<p class="parking-empty">Selecciona un coche para ver dónde está aparcado.</p>`;
    return;
  }

  if (!car.parking) {
    info.innerHTML = `<p class="parking-empty"><strong style="color:var(--text)">${escHtml(car.name)}</strong> no tiene aparcamiento guardado.<br><br>Pulsa en el mapa o usa el botón GPS.</p>`;
    return;
  }

  const p    = car.parking;
  const time = p.savedAt
    ? new Date(p.savedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })
    : "";

  info.innerHTML = `
    <div class="parking-detail">
      <div class="parking-address">${escHtml(p.address || "Sin dirección")}</div>
      ${time ? `<div class="parking-time">Aparcado el ${time}</div>` : ""}
      <div class="parking-coords">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
      <button class="btn-delete-parking" id="delete-parking-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/></svg>
        Borrar aparcamiento
      </button>
    </div>`;

  document.getElementById("delete-parking-btn")?.addEventListener("click", async () => {
    await deleteParking(currentUser.uid, car.id);
  });
}

function updateSaveBtn() {
  const btn = document.getElementById("save-gps-btn");
  btn.disabled = !selectedCarId;
}

// ─────────────────────────────────────────────────────────
//  UI bindings
// ─────────────────────────────────────────────────────────
function bindUI() {
  // Panel toggle
  document.getElementById("panel-toggle").addEventListener("click", togglePanel);

  // Car list click (select or edit)
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

  // Add car
  document.getElementById("add-car-btn").addEventListener("click", () => openCarModal(null));

  // GPS save
  document.getElementById("save-gps-btn").addEventListener("click", () => {
    if (!selectedCarId) return;
    if (!navigator.geolocation) { alert("Tu navegador no soporta geolocalización."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => openConfirmModal(pos.coords.latitude, pos.coords.longitude),
      () => alert("No se pudo obtener tu ubicación. Asegúrate de dar permiso."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  // Logout
  const doLogout = () => { if (unsubCars) unsubCars(); logoutUser(); };
  document.getElementById("logout-btn").addEventListener("click", doLogout);
  document.getElementById("logout-btn-mobile").addEventListener("click", doLogout);

  // Car modal
  document.getElementById("modal-close").addEventListener("click", closeCarModal);
  document.getElementById("car-modal-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeCarModal();
  });
  document.getElementById("modal-save-btn").addEventListener("click", saveCarModal);
  document.getElementById("modal-delete-btn").addEventListener("click", deleteCarModal);

  // Confirm modal
  document.getElementById("confirm-modal-close").addEventListener("click", closeConfirmModal);
  document.getElementById("confirm-cancel-btn").addEventListener("click", closeConfirmModal);
  document.getElementById("confirm-save-btn").addEventListener("click", confirmSaveParking);
  document.getElementById("confirm-modal-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeConfirmModal();
  });

  // Street search
  initSearch();
}

// ─────────────────────────────────────────────────────────
//  Car modal
// ─────────────────────────────────────────────────────────
function openCarModal(carId) {
  editingCarId = carId;
  const car    = cars.find((c) => c.id === carId);

  document.getElementById("modal-title").textContent = car ? "Editar coche" : "Añadir coche";
  document.getElementById("car-name-input").value    = car?.name || "";
  document.getElementById("modal-error").classList.add("hidden");
  document.getElementById("modal-delete-btn").style.display = car ? "block" : "none";

  const picker = document.getElementById("color-picker");
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

  if (!name) { errEl.textContent = "Escribe un nombre."; errEl.classList.remove("hidden"); return; }
  errEl.classList.add("hidden");

  const btn = document.getElementById("modal-save-btn");
  btn.disabled = true; btn.textContent = "Guardando...";

  try {
    if (editingCarId) {
      await updateCar(currentUser.uid, editingCarId, { name, color });
    } else {
      const newId = await addCar(currentUser.uid, name, color);
      selectedCarId = newId;
    }
    closeCarModal();
  } catch (err) {
    errEl.textContent = "Error al guardar. Inténtalo de nuevo.";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = "Guardar";
  }
}

async function deleteCarModal() {
  if (!editingCarId) return;
  const car = cars.find((c) => c.id === editingCarId);
  if (!confirm(`¿Eliminar "${car?.name}"? Se borrará su aparcamiento también.`)) return;
  await deleteCar(currentUser.uid, editingCarId);
  if (selectedCarId === editingCarId) selectedCarId = cars.find((c) => c.id !== editingCarId)?.id || null;
  closeCarModal();
}

// ─────────────────────────────────────────────────────────
//  Confirm parking modal
// ─────────────────────────────────────────────────────────
async function openConfirmModal(lat, lng) {
  pendingLatLng = { lat, lng };
  const car = cars.find((c) => c.id === selectedCarId);

  document.getElementById("confirm-car-name").textContent = car?.name || "el coche";
  document.getElementById("confirm-address").textContent  = "Obteniendo dirección...";
  document.getElementById("confirm-modal-overlay").classList.remove("hidden");

  if (markers["_pending"]) markers["_pending"].remove();
  markers["_pending"] = L.circleMarker([lat, lng], {
    radius: 8, color: car?.color || "#3b82f6", fillColor: car?.color || "#3b82f6", fillOpacity: 0.5,
  }).addTo(map);
  map.panTo([lat, lng]);

  const address = await reverseGeocode(lat, lng);
  document.getElementById("confirm-address").textContent = address;
  pendingLatLng.address = address;
}

function closeConfirmModal() {
  document.getElementById("confirm-modal-overlay").classList.add("hidden");
  if (markers["_pending"]) { markers["_pending"].remove(); delete markers["_pending"]; }
  pendingLatLng = null;
}

async function confirmSaveParking() {
  if (!pendingLatLng || !selectedCarId) return;
  const btn = document.getElementById("confirm-save-btn");
  btn.disabled = true; btn.textContent = "Guardando...";

  try {
    await saveParking(
      currentUser.uid,
      selectedCarId,
      pendingLatLng.lat,
      pendingLatLng.lng,
      pendingLatLng.address || ""
    );
    closeConfirmModal();
  } catch (err) {
    alert("Error al guardar. Comprueba tu conexión.");
  } finally {
    btn.disabled = false; btn.textContent = "Guardar";
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