/* Engine: talks to the new Deriv API (PAT -> OTP -> WebSocket) and runs the digit bot.
   One Run per account, so demo and real can trade side by side.
   Events: "tick" {acc,digit}, "trade" {trade}, "run" {id}, "log" {msg,level,acc}, "accounts" */
const Engine = (() => {
  const bus = new EventTarget();
  const emit = (t, d) => bus.dispatchEvent(new CustomEvent(t, { detail: d }));
  const on = (t, f) => bus.addEventListener(t, (e) => f(e.detail));
  const runs = new Map();
  const logs = [];
  let accounts = [];
  let connected = false;

  function log(msg, level = "info", acc = "") {
    logs.push({ t: Date.now(), msg, level, acc });
    if (logs.length > 300) logs.shift();
    emit("log", { msg, level, acc });
  }

  // ----------------------------------------------------------------- REST
  function restBase() {
    const c = Store.get("conn");
    return c.useProxy ? location.origin + "/proxy" : String(c.restBase || "").replace(/\/+$/, "");
  }
  async function api(method, path) {
    const headers = { Authorization: "Bearer " + Store.pat(), "Deriv-App-ID": Store.get("conn").appId };
    let r;
    try { r = await fetch(restBase() + path, { method, headers }); }
    catch (e) {
      throw new Error("Network/CORS error reaching Deriv. Turn on 'Use local proxy' in Connect and start the site with `node server.js`.");
    }
    let j = null;
    try { j = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok) {
      const m = j && j.errors && j.errors[0] ? j.errors[0].message : r.statusText;
      throw new Error(r.status + " " + m);
    }
    return j;
  }
  function norm(a) {
    const id = a.account_id || a.id || a.loginid || "";
    let type = String(a.account_type || a.type || "").toLowerCase();
    if (type !== "demo" && type !== "real") type = /^(DOT|VRT|DEM)/i.test(id) ? "demo" : "real";
    return { id, type, currency: a.currency || "", balance: a.balance != null ? Number(a.balance) : null };
  }
  async function connect() {
    const j = await api("GET", "/trading/v1/options/accounts");
    let d = j && j.data ? j.data : [];
    if (!Array.isArray(d)) d = d.accounts || [d];
    accounts = d.map(norm).filter((a) => a.id);
    connected = true;
    if (!accounts.length) log("Token is valid but no Options accounts were returned.", "warn");
    emit("accounts", {});
    return accounts;
  }
  function disconnect() {
    stopAll("Disconnected");
    Store.setPat("");
    accounts = []; connected = false; runs.clear();
    emit("accounts", {});
  }

  // ------------------------------------------------------------ validation
  function validate() {
    const s = Store.get("strategy"), r = Store.get("risk");
    if (!(s.barrier >= 0 && s.barrier <= 9)) return "Barrier must be a digit 0-9.";
    if (s.type === "over" && s.barrier === 9) return "Over 9 can never win. Pick a lower barrier.";
    if (s.type === "under" && s.barrier === 0) return "Under 0 can never win. Pick a higher barrier.";
    if (!(s.stake > 0)) return "Stake must be above 0.";
    if (s.stake > r.maxStake) return `Stake ${s.stake} is above your max stake cap (${r.maxStake}). Change it in Risk Controls.`;
    if (!/^\w{2,30}$/.test(s.symbol)) return "Symbol looks invalid (example: R_100).";
    return "";
  }
  const winChance = (s) => (s.type === "over" ? (9 - s.barrier) / 10 : s.barrier / 10);

  // ------------------------------------------------------------------ Run
  class Run {
    constructor(acc) {
      this.acc = acc;
      this.currency = acc.currency || "";
      this.balance = acc.balance;
      this.reset();
    }
    reset() {
      this.st = { trades: 0, wins: 0, losses: 0, pnl: 0, step: 0, lossStreak: 0, maxLossStreak: 0, equity: [0] };
      this.status = "idle"; this.reason = "";
      this.digits = []; this.prev = null; this.tc = 0; this.busy = false;
      this.reqId = 1; this.pend = new Map(); this.cw = new Map();
      this.stopFlag = false; this.finished = false; this.retries = 0; this.ws = null; this.ka = null;
      this.lastTick = null;
    }
    set(status, reason = "") { this.status = status; this.reason = reason; emit("run", { id: this.acc.id }); }

    async start() {
      this.reset();
      this.cfg = { s: { ...Store.get("strategy") }, r: { ...Store.get("risk") } };
      this.set("connecting");
      while (!this.stopFlag && !this.finished) {
        try { await this.session(); }
        catch (e) { log(`${this.acc.id}: ${e.message}`, "warn", this.acc.id); }
        if (this.stopFlag || this.finished) break;
        this.retries++;
        if (this.retries > this.cfg.r.maxReconnects) { this.finish("Too many connection failures"); break; }
        const wait = Math.min(30, 2 ** this.retries);
        this.set("reconnecting", `retry ${this.retries}/${this.cfg.r.maxReconnects} in ${wait}s`);
        log(`${this.acc.id}: reconnecting in ${wait}s with a fresh OTP. If a contract was open, check your statement.`, "warn", this.acc.id);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }

    async session() {
      const j = await api("POST", `/trading/v1/options/accounts/${encodeURIComponent(this.acc.id)}/otp`);
      const url = j && j.data && j.data.url;
      if (!url) throw new Error("OTP response had no WebSocket URL");
      await new Promise((resolve, reject) => {
        let opened = false;
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => { opened = true; this.onOpen(); };
        ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } this.onMsg(m); };
        ws.onerror = () => { if (!opened) reject(new Error("WebSocket could not connect")); };
        ws.onclose = () => {
          clearInterval(this.ka);
          this.failPending(new Error("closed"));
          if (this.stopFlag || this.finished) resolve();
          else reject(new Error(opened ? "Connection dropped" : "WebSocket closed before opening"));
        };
      });
    }

    onOpen() {
      this.set("running");
      log(`${this.acc.id} (${this.acc.type}) connected. Watching ${this.cfg.s.symbol}.`, "info", this.acc.id);
      this.ka = setInterval(() => this.raw({ ping: 1 }), 25000);
      this.send({ ticks: this.cfg.s.symbol, subscribe: 1 }).catch((e) => log(`${this.acc.id}: ticks: ${e.message}`, "error", this.acc.id));
      this.send({ balance: 1, subscribe: 1 }).catch(() => {});
    }

    raw(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    send(payload, timeout = 15000) {
      return new Promise((resolve, reject) => {
        if (!this.ws || this.ws.readyState !== 1) return reject(new Error("socket not open"));
        const id = this.reqId++;
        const t = setTimeout(() => { this.pend.delete(id); reject(new Error("request timed out")); }, timeout);
        this.pend.set(id, { resolve, reject, t });
        this.ws.send(JSON.stringify({ ...payload, req_id: id }));
      });
    }
    failPending(err) {
      for (const p of this.pend.values()) { clearTimeout(p.t); p.reject(err); }
      this.pend.clear();
      for (const w of this.cw.values()) { clearTimeout(w.t); w.reject(err); }
      this.cw.clear();
    }

    onMsg(m) {
      const p = m.req_id != null ? this.pend.get(m.req_id) : null;
      if (p) {
        this.pend.delete(m.req_id); clearTimeout(p.t);
        if (m.error) p.reject(new Error(m.error.message || m.error.code || "API error")); else p.resolve(m);
      } else if (m.error) {
        log(`${this.acc.id}: ${m.error.message || m.error.code}`, "warn", this.acc.id);
      }
      if (m.tick) this.onTick(m.tick);
      if (m.balance && typeof m.balance === "object") {
        this.balance = Number(m.balance.balance);
        if (m.balance.currency) this.currency = m.balance.currency;
        emit("run", { id: this.acc.id });
      }
      if (m.proposal_open_contract) this.onPoc(m.proposal_open_contract);
    }

    onTick(t) {
      const pip = t.pip_size != null ? t.pip_size : 2;
      const d = Number(Number(t.quote).toFixed(pip).slice(-1));
      if (Number.isNaN(d)) return;
      this.retries = 0;
      this.lastTick = { quote: Number(t.quote), digit: d, epoch: t.epoch };
      this.digits.push(d); if (this.digits.length > 500) this.digits.shift();
      emit("tick", { acc: this.acc.id, digit: d });

      const s = this.cfg.s;
      let fire;
      if (s.useTrigger) {
        fire = s.triggerMode === "disappear" ? (this.prev === s.triggerDigit && d !== s.triggerDigit) : d === s.triggerDigit;
      } else {
        this.tc++;
        fire = this.tc % Math.max(1, s.waitTicks) === 0;
      }
      this.prev = d;
      if (!fire || this.busy || this.status !== "running" || this.finished) return;
      if (!this.filterOk()) return;
      this.trade();
    }

    filterOk() {
      const s = this.cfg.s;
      if (s.filter !== "calm") return true;
      const rec = this.digits.slice(-s.filterWindow);
      if (rec.length < s.filterWindow) return false;
      const win = rec.filter((d) => (s.type === "over" ? d > s.barrier : d < s.barrier)).length;
      return win / rec.length < s.filterThreshold;
    }

    limitHit() {
      const r = this.cfg.r, st = this.st;
      if (st.trades >= r.maxTrades) return `Max trades reached (${r.maxTrades})`;
      if (st.pnl <= -Math.abs(r.stopLoss)) return `Stop-loss hit (${st.pnl.toFixed(2)})`;
      if (st.pnl >= r.takeProfit) return `Take-profit hit (+${st.pnl.toFixed(2)})`;
      return "";
    }

    async trade() {
      const lim = this.limitHit();
      if (lim) return this.finish(lim);
      const s = this.cfg.s, r = this.cfg.r;
      let stake = s.martingale > 1 ? s.stake * Math.pow(s.martingale, this.st.step) : s.stake;
      stake = Math.round(Math.min(stake, r.maxStake) * 100) / 100;
      const contract_type = s.type === "over" ? "DIGITOVER" : "DIGITUNDER";
      this.busy = true;
      try {
        const b = await this.send({
          buy: "1", price: stake,
          parameters: {
            contract_type, underlying_symbol: s.symbol, barrier: String(s.barrier),
            amount: stake, basis: "stake", currency: this.currency || "USD", duration: 1, duration_unit: "t",
          },
        });
        const cid = b.buy.contract_id;
        const poc = await this.waitContract(cid);
        const profit = Number(poc.profit);
        const win = profit > 0;
        const st = this.st;
        st.trades++; win ? st.wins++ : st.losses++;
        st.pnl += profit; st.equity.push(st.pnl);
        st.step = win ? 0 : Math.min(st.step + 1, s.maxSteps);
        st.lossStreak = win ? 0 : st.lossStreak + 1;
        st.maxLossStreak = Math.max(st.maxLossStreak, st.lossStreak);
        const trade = {
          id: cid, t: Date.now(), acc: this.acc.id, atype: this.acc.type, symbol: s.symbol,
          type: contract_type, barrier: s.barrier, stake, profit: Math.round(profit * 100) / 100,
          win, pnl: Math.round(st.pnl * 100) / 100, currency: this.currency,
        };
        Store.addTrade(trade);
        emit("trade", { trade });
        log(`${this.acc.id} #${st.trades} ${contract_type} ${s.barrier} stake ${stake.toFixed(2)} ${win ? "WIN" : "LOSS"} ${profit >= 0 ? "+" : ""}${profit.toFixed(2)}`, win ? "win" : "loss", this.acc.id);
      } catch (e) {
        log(`${this.acc.id}: trade failed: ${e.message}`, "error", this.acc.id);
      } finally {
        this.busy = false;
        const l2 = this.limitHit();
        if (l2 && !this.finished) this.finish(l2);
        else emit("run", { id: this.acc.id });
      }
    }

    waitContract(cid, timeout = 45000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { this.cw.delete(cid); reject(new Error("contract result timed out. Check your Deriv statement.")); }, timeout);
        this.cw.set(cid, { resolve, reject, t });
        this.send({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 }).catch((e) => {
          if (this.cw.has(cid)) { clearTimeout(t); this.cw.delete(cid); reject(e); }
        });
      });
    }
    onPoc(poc) {
      if (!poc.is_sold) return;
      const w = this.cw.get(poc.contract_id);
      if (w) { clearTimeout(w.t); this.cw.delete(poc.contract_id); w.resolve(poc); }
    }

    finish(reason) {
      if (this.finished) return;
      this.finished = true;
      log(`${this.acc.id}: stopped. ${reason}`, "info", this.acc.id);
      this.set("finished", reason);
      this.close();
    }
    stop(reason = "Stopped by you") {
      if (this.status === "idle" || this.finished) return;
      this.stopFlag = true;
      this.set("stopped", reason);
      log(`${this.acc.id}: ${reason}. An open contract (if any) still settles on Deriv's side.`, "info", this.acc.id);
      this.close();
    }
    close() { clearInterval(this.ka); try { this.ws && this.ws.close(); } catch (e) { /* ignore */ } }
  }

  // ------------------------------------------------------------ public API
  function startAll(accs) {
    for (const a of accs) {
      const existing = runs.get(a.id);
      if (existing && ["running", "connecting", "reconnecting"].includes(existing.status)) continue;
      const run = new Run(a);
      runs.set(a.id, run);
      run.start();
    }
  }
  function stopAll(reason) { for (const r of runs.values()) r.stop(reason); }
  const isRunning = () => [...runs.values()].some((r) => ["running", "connecting", "reconnecting"].includes(r.status));
  const runningReal = () => [...runs.values()].some((r) => r.acc.type === "real" && ["running", "connecting", "reconnecting"].includes(r.status));
  const selected = () => {
    const ids = Store.get("sel").ids;
    return accounts.filter((a) => ids.includes(a.id));
  };

  return {
    on, emit, log, logs, runs, connect, disconnect, startAll, stopAll, isRunning, runningReal, selected, validate, winChance,
    get accounts() { return accounts; }, get connected() { return connected; },
  };
})();
