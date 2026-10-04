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
    $("list").innerHTML = '<div class="empty">No alerts yet.<br>They will appear here when the watcher sends one.</div>';
    return;
  }
  $("list").innerHTML = items.map((a) => {
    const type = LABELS[a.type] ? a.type : "check";
    const url = safeUrl(a.url);
    const when = new Date(a.received).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
    return `<div class="card ${type}">
      <div class="label">${LABELS[type]}</div>
      <div class="name">${esc(a.name)}</div>
      <div class="when">${esc([a.day, a.date].filter(Boolean).join(" "))}</div>
      <div class="muted">Received ${esc(when)}</div>
      ${type === "on_sale" && url ? `<a class="btn big" href="${esc(url)}" target="_blank" rel="noopener">Open on FIXR</a>` : ""}
    </div>`;
  }).join("");
}

// ---- Tabs ----
document.querySelectorAll("nav button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === b.dataset.tab));
    if (b.dataset.tab === "alerts") renderAlerts();
    if (b.dataset.tab === "setup") renderChecklist();
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
  const row = (ok, text) => `<li>${ok ? "âœ…" : "â¬œ"} ${text}</li>`;
  $("checklist").innerHTML =
    row(standalone(), "Installed to Home Screen (opened from the icon)") +
    row(perm === "granted", "Notifications allowed") +
    row(!!sub, "Subscription created");
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
    $("setup-msg").textContent = "Done. Tap Copy and paste it into watcher_secrets.json.";
    $("sub").value = JSON.stringify(sub.toJSON(), null, 2);
  } catch (e) {
    $("setup-msg").textContent = "Couldn't enable notifications: " + e.name;
  }
  renderChecklist();
};
$("copy").onclick = async () => {
  const text = $("sub").value;
  if (!text) return;
  try { await navigator.clipboard.writeText(text); $("setup-msg").textContent = "Copied."; }
  catch { $("sub").select(); $("setup-msg").textContent = "Press and hold the text, then choose Copy."; }
};

// ---- Settings screen ----
$("test").onclick = async () => {
  if (!supported() || Notification.permission !== "granted") {
    alert("Enable notifications on the Setup screen first.");
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification("Test notification", { body: "This phone can show Timepiece alerts.", icon: "icon-192.png" });
};

// ---- Boot ----
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
  navigator.serviceWorker.addEventListener("message", renderAlerts);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderAlerts(); });
renderAlerts();
