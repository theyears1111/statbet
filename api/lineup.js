// /api/lineup?matchId=mt_xxx&teamId=tm_xxx&seasonId=sn_xxx
// Restituisce attaccanti e centrocampisti offensivi con stats gol stagionali
const API_BASE = "https://api.thestatsapi.com/api/football";
const cache = {};
const CACHE_TTL = 6 * 60 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiFetch(path, key, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${key}` } });
    const json = await res.json();
    if (res.status === 429) { await sleep(1500); continue; }
    if (!res.ok) return null;
    return json;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const key = process.env.STATS_API_KEY;
  if (!key) { res.status(500).json({ error: "Manca STATS_API_KEY" }); return; }

  const { matchId, teamId, seasonId } = req.query;
  if (!matchId || !teamId) { res.status(400).json({ error: "Manca matchId o teamId" }); return; }

  const cacheKey = matchId + teamId;
  const now = Date.now();
  if (cache[cacheKey] && now - cache[cacheKey].at < CACHE_TTL) {
    res.status(200).json({ ...cache[cacheKey].data, cached: true }); return;
  }

  try {
    // 1. Prendi la formazione dell'ultima partita
    const lr = await apiFetch(`/matches/${matchId}/lineups`, key);
    if (!lr?.data) { res.status(200).json({ players: [] }); return; }

    const teamData = String(lr.data.home?.id) === String(teamId) ? lr.data.home : lr.data.away;
    if (!teamData) { res.status(200).json({ players: [] }); return; }

    const compId = seasonId; // usa come riferimento la stagione passata

    // 2. Filtra attaccanti e centrocampisti offensivi
    const offPositions = ['F', 'M'];
    const players = [...(teamData.starting_xi || []), ...(teamData.substitutes || [])]
      .filter(p => offPositions.includes(p.position));

    // 3. Per ogni giocatore, prendi le stats gol (max 8 giocatori per limitare le chiamate)
    const results = [];
    for (const p of players.slice(0, 8)) {
      try {
        await sleep(300);
        // Prima prova con la stagione corrente del torneo
        let sr = null;
        if (seasonId) {
          sr = await apiFetch(`/players/${p.id}/stats`, key, { season_id: seasonId });
        }
        // Se non trova, prova senza season_id (non funziona ma proviamo)
        if (!sr?.data) continue;
        const d = sr.data;
        results.push({
          id: p.id,
          name: p.name,
          pos: p.position,
          apps: d.appearances || 0,
          goals: d.scoring?.goals || 0,
          shots: d.shooting?.total_shots || 0,
          shotsOT: d.shooting?.shots_on_target || 0,
          // Calcola "digiuno" basandoci sulle partite giocate senza gol
          // Se ha 0 gol in 2+ partite = a digiuno
          drought: (d.appearances || 0) > 0 && (d.scoring?.goals || 0) === 0 ? (d.appearances || 0) : 0,
        });
      } catch(e) {}
    }

    // Ordina per shots (più pericoloso prima)
    results.sort((a, b) => b.shots - a.shots);

    const data = { players: results };
    cache[cacheKey] = { at: now, data };
    res.status(200).json({ ...data, cached: false });
  } catch(e) {
    res.status(200).json({ players: [] });
  }
}
