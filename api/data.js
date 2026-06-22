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
const MAX_MATCHES = 20;
const MAX_DETAIL = 3;
let CACHE = { key: null, at: 0, data: null };
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function plusDays(n) { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
async function get(path, key, params = {}, retry = 2) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let i = 0; i < retry; i++) {
    const res = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${key}` } });
    const json = await res.json();
    if (res.status === 429) { await sleep(1500); continue; }
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0,100)}`);
    return json;
  }
  throw new Error("Rate limit");
}
function teamView(match, teamId) {
  const isHome = String(match.home_team?.id)===String(teamId);
  const hg=match.home_score??match.score?.home??null, ag=match.away_score??match.score?.away??null;
  const hhg=match.half_time_score?.home??null, hag=match.half_time_score?.away??null;
  return { d:(match.utc_date||"").slice(0,10), compId:match.competition_id||"", h:isHome?1:0, gf:isHome?hg:ag, ga:isHome?ag:hg, hgf:isHome?hhg:hag, hga:isHome?hag:hhg };
}
async function buildData(key) {
  const today = todayUTC();
  const until = plusDays(7);
  const errors = [];
  let todays = [];
  // Fase 1: scarica le partite di oggi+7gg (solo comp_6107 per ora che è attivo)
  for (const comp of COMPETITIONS) {
    try {
      await sleep(400);
      const params = { competition_id: comp.id, per_page: 50, page: 1 };
      if (comp.season) params.season_id = comp.season;
      const r1 = await get("/matches", key, params);
      let all = r1.data||[];
      // Se ha più pagine prendi anche l'ultima
      const total = r1.meta?.total_pages||1;
      if (total > 1) {
        await sleep(400);
        const r2 = await get("/matches", key, { ...params, page: total });
        all = [...all, ...(r2.data||[])];
      }
      for (const m of all) {
        const d = (m.utc_date||"").slice(0,10);
        const name = m.home_team?.name||"";
        if (d >= today && d <= until && !name.match(/^W\d/) && !name.match(/^\d/) && !name.match(/^[A-Z]\d/)) {
          todays.push({ ...m, _compName: comp.name });
        }
      }
    } catch(e) { errors.push(comp.name+": "+e.message); }
  }
  todays.sort((a,b)=>(a.utc_date||"").localeCompare(b.utc_date||""));
  todays = todays.slice(0, MAX_MATCHES);
  if (!todays.length) return { date: today, matches: [], errors, debug: "0 partite trovate" };
  // Fase 2: storico solo per le prime MAX_DETAIL partite (quelle di oggi)
  const teamCache = {};
  async function teamHistory(teamId) {
    if (!teamId) return [];
    const tid = String(teamId);
    if (teamCache[tid]) return teamCache[tid];
    try {
      await sleep(500);
      const r = await get("/matches", key, { team_id: tid, status: "finished", per_page: 30 });
      const list = (r.data||[]).slice(0,30).map(m=>teamView(m,teamId));
      teamCache[tid] = list; return list;
    } catch(e) { teamCache[tid]=[]; return []; }
  }
  const matches = [];
  for (let i = 0; i < todays.length; i++) {
    const m = todays[i];
    const homeId = m.home_team?.id, awayId = m.away_team?.id;
    const homeName = m.home_team?.name||"?", awayName = m.away_team?.name||"?";
    const time = (m.utc_date||"").slice(11,16)||"--:--";
    const matchDate = (m.utc_date||"").slice(0,10);
    let homeFx=[], awayFx=[], h2h=[];
    // Scarica storico solo per le prime partite (quelle di oggi)
    if (i < MAX_DETAIL) {
      homeFx = await teamHistory(homeId);
      awayFx = await teamHistory(awayId);
      try {
        await sleep(500);
        const r = await get("/matches", key, { team_id: String(homeId), opponent_id: String(awayId), status: "finished", per_page: 10 });
        h2h = (r.data||[]).slice(0,10).map(x=>({ d:(x.utc_date||"").slice(0,10), homeId:x.home_team?.id, hg:x.home_score??x.score?.home??null, ag:x.away_score??x.score?.away??null, hhg:x.half_time_score?.home??null, hag:x.half_time_score?.away??null }));
      } catch(e) {}
    }
    matches.push({ id: i, compId: m.competition_id, leagueName: m._compName, date: matchDate, time, home:{id:homeId,name:homeName,fixtures:homeFx}, away:{id:awayId,name:awayName,fixtures:awayFx}, h2h });
  }
  return { date: today, matches, errors };
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
