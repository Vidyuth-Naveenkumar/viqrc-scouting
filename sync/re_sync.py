#!/usr/bin/env python3
"""
re_sync.py — Pull Nevada Middle School VEX IQ (VIQRC) teams, events, match
scores and skills scores from the RobotEvents API v2, and write one JSON file
you can upload on the scouting site's Import screen.

SETUP (one time)
  1. Sign in at https://events.vex.com/api/v2 and create an API token.
  2. pip install requests
  3. Mac/Linux:  export RE_TOKEN="paste-your-token"
     Windows:    set RE_TOKEN=paste-your-token

RUN
  python3 re_sync.py                  # Nevada, Middle School, current season
  python3 re_sync.py --region Nevada --grade "Middle School" --out nv_viqrc_ms.json

Then open the site, click "Import" (mentor only) and choose the JSON file.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    sys.exit("Missing 'requests'. Run: pip install requests")

API = "https://events.vex.com/api/v2"
VIQRC_PROGRAM_ID = 41  # VEX IQ Robotics Competition
ROUND_NAMES = {1: "Practice", 2: "Qualification", 3: "QF", 4: "SF", 5: "Final",
               6: "R16", 9: "Teamwork Final"}


class RE:
    def __init__(self, token):
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}",
                               "Accept": "application/json"})

    def get_all(self, path, params=None):
        """GET every page of a paginated endpoint."""
        params = dict(params or {})
        params["per_page"] = 250
        page, out = 1, []
        while True:
            params["page"] = page
            for attempt in range(5):
                r = self.s.get(f"{API}{path}", params=params, timeout=30)
                if r.status_code == 429:          # rate limited: back off
                    time.sleep(5 * (attempt + 1))
                    continue
                r.raise_for_status()
                break
            else:
                raise RuntimeError(f"Rate limited too long on {path}")
            body = r.json()
            out.extend(body.get("data", []))
            meta = body.get("meta", {})
            if page >= meta.get("last_page", 1):
                return out
            page += 1
            time.sleep(0.25)


def current_season(api):
    seasons = api.get_all("/seasons", {"program[]": VIQRC_PROGRAM_ID, "active": "true"})
    if not seasons:
        sys.exit("No active VIQRC season found.")
    seasons.sort(key=lambda s: s.get("start") or "", reverse=True)
    return seasons[0]


def team_score_in_match(match, number):
    """Return (score, partner numbers) for a team in one match, or None.
    VEX IQ teamwork matches list the two partners as separate alliances that
    share one score, so partners are every other team in the match."""
    def names(a):
        return [t.get("team", {}).get("name") for t in a.get("teams", []) if t.get("team", {}).get("name")]
    mine = next((a for a in match.get("alliances", []) if number in names(a)), None)
    if mine is None:
        return None
    partners = []
    for a in match.get("alliances", []):
        for n in names(a):
            if n != number and n not in partners:
                partners.append(n)
    return mine.get("score"), partners


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="Nevada")
    ap.add_argument("--grade", default="Middle School")
    ap.add_argument("--country", default="US")
    ap.add_argument("--out", default="nv_viqrc_ms.json")
    args = ap.parse_args()

    token = os.environ.get("RE_TOKEN")
    if not token:
        sys.exit("Set RE_TOKEN to your RobotEvents API token first (see top of file).")
    api = RE(token)

    season = current_season(api)
    sid = season["id"]
    print(f"Season: {season['name']} (id {sid})")

    # 1. Teams in the region + grade
    all_teams = api.get_all("/teams", {"program[]": VIQRC_PROGRAM_ID,
                                       "grade[]": args.grade,
                                       "country[]": args.country,
                                       "registered": "true"})
    teams = [t for t in all_teams
             if (t.get("location") or {}).get("region") == args.region]
    print(f"{len(teams)} {args.grade} teams in {args.region}")

    events, out_teams = {}, []
    for i, t in enumerate(teams, 1):
        num = t["number"]
        print(f"  [{i}/{len(teams)}] {num}")
        t_events = api.get_all(f"/teams/{t['id']}/events", {"season[]": sid})
        t_matches = api.get_all(f"/teams/{t['id']}/matches", {"season[]": sid})
        t_skills = api.get_all(f"/teams/{t['id']}/skills", {"season[]": sid})

        for e in t_events:
            events.setdefault(e["sku"], e)

        matches = []
        for m in t_matches:
            res = team_score_in_match(m, num)
            if res is None:
                continue
            score, partners = res
            ev = m.get("event") or {}
            matches.append({
                "event": ev.get("code") or str(ev.get("id", "")),
                "eventName": ev.get("name", ""),
                "round": ROUND_NAMES.get(m.get("round"), str(m.get("round"))),
                "name": m.get("name", ""),
                "score": score,
                "scored": bool(m.get("scored") or m.get("started")),
                "partners": partners,
                "date": (m.get("started") or m.get("scheduled") or "")[:10],
            })

        skills = [{
            "event": (s.get("event") or {}).get("code") or str((s.get("event") or {}).get("id", "")),
            "eventName": (s.get("event") or {}).get("name", ""),
            "type": s.get("type"),           # "driver" or "programming"
            "score": s.get("score"),
            "attempts": s.get("attempts"),
        } for s in t_skills]

        out_teams.append({
            "number": num,
            "name": t.get("team_name", ""),
            "robotName": t.get("robot_name", ""),
            "org": t.get("organization", ""),
            "city": (t.get("location") or {}).get("city", ""),
            "region": (t.get("location") or {}).get("region", ""),
            "grade": t.get("grade", ""),
            "reId": t["id"],
            "events": [e["sku"] for e in t_events],
            "matches": matches,
            "skills": skills,
        })

    # 2. Registered Middle School teams for each event those teams attend
    out_events = []
    for j, (sku, e) in enumerate(events.items(), 1):
        print(f"  event [{j}/{len(events)}] {sku}")
        reg = api.get_all(f"/events/{e['id']}/teams", {"grade[]": args.grade})
        loc = e.get("location") or {}
        out_events.append({
            "sku": sku,
            "name": e.get("name", ""),
            "start": (e.get("start") or "")[:10],
            "end": (e.get("end") or e.get("start") or "")[:10],
            "venue": loc.get("venue", ""),
            "city": loc.get("city", ""),
            "region": loc.get("region", ""),
            "reId": e["id"],
            "teams": [{"number": r["number"], "name": r.get("team_name", ""),
                       "org": r.get("organization", "")} for r in reg],
        })

    payload = {
        "format": "viqrc-scout-v1",
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": season["name"],
        "region": args.region,
        "grade": args.grade,
        "teams": out_teams,
        "events": out_events,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1)
    print(f"\nWrote {args.out}: {len(out_teams)} teams, {len(out_events)} events.")


if __name__ == "__main__":
    main()
