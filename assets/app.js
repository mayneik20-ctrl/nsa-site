/* ============================================================================
   NSA — National Sports Association
   Version connectée à Supabase.
   Le design et les fonctionnalités sont ceux du prototype ; la seule différence
   est que tout est lu et écrit dans une vraie base de données, donc les
   modifications de l'admin restent visibles par tous les visiteurs.
============================================================================ */

/* ---------------- CLIENT SUPABASE ---------------- */
const CFG = window.NSA_CONFIG || {};
const CONFIGURED = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("VOTRE-PROJET");
const sb = CONFIGURED
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

/* ---------------- CONSTANTES (identiques au prototype) ---------------- */
const POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
const FIRST_NAMES = ["Malik","Owen","Diego","Jayden","Lucas","Amir","Noah","Ethan","Kwame","Rafael","Tyler","Adam","Marco","Elias","Samir","Caleb"];
const LAST_NAMES = ["Carter","Nguyen","Silva","Brooks","Martinez","Osei","Turner","Kovac","Reyes","Dubois","Hayes","Novak","Ferreira","Adeyemi","Klein","Moreau"];
const HS_TEAM_NAMES = ["Lincoln Wolves","Jefferson Hawks","Roosevelt Titans","Kennedy Eagles","Madison Lions","Franklin Sharks","Washington Panthers","Adams Falcons","Monroe Vipers","Hamilton Comets","Douglass Storm","Wright Rangers","Carver Bulldogs","Bell Raptors","Parker Knights","Ellison Cobras"];
const HS_SCHOOLS = HS_TEAM_NAMES.map(n => n.split(" ")[0] + " High School");
const UNI_TEAM_NAMES = ["Riverbend University","Cascade State","Northfield Institute","Ashworth College","Blackwood University","Sterling State","Ironvale Tech","Thornfield College","Meridian University","Oakhaven State","Vantage Institute","Graystone College","Brightwell University","Corvus State","Fenwick Institute","Aldergate College"];
const COMPS = ["HIGH_SCHOOL", "UNIVERSITY"];
const PREFIX = { HIGH_SCHOOL: "hs", UNIVERSITY: "uni" };

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
function makePlayers(teamId, seed) {
  const rnd = seededRandom(seed);
  const players = [];
  const used = new Set();
  for (let i = 0; i < 16; i++) {
    let num;
    do { num = Math.floor(rnd() * 30) + 1; } while (used.has(num));
    used.add(num);
    players.push({
      id: teamId + "-p" + (i+1),
      firstName: FIRST_NAMES[Math.floor(rnd() * FIRST_NAMES.length)],
      lastName: LAST_NAMES[Math.floor(rnd() * LAST_NAMES.length)],
      number: num,
      position: i === 0 ? "Goalkeeper" : POSITIONS[1 + Math.floor(rnd() * 3)],
      goals: Math.floor(rnd() * 12),
      sortOrder: i,
    });
  }
  return players;
}

/* ---------------- ÉTAT LOCAL (miroir de la base) ---------------- */
const state = {
  competition: "HIGH_SCHOOL",
  isAdmin: false,
  tab: "home",
  selectedTeamId: null,
  editingPlayerId: null,
  editingTeamName: false,
  editingTeamAbbr: false,
  ballIcon: null,
  orgLogo: null,
  editions: { HIGH_SCHOOL: "2026 Championship", UNIVERSITY: "2026 Championship" },
  footer: { address: "", social: { instagram: "", tiktok: "", youtube: "" } },
  managePlayersTeamId: null,
  saving: false,
  data: {
    HIGH_SCHOOL: { teams: [], bracket: emptyBracket(), sliders: [], trophyLogo: null },
    UNIVERSITY:  { teams: [], bracket: emptyBracket(), sliders: [], trophyLogo: null },
  },
};
function emptyBracket() { return { round16: [], qf: [], sf: [], final: [] }; }
function cur() { return state.data[state.competition]; }
function compLabel() { return state.competition === "HIGH_SCHOOL" ? "High School" : "University"; }

/* ---------------- OUTILS ---------------- */
function esc(str) {
  const d = document.createElement("div"); d.textContent = str == null ? "" : String(str); return d.innerHTML;
}
function initials(name) { return String(name || "?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase(); }
function num(v) { return v === "" || v === null || v === undefined ? null : Number(v); }

function toast(message, kind) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 6000 : 2600);
}

let lastLocalWrite = 0;
async function run(promise, errorLabel) {
  state.saving = true; updateSaveState();
  lastLocalWrite = Date.now();
  try {
    const { error } = await promise;
    if (error) throw error;
    return true;
  } catch (e) {
    console.error(errorLabel, e);
    toast((errorLabel || "Enregistrement impossible") + " : " + (e.message || e), "error");
    return false;
  } finally {
    lastLocalWrite = Date.now();
    state.saving = false; updateSaveState();
  }
}
function updateSaveState() {
  const el = document.getElementById("save-state");
  if (!el) return;
  el.textContent = state.saving ? "Enregistrement…" : "Enregistré";
  el.className = "save-state" + (state.saving ? " saving" : "");
}

/* ---------------- COUCHE BASE DE DONNÉES ---------------- */
const db = {
  /* --- lecture --- */
  async loadAll() {
    const [teamsRes, playersRes, tiesRes, slidersRes, settingsRes] = await Promise.all([
      sb.from("teams").select("*").order("sort_order", { ascending: true }),
      sb.from("players").select("*").order("sort_order", { ascending: true }),
      sb.from("ties").select("*").order("idx", { ascending: true }),
      sb.from("sliders").select("*").order("sort_order", { ascending: true }),
      sb.from("settings").select("*"),
    ]);
    for (const r of [teamsRes, playersRes, tiesRes, slidersRes, settingsRes]) {
      if (r.error) throw r.error;
    }

    COMPS.forEach(c => { state.data[c] = { teams: [], bracket: emptyBracket(), sliders: [], trophyLogo: null }; });

    const byTeam = {};
    teamsRes.data.forEach(r => {
      const team = {
        id: r.id, name: r.name, institution: r.institution || "",
        abbreviation: r.abbreviation || "", logo: r.logo_url || null,
        sortOrder: r.sort_order, competition: r.competition, players: [],
      };
      byTeam[r.id] = team;
      state.data[r.competition].teams.push(team);
    });
    playersRes.data.forEach(r => {
      const team = byTeam[r.team_id];
      if (!team) return;
      team.players.push({
        id: r.id, teamId: r.team_id, firstName: r.first_name, lastName: r.last_name,
        number: r.number, position: r.position, goals: r.goals, sortOrder: r.sort_order,
      });
    });
    tiesRes.data.forEach(r => {
      state.data[r.competition].bracket[r.round].push({
        id: r.id, round: r.round, idx: r.idx,
        teamAId: r.team_a_id, teamBId: r.team_b_id,
        leg1: { scoreA: r.leg1_a, scoreB: r.leg1_b },
        leg2: { scoreA: r.leg2_a, scoreB: r.leg2_b },
        penalties: { scoreA: r.pen_a, scoreB: r.pen_b },
        isSingleMatch: r.is_single_match,
      });
    });
    COMPS.forEach(c => {
      const b = state.data[c].bracket;
      Object.keys(b).forEach(k => b[k].sort((a, z) => a.idx - z.idx));
    });
    slidersRes.data.forEach(r => {
      state.data[r.competition].sliders.push({ id: r.id, url: r.url, caption: r.caption || "" });
    });

    const S = {};
    settingsRes.data.forEach(r => { S[r.key] = r.value || ""; });
    state.orgLogo = S.org_logo || null;
    state.ballIcon = S.ball_icon || null;
    state.editions.HIGH_SCHOOL = S.edition_HIGH_SCHOOL || "2026 Championship";
    state.editions.UNIVERSITY = S.edition_UNIVERSITY || "2026 Championship";
    state.footer.address = S.footer_address || "";
    state.footer.social.instagram = S.social_instagram || "";
    state.footer.social.tiktok = S.social_tiktok || "";
    state.footer.social.youtube = S.social_youtube || "";
    state.data.HIGH_SCHOOL.trophyLogo = S.trophy_HIGH_SCHOOL || null;
    state.data.UNIVERSITY.trophyLogo = S.trophy_UNIVERSITY || null;
  },

  /* --- équipes --- */
  insertTeam(team, competition) {
    return sb.from("teams").insert({
      id: team.id, competition, name: team.name, institution: team.institution,
      abbreviation: team.abbreviation || null, logo_url: team.logo || null,
      sort_order: team.sortOrder || 0,
    });
  },
  updateTeam(id, patch) { return sb.from("teams").update(patch).eq("id", id); },
  deleteTeam(id) { return sb.from("teams").delete().eq("id", id); },

  /* --- joueurs --- */
  insertPlayers(players, teamId) {
    return sb.from("players").insert(players.map(p => ({
      id: p.id, team_id: teamId, first_name: p.firstName, last_name: p.lastName,
      number: p.number, position: p.position, goals: p.goals, sort_order: p.sortOrder || 0,
    })));
  },
  updatePlayer(id, patch) { return sb.from("players").update(patch).eq("id", id); },
  deletePlayer(id) { return sb.from("players").delete().eq("id", id); },

  /* --- tableau final : on réécrit les 15 confrontations d'un coup,
         ce qui garde la propagation automatique des vainqueurs cohérente --- */
  saveBracket(competition) {
    const b = state.data[competition].bracket;
    const rows = [];
    ["round16","qf","sf","final"].forEach(round => {
      b[round].forEach(tie => rows.push({
        id: tie.id, competition, round, idx: tie.idx,
        team_a_id: tie.teamAId || null, team_b_id: tie.teamBId || null,
        leg1_a: num(tie.leg1.scoreA), leg1_b: num(tie.leg1.scoreB),
        leg2_a: num(tie.leg2.scoreA), leg2_b: num(tie.leg2.scoreB),
        pen_a: num(tie.penalties.scoreA), pen_b: num(tie.penalties.scoreB),
        is_single_match: !!tie.isSingleMatch, updated_at: new Date().toISOString(),
      }));
    });
    return sb.from("ties").upsert(rows);
  },

  /* --- carrousel --- */
  insertSlider(slide, competition, sortOrder) {
    return sb.from("sliders").insert({
      id: slide.id, competition, url: slide.url, caption: slide.caption || "", sort_order: sortOrder,
    });
  },
  deleteSlider(id) { return sb.from("sliders").delete().eq("id", id); },

  /* --- réglages --- */
  setSetting(key, value) {
    return sb.from("settings").upsert({ key, value: value == null ? "" : String(value), updated_at: new Date().toISOString() });
  },

  /* --- images --- */
  async uploadImage(file, folder) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = folder + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    const { error } = await sb.storage.from(CFG.STORAGE_BUCKET || "media")
      .upload(path, file, { cacheControl: "31536000", upsert: false });
    if (error) throw error;
    const { data } = sb.storage.from(CFG.STORAGE_BUCKET || "media").getPublicUrl(path);
    return data.publicUrl;
  },
};

/* Téléverse une image et rend son URL publique, avec message d'erreur lisible. */
async function uploadImageOrNull(file, folder) {
  state.saving = true; updateSaveState();
  try {
    const url = await db.uploadImage(file, folder);
    lastLocalWrite = Date.now();
    return url;
  } catch (e) {
    console.error("upload", e);
    toast("Téléversement de l'image impossible : " + (e.message || e), "error");
    return null;
  } finally {
    state.saving = false; updateSaveState();
  }
}

/* ---------------- ICÔNES (SVG inline, sans dépendance) ---------------- */
const ICONS = {
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m21 15-5-5L5 21"/><circle cx="9" cy="9" r="2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  swords: '<path d="m14.5 17.5 3-3"/><path d="M3 21l7-7"/><path d="m18 13 3 3-3 3-3-3Z"/><path d="M6 3 3 6l9.5 9.5 3-3Z"/><path d="M14 6l3-3 3 3-3 3Z"/><path d="M6 21l-3-3 3-3Z"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37Z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  youtube: '<path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33Z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/>',
  tiktok: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  crown: '<path d="m2 20 2-10 5 4 3-7 3 7 5-4 2 10Z"/><path d="M2 20h20"/>',
};
function icon(name, size, color) {
  size = size || 16; color = color || "currentColor";
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="'+color+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+ICONS[name]+'</svg>';
}
function soccerBallIcon(size) {
  size = size || 26;
  if (state.ballIcon) {
    return '<img src="'+state.ballIcon+'" style="width:'+size+'px;height:'+size+'px;object-fit:contain;border-radius:50%" alt="goals"/>';
  }
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="10" fill="#ffffff" stroke="#8b2fd6" stroke-width="1.2"/>' +
    '<path d="M12 6.5 15.8 9.2 14.3 13.7H9.7L8.2 9.2Z" fill="#8b2fd6"/>' +
    '<path d="M12 6.5 8.2 9.2M12 6.5 15.8 9.2M9.7 13.7 6.5 16.2M14.3 13.7 17.5 16.2M9.7 13.7 5.2 12.4M14.3 13.7 18.8 12.4" stroke="#ff2d6a" stroke-width="1" stroke-linecap="round"/>' +
    '</svg>';
}

/* ---------------- LOGIQUE DES CONFRONTATIONS ---------------- */
function legComplete(leg) { return leg.scoreA !== null && leg.scoreA !== "" && leg.scoreB !== null && leg.scoreB !== ""; }
function tieAggregate(tie) {
  if (tie.isSingleMatch) {
    if (!legComplete(tie.leg1)) return null;
    return { aggA: Number(tie.leg1.scoreA), aggB: Number(tie.leg1.scoreB) };
  }
  if (!legComplete(tie.leg1) || !legComplete(tie.leg2)) return null;
  return { aggA: Number(tie.leg1.scoreA) + Number(tie.leg2.scoreA), aggB: Number(tie.leg1.scoreB) + Number(tie.leg2.scoreB) };
}
function tieNeedsPenalties(tie) { const agg = tieAggregate(tie); return agg ? agg.aggA === agg.aggB : false; }
function tieWinnerId(tie) {
  const agg = tieAggregate(tie); if (!agg) return null;
  if (agg.aggA > agg.aggB) return tie.teamAId;
  if (agg.aggB > agg.aggA) return tie.teamBId;
  const pA = tie.penalties.scoreA, pB = tie.penalties.scoreB;
  if (pA !== null && pA !== "" && pB !== null && pB !== "") {
    if (Number(pA) > Number(pB)) return tie.teamAId;
    if (Number(pB) > Number(pA)) return tie.teamBId;
  }
  return null;
}
function nextSlotFor(roundKey, index) {
  if (roundKey === "round16") return { round: "qf", index: Math.floor(index / 2), slot: index % 2 === 0 ? "teamAId" : "teamBId" };
  if (roundKey === "qf") return { round: "sf", index: Math.floor(index / 2), slot: index % 2 === 0 ? "teamAId" : "teamBId" };
  if (roundKey === "sf") return { round: "final", index: 0, slot: index % 2 === 0 ? "teamAId" : "teamBId" };
  return null;
}
/* Propage les vainqueurs vers le tour suivant. Renvoie true si quelque chose a changé. */
function advanceWinners() {
  const b = cur().bracket;
  let changed = false;
  ["round16", "qf", "sf"].forEach(roundKey => {
    b[roundKey].forEach((tie, index) => {
      const winner = tieWinnerId(tie);
      const dest = nextSlotFor(roundKey, index);
      if (!dest) return;
      const destTie = b[dest.round][dest.index];
      if (!destTie) return;
      const next = winner || null;
      if (destTie[dest.slot] !== next) { destTie[dest.slot] = next; changed = true; }
    });
  });
  return changed;
}
function findTeam(id) { return cur().teams.find(t => t.id === id); }
function findTieAnywhere(tieId) {
  const b = cur().bracket;
  for (const key of ["round16","qf","sf","final"]) {
    const t = b[key].find(x => x.id === tieId);
    if (t) return t;
  }
  return null;
}
function computeTopScorers(teams) {
  const all = [];
  teams.forEach(team => team.players.forEach(p => all.push(Object.assign({}, p, { teamName: team.name, institution: team.institution, teamId: team.id }))));
  return all.sort((a,b) => b.goals - a.goals).slice(0, 10);
}

/* Enregistrement différé du tableau final : l'admin peut taper plusieurs
   scores d'affilée, on n'écrit en base qu'une fois la frappe terminée. */
let bracketSaveTimer = null;
function queueBracketSave(competition) {
  clearTimeout(bracketSaveTimer);
  state.saving = true; updateSaveState();
  bracketSaveTimer = setTimeout(() => {
    run(db.saveBracket(competition), "Scores non enregistrés");
  }, 450);
}

/* Conserve le champ actif (et la position du curseur) lors d'un re-rendu. */
function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.matches || !el.matches("input, select")) return null;
  const key = el.getAttribute("data-vb") || el.getAttribute("data-id") || el.id || null;
  if (!key) return null;
  const card = el.closest("[data-tie]");
  return { key, tie: card ? card.getAttribute("data-tie") : null, start: el.selectionStart };
}
function restoreFocus(f) {
  if (!f) return;
  const scope = f.tie ? document.querySelector('[data-tie="'+f.tie+'"]') : document;
  if (!scope) return;
  const el = scope.querySelector('[data-vb="'+f.key+'"], [data-id="'+f.key+'"], #'+CSS.escape(f.key));
  if (!el) return;
  el.focus();
  if (f.start != null && el.setSelectionRange && el.type !== "number") {
    try { el.setSelectionRange(f.start, f.start); } catch (e) {}
  }
}

/* ---------------- RENDU : EN-TÊTE ---------------- */
function renderHeader() {
  document.body.className = state.competition === "HIGH_SCHOOL" ? "hs" : "uni";

  const switcherEl = document.getElementById("switcher");
  switcherEl.innerHTML = "";
  [["HIGH_SCHOOL","High School"],["UNIVERSITY","University"]].forEach(([key,label]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = state.competition === key ? "active" : "";
    b.onclick = () => { state.competition = key; state.selectedTeamId = null; state.managePlayersTeamId = null; if ((state.tab==="bracket"||state.tab==="manage-teams"||state.tab==="sliders-admin") && !state.isAdmin) state.tab="home"; renderAll(); };
    switcherEl.appendChild(b);
  });

  const tabsEl = document.getElementById("tabs");
  tabsEl.innerHTML = "";
  const pub = [["home","Home"],["teams","Teams"],["scorers","Top Scorers"]];
  const adm = [["bracket","Match & Bracket"],["manage-teams","Manage Teams"],["sliders-admin","Sliders"],["settings","Settings"]];
  const list = state.isAdmin ? pub.concat(adm) : pub;
  list.forEach(([key,label]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = state.tab === key ? "active" : "";
    b.onclick = () => { state.tab = key; state.selectedTeamId = null; editingScorerId = null; renderAll(); };
    tabsEl.appendChild(b);
  });

  const actionEl = document.getElementById("header-action");
  actionEl.innerHTML = "";
  if (state.isAdmin) {
    const b = document.createElement("button");
    b.className = "btn btn-ghost";
    b.innerHTML = icon("logout",14) + " Exit control panel";
    b.onclick = async () => {
      await sb.auth.signOut();
      state.isAdmin = false; state.tab = "home"; renderAll();
    };
    actionEl.appendChild(b);
  }

  renderBrandHeader();
  renderSiteFooter();
}

function renderBrandHeader() {
  const el = document.getElementById("brand-header");
  const logoInner = state.orgLogo
    ? '<img src="'+state.orgLogo+'"/>'
    : icon("shield", 30, "var(--textDim)");
  el.innerHTML =
    '<div class="brand-logo-upload'+(state.isAdmin?" editable":"")+'" id="org-logo-upload" title="'+(state.isAdmin?"Upload organization logo":"")+'">'+logoInner+
    (state.isAdmin ? '<input type="file" id="org-logo-input" accept="image/*" style="display:none"/>' : '') +
    '</div>' +
    '<h1 class="brand-title">National Sports Association</h1>' +
    '<div class="brand-edition">'+esc(state.editions[state.competition])+'</div>';
  if (state.isAdmin) {
    const upload = document.getElementById("org-logo-upload");
    const input = document.getElementById("org-logo-input");
    upload.onclick = () => input.click();
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const url = await uploadImageOrNull(file, "org");
      if (!url) return;
      state.orgLogo = url;
      await run(db.setSetting("org_logo", url), "Logo non enregistré");
      renderAll();
    };
  }
}

function renderSiteFooter() {
  const el = document.getElementById("site-footer");
  if (state.isAdmin) { el.style.display = "none"; return; }
  el.style.display = "block";
  const socials = state.footer.social;
  const socialIcons = [
    ["instagram", socials.instagram],
    ["tiktok", socials.tiktok],
    ["youtube", socials.youtube],
  ].filter(([,url]) => url);
  el.innerHTML =
    '<div class="address">'+icon("mapPin",14)+' '+esc(state.footer.address)+'</div>' +
    (socialIcons.length ? '<div class="social-row">'+socialIcons.map(([name,url]) =>
      '<a class="social-circle" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+icon(name,17)+'</a>'
    ).join("")+'</div>' : '') +
    '<div class="copyright">© '+new Date().getFullYear()+' National Sports Association</div>';
}

/* ---------------- RENDU : ACCUEIL ---------------- */
let sliderIndex = 0, sliderTimer = null;
function renderHero(container) {
  const slides = cur().sliders;
  clearInterval(sliderTimer);
  if (sliderIndex >= slides.length) sliderIndex = 0;

  if (slides.length === 0) {
    container.innerHTML =
      '<div class="hero"><div class="hero-empty">' +
      '<span class="eyebrow">' + esc(compLabel().toUpperCase()) + ' COMPETITION</span>' +
      '<h1>National Sports Association</h1>' +
      '<p>The administrator hasn\u2019t added any slider images yet \u2014 they\u2019ll appear here once uploaded.</p>' +
      '</div></div>';
    return;
  }
  const slide = slides[sliderIndex];
  container.innerHTML =
    '<div class="hero has-image">' +
    '<img src="' + slide.url + '" alt="' + esc(slide.caption||"") + '"/>' +
    '<div class="hero-overlay"></div>' +
    (slide.caption ? '<div class="hero-caption"><span class="tag">'+esc(compLabel().toUpperCase())+'</span><p>'+esc(slide.caption)+'</p></div>' : '') +
    (slides.length > 1 ? (
      '<button class="hero-arrow left" id="hero-prev">'+icon("chevLeft",20,"#fff")+'</button>' +
      '<button class="hero-arrow right" id="hero-next">'+icon("chevRight",20,"#fff")+'</button>' +
      '<div class="hero-dots" id="hero-dots"></div>'
    ) : "") +
    '</div>';

  if (slides.length > 1) {
    document.getElementById("hero-prev").onclick = () => { sliderIndex = (sliderIndex - 1 + slides.length) % slides.length; renderHero(container); };
    document.getElementById("hero-next").onclick = () => { sliderIndex = (sliderIndex + 1) % slides.length; renderHero(container); };
    const dotsEl = document.getElementById("hero-dots");
    slides.forEach((_, i) => {
      const d = document.createElement("span");
      d.className = i === sliderIndex ? "active" : "";
      d.onclick = () => { sliderIndex = i; renderHero(container); };
      dotsEl.appendChild(d);
    });
    sliderTimer = setInterval(() => { sliderIndex = (sliderIndex + 1) % slides.length; renderHero(container); }, 5000);
  }
}

function crestHtml(team, size) {
  size = size || 40;
  if (typeof team === "string") team = { name: team, logo: null };
  if (team.logo) {
    return '<div class="crest" style="width:'+size+'px;height:'+size+'px;background:var(--surfaceAlt);padding:2px"><img src="'+team.logo+'" style="width:100%;height:100%;object-fit:contain;border-radius:6px"/></div>';
  }
  return '<div class="crest" style="width:'+size+'px;height:'+size+'px;font-size:'+(size*0.36)+'px">'+esc(initials(team.name))+'</div>';
}

function renderTeamsGrid(teams, container, limit) {
  const list = limit ? teams.slice(0, limit) : teams;
  container.innerHTML = "";
  container.className = "teams-grid";
  list.forEach(team => {
    const card = document.createElement("button");
    card.className = "team-card";
    card.innerHTML = crestHtml(team, 46) + '<div class="team-info"><div class="team-name">'+esc(team.name)+'</div><div class="team-sub">'+esc(team.abbreviation || team.institution)+'</div></div>';
    card.onclick = () => { state.selectedTeamId = team.id; state.tab = "teams"; renderAll(); };
    container.appendChild(card);
  });
}

/* ---------------- RENDU : MEILLEURS BUTEURS ---------------- */
let editingScorerId = null;
function renderTopScorers(teams, container, editable) {
  const scorers = computeTopScorers(teams);
  container.innerHTML = "";

  if (editable) {
    const addPanel = document.createElement("div");
    addPanel.className = "panel";
    addPanel.style.marginBottom = "16px";
    addPanel.innerHTML =
      '<h3 style="margin-bottom:10px">Add a player</h3>' +
      '<div class="field-row">' +
        '<select id="ts-team" style="flex:1 1 180px">' + cur().teams.map(t => '<option value="'+t.id+'">'+esc(t.name)+(t.institution && t.institution!==t.name ? " — "+esc(t.institution) : "")+'</option>').join("") + '</select>' +
        '<input type="text" id="ts-first" placeholder="First name" style="flex:1 1 130px"/>' +
        '<input type="text" id="ts-last" placeholder="Last name" style="flex:1 1 130px"/>' +
        '<input type="number" id="ts-number" placeholder="Jersey #" style="flex:0 0 90px"/>' +
        '<select id="ts-position" style="flex:0 0 150px">' + POSITIONS.map(p => '<option value="'+p+'">'+p+'</option>').join("") + '</select>' +
        '<input type="number" id="ts-goals" placeholder="Goals" style="flex:0 0 90px"/>' +
        '<button class="btn btn-primary" id="ts-add-btn">'+icon("plus",15)+' Add player</button>' +
      '</div>';
    container.appendChild(addPanel);
    document.getElementById("ts-add-btn").onclick = async () => {
      const teamId = document.getElementById("ts-team").value;
      const team = findTeam(teamId);
      if (!team) return;
      const firstName = document.getElementById("ts-first").value.trim();
      const lastName = document.getElementById("ts-last").value.trim();
      const number = Number(document.getElementById("ts-number").value) || 0;
      const position = document.getElementById("ts-position").value;
      const goals = Number(document.getElementById("ts-goals").value) || 0;
      if (!firstName) return;
      const player = { id: team.id+"-p"+Date.now(), firstName, lastName, number, position, goals, sortOrder: team.players.length };
      const ok = await run(db.insertPlayers([player], team.id), "Joueur non ajouté");
      if (!ok) return;
      team.players.push(player);
      renderAll();
    };
  }

  scorers.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "scorer-row" + (i === 0 ? " top" : "");
    if (editable && editingScorerId === p.id) {
      row.innerHTML =
        '<div class="scorer-rank">'+(i+1)+'</div>' +
        '<div class="scorer-avatar">'+icon("user",20,"var(--textDim)")+'</div>' +
        '<div class="scorer-info" style="display:flex;flex-direction:column;gap:6px">' +
          '<div style="display:flex;gap:6px"><input type="text" id="sc-fn" value="'+esc(p.firstName)+'" style="flex:1;font-size:13px;padding:6px 8px"/><input type="text" id="sc-ln" value="'+esc(p.lastName)+'" style="flex:1;font-size:13px;padding:6px 8px"/></div>' +
          '<select id="sc-team" style="font-size:12.5px;padding:6px 8px">' + cur().teams.map(t => '<option value="'+t.id+'"'+(String(t.id)===String(p.teamId)?" selected":"")+'>'+esc(t.name)+(t.institution && t.institution!==t.name ? " — "+esc(t.institution) : "")+'</option>').join("") + '</select>' +
          '<select id="sc-position" style="font-size:12.5px;padding:6px 8px">' + POSITIONS.map(pos => '<option value="'+pos+'"'+(pos===p.position?" selected":"")+'>'+pos+'</option>').join("") + '</select>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<input type="number" id="sc-goals" value="'+p.goals+'" style="width:52px;padding:6px 8px;font-size:13px;text-align:center"/>' +
          '<button class="btn btn-primary btn-sm" id="sc-save">'+icon("check",14)+'</button>' +
        '</div>';
      container.appendChild(row);
      row.querySelector("#sc-save").onclick = async () => {
        const newTeamId = row.querySelector("#sc-team").value;
        const oldTeam = findTeam(p.teamId);
        const player = oldTeam.players.find(pl => pl.id === p.id);
        const patch = {
          first_name: row.querySelector("#sc-fn").value,
          last_name: row.querySelector("#sc-ln").value,
          goals: Number(row.querySelector("#sc-goals").value) || 0,
          position: row.querySelector("#sc-position").value,
          team_id: newTeamId,
        };
        const ok = await run(db.updatePlayer(p.id, patch), "Buteur non enregistré");
        if (!ok) return;
        player.firstName = patch.first_name;
        player.lastName = patch.last_name;
        player.goals = patch.goals;
        player.position = patch.position;
        if (String(newTeamId) !== String(p.teamId)) {
          oldTeam.players = oldTeam.players.filter(pl => pl.id !== p.id);
          player.teamId = newTeamId;
          findTeam(newTeamId).players.push(player);
        }
        editingScorerId = null;
        renderAll();
      };
    } else {
      row.innerHTML =
        '<div class="scorer-rank">'+(i+1)+'</div>' +
        '<div class="scorer-avatar">'+icon("user",20,"var(--textDim)")+'</div>' +
        '<div class="scorer-info"><div style="font-weight:700;font-size:15px">'+esc(p.firstName)+' '+esc(p.lastName)+'</div><div style="color:var(--textDim);font-size:12.5px">'+esc(p.institution)+'</div></div>' +
        '<div class="scorer-goals"><div class="n" style="display:flex;align-items:center;gap:8px;justify-content:flex-end">'+soccerBallIcon(28)+p.goals+'</div><div class="label">GOALS</div></div>' +
        (editable ? (
          '<span class="icon-btn" id="edit-sc-'+p.id+'" style="cursor:pointer;margin-left:8px">'+icon("edit",14)+'</span>' +
          '<span class="icon-btn danger" id="del-sc-'+p.id+'" style="cursor:pointer;margin-left:6px">'+icon("trash",14)+'</span>'
        ) : "");
      container.appendChild(row);
      if (editable) {
        row.querySelector("#edit-sc-"+p.id).onclick = () => { editingScorerId = p.id; renderTopScorers(teams, container, editable); };
        row.querySelector("#del-sc-"+p.id).onclick = async () => {
          const team = findTeam(p.teamId);
          const ok = await run(db.deletePlayer(p.id), "Joueur non supprimé");
          if (!ok) return;
          if (team) team.players = team.players.filter(pl => pl.id !== p.id);
          renderAll();
        };
      }
    }
  });
}

function renderHome(main) {
  main.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:32px">' +
    '<div id="hero-container"></div>' +
    '<div id="visual-bracket-container"></div>' +
    '</div>';
  renderHero(document.getElementById("hero-container"));
  renderVisualBracket(document.getElementById("visual-bracket-container"));
}

/* ---------------- RENDU : ÉQUIPES / FICHE ÉQUIPE ---------------- */
function renderTeamDetail(main, team) {
  const wrap = document.createElement("div");
  const back = document.createElement("button");
  back.className = "back-btn";
  back.innerHTML = icon("chevLeft",16) + " All teams";
  back.onclick = () => { state.selectedTeamId = null; renderAll(); };
  wrap.appendChild(back);

  const head = document.createElement("div");
  head.className = "team-detail-head";
  const nameHtml = state.editingTeamName
    ? '<div style="display:flex;gap:8px"><input type="text" id="team-name-input" value="'+esc(team.name)+'"/><button class="btn btn-primary btn-sm" id="save-team-name">'+icon("check",15)+'</button></div>'
    : '<h2>'+esc(team.name)+' '+(state.isAdmin ? '<span class="icon-btn" id="edit-team-name" style="cursor:pointer">'+icon("edit",15)+'</span>' : '')+'</h2>';
  const crestBlock = state.isAdmin
    ? '<div style="position:relative;cursor:pointer" id="team-logo-upload" title="Upload team logo">'+crestHtml(team,64)+'<div style="position:absolute;bottom:-4px;right:-4px;width:22px;height:22px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;border:2px solid var(--bg)">'+icon("camera",11,"#fff")+'</div><input type="file" id="team-logo-input" accept="image/*" style="display:none"/></div>'
    : crestHtml(team,64);
  const abbrHtml = state.isAdmin
    ? (state.editingTeamAbbr
        ? '<div style="display:flex;gap:6px;margin-top:6px"><input type="text" id="team-abbr-input" value="'+esc(team.abbreviation||'')+'" maxlength="12" style="width:140px;padding:5px 8px;font-size:12.5px"/><button class="btn btn-primary btn-sm" id="save-team-abbr">'+icon("check",13)+'</button></div>'
        : '<p style="color:var(--textDim);margin:4px 0 0;display:flex;align-items:center;gap:6px">'+esc(team.abbreviation||"No abbreviation set")+' <span class="icon-btn" id="edit-team-abbr" style="cursor:pointer">'+icon("edit",12)+'</span></p>')
    : '';
  head.innerHTML = crestBlock +
    '<div style="flex:1;min-width:200px">'+nameHtml+'<p style="color:var(--textDim);margin:4px 0 0">'+esc(team.institution)+'</p>'+abbrHtml+'</div>' +
    (state.isAdmin ? '<button class="btn btn-danger" id="delete-team">'+icon("trash",15)+' Remove team</button>' : '');
  wrap.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "players-grid";
  team.players.forEach(p => {
    const row = document.createElement("div");
    row.className = "player-row";
    if (state.editingPlayerId === p.id) {
      row.innerHTML =
        '<div class="player-num">'+p.number+'</div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:6px">' +
        '<div style="display:flex;gap:6px"><input type="text" id="edit-fn" value="'+esc(p.firstName)+'" style="flex:1;font-size:13px;padding:6px 8px"/><input type="text" id="edit-ln" value="'+esc(p.lastName)+'" style="flex:1;font-size:13px;padding:6px 8px"/></div>' +
        '<div style="display:flex;gap:6px">' +
        '<select id="edit-pos" style="font-size:12px;padding:6px 8px">'+POSITIONS.map(pos=>'<option value="'+pos+'"'+(pos===p.position?' selected':'')+'>'+pos+'</option>').join("")+'</select>' +
        '<input type="number" id="edit-num" value="'+p.number+'" style="width:56px;font-size:12px;padding:6px 8px"/>' +
        '<input type="number" id="edit-goals" value="'+p.goals+'" style="width:56px;font-size:12px;padding:6px 8px" title="Goals"/>' +
        '<button class="btn btn-primary btn-sm" id="save-player">'+icon("check",14)+'</button>' +
        '</div></div>';
      grid.appendChild(row);
      row.querySelector("#save-player").onclick = async () => {
        const patch = {
          first_name: row.querySelector("#edit-fn").value,
          last_name: row.querySelector("#edit-ln").value,
          position: row.querySelector("#edit-pos").value,
          number: Number(row.querySelector("#edit-num").value) || 0,
          goals: Number(row.querySelector("#edit-goals").value) || 0,
        };
        const ok = await run(db.updatePlayer(p.id, patch), "Joueur non enregistré");
        if (!ok) return;
        p.firstName = patch.first_name; p.lastName = patch.last_name;
        p.position = patch.position; p.number = patch.number; p.goals = patch.goals;
        state.editingPlayerId = null;
        renderAll();
      };
    } else {
      row.innerHTML =
        '<div class="player-num">'+p.number+'</div>' +
        '<div style="flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<div style="min-width:0"><div class="player-name">'+esc(p.firstName)+' '+esc(p.lastName)+'</div><div class="player-sub">'+esc(p.position)+' \u00b7 '+p.goals+' goals</div></div>' +
        (state.isAdmin ? '<span class="icon-btn" id="edit-p-'+p.id+'" style="cursor:pointer;flex-shrink:0">'+icon("edit",14)+'</span>' : '') +
        '</div>';
      grid.appendChild(row);
      if (state.isAdmin) {
        row.querySelector("#edit-p-"+p.id).onclick = () => { state.editingPlayerId = p.id; renderAll(); };
      }
    }
  });
  wrap.appendChild(grid);
  main.innerHTML = "";
  main.appendChild(wrap);

  if (state.editingTeamName) {
    document.getElementById("save-team-name").onclick = async () => {
      const name = document.getElementById("team-name-input").value;
      const ok = await run(db.updateTeam(team.id, { name }), "Nom d'équipe non enregistré");
      if (!ok) return;
      team.name = name;
      state.editingTeamName = false;
      renderAll();
    };
  } else if (state.isAdmin) {
    const editBtn = document.getElementById("edit-team-name");
    if (editBtn) editBtn.onclick = () => { state.editingTeamName = true; renderAll(); };
  }
  if (state.isAdmin) {
    if (state.editingTeamAbbr) {
      const saveAbbrBtn = document.getElementById("save-team-abbr");
      if (saveAbbrBtn) saveAbbrBtn.onclick = async () => {
        const abbreviation = document.getElementById("team-abbr-input").value.trim().toUpperCase();
        const ok = await run(db.updateTeam(team.id, { abbreviation }), "Abréviation non enregistrée");
        if (!ok) return;
        team.abbreviation = abbreviation;
        state.editingTeamAbbr = false;
        renderAll();
      };
    } else {
      const editAbbrBtn = document.getElementById("edit-team-abbr");
      if (editAbbrBtn) editAbbrBtn.onclick = () => { state.editingTeamAbbr = true; renderAll(); };
    }
  }
  if (state.isAdmin) {
    const delBtn = document.getElementById("delete-team");
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm("Supprimer définitivement " + team.name + " et tous ses joueurs ?")) return;
      const ok = await run(db.deleteTeam(team.id), "Équipe non supprimée");
      if (!ok) return;
      cur().teams = cur().teams.filter(t => t.id !== team.id);
      clearTeamFromBracket(team.id);
      state.selectedTeamId = null;
      renderAll();
    };
    const logoUpload = document.getElementById("team-logo-upload");
    const logoInput = document.getElementById("team-logo-input");
    if (logoUpload && logoInput) {
      logoUpload.onclick = () => logoInput.click();
      logoInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = await uploadImageOrNull(file, "teams");
        if (!url) return;
        const ok = await run(db.updateTeam(team.id, { logo_url: url }), "Logo non enregistré");
        if (!ok) return;
        team.logo = url;
        renderAll();
      };
    }
  }
}

/* Une équipe supprimée disparaît aussi des confrontations (la base met les
   références à NULL via ON DELETE SET NULL ; on aligne l'état local). */
function clearTeamFromBracket(teamId) {
  const b = cur().bracket;
  ["round16","qf","sf","final"].forEach(round => b[round].forEach(tie => {
    if (tie.teamAId === teamId) tie.teamAId = null;
    if (tie.teamBId === teamId) tie.teamBId = null;
  }));
}

function renderTeamsTab(main) {
  if (state.selectedTeamId) {
    const team = findTeam(state.selectedTeamId);
    if (team) { renderTeamDetail(main, team); return; }
  }
  main.innerHTML = '<div class="section-title"><span class="dot">'+icon("users",16)+'</span>'+esc(compLabel())+' Teams</div><div id="teams-tab-grid"></div>';
  if (cur().teams.length === 0) {
    document.getElementById("teams-tab-grid").innerHTML =
      '<p class="empty-note">Aucune équipe enregistrée pour cette compétition. L\u2019administrateur peut en ajouter depuis le panneau de contrôle.</p>';
    return;
  }
  renderTeamsGrid(cur().teams, document.getElementById("teams-tab-grid"));
}

function renderScorersTab(main) {
  main.innerHTML = '<div class="section-title"><span class="dot">'+icon("crown",16,"#f5c542")+'</span>'+esc(compLabel())+' Top Scorers</div><div id="scorers-tab-list"></div>';
  renderTopScorers(cur().teams, document.getElementById("scorers-tab-list"), state.isAdmin);
}

/* ---------------- RENDU : TABLEAU (onglet admin) ---------------- */
function scoreInputHtml(id, value, disabled) {
  return '<input type="number" min="0" class="score-input" data-id="'+id+'" value="'+(value===null||value===undefined?"":value)+'" placeholder="\u2013" '+(disabled?"disabled":"")+'/>';
}
function teamOptionsHtml(selectedId) {
  return '<option value="">Select team</option>' + cur().teams.map(t => '<option value="'+t.id+'"'+(t.id===selectedId?" selected":"")+'>'+esc(t.name)+'</option>').join("");
}
function renderTieCard(tie, roundLabel) {
  const teamA = findTeam(tie.teamAId), teamB = findTeam(tie.teamBId);
  const needsPen = tieNeedsPenalties(tie);
  const winnerId = tieWinnerId(tie);
  const agg = tieAggregate(tie);
  const isAdmin = state.isAdmin;

  const div = document.createElement("div");
  div.className = "tie-card";
  div.setAttribute("data-tie", tie.id);
  const legsBlockHtml = tie.isSingleMatch
    ? ('<div style="margin-bottom:'+(needsPen?"10px":"4px")+'"><div class="leg-label first">MATCH</div>' +
      '<div class="leg-row">' +
        '<div class="leg-team">'+crestHtml(teamA||"?",26)+'<span>'+esc(teamA?teamA.name:"TBD")+'</span></div>' +
        scoreInputHtml("leg1-scoreA", tie.leg1.scoreA, !isAdmin) +
        '<span class="v-label">V</span>' +
        scoreInputHtml("leg1-scoreB", tie.leg1.scoreB, !isAdmin) +
        '<div class="leg-team right"><span>'+esc(teamB?teamB.name:"TBD")+'</span>'+crestHtml(teamB||"?",26)+'</div>' +
      '</div></div>')
    : ('<div style="margin-bottom:10px"><div class="leg-label first">FIRST LEG</div>' +
      '<div class="leg-row">' +
        '<div class="leg-team">'+crestHtml(teamA||"?",26)+'<span>'+esc(teamA?teamA.name:"TBD")+'</span></div>' +
        scoreInputHtml("leg1-scoreA", tie.leg1.scoreA, !isAdmin) +
        '<span class="v-label">V</span>' +
        scoreInputHtml("leg1-scoreB", tie.leg1.scoreB, !isAdmin) +
        '<div class="leg-team right"><span>'+esc(teamB?teamB.name:"TBD")+'</span>'+crestHtml(teamB||"?",26)+'</div>' +
      '</div></div>' +
      '<div style="margin-bottom:'+(needsPen?"10px":"4px")+'"><div class="leg-label second">SECOND LEG</div>' +
      '<div class="leg-row">' +
        '<div class="leg-team">'+crestHtml(teamA||"?",26)+'<span>'+esc(teamA?teamA.name:"TBD")+'</span></div>' +
        scoreInputHtml("leg2-scoreA", tie.leg2.scoreA, !isAdmin) +
        '<span class="v-label">V</span>' +
        scoreInputHtml("leg2-scoreB", tie.leg2.scoreB, !isAdmin) +
        '<div class="leg-team right"><span>'+esc(teamB?teamB.name:"TBD")+'</span>'+crestHtml(teamB||"?",26)+'</div>' +
      '</div></div>');
  div.innerHTML =
    '<div class="tie-round-label">'+esc(roundLabel)+'</div>' +
    (isAdmin ? (
      '<select class="tie-select" data-role="teamA">'+teamOptionsHtml(tie.teamAId)+'</select>' +
      '<select class="tie-select" data-role="teamB">'+teamOptionsHtml(tie.teamBId)+'</select>'
    ) : "") +
    legsBlockHtml +
    (needsPen ? (
      '<div class="pen-block"><div class="pen-label">PENALTY SHOOTOUT</div>' +
      '<div class="pen-row">' + scoreInputHtml("pen-scoreA", tie.penalties.scoreA, !isAdmin) + '<span class="v-label">PENS</span>' + scoreInputHtml("pen-scoreB", tie.penalties.scoreB, !isAdmin) + '</div></div>'
    ) : "") +
    (agg ? (
      '<div class="tie-agg">'+(tie.isSingleMatch ? "Score" : "Aggregate")+': <b>'+agg.aggA+' \u2013 '+agg.aggB+'</b>' +
      (winnerId && findTeam(winnerId) ? '<div class="tie-winner">'+esc(findTeam(winnerId).name)+' qualifies</div>' : '') +
      '</div>'
    ) : "");

  if (isAdmin) {
    const setAndSave = (fn) => { fn(); advanceWinners(); queueBracketSave(state.competition); rerenderBracket(); };
    div.querySelector('[data-role="teamA"]').onchange = (e) => setAndSave(() => { tie.teamAId = e.target.value || null; });
    div.querySelector('[data-role="teamB"]').onchange = (e) => setAndSave(() => { tie.teamBId = e.target.value || null; });
    div.querySelector('[data-id="leg1-scoreA"]').oninput = (e) => setAndSave(() => { tie.leg1.scoreA = num(e.target.value); });
    div.querySelector('[data-id="leg1-scoreB"]').oninput = (e) => setAndSave(() => { tie.leg1.scoreB = num(e.target.value); });
    const leg2A = div.querySelector('[data-id="leg2-scoreA"]');
    const leg2B = div.querySelector('[data-id="leg2-scoreB"]');
    if (leg2A) leg2A.oninput = (e) => setAndSave(() => { tie.leg2.scoreA = num(e.target.value); });
    if (leg2B) leg2B.oninput = (e) => setAndSave(() => { tie.leg2.scoreB = num(e.target.value); });
    const penA = div.querySelector('[data-id="pen-scoreA"]');
    const penB = div.querySelector('[data-id="pen-scoreB"]');
    if (penA) penA.oninput = (e) => setAndSave(() => { tie.penalties.scoreA = num(e.target.value); });
    if (penB) penB.oninput = (e) => setAndSave(() => { tie.penalties.scoreB = num(e.target.value); });
  }
  return div;
}
function rerenderBracket() {
  if (state.tab !== "bracket") return;
  const f = captureFocus();
  renderBracketTab(document.getElementById("tab-content"));
  restoreFocus(f);
}
function renderBracketTab(main) {
  main.innerHTML =
    '<div class="section-title"><span class="dot">'+icon("swords",16)+'</span>'+esc(compLabel())+' Match & Bracket</div>' +
    '<p style="color:var(--textDim);font-size:13.5px;margin-top:-8px;margin-bottom:20px">Pick teams for each tie, then enter First Leg and Second Leg scores. If the aggregate ends level, a penalty shootout panel appears automatically.</p>' +
    '<div class="bracket-scroll" id="bracket-scroll"></div>';
  const scroll = document.getElementById("bracket-scroll");
  const rounds = [["round16","Round of 16"],["qf","Quarter-Finals"],["sf","Semi-Finals"],["final","Final"]];
  rounds.forEach(([key,label]) => {
    const col = document.createElement("div");
    col.className = "round-col";
    col.innerHTML = "<h3>"+label+"</h3>";
    cur().bracket[key].forEach(tie => col.appendChild(renderTieCard(tie, label)));
    scroll.appendChild(col);
  });
}

/* ---------------- RENDU : TABLEAU VISUEL (page d'accueil) ---------------- */
function vbScoreInput(idAttr, value, disabled, small) {
  return '<input type="number" min="0" class="score-input" data-vb="'+idAttr+'" value="'+(value===null||value===undefined?"":value)+'" placeholder="-" '+(disabled?"disabled":"")+' style="'+(small?"width:25px;height:23px;font-size:11px":"")+'"/>';
}
function vbTeamHtml(team, align) {
  const t = team || { name: "TBD", logo: null };
  const crest = '<div class="crest-sm crest" style="width:19px;height:19px;font-size:7px'+(t.logo?';background:var(--surfaceAlt);padding:2px':'')+'">'+(t.logo ? '<img src="'+t.logo+'" style="width:100%;height:100%;object-fit:contain;border-radius:4px"/>' : esc(initials(t.name)))+'</div>';
  return '<div class="vb-team'+(align==="right"?" right":"")+'">'+crest+'<span>'+esc(t.name)+'</span></div>';
}
function vbCardHtml(tie, isFinal, x, y) {
  const teamA = findTeam(tie.teamAId), teamB = findTeam(tie.teamBId);
  const needsPen = tieNeedsPenalties(tie);
  const winnerId = tieWinnerId(tie);
  const legsHtml = tie.isSingleMatch
    ? '<div class="vb-leg-line"><span class="leg-tag">MATCH</span>' + vbScoreInput(tie.id+"|leg1|scoreA", tie.leg1.scoreA, !state.isAdmin) + '<span class="colon">:</span>' + vbScoreInput(tie.id+"|leg1|scoreB", tie.leg1.scoreB, !state.isAdmin) + '</div>'
    : '<div class="vb-leg-line"><span class="leg-tag">1ST LEG</span>' + vbScoreInput(tie.id+"|leg1|scoreA", tie.leg1.scoreA, !state.isAdmin) + '<span class="colon">:</span>' + vbScoreInput(tie.id+"|leg1|scoreB", tie.leg1.scoreB, !state.isAdmin) + '</div>' +
      '<div class="vb-leg-line"><span class="leg-tag">2ND LEG</span>' + vbScoreInput(tie.id+"|leg2|scoreA", tie.leg2.scoreA, !state.isAdmin) + '<span class="colon">:</span>' + vbScoreInput(tie.id+"|leg2|scoreB", tie.leg2.scoreB, !state.isAdmin) + '</div>';
  return (
    '<div class="vb-card'+(isFinal?" final":"")+'" data-tie="'+tie.id+'" style="left:'+x+'px;top:'+y+'px">' +
    '<div class="vb-teams-row">' + vbTeamHtml(teamA, "left") + '<span class="vb-vs">VS</span>' + vbTeamHtml(teamB, "right") + '</div>' +
    legsHtml +
    (needsPen ? '<div class="vb-pens-line">PENS ' + vbScoreInput(tie.id+"|pen|scoreA", tie.penalties.scoreA, !state.isAdmin, true) + '<span class="colon">:</span>' + vbScoreInput(tie.id+"|pen|scoreB", tie.penalties.scoreB, !state.isAdmin, true) + '</div>' : '') +
    (winnerId && findTeam(winnerId) ? '<div class="vb-qualified-tag">'+esc(findTeam(winnerId).name)+' qualifies</div>' : '') +
    '</div>'
  );
}
function bindVbInputs(container) {
  if (!state.isAdmin) return;
  container.querySelectorAll('input[data-vb]').forEach(inp => {
    inp.oninput = (e) => {
      const [tieId, legKey, side] = e.target.getAttribute("data-vb").split("|");
      const tie = findTieAnywhere(tieId);
      if (!tie) return;
      const val = num(e.target.value);
      if (legKey === "pen") tie.penalties[side] = val;
      else tie[legKey][side] = val;
      advanceWinners();
      queueBracketSave(state.competition);
      const f = captureFocus();
      renderVisualBracket(document.getElementById("visual-bracket-container"));
      restoreFocus(f);
    };
  });
}
function trophySlotHtml(x, y) {
  const trophy = cur().trophyLogo;
  const inner = trophy ? '<img src="'+trophy+'"/>' : icon("trophy", 26, "var(--textDim)");
  return '<div class="vb-trophy-slot'+(state.isAdmin?" editable":"")+'" id="trophy-upload-slot" style="left:'+x+'px;top:'+y+'px" title="'+(state.isAdmin?"Upload "+compLabel()+" trophy image":"")+'">'+inner+
    (state.isAdmin ? '<input type="file" id="trophy-upload-input" accept="image/*" style="display:none"/>' : '') +
    '</div>';
}

const VB_CARD_W = 208, VB_CARD_H = 110;
function vbBuildLayout() {
  const colX = { r16L: 20, qfL: 300, sfL: 580, final: 860, sfR: 1140, qfR: 1420, r16R: 1700 };
  const r16Ys = [40, 220, 480, 660];
  const qfYs = [130, 570];
  const sfY = 350;
  const finalY = 350;
  return { colX, r16Ys, qfYs, sfY, finalY };
}
function vbElbow(x1, y1, x2, y2, color) {
  const midX = (x1 + x2) / 2;
  return '<path d="M '+x1+' '+y1+' H '+midX+' V '+y2+' H '+x2+'" fill="none" stroke="'+color+'" stroke-width="2"/>';
}
function renderVisualBracket(container) {
  const b = cur().bracket;
  const r16 = b.round16, qf = b.qf, sf = b.sf, final = b.final[0];
  if (!final || r16.length < 8) {
    container.innerHTML =
      '<div class="vb-title-row">'+icon("trophy",22,"var(--primary)")+'<h2 class="vb-title">Tournament Bracket</h2></div>' +
      '<p class="empty-note">Le tableau n\u2019est pas encore initialisé dans la base de données. Exécutez le script supabase/schema.sql, puis rechargez la page.</p>';
    return;
  }
  const L = vbBuildLayout();
  const lineColor = "var(--border)";
  const cardCenterY = VB_CARD_H / 2;

  let cardsHtml = "";
  let linesHtml = "";
  let labelsHtml = "";

  const r16LeftX = L.colX.r16L, r16RightX = L.colX.r16R;
  r16.slice(0,4).forEach((tie,i) => { cardsHtml += vbCardHtml(tie, false, r16LeftX, L.r16Ys[i]); });
  r16.slice(4,8).forEach((tie,i) => { cardsHtml += vbCardHtml(tie, false, r16RightX, L.r16Ys[i]); });
  labelsHtml += '<div class="vb-round-label" style="left:'+r16LeftX+'px;top:10px;width:'+VB_CARD_W+'px">ROUND OF 16</div>';
  labelsHtml += '<div class="vb-round-label" style="left:'+r16RightX+'px;top:10px;width:'+VB_CARD_W+'px">ROUND OF 16</div>';

  const qfLeftX = L.colX.qfL, qfRightX = L.colX.qfR;
  qf.slice(0,2).forEach((tie,i) => { cardsHtml += vbCardHtml(tie, false, qfLeftX, L.qfYs[i]); });
  qf.slice(2,4).forEach((tie,i) => { cardsHtml += vbCardHtml(tie, false, qfRightX, L.qfYs[i]); });
  labelsHtml += '<div class="vb-round-label" style="left:'+qfLeftX+'px;top:100px;width:'+VB_CARD_W+'px">QUARTER-FINALS</div>';
  labelsHtml += '<div class="vb-round-label" style="left:'+qfRightX+'px;top:100px;width:'+VB_CARD_W+'px">QUARTER-FINALS</div>';

  const sfLeftX = L.colX.sfL, sfRightX = L.colX.sfR;
  cardsHtml += vbCardHtml(sf[0], false, sfLeftX, L.sfY);
  cardsHtml += vbCardHtml(sf[1], false, sfRightX, L.sfY);
  labelsHtml += '<div class="vb-round-label" style="left:'+sfLeftX+'px;top:'+(L.sfY-24)+'px;width:'+VB_CARD_W+'px">SEMI-FINALS</div>';
  labelsHtml += '<div class="vb-round-label" style="left:'+sfRightX+'px;top:'+(L.sfY-24)+'px;width:'+VB_CARD_W+'px">SEMI-FINALS</div>';

  const finalX = L.colX.final;
  cardsHtml += vbCardHtml(final, true, finalX, L.finalY);
  const trophyX = finalX + VB_CARD_W/2 - 36;
  cardsHtml += trophySlotHtml(trophyX, L.finalY - 100);
  labelsHtml += '<div class="vb-final-label" style="left:'+finalX+'px;top:'+(L.finalY-22)+'px;width:'+VB_CARD_W+'px">FINAL</div>';

  for (let pair = 0; pair < 2; pair++) {
    const y1 = L.r16Ys[pair*2] + cardCenterY, y2 = L.r16Ys[pair*2+1] + cardCenterY;
    const qfY = L.qfYs[pair] + cardCenterY;
    const x1 = r16LeftX + VB_CARD_W, x2 = qfLeftX;
    linesHtml += vbElbow(x1, y1, x2, qfY, lineColor);
    linesHtml += vbElbow(x1, y2, x2, qfY, lineColor);
  }
  for (let pair = 0; pair < 2; pair++) {
    const y1 = L.r16Ys[pair*2] + cardCenterY, y2 = L.r16Ys[pair*2+1] + cardCenterY;
    const qfY = L.qfYs[pair] + cardCenterY;
    const x1 = r16RightX, x2 = qfRightX + VB_CARD_W;
    linesHtml += vbElbow(x1, y1, x2, qfY, lineColor);
    linesHtml += vbElbow(x1, y2, x2, qfY, lineColor);
  }
  {
    const y1 = L.qfYs[0] + cardCenterY, y2 = L.qfYs[1] + cardCenterY;
    const sfYc = L.sfY + cardCenterY;
    const x1 = qfLeftX + VB_CARD_W, x2 = sfLeftX;
    linesHtml += vbElbow(x1, y1, x2, sfYc, lineColor);
    linesHtml += vbElbow(x1, y2, x2, sfYc, lineColor);
  }
  {
    const y1 = L.qfYs[0] + cardCenterY, y2 = L.qfYs[1] + cardCenterY;
    const sfYc = L.sfY + cardCenterY;
    const x1 = qfRightX, x2 = sfRightX + VB_CARD_W;
    linesHtml += vbElbow(x1, y1, x2, sfYc, lineColor);
    linesHtml += vbElbow(x1, y2, x2, sfYc, lineColor);
  }
  {
    const sfYc = L.sfY + cardCenterY;
    const finYc = L.finalY + cardCenterY;
    linesHtml += vbElbow(sfLeftX + VB_CARD_W, sfYc, finalX, finYc, "var(--primary)");
    linesHtml += vbElbow(sfRightX, sfYc, finalX + VB_CARD_W, finYc, "var(--primary)");
  }

  const canvasWidth = L.colX.r16R + VB_CARD_W + 20;
  const canvasHeight = 820;

  container.innerHTML =
    '<div class="vb-title-row">'+icon("trophy",22,"var(--primary)")+'<h2 class="vb-title">Tournament Bracket</h2></div>' +
    '<p class="vb-subtitle">Scores propagate automatically through the bracket.</p>' +
    '<p class="vb-scroll-hint">'+icon("chevLeft",13)+' Scroll to explore the full bracket '+icon("chevRight",13)+'</p>' +
    '<div class="vb-outer"><div class="vb-canvas" style="width:'+canvasWidth+'px;height:'+canvasHeight+'px">' +
      '<svg class="vb-lines" width="'+canvasWidth+'" height="'+canvasHeight+'">' + linesHtml + '</svg>' +
      labelsHtml + cardsHtml +
    '</div></div>';

  bindVbInputs(container);
  if (state.isAdmin) {
    const slot = document.getElementById("trophy-upload-slot");
    const input = document.getElementById("trophy-upload-input");
    if (slot && input) {
      slot.onclick = () => input.click();
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = await uploadImageOrNull(file, "trophies");
        if (!url) return;
        const ok = await run(db.setSetting("trophy_" + state.competition, url), "Trophée non enregistré");
        if (!ok) return;
        cur().trophyLogo = url;
        renderVisualBracket(container);
      };
    }
  }
}

/* ---------------- RENDU : GESTION DES ÉQUIPES (admin) ---------------- */
function renderManageTeamsTab(main) {
  if (!state.managePlayersTeamId && cur().teams.length) state.managePlayersTeamId = cur().teams[0].id;
  main.innerHTML =
    '<div class="section-title"><span class="dot">'+icon("users",16)+'</span>Manage '+esc(compLabel())+' Teams</div>' +
    (cur().teams.length === 0 ? (
      '<div class="setup-panel">' +
      '<h3>Aucune équipe pour le moment</h3>' +
      '<p class="desc">Ajoutez vos équipes une par une ci-dessous, ou partez des 16 équipes de démonstration du prototype (vous pourrez les renommer ou les supprimer ensuite).</p>' +
      '<button class="btn btn-primary" id="seed-demo-btn">'+icon("plus",15)+' Générer 16 équipes de démonstration</button>' +
      '</div>'
    ) : "") +
    '<div class="panel">' +
    '<h3>Add or remove teams</h3>' +
    '<p class="desc">Currently '+cur().teams.length+' teams registered. Adding a team creates it with 16 blank roster spots ready to edit. The abbreviation (min. 5 characters) is shown under the team name wherever teams are listed.</p>' +
    '<div class="field-row"><input type="text" id="new-team-name" placeholder="Team name"/><input type="text" id="new-team-inst" placeholder="Institution (optional)"/><input type="text" id="new-team-abbr" placeholder="Abbreviation (min. 5 chars)" maxlength="12"/><button class="btn btn-primary" id="add-team-btn">'+icon("plus",15)+' Add team</button></div>' +
    '<div class="manage-list" id="manage-list"></div>' +
    '</div>' +
    '<div class="panel">' +
    '<h3>Manage players</h3>' +
    '<p class="desc">Pick a team, then add players with a name, jersey number, and position.</p>' +
    '<div class="field-row"><select id="mp-team-select" style="flex:1 1 220px"></select></div>' +
    '<div class="field-row">' +
      '<input type="text" id="mp-first" placeholder="First name"/>' +
      '<input type="text" id="mp-last" placeholder="Last name"/>' +
      '<input type="number" id="mp-number" placeholder="Jersey #" style="flex:0 0 90px"/>' +
      '<select id="mp-position" style="flex:0 0 150px">' + POSITIONS.map(p => '<option value="'+p+'">'+p+'</option>').join("") + '</select>' +
      '<button class="btn btn-primary" id="mp-add-btn">'+icon("plus",15)+' Add player</button>' +
    '</div>' +
    '<div class="manage-list" id="mp-player-list" style="max-height:320px"></div>' +
    '</div>';

  const seedBtn = document.getElementById("seed-demo-btn");
  if (seedBtn) seedBtn.onclick = () => seedDemoTeams();

  const list = document.getElementById("manage-list");
  cur().teams.forEach(t => {
    const row = document.createElement("div");
    row.className = "manage-row";
    row.innerHTML = '<div class="left">'+crestHtml(t,28)+'<span>'+esc(t.name)+(t.abbreviation ? ' <span style="color:var(--textDim);font-weight:600">('+esc(t.abbreviation)+')</span>' : '')+'</span></div><button class="icon-btn danger" data-id="'+t.id+'">'+icon("trash",15)+'</button>';
    row.querySelector("button").onclick = async () => {
      if (!confirm("Supprimer " + t.name + " et tous ses joueurs ?")) return;
      const ok = await run(db.deleteTeam(t.id), "Équipe non supprimée");
      if (!ok) return;
      cur().teams = cur().teams.filter(x=>x.id!==t.id);
      clearTeamFromBracket(t.id);
      if (state.managePlayersTeamId === t.id) state.managePlayersTeamId = null;
      renderAll();
    };
    list.appendChild(row);
  });

  document.getElementById("add-team-btn").onclick = async () => {
    const name = document.getElementById("new-team-name").value.trim();
    const inst = document.getElementById("new-team-inst").value.trim();
    const abbr = document.getElementById("new-team-abbr").value.trim().toUpperCase();
    if (!name) return;
    const id = PREFIX[state.competition] + "-t" + Date.now();
    const team = {
      id, name, institution: inst || name,
      abbreviation: abbr || name.slice(0,5).toUpperCase(),
      logo: null, sortOrder: cur().teams.length,
      players: makePlayers(id, Date.now()%1000),
    };
    const ok = await run(db.insertTeam(team, state.competition), "Équipe non ajoutée");
    if (!ok) return;
    await run(db.insertPlayers(team.players, team.id), "Effectif non enregistré");
    cur().teams.push(team);
    renderAll();
  };

  const teamSelect = document.getElementById("mp-team-select");
  teamSelect.innerHTML = cur().teams.map(t => '<option value="'+t.id+'"'+(t.id===state.managePlayersTeamId?" selected":"")+'>'+esc(t.name)+'</option>').join("");
  teamSelect.onchange = (e) => { state.managePlayersTeamId = e.target.value; renderManageTeamsTab(main); };

  const selectedTeam = findTeam(state.managePlayersTeamId);
  const playerList = document.getElementById("mp-player-list");
  if (selectedTeam) {
    if (selectedTeam.players.length === 0) playerList.innerHTML = '<p style="color:var(--textDim);font-size:13px">No players yet on '+esc(selectedTeam.name)+'.</p>';
    selectedTeam.players.forEach(p => {
      const row = document.createElement("div");
      row.className = "manage-row";
      row.innerHTML = '<div class="left"><div class="player-num" style="width:28px;height:28px;font-size:11px">'+p.number+'</div><span>'+esc(p.firstName)+' '+esc(p.lastName)+' <span style="color:var(--textDim);font-weight:600">('+esc(p.position)+')</span></span></div><button class="icon-btn danger" data-id="'+p.id+'">'+icon("trash",15)+'</button>';
      row.querySelector("button").onclick = async () => {
        const ok = await run(db.deletePlayer(p.id), "Joueur non supprimé");
        if (!ok) return;
        selectedTeam.players = selectedTeam.players.filter(x => x.id !== p.id);
        renderManageTeamsTab(main);
      };
      playerList.appendChild(row);
    });
  }
  document.getElementById("mp-add-btn").onclick = async () => {
    if (!selectedTeam) return;
    const firstName = document.getElementById("mp-first").value.trim();
    const lastName = document.getElementById("mp-last").value.trim();
    const number = Number(document.getElementById("mp-number").value) || 0;
    const position = document.getElementById("mp-position").value;
    if (!firstName) return;
    const player = { id: selectedTeam.id+"-p"+Date.now(), firstName, lastName, number, position, goals: 0, sortOrder: selectedTeam.players.length };
    const ok = await run(db.insertPlayers([player], selectedTeam.id), "Joueur non ajouté");
    if (!ok) return;
    selectedTeam.players.push(player);
    renderManageTeamsTab(main);
  };
}

/* Crée les 16 équipes du prototype pour la compétition courante. */
async function seedDemoTeams() {
  const comp = state.competition;
  const names = comp === "HIGH_SCHOOL" ? HS_TEAM_NAMES : UNI_TEAM_NAMES;
  const schools = comp === "HIGH_SCHOOL" ? HS_SCHOOLS : null;
  const prefix = PREFIX[comp];
  const teams = names.map((name, i) => {
    const id = prefix + "-t" + (i+1);
    return {
      id, name, institution: schools ? schools[i] : name,
      abbreviation: name.slice(0,5).toUpperCase(), logo: null, sortOrder: i,
      players: makePlayers(id, i*17+3),
    };
  });

  state.saving = true; updateSaveState();
  const teamRows = teams.map(t => ({
    id: t.id, competition: comp, name: t.name, institution: t.institution,
    abbreviation: t.abbreviation, logo_url: null, sort_order: t.sortOrder,
  }));
  const playerRows = [];
  teams.forEach(t => t.players.forEach(p => playerRows.push({
    id: p.id, team_id: t.id, first_name: p.firstName, last_name: p.lastName,
    number: p.number, position: p.position, goals: p.goals, sort_order: p.sortOrder,
  })));

  const okTeams = await run(sb.from("teams").insert(teamRows), "Équipes de démonstration non créées");
  if (!okTeams) return;
  await run(sb.from("players").insert(playerRows), "Joueurs de démonstration non créés");

  const b = state.data[comp].bracket;
  b.round16.forEach((tie, i) => {
    tie.teamAId = teams[i*2] ? teams[i*2].id : null;
    tie.teamBId = teams[i*2+1] ? teams[i*2+1].id : null;
  });
  await run(db.saveBracket(comp), "Tableau non enregistré");

  state.data[comp].teams = teams;
  toast("16 équipes créées", "success");
  renderAll();
}

/* ---------------- RENDU : CARROUSEL (admin) ---------------- */
function renderSlidersTab(main) {
  const atLimit = cur().sliders.length >= 5;
  main.innerHTML =
    '<div class="section-title"><span class="dot">'+icon("image",16)+'</span>Manage '+esc(compLabel())+' Sliders</div>' +
    '<div class="panel">' +
    '<h3>Homepage slider images</h3>' +
    '<p class="desc">Upload up to 5 images (16:9 recommended) from your gallery to feature in the public homepage slider for '+esc(compLabel())+'. ('+cur().sliders.length+'/5 used)</p>' +
    '<div class="field-row"><input type="text" id="slide-caption" placeholder="Caption (optional)" '+(atLimit?"disabled":"")+'/><button class="btn btn-primary" id="upload-btn" '+(atLimit?"disabled":"")+'>'+icon("image",15)+' Upload image</button><input type="file" id="slide-file" accept="image/*" style="display:none"/></div>' +
    (atLimit ? '<p style="color:var(--accent);font-size:12.5px;margin:-8px 0 14px">Limit reached \u2014 remove an image below to add a new one.</p>' : '') +
    '<div class="slider-grid" id="slider-grid"></div>' +
    '</div>';
  const grid = document.getElementById("slider-grid");
  if (cur().sliders.length === 0) grid.innerHTML = '<p style="color:var(--textDim);font-size:13px;grid-column:1/-1">No images uploaded yet.</p>';
  cur().sliders.forEach(s => {
    const div = document.createElement("div");
    div.className = "slider-thumb";
    div.innerHTML = '<img src="'+s.url+'" alt="'+esc(s.caption||"")+'"/><button class="remove" data-id="'+s.id+'">'+icon("x",13)+'</button>' + (s.caption ? '<div class="cap">'+esc(s.caption)+'</div>' : '');
    div.querySelector(".remove").onclick = async () => {
      const ok = await run(db.deleteSlider(s.id), "Image non supprimée");
      if (!ok) return;
      cur().sliders = cur().sliders.filter(x=>x.id!==s.id);
      renderAll();
    };
    grid.appendChild(div);
  });
  if (!atLimit) {
    document.getElementById("upload-btn").onclick = () => document.getElementById("slide-file").click();
    document.getElementById("slide-file").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (cur().sliders.length >= 5) return;
      const caption = document.getElementById("slide-caption").value;
      const url = await uploadImageOrNull(file, "sliders/" + PREFIX[state.competition]);
      if (!url) return;
      const slide = { id: "slide-"+Date.now(), url, caption };
      const ok = await run(db.insertSlider(slide, state.competition, cur().sliders.length), "Image non enregistrée");
      if (!ok) return;
      cur().sliders.push(slide);
      renderAll();
    };
  }
}

/* ---------------- RENDU : RÉGLAGES (admin) ---------------- */
function socialFieldHtml(key, label, value) {
  return '<div class="field-row" style="align-items:center">' +
    '<div class="social-circle" style="flex-shrink:0">'+icon(key,17)+'</div>' +
    '<input type="text" id="social-input-'+key+'" placeholder="'+label+' URL" value="'+esc(value)+'" style="flex:1"/>' +
    '<button class="btn btn-subtle btn-sm" id="save-social-'+key+'">'+icon("check",14)+'</button>' +
    '</div>';
}
function renderSettingsTab(main) {
  main.innerHTML =
    '<div class="section-title"><span class="dot">'+icon("settings",16)+'</span>Settings</div>' +

    '<div class="panel">' +
    '<h3>Organization branding</h3>' +
    '<p class="desc">This logo and the "National Sports Association" title are shared across both High School and University \u2014 they never change when switching competitions.</p>' +
    '<div style="display:flex;align-items:center;gap:14px">' +
      '<div class="brand-logo-upload editable" id="settings-logo-upload" style="margin:0">' + (state.orgLogo ? '<img src="'+state.orgLogo+'"/>' : icon("shield",26,"var(--textDim)")) + '</div>' +
      '<input type="file" id="settings-logo-input" accept="image/*" style="display:none"/>' +
      '<button class="btn btn-subtle" id="settings-logo-btn">'+icon("camera",14)+' Change logo</button>' +
    '</div>' +
    '</div>' +

    '<div class="panel">' +
    '<h3>Goals icon</h3>' +
    '<p class="desc">Shown next to each player\'s goal count on the Top Scorers page. Shared across both High School and University \u2014 upload once and it applies everywhere.</p>' +
    '<div style="display:flex;align-items:center;gap:14px">' +
      '<div class="brand-logo-upload editable" id="settings-ball-upload" style="margin:0;border-radius:50%">' + (state.ballIcon ? '<img src="'+state.ballIcon+'"/>' : soccerBallIcon(36)) + '</div>' +
      '<input type="file" id="settings-ball-input" accept="image/*" style="display:none"/>' +
      '<button class="btn btn-subtle" id="settings-ball-btn">'+icon("camera",14)+' Change ball icon</button>' +
    '</div>' +
    '</div>' +

    '<div class="panel">' +
    '<h3>Competition edition names</h3>' +
    '<p class="desc">Shown just below the NSA title. This is the only branding element that differs between competitions.</p>' +
    '<div style="margin-bottom:12px"><label style="font-size:12px;color:var(--textDim);display:block;margin-bottom:6px">High School edition name</label><input type="text" id="edition-hs" value="'+esc(state.editions.HIGH_SCHOOL)+'" style="width:100%"/></div>' +
    '<div style="margin-bottom:14px"><label style="font-size:12px;color:var(--textDim);display:block;margin-bottom:6px">University edition name</label><input type="text" id="edition-uni" value="'+esc(state.editions.UNIVERSITY)+'" style="width:100%"/></div>' +
    '<button class="btn btn-primary btn-sm" id="save-editions">'+icon("check",14)+' Save edition names</button>' +
    '</div>' +

    '<div class="panel">' +
    '<h3>Venue address</h3>' +
    '<p class="desc">Shown in the site footer. Shared across both competitions.</p>' +
    '<div class="field-row"><input type="text" id="settings-address" value="'+esc(state.footer.address)+'" style="flex:1"/><button class="btn btn-primary btn-sm" id="save-address">'+icon("check",14)+' Save</button></div>' +
    '</div>' +

    '<div class="panel">' +
    '<h3>Social media links</h3>' +
    '<p class="desc">Paste the URL of each official page. Icons only appear on the public footer once a URL is set. Shared across both competitions.</p>' +
    socialFieldHtml("instagram","Instagram",state.footer.social.instagram) +
    socialFieldHtml("tiktok","TikTok",state.footer.social.tiktok) +
    socialFieldHtml("youtube","YouTube",state.footer.social.youtube) +
    '</div>' +

    '<div class="panel">' +
    '<h3>Compte administrateur</h3>' +
    '<p class="desc">Vous êtes connecté en tant que <b>'+esc(adminEmail || "")+'</b>. Le mot de passe se change depuis le tableau de bord Supabase (Authentication &gt; Users).</p>' +
    '<button class="btn btn-danger btn-sm" id="settings-signout">'+icon("logout",14)+' Se déconnecter</button>' +
    '</div>';

  document.getElementById("settings-logo-btn").onclick = () => document.getElementById("settings-logo-input").click();
  document.getElementById("settings-logo-upload").onclick = () => document.getElementById("settings-logo-input").click();
  document.getElementById("settings-logo-input").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = await uploadImageOrNull(file, "org");
    if (!url) return;
    const ok = await run(db.setSetting("org_logo", url), "Logo non enregistré");
    if (!ok) return;
    state.orgLogo = url;
    renderAll();
  };
  document.getElementById("settings-ball-btn").onclick = () => document.getElementById("settings-ball-input").click();
  document.getElementById("settings-ball-upload").onclick = () => document.getElementById("settings-ball-input").click();
  document.getElementById("settings-ball-input").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = await uploadImageOrNull(file, "icons");
    if (!url) return;
    const ok = await run(db.setSetting("ball_icon", url), "Icône non enregistrée");
    if (!ok) return;
    state.ballIcon = url;
    renderAll();
  };
  document.getElementById("save-editions").onclick = async () => {
    const hs = document.getElementById("edition-hs").value;
    const uni = document.getElementById("edition-uni").value;
    const ok1 = await run(db.setSetting("edition_HIGH_SCHOOL", hs), "Édition non enregistrée");
    const ok2 = await run(db.setSetting("edition_UNIVERSITY", uni), "Édition non enregistrée");
    if (!ok1 || !ok2) return;
    state.editions.HIGH_SCHOOL = hs;
    state.editions.UNIVERSITY = uni;
    toast("Noms d'édition enregistrés", "success");
    renderAll();
  };
  document.getElementById("save-address").onclick = async () => {
    const address = document.getElementById("settings-address").value;
    const ok = await run(db.setSetting("footer_address", address), "Adresse non enregistrée");
    if (!ok) return;
    state.footer.address = address;
    toast("Adresse enregistrée", "success");
    renderAll();
  };
  ["instagram","tiktok","youtube"].forEach(name => {
    const saveBtn = document.getElementById("save-social-"+name);
    if (saveBtn) saveBtn.onclick = async () => {
      const value = document.getElementById("social-input-"+name).value.trim();
      const ok = await run(db.setSetting("social_"+name, value), "Lien non enregistré");
      if (!ok) return;
      state.footer.social[name] = value;
      toast("Lien enregistré", "success");
      renderAll();
    };
  });
  document.getElementById("settings-signout").onclick = async () => {
    await sb.auth.signOut();
    state.isAdmin = false; state.tab = "home"; renderAll();
  };
}

/* ---------------- CONNEXION ADMINISTRATEUR (Supabase Auth) ---------------- */
let adminEmail = null;

function openAdminGate() {
  const root = document.getElementById("admin-gate-root");
  if (root.innerHTML) return;
  root.innerHTML =
    '<div class="admin-gate"><div class="admin-gate-glow"></div><div class="admin-gate-box">' +
    '<div class="admin-gate-head"><div class="admin-gate-icon">'+icon("shield",24)+'</div><div class="admin-gate-eyebrow">NSA CONTROL PANEL</div><div class="admin-gate-title">Administrator sign-in</div></div>' +
    '<form class="admin-gate-form" id="admin-form">' +
    '<div><label>Email</label><input type="email" id="admin-email" placeholder="you@nsa.org" required autofocus/></div>' +
    '<div><label>Password</label><input type="password" id="admin-password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" required/></div>' +
    '<p class="admin-gate-error" id="admin-error" style="display:none"></p>' +
    '<button type="submit" id="admin-submit">Enter control panel</button>' +
    '</form>' +
    '<button class="admin-gate-back" id="admin-back">\u2190 Back to public site</button>' +
    '<p class="admin-gate-hint">Compte créé dans <b>Supabase &gt; Authentication &gt; Users</b>.<br/>Cet écran n\u2019est lié depuis aucune page publique.</p>' +
    '</div></div>';
  document.getElementById("admin-back").onclick = () => {
    root.innerHTML = "";
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname);
  };
  document.getElementById("admin-form").onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById("admin-error");
    const btn = document.getElementById("admin-submit");
    const email = document.getElementById("admin-email").value.trim().toLowerCase();
    const password = document.getElementById("admin-password").value;
    btn.disabled = true; btn.textContent = "Connexion…";
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = "Enter control panel";
    if (error) {
      err.textContent = "Identifiants incorrects.";
      err.style.display = "block";
      return;
    }
    adminEmail = data.user.email;
    state.isAdmin = true;
    root.innerHTML = "";
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname);
    await reloadFromDb();
    renderAll();
  };
}

/* Entrée cachée : taper "nsaadmin" n'importe où sur le site public. */
let keyBuffer = "";
window.addEventListener("keydown", (e) => {
  if (e.key.length === 1) {
    keyBuffer = (keyBuffer + e.key).slice(-10);
    if (keyBuffer.toLowerCase().includes("nsaadmin")) { openAdminGate(); keyBuffer = ""; }
  }
});
/* Entrée cachée mobile : toucher le pied de page plusieurs fois. */
let footerTaps = 0, footerTapTimer = null;
document.addEventListener("DOMContentLoaded", () => {
  const footer = document.getElementById("site-footer");
  footer.addEventListener("click", () => {
    footerTaps++;
    clearTimeout(footerTapTimer);
    footerTapTimer = setTimeout(() => { footerTaps = 0; }, 3000);
    if (footerTaps >= 15) { footerTaps = 0; openAdminGate(); }
  });
});
/* Entrée directe : /#admin */
function checkAdminHash() { if (location.hash === "#admin" && !state.isAdmin) openAdminGate(); }
window.addEventListener("hashchange", checkAdminHash);

/* ---------------- RENDU PRINCIPAL ---------------- */
function renderAll() {
  renderHeader();
  const main = document.getElementById("main");

  const bannerHtml = state.isAdmin
    ? '<div class="admin-banner">'+icon("settings",15)+' Administrator mode \u2014 editing <b>'+esc(compLabel())+'</b> competition. Visitors never see these controls.<span class="save-state" id="save-state">Enregistré</span></div>'
    : "";

  main.innerHTML = bannerHtml + '<div id="tab-content"></div>';
  const content = document.getElementById("tab-content");
  updateSaveState();

  if (state.tab === "home") renderHome(content);
  else if (state.tab === "teams") renderTeamsTab(content);
  else if (state.tab === "scorers") renderScorersTab(content);
  else if (state.tab === "bracket" && state.isAdmin) renderBracketTab(content);
  else if (state.tab === "manage-teams" && state.isAdmin) renderManageTeamsTab(content);
  else if (state.tab === "sliders-admin" && state.isAdmin) renderSlidersTab(content);
  else if (state.tab === "settings" && state.isAdmin) renderSettingsTab(content);
  else renderHome(content);
}

/* ---------------- SYNCHRONISATION TEMPS RÉEL ---------------- */
let reloadTimer = null;
async function reloadFromDb() {
  try { await db.loadAll(); }
  catch (e) { console.error("load", e); toast("Chargement des données impossible : " + (e.message || e), "error"); }
}
function scheduleReload() {
  /* On ignore les événements provoqués par nos propres écritures, et on attend
     que l'admin ait fini de taper avant de rafraîchir son écran. */
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    if (Date.now() - lastLocalWrite < 2000) { scheduleReload(); return; }
    const el = document.activeElement;
    if (el && el.matches && el.matches("input, select")) { scheduleReload(); return; }
    await reloadFromDb();
    renderAll();
  }, 800);
}
function subscribeRealtime() {
  sb.channel("nsa-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "players" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "ties" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "sliders" }, scheduleReload)
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, scheduleReload)
    .subscribe();
}

/* ---------------- DÉMARRAGE ---------------- */
function hideBoot() {
  const boot = document.getElementById("boot-screen");
  boot.classList.add("hidden");
  setTimeout(() => boot.remove(), 350);
}
function bootError(message) {
  document.getElementById("boot-message").innerHTML = message;
}

async function boot() {
  if (!CONFIGURED) {
    bootError('Configuration Supabase manquante.<br/>Renseignez <b>SUPABASE_URL</b> et <b>SUPABASE_ANON_KEY</b> dans <b>assets/config.js</b>.');
    return;
  }
  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData && sessionData.session) {
    state.isAdmin = true;
    adminEmail = sessionData.session.user.email;
  }
  await reloadFromDb();
  renderAll();
  hideBoot();
  checkAdminHash();
  subscribeRealtime();

  sb.auth.onAuthStateChange((event, session) => {
    const wasAdmin = state.isAdmin;
    state.isAdmin = !!session;
    adminEmail = session ? session.user.email : null;
    if (wasAdmin !== state.isAdmin) {
      if (!state.isAdmin) state.tab = "home";
      renderAll();
    }
  });
}

boot();
