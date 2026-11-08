// Shared by app.js and sw.js: when an event is over, so its alerts and notifications can clear themselves.
// The night an alert's event is on ("12 October" -> that day, in the right year), or null when it has no readable date.
function eventDate(a, now = Date.now()) {
  const m = /^(\d{1,2})\S*\s+([A-Za-z]{3})/.exec(a.date || "");
  const mon = m ? "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase()) : -1;
  if (mon < 0 || mon % 3) return null;
  const got = new Date(a.received || now);
  let y = got.getFullYear() - 1;
  for (; y <= got.getFullYear() + 1; y++) {   // the first year whose night isn't over before the alert came
    if (new Date(y, mon / 3, +m[1] + 1, 6) >= got - 7 * 864e5) break;
  }
  return new Date(Math.min(y, got.getFullYear() + 1), mon / 3, +m[1]);
}
// An event is over at 6am the morning after its date (nights run past midnight). Alerts with no date stay.
function eventOver(a, now = Date.now()) {
  const d = eventDate(a, now);
  return !!d && now >= new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 6);
}
// Takes finished events' notifications off the lock screen / notification centre. FIXR gives no end time,
// so "over" is 6am the morning after. Runs whenever the app opens and whenever a new alert arrives.
// Notifications from v77 or older carry no date: it is read from their text ("Saturday 8th November").
async function clearOverNotifications(reg) {
  try {
    for (const n of await reg.getNotifications()) {
      const d = n.data || {};
      const date = d.date || ((n.body || "").split("\n")[1] || "").replace(/^[A-Za-z]+day\s+/, "");
      if (eventOver({ date, received: d.received || n.timestamp })) n.close();
    }
  } catch {}
}
