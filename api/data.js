const API_BASE = "https://api.thestatsapi.com/api/football";
const COMP_IDS = new Set(["comp_6107","comp_3039","comp_8814","comp_5840","comp_4643","comp_0256","comp_3498","comp_7739","comp_408698","comp_2949"]);
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
function isFinished(m) { const s=(m.status||m.match_status||"").toLowerCase().replace(/[_\-\s]/g,""); return FINISHED.has(s)||s.includes("finish")||s.includes("fulltime"); }
function teamView(match, teamId) {
  const homeId = match.home_team?.id||match.home?.id;
  const isHome = String(homeId)===String(teamId);
  const hg=match.home_score??match.score?.home??null, ag=match.away_score??match.score?.away??null;
  const hhg=match.half_time_score?.home??match.halftime?.home??null, hag=match.half_time_score?.away??match.halftime?.away??null;
  return { d:(match.date||match.kickoff||match.fixture_date||"").slice(0,10), compId:match.competition_id||match.competition?.id||"", h:isHome?1:0, gf:isHome?hg:ag, ga:isHome?ag:hg, hgf:isHome?hhg:hag, hga:isHome?hag:hhg };
}
async function buildData(key) {
  const date=todayUTC(), errors=[];
  let spent=0, todays=[];
  try {
    const r=await get("/matches",key,{date,per_page:100}); spent++;
    const all=r.data||r.matches||r.results||(Array.isArray(r)?r:[]);
    todays=all.filter(m=>{ const cid=m.competition?.id||m.competition_id||""; return COMP_IDS.has(cid); }).slice(0,MAX_MATCHES);
  } catch(e) { errors.push("matches: "+e.message); return {date,matches:[],spent,remaining:null,errors}; }
  if(!todays.length) return {date,matches:[],spent,remaining:null,debug:"API ok ma 0 partite oggi nei campionati selezionati",errors};
  const teamCache={};
  async function teamHistory(teamId) {
    if(!teamId) return [];
    const tid=String(teamId);
    if(teamCache[tid]) return teamCache[tid];
    try {
      const r=await get("/matches",key,{team_id:tid,per_page:40,sort:"desc"}); spent++;
      const list=(r.data||r.matches||r.results||(Array.isArray(r)?r:[])).filter(m=>isFinished(m)).slice(0,40).map(m=>teamView(m,teamId));
      teamCache[tid]=list; return list;
    } catch(e) { errors.push(`team ${tid}: `+e.message); teamCache[tid]=[]; return []; }
  }
  const matches=[];
  let idx=0;
  for(const m of todays) {
    const homeId=m.home_team?.id||m.home?.id, awayId=m.away_team?.id||m.away?.id;
    const homeName=m.home_team?.name||m.home?.name||"Casa", awayName=m.away_team?.name||m.away?.name||"Trasferta";
    const compName=m.competition?.name||m.league?.name||m.competition_name||"";
    const compId=m.competition?.id||m.competition_id||"";
    const time=(m.date||m.kickoff||m.fixture_date||"").slice(11,16)||"--:--";
    const [homeFx,awayFx]=await Promise.all([teamHistory(homeId),teamHistory(awayId)]);
    let h2h=[];
    try {
      const r=await get("/matches",key,{team_id:String(homeId),opponent_id:String(awayId),per_page:15,sort:"desc"}); spent++;
      h2h=(r.data||r.matches||r.results||(Array.isArray(r)?r:[])).filter(x=>isFinished(x)).slice(0,10).map(x=>{
        const hid=x.home_team?.id||x.home?.id, hg=x.home_score??x.score?.home??null, ag=x.away_score??x.score?.away??null;
        const hhg=x.half_time_score?.home??x.halftime?.home??null, hag=x.half_time_score?.away??x.halftime?.away??null;
        return {d:(x.date||x.kickoff||"").slice(0,10),homeId:hid,hg,ag,hhg,hag};
      });
    } catch(e) { errors.push(`h2h: `+e.message); }
    matches.push({id:idx++,compId,leagueName:compName,time,home:{id:homeId,name:homeName,fixtures:homeFx},away:{id:awayId,name:awayName,fixtures:awayFx},h2h});
  }
  return {date,matches,spent,remaining:null,errors};
}
export default async function handler(req, res) {
  const key=process.env.STATS_API_KEY;
  if(!key) { res.status(500).json({error:"Manca STATS_API_KEY in Vercel."}); return; }
  const force=req.query?.refresh==="1";
  const cacheKey=todayUTC(), now=Date.now();
  if(!force&&CACHE.data&&CACHE.key===cacheKey&&now-CACHE.at<CACHE_TTL_MS) { res.status(200).json({...CACHE.data,cached:true}); return; }
  try { const data=await buildData(key); CACHE={key:cacheKey,at:now,data}; res.status(200).json({...data,cached:false}); }
  catch(e) { res.status(500).json({error:String(e.message||e)}); }
}
