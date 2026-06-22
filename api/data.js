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
let CACHE = { key: null, at: 0, data: null };
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function plusDays(n) { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
async function get(path, key, params = {}, retry = 3) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let i = 0; i < retry; i++) {
    const res = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" } });
    const json = await res.json();
    if (res.status === 429) { await sleep(2000 + i * 1000); continue; }
    if (!res.ok) throw new Error(`TheStatsAPI ${res.status}: ${JSON.stringify(json).slice(0,200)}`);
    return json;
  }
  throw new Error("Rate limit persistente dopo 3 tentativi");
}
function teamView(match, teamId) {
  const homeId = match.home_team?.id;
  const isHome = String(homeId)===String(teamId);
  const hg=match.home_score??match.score?.home??null, ag=match.away_score??match.score?.away??null;
  const hhg=match.half_time_score?.home??null, hag=match.half_time_score?.away??null;
  return { d:(match.utc_date||"").slice(0,10), compId:match.competition_id||"", h:isHome?1:0, gf:isHome?hg:ag, ga:isHome?ag:hg, hgf:isHome?hhg:hag, hga:isHome?hag:hhg };
}
async function getAllPages(key, params) {
  const all = [];
  const r1 = await get("/matches", key, { ...params, per_page: 50, page: 1 });
  all.push(...(r1.data||[]));
  const total = r1.meta?.total_pages||1;
  for (let p = 2; p <= Math.min(total, 4); p++) {
    await sleep(600);
    const r = await get("/matches", key, { ...params, per_page: 50, page: p });
    all.push(...(r.data||[]));
  }
  return all;
}
async function buildData(key) {
  const today = todayUTC();
  const until = plusDays(7);
  const errors = [];
  let spent = 0;
  let todays = [];
  for (const comp of COMPETITIONS) {
    try {
      await sleep(600);
      const params = { competition_id: comp.id };
      if (comp.season) params.season_id = comp.season;
      const all = await getAllPages(key, params);
      spent += 2;
      for (const m of all) {
        const d = (m.utc_date||"").slice(0,10);
        const name = m.home_team?.name||"";
        if (d >= today && d <= until && !name.match(/^W\d/) && !name.match(/^\d/)) {
          todays.push({ ...m, _compName: comp.name });
        }
      }
    } catch(e) { errors.push(comp.name+": "+e.message); }
  }
  todays.sort((a,b)=>(a.utc_date||"").localeCompare(b.utc_date||""));
  todays = todays.slice(0, MAX_MATCHES);
  if (!todays.length) return { date: today, matches: [], spent, remaining: null, debug: "Nessuna partita nei prossimi 7 giorni", errors };
  const teamCache = {};
  async function teamHistory(teamId) {
    if (!teamId) return [];
    const tid = String(teamId);
    if (teamCache[tid]) return teamCache[tid];
    try {
      await sleep(600);
      const r = await get("/matches", key, { team_id: tid, status: "finished", per_page: 40 });
      spent++;
      const list = (r.data||[]).slice(0,40).map(m=>teamView(m,teamId));
      teamCache[tid] = list; return list;
    } catch(e) {
      errors.push(`team ${tid}: `+e.message);
      teamCache[tid]=[]; return [];
    }
  }
  const matches = [];
  let idx = 0;
  for (const m of todays) {
    const homeId = m.home_team?.id, awayId = m.away_team?.id;
    const homeName = m.home_team?.name||"Casa", awayName = m.away_team?.name||"Trasferta";
    const time = (m.utc_date||"").slice(11,16)||"--:--";
    const matchDate = (m.utc_date||"").slice(0,10);
    // Sequenziale, non parallelo, per rispettare rate limit
    const homeFx = await teamHistory(homeId);
    const awayFx = await teamHistory(awayId);
    let h2h = [];
    try {
      await sleep(600);
      const r = await get("/matches", key, { team_id: String(homeId), opponent_id: String(awayId), status: "finished", per_page: 15 });
      spent++;
      h2h = (r.data||[]).slice(0,10).map(x=>{
        const hid=x.home_team?.id, hg=x.home_score??x.score?.home??null, ag=x.away_score??x.score?.away??null;
        const hhg=x.half_time_score?.home??null, hag=x.half_time_score?.away??null;
        return { d:(x.utc_date||"").slice(0,10), homeId:hid, hg, ag, hhg, hag };
      });
    } catch(e) {}
    matches.push({ id: idx++, compId: m.competition_id, leagueName: m._compName, date: matchDate, time, home:{id:homeId,name:homeName,fixtures:homeFx}, away:{id:awayId,name:awayName,fixtures:awayFx}, h2h });
  }
  return { date: today, matches, spent, remaining: null, errors };
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
