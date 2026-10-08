"""Sammelt die Marktdaten des letzten Handelstags für den Tagesbericht.

Läuft werktags früh als GitHub Action und schreibt reports/data/market.json.
Die Claude-Routine liest die Datei und schreibt daraus den Bericht.
"""
import json
import urllib.request
from datetime import datetime, timezone

SERVER = "https://aktiengurus.veith-jochen.workers.dev"
HEADERS = {"Origin": "https://jochen19xx.github.io", "User-Agent": "soxl-app-report"}


def get(path):
    req = urllib.request.Request(SERVER + path, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def day_move(symbol):
    candles = get(f"/candles?symbol={symbol}")["candles"]
    last, prev = candles[-1], candles[-2]
    return {
        "symbol": symbol,
        "date": datetime.fromtimestamp(last["t"] / 1000, timezone.utc).strftime("%Y-%m-%d"),
        "open": round(last["o"], 2), "high": round(last["h"], 2), "low": round(last["l"], 2),
        "close": round(last["c"], 2), "prev_close": round(prev["c"], 2),
        "change_pct": round((last["c"] / prev["c"] - 1) * 100, 2),
        "volume": last.get("v"),
        "last_10_closes": [round(k["c"], 2) for k in candles[-10:]],
    }


def main():
    soxl = day_move("SOXL")
    holdings = get("/holdings")
    top = []
    for h in holdings.get("holdings", []):
        try:
            m = day_move(h["symbol"])
            top.append({"symbol": h["symbol"], "name": h["name"], "weight": h["weight"],
                        "close": m["close"], "change_pct": m["change_pct"], "date": m["date"]})
        except Exception as e:  # einzelne Aktie fehlt: Bericht trotzdem möglich
            top.append({"symbol": h["symbol"], "name": h["name"], "weight": h["weight"], "error": str(e)})
    out = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "trading_day": soxl["date"],
        "soxl": soxl,
        "top10": top,
    }
    with open("reports/data/market.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(json.dumps(out, ensure_ascii=False)[:600])


if __name__ == "__main__":
    main()
