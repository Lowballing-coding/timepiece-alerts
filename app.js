// Public VAPID key (safe to share; the private key stays on the laptop).
const VAPID_PUBLIC_KEY = "BCw69mMtS2gckHI0voqwM4uR0eupiXHxpfijl5sU0IrPSgD6SYNlcgKPKvkgH24NCACK8-TbzvuH6D1QHfVzGuI";

const $ = (id) => document.getElementById(id);
const LABELS = { on_sale: "Tickets on sale", check: "Check manually", problem: "Watcher problem" };

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
async function renderAlerts() {
  const items = await allAlerts();
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
      <h2>Nothing on sale yet</h2>
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
    return `${heading}<article class="alert ${type}">
      <time class="at">${esc(time)}</time>
      <div>
        <p class="status">${LABELS[type]}</p>
        <h3>${esc(a.name)}</h3>
        <p class="when">${esc([a.day, a.date].filter(Boolean).join(" "))}</p>
        ${type === "on_sale" && url ? `<a class="go" href="${esc(url)}" target="_blank" rel="noopener">Open on FIXR</a>` : ""}
      </div>
    </article>`;
  }).join("");
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
$("clear").onclick = async () => { await clearAlerts(); renderAlerts(); };

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
  const row = (n, ok, text) => `<li class="${ok ? "done" : ""}"><span class="mark">${ok ? "\u2713" : n}</span><span>${text}${ok ? " (done)" : ""}</span></li>`;
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
      new Promise((_, no) => setTimeout(() => no({ name: "service worker not ready, close and reopen the app" }), 10000)),
    ]);
    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
    $("sub").value = JSON.stringify(sub.toJSON(), null, 2);
    await saveSubscription(sub);
    $("setup-msg").textContent = "Done. This phone is linked to your account.";
  } catch (e) {
    $("setup-msg").textContent = "Couldn't finish setup: " + (e.message || e.name);
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
  reg.showNotification("Test notification", { body: "This phone can show Timepiece alerts.", icon: "icon-192.png" });
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
  if (!r.ok) { const e = new Error((j && (j.msg || j.error_description || j.message)) || "Something went wrong."); e.status = r.status; throw e; }
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
function showGate(id) {
  $("tabs").hidden = true;
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
}
function showApp() {
  $("tabs").hidden = false;
  $("admin-tab").hidden = !(profile && profile.role === "admin");
  $("acct-email").textContent = session ? session.user.email : "";
  $("manual-link").hidden = !(profile && profile.role === "admin");
  syncSubscription();
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
  $("auth-title").textContent = signUp ? "Create your account" : "Sign in to TP Notify";
  $("auth-submit").textContent = signUp ? "Create account" : "Sign in";
  $("auth-toggle").textContent = signUp ? "I already have an account" : "Create an account";
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

// ---- Admin: people list (the database refuses anyone who isn't the admin) ----
async function renderAdmin() {
  const box = $("people"), msg = $("admin-msg");
  msg.className = "msg muted"; msg.textContent = "Loading...";
  try {
    const people = await api("rpc/admin_people", { method: "POST", body: "{}" });
    msg.textContent = "";
    box.innerHTML = people.map((p) => {
      const me = p.id === session.user.id;
      const devices = p.active_devices === 1 ? "1 device" : `${p.active_devices} devices`;
      return `<div class="person">
        <div class="who">${esc(p.nickname ? `${p.nickname} (${p.email})` : p.email)}${me ? " (you)" : ""}</div>
        <div class="meta"><span class="state-${esc(p.status)}">${esc(p.status)}</span>, ${esc(p.role)}, ${esc(devices)}</div>
        ${me ? "" : `<div class="row-actions">
          ${p.status !== "approved" ? `<button data-id="${esc(p.id)}" data-set="approved">Approve</button>` : ""}
          ${p.status !== "blocked" ? `<button class="secondary" data-id="${esc(p.id)}" data-set="blocked">Block</button>` : ""}
        </div>`}
      </div>`;
    }).join("") || '<p class="muted">No one has signed up yet.</p>';
  } catch (e) {
    box.innerHTML = "";
    msg.className = "msg error"; msg.textContent = e.message;
  }
}
$("people").onclick = async (ev) => {
  const b = ev.target.closest("button[data-set]");
  if (!b) return;
  b.disabled = true;
  try {
    await api(`profiles?id=eq.${encodeURIComponent(b.dataset.id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: b.dataset.set }),
    });
  } catch (e) { $("admin-msg").className = "msg error"; $("admin-msg").textContent = e.message; }
  renderAdmin();
};

// ---- Boot ----
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
  navigator.serviceWorker.addEventListener("message", renderAlerts);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  renderAlerts();
  if (session && profile && profile.status !== "approved") loadProfile();   // pick up an approval
});
renderAlerts();
session = store.get("tp-session");
if (session) loadProfile(); else showGate("gate-auth");
