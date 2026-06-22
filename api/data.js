const API_BASE = "https://api.thestatsapi.com/api/football";
const COMPETITIONS = [
  { id: "comp_6107", name: "FIFA World Cup" },
  { id: "comp_3039", name: "Premier League" },
  { id: "comp_8814", name: "LaLiga" },
  { id: "comp_5840", name: "Serie A" },
  { id: "comp_4643", name: "Bundesliga" },
  { id: "comp_0256", name: "Ligue 1" },
  { id: "comp_3498", name: "Champions League" },
  { id: "comp_7739", name: "Europa League" },
  { id: "comp_408698", name: "Conference League" },
  { id: "comp_2949", name: "EURO" },
];
const MAX_MATCHES = 20;
let CACHE = { key: null, at: 0, data: null };
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
function todayUTC() { return new Date().toISOString().slice(0, 10); }
async function get(path, key, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" } });
  const json = await res.json();
  if (!res.ok) throw new Error(`TheStatsAPI ${res.status}: ${JSON.stringify(json).slice(0,300)}`);
  return json;
}
const FINISHED = new Set(["finished","ft","aet","pen","complete","full-time","fulltime"]);
function isFinished(m) { const s=(m.status||"").toLowerCase().replace(/[_\-\s]/g,""); return FINISHED.has(s)||s.includes("finish")||s.includes("fulltime"); }
function teamView(match, teamId) {
  const homeId = match.home_team?.id||match.home?.id;
  const isHome = String(homeId)===String(teamId);
  const hg=match.home_score??match.score?.home??null, ag=match.away_score??match.score?.away??null;
  const hhg=match.half_time_score?.home??match.halftime?.home??null, hag=match.half_time_score?.away??match.halftime?.away??null;
  return { d:(match.utc_date||match.date||"").slice(0,10), compId:match.competition_id||"", h:isHome?1:0, gf:isHome?hg:ag, ga:isHome?ag:hg, hgf:isHome?hhg:hag, hga:isHome?hag:hhg };
}
async function getMatchesToday(key, compId, date) {
  const results = [];
  try {
    const r1 = await get("/matches", key, { competition_id: compId, per_page: 50, page: 1 });
    const total_pages = r1.meta?.total_pages || 1;
    const all = r1.data || [];
    if (total_pages > 1) {
      const r2 = await get("/matches", key, { competition_id: compId, per_page: 50, page: total_pages });
      all.push(...(r2.data || []));
    }
    for (const m of all) {
      const mdate = (m.utc_date || m.date || "").slice(0, 10);
      if (mdate === date) results.push(m);
    }
  } catch(e) {}
  return results;
}
async function buildData(key) {
  const date = todayUTC();
  const errors = [];
  let spent = 0;
  let todays = [];
  for (const comp of COMPETITIONS) {
    try {
      const matches = await getMatchesToday(key, comp.id, date);
      spent += 2;
      for (const m of matches) {
        todays.push({ ...m, _compName: comp.name });
      }
    } catch(e) { errors.push(comp.name + ": " + e.message); }
  }
  todays = todays.slice(0, MAX_MATCHES);
  if (!todays.length) return { date, matches: [], spent, remaining: null, debug: "Nessuna partita oggi", errors };
  const teamCache = {};
  async function teamHistory(teamId) {
    if (!teamId) return [];
    const tid = String(teamId);
    if (teamCache[tid]) return teamCache[tid];
    try {
      const r = await get("/matches", key, { team_id: tid, per_page: 40, sort: "desc" }); spent++;
      const list = (r.data||[]).filter(m=>isFinished(m)).slice(0,40).map(m=>teamView(m,teamId));
      teamCache[tid] = list; return list;
    } catch(e) { errors.push(`team ${tid}: `+e.message); teamCache[tid]=[]; return []; }
  }
  const matches = [];
  let idx = 0;
  for (const m of todays) {
    const homeId = m.home_team?.id, awayId = m.away_team?.id;
    const homeName = m.home_team?.name||"Casa", awayName = m.away_team?.name||"Trasferta";
    const time = (m.utc_date||"").slice(11,16)||"--:--";
    const [homeFx, awayFx] = await Promise.all([teamHistory(homeId), teamHistory(awayId)]);
    let h2h = [];
    try {
      const r = await get("/matches", key, { team_id: String(homeId), opponent_id: String(awayId), per_page: 15, sort: "desc" }); spent++;
      h2h = (r.data||[]).filter(x=>isFinished(x)).slice(0,10).map(x=>{
        const hid=x.home_team?.id, hg=x.home_score??x.score?.home??null, ag=x.away_score??x.score?.away??null;
        const hhg=x.half_time_score?.home??null, hag=x.half_time_score?.away??null;
        return { d:(x.utc_date||"").slice(0,10), homeId:hid, hg, ag, hhg, hag };
      });
    } catch(e) { errors.push(`h2h: `+e.message); }
    matches.push({ id: idx++, compId: m.competition_id, leagueName: m._compName, time, home:{id:homeId,name:homeName,fixtures:homeFx}, away:{id:awayId,name:awayName,fixtures:awayFx}, h2h });
  }
  return { date, matches, spent, remaining: null, errors };
}
export default async function handler(req, res) {
  const key = process.env.STATS_API_KEY;
  if (!key) { res.status(500).json({ error: "Manca STATS_API_KEY in Vercel." }); return; }
  const force = req.query?.refresh === "1";
  const cacheKey = todayUTC(), now = Date.now();
  if (!force && CACHE.data && CACHE.key === cacheKey && now - CACHE.at < CACHE_TTL_MS) { res.status(200).json({ ...CACHE.data, cached: true }); return; }
  try { const data = await buildData(key); CACHE = { key: cacheKey, at: now, data }; res.status(200).json({ ...data, cached: false }); }
  catch(e) { res.status(500).json({ error: String(e.message||e) }); }
}
