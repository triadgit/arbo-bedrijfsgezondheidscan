/*
 * scan.js — funnel-engine voor de Bedrijfsgezondheidscan.
 * Laadt config, rendert schermen, beheert state, vuurt de n8n-webhook (fail-safe)
 * en tekent de roos. De pure scorelogica leeft in scoring.js.
 */
import * as S from './scoring.js';

const CONFIG_FILES = ['questions', 'scoring', 'content', 'settings'];
const RETRY_KEY = 'abc_scan_pending_lead';

const app = {
  questions: [],
  themes: [],
  scoring: null,
  content: null,
  settings: null,
  answers: {},      // id -> {label, score|null}
  contact: {},      // ingevulde lead-gegevens
  quick: [],
  deep: [],
  qi: 0,            // index in de huidige vragenlijst
  mode: 'quick',    // 'quick' | 'deep'
  detailTheme: 'Verzuimbeeld en data',
};

/* ---------- bootstrap ---------- */
async function boot() {
  try {
    const loaded = await Promise.all(
      CONFIG_FILES.map((f) => fetch(`config/${f}.json`).then((r) => r.json()))
    );
    const [q, scoring, content, settings] = loaded;
    app.questions = q.questions;
    app.themes = q.themes;
    app.scoring = scoring;
    app.content = content;
    app.settings = settings;
    app.quick = app.questions.filter((x) => x.phase === 'Quickscan');
    app.deep = app.questions.filter((x) => x.phase === 'Verdieping');
    applyBranding(settings.branding);
    renderStatic();
    bindEvents();
    flushPendingLead();
    // Optionele debug-hook (alleen met ?debug=1): inspecteer de exacte webhook-payload
    // in de console of via window.scanDebug.payload('quickscan_lead'). Niet actief in productie.
    if (new URLSearchParams(location.search).has('debug')) {
      window.scanDebug = { app, payload: buildPayload };
    }
  } catch (err) {
    console.error('Kon de scan niet laden:', err);
    document.getElementById('stage').innerHTML =
      '<div class="card"><h2>Er ging iets mis</h2><p class="lead">De scan kon niet worden geladen. Ververs de pagina of probeer het later opnieuw.</p></div>';
  }
}

function applyBranding(b) {
  if (!b) return;
  const root = document.documentElement.style;
  const map = { primary: '--c-primary', accent: '--c-accent', accent2: '--c-accent2', ink: '--c-ink', muted: '--c-muted', soft: '--c-soft' };
  for (const [k, v] of Object.entries(map)) if (b[k]) root.setProperty(v, b[k]);
}

/* ---------- statische teksten ---------- */
function renderStatic() {
  const c = app.content;
  const intro = c.screens.find((s) => s.id.startsWith('S01')) || {};
  document.getElementById('introLead').textContent =
    'Krijg in 16 korte vragen zicht op twee bepalende knoppen voor grip op verzuim: verzuimbeeld en data, en leidinggevende regie. Direct een stoplichtrapport, daarna desgewenst de volledige verdieping.';
  document.getElementById('introAssure').innerHTML = [
    'Direct een persoonlijk bedrijfsprofiel',
    'Stoplichtscore per thema',
    'Rapport in uw inbox',
  ].map((t) => `<li>${t}</li>`).join('');

  // lead-poort: bullets + velden + AVG
  document.getElementById('gateBullets').innerHTML = [
    'Uw persoonlijke bedrijfsprofiel',
    'Stoplichtscore op verzuimbeeld en regie',
    'Concrete tips bij uw laagste rubriek',
  ].map((t) => `<li>${t}</li>`).join('');
  renderGateFields();
  document.getElementById('gateAvg').innerHTML =
    `Wij vragen geen medische gegevens en gebruiken uw gegevens alleen om uw rapport te sturen en (na toestemming) contact op te nemen. Zie ons <a href="${app.settings.privacy_url}" target="_blank" rel="noopener">privacybeleid</a>.`;

  // advies-links
  for (const id of ['tipsAdvies', 'reportAdvies']) {
    const el = document.getElementById(id);
    if (el) el.href = app.settings.advies_url || '#';
  }
}

/* ---------- generieke schermwissel ---------- */
function show(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active'));
  const el = document.getElementById(screenId);
  el.classList.add('is-active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const heading = el.querySelector('h1, h2');
  if (heading) document.getElementById('srStatus').textContent = heading.textContent;
}

/* ---------- vragen ---------- */
function currentList() {
  return app.mode === 'quick' ? app.quick : app.deep;
}

function renderQuestion() {
  const list = currentList();
  const q = list[app.qi];
  document.getElementById('qPhasePill').textContent = app.mode === 'quick' ? 'Quickscan' : 'Verdieping';
  document.getElementById('qCount').textContent = `Vraag ${app.qi + 1} van ${list.length}`;
  document.getElementById('qProgress').style.width = `${((app.qi + 1) / list.length) * 100}%`;
  document.getElementById('qTheme').textContent = q.theme;
  document.getElementById('qText').textContent = q.text;
  renderAnswers(q.id);
  // animatie opnieuw triggeren
  const card = document.querySelector('#screen-question .qcard');
  card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
}

function renderAnswers(qid) {
  const wrap = document.getElementById('qAnswers');
  wrap.innerHTML = '';
  app.scoring.answers.forEach((a, idx) => {
    const sel = app.answers[qid] && app.answers[qid].label === a.label;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'answer' + (sel ? ' is-selected' : '') + (a.score === null ? ' answer--na' : '');
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', sel ? 'true' : 'false');
    btn.style.setProperty('--i', idx);
    btn.dataset.label = a.label;
    btn.innerHTML = `<span class="answer__dot"></span><span class="answer__label">${a.label}</span>`;
    // Alleen de selectie omzetten (geen heropbouw): voorkomt dat de
    // intro-animatie opnieuw afspeelt en het scherm lijkt te "verspringen".
    btn.addEventListener('click', () => selectAnswer(qid, a));
    wrap.appendChild(btn);
  });
}

function selectAnswer(qid, a) {
  app.answers[qid] = { label: a.label, score: a.score };
  document.querySelectorAll('#qAnswers .answer').forEach((btn) => {
    const on = btn.dataset.label === a.label;
    btn.classList.toggle('is-selected', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

function nextQuestion() {
  const list = currentList();
  const q = list[app.qi];
  if (!app.answers[q.id]) { nudge(document.getElementById('qAnswers')); return; }
  if (app.qi < list.length - 1) {
    app.qi += 1;
    renderQuestion();
  } else if (app.mode === 'quick') {
    show('screen-gate');
  } else {
    finishDeep();
  }
}

function prevQuestion() {
  if (app.qi > 0) { app.qi -= 1; renderQuestion(); }
  else if (app.mode === 'quick') { show('screen-intro'); }
  else { show('screen-tips'); }
}

/* ---------- lead-poort ---------- */
function renderGateFields() {
  const wrap = document.getElementById('gateFields');
  wrap.innerHTML = '';
  app.settings.lead_fields.forEach((f) => {
    const field = document.createElement('div');
    field.className = 'field' + (f.type === 'checkbox' ? ' field--check' : '') + (f.type === 'select' ? '' : '');
    const req = f.required ? ' <span class="req">*</span>' : '';
    if (f.type === 'checkbox') {
      field.innerHTML =
        `<label class="check"><input type="checkbox" id="lf_${f.key}" ${f.required ? 'required' : ''} />
         <span class="check__box"></span><span class="check__label">${f.label}${req}</span></label>
         <p class="field__err" data-for="${f.key}"></p>`;
    } else if (f.type === 'select') {
      const opts = ['<option value="">Kies…</option>']
        .concat((f.options || []).map((o) => `<option value="${o}">${o}</option>`)).join('');
      field.innerHTML =
        `<label for="lf_${f.key}">${f.label}${req}</label>
         <select id="lf_${f.key}" ${f.required ? 'required' : ''}>${opts}</select>
         <p class="field__err" data-for="${f.key}"></p>`;
    } else {
      field.innerHTML =
        `<label for="lf_${f.key}">${f.label}${req}</label>
         <input type="${f.type}" id="lf_${f.key}" autocomplete="${autocompleteFor(f.key)}" ${f.required ? 'required' : ''} />
         <p class="field__err" data-for="${f.key}"></p>`;
    }
    // full breedte voor sommige velden
    if (['organisatie', 'email', 'toestemming'].includes(f.key)) field.classList.add('field--wide');
    wrap.appendChild(field);
  });
}

function autocompleteFor(key) {
  return { organisatie: 'organization', email: 'email', telefoon: 'tel', contactpersoon: 'name' }[key] || 'off';
}

function submitGate(e) {
  e.preventDefault();
  const contact = {};
  let firstErr = null;
  document.querySelectorAll('.field__err').forEach((p) => (p.textContent = ''));
  for (const f of app.settings.lead_fields) {
    const el = document.getElementById(`lf_${f.key}`);
    let val = f.type === 'checkbox' ? el.checked : el.value.trim();
    if (f.required && (f.type === 'checkbox' ? !val : !val)) {
      setErr(f.key, f.type === 'checkbox' ? 'Vink dit aan om door te gaan.' : 'Dit veld is verplicht.');
      firstErr = firstErr || el;
      continue;
    }
    if (f.type === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      setErr(f.key, 'Vul een geldig e-mailadres in.');
      firstErr = firstErr || el;
      continue;
    }
    contact[f.key] = val;
  }
  if (firstErr) { firstErr.focus(); return; }
  app.contact = contact;
  buildProfile();
  sendLead('quickscan_lead');
  show('screen-profile');
}

function setErr(key, msg) {
  const p = document.querySelector(`.field__err[data-for="${key}"]`);
  if (p) p.textContent = msg;
}

/* ---------- profiel + dataduik ---------- */
function buildProfile() {
  const { data, regie } = S.quickscanScores(app.answers, app.questions);
  const route = S.resolveRoute(app.scoring.routes, data, regie);
  const text = app.content.profiles[route.name] || '';
  document.getElementById('profileIcon').textContent = route.icon || '🎯';
  document.getElementById('profileName').textContent = route.name;
  document.getElementById('profileText').textContent = text;
}

function renderData() {
  const { data, regie } = S.quickscanScores(app.answers, app.questions);
  const bars = [
    { theme: 'Verzuimbeeld en data', score: data },
    { theme: 'Leidinggevende regie', score: regie },
  ];
  document.getElementById('dataBars').innerHTML = bars.map((b) => barRow(b.theme, b.score)).join('');
  // animatie + klikbaar
  requestAnimationFrame(() => {
    document.querySelectorAll('#dataBars .bar__fill').forEach((el) => (el.style.width = el.dataset.w + '%'));
  });
  document.querySelectorAll('#dataBars .barrow').forEach((row) => {
    row.addEventListener('click', () => openDetail(row.dataset.theme));
  });
  const worst = S.laagsteRubriek(data, regie);
  const overall = Math.round((data + regie) / 2);
  document.getElementById('dataSummary').innerHTML =
    `<span class="badge badge--${S.stoplichtKey(overall)}">${S.stoplicht(overall)}</span>
     <p>De meeste aandacht gaat naar <strong>${worst}</strong>. Gebruik de verdieping om oorzaken en passende acties scherper te bepalen.</p>`;
}

function barRow(theme, score) {
  const key = S.stoplichtKey(score);
  return `<button type="button" class="barrow" data-theme="${theme}">
    <div class="barrow__head"><span>${theme}</span><span class="barrow__pct">${score}%</span></div>
    <div class="bar"><div class="bar__fill bar__fill--${key}" data-w="${score}"></div></div>
    <span class="barrow__hint">Bekijk uitleg &rarr;</span>
  </button>`;
}

function openDetail(theme) {
  app.detailTheme = theme;
  const score = S.avgForTheme(app.answers, app.questions, theme, 'Quickscan');
  const key = S.stoplichtKey(score);
  document.getElementById('detailTitle').textContent = `${theme} — ${score}%`;
  const badge = document.getElementById('detailBadge');
  badge.className = `badge badge--${key}`;
  badge.textContent = S.stoplicht(score);
  document.getElementById('detailBody').textContent = app.content.theme_detail[theme] || '';
  const fill = document.getElementById('detailBar');
  fill.className = `bar__fill bar__fill--${key}`;
  fill.style.width = '0%';
  show('screen-detail');
  requestAnimationFrame(() => (fill.style.width = score + '%'));
}

/* ---------- tips ---------- */
function renderTips() {
  const { data, regie } = S.quickscanScores(app.answers, app.questions);
  const worst = S.laagsteRubriek(data, regie);
  const tips = app.content.tips[worst] || [];
  document.getElementById('tipsLead').textContent =
    `Deze acties passen bij uw laagst scorende rubriek (${worst}). Kies er één of twee en probeer ze de komende 30 dagen uit.`;
  document.getElementById('tipsGrid').innerHTML = tips.map((t, i) =>
    `<article class="tip" style="--i:${i}">
       <span class="tip__num">${i + 1}</span>
       <h3>${t.kop}</h3><p>${t.tekst}</p>
     </article>`).join('');
  const mail = app.contact.email ? ` naar <strong>${escapeHtml(app.contact.email)}</strong>` : '';
  document.getElementById('tipsCtaText').innerHTML =
    `Uw volledige rapport is onderweg${mail}. Wilt u het hele beeld? Maak de diagnose compleet met de verdieping en ontvang de volledige roos met al uw aandachtsgebieden.`;
}

/* ---------- verdieping ---------- */
function startDeep() {
  app.mode = 'deep';
  app.qi = 0;
  renderQuestion();
  show('screen-question');
}

function finishDeep() {
  drawRadar();
  show('screen-report');
  sendLead('verdieping_compleet');
}

/* ---------- roos / radar ---------- */
function reportRubrics() {
  return S.rubricScores(app.answers, app.questions, app.scoring.rubrics, null);
}

function drawRadar() {
  const data = reportRubrics();
  const canvas = document.getElementById('radar');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width, H = canvas.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2 + 6, R = Math.min(W, H) / 2 - 96, n = data.length;
  const css = getComputedStyle(document.documentElement);
  const primary = css.getPropertyValue('--c-primary').trim() || '#ec641a';
  const ink = css.getPropertyValue('--c-ink').trim() || '#4c505a';

  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  // ringen
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const rr = (R * ring) / 4, x = cx + Math.cos(ang(i)) * rr, y = cy + Math.sin(ang(i)) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(76,80,90,.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // assen
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang(i)) * R, cy + Math.sin(ang(i)) * R);
    ctx.strokeStyle = 'rgba(76,80,90,.08)';
    ctx.stroke();
  }
  const poly = (vals, stroke, fill, dash = []) => {
    ctx.beginPath();
    vals.forEach((v, i) => {
      const rr = (R * v) / 100, x = cx + Math.cos(ang(i)) * rr, y = cy + Math.sin(ang(i)) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.setLineDash(dash);
    ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.setLineDash([]);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  };
  // normlijn 80 (gestippeld) + scores (oranje vlak)
  poly(data.map(() => app.scoring.norm || 80), 'rgba(104,108,124,.55)', 'rgba(104,108,124,.05)', [5, 5]);
  poly(data.map((d) => d.score), primary, 'rgba(236,100,26,.16)');
  // punten
  data.forEach((d, i) => {
    const rr = (R * d.score) / 100, x = cx + Math.cos(ang(i)) * rr, y = cy + Math.sin(ang(i)) * rr;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = primary; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  });
  // labels
  ctx.font = '600 12px Lato, system-ui, sans-serif';
  ctx.fillStyle = ink;
  data.forEach((d, i) => {
    const a = ang(i), lx = cx + Math.cos(a) * (R + 34), ly = cy + Math.sin(a) * (R + 34);
    ctx.textAlign = lx < cx - 4 ? 'right' : lx > cx + 4 ? 'left' : 'center';
    ctx.textBaseline = 'middle';
    const short = shortTheme(d.theme);
    ctx.fillText(`${short} ${d.score}%`, lx, ly);
  });

  // prioriteiten + adviesroute
  const top = S.topPriorities(data, 3);
  document.getElementById('prioList').innerHTML = top.map((p) =>
    `<li><span class="prio__bullet badge--${p.stoplichtKey}"></span>
       <div><strong>${p.theme}</strong><span class="prio__meta">Score ${p.score}%, ${p.aandachtsscore} punten onder de norm</span></div></li>`).join('');

  const { data: dScore, regie } = S.quickscanScores(app.answers, app.questions);
  const route = S.resolveRoute(app.scoring.routes, dScore, regie);
  const overall = reportOverall(data);
  const key = overall >= 75 ? 'groen' : overall >= 55 ? 'oranje' : 'rood';
  const rep = app.content.report_texts[`overall ${key === 'groen' ? 'groen' : key === 'oranje' ? 'oranje' : 'rood'}`];
  document.getElementById('reportRouteTitle').textContent = route.name;
  document.getElementById('reportRouteText').textContent = rep ? rep.tekst : '';
}

function reportOverall(rubrics) {
  if (!rubrics.length) return 0;
  return Math.round(rubrics.reduce((a, b) => a + b.score, 0) / rubrics.length);
}

function shortTheme(theme) {
  const map = {
    'Verzuimbeeld en data': 'Verzuimdata',
    'Leidinggevende regie': 'Regie',
    'Beleid, proces en Poortwachter': 'Beleid',
    'Preventie en werkbelasting': 'Preventie',
    'Medewerker en cultuur': 'Cultuur',
    'Arbodienst, adviseurs en samenwerking': 'Arbodienst',
    'Kosten, verzekering en risico': 'Kosten',
    'Vitaliteit en duurzame inzetbaarheid': 'Vitaliteit',
    'Governance en verbetering': 'Governance',
  };
  return map[theme] || theme.split(' ')[0];
}

/* ---------- webhook (fail-safe) ---------- */
function buildPayload(event) {
  const { data, regie, overall } = S.quickscanScores(app.answers, app.questions);
  const route = S.resolveRoute(app.scoring.routes, data, regie);
  const worst = S.laagsteRubriek(data, regie);
  const oKey = overall >= 75 ? 'groen' : overall >= 55 ? 'oranje' : 'rood';
  const dKey = data >= 75 ? 'groen' : data >= 55 ? 'oranje' : 'rood';
  const rKey = regie >= 75 ? 'groen' : regie >= 55 ? 'oranje' : 'rood';
  const rt = app.content.report_texts;
  const base = {
    event,
    timestamp: new Date().toISOString(),
    meta: { url: location.href, taal: document.documentElement.lang || 'nl' },
    contact: app.contact,
  };
  if (event === 'quickscan_lead') {
    return {
      ...base,
      quickscan: {
        data_score: data, regie_score: regie, overall,
        profiel: { route: route.id, naam: route.name, tekst: app.content.profiles[route.name] || '', icoon: route.icon },
        stoplicht: { data: S.stoplicht(data), regie: S.stoplicht(regie) },
        laagste_rubriek: worst,
        rapportageteksten: {
          overall: rt[`overall ${oKey}`] || null,
          data: rt[`verzuimbeeld en data ${dKey}`] || null,
          regie: rt[`leidinggevende regie ${rKey}`] || null,
        },
        tips: app.content.tips[worst] || [],
        antwoorden: S.answeredList(app.answers, app.questions, 'Quickscan'),
      },
    };
  }
  // verdieping_compleet
  const rubrieken = reportRubrics();
  const overallDeep = reportOverall(rubrieken);
  return {
    ...base,
    eindrapport: {
      overall: overallDeep,
      stoplicht: S.stoplicht(overallDeep),
      adviesroute: route.id,
      rubrieken,
      top3_prioriteiten: S.topPriorities(rubrieken, 3).map((p) => ({ thema: p.theme, score: p.score, aandachtsscore: p.aandachtsscore })),
      antwoorden: S.answeredList(app.answers, app.questions, null),
    },
  };
}

function sendLead(event) {
  if (!app.settings.webhook_enabled || !app.settings.webhook_url) {
    console.info('[scan] webhook uitgeschakeld; payload:', buildPayload(event));
    return;
  }
  const payload = buildPayload(event);
  post(payload).catch(() => stashPending(payload));
}

function post(payload) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  return fetch(app.settings.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
    signal: ctrl.signal,
  }).then((r) => { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); });
}

function stashPending(payload) {
  try {
    const arr = JSON.parse(localStorage.getItem(RETRY_KEY) || '[]');
    arr.push(payload);
    localStorage.setItem(RETRY_KEY, JSON.stringify(arr.slice(-5)));
  } catch (_) { /* opslag vol of geblokkeerd: stil falen, funnel gaat door */ }
}

function flushPendingLead() {
  if (!app.settings.webhook_enabled || !app.settings.webhook_url) return;
  let arr;
  try { arr = JSON.parse(localStorage.getItem(RETRY_KEY) || '[]'); } catch (_) { return; }
  if (!arr.length) return;
  localStorage.removeItem(RETRY_KEY);
  arr.forEach((p) => post(p).catch(() => stashPending(p)));
}

/* ---------- helpers ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- micro-interactie ---------- */
function nudge(el) {
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}

/* ---------- events ---------- */
function bindEvents() {
  document.getElementById('startQuick').addEventListener('click', () => {
    app.mode = 'quick'; app.qi = 0; renderQuestion(); show('screen-question');
  });
  document.getElementById('qNext').addEventListener('click', nextQuestion);
  document.getElementById('qPrev').addEventListener('click', prevQuestion);
  document.getElementById('gateForm').addEventListener('submit', submitGate);
  document.getElementById('profileNext').addEventListener('click', () => { renderData(); show('screen-data'); });
  document.getElementById('dataBack').addEventListener('click', () => show('screen-profile'));
  document.getElementById('dataTips').addEventListener('click', () => { renderTips(); show('screen-tips'); });
  document.getElementById('detailBack').addEventListener('click', () => { renderData(); show('screen-data'); });
  document.getElementById('detailTips').addEventListener('click', () => { renderTips(); show('screen-tips'); });
  document.getElementById('startDeep').addEventListener('click', startDeep);
}

boot();
