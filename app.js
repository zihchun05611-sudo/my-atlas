// ============================================================
// 足跡百科 My Atlas — 主程式
// 讀取 data.js 的城市資料，畫出 3D 地球、城市列表、資訊卡、
// 我的紀錄（筆記＋照片）、航線和統計。
// ============================================================

// ---------- 1. 基本設定與儲存 ----------
const STATUS = {
  visited: { label: "去過", color: "#ff5a5f" },
  lived:   { label: "住過", color: "#ffd166" },
  want:    { label: "想去", color: "#4cc9f0" },
};
const NONE_COLOR = "#ffffff";

// 小型資料（足跡、筆記）存在 localStorage
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
};
let marks = store.get("atlas-marks", {});   // { taipei: "lived", paris: "want" }
let notes = store.get("atlas-notes", {});   // { paris: { date, rating, text } }

let selectedId = null;   // 目前打開的城市
let currentTab = "intro";
let filter = "all";
let query = "";
const pinEls = {};       // 地球上每座城市的標記

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = (id) => CITIES.find((c) => c.id === id);
const colorOf = (c) => (marks[c.id] ? STATUS[marks[c.id]].color : NONE_COLOR);
const isBeen = (id) => marks[id] === "visited" || marks[id] === "lived";
const $ = (id) => document.getElementById(id);

// ---------- 2. 計算工具：距離、時差 ----------
// 兩點之間的大圓距離（公里），飛機實際飛的就是這種最短路線
function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
// 某個時區現在比 UTC 快幾小時
function tzOffset(tz) {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  return (local - utc) / 3600000;
}
function localTime(tz) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}
function timeDiffText(tz) {
  const d = tzOffset(tz) - tzOffset("Asia/Taipei");
  if (d === 0) return "和台灣相同";
  return d > 0 ? `比台灣快 ${d} 小時` : `比台灣慢 ${-d} 小時`;
}

// ---------- 3. 照片儲存（IndexedDB，可以存比較大的檔案） ----------
let dbPromise = null;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("atlas", 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
        s.createIndex("city", "city");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function dbRun(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", mode);
    const req = fn(tx.objectStore("photos"));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const getPhotos = (city) => dbRun("readonly", (s) => (city ? s.index("city").getAll(city) : s.getAll()));
const addPhoto = (city, blob) => dbRun("readwrite", (s) => s.add({ city, blob, added: Date.now() }));
const deletePhoto = (id) => dbRun("readwrite", (s) => s.delete(id));

// 上傳前先把照片縮小（最長邊 1600px），省空間又載入快
async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * scale);
  cv.height = Math.round(bmp.height * scale);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((r) => cv.toBlob(r, "image/jpeg", 0.85));
}
let objectURLs = [];
function photoURL(blob) { const u = URL.createObjectURL(blob); objectURLs.push(u); return u; }
function releaseURLs() { objectURLs.forEach((u) => URL.revokeObjectURL(u)); objectURLs = []; }

// ---------- 4. 維基百科：即時抓城市摘要和照片 ----------
const wikiCache = {};
// 選一張適合的圖片大小：原圖不大就用原圖；原圖很大才請維基百科縮成 640px
function pickImage(j) {
  const orig = j.originalimage, thumb = j.thumbnail;
  if (!thumb) return "";
  if (orig && orig.width <= 1200 && !/\.(svg|tiff?)$/i.test(orig.source)) return orig.source;
  if (orig && orig.width > 640) return thumb.source.replace(/\/\d+px-/, "/640px-");
  return thumb.source;
}
async function getWiki(c) {
  const title = c.wiki || c.name.zh;
  if (title in wikiCache) return wikiCache[title];
  try {
    const res = await fetch(`https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { "Accept-Language": "zh-TW" } });
    if (!res.ok) throw new Error(res.status);
    const j = await res.json();
    wikiCache[title] = {
      extract: j.extract || "",
      img: pickImage(j),
      url: (j.content_urls && j.content_urls.desktop.page) || `https://zh.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch (e) {
    wikiCache[title] = null;   // 抓不到就不顯示，不影響其他功能
  }
  return wikiCache[title];
}

// ---------- 5. 建立 3D 地球 ----------
const IMG = "https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img/";
const globe = Globe()($("globe"))
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
  .htmlElementVisibilityModifier((el, visible) => { el.style.opacity = visible ? 1 : 0; el.style.pointerEvents = visible ? "auto" : "none"; })
  .onZoom((pov) => document.body.classList.toggle("zoomed", pov.altitude < 0.2))
  // 選中城市時的擴散光圈
  .ringsData([])
  .ringLat("lat")
  .ringLng("lng")
  .ringColor(() => (t) => `rgba(255,255,255,${1 - t})`)
  .ringMaxRadius((d) => (d.region === "taiwan" ? 0.8 : 3))
  .ringPropagationSpeed(1.5)
  .ringRepeatPeriod(1200)
  // 航線：從桃園機場飛到去過的世界城市
  .arcsData([])
  .arcColor((d) => ["rgba(255,255,255,0.6)", d.color])
  .arcStroke(0.45)
  .arcDashLength(0.5)
  .arcDashGap(0.15)
  .arcDashAnimateTime(2600)
  .arcAltitudeAutoScale(0.4)
  .arcLabel((d) => `<div class="tip">TPE → ${esc(d.name)}<span>${d.km.toLocaleString()} km</span></div>`);

globe.pointOfView({ lat: 23.7, lng: 121, altitude: 2.2 });
globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.35;
$("globe").addEventListener("pointerdown", () => (globe.controls().autoRotate = false));
window.addEventListener("resize", () => globe.width(window.innerWidth).height(window.innerHeight));

function paintPin(c) {
  const el = pinEls[c.id];
  if (!el) return;
  el.style.setProperty("--c", colorOf(c));
  el.classList.toggle("on", c.id === selectedId);
}
function refreshGlobe() {
  CITIES.forEach(paintPin);
  const sel = byId(selectedId);
  globe.ringsData(sel ? [sel] : []);
  globe.arcsData(CITIES.filter((c) => c.region === "world" && isBeen(c.id)).map((c) => ({
    startLat: HOME_AIRPORT.lat, startLng: HOME_AIRPORT.lng, endLat: c.lat, endLng: c.lng,
    color: STATUS[marks[c.id]].color, name: c.name.zh, km: distanceKm(HOME_AIRPORT, c),
  })));
}

// ---------- 6. 左上統計 ----------
function renderStats() {
  const been = CITIES.filter((c) => isBeen(c.id));
  const countries = new Set(been.map((c) => c.country.zh));
  const continents = new Set(been.map((c) => c.continent));
  const km = been.filter((c) => c.region === "world").reduce((sum, c) => sum + distanceKm(HOME_AIRPORT, c), 0);
  const want = CITIES.filter((c) => marks[c.id] === "want").length;
  $("stats").innerHTML = `
    <span><b>${been.length}</b> 城市</span><span><b>${countries.size}</b> 國家／地區</span>
    <span><b>${continents.size}</b> 大洲</span><span><b>${want}</b> 想去</span>
    <span class="wide">累積航程 <b>${km.toLocaleString()}</b> km（從桃園機場出發）</span>`;
}

// ---------- 7. 左側列表與篩選 ----------
const FILTERS = [["all", "全部"], ["taiwan", "台灣"], ["world", "世界"], ["been", "去過"], ["want", "想去"]];
function renderFilters() {
  $("filters").innerHTML = FILTERS.map(([k, label]) =>
    `<button class="chip" data-filter="${k}" aria-pressed="${filter === k}">${label}</button>`).join("");
}
function matches(c) {
  const m = marks[c.id];
  if (filter === "taiwan" && c.region !== "taiwan") return false;
  if (filter === "world" && c.region !== "world") return false;
  if (filter === "been" && !isBeen(c.id)) return false;
  if (filter === "want" && m !== "want") return false;
  if (query) {
    const text = (c.name.zh + c.name.en + c.country.zh + c.country.en).toLowerCase();
    if (!text.includes(query.toLowerCase())) return false;
  }
  return true;
}
function renderList() {
  const shown = CITIES.filter(matches);
  let html = "";
  for (const [region, title] of [["taiwan", "台灣"], ["world", "世界城市"]]) {
    const items = shown.filter((c) => c.region === region);
    if (!items.length) continue;
    html += `<li class="group">${title}（${items.length}）</li>` + items.map((c) => `
      <li><button data-city="${esc(c.id)}" aria-current="${c.id === selectedId}">
        <span class="dot" style="background:${colorOf(c)}"></span>
        <span>${esc(c.name.zh)}</span><span class="en">${esc(c.name.en)}</span>
      </button></li>`).join("");
  }
  const emptyMsg = query ? "找不到符合的城市，換個關鍵字試試看。"
    : filter === "been" ? "還沒有標記去過的城市。點開一座城市，按「去過」或「住過」就會出現在這裡。"
    : filter === "want" ? "還沒有標記想去的城市。點開一座城市，按「想去」就會出現在這裡。"
    : "找不到符合的城市。";
  $("list").innerHTML = html || `<li class="hint">${emptyMsg}</li>`;
}

// ---------- 8. 右側資訊卡 ----------
const TABS = [["intro", "簡介"], ["customs", "習俗禁忌"], ["specialties", "名產特色"], ["history", "歷史"], ["phrases", "一句話"], ["mine", "我的紀錄"]];
const EMPTY = `<p class="empty">這裡還沒有內容。打開 <b>data.js</b>，就能補上這座城市的資料。</p>`;
const listHTML = (arr) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : EMPTY);

function factsHTML(c) {
  const info = COUNTRY_INFO[c.cc] || {};
  const rows = [
    ["當地時間", `${localTime(c.tz)}（${timeDiffText(c.tz)}）`],
    ["語言", info.language], ["貨幣", info.currency],
    ["插座／電壓", info.plug && `${info.plug}・${info.voltage}`],
    ["行車方向", info.drive], ["小費", info.tip],
  ];
  if (c.region === "world") {
    const km = distanceKm(HOME_AIRPORT, c);
    rows.push(["從桃園飛過去", `約 ${km.toLocaleString()} 公里・直飛約 ${Math.round((km / 800 + 0.5) * 10) / 10} 小時`]);
  }
  return `<dl class="facts">${rows.filter((r) => r[1]).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
}

function tabContent(c) {
  switch (currentTab) {
    case "intro":
      return `<div id="wiki" class="wiki loading"><div class="wiki-img"></div></div>
        ${c.intro ? `<p class="lead">${esc(c.intro)}</p>` : ""}
        <h3>旅行速查</h3>${factsHTML(c)}`;
    case "customs":
      return `<h3>當地習俗與節慶</h3>${listHTML(c.customs)}<h3>禁忌與注意事項</h3>${listHTML(c.taboos)}`;
    case "specialties":
      return listHTML(c.specialties);
    case "history":
      return c.history && c.history.length
        ? `<ul class="timeline">${c.history.map((h) => `<li><b>${esc(h.year)}</b>${esc(h.text)}</li>`).join("")}</ul>` : EMPTY;
    case "phrases":
      return c.phrases && c.phrases.length
        ? c.phrases.map((p) => `<div class="phrase"><span class="local">${esc(p.local)}</span>${p.pron ? `<span class="pron">${esc(p.pron)}</span>` : ""}<span>${esc(p.zh)}</span></div>`).join("")
        : EMPTY;
    case "mine": {
      const n = notes[c.id] || {};
      const stars = [1, 2, 3, 4, 5].map((i) => `<button class="star" data-rate="${i}" aria-label="${i} 顆星" aria-pressed="${(n.rating || 0) >= i}">★</button>`).join("");
      return `
        ${marks[c.id] ? "" : `<p class="hint-box">提醒：上面的「去過／住過／想去」還沒選，選了之後統計和航線才會算進去。</p>`}
        <label class="field"><span>造訪日期</span><input type="date" id="noteDate" value="${esc(n.date || "")}"></label>
        <div class="field"><span>我的評分</span><div class="stars">${stars}</div></div>
        <label class="field"><span>旅行筆記</span><textarea id="noteText" rows="5" placeholder="寫下在這裡的回憶、推薦的店、學到的事…">${esc(n.text || "")}</textarea></label>
        <div class="field"><span>我的照片</span>
          <label class="upload">＋ 新增照片<input type="file" id="photoInput" accept="image/*" multiple></label>
          <p class="small" id="photoMsg">照片只存在這台電腦的瀏覽器裡，不會上傳到網路。</p>
          <div class="gallery" id="cityGallery"></div>
        </div>`;
    }
  }
  return "";
}

function renderCard() {
  const card = $("card");
  const c = byId(selectedId);
  releaseURLs();
  if (!c) { card.hidden = true; document.body.classList.remove("card-open"); return; }
  card.hidden = false;
  document.body.classList.add("card-open");
  const statusBtns = Object.entries(STATUS).map(([k, s]) => {
    const on = marks[c.id] === k;
    return `<button data-status="${k}" aria-pressed="${on}" style="${on ? `background:${s.color}` : ""}">${s.label}</button>`;
  }).join("");
  const sources = (c.sources || []).concat([{ title: "維基百科", url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(c.wiki || c.name.zh)}` }]);
  card.innerHTML = `
    <div class="card-head">
      <div class="country">${esc(c.country.zh)} · ${esc(c.country.en)} · ${esc(c.continent)}</div>
      <h2>${esc(c.name.zh)}<span>${esc(c.name.en)}</span></h2>
      <div class="status">${statusBtns}</div>
      <button class="close" id="close" aria-label="關閉">×</button>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map(([k, label]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${currentTab === k}">${label}</button>`).join("")}
    </div>
    <div class="card-body" id="cardBody">${tabContent(c)}
      ${currentTab === "mine" ? "" : `<div class="sources">資料來源：${sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join("、")}</div>`}
    </div>`;
  if (currentTab === "intro") fillWiki(c);
  if (currentTab === "mine") fillCityGallery(c);
}

async function fillWiki(c) {
  const w = await getWiki(c);
  const box = $("wiki");
  if (!box || selectedId !== c.id || currentTab !== "intro") return;   // 使用者已經切走了
  if (!w || (!w.extract && !w.img)) { box.remove(); return; }
  const text = w.extract.length > 180 ? w.extract.slice(0, 180) + "…" : w.extract;
  box.classList.remove("loading");
  box.innerHTML = `
    ${w.img ? `<img src="${esc(w.img)}" alt="${esc(c.name.zh)}" loading="lazy" onerror="this.remove()">` : ""}
    <p>${esc(text)} <a href="${esc(w.url)}" target="_blank" rel="noopener">閱讀更多</a></p>
    <p class="credit">文字與圖片來自維基百科（CC BY-SA）</p>`;
}

async function fillCityGallery(c) {
  const box = $("cityGallery");
  if (!box) return;
  let photos = [];
  try { photos = await getPhotos(c.id); } catch (e) { $("photoMsg").textContent = "這個瀏覽器無法儲存照片（可能是無痕模式）。"; return; }
  if (selectedId !== c.id || currentTab !== "mine") return;
  box.innerHTML = photos.length
    ? photos.map((p) => `<figure><img src="${photoURL(p.blob)}" data-view="${p.id}" alt="${esc(c.name.zh)}的照片"><button class="del" data-delphoto="${p.id}" aria-label="刪除照片">×</button></figure>`).join("")
    : `<p class="small">還沒有照片。</p>`;
}

// ---------- 9. 照片庫（所有城市的照片） ----------
async function openGalleryView() {
  const view = $("galleryView");
  view.hidden = false;
  let photos = [];
  try { photos = await getPhotos(); } catch (e) {}
  const groups = {};
  photos.forEach((p) => (groups[p.city] = groups[p.city] || []).push(p));
  const ids = Object.keys(groups);
  view.querySelector(".gv-body").innerHTML = ids.length
    ? ids.map((id) => { const c = byId(id); return `
        <section><h3><button class="linkish" data-city="${esc(id)}">${esc(c ? c.name.zh : id)}</button><span>${groups[id].length} 張</span></h3>
        <div class="gallery big">${groups[id].map((p) => `<figure><img src="${photoURL(p.blob)}" data-view="${p.id}" alt=""></figure>`).join("")}</div></section>`; }).join("")
    : `<p class="hint">還沒有任何照片。打開一座城市 →「我的紀錄」就能上傳照片。</p>`;
}
function openLightbox(src) {
  $("lightbox").hidden = false;
  $("lightbox").querySelector("img").src = src;
}

// ---------- 10. 選擇城市 ----------
function selectCity(id) {
  const c = byId(id);
  if (!c) return;
  selectedId = id;
  currentTab = "intro";
  globe.controls().autoRotate = false;
  globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: c.region === "taiwan" ? 0.12 : 0.6 }, 1200);
  $("finder").classList.remove("open");
  $("galleryView").hidden = true;
  refreshGlobe(); renderList(); renderCard();
}
function closeCard() { selectedId = null; refreshGlobe(); renderList(); renderCard(); }
function saveNote(patch) {
  notes[selectedId] = Object.assign({}, notes[selectedId], patch);
  store.set("atlas-notes", notes);
}

// ---------- 11. 圖例 ----------
$("legend").innerHTML =
  Object.values(STATUS).map((s) => `<span><i class="dot" style="background:${s.color}"></i>${s.label}</span>`).join("") +
  `<span><i class="dot" style="background:${NONE_COLOR}"></i>未標記</span>`;

// ---------- 12. 事件 ----------
document.addEventListener("click", async (e) => {
  const img = e.target.closest("img[data-view]");
  if (img) return openLightbox(img.src);
  const t = e.target.closest("button");
  if (!t) { if (e.target.id === "lightbox") $("lightbox").hidden = true; return; }
  if (t.dataset.city) return selectCity(t.dataset.city);
  if (t.dataset.filter) { filter = t.dataset.filter; renderFilters(); renderList(); return; }
  if (t.dataset.tab) { currentTab = t.dataset.tab; renderCard(); return; }
  if (t.dataset.status) {
    if (marks[selectedId] === t.dataset.status) delete marks[selectedId];   // 再按一次＝取消
    else marks[selectedId] = t.dataset.status;
    store.set("atlas-marks", marks);
    refreshGlobe(); renderStats(); renderList(); renderCard();
    return;
  }
  if (t.dataset.rate) {
    const r = +t.dataset.rate;
    saveNote({ rating: notes[selectedId] && notes[selectedId].rating === r ? 0 : r });
    document.querySelectorAll(".star").forEach((s) => s.setAttribute("aria-pressed", (notes[selectedId].rating || 0) >= +s.dataset.rate));
    return;
  }
  if (t.dataset.delphoto) {
    await deletePhoto(+t.dataset.delphoto);
    releaseURLs(); fillCityGallery(byId(selectedId));
    return;
  }
  if (t.id === "close") return closeCard();
  if (t.id === "galleryBtn") return openGalleryView();
  if (t.id === "gvClose") { $("galleryView").hidden = true; releaseURLs(); return; }
  if (t.id === "lbClose") { $("lightbox").hidden = true; return; }
  if (t.id === "finderToggle") {
    $("finder").classList.toggle("open");
    t.setAttribute("aria-expanded", $("finder").classList.contains("open"));
  }
});

let noteTimer;
document.addEventListener("input", (e) => {
  if (e.target.id === "search") { query = e.target.value.trim(); renderList(); }
  if (e.target.id === "noteText") { clearTimeout(noteTimer); noteTimer = setTimeout(() => saveNote({ text: e.target.value }), 400); }
  if (e.target.id === "noteDate") saveNote({ date: e.target.value });
});

document.addEventListener("change", async (e) => {
  if (e.target.id !== "photoInput") return;
  const files = [...e.target.files];
  const msg = $("photoMsg");
  const city = selectedId;
  let ok = 0, fail = 0;
  msg.textContent = `處理中…（${files.length} 張）`;
  for (const f of files) {
    try { await addPhoto(city, await compressImage(f)); ok++; } catch (err) { fail++; }
  }
  msg.textContent = `已加入 ${ok} 張照片` + (fail ? `，${fail} 張無法讀取（iPhone 的 HEIC 格式請先轉成 JPG）` : "") + "。";
  e.target.value = "";
  releaseURLs(); fillCityGallery(byId(city));
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("lightbox").hidden) $("lightbox").hidden = true;
  else if (!$("galleryView").hidden) $("galleryView").hidden = true;
  else if (selectedId) closeCard();
});

// 每分鐘更新一次資訊卡上的當地時間
setInterval(() => { if (selectedId && currentTab === "intro") { const dl = document.querySelector(".facts"); if (dl) dl.outerHTML = factsHTML(byId(selectedId)); } }, 60000);

// ---------- 13. 開始 ----------
refreshGlobe();
renderStats();
renderFilters();
renderList();
