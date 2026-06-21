// StatBet — funzione serverless Vercel
// Scarica i dati grezzi da API-Football e li restituisce in forma compatta.
// Tutta l'analisi (streak, medie, primi tempi, ritardatari) viene fatta nel browser.
//
// La chiave API NON sta nel codice: viene letta da una variabile d'ambiente
// che imposterai su Vercel (API_FOOTBALL_KEY). Così resta segreta.

const API_BASE = "https://v3.football.api-sports.io";

const LEAGUES = [
  { id: 1,   name: "Mondiali",          season: 2026 },
  { id: 39,  name: "Premier League",    season: 2025 },
  { id: 140, name: "La Liga",           season: 2025 },
  { id: 135, name: "Serie A",           season: 2025 },
  { id: 78,  name: "Bundesliga",        season: 2025 },
  { id: 61,  name: "Ligue 1",           season: 2025 },
  { id: 2,   name: "Champions League",  season: 2025 },
];

const MAX_MATCHES = 12;

let CACHE = { key: null, at: 0, data: null };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function todayUTC() {
  // UTC puro — le partite mondiali sono in USA, l'API le indicizza in UTC
  return new Date().toISOString().slice(0, 10);
}

async function af(path, key) {
  const res = await fetch(API_BASE + path, { headers: { "x-apisports-key": key } });
  const json = await res.json();
  const remaining = res.headers.get("x-ratelimit-requests-remaining");
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error("API-Football: " + JSON.stringify(json.errors));
  }
  return { response: json.response || [], remaining };
}

function compactFixture(fx, teamId) {
  const isHome = fx.teams.home.id === teamId;
  const gf = isHome ? fx.goals.home : fx.goals.away;
  const ga = isHome ? fx.goals.away : fx.goals.home;
  const ht = fx.score && fx.score.halftime ? fx.score.halftime : { home: null, away: null };
  const hgf = isHome ? ht.home : ht.away;
  const hga = isHome ? ht.away : ht.home;
  return {
    d: fx.fixture.date.slice(0, 10),
    l: fx.league.id,
    ln: fx.league.name,
    h: isHome ? 1 : 0,
    gf, ga,
    hgf: hgf == null ? null : hgf,
    hga: hga == null ? null : hga,
  };
}

const FT = new Set(["FT", "AET", "PEN"]);

async function buildData(key) {
  let spent = 0;
  let remaining = null;
  const date = todayUTC();

  let todays = [];
  for (const lg of LEAGUES) {
    try {
      const r = await af(`/fixtures?date=${date}&league=${lg.id}&season=${lg.season}`, key);
      spent++;
      remaining = r.remaining ?? remaining;
      for (const fx of r.response) {
        todays.push({ fx, leagueName: lg.name, season: lg.season });
      }
    } catch (e) {}
  }

  todays = todays.slice(0, MAX_MATCHES);

  const teamCache = {};
  async function lastFixtures(teamId) {
    if (teamCache[teamId]) return teamCache[teamId];
    const r = await af(`/fixtures?team=${teamId}&last=40`, key);
    spent++;
    remaining = r.remaining ?? remaining;
    const list = r.response
      .filter((fx) => FT.has(fx.fixture.status.short))
      .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
      .map((fx) => compactFixture(fx, teamId));
    teamCache[teamId] = list;
    return list;
  }

  const matches = [];
  for (const t of todays) {
    const fx = t.fx;
    const homeId = fx.teams.home.id, awayId = fx.teams.away.id;
    const homeFx = await lastFixtures(homeId);
    const awayFx = await lastFixtures(awayId);

    let h2h = [];
    try {
      const r = await af(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=15`, key);
      spent++;
      remaining = r.remaining ?? remaining;
      h2h = r.response
        .filter((x) => FT.has(x.fixture.status.short))
        .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
        .map((x) => ({
          d: x.fixture.date.slice(0, 10),
          homeId: x.teams.home.id,
          hg: x.goals.home, ag: x.goals.away,
          hhg: x.score?.halftime?.home ?? null,
          hag: x.score?.halftime?.away ?? null,
        }));
    } catch (e) {}

    matches.push({
      id: fx.fixture.id,
      leagueId: fx.league.id,
      leagueName: t.leagueName,
      time: fx.fixture.date.slice(11, 16),
      home: { id: homeId, name: fx.teams.home.name, fixtures: homeFx },
      away: { id: awayId, name: fx.teams.away.name, fixtures: awayFx },
      h2h,
    });
  }

  return { date, matches, spent, remaining };
}

export default async function handler(req, res) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    res.status(500).json({ error: "Manca la variabile API_FOOTBALL_KEY su Vercel." });
    return;
  }
  const force = req.query && req.query.refresh === "1";
  const cacheKey = todayUTC();
  const now = Date.now();
  if (!force && CACHE.data && CACHE.key === cacheKey && now - CACHE.at < CACHE_TTL_MS) {
    res.status(200).json({ ...CACHE.data, cached: true });
    return;
  }
  try {
    const data = await buildData(key);
    CACHE = { key: cacheKey, at: now, data };
    res.status(200).json({ ...data, cached: false });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}