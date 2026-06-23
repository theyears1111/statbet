// /api/analyze — carica tutto e calcola i segnali per tutte le partite della settimana
// Tempo atteso: 2-3 minuti, poi risultato in cache per 4 ore
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
const CACHE_TTL = 4 * 60 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function todayUTC() { return new Date().toISOString().slice(0, 10); }
function plusDays(n) { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }

async function apiFetch(path, key, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url.toString(), { headers: { "Authorization": `Bearer ${key}` } });
    const json = await res.json();
    if (res.status === 429) { await sleep(2000); continue; }
    if (!res.ok) throw new Error(`${res.status}`);
    return json;
  }
  throw new Error("Rate limit");
}

function teamView(match, teamId) {
  const isHome = String(match.home_team?.id) === String(teamId);
  const hg = match.home_score ?? match.score?.home ?? null;
  const ag = match.away_score ?? match.score?.away ?? null;
  const ht = match.half_time_score || null;
  const hhg = ht ? (isHome ? ht.home : ht.away) : null;
  const hag = ht ? (isHome ? ht.away : ht.home) : null;
  return {
    matchId: match.id, d: (match.utc_date||"").slice(0,10),
    compId: match.competition_id||"", h: isHome?1:0,
    gf: isHome?hg:ag, ga: isHome?ag:hg,
    hgf: hhg, hga: hag,
    xgAvail: match.xg_available||false,
    xg:null,xg1h:null,npxg:null,shots:null,shots1h:null,
    shotsOT:null,corners:null,corners1h:null,
    bigChances:null,bigChancesMissed:null,saves:null,
  };
}

function extractStats(sd, isHome) {
  const s = isHome?"home":"away", o = isHome?"away":"home";
  const ov = sd?.overview||{}, at = sd?.attack||{}, gk = sd?.goalkeeping||{};
  return {
    xg: ov.expected_goals?.all?.[s]??null,
    xg1h: ov.expected_goals?.first_half?.[s]??null,
    npxg: sd?.np_expected_goals?.all?.[s]??null,
    shots: ov.total_shots?.all?.[s]??null,
    shots1h: ov.total_shots?.first_half?.[s]??null,
    shotsOT: ov.shots_on_target?.all?.[s]??null,
    corners: ov.corner_kicks?.all?.[s]??null,
    corners1h: ov.corner_kicks?.first_half?.[s]??null,
    bigChances: ov.big_chances?.all?.[s]??null,
    bigChancesMissed: at.big_chances_missed?.all?.[s]??null,
    saves: gk.saves?.all?.[o]??ov.goalkeeper_saves?.all?.[o]??null,
  };
}

function av(arr,sel){const v=arr.map(sel).filter(x=>x!=null&&!isNaN(x));return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;}
function sk(fx,c){let n=0;for(const f of fx){if(c(f))n++;else break;}return n;}

function calcSignals(fx, compId, isHome, teamName, matchInfo) {
  const signals = [];

  // Filtri: tutte, casa/trasferta, comp, casa+comp
  const filters = [
    {key:'all', label:'Tutte le comp.', fx: fx},
    {key:'home', label: isHome?'In casa':'In trasferta', fx: fx.filter(f=>f.h===(isHome?1:0))},
    {key:'comp', label:'Solo '+matchInfo.leagueName, fx: fx.filter(f=>f.compId===compId)},
    {key:'compHome', label:'Casa/tras. + comp.', fx: fx.filter(f=>f.compId===compId&&f.h===(isHome?1:0))},
  ];

  for (const filt of filters) {
    const f = filt.fx;
    if (!f.length) continue;
    const f1h = f.filter(x=>x.hgf!=null);
    const fxg = f.filter(x=>x.xg!=null);
    const fco = f.filter(x=>x.corners!=null);

    // 1. NON SEGNA (streak + xG accumulato)
    const ngStreak = sk(f, x=>(x.gf??0)===0);
    if (ngStreak >= 2) {
      const xgSum = fxg.slice(0, ngStreak).reduce((s,x)=>s+(x.xg??0),0);
      const xg1hSum = fxg.slice(0, ngStreak).reduce((s,x)=>s+(x.xg1h??0),0);
      const bcSum = f.slice(0,ngStreak).reduce((s,x)=>s+(x.bigChances??0),0);
      const bcMissed = f.slice(0,ngStreak).reduce((s,x)=>s+(x.bigChancesMissed??0),0);
      let conf = 50;
      if (xgSum >= 4) conf += 25;
      else if (xgSum >= 2.5) conf += 15;
      if (bcSum >= 5) conf += 10;
      if (bcMissed >= 3) conf += 8;
      conf = Math.min(97, conf);
      if (conf >= 60) {
        signals.push({
          type: 'goal', cat: 'Segna '+teamName, filter: filt.label,
          title: teamName+' non segna da '+ngStreak+' gare',
          detail: 'xG accumulato: '+xgSum.toFixed(2)+' · xG 1°T: '+xg1hSum.toFixed(2)+' · Big chances: '+bcSum+' · Mancate: '+bcMissed,
          bets: ['Segna '+teamName, isHome?teamName+' Over 0.5':''+teamName+' Over 0.5', 'Goal/GG'],
          conf, matchId: matchInfo.id, match: matchInfo.homeName+' vs '+matchInfo.awayName,
          leagueName: matchInfo.leagueName, date: matchInfo.date,
        });
      }
    }

    // 2. NON SEGNA 1°T
    const ng1hStreak = sk(f1h, x=>(x.hgf??0)===0);
    if (ng1hStreak >= 3) {
      const xg1hSum = fxg.slice(0,ng1hStreak).reduce((s,x)=>s+(x.xg1h??0),0);
      let conf = 45 + Math.min(30, ng1hStreak*5);
      if (xg1hSum >= 2) conf += 15;
      conf = Math.min(90, conf);
      signals.push({
        type: 'goal1h', cat: 'Segna 1°T '+teamName, filter: filt.label,
        title: teamName+' non segna nel 1°T da '+ng1hStreak+' gare',
        detail: 'xG 1°T accumulato: '+xg1hSum.toFixed(2),
        bets: ['Segna '+teamName+' 1°T', 'Over 0.5 gol 1°T '+teamName],
        conf, matchId: matchInfo.id, match: matchInfo.homeName+' vs '+matchInfo.awayName,
        leagueName: matchInfo.leagueName, date: matchInfo.date,
      });
    }

    // 3. IMBATTUTA 1°T (non perde il primo tempo)
    const nl1h = sk(f1h, x=>(x.hgf??0)>=(x.hga??0));
    if (nl1h >= 5) {
      signals.push({
        type: '1hnl', cat: '1°T imbattuta '+teamName, filter: filt.label,
        title: teamName+' imbattuta nel 1°T da '+nl1h+' gare',
        detail: 'Striscia anomala: non perde la prima frazione',
        bets: [isHome?'1X primo tempo':'X2 primo tempo', 'Pareggio o '+teamName+' 1°T'],
        conf: Math.min(92, 55+nl1h*3), matchId: matchInfo.id,
        match: matchInfo.homeName+' vs '+matchInfo.awayName,
        leagueName: matchInfo.leagueName, date: matchInfo.date,
      });
    }

    // 4. NON VINCE 1°T
    const nw1h = sk(f1h, x=>(x.hgf??0)<=(x.hga??0));
    if (nw1h >= 5) {
      signals.push({
        type: '1hnw', cat: '1°T no vittoria '+teamName, filter: filt.label,
        title: teamName+' senza vittoria nel 1°T da '+nw1h+' gare',
        detail: 'Striscia debole nella prima frazione',
        bets: ['No '+teamName+' 1°T', isHome?'X2 o pareggio 1°T':'1X primo tempo'],
        conf: Math.min(90, 50+nw1h*3), matchId: matchInfo.id,
        match: matchInfo.homeName+' vs '+matchInfo.awayName,
        leagueName: matchInfo.leagueName, date: matchInfo.date,
      });
    }

    // 5. CORNER RITORNO ALLA MEDIA
    const cornersAvg = av(fco, x=>x.corners);
    const cornersRecent = av(fco.slice(0,4), x=>x.corners);
    if (cornersAvg!=null && cornersRecent!=null) {
      const gap = cornersAvg - cornersRecent;
      if (gap >= 2) {
        let conf = Math.min(88, 55 + gap*6);
        signals.push({
          type: 'corner', cat: 'Corner '+teamName, filter: filt.label,
          title: teamName+' — ritorno corner (gap '+gap.toFixed(1)+')',
          detail: 'Media stagionale: '+cornersAvg.toFixed(1)+' · Ultime 4 gare: '+cornersRecent.toFixed(1),
          bets: ['Over corner '+teamName, 'Over corner match'],
          conf, matchId: matchInfo.id, match: matchInfo.homeName+' vs '+matchInfo.awayName,
          leagueName: matchInfo.leagueName, date: matchInfo.date,
        });
      }
    }

    // 6. NO PAREGGIO
    const ndStreak = sk(f, x=>(x.gf??0)!==(x.ga??0));
    if (ndStreak >= 6) {
      signals.push({
        type: 'nodraw', cat: 'No pareggio '+teamName, filter: filt.label,
        title: teamName+' senza pareggio da '+ndStreak+' gare',
        detail: 'Striscia anomala di risultati secchi',
        bets: ['No pareggio', '1 o 2 (doppia chance)'],
        conf: Math.min(85, 45+ndStreak*4), matchId: matchInfo.id,
        match: matchInfo.homeName+' vs '+matchInfo.awayName,
        leagueName: matchInfo.leagueName, date: matchInfo.date,
      });
    }

    // 7. NON SUBISCE GOL (porta inviolata)
    const csStreak = sk(f, x=>(x.ga??0)===0);
    if (csStreak >= 3) {
      signals.push({
        type: 'cs', cat: 'Porta inviolata '+teamName, filter: filt.label,
        title: teamName+' porta inviolata da '+csStreak+' gare',
        detail: 'Difesa solida: non subisce gol da '+csStreak+' partite',
        bets: [teamName+' NG avversario', 'Under 0.5 gol subiti '+teamName],
        conf: Math.min(82, 45+csStreak*8), matchId: matchInfo.id,
        match: matchInfo.homeName+' vs '+matchInfo.awayName,
        leagueName: matchInfo.leagueName, date: matchInfo.date,
      });
    }

    // 8. TIRI BASSI (ritorno alla media)
    const shotsAvg = av(f.filter(x=>x.shots!=null), x=>x.shots);
    const shotsRecent = av(f.slice(0,4).filter(x=>x.shots!=null), x=>x.shots);
    if (shotsAvg!=null && shotsRecent!=null && (shotsAvg-shotsRecent)>=3) {
      signals.push({
        type: 'shots', cat: 'Tiri '+teamName, filter: filt.label,
        title: teamName+' — ritorno tiri (media '+shotsAvg.toFixed(1)+' → recenti '+shotsRecent.toFixed(1)+')',
        detail: 'La squadra è sotto la sua media di tiri: probabile rimbalzo',
        bets: ['Over tiri '+teamName, 'Over tiri in porta '+teamName],
        conf: Math.min(75, 48+(shotsAvg-shotsRecent)*4), matchId: matchInfo.id,
        match: matchInfo.homeName+' vs '+matchInfo.awayName,
        leagueName: matchInfo.leagueName, date: matchInfo.date,
      });
    }
  }

  return signals;
}

function calcH2HSignals(h2h, matchInfo) {
  const signals = [];
  if (h2h.length < 5) return signals;

  // No pareggio H2H
  const ndH2H = sk(h2h, x=>x.hg!==x.ag);
  if (ndH2H >= 5) {
    signals.push({
      type: 'h2h_nodraw', cat: 'No pareggio H2H', filter: 'Scontri diretti',
      title: matchInfo.homeName+' vs '+matchInfo.awayName+' — no pareggio da '+ndH2H+' H2H',
      detail: 'Nessun pareggio negli ultimi '+ndH2H+' scontri diretti',
      bets: ['No pareggio', 'Doppia chance 1 o 2'],
      conf: Math.min(88, 50+ndH2H*5), matchId: matchInfo.id,
      match: matchInfo.homeName+' vs '+matchInfo.awayName,
      leagueName: matchInfo.leagueName, date: matchInfo.date,
    });
  }

  // No BTTS H2H
  const noBttsH2H = sk(h2h, x=>x.hg===0||x.ag===0);
  if (noBttsH2H >= 4) {
    signals.push({
      type: 'h2h_nobtts', cat: 'No BTTS H2H', filter: 'Scontri diretti',
      title: matchInfo.homeName+' vs '+matchInfo.awayName+' — no BTTS da '+noBttsH2H+' H2H',
      detail: 'In '+noBttsH2H+' scontri diretti consecutivi almeno una squadra non ha segnato',
      bets: ['No BTTS (una non segna)', 'Under 1.5 gol'],
      conf: Math.min(82, 48+noBttsH2H*6), matchId: matchInfo.id,
      match: matchInfo.homeName+' vs '+matchInfo.awayName,
      leagueName: matchInfo.leagueName, date: matchInfo.date,
    });
  }

  // Dominio casa nei precedenti
  const homeWins = h2h.filter(x=>x.hg>x.ag).length;
  const pct = homeWins/h2h.length;
  if (pct >= 0.65 && h2h.length >= 8) {
    signals.push({
      type: 'h2h_home', cat: 'Dominio casa H2H', filter: 'Scontri diretti',
      title: matchInfo.homeName+' domina gli H2H ('+homeWins+'/'+h2h.length+')',
      detail: 'Vince il '+Math.round(pct*100)+'% degli scontri diretti in casa',
      bets: ['Vittoria '+matchInfo.homeName, matchInfo.homeName+' Over 1.5'],
      conf: Math.min(80, 40+Math.round(pct*50)), matchId: matchInfo.id,
      match: matchInfo.homeName+' vs '+matchInfo.awayName,
      leagueName: matchInfo.leagueName, date: matchInfo.date,
    });
  }

  return signals;
}

async function getTeamFx(teamId, key) {
  await sleep(400);
  const r = await apiFetch("/matches", key, { team_id: teamId, status: "finished", per_page: 40 });
  const fixtures = (r.data||[]).slice(0,40).map(m=>teamView(m,teamId));
  // Stats dettagliate per le prime 15 con xG
  const withXG = fixtures.filter(f=>f.xgAvail).slice(0,15);
  for (const f of withXG) {
    try {
      await sleep(300);
      const sr = await apiFetch(`/matches/${f.matchId}/stats`, key);
      const s = extractStats(sr.data, f.h===1);
      Object.assign(f, s);
    } catch(e) {}
  }
  return fixtures;
}

async function getH2H(homeId, awayId, key) {
  await sleep(400);
  const r = await apiFetch("/matches", key, {
    team_id: String(homeId), opponent_id: String(awayId),
    status: "finished", per_page: 25
  });
  return (r.data||[]).slice(0,25).map(x=>({
    d: (x.utc_date||"").slice(0,10),
    homeId: x.home_team?.id,
    hg: x.home_score??x.score?.home??null,
    ag: x.away_score??x.score?.away??null,
    hhg: x.half_time_score?.home??null,
    hag: x.half_time_score?.away??null,
  }));
}

async function buildAnalysis(key) {
  const today = todayUTC();
  const until = plusDays(7);
  // 1. Partite della settimana
  let matches = [];
  for (const comp of COMPETITIONS) {
    try {
      await sleep(400);
      const params = { competition_id: comp.id, per_page: 50, page: 1 };
      if (comp.season) params.season_id = comp.season;
      const r1 = await apiFetch("/matches", key, params);
      let all = r1.data||[];
      const total = r1.meta?.total_pages||1;
      if (total > 1) {
        await sleep(400);
        const r2 = await apiFetch("/matches", key, {...params, page: total});
        all = [...all, ...(r2.data||[])];
      }
      for (const m of all) {
        const d = (m.utc_date||"").slice(0,10);
        const name = m.home_team?.name||"";
        if (d>=today && d<=until && !name.match(/^W\d/) && !name.match(/^\d/) && !name.match(/^[A-Z]\d/)) {
          matches.push({...m, _compName: comp.name});
        }
      }
    } catch(e) {}
  }
  matches = matches.slice(0, 25);

  // 2. Per ogni partita carica storico squadre + H2H
  const allSignals = [];
  const matchData = [];
  const teamCache = {};

  for (const m of matches) {
    const homeId = m.home_team?.id, awayId = m.away_team?.id;
    if (!homeId || !awayId) continue;
    const matchInfo = {
      id: m.id, homeName: m.home_team?.name, awayName: m.away_team?.name,
      leagueName: m._compName, date: (m.utc_date||"").slice(0,10),
      time: (m.utc_date||"").slice(11,16),
      compId: m.competition_id, homeId, awayId,
      homeScore: m.home_score??m.score?.home??null,
      awayScore: m.away_score??m.score?.away??null,
    };

    if (!teamCache[homeId]) teamCache[homeId] = await getTeamFx(homeId, key);
    if (!teamCache[awayId]) teamCache[awayId] = await getTeamFx(awayId, key);
    const h2h = await getH2H(homeId, awayId, key);

    const homeFx = teamCache[homeId];
    const awayFx = teamCache[awayId];

    // Segnali casa
    const homeSig = calcSignals(homeFx, m.competition_id, true, m.home_team?.name, matchInfo);
    // Segnali trasferta
    const awaySig = calcSignals(awayFx, m.competition_id, false, m.away_team?.name, matchInfo);
    // Segnali H2H
    const h2hSig = calcH2HSignals(h2h, matchInfo);

    // Segnali incrociati 1°T (casa imbattuta + trasferta senza W)
    const homeNL1H_all = sk(homeFx.filter(f=>f.hgf!=null), x=>(x.hgf??0)>=(x.hga??0));
    const awayNW1H_all = sk(awayFx.filter(f=>f.hgf!=null), x=>(x.hgf??0)<=(x.hga??0));
    if (homeNL1H_all >= 5 && awayNW1H_all >= 5) {
      allSignals.push({
        type: 'combo1h', cat: '⚡ Combo 1°T', filter: 'Incrocio',
        title: matchInfo.homeName+' (NL 1°T da '+homeNL1H_all+') vs '+matchInfo.awayName+' (NW 1°T da '+awayNW1H_all+')',
        detail: 'Incrocio perfetto: casa imbattuta 1°T da '+homeNL1H_all+' · trasferta senza vittoria 1°T da '+awayNW1H_all,
        bets: ['1X primo tempo', 'Pareggio o '+matchInfo.homeName+' 1°T'],
        conf: Math.min(94, 60+homeNL1H_all*2+awayNW1H_all*2),
        matchId: matchInfo.id, match: matchInfo.homeName+' vs '+matchInfo.awayName,
        leagueName: matchInfo.leagueName, date: matchInfo.date,
      });
    }

    allSignals.push(...homeSig, ...awaySig, ...h2hSig);
    matchData.push({...matchInfo, homeFx, awayFx, h2h});
  }

  // Ordina per confidenza
  allSignals.sort((a,b)=>b.conf-a.conf);

  // Raggruppa per categoria
  const byType = {};
  for (const s of allSignals) {
    if (!byType[s.type]) byType[s.type] = [];
    byType[s.type].push(s);
  }

  return { date: today, signals: allSignals, byType, matchData };
}

export default async function handler(req, res) {
  const key = process.env.STATS_API_KEY;
  if (!key) { res.status(500).json({ error: "Manca STATS_API_KEY" }); return; }
  const now = Date.now();
  if (req.query?.refresh !== "1" && CACHE.data && now - CACHE.at < CACHE_TTL) {
    res.status(200).json({ ...CACHE.data, cached: true }); return;
  }
  try {
    const data = await buildAnalysis(key);
    CACHE = { at: now, data };
    res.status(200).json({ ...data, cached: false });
  } catch(e) {
    res.status(500).json({ error: String(e.message) });
  }
}
