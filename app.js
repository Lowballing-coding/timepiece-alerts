// Public VAPID key (safe to share; the private key stays on the laptop).
const VAPID_PUBLIC_KEY = "BCw69mMtS2gckHI0voqwM4uR0eupiXHxpfijl5sU0IrPSgD6SYNlcgKPKvkgH24NCACK8-TbzvuH6D1QHfVzGuI";

const $ = (id) => document.getElementById(id);
const LABELS = { on_sale: "Tickets on Sale", check: "Check Manually", problem: "Watcher Problem", test: "Test Notification" };

// ---- IndexedDB (alert history, shared with sw.js) ----
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("alerts", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("alerts", { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function allAlerts() {
  const db = await openDb();
  return new Promise((resolve) => {
    const req = db.transaction("alerts").objectStore("alerts").getAll();
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror = () => resolve([]);
  });
}
async function clearAlerts() {
  const db = await openDb();
  db.transaction("alerts", "readwrite").objectStore("alerts").clear();
}

// ---- Alerts screen ----
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function safeUrl(u) {
  return /^https:\/\/([a-z0-9-]+\.)*fixr\.co\//i.test(u || "") ? u : "";
}
// Alerts the server sent to this person that never reached this phone (it was off, the push expired, ...).
async function fetchMissed(local) {
  if (!session || !profile || profile.status !== "approved") return [];
  try {
    const since = new Date(Math.max(store.get("tp-since") || 0, Date.now() - 864e5)).toISOString();
    const rows = await Promise.race([
      api(`alert_log?select=created_at,type,event_name,event_day,event_date,url&user_ids=cs.{${session.user.id}}&type=neq.test`
        + `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=20`),
      new Promise((r) => setTimeout(() => r([]), 1500)),
    ]);
    return rows.map((r) => ({ type: r.type, name: r.event_name || "", day: r.event_day || "", date: r.event_date || "", url: r.url || "",
      received: Date.parse(r.created_at), missed: true }))
      .filter((m) => !local.some((a) => a.type === m.type && a.name === m.name && Math.abs(a.received - m.received) < 15 * 60e3));
  } catch { return []; }
}
let knownIds = null;   // alerts already on screen, so a brand-new one can animate in
async function renderAlerts() {
  const stored = await allAlerts();
  const items = [...stored, ...(await fetchMissed(stored))].sort((a, b) => b.received - a.received);
  const fresh = new Set(knownIds ? items.filter((a) => a.id && !knownIds.has(a.id)).map((a) => a.id) : []);
  knownIds = new Set(items.filter((a) => a.id).map((a) => a.id));
  $("clear").style.display = items.length ? "block" : "none";
  if (!items.length) {
    $("list").innerHTML = `<div class="empty">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="ring" cx="60" cy="60" r="54" stroke-width="3"/>
        ${Array.from({ length: 12 }, (_, i) => `<line class="tick" x1="60" y1="10" x2="60" y2="${i % 3 ? 16 : 20}" stroke-width="${i % 3 ? 2 : 3}" transform="rotate(${i * 30} 60 60)"/>`).join("")}
        <path class="hand" d="M60 60V34M60 60l18 10" stroke-width="4"/>
        <g class="sweep"><line class="sweepline" x1="60" y1="70" x2="60" y2="14" stroke-width="1.5"/></g>
        <circle class="hub" cx="60" cy="60" r="3.5"/>
      </svg>
      <h2>Nothing on Sale Yet</h2>
      <p class="muted">When your watcher finds tickets, they show up here and on your lock screen.</p>
    </div>`;
    return;
  }
  const dayKey = (t) => new Date(t).toDateString();
  const dayName = (t) => {
    const d = new Date(t), today = new Date();
    if (dayKey(t) === today.toDateString()) return "Today";
    if (dayKey(t) === new Date(today - 864e5).toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  };
  let lastDay = "";
  $("list").innerHTML = items.map((a) => {
    const type = LABELS[a.type] ? a.type : "check";
    const url = safeUrl(a.url);
    const time = new Date(a.received).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const heading = dayKey(a.received) !== lastDay ? `<h2 class="day">${esc(dayName(a.received))}</h2>` : "";
    lastDay = dayKey(a.received);
    const d = /^(\d{1,2})\S*\s+([A-Za-z]+)/.exec(a.date || "");   // "10th January" -> a calendar tile
    const tile = d ? `<div class="tile"><span>${esc(d[2].slice(0, 3))}</span><b>${esc(d[1])}</b><span>${esc((a.day || "").slice(0, 3))}</span></div>` : "";
    return `${heading}<article class="alert ${type}${fresh.has(a.id) ? " arrive" : ""}">
      <time class="at">${esc(time)}</time>
      <div>
        <div class="head">${tile}<div>
          <p class="status">${LABELS[type]}${a.missed ? ' <span class="new missed">Missed</span>' : a.seen === false ? ' <span class="new">New</span>' : ""}</p>
          <h3>${esc(a.name)}</h3>
          <p class="when">${esc([a.day, a.date].filter(Boolean).join(" "))}</p>
        </div></div>
        ${type === "on_sale" && url ? `<a class="go" href="${esc(url)}" target="_blank" rel="noopener">Open on FIXR</a>` : ""}
      </div>
    </article>`;
  }).join("");
  // Once the person is looking at the list, those alerts count as seen and the icon badge clears.
  if (!$("tabs").hidden && $("alerts").classList.contains("active") && !document.hidden) markSeen(items);
}
async function markSeen(items) {
  try {
    const unseen = items.filter((a) => a.seen === false);
    if (unseen.length) {
      const store = (await openDb()).transaction("alerts", "readwrite").objectStore("alerts");
      unseen.forEach((a) => store.put({ ...a, seen: true }));
    }
    if (navigator.clearAppBadge) await navigator.clearAppBadge();
  } catch {}
}

// ---- Tabs ----
document.querySelectorAll("nav button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === b.dataset.tab));
    if (b.dataset.tab === "alerts") renderAlerts();
    if (b.dataset.tab === "setup") renderChecklist();
    if (b.dataset.tab === "admin") renderAdmin();
  };
});
$("clear").onclick = async () => { await clearAlerts(); store.set("tp-since", Date.now()); renderAlerts(); };

// ---- Setup screen ----
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function currentSub() {
  if (!supported()) return null;
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 3000))]);
  return reg ? reg.pushManager.getSubscription() : null;
}
async function renderChecklist() {
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const sub = await currentSub();
  const row = (n, ok, text) => `<li class="${ok ? "done" : ""}"><span class="mark">${ok ? "\u2713" : n}</span><span>${text}${ok ? " (Done)" : ""}</span></li>`;
  $("checklist").innerHTML =
    row(1, standalone(), "Open the app from its Home Screen icon") +
    row(2, perm === "granted", "Allow notifications") +
    row(3, !!sub && store.get("tp-linked") === sub.endpoint, "Link this phone to your account");
  $("sub").value = sub ? JSON.stringify(sub.toJSON(), null, 2) : "";
  if (!supported()) {
    $("setup-msg").textContent = "Push isn't available here. On iPhone, add this app to the Home Screen first (iOS 16.4 or newer) and open it from there.";
  }
}
function keyBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
$("enable").onclick = async () => {
  $("setup-msg").textContent = "";
  try {
    if (!supported()) return renderChecklist();
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      $("setup-msg").textContent = "Notifications were not allowed. Allow them in the phone's Settings, then try again.";
      return renderChecklist();
    }
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, no) => setTimeout(() => no({ name: "The app isn't ready yet. Close it and open it again" }), 10000)),
    ]);
    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
    $("sub").value = JSON.stringify(sub.toJSON(), null, 2);
    await saveSubscription(sub);
    $("setup-msg").textContent = "Done. This phone is linked to your account.";
  } catch (e) {
    $("setup-msg").textContent = "Couldn't finish setup. " + (e.message || e.name) + ".";
  }
  renderChecklist();
};

// Saves this phone's push subscription to the signed-in account (the watcher reads it from there).
const deviceLabel = () => (/iPhone|iPad/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : "Computer");
async function saveSubscription(sub) {
  await api("subscriptions?on_conflict=endpoint", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: session.user.id, endpoint: sub.endpoint, subscription: sub.toJSON(), device_label: deviceLabel(), active: true }),
  });
  store.set("tp-linked", sub.endpoint);
}
async function syncSubscription() {   // quietly keep the saved copy fresh on each launch
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const sub = await currentSub();
    if (sub) await saveSubscription(sub);
  } catch {}
}
$("copy").onclick = async () => {
  const text = $("sub").value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); $("setup-msg").textContent = "Copied."; }
  catch { $("sub").select(); $("setup-msg").textContent = "Press and hold the text, then choose Copy."; }
};

// ---- Settings screen ----
$("test").onclick = async () => {
  if (!supported() || Notification.permission !== "granted") {
    alert("Turn on notifications on the Setup screen first.");
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification("Test Notification", { body: "This phone can show TP Notify alerts.", icon: "icon-192.png" });
};

// ---- Quiet hours (each person's own; the watcher skips alerts in this window, using their time zone) ----
function fillQuiet() {
  const on = !!(profile && profile.quiet_start && profile.quiet_end);
  $("quiet-on").checked = on;
  if (on) { $("quiet-start").value = profile.quiet_start; $("quiet-end").value = profile.quiet_end; }
}
const inQuiet = (start, end) => {
  const t = new Date().toTimeString().slice(0, 5);
  return start <= end ? start <= t && t < end : t >= start || t < end;
};
$("quiet-save").onclick = async () => {
  const msg = $("quiet-msg"), on = $("quiet-on").checked;
  const fields = on
    ? { quiet_start: $("quiet-start").value, quiet_end: $("quiet-end").value, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }
    : { quiet_start: null, quiet_end: null };
  msg.className = "msg muted";
  if (on && (!fields.quiet_start || !fields.quiet_end)) { msg.className = "msg error"; msg.textContent = "Choose both times."; return; }
  try {
    await patchProfile(session.user.id, fields);
    Object.assign(profile, fields); store.set("tp-profile", profile);
    msg.textContent = on ? "Quiet hours saved." : "Quiet hours are off.";
  } catch (e) { msg.className = "msg error"; msg.textContent = e.message; }
  setTimeout(() => { msg.textContent = ""; }, 6000);
};

// ---- Install guide (shown on the sign-in screen when opened in a browser on a phone) ----
if (!standalone() && /iPhone|iPad|Android/.test(navigator.userAgent)) {
  const steps = /iPhone|iPad/.test(navigator.userAgent)
    ? ["Tap the Share button in Safari.", "Choose Add to Home Screen.", "Open TP Notify from its new icon."]
    : ["Tap the menu in Chrome.", "Choose Install App.", "Open TP Notify from its new icon."];
  $("tip-steps").innerHTML = steps.map((s) => `<li>${s}</li>`).join("");
  $("install-tip").hidden = false;
}

// ---- Fix My Alerts: checks each link in the chain and says how to repair the broken one ----
$("diagnose").onclick = async () => {
  const rows = [], add = (ok, label, fix) => rows.push({ ok, label, fix });
  $("diag").innerHTML = '<li class="muted">Checking...</li>'; $("diag-note").textContent = "";
  add(standalone(), "Opened from the Home Screen icon", "Add the app to your Home Screen and open it from there.");
  add("Notification" in window && Notification.permission === "granted", "Notifications allowed",
    "Allow them in your phone's Settings, then tap Turn On Notifications on the Setup screen.");
  let sub = null, note = "";
  try { sub = await currentSub(); } catch {}
  add(!!sub, "This phone can receive alerts", "Tap Turn On Notifications on the Setup screen.");
  try {
    const p = (await api(`profiles?id=eq.${session.user.id}&select=*`))[0];
    add(p && p.status === "approved", "Account approved", "Ask the admin to approve you.");
    if (p && p.quiet_start && p.quiet_end) add(!inQuiet(p.quiet_start, p.quiet_end), "Outside your quiet hours", "Alerts sent during quiet hours are skipped. Change them in Settings.");
    add(p && !p.paused, "Alerts not paused", "Ask the admin to resume your alerts.");
    add(p && p.alert_types.length > 0, "At least one alert type is on", "Ask the admin to turn on an alert type.");
    if (sub) {
      const d = (await api(`subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}&select=active,last_ok_at`))[0];
      add(d && d.active, "Phone linked to your account", "Tap Turn On Notifications on the Setup screen to link it again.");
      note = d && d.last_ok_at ? `The last alert reached this phone ${ago(d.last_ok_at)}.` : "No alert has reached this phone yet.";
    }
    const w = (await api("watcher_status?select=last_check_at"))[0];
    add(w && w.last_check_at && Date.now() - new Date(w.last_check_at) < 5 * 60e3, "Watcher is running",
      "The admin's computer may be off. Alerts start again when it is back on.");
  } catch (e) { add(false, "Couldn't reach the server", e.message); }
  $("diag").innerHTML = rows.map((r) => `<li class="${r.ok ? "done" : "bad"}"><span class="mark">${r.ok ? "\u2713" : "!"}</span>
    <span>${esc(r.label)}${r.ok ? "" : `<span class="fix">${esc(r.fix)}</span>`}</span></li>`).join("");
  $("diag-note").textContent = note;
};

// ---- Theme (Dark / Light / Auto; default Dark) ----
function savedMode() { try { return localStorage.getItem("tp-theme") || "dark"; } catch { return "dark"; } }
function applyTheme(mode) {
  const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#0d1126" : "#f3f5fb";
  document.querySelectorAll("#theme button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
}
document.querySelectorAll("#theme button").forEach((b) => {
  b.onclick = () => {
    try { localStorage.setItem("tp-theme", b.dataset.mode); } catch {}
    applyTheme(b.dataset.mode);
  };
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(savedMode()));
applyTheme(savedMode());

// ---- Accounts (Supabase; the publishable key is public by design, the database rules do the locking) ----
const SB_URL = "https://ddeapflekaecxqetayil.supabase.co";
const SB_KEY = "sb_publishable_3Y_Na0OOoVnveCA6iBgwtg_3xnII6fu";
let session = null, profile = null, signUpMode = false;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
async function call(url, opts) {
  let r;
  try { r = await fetch(url, opts); } catch { const e = new Error("No connection. Check your internet and try again."); e.network = true; throw e; }
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    const text = (j && (j.msg || j.error_description || j.message)) || "Something went wrong.";
    const e = new Error(text.charAt(0).toUpperCase() + text.slice(1));
    e.status = r.status; throw e;
  }
  return j;
}
const authCall = (path, body) => call(`${SB_URL}/auth/v1/${path}`, {
  method: "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const toSession = (j) => ({
  access_token: j.access_token, refresh_token: j.refresh_token,
  expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, email: j.user.email },
});
async function token() {
  if (!session) return null;
  if (session.expires_at - 60 < Date.now() / 1000) {
    try {
      session = toSession(await authCall("token?grant_type=refresh_token", { refresh_token: session.refresh_token }));
      store.set("tp-session", session);
    } catch (e) {
      if (!e.network) { session = null; store.set("tp-session", null); return null; }
    }
  }
  return session && session.access_token;
}
async function api(path, opts = {}) {
  const t = await token();
  if (!t) throw Object.assign(new Error("Signed out."), { status: 401 });
  return call(`${SB_URL}/rest/v1/${path}`, {
    ...opts, headers: { apikey: SB_KEY, Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

// ---- Which screen to show ----
const hideSplash = () => $("splash").classList.add("gone");
setTimeout(hideSplash, 4000);   // never leave the launch screen up if the network is slow
function showGate(id) {
  hideSplash();
  $("tabs").hidden = true;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
}
function showApp() {
  hideSplash();
  $("tabs").hidden = false;
  $("admin-tab").hidden = !(profile && profile.role === "admin");
  $("acct-email").textContent = session ? session.user.email : "";
  $("manual-link").hidden = !(profile && profile.role === "admin");
  if (!store.get("tp-since")) store.set("tp-since", Date.now());   // only alerts after this phone first signed in can count as missed
  fillQuiet();
  syncSubscription();
  renderWatcher();
  let tab = document.querySelector("#tabs button.active");
  if (!tab || tab.hidden) tab = document.querySelector('#tabs [data-tab="alerts"]');
  tab.click();
}
async function loadProfile() {
  try {
    const rows = await api(`profiles?id=eq.${session.user.id}&select=*`);
    profile = rows[0] || { status: "removed" };
    store.set("tp-profile", profile);
  } catch (e) {
    if (e.status === 401) return signedOut();
    profile = store.get("tp-profile");   // offline: use what we last knew
    if (!profile) { showGate("gate-auth"); $("auth-msg").textContent = e.message; $("auth-msg").className = "msg error"; return; }
  }
  if (profile.status === "approved") showApp();
  else showGate({ pending: "gate-pending", blocked: "gate-blocked" }[profile.status] || "gate-removed");
}
function signedOut() {
  session = null; profile = null;
  store.set("tp-session", null); store.set("tp-profile", null);
  showGate("gate-auth");
}

// ---- Sign in / create account ----
function setMode(signUp) {
  signUpMode = signUp;
  $("auth-title").textContent = signUp ? "Create Your Account" : "Sign In to TP Notify";
  $("auth-submit").textContent = signUp ? "Create Account" : "Sign In";
  $("auth-toggle").textContent = signUp ? "I Already Have an Account" : "Create an Account";
  $("auth-hint").hidden = !signUp;
  $("auth-pass").autocomplete = signUp ? "new-password" : "current-password";
  $("auth-msg").textContent = "";
}
$("auth-toggle").onclick = () => setMode(!signUpMode);
$("auth-form").onsubmit = async (ev) => {
  ev.preventDefault();
  const msg = $("auth-msg"), btn = $("auth-submit");
  msg.className = "msg"; msg.textContent = ""; btn.disabled = true;
  try {
    const body = { email: $("auth-email").value.trim(), password: $("auth-pass").value };
    const j = await authCall(signUpMode ? "signup" : "token?grant_type=password", body);
    if (!j.access_token) throw new Error("Account created, but sign-in didn't finish. Try signing in.");
    session = toSession(j); store.set("tp-session", session);
    $("auth-pass").value = "";
    await loadProfile();
  } catch (e) {
    msg.className = "msg error";
    msg.textContent = /invalid login/i.test(e.message) ? "Email or password is wrong."
      : /already registered/i.test(e.message) ? "That email already has an account. Sign in instead."
      : e.message;
  }
  btn.disabled = false;
};
document.querySelectorAll(".signout").forEach((b) => { b.onclick = signedOut; });
$("pending-check").onclick = loadProfile;

// ---- Watcher health (everyone sees a one-line version; admin sees it on the Admin tab too) ----
function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
async function renderWatcher() {
  try {
    const r = (await api("watcher_status?select=last_check_at,ok"))[0];
    const stale = !r || !r.last_check_at || Date.now() - new Date(r.last_check_at) > 5 * 60e3;
    const state = stale ? "problem" : r.ok ? "on" : "check";
    const text = stale
      ? (r && r.last_check_at ? `Watcher quiet since ${ago(r.last_check_at)}` : "Watcher hasn't checked in yet")
      : r.ok ? `Watcher checked ${ago(r.last_check_at)}` : `Watcher had a problem ${ago(r.last_check_at)}`;
    ["watcher-line", "watcher-admin"].forEach((id) => { const el = $(id); el.hidden = false; el.className = `health ${state}`; el.textContent = text; });
  } catch { /* offline: keep whatever is showing */ }
}

// ---- Admin (the database refuses anyone who isn't the admin) ----
const TYPE_NAMES = { on_sale: "Tickets on Sale", check: "Check Manually" };
let people = [], sheetPerson = null, sheetMode = "menu";
const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

function personRow(p) {
  const me = p.id === session.user.id;
  const name = p.nickname || p.email;
  const devices = p.active_devices === 1 ? "1 Device" : `${p.active_devices} Devices`;
  const types = p.alert_types.length ? p.alert_types.map((t) => TYPE_NAMES[t] || t).join(" and ") : "No Alerts";
  return `<div class="person">
    <div class="person-head">
      <div>
        <div class="who">${esc(name)}${me ? " (You)" : ""}</div>
        ${p.nickname ? `<div class="meta">${esc(p.email)}</div>` : ""}
        <div class="meta"><span class="state-${esc(p.status)}">${esc(p.status.charAt(0).toUpperCase() + p.status.slice(1))}</span>${p.paused ? ", Paused" : ""}, ${esc(devices)}</div>
        <div class="meta">${esc(types)}</div>
        ${p.keywords && p.keywords.length ? `<div class="meta">Keywords: ${esc(p.keywords.join(", "))}</div>` : ""}
      </div>
      <button class="dots secondary" data-menu="${esc(p.id)}" aria-label="Actions for ${esc(name)}">${DOTS}</button>
    </div>
    ${p.status === "pending" ? `<div class="row-actions"><button data-act="approve" data-id="${esc(p.id)}">Approve</button></div>` : ""}
  </div>`;
}
async function renderLog() {
  try {
    const rows = await api("alert_log?select=created_at,type,event_name,recipients&order=created_at.desc&limit=8");
    $("alert-log").innerHTML = rows.map((r) => `<div class="logrow"><div>${esc(LABELS[r.type] || r.type)}${r.event_name ? `: ${esc(r.event_name)}` : ""}</div>
      <div class="meta">Sent to ${r.recipients} ${r.recipients === 1 ? "device" : "devices"}, ${esc(ago(r.created_at))}</div></div>`).join("")
      || '<p class="muted">No alerts sent yet.</p>';
  } catch { $("alert-log").innerHTML = ""; }
}
// People waiting for approval come first; the search box (shown once there are more than 5 people) narrows the list.
function showPeople() {
  const q = $("people-search").value.trim().toLowerCase(), order = { pending: 0, approved: 1, blocked: 2 };
  const list = people.filter((p) => !q || `${p.nickname} ${p.email}`.toLowerCase().includes(q))
    .sort((a, b) => order[a.status] - order[b.status]);
  $("people").innerHTML = list.map(personRow).join("") || `<p class="muted">${people.length ? "No One Matches." : "No one has signed up yet."}</p>`;
}
$("people-search").oninput = showPeople;
$("invite").onclick = async () => {
  const link = new URL("./", location.href).href;
  const text = `Join TP Notify for Timepiece ticket alerts.\n1. Open this link in Safari: ${link}\n2. Tap Share, then Add to Home Screen.\n3. Open TP Notify from its new icon, create an account and turn on notifications.\nI'll approve you once you've signed up.`;
  try { await navigator.clipboard.writeText(text); say("Invite message copied. Paste it into a chat."); }
  catch { say("Couldn't copy. Send them this link: " + link, true); }
};
async function renderAdmin() {
  const msg = $("admin-msg");
  if (!msg.textContent) { msg.className = "msg muted"; msg.textContent = "Loading..."; }
  renderWatcher();
  try {
    people = await api("rpc/admin_people", { method: "POST", body: "{}" });
    if (msg.textContent === "Loading...") msg.textContent = "";
    const n = (s) => people.filter((p) => p.status === s).length;
    $("people-count").textContent = `${n("approved")} Approved, ${n("pending")} Waiting, ${n("blocked")} Blocked`;
    $("people-search").hidden = people.length <= 5;
    showPeople();
  } catch (e) {
    $("people").innerHTML = "";
    msg.className = "msg error"; msg.textContent = e.message;
  }
  renderLog();
}
function say(text, error) {
  const m = $("admin-msg"); m.className = "msg" + (error ? " error" : " muted"); m.textContent = text;
  setTimeout(() => { if (m.textContent === text) m.textContent = ""; }, 6000);
}
const patchProfile = (id, fields) => api(`profiles?id=eq.${encodeURIComponent(id)}`, {
  method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(fields),
});

// ---- Triple-dot menu (a bottom sheet) ----
function drawSheet() {
  const p = sheetPerson, me = p.id === session.user.id, name = esc(p.nickname || p.email);
  let html;
  if (sheetMode === "nickname") {
    html = `<h3>Nickname</h3><p class="muted">Only you can see this.</p>
      <input id="nick-input" maxlength="40" value="${esc(p.nickname)}" placeholder="For example: Sam from work">
      <button data-act="save-nick">Save</button><button class="secondary" data-act="back">Cancel</button>`;
  } else if (sheetMode === "types") {
    html = `<h3>Alert Types</h3><p class="muted">What ${name} gets alerts for.</p>
      ${Object.entries(TYPE_NAMES).map(([k, v]) => `<label class="check"><input type="checkbox" data-type="${k}" ${p.alert_types.includes(k) ? "checked" : ""}>${v}</label>`).join("")}
      <button data-act="save-types">Save</button><button class="secondary" data-act="back">Cancel</button>`;
  } else if (sheetMode === "keywords") {
    html = `<h3>Keywords</h3><p class="muted">${name} only gets events containing one of these words. Separate them with commas. Leave it empty for every event.</p>
      <input id="kw-input" maxlength="120" value="${esc((p.keywords || []).join(", "))}" placeholder="For example: saturday, sketch">
      <button data-act="save-keywords">Save</button><button class="secondary" data-act="back">Cancel</button>`;
  } else if (sheetMode === "remove") {
    html = `<h3>Remove ${name}?</h3><p class="muted">This deletes their devices and nickname. They can ask to rejoin, and you would approve them again.</p>
      <button class="danger-btn" data-act="confirm-remove">Remove</button><button class="secondary" data-act="back">Cancel</button>`;
  } else {
    html = `<h3>${name}</h3>
      <button class="item" data-act="nickname">${p.nickname ? "Edit Nickname" : "Add Nickname"}</button>
      <button class="item" data-act="types">Alert Types</button>
      <button class="item" data-act="keywords">Keywords</button>
      ${p.active_devices > 0 ? '<button class="item" data-act="test">Send Test Notification</button>' : ""}
      <button class="item" data-act="pause">${p.paused ? "Resume Alerts" : "Pause Alerts"}</button>
      ${me ? "" : (p.status === "approved" ? '<button class="item" data-act="block">Block</button>'
        : `<button class="item" data-act="approve">${p.status === "blocked" ? "Unblock" : "Approve"}</button>`)}
      ${me ? "" : '<button class="item danger" data-act="remove">Remove</button>'}
      <button class="item" data-close>Close</button>`;
  }
  $("sheet-panel").innerHTML = html;
  if (sheetMode === "nickname") $("nick-input").focus();
}
function openSheet(id) {
  sheetPerson = people.find((p) => p.id === id);
  if (!sheetPerson) return;
  sheetMode = "menu"; drawSheet(); $("sheet").hidden = false;
}
const closeSheet = () => { $("sheet").hidden = true; };

$("people").onclick = async (ev) => {
  const menu = ev.target.closest("[data-menu]");
  if (menu) return openSheet(menu.dataset.menu);
  const b = ev.target.closest('button[data-act="approve"]');
  if (!b) return;
  b.disabled = true;
  try { await patchProfile(b.dataset.id, { status: "approved" }); say("Approved."); }
  catch (e) { say(e.message, true); }
  renderAdmin();
};
$("sheet").onclick = async (ev) => {
  if (ev.target.matches(".backdrop") || ev.target.closest("[data-close]")) return closeSheet();
  const b = ev.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act, p = sheetPerson;
  if (["nickname", "types", "keywords", "remove"].includes(act)) { sheetMode = act; return drawSheet(); }
  if (act === "back") { sheetMode = "menu"; return drawSheet(); }
  b.disabled = true;
  try {
    if (act === "save-nick") {
      await api("admin_notes?on_conflict=user_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: p.id, nickname: $("nick-input").value.trim() }),
      });
      say("Nickname saved.");
    } else if (act === "save-keywords") {
      const words = $("kw-input").value.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 10);
      await patchProfile(p.id, { keywords: words });
      say("Keywords saved.");
    } else if (act === "save-types") {
      const types = [...document.querySelectorAll("#sheet-panel input[data-type]")].filter((i) => i.checked).map((i) => i.dataset.type);
      await patchProfile(p.id, { alert_types: types });
      say("Alert types saved.");
    } else if (act === "test") {
      await api("test_requests", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: p.id }) });
      say("Test requested. It arrives within a minute while the watcher is running.");
    } else if (act === "pause") {
      await patchProfile(p.id, { paused: !p.paused });
      say(p.paused ? "Alerts resumed." : "Alerts paused.");
    } else if (act === "block") {
      await patchProfile(p.id, { status: "blocked" }); say("Blocked.");
    } else if (act === "approve") {
      await patchProfile(p.id, { status: "approved" }); say("Approved.");
    } else if (act === "confirm-remove") {
      await api(`profiles?id=eq.${encodeURIComponent(p.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      say("Removed.");
    }
  } catch (e) { say(e.message, true); }
  closeSheet();
  renderAdmin();
};

// A removed person can ask to rejoin; it creates a new pending request for the admin.
$("rejoin").onclick = async () => {
  try {
    await api("profiles", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: session.user.id, email: session.user.email }) });
    await loadProfile();
  } catch (e) { $("rejoin-msg").className = "msg error"; $("rejoin-msg").textContent = e.message; }
};

// ---- Boot ----
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
  navigator.serviceWorker.addEventListener("message", renderAlerts);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  renderAlerts();
  if (session && profile && profile.status === "approved") renderWatcher();
  if (session && profile && profile.status !== "approved") loadProfile();   // pick up an approval
});
renderAlerts();
session = store.get("tp-session");
if (session) loadProfile(); else showGate("gate-auth");
