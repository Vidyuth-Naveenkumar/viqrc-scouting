# Nevada VEX IQ Scouting

Scouting website for Nevada middle school VEX IQ teams, 2026-27 **Level Up** season.

Live site: (https://vidyuth-naveenkumar.github.io/viqrc-scouting/)

## Folder contents

```
viqrc-scouting/
├── README.md            this file
├── index.html            the website (published copy is the live link above)
└── sync/
    ├── package.json     Node project, depends on robotevents 6.0.4
    ├── package-lock.json
    ├── re_sync.js       main sync script (Node + robotevents library)
    └── re_sync.py       backup sync script (Python + requests), same output
```

## How it fits together

```
RobotEvents API ──► re_sync.js (your computer, needs RE_TOKEN)
                        │ writes nv_viqrc_ms.json
                        ▼
              Site ▸ Import data (mentor only)
                        │ saves to the site's database
                        ▼
Home ──┬─ Search box ──────────────────────────► Team stats  (#team-12345A)
       └─ Date filter ─► competitions that day
                           └─ click one (#event-SKU)
                                 └─ registered MS teams ─► Team stats

Team stats: name, school, past/upcoming competitions, robot photo,
            robot type, write-up, Level Up max-score calculator,
            scouted vs proven scores, speed gauge (pts / 5 s), match results
            [mentor only: Edit scouting, upload photo]
```

The site cannot call RobotEvents itself: hosted pages are blocked from talking to other websites. That is why the sync script runs on your computer and you upload its file.

## Database layout

| Collection | Document id | Fields |
|---|---|---|
| `teams` | team number | name, org, city, region, grade, events[], matches[], skills[] |
| `events` | event SKU | name, start, end, venue, city, teams[] |
| `scout` | team number | robotType, writeup, calc{floor,l1,l2,l3,l4}, pps5, photoId |

Only the owner/editors can write; anyone you share with can read. Import replaces `teams` and `events` but never touches `scout`, so notes and photos survive every re-sync.

## Level Up scoring used by the calculator

| Goal | Points per bean bag |
|---|---|
| Floor Goal | 1 |
| L1 (pyramid) | 3 |
| L2 (pyramid) | 6 |
| L3 (pyramid) | 12 |
| L4 (yellow only) | 16 |

38 bean bags on the field, 60-second matches. Speed estimate when no timed value is entered: max score ÷ 12.

## Syncing real data

1. Install Node.js 18+ from https://nodejs.org.
2. Get a free API token: https://www.robotevents.com/api/v2 (sign in, Request API Access).
3. In a terminal:
   ```bash
   cd viqrc-scouting/sync
   npm install
   export RE_TOKEN="your-token"        # Windows: set RE_TOKEN=your-token
   npm run sync                        # writes nv_viqrc_ms.json
   ```
4. Open the site, click **Import data**, choose `nv_viqrc_ms.json`.
5. After real data is in, click **Remove demo data** on the same page.

Re-run steps 3–4 after each competition to refresh scores.

Options: `node re_sync.js --region Nevada --grade "Middle School" --out nv_viqrc_ms.json`
(e.g. `--grade "Elementary School"` for elementary teams).

Python alternative: `pip install requests`, then `python3 re_sync.py` with the same `RE_TOKEN`.

## Editing the site

Change `index.html`, then ask Claude to republish it to the same artifact so the link and database stay the same. Publishing it as a new artifact would start with an empty database.


## Hosting on GitHub Pages (Supabase backend)

`index.html` runs in two modes: inside a claude.ai artifact (built-in database), or on GitHub Pages using a free Supabase project for data, photos and mentor login.

1. Create a free project at https://supabase.com.
2. SQL Editor: paste `supabase/setup.sql`, replace `YOUR_EMAIL` with the mentor email, and run it.
3. Authentication > Users > Add user: create the mentor account with that email and a password (tick "Auto confirm"). Add more editors by inserting their emails into the `editors` table.
4. Project Settings > API: copy the Project URL and the `anon` public key into `config.js`. Never put the `service_role` key anywhere in this repo.
5. Push to GitHub, then Settings > Pages > Deploy from branch `main`, folder `/ (root)`. The site is at `https://<user>.github.io/viqrc-scouting/`.
6. Open the site, click **Mentor sign in**, then **Import data** and choose `nv_viqrc_ms.json`.
