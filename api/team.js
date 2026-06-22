// /api/team?id=tm_xxx — storico partite di una singola squadra
const API_BASE = "https://api.thestatsapi.com/api/football";

const cache = {};
const CACHE_TTL = 4 * 60 * 60 * 1000;

async function apiFetch(path, key, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${key}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status}`);
  return json;
}

function teamView(match, teamId) {
  const isHome = String(match.home_team?.id) === String(teamId);
  const hg = match.home_score ?? match.score?.home ?? null;
  const ag = match.away_score ?? match.score?.away ?? null;
  const hhg = match.half_time_score?.home ?? null;
  const hag = match.half_time_score?.away ?? null;
  return {
    d: (match.utc_date || "").slice(0, 10),
    compId: match.competition_id || "",
    compName: match.competition?.name || "",
    h: isHome ? 1 : 0,
    gf: isHome ? hg : ag,
    ga: isHome ? ag : hg,
    hgf: isHome ? hhg : hag,
    hga: isHome ? hag : hhg,
    oppId: isHome ? match.away_team?.id : match.home_team?.id,
    oppName: isHome ? match.away_team?.name : match.home_team?.name,
  };
}

export default async function handler(req, res) {
  // CORS per chiamate dal browser
  res.setHeader("Access-Control-Allow-Origin", "*");
  
  const key = process.env.STATS_API_KEY;
  if (!key) { res.status(500).json({ error: "Manca STATS_API_KEY" }); return; }
  
  const teamId = req.query?.id;
  if (!teamId) { res.status(400).json({ error: "Manca ?id=tm_xxx" }); return; }
  
  const now = Date.now();
  if (cache[teamId] && now - cache[teamId].at < CACHE_TTL) {
    res.status(200).json({ ...cache[teamId].data, cached: true }); return;
  }

  try {
    // Storico partite finite
    const r = await apiFetch("/matches", key, {
      team_id: teamId, status: "finished", per_page: 40
    });
    const fixtures = (r.data || []).slice(0, 40).map(m => teamView(m, teamId));
    const data = { teamId, fixtures };
    cache[teamId] = { at: now, data };
    res.status(200).json({ ...data, cached: false });
  } catch(e) { res.status(500).json({ error: String(e.message) }); }
}
