/* UI helpers: escaping, formatting, modal, toast, charts */
const UI = (() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n, cur) => (n == null || Number.isNaN(n) ? "-" : (n < 0 ? "-" : n > 0 ? "+" : "") + Math.abs(n).toFixed(2) + (cur ? " " + cur : ""));
  const plain = (n, cur) => (n == null || Number.isNaN(n) ? "-" : Number(n).toFixed(2) + (cur ? " " + cur : ""));
  const cls = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
  const time = (t) => new Date(t).toLocaleTimeString([], { hour12: false });
  const dt = (t) => new Date(t).toLocaleString([], { hour12: false });
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "-");

  function toast(msg, kind = "info") {
    const root = document.getElementById("toasts");
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.classList.add("out"), 3800);
    setTimeout(() => el.remove(), 4300);
  }

  function modal({ title, body, actions }) {
    return new Promise((resolve) => {
      const root = document.getElementById("modal");
      root.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div class="modal-body">${body}</div><div class="modal-actions"></div></div>`;
      root.classList.add("open");
      const box = root.querySelector(".modal-actions");
      const close = (v) => { root.classList.remove("open"); root.innerHTML = ""; resolve(v); };
      actions.forEach((a) => {
        const b = document.createElement("button");
        b.className = "btn " + (a.kind || "");
        b.textContent = a.label;
        b.onclick = () => { if (a.check && !a.check(root)) return; close(a.value); };
        box.appendChild(b);
      });
      const first = root.querySelector("input"); if (first) first.focus();
    });
  }
  const confirmBox = (title, text, okLabel = "Confirm", kind = "primary") =>
    modal({ title, body: `<p>${text}</p>`, actions: [{ label: "Cancel", value: false }, { label: okLabel, value: true, kind }] });
  const confirmTyped = (title, text, word) =>
    modal({
      title,
      body: `<p>${text}</p><p>Type <b>${esc(word)}</b> to continue:</p><input id="typed" class="input" autocomplete="off">`,
      actions: [
        { label: "Cancel", value: false },
        { label: "Start trading", value: true, kind: "danger", check: (r) => r.querySelector("#typed").value.trim() === word },
      ],
    });

  /* Line chart (SVG). points: array of numbers. */
  function lineChart(points, { w = 640, h = 220 } = {}) {
    if (!points || points.length < 2) return `<div class="empty">Not enough trades yet to draw a curve.</div>`;
    const pad = { l: 44, r: 10, t: 10, b: 20 };
    const min = Math.min(0, ...points), max = Math.max(0, ...points);
    const span = max - min || 1;
    const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / (points.length - 1);
    const y = (v) => pad.t + ((max - v) * (h - pad.t - pad.b)) / span;
    const d = points.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    const last = points[points.length - 1];
    const ticks = [max, (max + min) / 2, min].map((v) => `<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text><line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`).join("");
    return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="Profit and loss curve">${ticks}
      <line x1="${pad.l}" x2="${w - pad.r}" y1="${y(0)}" y2="${y(0)}" class="zero"/>
      <path d="${d}" class="${last >= 0 ? "line-pos" : "line-neg"}" fill="none"/>
      <text x="${w - pad.r}" y="${h - 4}" text-anchor="end">${points.length - 1} trades</text></svg>`;
  }

  /* Bars for digit frequency 0-9. */
  function digitBars(digits, win) {
    const n = digits.length || 1;
    const c = Array(10).fill(0); digits.forEach((d) => c[d]++);
    const max = Math.max(...c, 1);
    return `<div class="bars">${c.map((v, d) => `<div class="bar-col"><div class="bar-val">${digits.length ? ((100 * v) / n).toFixed(0) + "%" : ""}</div>
      <div class="bar ${win(d) ? "w" : "l"}" style="height:${(v / max) * 100}%"></div><div class="bar-lbl">${d}</div></div>`).join("")}</div>`;
  }

  function csv(rows) {
    return rows.map((r) => r.map((c) => { const s = String(c == null ? "" : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n");
  }
  function download(name, text, type = "text/csv") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return { esc, money, plain, cls, time, dt, pct, toast, modal, confirmBox, confirmTyped, lineChart, digitBars, csv, download };
})();
