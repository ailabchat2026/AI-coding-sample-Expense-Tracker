/* =========================
   你需要填的設定
========================= */
const CONFIG = {
  CLIENT_ID:      "291154632710-iff27p5atmn6eq6hmqrlh2o4int9bedr.apps.googleusercontent.com",
  SPREADSHEET_ID: "1MYtYruG-22UNtWxZTQHAhXe-JEqeWP8zCsJ7ev7B_30",

  SHEET_RECORDS: "記帳紀錄",
  SHEET_FIELDS:  "欄位表",

  SCOPES: "https://www.googleapis.com/auth/spreadsheets"
};

/* =========================
   全域狀態
========================= */
let accessToken = "";
let tokenClient = null;
let gisReady    = false;

let fieldOptions    = { typeToCategories: {}, typeToPayments: {} };
let currentMonth    = "";
let records         = [];
let prevRecords     = [];
let recordsSheetId  = null;

/* =========================
   DOM refs
========================= */
const $ = (sel) => document.querySelector(sel);

const btnSignIn  = $("#btnSignIn");
const btnSignOut = $("#btnSignOut");
const btnReload  = $("#btnReload");
const btnRefresh = $("#btnRefresh");
const btnSubmit  = $("#btnSubmit");
const authHint   = $("#authHint");
const statusMsg  = $("#statusMsg");

const recordForm   = $("#recordForm");
const fDate        = $("#fDate");
const fType        = $("#fType");
const fCategory    = $("#fCategory");
const fPayment     = $("#fPayment");
const fAmount      = $("#fAmount");
const fDescription = $("#fDescription");

const monthPicker       = $("#monthPicker");
const sumIncome         = $("#sumIncome");
const sumExpense        = $("#sumExpense");
const sumNet            = $("#sumNet");
const categoryBreakdown = $("#categoryBreakdown");
const recordsTbody      = $("#recordsTbody");

/* =========================
   啟動
========================= */
initDefaults();
bindEvents();
setUiSignedOut();
setStatus("等待 Google 登入元件載入中…");

/* =========================
   GIS onload callback (index2.html 的 onload="onGisLoaded()")
========================= */
window.onGisLoaded = function onGisLoaded() {
  gisReady = true;

  if (!window.google?.accounts?.oauth2) {
    setStatus("Google 登入元件載入異常，請確認網路設定", "error");
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope:     CONFIG.SCOPES,
    callback:  (resp) => {
      setBtnLoading(btnSignIn, false);
      if (!resp?.access_token) {
        toast("登入失敗，無法取得授權", "error");
        return;
      }
      accessToken = resp.access_token;
      toast("登入成功", "ok");
      afterSignedIn();
    }
  });

  btnSignIn.disabled = false;
  setStatus("就緒，請登入 Google");
};

/* =========================
   初始預設值
========================= */
function initDefaults() {
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const dd   = String(now.getDate()).padStart(2, "0");

  fDate.value        = `${yyyy}-${mm}-${dd}`;
  currentMonth       = `${yyyy}-${mm}`;
  monthPicker.value  = currentMonth;
}

/* =========================
   事件綁定
========================= */
function bindEvents() {
  btnSignIn.addEventListener("click", () => {
    if (!gisReady || !tokenClient) {
      toast("Google 元件尚未就緒，請稍後再試", "error");
      return;
    }
    if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.includes("PASTE_")) {
      toast("請先在 app2.js 填入 CLIENT_ID", "error");
      return;
    }
    setBtnLoading(btnSignIn, true);
    tokenClient.requestAccessToken({ prompt: "consent" });
  });

  btnSignOut.addEventListener("click", () => {
    if (!accessToken) return;
    if (window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(accessToken, () => {
        resetAll();
        toast("已登出");
      });
    } else {
      resetAll();
      toast("已登出");
    }
  });

  fType.addEventListener("change", () => applySelectOptionsForType(fType.value));

  monthPicker.addEventListener("change", async () => {
    currentMonth = monthPicker.value;
    await reloadMonth();
  });

  btnReload.addEventListener("click", reloadMonth);
  btnRefresh.addEventListener("click", reloadMonth);

  recordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitRecord();
  });

  /* Delete record — event delegation on tbody */
  recordsTbody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-row]");
    if (!btn) return;
    deleteRecord(Number(btn.dataset.row));
  });

  /* Inline validation on blur (validate after user leaves field) */
  fAmount.addEventListener("blur", () => {
    const v = Number(fAmount.value);
    if (fAmount.value && (!Number.isFinite(v) || v < 0)) {
      showFieldError("errAmount", "請輸入有效的非負數金額");
    } else {
      hideFieldError("errAmount");
    }
  });
  fDescription.addEventListener("blur", () => {
    if (fDescription.value && !fDescription.value.trim()) {
      showFieldError("errDesc", "說明不得為空白");
    } else {
      hideFieldError("errDesc");
    }
  });
}

/* =========================
   UI 狀態切換
========================= */
function setUiSignedIn() {
  btnSignOut.disabled  = false;
  btnReload.disabled   = false;
  btnRefresh.disabled  = false;
  btnSubmit.disabled   = false;
  monthPicker.disabled = false;
  authHint.textContent = "已登入";
}

function setUiSignedOut() {
  btnSignOut.disabled  = true;
  btnReload.disabled   = true;
  btnRefresh.disabled  = true;
  btnSubmit.disabled   = true;
  monthPicker.disabled = true;
  authHint.textContent = "尚未登入";
}

function resetAll() {
  accessToken  = "";
  records      = [];
  fieldOptions = { typeToCategories: {}, typeToPayments: {} };

  fCategory.innerHTML    = "";
  fPayment.innerHTML     = "";
  recordsTbody.innerHTML = "";
  prevRecords            = [];
  recordsSheetId         = null;
  renderSummary([]);
  renderBreakdown([]);
  renderTrendChart([]);
  setUiSignedOut();
  setStatus("");
}

/* =========================
   登入後流程
========================= */
async function afterSignedIn() {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.includes("PASTE_")) {
    toast("請先在 app2.js 填入 SPREADSHEET_ID", "error");
    return;
  }
  try {
    setUiSignedIn();
    await Promise.all([loadFieldTable(), loadSheetMeta()]);
    applySelectOptionsForType(fType.value);
    await reloadMonth();
  } catch (err) {
    console.error(err);
    toast(`初始化失敗: ${err.message || err}`, "error");
  }
}

/* =========================
   Google Sheets API helpers
========================= */
async function apiFetch(url, options = {}) {
  if (!accessToken) throw new Error("尚未登入");

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API 錯誤 ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

function valuesGetUrl(rangeA1) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(rangeA1)}`;
}

function valuesAppendUrl(rangeA1) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
}

/* =========================
   取得工作表 sheetId（刪除列所需）
========================= */
async function loadSheetMeta() {
  const data = await apiFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}?fields=sheets.properties`,
    { method: "GET" }
  );
  const sheet = (data.sheets || []).find(
    (s) => s.properties.title === CONFIG.SHEET_RECORDS
  );
  if (sheet) recordsSheetId = sheet.properties.sheetId;
}

/* =========================
   讀取 欄位表
========================= */
async function loadFieldTable() {
  setStatus("讀取欄位表中…");

  const data = await apiFetch(valuesGetUrl(`${CONFIG.SHEET_FIELDS}!A:C`), { method: "GET" });
  const rows = data.values || [];

  const types = ["支出", "收入"];
  const typeToCategories = { 支出: new Set(), 收入: new Set() };
  const typeToPayments   = { 支出: new Set(), 收入: new Set() };

  for (let i = 1; i < rows.length; i++) {
    const [tRaw = "", cRaw = "", pRaw = ""] = rows[i];
    const t = tRaw.trim();
    const c = cRaw.trim();
    const p = pRaw.trim();

    const targets = types.includes(t) ? [t] : types;
    if (c) targets.forEach((tt) => typeToCategories[tt].add(c));
    if (p) targets.forEach((tt) => typeToPayments[tt].add(p));
  }

  types.forEach((t) => {
    if (typeToCategories[t].size === 0) typeToCategories[t].add("其他雜項");
    if (typeToPayments[t].size === 0)   typeToPayments[t].add("現金 (Cash)");
  });

  fieldOptions = { typeToCategories, typeToPayments };
  setStatus("欄位表已載入");
}

function applySelectOptionsForType(type) {
  const cats = Array.from(fieldOptions.typeToCategories[type] || []);
  const pays = Array.from(fieldOptions.typeToPayments[type]   || []);

  fCategory.innerHTML = cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  fPayment.innerHTML  = pays.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
}

/* =========================
   讀取本月記帳紀錄
========================= */
async function reloadMonth() {
  if (!accessToken) { toast("請先登入", "error"); return; }

  try {
    setStatus("讀取中…");
    renderSkeleton();  /* show skeleton while loading */

    const data = await apiFetch(valuesGetUrl(`${CONFIG.SHEET_RECORDS}!A:G`), { method: "GET" });
    const rows = data.values || [];

    const parsed = [];
    for (let i = 1; i < rows.length; i++) {
      const [id, date, type, category, amount, desc, payment] = rows[i];
      if (!date) continue;
      parsed.push({
        ID:             id || "",
        Date:           (date     || "").trim(),
        Type:           (type     || "").trim(),
        Category:       (category || "").trim(),
        Amount:         Number(amount || 0),
        Description:    (desc    || "").trim(),
        Payment:        (payment || "").trim(),
        rowIndexInSheet: i + 1  /* spreadsheet row (1-based); header = row 1 */
      });
    }

    const prevMonth = getPrevMonth(currentMonth);
    records     = filterByMonth(parsed, currentMonth);
    prevRecords = filterByMonth(parsed, prevMonth);

    renderTable(records);
    renderSummary(records);
    renderBreakdown(records);
    renderTrendChart(parsed);   /* pass all records for multi-month chart */

    setStatus(`本月共 ${records.length} 筆`, "ok");
  } catch (err) {
    console.error(err);
    toast(`讀取失敗: ${err.message || err}`, "error");
    setStatus(`讀取失敗`, "error");
    recordsTbody.innerHTML = `<tr><td colspan="7" class="empty-cell">讀取失敗，請重試</td></tr>`;
  }
}

function filterByMonth(items, yyyyMm) {
  if (!yyyyMm) return items;
  return items.filter((r) => String(r.Date).startsWith(yyyyMm));
}

function getPrevMonth(yyyyMm) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, m - 2, 1);   /* month is 0-based in Date constructor */
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* =========================
   新增一筆
========================= */
async function submitRecord() {
  if (!accessToken) { toast("請先登入", "error"); return; }

  /* Clear previous inline errors */
  hideFieldError("errDate");
  hideFieldError("errAmount");
  hideFieldError("errDesc");

  const date      = fDate.value;
  const type      = fType.value;
  const category  = fCategory.value;
  const payment   = fPayment.value;
  const amountNum = Number(fAmount.value);
  const desc      = fDescription.value.trim();

  /* Inline validation (show errors near fields) */
  let hasError = false;
  if (!date) {
    showFieldError("errDate", "請選擇日期");
    hasError = true;
  }
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    showFieldError("errAmount", "請輸入有效的非負數金額");
    hasError = true;
  }
  if (!desc) {
    showFieldError("errDesc", "請填寫說明");
    hasError = true;
  }
  if (hasError) return;

  const row = [String(Date.now()), date, type, category, amountNum, desc, payment];

  try {
    setBtnLoading(btnSubmit, true);
    setStatus("寫入試算表中…");

    await apiFetch(valuesAppendUrl(`${CONFIG.SHEET_RECORDS}!A:G`), {
      method: "POST",
      body:   JSON.stringify({ values: [row] })
    });

    toast("新增成功！", "ok");
    setStatus(`本月共 ${records.length + 1} 筆`, "ok");

    fAmount.value      = "";
    fDescription.value = "";

    await reloadMonth();
  } catch (err) {
    console.error(err);
    toast(`新增失敗: ${err.message || err}`, "error");
    setStatus("新增失敗", "error");
  } finally {
    setBtnLoading(btnSubmit, false);
  }
}

/* =========================
   Render：Skeleton rows (loading placeholder)
========================= */
function renderSkeleton(rows = 5) {
  const cols = [1, 0.5, 0.7, 0.4, 1, 0.8];
  recordsTbody.innerHTML = Array.from({ length: rows }, () =>
    `<tr class="skeleton-row">${cols.map((w) =>
      `<td><div class="skel" style="width:${Math.round(w * 100)}%"></div></td>`
    ).join("")}</tr>`
  ).join("");
}

/* =========================
   Render：Table rows
========================= */
function renderTable(items) {
  if (items.length === 0) {
    recordsTbody.innerHTML =
      `<tr><td colspan="7" class="empty-cell">本月尚無資料</td></tr>`;
    return;
  }

  const sorted = items.slice().sort((a, b) => (a.Date > b.Date ? 1 : -1));

  recordsTbody.innerHTML = sorted.map((r) => {
    const isIncome  = r.Type === "收入";
    const badgeCls  = isIncome ? "badge-income"  : "badge-expense";
    const amtCls    = isIncome ? "amt-income"    : "amt-expense";
    const sign      = isIncome ? "+" : "−";

    return `
      <tr>
        <td>${esc(r.Date)}</td>
        <td><span class="badge ${badgeCls}">${esc(r.Type)}</span></td>
        <td>${esc(r.Category)}</td>
        <td class="right ${amtCls}">${sign}${esc(fmtMoney(r.Amount))}</td>
        <td>${esc(r.Description)}</td>
        <td>${esc(r.Payment)}</td>
        <td class="td-action">
          <button class="btn btn-danger btn-sm"
                  data-row="${r.rowIndexInSheet}"
                  aria-label="刪除此筆記帳">刪除</button>
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================
   Render：KPI 概覽
========================= */
function renderSummary(items) {
  let income = 0, expense = 0;
  for (const r of items) {
    const amt = Number(r.Amount || 0);
    if (r.Type === "收入") income  += amt;
    if (r.Type === "支出") expense += amt;
  }
  const net = income - expense;

  sumIncome.textContent  = fmtMoney(income);
  sumExpense.textContent = fmtMoney(expense);
  sumNet.textContent     = fmtMoney(net);

  /* Net colour: positive = green, negative = red */
  sumNet.style.color = net >= 0
    ? "var(--net-pos)"
    : "var(--net-neg)";

  /* Month-over-month deltas */
  let prevIncome = 0, prevExpense = 0;
  for (const r of prevRecords) {
    const amt = Number(r.Amount || 0);
    if (r.Type === "收入") prevIncome  += amt;
    if (r.Type === "支出") prevExpense += amt;
  }
  const prevNet = prevIncome - prevExpense;

  renderDelta("deltaIncome",  income,  prevIncome,  "income");
  renderDelta("deltaExpense", expense, prevExpense, "expense");
  renderDelta("deltaNet",     net,     prevNet,     "net");
}

/* =========================
   上月對比 delta badge
========================= */
function renderDelta(id, curr, prev, type) {
  const el = document.getElementById(id);
  if (!el) return;

  /* Hide when no previous month data */
  if (prev === 0) { el.textContent = ""; return; }

  const diff = curr - prev;
  const pct  = Math.round(Math.abs(diff / prev) * 100);
  const isUp = diff >= 0;
  const arrow = isUp ? "▲" : "▼";

  /* For expense: rising cost = bad; for income/net: rising = good */
  let cls;
  if (type === "expense") {
    cls = isUp ? "delta-bad" : "delta-good";
  } else {
    cls = isUp ? "delta-good" : "delta-bad";
  }

  el.className = `kpi-delta ${cls}`;
  el.textContent = `${arrow} ${pct}% vs 上月`;
}

/* =========================
   Render：支出分類長條圖
========================= */
function renderBreakdown(items) {
  const map   = new Map();
  let   total = 0;

  for (const r of items) {
    if (r.Type !== "支出") continue;
    const key = r.Category || "未分類";
    const amt = Number(r.Amount || 0);
    total += amt;
    map.set(key, (map.get(key) || 0) + amt);
  }

  const list = Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (list.length === 0) {
    categoryBreakdown.innerHTML =
      `<div class="breakdown-empty">本月尚無支出</div>`;
    return;
  }

  /* Render without width first, then animate via rAF (GPU-only transform) */
  categoryBreakdown.innerHTML = list.map(([cat, amt]) => {
    const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
    return `
      <div class="bar-row" role="listitem">
        <div class="bar-meta">
          <span class="bar-cat" title="${esc(cat)}">${esc(cat)}</span>
          <span class="bar-info num">${esc(fmtMoney(amt))} · ${pct}%</span>
        </div>
        <div class="bar-track" role="progressbar"
             aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
             aria-label="${esc(cat)} 佔比 ${pct}%">
          <div class="bar-fill" data-pct="${pct}"></div>
        </div>
      </div>
    `;
  }).join("");

  /* Animate bars after paint (avoids layout thrashing) */
  requestAnimationFrame(() => {
    categoryBreakdown.querySelectorAll(".bar-fill").forEach((el) => {
      el.style.width = el.dataset.pct + "%";
    });
  });
}

/* =========================
   Render：月份收支比較圖（近 6 個月）
========================= */
function renderTrendChart(allParsed) {
  const trendEl = document.getElementById("trendChart");
  if (!trendEl) return;

  if (allParsed.length === 0) {
    trendEl.innerHTML = `<div class="trend-empty">本月尚無資料</div>`;
    return;
  }

  /* Build list of last 6 months ending at currentMonth */
  const months = [];
  const [cy, cm] = currentMonth.split("-").map(Number);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(cy, cm - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  /* Aggregate income / expense per month */
  const data = months.map((ym) => {
    let income = 0, expense = 0;
    for (const r of allParsed) {
      if (!r.Date.startsWith(ym)) continue;
      const amt = Number(r.Amount || 0);
      if (r.Type === "收入") income  += amt;
      if (r.Type === "支出") expense += amt;
    }
    return { ym, income, expense };
  });

  const maxVal = Math.max(...data.map((d) => Math.max(d.income, d.expense)), 1);

  /* Month label — show year only when it changes */
  const labelFor = (ym, idx) => {
    const [y, m] = ym.split("-").map(Number);
    const prevYm = idx > 0 ? months[idx - 1] : null;
    const showYear = !prevYm || Number(prevYm.split("-")[0]) !== y;
    return showYear ? `${y}<br>${m}月` : `${m}月`;
  };

  trendEl.innerHTML = `
    <div class="trend-wrap">
      <div class="trend-bars" role="img" aria-label="近6個月收支比較圖">
        ${data.map(({ ym, income, expense }, idx) => {
          const inPct = Math.round((income  / maxVal) * 100);
          const exPct = Math.round((expense / maxVal) * 100);
          const isCurrent = ym === currentMonth;
          return `
            <div class="trend-col${isCurrent ? " is-current" : ""}">
              <div class="trend-vals" aria-hidden="true">
                <span class="trend-val-in num">${income  > 0 ? fmtMoney(income)  : ""}</span>
                <span class="trend-val-ex num">${expense > 0 ? fmtMoney(expense) : ""}</span>
              </div>
              <div class="trend-group">
                <div class="trend-bar trend-bar-income"
                     data-pct="${inPct}" style="height:0%"
                     title="收入 ${fmtMoney(income)}"></div>
                <div class="trend-bar trend-bar-expense"
                     data-pct="${exPct}" style="height:0%"
                     title="支出 ${fmtMoney(expense)}"></div>
              </div>
              <div class="trend-label">${labelFor(ym, idx)}</div>
            </div>
          `;
        }).join("")}
      </div>
      <div class="trend-legend" aria-hidden="true">
        <span class="trend-leg-item"><span class="trend-leg-dot dot-income"></span>收入</span>
        <span class="trend-leg-item"><span class="trend-leg-dot dot-expense"></span>支出</span>
      </div>
    </div>
  `;

  /* Animate bars after paint */
  requestAnimationFrame(() => {
    trendEl.querySelectorAll(".trend-bar").forEach((el) => {
      el.style.height = el.dataset.pct + "%";
    });
  });
}

/* =========================
   刪除一筆（Google Sheets batchUpdate deleteDimension）
========================= */
async function deleteRecord(rowIndexInSheet) {
  if (!accessToken) { toast("請先登入", "error"); return; }
  if (recordsSheetId === null) { toast("無法取得工作表資訊，請重新整理頁面", "error"); return; }

  if (!confirm("確定要刪除這筆記帳紀錄嗎？此操作無法還原。")) return;

  try {
    setStatus("刪除中…");
    await apiFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: {
                sheetId:    recordsSheetId,
                dimension:  "ROWS",
                startIndex: rowIndexInSheet - 1,  /* 0-based, inclusive */
                endIndex:   rowIndexInSheet        /* 0-based, exclusive */
              }
            }
          }]
        })
      }
    );
    toast("已刪除", "ok");
    await reloadMonth();
  } catch (err) {
    console.error(err);
    toast(`刪除失敗: ${err.message || err}`, "error");
    setStatus("刪除失敗", "error");
  }
}

/* =========================
   Toast system (3-4s auto dismiss)
   rule: toast-dismiss — 3–5s; toast-accessibility — aria-live region
========================= */
const toastRegion = document.getElementById("toastRegion");

function toast(msg, type = "info") {
  const icons = { info: "ℹ️", ok: "✅", error: "❌" };
  const el = document.createElement("div");
  el.className = `toast${type === "error" ? " is-error" : type === "ok" ? " is-ok" : ""}`;
  el.innerHTML = `<span class="toast-icon" aria-hidden="true">${icons[type] || "ℹ️"}</span>${esc(msg)}`;
  toastRegion.appendChild(el);

  const dismiss = () => {
    el.classList.add("is-hiding");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  };
  /* 4s for errors, 3s for others */
  setTimeout(dismiss, type === "error" ? 4000 : 3000);
}

/* =========================
   Inline status bar (smaller, persistent)
========================= */
function setStatus(msg, type = "info") {
  statusMsg.textContent  = msg;
  statusMsg.className    =
    "status-bar" +
    (type === "error" ? " is-error" : type === "ok" ? " is-ok" : "");
}

/* =========================
   Button loading state
   rule: loading-buttons — disable + spinner during async
========================= */
function setBtnLoading(btn, loading) {
  btn.classList.toggle("is-loading", loading);
  btn.disabled = loading;
}

/* =========================
   Field-level error helpers
   rule: error-placement — show error below the related field
========================= */
function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
  /* also mark input */
  const input = el.previousElementSibling;
  if (input) input.classList.add("is-error");
}

function hideFieldError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = "";
  el.classList.remove("visible");
  const input = el.previousElementSibling;
  if (input) input.classList.remove("is-error");
}

/* =========================
   Utils
========================= */
function fmtMoney(n) {
  return Number(n || 0).toLocaleString("zh-TW");
}

function esc(str) {
  return String(str ?? "")
    .replaceAll("&",  "&amp;")
    .replaceAll("<",  "&lt;")
    .replaceAll(">",  "&gt;")
    .replaceAll('"',  "&quot;")
    .replaceAll("'",  "&#039;");
}
