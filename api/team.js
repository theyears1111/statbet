const API_BASE = "https://api.thestatsapi.com/api/football";
const cache = {};
const CACHE_TTL = 4 * 60 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiFetch(path, key, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${key}` } });
    const json = await res.json();
    if (res.status === 429) { await sleep(2000 + i * 1000); continue; }
    if (res.status === 500) { await sleep(1500 + i * 500); continue; }
    if (!res.ok) throw new Error(`${res.status}`);
    return json;
  }
  throw new Error("Rate limit persistente");
}

function teamView(match, teamId) {
  const isHome = String(match.home_team?.id) === String(teamId);
  const hg = match.home_score ?? match.score?.home ?? null;
  const ag = match.away_score ?? match.score?.away ?? null;
  const ht = match.half_time_score || match.halftime || null;
  const hhg = ht ? (isHome ? ht.home : ht.away) : null;
  const hag = ht ? (isHome ? ht.away : ht.home) : null;
  return {
    matchId: match.id,
    d: (match.utc_date || "").slice(0, 10),
    compId: match.competition_id || "",
    h: isHome ? 1 : 0,
    gf: isHome ? hg : ag,
    ga: isHome ? ag : hg,
    hgf: hhg, hga: hag,
    oppId: isHome ? match.away_team?.id : match.home_team?.id,
    oppName: isHome ? match.away_team?.name : match.home_team?.name,
    xgAvail: match.xg_available || false,
    // stats dettagliate
    xg: null, xg1h: null, xg2h: null, npxg: null,
    shots: null, shots1h: null, shots2h: null,
    shotsOT: null, shotsOT1h: null, shotsOT2h: null,
    corners: null, corners1h: null, corners2h: null,
    poss: null, poss1h: null,
    bigChances: null, bigChances1h: null, bigChances2h: null,
    bigChancesMissed: null, bigChancesMissed2h: null,
    saves: null, saves1h: null, saves2h: null,
    fouls: null, fouls1h: null,
    offsides: null, crosses: null, goalsPrevented: null,
  };
}

function extractStats(statsData, isHome) {
  const side = isHome ? "home" : "away";
  const opp = isHome ? "away" : "home";
  const ov = statsData?.overview || {};
  const sh = statsData?.shots || {};
  const at = statsData?.attack || {};
  const gk = statsData?.goalkeeping || {};
  const ps = statsData?.passes || {};
  return {
    xg:           ov.expected_goals?.all?.[side] ?? null,
    xg1h:         ov.expected_goals?.first_half?.[side] ?? null,
    xg2h:         ov.expected_goals?.second_half?.[side] ?? null,
    npxg:         statsData?.np_expected_goals?.all?.[side] ?? null,
    shots:        ov.total_shots?.all?.[side] ?? sh.total_shots?.all?.[side] ?? null,
    shots1h:      ov.total_shots?.first_half?.[side] ?? sh.total_shots?.first_half?.[side] ?? null,
    shots2h:      ov.total_shots?.second_half?.[side] ?? sh.total_shots?.second_half?.[side] ?? null,
    shotsOT:      ov.shots_on_target?.all?.[side] ?? sh.shots_on_target?.all?.[side] ?? null,
    shotsOT1h:    ov.shots_on_target?.first_half?.[side] ?? sh.shots_on_target?.first_half?.[side] ?? null,
    shotsOT2h:    ov.shots_on_target?.second_half?.[side] ?? sh.shots_on_target?.second_half?.[side] ?? null,
    corners:      ov.corner_kicks?.all?.[side] ?? null,
    corners1h:    ov.corner_kicks?.first_half?.[side] ?? null,
    corners2h:    ov.corner_kicks?.second_half?.[side] ?? null,
    poss:         ov.ball_possession?.all?.[side] ?? null,
    poss1h:       ov.ball_possession?.first_half?.[side] ?? null,
    bigChances:   ov.big_chances?.all?.[side] ?? null,
    bigChances1h: ov.big_chances?.first_half?.[side] ?? null,
    bigChances2h: ov.big_chances?.second_half?.[side] ?? null,
    bigChancesMissed:   at.big_chances_missed?.all?.[side] ?? null,
    bigChancesMissed2h: at.big_chances_missed?.second_half?.[side] ?? null,
    saves:        gk.saves?.all?.[opp] ?? ov.goalkeeper_saves?.all?.[opp] ?? null,
    saves1h:      gk.saves?.first_half?.[opp] ?? ov.goalkeeper_saves?.first_half?.[opp] ?? null,
    saves2h:      gk.saves?.second_half?.[opp] ?? ov.goalkeeper_saves?.second_half?.[opp] ?? null,
    goalsPrevented: gk.goals_prevented?.all?.[opp] ?? null,
    fouls:        ov.fouls?.all?.[side] ?? null,
    fouls1h:      ov.fouls?.first_half?.[side] ?? null,
    offsides:     at.offsides?.all?.[side] ?? null,
    crosses:      ps.accurate_crosses?.all?.[side] ?? null,
  };
}

export default async function handler(req, res) {
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
    const r = await apiFetch("/matches", key, { team_id: teamId, status: "finished", per_page: 20 });
    const matches = r.data || [];
    const fixtures = matches.map(m => teamView(m, teamId));
    const withXG = fixtures.filter(f => f.xgAvail).slice(0, 8);
    for (const f of withXG) {
      try {
        await sleep(500);
        const sr = await apiFetch(`/matches/${f.matchId}/stats`, key);
        const s = extractStats(sr.data, f.h === 1);
        Object.assign(f, s);
      } catch(e) {}
    }
    const data = { teamId, fixtures };
    cache[teamId] = { at: now, data };
    res.status(200).json({ ...data, cached: false });
  } catch(e) {
    res.status(500).json({ error: String(e.message) });
  }
}