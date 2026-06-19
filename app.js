// ---------- constants ----------
const EXERCISES = [
  "Squat", "Bench Press", "Deadlift", "Overhead Press",
  "Front Squat", "Romanian Deadlift", "Incline Bench", "Barbell Row",
];
const BAR_WEIGHT = { kg: 20, lb: 45 };
const PLATE_CONFIG = {
  kg: [
    { w: 25, color: "#C8392A", h: 96, wd: 22 },
    { w: 20, color: "#2D6F9E", h: 88, wd: 20 },
    { w: 15, color: "#C9A227", h: 78, wd: 18 },
    { w: 10, color: "#3C7A4B", h: 66, wd: 16 },
    { w: 5, color: "#D9D6CD", h: 54, wd: 13 },
    { w: 2.5, color: "#3A3A40", h: 44, wd: 11 },
    { w: 1.25, color: "#9A9AA1", h: 38, wd: 9 },
  ],
  lb: [
    { w: 45, color: "#C8392A", h: 96, wd: 22 },
    { w: 35, color: "#2D6F9E", h: 86, wd: 20 },
    { w: 25, color: "#C9A227", h: 74, wd: 18 },
    { w: 10, color: "#3C7A4B", h: 56, wd: 14 },
    { w: 5, color: "#D9D6CD", h: 48, wd: 12 },
    { w: 2.5, color: "#3A3A40", h: 40, wd: 10 },
  ],
};
const KG_TO_LB = 2.20462;

// ---------- state ----------
let entries = [];
let unit = "kg";
let chartExercise = null;
let deferredInstallPrompt = null;

// ---------- pure helpers ----------
function toDisplay(weightKg, u) { return u === "kg" ? weightKg : weightKg * KG_TO_LB; }
function toKg(weightDisplay, u) { return u === "kg" ? weightDisplay : weightDisplay / KG_TO_LB; }
function round1(n) { return Math.round(n * 10) / 10; }
function epley(weight, reps) { return weight * (1 + reps / 30); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function computePlates(totalWeight, u) {
  const config = PLATE_CONFIG[u];
  const bar = BAR_WEIGHT[u];
  const perSide = (totalWeight - bar) / 2;
  if (!isFinite(perSide) || perSide <= 1e-6) return { plates: [], perSide: 0 };
  let remaining = perSide;
  const plates = [];
  for (const p of config) {
    while (remaining + 1e-6 >= p.w && plates.length < 14) {
      plates.push(p);
      remaining -= p.w;
    }
  }
  return { plates, perSide };
}
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtDateShort(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function rpeColor(rpe) {
  if (rpe == null) return "#5A5A62";
  if (rpe >= 9) return "#C8392A";
  if (rpe >= 7) return "#C9A227";
  return "#3C7A4B";
}

// ---------- persistence ----------
function loadState() {
  try { entries = JSON.parse(localStorage.getItem("pl-entries") || "[]"); } catch { entries = []; }
  try { unit = (JSON.parse(localStorage.getItem("pl-settings") || "{}").unit) || "kg"; } catch { unit = "kg"; }
}
function saveEntries() {
  try { localStorage.setItem("pl-entries", JSON.stringify(entries)); } catch (e) { console.error("save failed", e); }
}
function saveSettings() {
  try { localStorage.setItem("pl-settings", JSON.stringify({ unit })); } catch (e) { console.error("save failed", e); }
}

// ---------- barbell HTML ----------
function barbellHtml(totalWeight, u) {
  const bar = BAR_WEIGHT[u];
  const { plates } = computePlates(totalWeight, u);
  const tooLight = totalWeight < bar - 1e-6;
  const left = [...plates].reverse();
  const right = plates;
  const plateDiv = (p) => `<div class="plate" style="width:${p.wd}px;height:${p.h}px;background:${p.color}"></div>`;
  const caption = tooLight
    ? `Lighter than the bar (${bar}${u} empty)`
    : plates.length === 0
    ? `Just the bar — ${bar}${u}`
    : `${bar}${u} bar + ${plates.map((p) => p.w).join("/")} per side`;
  return `
    <div class="barbell-wrap">
      <div class="barbell-row">
        <div class="bar-cap"></div>
        ${left.map(plateDiv).join("")}
        <div class="collar"></div>
        <div class="shaft"></div>
        <div class="collar"></div>
        ${right.map(plateDiv).join("")}
        <div class="bar-cap"></div>
      </div>
      <div class="barbell-caption">${caption}</div>
    </div>`;
}

// ---------- chart (hand-rolled SVG, no external lib) ----------
function chartSvg(data) {
  if (data.length < 2) return "";
  const w = 520, h = 220, padL = 40, padR = 14, padT = 14, padB = 28;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const xs = data.map((d, i) => padL + (i * innerW) / (data.length - 1));
  const yVals = data.map((d) => d.e1rm);
  const minY = Math.min(...yVals), maxY = Math.max(...yVals);
  const range = maxY - minY || 1;
  const ys = yVals.map((v) => padT + innerH * (1 - (v - minY) / range));
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = padT + innerH * f;
      const val = Math.round(maxY - f * range);
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#33333C" stroke-dasharray="3,3"/>
              <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9A9AA1" font-family="IBM Plex Mono, monospace">${val}</text>`;
    })
    .join("");
  const dots = xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="3.5" fill="#2D6F9E"/>`).join("");
  const step = Math.max(1, Math.ceil(data.length / 6));
  const labels = data
    .map((d, i) => (i % step === 0 || i === data.length - 1
      ? `<text x="${xs[i].toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#9A9AA1" font-family="IBM Plex Mono, monospace">${escapeHtml(d.date)}</text>`
      : "")).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:520px;display:block;margin:0 auto;">
    ${grid}<polyline points="${points}" fill="none" stroke="#2D6F9E" stroke-width="2.5"/>${dots}${labels}
  </svg>`;
}

// ---------- derived data ----------
function getPRs() {
  const map = {};
  for (const e of entries) {
    const cur = map[e.exercise];
    if (!cur || e.weightKg > cur.weightKg) map[e.exercise] = e;
  }
  return Object.values(map).sort((a, b) => b.weightKg - a.weightKg);
}
function getSortedEntries() {
  return [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
function getExerciseNames() {
  return Array.from(new Set(entries.map((e) => e.exercise)));
}
function getChartData(exercise) {
  if (!exercise) return [];
  const byDate = {};
  for (const e of entries) {
    if (e.exercise !== exercise) continue;
    const disp = toDisplay(e.weightKg, unit);
    const e1rm = round1(epley(disp, e.reps));
    if (!(e.date in byDate) || byDate[e.date] < e1rm) byDate[e.date] = e1rm;
  }
  return Object.entries(byDate)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, e1rm]) => ({ date: fmtDateShort(date), e1rm }));
}

// ---------- export ----------
function buildExportRows() {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((e) => {
    const w = round1(toDisplay(e.weightKg, unit));
    const vol = round1(w * e.reps * e.sets);
    const e1rm = round1(epley(w, e.reps));
    return [e.date, e.exercise, w, unit, e.reps, e.sets, e.rpe == null ? "" : e.rpe, vol, e1rm];
  });
}
const EXPORT_HEADER = ["Date", "Exercise", "Weight", "Unit", "Reps", "Sets", "RPE", "Volume", "Est. 1RM"];

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvField(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCSV() {
  const rows = buildExportRows();
  const lines = [EXPORT_HEADER, ...rows].map((line) => line.map(csvField).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + lines], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `iron-log-${new Date().toISOString().slice(0, 10)}.csv`);
}

// ---------- render ----------
function render() {
  const app = document.getElementById("app");
  const prs = getPRs();
  const sorted = getSortedEntries();
  const exerciseNames = getExerciseNames();
  if (!chartExercise || !exerciseNames.includes(chartExercise)) {
    chartExercise = exerciseNames.includes("Squat") ? "Squat" : (exerciseNames[0] || null);
  }
  const today = new Date().toISOString().slice(0, 10);

  app.innerHTML = `
    <div class="ptk-header">
      <div>
        <div class="ptk-eyebrow">Session Tracker</div>
        <div class="ptk-title">
          <img src="icons/icon-192.png" width="26" height="26" style="border-radius:6px" alt="">
          IRON LOG
        </div>
      </div>
      <button class="unit-toggle" id="unit-toggle">Units: ${unit.toUpperCase()}</button>
    </div>

    <div id="install-banner-slot"></div>

    ${prs.length > 0 ? `
      <div class="pr-strip">
        ${prs.slice(0, 6).map((p) => `
          <div class="pr-chip">
            <div class="ex-name">${escapeHtml(p.exercise)}</div>
            <div class="ex-weight">${round1(toDisplay(p.weightKg, unit))}${unit}</div>
            <div class="ex-detail">${p.sets}×${p.reps} · best set</div>
          </div>`).join("")}
      </div>` : ""}

    <div class="card">
      <div class="card-title">Log a Set</div>
      <form id="log-form">
        <div class="form-grid">
          <div class="full">
            <label>Exercise</label>
            <input list="exercise-options" id="f-exercise" placeholder="Squat" required value="Squat">
            <datalist id="exercise-options">
              ${EXERCISES.map((ex) => `<option value="${escapeHtml(ex)}"></option>`).join("")}
            </datalist>
          </div>
          <div>
            <label>Date</label>
            <input type="date" id="f-date" required value="${today}">
          </div>
          <div>
            <label>Weight (${unit})</label>
            <input type="number" inputmode="decimal" step="0.5" min="0" id="f-weight" placeholder="100" required>
          </div>
          <div>
            <label>Reps</label>
            <input type="number" inputmode="numeric" min="1" id="f-reps" placeholder="5" required>
          </div>
          <div>
            <label>Sets</label>
            <input type="number" inputmode="numeric" min="1" id="f-sets" value="3" required>
          </div>
          <div class="full">
            <label>RPE</label>
            <input type="number" inputmode="decimal" step="0.5" min="1" max="10" id="f-rpe" value="8" placeholder="8">
          </div>
        </div>
        <div id="barbell-preview"></div>
        <button type="submit" class="submit-btn">➕ Log Set</button>
      </form>
    </div>

    <div class="card">
      <div class="card-title">📈 Progress</div>
      ${exerciseNames.length === 0 ? `<div class="empty-state">Log a few sets to see your trend.</div>` : `
        <div class="tabs" id="chart-tabs">
          ${exerciseNames.map((name) => `<button class="tab ${name === chartExercise ? "active" : ""}" data-ex="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}
        </div>
        <div id="chart-container"></div>
        <div class="barbell-caption" style="margin-top:4px;">Est. 1RM uses the Epley formula — most accurate for sets of 1–5 reps.</div>
      `}
    </div>

    <div class="card">
      <div class="card-title-row">
        <div class="card-title">History</div>
        ${entries.length > 0 ? `
          <div class="export-btns">
            <button class="export-btn" id="export-csv">⬇ CSV</button>
          </div>` : ""}
      </div>
      ${sorted.length === 0 ? `<div class="empty-state">No sets logged yet. Add your first one above.</div>` : `
        <div>
          ${sorted.map((e) => `
            <div class="history-row">
              <div class="history-date">${fmtDate(e.date)}</div>
              <div class="history-main">
                <div class="history-ex">${escapeHtml(e.exercise)}</div>
                <div class="history-detail">${round1(toDisplay(e.weightKg, unit))}${unit} · ${e.sets}×${e.reps}</div>
              </div>
              ${e.rpe != null ? `<div class="rpe-chip" style="background:${rpeColor(e.rpe)}">RPE ${e.rpe}</div>` : ""}
              <button class="del-btn" data-id="${e.id}" aria-label="Delete set">🗑</button>
            </div>`).join("")}
        </div>`}
      ${entries.length > 0 ? `<button class="clear-link" id="clear-all">Clear all logged data</button>` : ""}
    </div>
  `;

  attachListeners();
  updateBarbellPreview();
  renderChart();
  renderInstallBanner();
}

function renderChart() {
  const container = document.getElementById("chart-container");
  if (!container) return;
  const data = getChartData(chartExercise);
  if (data.length < 2) {
    container.innerHTML = `<div class="empty-state">Log ${escapeHtml(chartExercise || "an exercise")} at least twice to chart a trend.</div>`;
    return;
  }
  container.innerHTML = `<div class="chart-svg-wrap">${chartSvg(data)}</div>`;
}

function updateBarbellPreview() {
  const el = document.getElementById("barbell-preview");
  const weightInput = document.getElementById("f-weight");
  if (!el || !weightInput) return;
  const w = parseFloat(weightInput.value) || 0;
  el.innerHTML = w > 0 ? barbellHtml(w, unit) : "";
}

function renderInstallBanner() {
  const slot = document.getElementById("install-banner-slot");
  if (!slot) return;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isStandalone || !deferredInstallPrompt) {
    slot.innerHTML = "";
    return;
  }
  slot.innerHTML = `
    <div class="install-banner">
      <span>Install Iron Log to your home screen for the full app experience.</span>
      <button id="install-btn">Install</button>
    </div>`;
  document.getElementById("install-btn").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderInstallBanner();
  });
}

// ---------- events ----------
function attachListeners() {
  document.getElementById("unit-toggle").addEventListener("click", () => {
    unit = unit === "kg" ? "lb" : "kg";
    saveSettings();
    render();
  });

  document.getElementById("f-weight").addEventListener("input", updateBarbellPreview);

  document.getElementById("log-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const exercise = document.getElementById("f-exercise").value.trim();
    const date = document.getElementById("f-date").value;
    const w = parseFloat(document.getElementById("f-weight").value);
    const reps = parseInt(document.getElementById("f-reps").value, 10);
    const sets = parseInt(document.getElementById("f-sets").value, 10);
    const rpeVal = document.getElementById("f-rpe").value;
    const rpe = rpeVal === "" ? null : parseFloat(rpeVal);

    if (!exercise || !date || !w || w <= 0 || !reps || reps <= 0 || !sets || sets <= 0) return;

    entries = [{ id: uid(), date, exercise, weightKg: toKg(w, unit), reps, sets, rpe }, ...entries];
    saveEntries();
    render();
  });

  const tabs = document.getElementById("chart-tabs");
  if (tabs) {
    tabs.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".tab");
      if (!btn) return;
      chartExercise = btn.dataset.ex;
      document.querySelectorAll("#chart-tabs .tab").forEach((b) => b.classList.toggle("active", b === btn));
      renderChart();
    });
  }

  document.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      entries = entries.filter((e) => e.id !== btn.dataset.id);
      saveEntries();
      render();
    });
  });

  const clearBtn = document.getElementById("clear-all");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!window.confirm("Delete every logged set? This can't be undone.")) return;
      entries = [];
      saveEntries();
      render();
    });
  }

  const csvBtn = document.getElementById("export-csv");
  if (csvBtn) csvBtn.addEventListener("click", exportCSV);
}

// ---------- install prompt + service worker ----------
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  renderInstallBanner();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.error("SW registration failed", err));
  });
}

// ---------- boot ----------
loadState();
render();
