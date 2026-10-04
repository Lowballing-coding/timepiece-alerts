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
        <circle cx="60" cy="60" r="54" fill="none" stroke="#d9b66f" stroke-width="3"/>
        ${Array.from({ length: 12 }, (_, i) => `<line x1="60" y1="10" x2="60" y2="${i % 3 ? 16 : 20}" stroke="#8f95b8" stroke-width="${i % 3 ? 2 : 3}" transform="rotate(${i * 30} 60 60)"/>`).join("")}
        <path d="M60 60V34M60 60l18 10" stroke="#ece8dc" stroke-width="4" stroke-linecap="round" fill="none"/>
        <g class="sweep"><line x1="60" y1="70" x2="60" y2="14" stroke="#8ff0c0" stroke-width="1.5"/></g>
        <circle cx="60" cy="60" r="3.5" fill="#d9b66f"/>
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
    row(3, !!sub, "Create the link to your watcher");
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
    $("setup-msg").textContent = "Done. Tap Copy subscription, then paste it into watcher_secrets.json.";
    $("sub").value = JSON.stringify(sub.toJSON(), null, 2);
  } catch (e) {
    $("setup-msg").textContent = "Couldn't turn on notifications: " + e.name;
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
    alert("Turn on notifications on the Setup screen first.");
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
