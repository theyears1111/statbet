// /api/h2h?home=tm_xxx&away=tm_yyy — scontri diretti
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const key = process.env.STATS_API_KEY;
  if (!key) { res.status(500).json({ error: "Manca STATS_API_KEY" }); return; }
  const homeId = req.query?.home, awayId = req.query?.away;
  if (!homeId || !awayId) { res.status(400).json({ error: "Manca ?home=&away=" }); return; }
  const cacheKey = `${homeId}-${awayId}`;
  const now = Date.now();
  if (cache[cacheKey] && now - cache[cacheKey].at < CACHE_TTL) {
    res.status(200).json({ ...cache[cacheKey].data, cached: true }); return;
  }
  try {
    const r = await apiFetch("/matches", key, {
      team_id: homeId, opponent_id: awayId, status: "finished", per_page: 15
    });
    const h2h = (r.data || []).slice(0, 10).map(x => ({
      d: (x.utc_date || "").slice(0, 10),
      homeId: x.home_team?.id,
      homeName: x.home_team?.name,
      awayName: x.away_team?.name,
      hg: x.home_score ?? x.score?.home ?? null,
      ag: x.away_score ?? x.score?.away ?? null,
      hhg: x.half_time_score?.home ?? null,
      hag: x.half_time_score?.away ?? null,
    }));
    const data = { homeId, awayId, h2h };
    cache[cacheKey] = { at: now, data };
    res.status(200).json({ ...data, cached: false });
  } catch(e) { res.status(500).json({ error: String(e.message) }); }
}