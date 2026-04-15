/* =========================
   你需要填的設定
========================= */
const CONFIG = {
  CLIENT_ID: "291154632710-iff27p5atmn6eq6hmqrlh2o4int9bedr.apps.googleusercontent.com",
  SPREADSHEET_ID: "1MYtYruG-22UNtWxZTQHAhXe-JEqeWP8zCsJ7ev7B_30",

  SHEET_RECORDS: "記帳紀錄",
  SHEET_FIELDS: "欄位表",

  SCOPES: "https://www.googleapis.com/auth/spreadsheets"
};

/* =========================
   全域狀態
========================= */
let accessToken = "";
let tokenClient = null;
let gisReady = false;

let fieldOptions = {
  typeToCategories: {},
  typeToPayments: {}
};

let currentMonth = "";
let records = [];

/* =========================
   DOM
========================= */
const $ = (sel) => document.querySelector(sel);

const btnSignIn = $("#btnSignIn");
const btnSignOut = $("#btnSignOut");
const btnReload = $("#btnReload");
const btnRefresh = $("#btnRefresh");
const btnSubmit = $("#btnSubmit");
const statusEl = $("#status");

const recordForm = $("#recordForm");
const fDate = $("#fDate");
const fType = $("#fType");
const fCategory = $("#fCategory");
const fPayment = $("#fPayment");
const fAmount = $("#fAmount");
const fDescription = $("#fDescription");

const monthPicker = $("#monthPicker");
const sumIncome = $("#sumIncome");
const sumExpense = $("#sumExpense");
const sumNet = $("#sumNet");
const categoryBreakdown = $("#categoryBreakdown");

const recordsTbody = $("#recordsTbody");

/* =========================
   初始化 (DOM 就緒後立即做)
========================= */
initDefaults();
bindEvents();
setUiSignedOut();
setStatus("等待 Google 登入元件載入中...", false);

/* =========================
   給 index.html 的 GSI onload 呼叫
   重要：這裡才會初始化 google.accounts
========================= */
window.onGisLoaded = function onGisLoaded() {
  
  gisReady = true;

  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    setStatus("Google 登入元件載入異常，請確認網路或 CSP 設定", true);
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: (resp) => {
      if (!resp || !resp.access_token) {
        setStatus("登入失敗，沒有取得 access token", true);
        return;
      }
      accessToken = resp.access_token;
      setStatus("登入成功，已取得授權", false);
      afterSignedIn();
    }
  });

  btnSignIn.disabled = false;
  setStatus("已就緒，可以登入 Google", false);
};

function initDefaults() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  fDate.value = `${yyyy}-${mm}-${dd}`;
  currentMonth = `${yyyy}-${mm}`;
  monthPicker.value = currentMonth;
}

function bindEvents() {
  btnSignIn.addEventListener("click", () => {
    if (!gisReady || !tokenClient) {
      setStatus("Google 登入元件尚未就緒，請稍後再試", true);
      return;
    }
    if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.includes("PASTE_")) {
      setStatus("請先在 app.js 填入 CLIENT_ID", true);
      return;
    }
    tokenClient.requestAccessToken({ prompt: "consent" });
  });

  btnSignOut.addEventListener("click", () => {
    if (!accessToken) {
      setStatus("尚未登入", false);
      return;
    }

    if (window.google && google.accounts && google.accounts.oauth2) {
      google.accounts.oauth2.revoke(accessToken, () => {
        resetAll();
        setStatus("已登出", false);
      });
    } else {
      resetAll();
      setStatus("已登出", false);
    }
  });

  fType.addEventListener("change", () => {
    applySelectOptionsForType(fType.value);
  });

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
}

function resetAll() {
  accessToken = "";
  records = [];
  fieldOptions = { typeToCategories: {}, typeToPayments: {} };

  fCategory.innerHTML = "";
  fPayment.innerHTML = "";
  recordsTbody.innerHTML = "";
  renderSummary([]);
  renderBreakdown([]);

  setUiSignedOut();
}

/* =========================
   UI enable/disable
========================= */
function setUiSignedIn() {
  btnSignOut.disabled = false;
  btnReload.disabled = false;
  btnRefresh.disabled = false;
  btnSubmit.disabled = false;
  monthPicker.disabled = false;
}

function setUiSignedOut() {
  btnSignOut.disabled = true;
  btnReload.disabled = true;
  btnRefresh.disabled = true;
  btnSubmit.disabled = true;
  monthPicker.disabled = true;
}

/* =========================
   登入後流程
========================= */
async function afterSignedIn() {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.includes("PASTE_")) {
    setStatus("請先在 app.js 填入 SPREADSHEET_ID", true);
    return;
  }

  try {
    setUiSignedIn();
    await loadFieldTable();
    applySelectOptionsForType(fType.value);
    await reloadMonth();
  } catch (err) {
    console.error(err);
    setStatus(`初始化失敗: ${err.message || String(err)}`, true);
  }
}

/* =========================
   Google Sheets API helper
========================= */
async function apiFetch(url, options = {}) {
  if (!accessToken) throw new Error("尚未登入或沒有 access token");

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
  const range = encodeURIComponent(rangeA1);
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${range}`;
}

function valuesAppendUrl(rangeA1) {
  const range = encodeURIComponent(rangeA1);
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
}

/* =========================
   讀取 欄位表
========================= */
async function loadFieldTable() {
  setStatus("讀取欄位表中...", false);

  const range = `${CONFIG.SHEET_FIELDS}!A:C`;
  const data = await apiFetch(valuesGetUrl(range), { method: "GET" });
  const rows = data.values || [];

  const types = ["支出", "收入"];
  const typeToCategories = { 支出: new Set(), 收入: new Set() };
  const typeToPayments = { 支出: new Set(), 收入: new Set() };

  for (let i = 1; i < rows.length; i++) {
    const [tRaw, cRaw, pRaw] = rows[i];
    const t = (tRaw || "").trim();
    const c = (cRaw || "").trim();
    const p = (pRaw || "").trim();

    const targetTypes = types.includes(t) ? [t] : types;

    if (c) targetTypes.forEach((tt) => typeToCategories[tt].add(c));
    if (p) targetTypes.forEach((tt) => typeToPayments[tt].add(p));
  }

  types.forEach((t) => {
    if (typeToCategories[t].size === 0) typeToCategories[t].add("其他雜項");
    if (typeToPayments[t].size === 0) typeToPayments[t].add("現金 (Cash)");
  });

  fieldOptions = { typeToCategories, typeToPayments };
  setStatus("欄位表已載入", false);
}

function applySelectOptionsForType(type) {
  const cats = Array.from(fieldOptions.typeToCategories[type] || []);
  const pays = Array.from(fieldOptions.typeToPayments[type] || []);

  fCategory.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  fPayment.innerHTML = pays.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
}

/* =========================
   讀取 記帳紀錄 並做每月篩選
========================= */
async function reloadMonth() {
  if (!accessToken) {
    setStatus("請先登入", true);
    return;
  }

  try {
    setStatus("讀取記帳紀錄中...", false);
    const range = `${CONFIG.SHEET_RECORDS}!A:G`;
    const data = await apiFetch(valuesGetUrl(range), { method: "GET" });
    const rows = data.values || [];

    const parsed = [];
    for (let i = 1; i < rows.length; i++) {
      const [id, date, type, category, amount, desc, payment] = rows[i];
      if (!date) continue;

      parsed.push({
        ID: id || "",
        Date: (date || "").trim(),
        Type: (type || "").trim(),
        Category: (category || "").trim(),
        Amount: Number(amount || 0),
        Description: (desc || "").trim(),
        Payment: (payment || "").trim()
      });
    }

    records = filterByMonth(parsed, currentMonth);
    renderTable(records);
    renderSummary(records);
    renderBreakdown(records);

    setStatus(`本月共 ${records.length} 筆`, false);
  } catch (err) {
    console.error(err);
    setStatus(`讀取失敗: ${err.message || String(err)}`, true);
  }
}

function filterByMonth(items, yyyyMm) {
  if (!yyyyMm) return items;
  return items.filter((r) => String(r.Date).startsWith(yyyyMm));
}

/* =========================
   新增一筆
========================= */
async function submitRecord() {
  if (!accessToken) {
    setStatus("請先登入", true);
    return;
  }

  const date = fDate.value;
  const type = fType.value;
  const category = fCategory.value;
  const payment = fPayment.value;

  const amountNum = Number(fAmount.value);
  const desc = fDescription.value.trim();

  if (!date) return setStatus("請選日期", true);
  if (!["收入", "支出"].includes(type)) return setStatus("Type 只能是 收入 或 支出", true);
  if (!Number.isFinite(amountNum) || amountNum < 0) return setStatus("Amount 需為非負數", true);
  if (!desc) return setStatus("請填寫說明", true);

  const id = String(Date.now());

  const row = [id, date, type, category, amountNum, desc, payment];

  try {
    setStatus("寫入試算表中...", false);

    const appendRange = `${CONFIG.SHEET_RECORDS}!A:G`;
    await apiFetch(valuesAppendUrl(appendRange), {
      method: "POST",
      body: JSON.stringify({ values: [row] })
    });

    setStatus("新增成功", false);

    fAmount.value = "";
    fDescription.value = "";

    await reloadMonth();
  } catch (err) {
    console.error(err);
    setStatus(`新增失敗: ${err.message || String(err)}`, true);
  }
}

/* =========================
   UI render
========================= */
function renderTable(items) {
  const html = items
    .slice()
    .sort((a, b) => (a.Date > b.Date ? 1 : -1))
    .map((r) => {
      const amt = formatMoney(r.Amount);
      return `
        <tr>
          <td>${escapeHtml(r.Date)}</td>
          <td>${escapeHtml(r.Type)}</td>
          <td>${escapeHtml(r.Category)}</td>
          <td class="right">${escapeHtml(amt)}</td>
          <td>${escapeHtml(r.Description)}</td>
          <td>${escapeHtml(r.Payment)}</td>
        </tr>
      `;
    })
    .join("");

  recordsTbody.innerHTML = html || `<tr><td colspan="6" class="muted">本月尚無資料</td></tr>`;
}

function renderSummary(items) {
  let income = 0;
  let expense = 0;

  for (const r of items) {
    const amt = Number(r.Amount || 0);
    if (r.Type === "收入") income += amt;
    if (r.Type === "支出") expense += amt;
  }

  sumIncome.textContent = formatMoney(income);
  sumExpense.textContent = formatMoney(expense);
  sumNet.textContent = formatMoney(income - expense);
}

function renderBreakdown(items) {
  const map = new Map();
  let total = 0;

  for (const r of items) {
    if (r.Type !== "支出") continue;
    const key = r.Category || "未分類";
    const amt = Number(r.Amount || 0);
    total += amt;
    map.set(key, (map.get(key) || 0) + amt);
  }

  const list = Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (list.length === 0) {
    categoryBreakdown.innerHTML = `<div class="muted">本月尚無支出</div>`;
    return;
  }

  const rows = list.map(([cat, amt]) => {
    const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
    return `
      <div class="barRow">
        <div>${escapeHtml(cat)}</div>
        <div class="bar"><div style="width:${pct}%"></div></div>
        <div class="right">${escapeHtml(formatMoney(amt))} (${pct}%)</div>
      </div>
    `;
  }).join("");

  categoryBreakdown.innerHTML = rows;
}

/* =========================
   Utils
========================= */
function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function formatMoney(n) {
  const num = Number(n || 0);
  return num.toLocaleString("zh-TW");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}