// ============================================================
// 足跡百科 My Atlas — 主程式
// 讀取 data.js 的城市資料，畫出 3D 地球、城市列表和資訊卡。
// ============================================================

// ---------- 1. 足跡狀態的設定 ----------
const STATUS = {
  visited: { label: "去過", color: "#ff5a5f" },
  lived:   { label: "住過", color: "#ffd166" },
  want:    { label: "想去", color: "#4cc9f0" },
};
const NONE_COLOR = "#ffffff";

// 足跡存在瀏覽器裡（localStorage），重新整理也不會不見
const SAVE_KEY = "atlas-marks";
function loadMarks() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
}
function saveMarks() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(marks)); } catch (e) {}
}
let marks = loadMarks();          // 例如 { "taipei": "lived", "paris": "want" }
let selectedId = null;            // 目前打開的城市
const pinEls = {};                // 地球上每座城市的標記
let currentTab = "intro";         // 資訊卡目前的分頁
let filter = "all";               // 列表篩選
let query = "";                   // 搜尋文字

// 把文字轉成安全的 HTML（避免資料裡的符號弄壞頁面）
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const colorOf = (city) => (marks[city.id] ? STATUS[marks[city.id]].color : NONE_COLOR);
const byId = (id) => CITIES.find((c) => c.id === id);

// ---------- 2. 建立 3D 地球 ----------
const IMG = "https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img/";
const globeEl = document.getElementById("globe");
const globe = Globe()(globeEl)
  .globeImageUrl(IMG + "earth-blue-marble.jpg")
  .bumpImageUrl(IMG + "earth-topology.png")
  .backgroundImageUrl(IMG + "night-sky.png")
  .width(window.innerWidth)
  .height(window.innerHeight)
  // 城市標記：每座城市是一個「圓點＋名字」的小按鈕
  .htmlElementsData(CITIES)
  .htmlLat("lat")
  .htmlLng("lng")
  .htmlAltitude(0.003)
  .htmlElement((d) => {
    const el = document.createElement("button");
    el.className = "pin" + (d.region === "taiwan" ? " tw" : "");
    el.dataset.city = d.id;
    el.title = `${d.name.zh} ${d.name.en}`;
    el.innerHTML = `<i></i><span>${esc(d.name.zh)}</span>`;
    el.style.pointerEvents = "auto";
    pinEls[d.id] = el;
    paintPin(d);
    return el;
  })
  // 轉到地球背面的城市要藏起來
  .htmlElementVisibilityModifier((el, visible) => { el.style.opacity = visible ? 1 : 0; el.style.pointerEvents = visible ? "auto" : "none"; })
  // 放大到台灣附近時，才顯示台灣縣市的名字（避免擠在一起）
  .onZoom((pov) => document.body.classList.toggle("zoomed", pov.altitude < 0.2))
  // 選中城市時的擴散光圈
  .ringsData([])
  .ringLat("lat")
  .ringLng("lng")
  .ringColor(() => (t) => `rgba(255,255,255,${1 - t})`)
  .ringMaxRadius((d) => (d.region === "taiwan" ? 0.8 : 3))
  .ringPropagationSpeed(1.5)
  .ringRepeatPeriod(1200);

// 一開始對準台灣，並慢慢自轉
globe.pointOfView({ lat: 23.7, lng: 121, altitude: 2.2 });
globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.35;
globeEl.addEventListener("pointerdown", () => (globe.controls().autoRotate = false));

window.addEventListener("resize", () => {
  globe.width(window.innerWidth).height(window.innerHeight);
});

// 依照足跡狀態幫標記上色
function paintPin(c) {
  const el = pinEls[c.id];
  if (!el) return;
  el.style.setProperty("--c", colorOf(c));
  el.classList.toggle("on", c.id === selectedId);
}
// 足跡改變時，重新畫地球上的標記
function refreshGlobe() {
  CITIES.forEach(paintPin);
  const sel = byId(selectedId);
  globe.ringsData(sel ? [sel] : []);
}

// ---------- 3. 左上統計 ----------
function renderStats() {
  const ids = Object.keys(marks);
  const been = ids.filter((id) => marks[id] === "visited" || marks[id] === "lived");
  const want = ids.filter((id) => marks[id] === "want");
  const countries = new Set(been.map((id) => byId(id)?.country.zh).filter(Boolean));
  document.getElementById("stats").innerHTML =
    `去過 <b>${been.length}</b> 座城市 · <b>${countries.size}</b> 個國家／地區 · 想去 <b>${want.length}</b>`;
}

// ---------- 4. 左側列表與篩選 ----------
const FILTERS = [
  ["all", "全部"], ["taiwan", "台灣"], ["world", "世界"],
  ["been", "去過"], ["want", "想去"],
];
function renderFilters() {
  document.getElementById("filters").innerHTML = FILTERS.map(([key, label]) =>
    `<button class="chip" data-filter="${key}" aria-pressed="${filter === key}">${label}</button>`).join("");
}
function matches(city) {
  const m = marks[city.id];
  if (filter === "taiwan" && city.region !== "taiwan") return false;
  if (filter === "world" && city.region !== "world") return false;
  if (filter === "been" && m !== "visited" && m !== "lived") return false;
  if (filter === "want" && m !== "want") return false;
  if (query) {
    const text = (city.name.zh + city.name.en + city.country.zh + city.country.en).toLowerCase();
    if (!text.includes(query.toLowerCase())) return false;
  }
  return true;
}
function renderList() {
  const shown = CITIES.filter(matches);
  const groups = [["taiwan", "台灣"], ["world", "世界城市"]];
  let html = "";
  for (const [region, title] of groups) {
    const items = shown.filter((c) => c.region === region);
    if (!items.length) continue;
    html += `<li class="group">${title}（${items.length}）</li>`;
    html += items.map((c) => `
      <li><button data-city="${esc(c.id)}" aria-current="${c.id === selectedId}">
        <span class="dot" style="background:${colorOf(c)}"></span>
        <span>${esc(c.name.zh)}</span>
        <span class="en">${esc(c.name.en)}</span>
      </button></li>`).join("");
  }
  const emptyMsg = query ? "找不到符合的城市，換個關鍵字試試看。"
    : filter === "been" ? "還沒有標記去過的城市。點開一座城市，按「去過」或「住過」就會出現在這裡。"
    : filter === "want" ? "還沒有標記想去的城市。點開一座城市，按「想去」就會出現在這裡。"
    : "找不到符合的城市。";
  document.getElementById("list").innerHTML = html || `<li class="hint">${emptyMsg}</li>`;
}

// ---------- 5. 右側資訊卡 ----------
const TABS = [
  ["intro", "簡介"], ["customs", "習俗禁忌"], ["specialties", "名產特色"],
  ["history", "歷史"], ["phrases", "一句話"],
];
const EMPTY = `<p class="empty">這裡還沒有內容。打開 <b>data.js</b>，就能補上這座城市的資料。</p>`;
const listHTML = (arr) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : EMPTY);

function tabContent(c) {
  switch (currentTab) {
    case "intro":
      return c.intro ? `<p>${esc(c.intro)}</p>` : EMPTY;
    case "customs":
      return `<h3>當地習俗</h3>${listHTML(c.customs)}<h3>禁忌與注意事項</h3>${listHTML(c.taboos)}`;
    case "specialties":
      return listHTML(c.specialties);
    case "history":
      return c.history && c.history.length
        ? `<ul class="timeline">${c.history.map((h) => `<li><b>${esc(h.year)}</b>${esc(h.text)}</li>`).join("")}</ul>`
        : EMPTY;
    case "phrases":
      return c.phrases && c.phrases.length
        ? c.phrases.map((p) => `<div class="phrase"><span class="local">${esc(p.local)}</span><span class="pron">${esc(p.pron)}</span><span>${esc(p.zh)}</span></div>`).join("")
        : EMPTY;
  }
  return "";
}

function renderCard() {
  const card = document.getElementById("card");
  const c = byId(selectedId);
  if (!c) { card.hidden = true; document.body.classList.remove("card-open"); return; }
  card.hidden = false;
  document.body.classList.add("card-open");
  const statusBtns = Object.entries(STATUS).map(([key, s]) => {
    const on = marks[c.id] === key;
    return `<button data-status="${key}" aria-pressed="${on}" style="${on ? `background:${s.color}` : ""}">${s.label}</button>`;
  }).join("");
  const sources = c.sources && c.sources.length
    ? `<div class="sources">資料來源：${c.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("、")}</div>`
    : "";
  card.innerHTML = `
    <div class="card-head">
      <div class="country">${esc(c.country.zh)} · ${esc(c.country.en)}</div>
      <h2>${esc(c.name.zh)}<span>${esc(c.name.en)}</span></h2>
      <div class="status">${statusBtns}</div>
      <button class="close" id="close" aria-label="關閉">×</button>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map(([k, label]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${currentTab === k}">${label}</button>`).join("")}
    </div>
    <div class="card-body">${tabContent(c)}${sources}</div>`;
}

// ---------- 6. 選擇城市：飛過去並打開資訊卡 ----------
function selectCity(id) {
  const c = byId(id);
  if (!c) return;
  selectedId = id;
  currentTab = "intro";
  globe.controls().autoRotate = false;
  globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: c.region === "taiwan" ? 0.12 : 0.6 }, 1200);
  document.getElementById("finder").classList.remove("open");
  refreshGlobe();
  renderList();
  renderCard();
}
function closeCard() {
  selectedId = null;
  refreshGlobe();
  renderList();
  renderCard();
}

// ---------- 7. 圖例 ----------
document.getElementById("legend").innerHTML =
  Object.values(STATUS).map((s) => `<span><i class="dot" style="background:${s.color}"></i>${s.label}</span>`).join("") +
  `<span><i class="dot" style="background:${NONE_COLOR}"></i>未標記</span>`;

// ---------- 8. 所有點擊事件 ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.city) return selectCity(t.dataset.city);
  if (t.dataset.filter) { filter = t.dataset.filter; renderFilters(); renderList(); return; }
  if (t.dataset.tab) { currentTab = t.dataset.tab; renderCard(); return; }
  if (t.dataset.status) {
    // 再按一次同一個狀態 = 取消標記
    if (marks[selectedId] === t.dataset.status) delete marks[selectedId];
    else marks[selectedId] = t.dataset.status;
    saveMarks(); refreshGlobe(); renderStats(); renderList(); renderCard();
    return;
  }
  if (t.id === "close") return closeCard();
  if (t.id === "finderToggle") {
    const f = document.getElementById("finder");
    f.classList.toggle("open");
    t.setAttribute("aria-expanded", f.classList.contains("open"));
  }
});
document.getElementById("search").addEventListener("input", (e) => { query = e.target.value.trim(); renderList(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && selectedId) closeCard(); });

// ---------- 9. 開始 ----------
renderStats();
renderFilters();
renderList();
