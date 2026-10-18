#!/usr/bin/env python3
"""
Deriv Digit Over/Under bot — new Deriv API (PAT + OTP WebSocket flow).

Flow (per developers.deriv.com):
  1. REST  GET  /trading/v1/options/accounts               (Bearer PAT + Deriv-App-ID)
  2. REST  POST /trading/v1/options/accounts/{id}/otp      -> ready-to-use wss URL
  3. WS    ticks -> buy (DIGITOVER / DIGITUNDER) -> proposal_open_contract

Setup:
  pip install websockets requests
  Add DERIV_PAT and DERIV_APP_ID to .env      # see .env.example

Run (defaults to demo and real together; use --account demo to avoid real trading):
  python deriv_overunder_bot.py --symbol R_100 --type over --barrier 2 --stake 1

Digits on synthetic indices are random. This bot has no edge; the payout is
priced to give Deriv a margin. Test on demo and only risk what you can lose.
"""
import argparse
import asyncio
import csv
import getpass
import itertools
import json
import os
import signal
import sys
import time
from collections import Counter, deque

import requests
import websockets

REST_BASE = "https://api.derivws.com"
OTP_TTL_NOTE = "OTP is single-use and expires in 120s, so connect right after requesting it."


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_env_file(path):
    """Load simple KEY=VALUE entries without overriding existing environment variables."""
    try:
        with open(path, encoding="utf-8") as env_file:
            for line in env_file:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key, value = key.strip(), value.strip()
                if value[:1] == value[-1:] and value.startswith(("'", '"')):
                    value = value[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = value
    except FileNotFoundError:
        pass


# --------------------------------------------------------------------------- REST
def rest_headers(pat, app_id):
    return {
        "Authorization": f"Bearer {pat}",
        "Deriv-App-ID": app_id,  # required when authenticating with a PAT
    }


def fetch_accounts(pat, app_id):
    r = requests.get(f"{REST_BASE}/trading/v1/options/accounts",
                     headers=rest_headers(pat, app_id), timeout=15)
    if r.status_code != 200:
        raise RuntimeError(f"GET accounts failed ({r.status_code}): {r.text[:300]}")
    data = r.json().get("data", [])
    if isinstance(data, dict):
        data = data.get("accounts", [data])
    return data


def pick_account(accounts, account_id, account_type):
    def aid(a):
        return a.get("account_id") or a.get("id") or a.get("loginid")

    def atype(a):
        t = (a.get("account_type") or a.get("type") or "").lower()
        if t:
            return t
        return "demo" if str(aid(a)).upper().startswith(("DOT", "VRT", "DEM")) else "real"

    if account_id:
        for a in accounts:
            if aid(a) == account_id:
                return aid(a), atype(a), a.get("currency", "USD")
        raise RuntimeError(f"Account {account_id} not found. Available: {[aid(a) for a in accounts]}")
    for a in accounts:
        if atype(a) == account_type:
            return aid(a), atype(a), a.get("currency", "USD")
    raise RuntimeError(f"No {account_type} account found. Got: {accounts}")


def pick_accounts(accounts, account_id, which):
    """Return a list of (account_id, type, currency). which: demo | real | both."""
    def aid(a):
        return a.get("account_id") or a.get("id") or a.get("loginid")

    def atype(a):
        t = (a.get("account_type") or a.get("type") or "").lower()
        if t:
            return t
        return "demo" if str(aid(a)).upper().startswith(("DOT", "VRT", "DEM")) else "real"

    if account_id:
        return [pick_account(accounts, account_id, which)]
    wanted = ["demo", "real"] if which == "both" else [which]
    chosen = []
    for w in wanted:
        match = next((a for a in accounts if atype(a) == w), None)
        if match:
            chosen.append((aid(match), w, match.get("currency", "USD")))
        else:
            log(f"No {w} account found on this token, skipping it.")
    if not chosen:
        raise RuntimeError(f"No usable accounts. Got: {accounts}")
    return chosen


def fetch_otp_url(pat, app_id, account_id):
    r = requests.post(f"{REST_BASE}/trading/v1/options/accounts/{account_id}/otp",
                      headers=rest_headers(pat, app_id), timeout=15)
    if r.status_code != 200:
        raise RuntimeError(f"OTP request failed ({r.status_code}): {r.text[:300]}")
    return r.json()["data"]["url"]


# ------------------------------------------------------------------ WebSocket API
class DerivWS:
    def __init__(self, url, symbol):
        self.url = url
        self.symbol = symbol
        self.ws = None
        self._ids = itertools.count(1)
        self._pending = {}
        self._contract_waiters = {}
        self.ticks = asyncio.Queue()
        self.digits = deque(maxlen=1000)
        self._tasks = []

    async def connect(self):
        self.ws = await websockets.connect(self.url, ping_interval=None, max_size=2**22)
        self._tasks = [asyncio.create_task(self._reader()), asyncio.create_task(self._keepalive())]

    async def close(self):
        for t in self._tasks:
            t.cancel()
        if self.ws:
            await self.ws.close()

    async def _keepalive(self):
        while True:
            await asyncio.sleep(25)
            await self.ws.send(json.dumps({"ping": 1}))

    async def _reader(self):
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                rid = msg.get("req_id")
                fut = self._pending.pop(rid, None)
                if fut and not fut.done():
                    fut.set_result(msg)

                if "tick" in msg and isinstance(msg["tick"], dict):
                    t = msg["tick"]
                    pip = t.get("pip_size", 2)
                    d = int(f"{float(t['quote']):.{pip}f}"[-1])
                    self.digits.append(d)
                    self.ticks.put_nowait(d)

                poc = msg.get("proposal_open_contract")
                if isinstance(poc, dict) and poc.get("is_sold"):
                    w = self._contract_waiters.pop(poc.get("contract_id"), None)
                    if w and not w.done():
                        w.set_result(poc)
        except Exception as e:  # connection dropped: fail everything waiting
            for f in list(self._pending.values()) + list(self._contract_waiters.values()):
                if not f.done():
                    f.set_exception(ConnectionError(f"WebSocket closed: {e}"))
            self.ticks.put_nowait(None)

    async def request(self, payload, timeout=15):
        rid = next(self._ids)
        payload = {**payload, "req_id": rid}
        fut = asyncio.get_event_loop().create_future()
        self._pending[rid] = fut
        await self.ws.send(json.dumps(payload))
        msg = await asyncio.wait_for(fut, timeout)
        if "error" in msg:
            e = msg["error"]
            raise RuntimeError(f"API error {e.get('code')}: {e.get('message')}")
        return msg

    async def subscribe_ticks(self):
        await self.request({"ticks": self.symbol, "subscribe": 1})

    async def buy_digit(self, contract_type, barrier, stake, currency):
        msg = await self.request({
            "buy": "1",
            "price": stake,  # max price we accept
            "parameters": {
                "contract_type": contract_type,
                "underlying_symbol": self.symbol,
                "barrier": str(barrier),
                "amount": stake,
                "basis": "stake",
                "currency": currency,
                "duration": 1,
                "duration_unit": "t",
            },
        })
        return msg["buy"]

    async def wait_result(self, contract_id, timeout=40):
        fut = asyncio.get_event_loop().create_future()
        self._contract_waiters[contract_id] = fut
        await self.request({"proposal_open_contract": 1, "contract_id": contract_id, "subscribe": 1})
        return await asyncio.wait_for(fut, timeout)


# ---------------------------------------------------------------------- Strategy
class Stats:
    def __init__(self):
        self.trades = self.wins = 0
        self.pnl = 0.0
        self.loss_streak = 0
        self.stake_step = 0


def next_stake(args, st):
    if args.martingale <= 1.0:
        return args.stake
    return round(args.stake * (args.martingale ** st.stake_step), 2)


def should_enter(args, digits):
    """Optional entry filter. Digits are independent, so this changes WHEN you trade, not your odds."""
    if args.filter == "none":
        return True
    recent = list(digits)[-args.filter_window:]
    if len(recent) < args.filter_window:
        return False
    if args.filter == "calm":
        # Only enter if the win-side has been under-represented recently (a popular, if unfounded, heuristic).
        win = [d > args.barrier if args.type == "over" else d < args.barrier for d in recent]
        return sum(win) / len(win) < args.filter_threshold
    return True


async def wait_trigger(bot, args):
    """Block until the trigger pattern completes.
    disappear: previous tick was the trigger digit and this tick is NOT (e.g. 9 then not-9).
    appear:    this tick is the trigger digit.
    The trade is placed right after, so it settles on the NEXT tick."""
    while not bot.ticks.empty():  # ignore stale ticks queued during the last trade
        bot.ticks.get_nowait()
    prev = bot.digits[-1] if bot.digits else None
    while True:
        d = await bot.ticks.get()
        if d is None:
            raise ConnectionError("stream ended")
        if args.trigger_mode == "disappear":
            fire = prev == args.trigger_digit and d != args.trigger_digit
        else:
            fire = d == args.trigger_digit
        prev = d
        if fire:
            return


async def trade_loop(args, pat, account_id, currency, st, writer):
    contract_type = "DIGITOVER" if args.type == "over" else "DIGITUNDER"
    url = fetch_otp_url(pat, args.app_id, account_id)
    bot = DerivWS(url, args.symbol)
    await bot.connect()
    log(f"Connected ({account_id}, {currency}). {OTP_TTL_NOTE}")
    await bot.subscribe_ticks()
    try:
        # warm up with a few ticks
        while len(bot.digits) < args.filter_window:
            if await bot.ticks.get() is None:
                raise ConnectionError("stream ended")
        while True:
            if st.trades >= args.max_trades:
                log(f"[{account_id}] Max trades reached.")
                return "done"
            if st.pnl <= -abs(args.stop_loss):
                log(f"[{account_id}] Stop-loss hit ({st.pnl:.2f}).")
                return "done"
            if st.pnl >= args.take_profit:
                log(f"[{account_id}] Take-profit hit ({st.pnl:.2f}).")
                return "done"

            if args.trigger_digit is not None:
                # wait for the trigger digit pattern (default: it shows up, then disappears)
                await wait_trigger(bot, args)
            else:
                # wait for a fresh tick, then optionally skip some
                for _ in range(args.wait_ticks):
                    if await bot.ticks.get() is None:
                        raise ConnectionError("stream ended")
            if not should_enter(args, bot.digits):
                continue

            stake = next_stake(args, st)
            try:
                buy = await bot.buy_digit(contract_type, args.barrier, stake, currency)
            except RuntimeError as e:
                log(f"Buy rejected: {e}")
                await asyncio.sleep(2)
                continue

            cid = buy["contract_id"]
            poc = await bot.wait_result(cid)
            profit = float(poc.get("profit", 0))
            won = profit > 0
            st.trades += 1
            st.wins += int(won)
            st.pnl += profit
            if won:
                st.stake_step = 0
            else:
                st.stake_step = min(st.stake_step + 1, args.max_steps)
            writer.writerow([time.strftime("%Y-%m-%d %H:%M:%S"), account_id, cid, contract_type,
                             args.barrier, stake, round(profit, 2), round(st.pnl, 2)])
            log(f"[{account_id}] #{st.trades} {contract_type} {args.barrier} stake={stake:.2f} "
                f"{'WIN ' if won else 'LOSS'} {profit:+.2f} | pnl={st.pnl:+.2f} "
                f"| win%={100 * st.wins / st.trades:.1f}")

            # drain ticks that piled up during settlement
            while not bot.ticks.empty():
                bot.ticks.get_nowait()
    finally:
        await bot.close()


def ask_credentials(args):
    pat = args.pat or os.environ.get("DERIV_PAT")
    app_id = args.app_id
    if not args.no_prompt:
        hint = f" [Enter = {app_id}]" if app_id else ""
        app_id = input(f"Deriv App ID{hint}: ").strip() or app_id
        hint = " [Enter = use $DERIV_PAT]" if pat else ""
        pat = getpass.getpass(f"Deriv API token / PAT (hidden){hint}: ").strip() or pat
    if not pat:
        sys.exit("A Personal Access Token is required.")
    if not app_id:
        sys.exit("A Deriv App ID is required.")
    return pat, app_id


async def run_account(args, pat, account_id, atype, currency, writer, stop):
    st = Stats()
    retries = 0
    while not stop.is_set():
        run = asyncio.create_task(trade_loop(args, pat, account_id, currency, st, writer))
        stopper = asyncio.create_task(stop.wait())
        done, _ = await asyncio.wait({run, stopper}, return_when=asyncio.FIRST_COMPLETED)
        if stopper in done:
            run.cancel()
            await asyncio.gather(run, return_exceptions=True)
            break
        stopper.cancel()
        try:
            if run.result() == "done":
                break
        except Exception as e:
            retries += 1
            if retries > args.max_reconnects:
                log(f"[{account_id}] Giving up after {retries - 1} reconnects: {e}")
                break
            wait = min(30, 2 ** retries)
            log(f"[{account_id}] Connection problem ({e}). Reconnecting in {wait}s with a fresh OTP "
                f"({retries}/{args.max_reconnects}). Any in-flight contract: check your statement.")
            await asyncio.sleep(wait)
    wr = (100 * st.wins / st.trades) if st.trades else 0
    log(f"[{account_id}] ({atype}) Finished. trades={st.trades} wins={st.wins} ({wr:.1f}%) "
        f"pnl={st.pnl:+.2f} {currency}")


async def main_async(args):
    if args.barrier < 0 or args.barrier > 9:
        sys.exit("--barrier must be 0-9")
    if (args.type == "over" and args.barrier == 9) or (args.type == "under" and args.barrier == 0):
        sys.exit("That barrier can never win for this contract type.")

    pat, args.app_id = ask_credentials(args)
    accounts = await asyncio.to_thread(fetch_accounts, pat, args.app_id)
    chosen = pick_accounts(accounts, args.account_id, args.account)
    for aid_, t_, c_ in chosen:
        log(f"Will trade {t_.upper()} account {aid_} ({c_})")

    if any(t == "real" for _, t, _ in chosen) and not args.yes_real:
        if not sys.stdin.isatty():
            sys.exit("Real account selected: re-run with --yes-real (or run interactively).")
        if input("A REAL account is included and will trade real money. Type YES to continue: ").strip() != "YES":
            sys.exit("Cancelled.")

    with open(args.log, "a", newline="") as f:
        writer = csv.writer(f)
        if f.tell() == 0:
            writer.writerow(["time", "account", "contract_id", "type", "barrier", "stake", "profit", "cum_pnl"])

        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for s_ in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(s_, stop.set)
            except NotImplementedError:
                pass

        await asyncio.gather(*[
            run_account(args, pat, aid_, t_, c_, writer, stop) for aid_, t_, c_ in chosen
        ])


def parse_args():
    p = argparse.ArgumentParser(description="Deriv Digit Over/Under bot (new API, PAT auth)")
    p.add_argument("--pat", help="PAT (prefer the DERIV_PAT env var)")
    p.add_argument("--app-id", default=os.environ.get("DERIV_APP_ID"),
                   help="Deriv App ID (default: $DERIV_APP_ID)")
    p.add_argument("--account", choices=["demo", "real", "both"], default="both",
                   help="Which account(s) to trade; both = demo and real at the same time")
    p.add_argument("--no-prompt", action="store_true", help="Do not ask for App ID / token (use env vars or flags)")
    p.add_argument("--account-id", help="Explicit account ID (overrides --account)")
    p.add_argument("--yes-real", action="store_true", help="Skip the YES confirmation for real accounts")
    p.add_argument("--symbol", default="R_100", help="e.g. R_10, R_100, 1HZ100V")
    p.add_argument("--type", choices=["over", "under"], default="over")
    p.add_argument("--barrier", type=int, default=2, help="Digit 0-9 (OVER wins if last digit > barrier)")
    p.add_argument("--stake", type=float, default=1.0)
    p.add_argument("--martingale", type=float, default=1.0,
                   help="Stake multiplier after a loss (1.0 = flat stake, recommended)")
    p.add_argument("--max-steps", type=int, default=3, help="Cap on consecutive stake escalations")
    p.add_argument("--wait-ticks", type=int, default=1, help="Ticks to wait between trades")
    p.add_argument("--trigger-digit", type=int, choices=range(10), metavar="0-9", default=None,
                   help="Only trade after this digit shows up / disappears (see --trigger-mode)")
    p.add_argument("--trigger-mode", choices=["disappear", "appear"], default="disappear",
                   help="disappear: trade once the digit has appeared and then stopped (default)")
    p.add_argument("--filter", choices=["none", "calm"], default="none")
    p.add_argument("--filter-window", type=int, default=10)
    p.add_argument("--filter-threshold", type=float, default=0.4)
    p.add_argument("--stop-loss", type=float, default=10.0, help="Stop after losing this much")
    p.add_argument("--take-profit", type=float, default=10.0, help="Stop after gaining this much")
    p.add_argument("--max-trades", type=int, default=200)
    p.add_argument("--max-reconnects", type=int, default=3)
    p.add_argument("--log", default="trades.csv")
    return p.parse_args()


if __name__ == "__main__":
    try:
        load_env_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
        asyncio.run(main_async(parse_args()))
    except KeyboardInterrupt:
        pass
    except (RuntimeError, requests.RequestException) as e:
        sys.exit(f"Error: {e}")
