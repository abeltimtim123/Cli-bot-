/* Store: settings, trade history and credentials.
   - Settings + trades live in localStorage (this browser only).
   - The API token lives in sessionStorage only (gone when the tab closes) and is
     never written anywhere else. It is only sent to Deriv (or to your own local proxy). */
const Store = (() => {
  const K = "dob.";
  const DEF = {
    strategy: {
      symbol: "R_100", type: "under", barrier: 9,
      useTrigger: true, triggerDigit: 9, triggerMode: "disappear", waitTicks: 1,
      stake: 1, martingale: 1, maxSteps: 3,
      filter: "none", filterWindow: 10, filterThreshold: 0.4,
    },
    risk: { stopLoss: 10, takeProfit: 10, maxTrades: 200, maxStake: 10, maxReconnects: 3, confirmReal: true },
    conn: { appId: "", restBase: "https://api.derivws.com", useProxy: false },
    ui: { theme: "dark" },
    sel: { ids: [] },
  };
  const read = (k, f) => { try { const v = localStorage.getItem(K + k); return v ? JSON.parse(v) : f; } catch (e) { return f; } };
  const write = (k, v) => { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  const cache = {};
  let trades = read("trades", []);
  let memPat = "";

  function get(name) {
    if (!cache[name]) cache[name] = { ...DEF[name], ...read(name, {}) };
    return cache[name];
  }
  function set(name, patch) { cache[name] = { ...get(name), ...patch }; write(name, cache[name]); }
  function reset(name) { cache[name] = { ...DEF[name] }; write(name, cache[name]); }

  function pat() { try { return sessionStorage.getItem(K + "pat") || memPat; } catch (e) { return memPat; } }
  function setPat(v) { memPat = v || ""; try { v ? sessionStorage.setItem(K + "pat", v) : sessionStorage.removeItem(K + "pat"); } catch (e) { /* ignore */ } }

  function addTrade(t) { trades.push(t); if (trades.length > 5000) trades = trades.slice(-5000); write("trades", trades); }
  function allTrades() { return trades; }
  function clearTrades() { trades = []; write("trades", trades); }

  return { get, set, reset, pat, setPat, addTrade, allTrades, clearTrades, DEF };
})();
