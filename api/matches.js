// /api/matches — lista partite oggi+7gg, senza storico squadre
const API_BASE = "https://api.thestatsapi.com/api/football";
const COMPETITIONS = [
  { id: "comp_6107", name: "FIFA World Cup", season: "sn_118868" },
  { id: "comp_3039", name: "Premier League", season: null },
  { id: "comp_8814", name: "LaLiga", season: null },
  { id: "comp_5840", name: "Serie A", season: null },
  { id: "comp_4643", name: "Bundesliga", season: null },
  { id: "comp_0256", name: "Ligue 1", season: null },
  { id: "comp_3498", name: "Champions League", season: null },
  { id: "comp_7739", name: "Europa League", season: null },
  { id: "comp_408698", name: "Conference League", season: null },
  { id: "comp_2949", name: "EURO", season: null },
];

let CACHE = { at: 0, data: null };
const CACHE_TTL = 2 * 60 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function todayUTC() { return new Date().toISOString().slice(0, 10); }
function plusDays(n) { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }

async function apiFetch(path, key, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${key}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status}`);
  return json;
}

async function buildMatches(key) {
  const today = todayUTC();
  const until = plusDays(7);
  const results = [];
  const errors = [];

  for (const comp of COMPETITIONS) {
    try {
      await sleep(300);
      const params = { competition_id: comp.id, per_page: 50, page: 1 };
      if (comp.season) params.season_id = comp.season;
      const r1 = await apiFetch("/matches", key, params);
      let all = r1.data || [];
      const total = r1.meta?.total_pages || 1;
      if (total > 1) {
        await sleep(300);
        const r2 = await apiFetch("/matches", key, { ...params, page: total });
        all = [...all, ...(r2.data || [])];
      }
      for (const m of all) {
        const d = (m.utc_date || "").slice(0, 10);
        const name = m.home_team?.name || "";
        if (d >= today && d <= until && !name.match(/^[W]\d+$/) && !name.match(/^\d/) && !name.match(/^[A-Z]\d/)) {
          results.push({
            id: m.id,
            compId: m.competition_id,
            leagueName: comp.name,
            date: d,
            time: (m.utc_date || "").slice(11, 16),
            status: m.status || "scheduled",
            homeId: m.home_team?.id,
            homeName: m.home_team?.name,
            homeScore: m.home_score ?? m.score?.home ?? null,
            awayId: m.away_team?.id,
            awayName: m.away_team?.name,
            awayScore: m.away_score ?? m.score?.away ?? null,
            htHome: m.half_time_score?.home ?? null,
            htAway: m.half_time_score?.away ?? null,
            xgAvail: m.xg_available || false,
          });
        }
      }
    } catch(e) { errors.push(comp.name + ": " + e.message); }
  }

  results.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return { date: today, matches: results.slice(0, 50), errors };
}

export default async function handler(req, res) {
  const key = process.env.STATS_API_KEY;
  if (!key) { res.status(500).json({ error: "Manca STATS_API_KEY" }); return; }
  const now = Date.now();
  if (req.query?.refresh !== "1" && CACHE.data && now - CACHE.at < CACHE_TTL) {
    res.status(200).json({ ...CACHE.data, cached: true }); return;
  }
  try {
    const data = await buildMatches(key);
    CACHE = { at: now, data };
    res.status(200).json({ ...data, cached: false });
  } catch(e) { res.status(500).json({ error: String(e.message) }); }
}
