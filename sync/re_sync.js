#!/usr/bin/env node
/**
 * re_sync.js — Pull Nevada Middle School VEX IQ (VIQRC) teams, competitions,
 * match scores and skills scores from RobotEvents, using the `robotevents`
 * npm library (github.com/brenapp/robotevents), and write one JSON file to
 * upload on the scouting site's Import page.
 *
 * SETUP (one time, inside this sync folder)
 *   1. Install Node.js 18 or newer (https://nodejs.org).
 *   2. npm install
 *   3. Create a token at https://events.vex.com/api/v2
 *   4. Mac/Linux:  export RE_TOKEN="paste-your-token"
 *      Windows:    set RE_TOKEN=paste-your-token
 *
 * RUN
 *   npm run sync
 *   node re_sync.js --region Nevada --grade "Middle School" --out nv_viqrc_ms.json
 */
import { writeFile } from "node:fs/promises";
import { Client, programs } from "robotevents";

/* ---------- options ---------- */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const REGION = arg("region", "Nevada");
const GRADE = arg("grade", "Middle School");
const COUNTRY = arg("country", "US");
const OUT = arg("out", "nv_viqrc_ms.json");

const ROUND_NAMES = { 1: "Practice", 2: "Qualification", 3: "QF", 4: "SF", 5: "Final", 6: "R16", 15: "Top N", 16: "Round Robin" };

const token = process.env.RE_TOKEN;
if (!token) {
  console.error("Set RE_TOKEN to your RobotEvents API token first (see top of file).");
  process.exit(1);
}

const BASE_URL = process.env.RE_BASE_URL || "https://events.vex.com/api/v2";
const client = Client({ authorization: { token }, request: { baseUrl: BASE_URL } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every paginated GET goes through here: the library walks the pages,
 * we add retries for rate limits (HTTP 429) and network hiccups.
 */
async function getAll(path, params) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await client.api.PaginatedGET(path, { params });
      if (!res.error) {
        await sleep(500); // stay polite to the API
        return res.data ?? [];
      }
      const status = res.response?.status;
      if (status === 429 || status >= 500) {
        console.warn(`  ${path}: HTTP ${status}, retrying in ${5 * attempt}s`);
        await sleep(5000 * attempt);
        continue;
      }
      throw new Error(`${path} failed: HTTP ${status} ${JSON.stringify(res.error)}`);
    } catch (err) {
      if (attempt === 5) throw err;
      console.warn(`  ${path}: ${err.message}, retrying`);
      await sleep(3000 * attempt);
    }
  }
  throw new Error(`${path}: gave up after 8 attempts`);
}

const eventKey = (ev) => (ev && (ev.code || String(ev.id ?? ""))) || "";

function teamScoreInMatch(match, number) {
  // VEX IQ teamwork matches list the two partner teams as separate alliances (red/blue)
  // that share one score, so partners are every other team in the match.
  const names = (a) => (a.teams ?? []).map((t) => t.team?.name).filter(Boolean);
  const mine = (match.alliances ?? []).find((a) => names(a).includes(number));
  if (!mine) return null;
  const partners = [...new Set((match.alliances ?? []).flatMap(names).filter((n) => n !== number))];
  return { score: mine.score, partners };
}

async function main() {
  /* 1. Current VIQRC season (the library's season table stops at 2025-26, so ask the API) */
  const seasons = await getAll("/seasons", { query: { "program[]": [programs.VIQRC], active: true } });
  if (!seasons.length) throw new Error("No active VIQRC season found.");
  seasons.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
  const season = seasons[0];
  console.log(`Season: ${season.name} (id ${season.id})`);

  /* 2. Registered teams in the region and grade */
  const allTeams = await getAll("/teams", {
    query: { "program[]": [programs.VIQRC], "grade[]": [GRADE], "country[]": [COUNTRY], registered: true },
  });
  const teams = allTeams.filter((t) => t.location?.region === REGION);
  console.log(`${teams.length} ${GRADE} teams in ${REGION}`);

  /* 3. Each team's events, matches and skills this season */
  const events = new Map();
  const outTeams = [];
  for (const [i, t] of teams.entries()) {
    console.log(`  [${i + 1}/${teams.length}] ${t.number}`);
    const q = { path: { id: t.id }, query: { "season[]": [season.id] } };
    const tEvents = await getAll("/teams/{id}/events", q);
    const tMatches = await getAll("/teams/{id}/matches", q);
    const tSkills = await getAll("/teams/{id}/skills", q);

    for (const e of tEvents) if (!events.has(e.sku)) events.set(e.sku, e);

    const matches = [];
    for (const m of tMatches) {
      const res = teamScoreInMatch(m, t.number);
      if (!res) continue;
      matches.push({
        event: eventKey(m.event),
        eventName: m.event?.name ?? "",
        round: ROUND_NAMES[m.round] ?? String(m.round),
        name: m.name ?? "",
        score: res.score,
        // events.vex.com reports scored:false for every match, so also treat a match with a start time as played
        scored: Boolean(m.scored || m.started),
        partners: res.partners,
        date: (m.started || m.scheduled || "").slice(0, 10),
      });
    }

    const skills = tSkills.map((s) => ({
      event: eventKey(s.event),
      eventName: s.event?.name ?? "",
      type: s.type, // "driver" or "programming"
      score: s.score,
      attempts: s.attempts,
    }));

    outTeams.push({
      number: t.number,
      name: t.team_name ?? "",
      robotName: t.robot_name ?? "",
      org: t.organization ?? "",
      city: t.location?.city ?? "",
      region: t.location?.region ?? "",
      grade: t.grade ?? "",
      reId: t.id,
      events: tEvents.map((e) => e.sku),
      matches,
      skills,
    });
  }

  /* 4. Registered middle school teams for every event those teams attend */
  const outEvents = [];
  let j = 0;
  for (const [sku, e] of events) {
    console.log(`  event [${++j}/${events.size}] ${sku}`);
    const reg = await getAll("/events/{id}/teams", { path: { id: e.id }, query: { "grade[]": [GRADE] } });
    const loc = e.location ?? {};
    outEvents.push({
      sku,
      name: e.name ?? "",
      start: (e.start ?? "").slice(0, 10),
      end: (e.end ?? e.start ?? "").slice(0, 10),
      venue: loc.venue ?? "",
      city: loc.city ?? "",
      region: loc.region ?? "",
      reId: e.id,
      teams: reg.map((r) => ({ number: r.number, name: r.team_name ?? "", org: r.organization ?? "" })),
    });
  }

  /* 5. Write the file the site imports */
  const payload = {
    format: "viqrc-scout-v1",
    generated: new Date().toISOString().slice(0, 19) + "Z",
    season: season.name,
    region: REGION,
    grade: GRADE,
    teams: outTeams,
    events: outEvents,
  };
  await writeFile(OUT, JSON.stringify(payload, null, 1), "utf8");
  console.log(`\nWrote ${OUT}: ${outTeams.length} teams, ${outEvents.length} events.`);
}

main().catch((err) => {
  console.error(`\nSync failed: ${err.message}`);
  process.exit(1);
});
