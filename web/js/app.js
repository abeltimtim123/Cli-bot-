/* App shell: router, nav, status pills, theme */
const App = (() => {
  const NAV = [
    ["home", "Home"], ["connect", "Connect"], ["dashboard", "Dashboard"], ["strategy", "Strategy"], ["live", "Live Trading"],
    ["history", "History"], ["analytics", "Analytics"], ["risk", "Risk Controls"], ["settings", "Settings"], ["help", "Help & Guide"],
  ];
  const $ = (s) => document.querySelector(s);
  let cur = null, raf = 0;

  function applyTheme() { document.documentElement.dataset.theme = Store.get("ui").theme === "light" ? "light" : "dark"; }

  function route() {
    const id = (location.hash.replace(/^#\/?/, "") || "home").split("?")[0];
    const scr = Screens[id] || Screens.home;
    const key = Screens[id] ? id : "home";
    cur = { id: key, s: scr };
    const view = $("#view");
    view.innerHTML = scr.render();
    scr.mount && scr.mount(view);
    $("#pageTitle").textContent = scr.title;
    document.title = scr.title + " | Digit Bot Console";
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === key));
    $("#side").classList.remove("open");
    window.scrollTo(0, 0);
  }

  function status() {
    const runs = [...Engine.runs.values()];
    const active = runs.filter((r) => ["running", "connecting", "reconnecting"].includes(r.status));
    const pill = $("#runPill");
    pill.textContent = active.length ? `Running (${active.length})` : "Idle";
    pill.className = "pill " + (active.length ? "running" : "idle");
    let pnl = 0; runs.forEach((r) => (pnl += r.st.pnl));
    const pp = $("#pnlPill"); pp.textContent = "P&L " + UI.money(pnl); pp.className = "pill " + UI.cls(pnl);
    $("#realBanner").hidden = !Engine.runningReal();
    const badge = $("#modeBadge");
    badge.textContent = Engine.connected ? `Connected (${Engine.accounts.length})` : "Not connected";
    badge.className = "badge " + (Engine.connected ? "demo" : "");
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; status(); cur && cur.s.refresh && cur.s.refresh(); });
  }

  function init() {
    applyTheme();
    $("#nav").innerHTML = NAV.map(([id, l]) => `<a href="#/${id}" data-id="${id}">${l}</a>`).join("");
    $("#burger").onclick = () => $("#side").classList.toggle("open");
    window.addEventListener("hashchange", route);
    Engine.on("run", schedule);
    Engine.on("trade", schedule);
    Engine.on("log", schedule);
    Engine.on("accounts", () => { schedule(); cur && cur.id === "connect" && cur.s.refresh(); });
    Engine.on("tick", () => { cur && cur.s.tick && cur.s.tick(); });
    route(); status();
    // If a token survived a reload in this tab, reconnect quietly.
    if (Store.pat() && Store.get("conn").appId) {
      Engine.connect().then(() => { schedule(); cur.id === "connect" && cur.s.refresh(); }).catch(() => {});
    }
  }
  window.addEventListener("beforeunload", (e) => { if (Engine.isRunning()) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("DOMContentLoaded", init);
  return { applyTheme };
})();
