/* Screens. Each: render() -> html, mount(root) -> bind events, refresh() -> live update, tick() -> per tick. */
const Screens = (() => {
  const { esc, money, plain, cls, time, dt, pct } = UI;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const S = {};

  /* ---- shared pieces ---- */
  function bindForm(root, name, after) {
    $$("[data-k]", root).forEach((el) => {
      const handler = () => {
        const k = el.dataset.k, t = el.dataset.t;
        let v = el.type === "checkbox" ? el.checked : el.value;
        if (t === "num") { v = parseFloat(v); if (Number.isNaN(v)) return; }
        if (t === "int") { v = parseInt(v, 10); if (Number.isNaN(v)) return; }
        Store.set(name, { [k]: v });
        after && after();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });
  }
  const val = (name, k) => Store.get(name)[k];
  const field = (name, k, label, { t = "num", type = "number", step, min, max, hint = "" } = {}) =>
    `<label class="f"><span>${label}</span><input class="input" type="${type}" data-k="${k}" data-t="${t}" value="${esc(val(name, k))}"
      ${step ? `step="${step}"` : ""} ${min != null ? `min="${min}"` : ""} ${max != null ? `max="${max}"` : ""}>${hint ? `<small>${hint}</small>` : ""}</label>`;
  const select = (name, k, label, opts, t = "str", hint = "") =>
    `<label class="f"><span>${label}</span><select class="input" data-k="${k}" data-t="${t}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val(name, k)) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${hint ? `<small>${hint}</small>` : ""}</label>`;
  const check = (name, k, label, hint = "") =>
    `<label class="f chk"><input type="checkbox" data-k="${k}" data-t="bool" ${val(name, k) ? "checked" : ""}><span>${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`;

  const runList = () => [...Engine.runs.values()];
  const totals = () => {
    let trades = 0, wins = 0, pnl = 0;
    runList().forEach((r) => { trades += r.st.trades; wins += r.st.wins; pnl += r.st.pnl; });
    return { trades, wins, pnl };
  };
  const statusLabel = (s) => ({ idle: "Idle", connecting: "Connecting", running: "Running", reconnecting: "Reconnecting", stopped: "Stopped", finished: "Finished" }[s] || s);

  /* ============================== HOME ============================== */
  S.home = {
    title: "Home",
    render() {
      const t = totals(), strat = Store.get("strategy");
      const steps = [
        ["connect", "1. Connect", "Paste your App ID and Personal Access Token, then choose demo, real or both."],
        ["strategy", "2. Strategy", "Pick Over or Under, your barrier digit, stake and when to enter."],
        ["risk", "3. Risk controls", "Set stop-loss, take-profit, max trades and a stake cap."],
        ["dashboard", "4. Run", "Start the bot, watch it live, and stop it any time."],
      ];
      const tiles = [
        ["dashboard", "Dashboard", "Start and stop each account, see balance and profit at a glance."],
        ["live", "Live Trading", "Live digit stream, digit frequency and the bot's event log."],
        ["history", "History", "Every trade the bot placed. Filter, export to CSV."],
        ["analytics", "Analytics", "Profit curve, streaks and real win rate versus the maths."],
        ["strategy", "Strategy", "Over/Under, barrier, trigger digit, stake and escalation."],
        ["risk", "Risk Controls", "Hard limits that stop the bot for you."],
        ["settings", "Settings", "Theme, data and credential housekeeping."],
        ["help", "Help & Guide", "How it works, glossary, FAQ and safety notes."],
      ];
      return `<section class="hero card">
        <h2>Your Deriv digit-bot control room</h2>
        <p>Run a Digit Over/Under bot on the new Deriv API (Personal Access Token, one-time WebSocket link) from your browser. Everything happens on your device. Your token is kept only for this browser tab.</p>
        <div class="row"><a class="btn primary" href="#/${Engine.connected ? "dashboard" : "connect"}">${Engine.connected ? "Open dashboard" : "Connect your account"}</a><a class="btn" href="#/help">Read the guide</a></div>
      </section>
      <section class="grid c4">
        <div class="stat"><small>Connection</small><b>${Engine.connected ? "Connected" : "Not connected"}</b></div>
        <div class="stat"><small>Strategy</small><b>${strat.type === "over" ? "Over" : "Under"} ${strat.barrier}</b></div>
        <div class="stat"><small>Trades this session</small><b>${t.trades}</b></div>
        <div class="stat"><small>Session P&amp;L</small><b class="${cls(t.pnl)}">${money(t.pnl)}</b></div>
      </section>
      <h3 class="sec">Get going in four steps</h3>
      <section class="grid c4">${steps.map(([id, h, p]) => `<a class="card link" href="#/${id}"><h4>${h}</h4><p>${p}</p></a>`).join("")}</section>
      <h3 class="sec">Everything in this app</h3>
      <section class="grid c4">${tiles.map(([id, h, p]) => `<a class="card link" href="#/${id}"><h4>${h}</h4><p>${p}</p></a>`).join("")}</section>
      <section class="card warn-card"><h4>Read this once</h4>
        <p>Digits on Deriv's synthetic indices are random, and payouts include Deriv's margin. No barrier, trigger or filter gives you an edge. Waiting for a digit to appear or disappear only changes <i>when</i> you trade. Start on a demo account with a small stake and only risk money you can afford to lose. This is not financial advice.</p></section>`;
    },
  };

  /* ============================= CONNECT ============================= */
  S.connect = {
    title: "Connect",
    render() {
      const c = Store.get("conn");
      return `<div class="grid c2">
      <section class="card"><h3>Your credentials</h3>
        <p class="muted">Create a Personal Access Token with the <b>trade</b> scope at developers.deriv.com, under the same app as your App ID.</p>
        <label class="f"><span>Deriv App ID</span><input class="input" id="appId" autocomplete="off" spellcheck="false" placeholder="e.g. 34HGYCZ0dMbpuObajLBQT" value="${esc(c.appId)}"></label>
        <label class="f"><span>Personal Access Token (PAT)</span><input class="input" id="pat" type="password" autocomplete="off" spellcheck="false" placeholder="paste token" value="${esc(Store.pat())}"><small>Kept only in this tab. Closing the tab forgets it.</small></label>
        <details class="adv"><summary>Advanced connection</summary>
          ${check("conn", "useProxy", "Use local proxy", "Needed if the browser blocks requests to Deriv (CORS). Run <code>node server.js</code> and open http://127.0.0.1:8080.")}
          <label class="f"><span>REST base URL</span><input class="input" data-k="restBase" data-t="str" value="${esc(c.restBase)}"></label>
        </details>
        <div class="row"><button class="btn primary" id="btnConnect">${Engine.connected ? "Reconnect" : "Connect"}</button>
          <button class="btn" id="btnForget" ${Engine.connected || Store.pat() ? "" : "disabled"}>Forget token</button></div>
        <p id="connMsg" class="msg"></p>
      </section>
      <section class="card"><h3>Accounts</h3><div id="accList"></div>
        <p class="muted small">Tick the accounts the bot should trade. Demo and real can run together, each with its own limits and stats.</p></section></div>
      <section class="card"><h3>How connecting works</h3><ol class="steps">
        <li>The site calls <code>GET /trading/v1/options/accounts</code> with your token and App ID to list your accounts.</li>
        <li>For each account you start, it calls <code>POST .../accounts/{id}/otp</code> to get a single-use WebSocket link (valid 120 seconds).</li>
        <li>It opens that WebSocket, streams ticks, buys 1-tick contracts and reads the result.</li></ol></section>`;
    },
    mount(root) {
      bindForm(root, "conn");
      const msg = $("#connMsg", root);
      $("#btnConnect", root).onclick = async () => {
        const appId = $("#appId", root).value.trim(), pat = $("#pat", root).value.trim();
        if (!appId || !pat) { msg.className = "msg err"; msg.textContent = "Enter both the App ID and the token."; return; }
        Store.set("conn", { appId }); Store.setPat(pat);
        msg.className = "msg"; msg.textContent = "Connecting...";
        try {
          const a = await Engine.connect();
          const ids = Store.get("sel").ids.filter((id) => a.some((x) => x.id === id));
          if (!ids.length) { const demo = a.find((x) => x.type === "demo"); Store.set("sel", { ids: demo ? [demo.id] : a[0] ? [a[0].id] : [] }); }
          msg.className = "msg ok"; msg.textContent = `Connected. Found ${a.length} account${a.length === 1 ? "" : "s"}.`;
          S.connect.refresh(); UI.toast("Connected", "ok");
        } catch (e) { msg.className = "msg err"; msg.textContent = e.message; }
      };
      $("#btnForget", root).onclick = () => { Engine.disconnect(); $("#pat", root).value = ""; msg.textContent = "Token forgotten."; S.connect.refresh(); $("#btnForget", root).disabled = true; };
      this.refresh();
    },
    refresh() {
      const box = $("#accList"); if (!box) return;
      const sel = Store.get("sel").ids;
      if (!Engine.accounts.length) { box.innerHTML = `<div class="empty">Not connected yet. Your accounts will show here.</div>`; return; }
      box.innerHTML = Engine.accounts.map((a) => `<label class="acc ${a.type}"><input type="checkbox" data-acc="${esc(a.id)}" ${sel.includes(a.id) ? "checked" : ""}>
        <div><b>${esc(a.id)}</b><small>${esc(a.currency || "")} ${a.balance != null ? "&middot; " + plain(a.balance) : ""}</small></div><span class="badge ${a.type}">${a.type.toUpperCase()}</span></label>`).join("");
      $$("[data-acc]", box).forEach((el) => el.onchange = () => {
        const ids = $$("[data-acc]", box).filter((x) => x.checked).map((x) => x.dataset.acc);
        Store.set("sel", { ids });
        if (el.checked && Engine.accounts.find((a) => a.id === el.dataset.acc).type === "real") UI.toast("Real account selected. You'll be asked to confirm before it trades.", "warn");
      });
    },
  };

  /* ============================ DASHBOARD ============================ */
  async function startSelected() {
    const accs = Engine.selected();
    if (!Engine.connected) { UI.toast("Connect first.", "warn"); location.hash = "#/connect"; return; }
    if (!accs.length) { UI.toast("Tick at least one account in Connect.", "warn"); location.hash = "#/connect"; return; }
    const err = Engine.validate();
    if (err) { UI.toast(err, "err"); location.hash = "#/strategy"; return; }
    const s = Store.get("strategy"), r = Store.get("risk");
    const real = accs.filter((a) => a.type === "real" && !(Engine.runs.get(a.id) && Engine.runs.get(a.id).status === "running"));
    if (real.length && r.confirmReal) {
      const ok = await UI.confirmTyped("Trade with REAL money?",
        `The bot will place ${s.type.toUpperCase()} ${s.barrier} trades of ${s.stake} on <b>${real.map((a) => esc(a.id)).join(", ")}</b> until a limit is hit or you stop it. Digits are random and you can lose your stake on every trade.`, "YES");
      if (!ok) return;
    }
    Engine.startAll(accs);
  }
  S.dashboard = {
    title: "Dashboard",
    render() {
      return `<section class="card"><div class="row between"><div><h3>Bot control</h3><p class="muted small" id="dashSummary"></p></div>
        <div class="row"><button class="btn primary" id="btnStart">Start selected accounts</button><button class="btn danger" id="btnStop">Stop all</button></div></div></section>
        <div id="dashDyn"></div>`;
    },
    mount(root) {
      $("#btnStart", root).onclick = startSelected;
      $("#btnStop", root).onclick = () => { Engine.stopAll("Stopped by you"); };
      this.refresh();
    },
    refresh() {
      const dyn = $("#dashDyn"); if (!dyn) return;
      const s = Store.get("strategy"), r = Store.get("risk");
      $("#dashSummary").textContent = `${s.type === "over" ? "Over" : "Under"} ${s.barrier} on ${s.symbol}, stake ${s.stake}${s.useTrigger ? `, ${s.triggerMode === "disappear" ? "after a " + s.triggerDigit + " disappears" : "when a " + s.triggerDigit + " appears"}` : `, every ${s.waitTicks} tick(s)`}. Stop-loss ${r.stopLoss}, take-profit ${r.takeProfit}.`;
      const accs = Engine.selected();
      const t = totals();
      let html = `<section class="grid c4">
        <div class="stat"><small>Session P&amp;L</small><b class="${cls(t.pnl)}">${money(t.pnl)}</b></div>
        <div class="stat"><small>Trades</small><b>${t.trades}</b></div>
        <div class="stat"><small>Win rate</small><b>${pct(t.wins, t.trades)}</b></div>
        <div class="stat"><small>Expected win rate</small><b>${(Engine.winChance(s) * 100).toFixed(0)}%</b></div></section>`;
      if (!Engine.connected) html += `<div class="card empty">Not connected. <a href="#/connect">Connect your account</a> to start.</div>`;
      else if (!accs.length) html += `<div class="card empty">No account selected. <a href="#/connect">Pick one in Connect</a>.</div>`;
      html += `<section class="grid c2">` + accs.map((a) => {
        const run = Engine.runs.get(a.id);
        const st = run ? run.st : { trades: 0, wins: 0, losses: 0, pnl: 0, step: 0 };
        const status = run ? run.status : "idle";
        const bal = run && run.balance != null ? run.balance : a.balance;
        const cur = (run && run.currency) || a.currency;
        return `<article class="card acct ${a.type}"><div class="row between"><div><h4>${esc(a.id)}</h4><span class="badge ${a.type}">${a.type.toUpperCase()}</span></div>
          <span class="pill ${status}">${statusLabel(status)}${run && run.reason ? " &middot; " + esc(run.reason) : ""}</span></div>
          <div class="grid c3 mini"><div><small>Balance</small><b>${plain(bal, cur)}</b></div><div><small>P&amp;L</small><b class="${cls(st.pnl)}">${money(st.pnl)}</b></div>
          <div><small>Win / Loss</small><b>${st.wins} / ${st.losses}</b></div></div>
          <div class="row small muted"><span>Next stake: ${(s.martingale > 1 ? Math.min(s.stake * Math.pow(s.martingale, st.step), r.maxStake) : s.stake).toFixed(2)}</span><span>Loss streak: ${run ? run.st.lossStreak : 0}</span></div></article>`;
      }).join("") + `</section>`;
      const recent = Store.allTrades().slice(-8).reverse();
      html += `<section class="card"><h4>Recent trades</h4>${recent.length ? `<div class="tablewrap"><table><thead><tr><th>Time</th><th>Account</th><th>Contract</th><th>Stake</th><th>Result</th></tr></thead><tbody>${recent.map((x) =>
        `<tr><td>${time(x.t)}</td><td>${esc(x.acc)}</td><td>${esc(x.type.replace("DIGIT", ""))} ${x.barrier}</td><td>${plain(x.stake)}</td><td class="${x.win ? "pos" : "neg"}">${x.win ? "WIN" : "LOSS"} ${money(x.profit)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No trades yet.</div>`}</section>`;
      dyn.innerHTML = html;
    },
  };

  /* ============================= STRATEGY ============================= */
  S.strategy = {
    title: "Strategy",
    render() {
      const sym = [["R_10", "Volatility 10 Index"], ["R_25", "Volatility 25 Index"], ["R_50", "Volatility 50 Index"], ["R_75", "Volatility 75 Index"], ["R_100", "Volatility 100 Index"],
        ["1HZ10V", "Volatility 10 (1s)"], ["1HZ25V", "Volatility 25 (1s)"], ["1HZ50V", "Volatility 50 (1s)"], ["1HZ75V", "Volatility 75 (1s)"], ["1HZ100V", "Volatility 100 (1s)"]];
      return `<div class="grid c2"><section class="card"><h3>Contract</h3>
        ${select("strategy", "symbol", "Market", sym)}
        ${select("strategy", "type", "Prediction", [["over", "Digit Over"], ["under", "Digit Under"]], "str", "Over wins if the last digit is higher than the barrier. Under wins if it is lower.")}
        ${field("strategy", "barrier", "Barrier digit (0-9)", { t: "int", min: 0, max: 9 })}
        ${field("strategy", "stake", "Stake per trade", { step: "0.01", min: 0.35 })}
        <p class="note" id="stratChance"></p></section>
      <section class="card"><h3>When to enter</h3>
        ${check("strategy", "useTrigger", "Wait for a trigger digit", "Off = trade every N ticks.")}
        <div id="trigBox">
        ${field("strategy", "triggerDigit", "Trigger digit (0-9)", { t: "int", min: 0, max: 9 })}
        ${select("strategy", "triggerMode", "Trigger mode", [["disappear", "Trade when the digit DISAPPEARS (after it showed, the next tick is different)"], ["appear", "Trade when the digit APPEARS"]])}
        </div>
        <div id="tickBox">${field("strategy", "waitTicks", "Trade every N ticks", { t: "int", min: 1, max: 100 })}</div>
        ${select("strategy", "filter", "Extra filter", [["none", "None"], ["calm", "Only when the winning side was rare recently"]])}
        ${field("strategy", "filterWindow", "Filter window (ticks)", { t: "int", min: 3, max: 100 })}
        ${field("strategy", "filterThreshold", "Filter threshold (0-1)", { step: "0.05", min: 0, max: 1 })}
        <p class="note">A trigger changes <i>when</i> you trade, not your odds. Every tick's digit is independent of the last.</p></section></div>
      <section class="card"><h3>Stake escalation (martingale)</h3><div class="grid c2">
        ${field("strategy", "martingale", "Multiplier after a loss", { step: "0.1", min: 1, hint: "1 = flat stake (recommended). 2 doubles the stake after each loss." })}
        ${field("strategy", "maxSteps", "Max escalation steps", { t: "int", min: 0, max: 10 })}</div>
        <p class="note warn">Escalation can burn through your balance quickly during a losing run. The stake cap in Risk Controls still applies.</p></section>
      <div class="row"><button class="btn" id="stratReset">Reset to defaults</button><a class="btn primary" href="#/risk">Next: Risk controls</a></div>`;
    },
    mount(root) {
      bindForm(root, "strategy", () => this.refresh());
      $("#stratReset", root).onclick = () => { Store.reset("strategy"); S.strategy.rerender(); };
      this.refresh();
    },
    rerender() { const v = $("#view"); v.innerHTML = this.render(); this.mount(v); },
    refresh() {
      const s = Store.get("strategy"), el = $("#stratChance"); if (!el) return;
      const p = Engine.winChance(s), err = Engine.validate();
      $("#trigBox").hidden = !s.useTrigger; $("#tickBox").hidden = s.useTrigger;
      const win = s.type === "over" ? `last digit is ${s.barrier + 1}-9` : `last digit is 0-${s.barrier - 1}`;
      el.className = "note" + (err || p >= 0.85 ? " warn" : "");
      el.innerHTML = err ? esc(err) : `Wins when the ${win}: <b>${(p * 100).toFixed(0)}%</b> chance per trade.${p >= 0.85 ? " The payout is very small at this chance, so one loss erases many wins." : ""}${p <= 0.3 ? " Low chance, so expect long losing runs even with a big payout." : ""}`;
    },
  };

  /* ============================== LIVE ============================== */
  const mainRun = () => runList().find((r) => r.status === "running") || runList()[0];
  S.live = {
    title: "Live Trading",
    render() { return `<div id="liveDyn"></div><section class="card"><h4>Event log</h4><div id="logBox" class="logbox"></div></section>`; },
    mount() { this.refresh(); this.logs(); },
    winFn() { const s = Store.get("strategy"); return (d) => (s.type === "over" ? d > s.barrier : d < s.barrier); },
    tick() { this.paint(); },
    refresh() { this.paint(); this.logs(); },
    logs() {
      const b = $("#logBox"); if (!b) return;
      b.innerHTML = Engine.logs.slice(-60).reverse().map((l) => `<div class="log ${l.level}"><time>${time(l.t)}</time> ${esc(l.msg)}</div>`).join("") || `<div class="empty">Nothing yet. Start the bot from the Dashboard.</div>`;
    },
    paint() {
      const d = $("#liveDyn"); if (!d) return;
      const run = mainRun(), s = Store.get("strategy"), win = this.winFn();
      const digits = run ? run.digits : [];
      const last = run && run.lastTick;
      let trig = "Trigger off. Trading every " + s.waitTicks + " tick(s).";
      if (s.useTrigger) {
        const armed = run && run.prev === s.triggerDigit;
        trig = s.triggerMode === "disappear"
          ? (armed ? `<b class="warn-t">Armed.</b> A ${s.triggerDigit} just showed. Trade fires on the next tick that is NOT ${s.triggerDigit}.` : `Waiting for a ${s.triggerDigit} to show, then for it to disappear.`)
          : `Waiting for a ${s.triggerDigit} to appear.`;
      }
      d.innerHTML = `<div class="grid c2"><section class="card center"><small class="muted">${esc(s.symbol)} last digit</small>
        <div class="bigdigit ${last ? (win(last.digit) ? "pos" : "neg") : ""}">${last ? last.digit : "-"}</div>
        <div class="muted small">${last ? "Price " + esc(last.quote) : run ? "Waiting for ticks..." : "Bot not running"}</div>
        <p class="trig">${trig}</p></section>
        <section class="card"><h4>Last 30 digits <span class="muted small">(green = winning side)</span></h4>
        <div class="strip">${digits.slice(-30).map((x) => `<span class="dg ${win(x) ? "w" : "l"}${s.useTrigger && x === s.triggerDigit ? " t" : ""}">${x}</span>`).join("") || '<span class="empty">No ticks yet</span>'}</div>
        <h4 class="mt">Digit frequency (last ${Math.min(100, digits.length)} ticks)</h4>${UI.digitBars(digits.slice(-100), win)}</section></div>`;
    },
  };

  /* ============================= HISTORY ============================= */
  let hf = { acc: "all", res: "all" };
  S.history = {
    title: "History",
    rows() {
      return Store.allTrades().filter((x) => (hf.acc === "all" || x.acc === hf.acc) && (hf.res === "all" || (hf.res === "win") === x.win)).slice().reverse();
    },
    render() {
      const accs = [...new Set(Store.allTrades().map((x) => x.acc))];
      return `<section class="card"><div class="row between"><div class="row">
        <label class="f inline"><span>Account</span><select class="input" id="hAcc"><option value="all">All</option>${accs.map((a) => `<option ${hf.acc === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></label>
        <label class="f inline"><span>Result</span><select class="input" id="hRes">${["all", "win", "loss"].map((r) => `<option ${hf.res === r ? "selected" : ""}>${r}</option>`).join("")}</select></label></div>
        <div class="row"><button class="btn" id="hCsv">Export CSV</button><button class="btn danger" id="hClear">Clear history</button></div></div></section>
        <section class="card"><div id="hTable"></div></section>`;
    },
    mount(root) {
      $("#hAcc", root).onchange = (e) => { hf.acc = e.target.value; this.refresh(); };
      $("#hRes", root).onchange = (e) => { hf.res = e.target.value; this.refresh(); };
      $("#hCsv", root).onclick = () => {
        const rows = [["time", "account", "type", "symbol", "barrier", "stake", "profit", "result", "cum_pnl", "contract_id"]].concat(this.rows().reverse().map((x) => [new Date(x.t).toISOString(), x.acc, x.type, x.symbol, x.barrier, x.stake, x.profit, x.win ? "win" : "loss", x.pnl, x.id]));
        UI.download("digit-bot-trades.csv", UI.csv(rows));
      };
      $("#hClear", root).onclick = async () => { if (await UI.confirmBox("Clear history?", "This deletes the trade list stored in this browser. It does not touch Deriv.", "Clear", "danger")) { Store.clearTrades(); S.history.rerender(); } };
      this.refresh();
    },
    rerender() { const v = $("#view"); v.innerHTML = this.render(); this.mount(v); },
    refresh() {
      const el = $("#hTable"); if (!el) return;
      const rows = this.rows();
      el.innerHTML = rows.length ? `<div class="tablewrap"><table><thead><tr><th>Time</th><th>Account</th><th>Market</th><th>Contract</th><th>Stake</th><th>Result</th><th>Cum. P&amp;L</th></tr></thead><tbody>${rows.slice(0, 500).map((x) =>
        `<tr><td>${dt(x.t)}</td><td>${esc(x.acc)} <span class="badge ${esc(x.atype)}">${esc(x.atype)}</span></td><td>${esc(x.symbol)}</td><td>${esc(x.type.replace("DIGIT", ""))} ${x.barrier}</td><td>${plain(x.stake)}</td><td class="${x.win ? "pos" : "neg"}">${x.win ? "WIN" : "LOSS"} ${money(x.profit)}</td><td class="${cls(x.pnl)}">${money(x.pnl)}</td></tr>`).join("")}</tbody></table></div>${rows.length > 500 ? `<p class="muted small">Showing newest 500 of ${rows.length}. Export CSV for all.</p>` : ""}` : `<div class="empty">No trades match.</div>`;
    },
  };

  /* ============================ ANALYTICS ============================ */
  let af = "all";
  S.analytics = {
    title: "Analytics",
    render() {
      const accs = [...new Set(Store.allTrades().map((x) => x.acc))];
      return `<section class="card"><label class="f inline"><span>Account</span><select class="input" id="aAcc"><option value="all">All accounts</option>${accs.map((a) => `<option ${af === a ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></label></section><div id="aDyn"></div>`;
    },
    mount(root) { $("#aAcc", root).onchange = (e) => { af = e.target.value; this.refresh(); }; this.refresh(); },
    refresh() {
      const el = $("#aDyn"); if (!el) return;
      const tr = Store.allTrades().filter((x) => af === "all" || x.acc === af);
      const n = tr.length, w = tr.filter((x) => x.win).length;
      let cum = 0; const curve = [0]; tr.forEach((x) => { cum += x.profit; curve.push(cum); });
      let streak = 0, maxL = 0, maxW = 0, ws = 0;
      tr.forEach((x) => { if (x.win) { ws++; streak = 0; maxW = Math.max(maxW, ws); } else { streak++; ws = 0; maxL = Math.max(maxL, streak); } });
      const gain = tr.filter((x) => x.profit > 0).reduce((a, x) => a + x.profit, 0), lossT = Math.abs(tr.filter((x) => x.profit < 0).reduce((a, x) => a + x.profit, 0));
      const s = Store.get("strategy"), expect = Engine.winChance(s);
      const avgStake = n ? tr.reduce((a, x) => a + x.stake, 0) / n : 0;
      let dd = 0, peak = 0; curve.forEach((v) => { peak = Math.max(peak, v); dd = Math.max(dd, peak - v); });
      el.innerHTML = `<section class="grid c4">
        <div class="stat"><small>Net P&amp;L</small><b class="${cls(cum)}">${money(cum)}</b></div>
        <div class="stat"><small>Trades</small><b>${n}</b></div>
        <div class="stat"><small>Actual win rate</small><b>${pct(w, n)}</b></div>
        <div class="stat"><small>Expected (current strategy)</small><b>${(expect * 100).toFixed(0)}%</b></div></section>
        <section class="card"><h4>Profit and loss curve</h4>${UI.lineChart(curve)}</section>
        <section class="grid c4">
        <div class="stat"><small>Longest win streak</small><b>${maxW}</b></div><div class="stat"><small>Longest loss streak</small><b>${maxL}</b></div>
        <div class="stat"><small>Max drawdown</small><b class="neg">${dd.toFixed(2)}</b></div><div class="stat"><small>Profit factor</small><b>${lossT ? (gain / lossT).toFixed(2) : n ? "&infin;" : "-"}</b></div>
        <div class="stat"><small>Average stake</small><b>${avgStake.toFixed(2)}</b></div><div class="stat"><small>Total gained</small><b class="pos">${gain.toFixed(2)}</b></div>
        <div class="stat"><small>Total lost</small><b class="neg">${lossT.toFixed(2)}</b></div><div class="stat"><small>Best / worst trade</small><b>${n ? Math.max(...tr.map((x) => x.profit)).toFixed(2) + " / " + Math.min(...tr.map((x) => x.profit)).toFixed(2) : "-"}</b></div></section>
        <section class="card"><h4>Reading these numbers</h4><p class="muted">Compare the actual win rate with the expected one. With only a few hundred trades they can differ a lot by pure luck, and over time the result tends toward the expected rate minus Deriv's margin. A profit factor under 1 means you are losing money overall.</p></section>`;
    },
  };

  /* ============================== RISK =============================== */
  S.risk = {
    title: "Risk Controls",
    render() {
      return `<div class="grid c2"><section class="card"><h3>Per-account limits</h3>
        <p class="muted small">Applied to each account separately. The bot stops that account when one is hit.</p>
        ${field("risk", "stopLoss", "Stop-loss (stop after losing this much)", { step: "0.01", min: 0 })}
        ${field("risk", "takeProfit", "Take-profit (stop after gaining this much)", { step: "0.01", min: 0 })}
        ${field("risk", "maxTrades", "Max trades per run", { t: "int", min: 1 })}</section>
      <section class="card"><h3>Safety</h3>
        ${field("risk", "maxStake", "Max stake cap (hard ceiling per trade)", { step: "0.01", min: 0.35, hint: "Even with escalation, no single trade exceeds this." })}
        ${field("risk", "maxReconnects", "Max reconnect attempts", { t: "int", min: 0, max: 10 })}
        ${check("risk", "confirmReal", "Ask me to type YES before real-money trading", "Recommended.")}</section></div>
      <section class="card"><h4>Good habits</h4><ul class="list"><li>Start on demo until you understand how a losing run feels.</li><li>Set a stop-loss you could lose without regret, and don't raise it mid-session.</li><li>Keep the stake small relative to your balance. Escalation multiplies losses fast.</li><li>Check your Deriv statement if the connection drops during a trade.</li></ul></section>`;
    },
    mount(root) { bindForm(root, "risk"); },
  };

  /* ============================= SETTINGS ============================ */
  S.settings = {
    title: "Settings",
    render() {
      return `<div class="grid c2"><section class="card"><h3>Appearance</h3>${select("ui", "theme", "Theme", [["dark", "Dark"], ["light", "Light"]])}</section>
      <section class="card"><h3>Your data</h3><p class="muted small">Settings and trade history are stored in this browser only. Nothing is sent to any server of ours.</p>
        <div class="row wrap"><button class="btn" id="setExport">Export settings</button><button class="btn" id="setReset">Reset all settings</button><button class="btn danger" id="setWipe">Forget token and clear history</button></div></section></div>
      <section class="card"><h3>About</h3><p class="muted">Digit Bot Console talks to Deriv's new Options API: REST for accounts and one-time passwords, WebSocket for ticks and trading. It is an independent tool and is not made or endorsed by Deriv.</p></section>`;
    },
    mount(root) {
      bindForm(root, "ui", () => App.applyTheme());
      $("#setExport", root).onclick = () => UI.download("digit-bot-settings.json", JSON.stringify({ strategy: Store.get("strategy"), risk: Store.get("risk") }, null, 2), "application/json");
      $("#setReset", root).onclick = async () => { if (await UI.confirmBox("Reset settings?", "Strategy and risk go back to defaults. Your App ID and history are kept.", "Reset")) { Store.reset("strategy"); Store.reset("risk"); UI.toast("Settings reset", "ok"); } };
      $("#setWipe", root).onclick = async () => { if (await UI.confirmBox("Forget token and clear history?", "Stops any running bot, removes your token from this tab and deletes stored trades.", "Do it", "danger")) { Engine.disconnect(); Store.clearTrades(); UI.toast("Done", "ok"); } };
    },
  };

  /* ================================ HELP ============================= */
  S.help = {
    title: "Help & Guide",
    render() {
      const qa = [
        ["What does the bot actually do?", "It listens to the tick stream of your chosen market. When your entry rule fires, it buys a 1-tick Digit Over or Digit Under contract with your stake. The contract settles on the very next tick, the result is recorded, and it waits for the next entry."],
        ["What do Over and Under mean?", "The barrier is a digit 0-9. <b>Over</b> wins if the last digit of the next tick is higher than the barrier. <b>Under</b> wins if it is lower. Under 9 wins on 0-8 (90%) but pays very little. Over 2 wins on 3-9 (70%)."],
        ["What does 'trade when the digit disappears' mean?", "With trigger digit 9 in Disappear mode, the bot waits for a 9 to show up. It keeps waiting while 9s repeat. On the first tick that is not a 9, it places the trade. 'Appear' mode trades on the 9 itself. Neither changes your odds, because each tick is independent."],
        ["Where do I get a token and App ID?", "At developers.deriv.com, register an app (that gives the App ID), then create a Personal Access Token under it with the trade scope. The token must belong to that App ID."],
        ["Is my token safe?", "It stays in this browser tab (session storage) and is sent only to Deriv, or to the local proxy on your own computer if you enable it. It is never saved to disk by this app and is gone when you close the tab. Use a token with only the scopes you need, and revoke it at Deriv if you ever suspect it leaked."],
        ["Why do I get a network or CORS error?", "Browsers may block direct calls to Deriv's REST API. Run <code>node server.js</code> in the web folder, open http://127.0.0.1:8080, and tick 'Use local proxy' in Connect."],
        ["Can demo and real run together?", "Yes. Tick both accounts in Connect. Each gets its own connection, limits and statistics. Real accounts require a typed YES by default."],
        ["What happens if my connection drops?", "The bot reconnects with a fresh one-time link, up to your limit. If a contract was open at that moment, it still settles on Deriv. Check the Deriv statement for the result."],
        ["Can this make money?", "Not reliably. The digits are random and payouts include a margin for Deriv, so the long-run expectation is a loss. Stake escalation does not fix that and can make a bad run much worse."],
      ];
      const gl = [["Tick", "One price update. Synthetic indices tick every 1-2 seconds."], ["Barrier", "The digit you compare the last digit against."], ["Stake", "The amount you pay for one contract."], ["Payout", "What you receive if it wins (stake plus profit)."], ["OTP", "One-time password link for the WebSocket. Valid 120 seconds, single use."], ["PAT", "Personal Access Token. Your key to the API."], ["Martingale", "Raising the stake after losses to recover them. High risk."], ["Drawdown", "The biggest drop from a profit peak."]];
      return `<section class="card"><h3>Quick start</h3><ol class="steps"><li><b>Connect</b>: enter App ID and token.</li><li><b>Strategy</b>: choose Over/Under, barrier, stake and entry rule.</li><li><b>Risk Controls</b>: set stop-loss, take-profit and stake cap.</li><li><b>Dashboard</b>: start. Watch it in <b>Live Trading</b>.</li><li>Review <b>History</b> and <b>Analytics</b>.</li></ol></section>
      <section class="card"><h3>Questions</h3>${qa.map(([q, a]) => `<details class="qa"><summary>${q}</summary><p>${a}</p></details>`).join("")}</section>
      <section class="card"><h3>Glossary</h3><dl class="gl">${gl.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl></section>
      <section class="card warn-card"><h4>Risk warning</h4><p>Trading derivatives can lose you all the money you stake. This tool is not financial advice and gives no guarantee of profit. Only trade money you can afford to lose.</p></section>`;
    },
  };

  return S;
})();
