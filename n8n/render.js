/*
 * render.js — bouwt de PDF-HTML (tussenrapport + eindrapport) uit de webhook-payload.
 * Opmaak is 1-op-1 de Claude Design-templates; dynamische velden, stoplichtkleuren en
 * de roos worden hier uit de echte scores ingevuld. Logo via de live-URL (Gotenberg/
 * Chromium haalt 'm op), zodat de HTML klein blijft.
 *
 * Gebruik in n8n (Code-node):
 *   const html = renderReport($json.body);   // kiest tussen- of eindrapport op `event`
 * Lokaal testen:
 *   node render.js   // rendert sample-payload.json naar /tmp/*.html
 */

const LOGO = 'https://www.arboconcern.nl/bestanden/arboconcern-logo.svg';
const NORM = 80;
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
  'augustus', 'september', 'oktober', 'november', 'december'];

/* ---------- helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
// echte stoplichtlogica (zelfde banden als scoring.js): >=75 groen, 55-74 oranje, <55 rood
function stKey(s) { return s >= 75 ? 'groen' : s >= 55 ? 'oranje' : 'rood'; }
function stSolid(s) { return { groen: '#4bb3a6', oranje: '#ec641a', rood: '#6b6f7e' }[stKey(s)]; }
function stText(s) { return { groen: '#3a9a8f', oranje: '#ec641a', rood: '#6b6f7e' }[stKey(s)]; }
function stBar(s) {
  return { groen: 'linear-gradient(90deg,#6fc3b8,#4bb3a6)', oranje: 'linear-gradient(90deg,#f08b4c,#ec641a)', rood: 'linear-gradient(90deg,#868a98,#6b6f7e)' }[stKey(s)];
}
function statusWord(s) { return { groen: 'Op koers', oranje: 'Aandacht', rood: 'Prioriteit' }[stKey(s)]; }

// korte rubrieklabels voor de roos + tabel (full theme -> kort)
const SHORT = {
  'Verzuimbeeld en data': 'Verzuimbeeld en data',
  'Leidinggevende regie': 'Leidinggevende regie',
  'Beleid, proces en Poortwachter': 'Beleid en Poortwachter',
  'Preventie en werkbelasting': 'Preventie en werkbelasting',
  'Medewerker en cultuur': 'Medewerker en cultuur',
  'Arbodienst, adviseurs en samenwerking': 'Arbodienst en samenwerking',
  'Kosten, verzekering en risico': 'Kosten en risico',
  'Vitaliteit en duurzame inzetbaarheid': 'Vitaliteit en inzetbaarheid',
  'Governance en verbetering': 'Governance en verbetering',
};
const SHORT_DEF = (t) => SHORT[t] || t;

/* gedeelde stukjes */
const HEAD = (titel) => `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;500;600;700&family=Lato:wght@400;700;900&display=swap" rel="stylesheet">
<title>${esc(titel)}</title>
<style>*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:#e7e8ea;font-family:'Lato',sans-serif;color:#4c505a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{width:210mm;min-height:297mm;margin:0 auto 22px;background:#fff;position:relative;overflow:hidden;box-shadow:0 14px 44px rgba(40,44,54,.16)}
@page{size:A4;margin:0}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;break-after:page}.sheet:last-child{break-after:auto}}</style></head><body>`;
const TAIL = `</body></html>`;

const dotrow = (lbl) => `<div style="display:flex;align-items:center;gap:9px;"><span style="display:flex;gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:#4bb3a6;"></span><span style="width:6px;height:6px;border-radius:50%;background:#ec641a;"></span><span style="width:6px;height:6px;border-radius:50%;background:#6b6f7e;"></span></span><span style="font-family:'Lato',sans-serif;font-weight:700;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#9a9ea8;">${lbl}</span></div>`;
const pageFooter = (org, datum, paginas, tag) => `<footer style="display:flex;justify-content:space-between;align-items:center;padding-top:13px;border-top:1px solid #edeef0;">${dotrow('Bedrijfsgezondheidscan')}<div style="display:flex;align-items:center;gap:13px;"><span style="font-family:'Lato',sans-serif;font-size:11px;color:#aeb2bb;">${esc(org)} &middot; ${esc(datum)}</span><span style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:10.5px;color:#4ba39c;background:rgba(121,198,222,.18);border-radius:20px;padding:5px 12px;">${paginas}</span></div></footer>`;
const innerHeader = (tag) => `<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:11px;border-bottom:1px solid #edeef0;"><img src="${LOGO}" alt="arboconcern" style="height:20px;width:auto;display:block;"><div style="font-family:'Lato',sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#aeb2bb;">${tag}</div></div>`;
// 3-dot profielbadge met de actieve kleur opgelicht
function profileBadge(score, size) {
  const k = stKey(score);
  const dot = (c, on) => `<span style="width:${size}px;height:${size}px;border-radius:50%;background:${c};${on ? `box-shadow:0 0 0 ${size > 30 ? 7 : 4}px ${c}2e;` : ''}"></span>`;
  return `${dot('#4bb3a6', k === 'groen')}${dot('#ec641a', k === 'oranje')}${dot('#6b6f7e', k === 'rood')}`;
}

/* ---------- roos-SVG, herberekend uit de 9 rubriekscores ---------- */
const CX = 500, CY = 415, R = 225;
const LABELS = [
  { x: 500.0, a: 'middle', l: ['Verzuimbeeld', 'en data'] },
  { x: 657.5, a: 'start', l: ['Leidinggevende', 'regie'] },
  { x: 741.3, a: 'start', l: ['Beleid en', 'Poortwachter'] },
  { x: 712.2, a: 'start', l: ['Preventie en', 'werkbelasting'] },
  { x: 583.8, a: 'start', l: ['Medewerker', 'en cultuur'] },
  { x: 416.2, a: 'end', l: ['Arbodienst en', 'samenwerking'] },
  { x: 287.8, a: 'end', l: ['Kosten', 'en risico'] },
  { x: 258.7, a: 'end', l: ['Vitaliteit en', 'inzetbaarheid'] },
  { x: 342.5, a: 'end', l: ['Governance en', 'verbetering'] },
];
const LABEL_Y = [142.0, 199.3, 356.5, 551.5, 659.2, 659.2, 551.5, 356.5, 199.3];
function pt(score, i, radius) {
  const ang = (-90 + i * 40) * Math.PI / 180;
  const r = radius * (score / 100);
  return [(CX + Math.cos(ang) * r).toFixed(1), (CY + Math.sin(ang) * r).toFixed(1)];
}
function ringPoly(pct, stroke, extra = '') {
  const pts = LABELS.map((_, i) => pt(pct, i, R).join(',')).join(' ');
  return `<polygon points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5" ${extra}/>`;
}
// compacte, label-loze roos voor de cover (uitgesneden om het scorevlak)
function buildRoosMini(rubrieken) {
  const byTheme = {}; rubrieken.forEach((r) => (byTheme[r.theme] = r.score));
  const scores = Object.keys(SHORT).map((t) => byTheme[t] ?? 0);
  let svg = `<svg viewBox="268 183 464 464" width="146" height="146" xmlns="http://www.w3.org/2000/svg">`;
  [50, 100].forEach((p) => (svg += ringPoly(p, '#e3e6e9', 'stroke-width="2"')));
  svg += `<polygon points="${LABELS.map((_, i) => pt(NORM, i, R).join(',')).join(' ')}" fill="none" stroke="#79c6c0" stroke-width="2.5" stroke-dasharray="3 6" stroke-linejoin="round"/>`;
  svg += `<polygon points="${scores.map((s, i) => pt(s, i, R).join(',')).join(' ')}" fill="#ec641a" fill-opacity="0.16" stroke="#ec641a" stroke-width="3" stroke-linejoin="round"/>`;
  svg += `</svg>`;
  return svg;
}
function buildRoosSvg(rubrieken) {
  // rubrieken in canonieke volgorde; val terug op 0 als een rubriek ontbreekt
  const byTheme = {};
  rubrieken.forEach((r) => (byTheme[r.theme] = r.score));
  const order = Object.keys(SHORT);
  const scores = order.map((t) => byTheme[t] ?? 0);

  let svg = `<svg viewBox="0 0 1000 830" style="display:block;width:100%;max-width:660px;max-height:505px;margin:0 auto;" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="#fafbfc"/>`;
  // ringen 25/50/75/100
  [25, 50, 75, 100].forEach((p) => (svg += ringPoly(p, '#e7e9ec')));
  // assen
  LABELS.forEach((_, i) => { const [x, y] = pt(100, i, R); svg += `<line x1="${CX}" y1="${CY}" x2="${x}" y2="${y}" stroke="#e7e9ec" stroke-width="1.5"/>`; });
  // gridcijfers langs de bovenas
  [[25, 362.8], [50, 306.5], [75, 250.3], [100, 194.0]].forEach(([n, y]) => (svg += `<text x="508.0" y="${y}" font-family="Lato, sans-serif" font-size="12" fill="#c2c6cd">${n}</text>`));
  // normlijn 80 (gestippeld teal)
  svg += `<polygon points="${LABELS.map((_, i) => pt(NORM, i, R).join(',')).join(' ')}" fill="none" stroke="#79c6c0" stroke-width="2" stroke-dasharray="3 5" stroke-linejoin="round"/>`;
  // scorevlak
  const sp = scores.map((s, i) => pt(s, i, R).join(',')).join(' ');
  svg += `<polygon points="${sp}" fill="#ec641a" fill-opacity="0.15" stroke="#ec641a" stroke-width="2.5" stroke-linejoin="round"/>`;
  // punten per as, gekleurd op stoplicht
  scores.forEach((s, i) => { const [x, y] = pt(s, i, R); svg += `<circle cx="${x}" cy="${y}" r="5" fill="${stSolid(s)}" stroke="#fff" stroke-width="1.5"/>`; });
  // labels met % en kleur
  scores.forEach((s, i) => {
    const L = LABELS[i], y = LABEL_Y[i];
    svg += `<text x="${L.x}" y="${y}" text-anchor="${L.a}" font-family="Lato, sans-serif" font-size="15.5" font-weight="700" fill="#4c505a"><tspan x="${L.x}">${esc(L.l[0])}</tspan><tspan x="${L.x}" dy="16.5">${esc(L.l[1])}</tspan><tspan x="${L.x}" dy="17.5" font-family="Comfortaa, sans-serif" font-size="15" font-weight="700" fill="${stText(s)}">${s}%</tspan></text>`;
  });
  svg += `</svg>`;
  return svg;
}

/* ---------- TUSSENRAPPORT ---------- */
function renderTussenrapport(p) {
  const c = p.contact || {};
  const q = p.quickscan || {};
  const org = c.organisatie || 'Uw organisatie';
  const datum = fmtDate(p.timestamp);
  const data = q.data_score ?? 0, regie = q.regie_score ?? 0;
  const overall = q.overall ?? Math.round((data + regie) / 2);
  const prof = q.profiel || {};
  const worst = q.laagste_rubriek || 'Verzuimbeeld en data';
  const tips = (q.tips || []).slice(0, 4);
  const scoreBar = (label, s) => `<div style="margin-bottom:18px;"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:11px;"><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:16px;color:#4c505a;">${esc(label)}</div><div style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:27px;color:${stText(s)};line-height:1;">${s}<span style="font-size:17px;">%</span></div></div><div style="position:relative;height:16px;background:#eef0f2;border-radius:10px;"><div style="position:absolute;left:0;top:0;bottom:0;width:${s}%;background:${stBar(s)};border-radius:10px;"></div><div style="position:absolute;left:80%;top:-6px;bottom:-6px;border-left:2px dashed #79c6c0;"></div></div></div>`;
  const tipCard = (t, i) => `<div style="background:#fff;border:1px solid #edeef0;border-radius:16px;padding:22px;break-inside:avoid;box-shadow:0 6px 16px rgba(76,80,90,.04);"><div style="width:42px;height:42px;border-radius:12px;background:#ec641a;color:#fff;font-family:'Comfortaa',sans-serif;font-weight:700;font-size:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 7px 16px rgba(236,100,26,.28);margin-bottom:14px;">${i + 1}</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:17px;color:#4c505a;margin-bottom:7px;">${esc(t.kop)}</div><p style="margin:0;font-family:'Lato',sans-serif;font-size:14px;line-height:1.58;color:#686c7c;">${esc(t.tekst)}</p></div>`;

  return HEAD('Stoplicht-tussenrapport') +
  // PAGE 1 — COVER
  `<section class="sheet" style="display:flex;flex-direction:column;padding:22mm 22mm 0;">
    <div aria-hidden="true" style="position:absolute;top:-150px;right:-150px;width:440px;height:440px;border-radius:50%;background:radial-gradient(circle at 36% 36%,rgba(133,206,228,.34),rgba(121,198,192,.10) 70%);"></div>
    <div aria-hidden="true" style="position:absolute;bottom:150px;left:-100px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(236,100,26,.07),rgba(236,100,26,0) 70%);"></div>
    <header style="position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-start;"><div style="line-height:1;"><img src="${LOGO}" alt="arboconcern" style="height:54px;width:auto;display:block;"></div><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:2.5px;color:#9a9ea8;text-transform:uppercase;border:1px solid #e7e9ec;border-radius:30px;padding:9px 18px;">Bedrijfsgezondheidscan</div></header>
    <div style="position:relative;z-index:1;flex:1;display:flex;align-items:center;gap:40px;">
      <div style="flex:1;"><div style="display:inline-block;font-family:'Lato',sans-serif;font-weight:700;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#4ba39c;background:rgba(121,198,192,.16);border-radius:30px;padding:8px 18px;margin-bottom:22px;">Stoplicht&#8209;tussenrapport</div>
      <h1 style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:54px;line-height:1.06;letter-spacing:-1.5px;color:#4c505a;margin:0;">Hoe gezond is<br>uw bedrijf?</h1>
      <p style="font-family:'Lato',sans-serif;font-size:16px;line-height:1.6;color:#686c7c;margin:22px 0 0;max-width:430px;">Een eerste beeld van uw verzuim, regie en preventie, in één oogopslag met het stoplicht.</p></div>
      <div style="flex:none;width:118px;background:#f7f8f9;border:1px solid #edeef0;border-radius:64px;padding:22px 0;display:flex;flex-direction:column;align-items:center;gap:20px;box-shadow:inset 0 2px 10px rgba(76,80,90,.05);">${profileBadge(overall, 58)}</div>
    </div>
    <footer style="position:relative;z-index:1;padding:24px 0 30px;border-top:1px solid #edeef0;margin-top:10px;display:flex;gap:70px;"><div><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#aeb2bb;margin-bottom:7px;">Opgesteld voor</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:19px;color:#4c505a;">${esc(org)}</div></div><div><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#aeb2bb;margin-bottom:7px;">Datum</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:19px;color:#4c505a;">${esc(datum)}</div></div></footer>
    <div aria-hidden="true" style="position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg,#79c6c0,#85cee4 45%,#ec641a);"></div>
  </section>` +
  // PAGE 2 — PROFIEL + SCORES + UITLEG
  `<section class="sheet" style="display:flex;flex-direction:column;padding:16mm 18mm 13mm;">${innerHeader('Stoplicht-tussenrapport')}
    <main style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:28px;">
      <section><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#aeb2bb;margin-bottom:12px;">Uw profiel</div>
        <div style="display:flex;gap:24px;align-items:center;background:#f7f8f9;border:1px solid #edeef0;border-radius:18px;padding:24px 26px;"><div style="flex:none;width:56px;background:#fff;border:1px solid #e7e9ec;border-radius:32px;padding:11px 0;display:flex;flex-direction:column;align-items:center;gap:10px;box-shadow:0 5px 14px rgba(76,80,90,.06);">${profileBadge(overall, 24)}</div>
        <div><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#ec8a57;margin-bottom:4px;">Profiel &middot; ${statusWord(overall)}</div><div style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:31px;line-height:1.1;color:${stText(overall)};margin-bottom:9px;">${esc(prof.naam || '')}</div><p style="margin:0;font-family:'Lato',sans-serif;font-size:15px;line-height:1.62;color:#686c7c;max-width:540px;">${esc(prof.tekst || '')}</p></div></div></section>
      <section><div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px;"><div><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#aeb2bb;margin-bottom:6px;">Twee kernscores</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:22px;color:#4c505a;">Waar staat u nu?</div></div><div style="display:flex;align-items:center;gap:8px;font-family:'Lato',sans-serif;font-size:12.5px;color:#9a9ea8;"><span style="display:inline-block;width:26px;border-top:2px dashed #79c6c0;"></span>Norm 80%</div></div>
        ${scoreBar('Verzuimbeeld en data', data)}${scoreBar('Leidinggevende regie', regie)}
        <div style="display:flex;align-items:center;gap:12px;background:#fdf1ea;border:1px solid #f7d8c7;border-radius:13px;padding:13px 18px;"><span style="flex:none;width:26px;height:26px;border-radius:50%;background:#ec641a;color:#fff;font-family:'Comfortaa',sans-serif;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;">!</span><div style="font-family:'Lato',sans-serif;font-size:14.5px;color:#7a5340;"><span style="font-weight:700;color:#c4561a;">Meeste aandacht:</span> ${esc(worst)}</div></div></section>
      <section><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#aeb2bb;margin-bottom:14px;">Wat betekent dit?</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
          <div style="background:#fff;border:1px solid #edeef0;border-radius:16px;padding:21px 22px;break-inside:avoid;"><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:17px;color:#4c505a;margin-bottom:9px;">Verzuimbeeld en data</div><p style="margin:0 0 14px;font-family:'Lato',sans-serif;font-size:13.5px;line-height:1.58;color:#686c7c;">Dit laat zien of verzuim niet alleen wordt geregistreerd, maar ook begrepen en gebruikt om te sturen.</p><div style="display:flex;gap:11px;align-items:flex-start;margin-bottom:9px;"><span style="flex:none;font-family:'Lato',sans-serif;font-weight:700;font-size:11px;color:#3a8f86;background:rgba(75,179,166,.15);border-radius:8px;padding:3px 10px;">HOOG</span><span style="font-family:'Lato',sans-serif;font-size:13px;line-height:1.5;color:#686c7c;">Trends, oorzaken en kosten zijn zichtbaar en leiden tot actie.</span></div><div style="display:flex;gap:11px;align-items:flex-start;"><span style="flex:none;font-family:'Lato',sans-serif;font-weight:700;font-size:11px;color:#6b6f7e;background:rgba(107,111,126,.12);border-radius:8px;padding:3px 10px;">LAAG</span><span style="font-family:'Lato',sans-serif;font-size:13px;line-height:1.5;color:#686c7c;">Verzuim wordt vooral reactief en per geval behandeld.</span></div></div>
          <div style="background:#fff;border:1px solid #edeef0;border-radius:16px;padding:21px 22px;break-inside:avoid;"><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:17px;color:#4c505a;margin-bottom:9px;">Leidinggevende regie</div><p style="margin:0 0 14px;font-family:'Lato',sans-serif;font-size:13.5px;line-height:1.58;color:#686c7c;">Dit laat zien of leidinggevenden vanaf dag één actief, zorgvuldig en privacybewust regie nemen op verzuim en terugkeer.</p><div style="display:flex;gap:11px;align-items:flex-start;margin-bottom:9px;"><span style="flex:none;font-family:'Lato',sans-serif;font-weight:700;font-size:11px;color:#3a8f86;background:rgba(75,179,166,.15);border-radius:8px;padding:3px 10px;">HOOG</span><span style="font-family:'Lato',sans-serif;font-size:13px;line-height:1.5;color:#686c7c;">Rollen, gesprekken en ondersteuning zijn duidelijk.</span></div><div style="display:flex;gap:11px;align-items:flex-start;"><span style="flex:none;font-family:'Lato',sans-serif;font-weight:700;font-size:11px;color:#6b6f7e;background:rgba(107,111,126,.12);border-radius:8px;padding:3px 10px;">LAAG</span><span style="font-family:'Lato',sans-serif;font-size:13px;line-height:1.5;color:#686c7c;">Risico op vertraging en wisselende aanpak.</span></div></div>
        </div></section>
    </main>${pageFooter(org, datum, '2 / 3')}</section>` +
  // PAGE 3 — TIPS + CTA
  `<section class="sheet" style="display:flex;flex-direction:column;padding:16mm 18mm 13mm;">${innerHeader('Stoplicht-tussenrapport')}
    <main style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:24px;">
      <section><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#aeb2bb;margin-bottom:6px;">Aan de slag</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:23px;color:#4c505a;margin-bottom:18px;">Vier tips om mee te starten</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">${tips.map(tipCard).join('')}</div></section>
      <section><div style="position:relative;overflow:hidden;border-radius:22px;padding:32px 34px;background:linear-gradient(120deg,#79c6c0,#85cee4);break-inside:avoid;"><div aria-hidden="true" style="position:absolute;top:-70px;right:-40px;width:230px;height:230px;border-radius:50%;background:rgba(255,255,255,.14);"></div><div style="position:relative;z-index:1;"><div style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:27px;color:#fff;margin-bottom:9px;">Tijd om aan de slag te gaan</div><p style="margin:0 0 22px;max-width:560px;font-family:'Lato',sans-serif;font-size:15px;line-height:1.6;color:rgba(255,255,255,.94);">Plan een vrijblijvend adviesgesprek of doe de verdieping voor het volledige beeld van uw bedrijfsgezondheid.</p><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;"><span style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:15px;color:#fff;background:#ec641a;border-radius:30px;padding:13px 26px;box-shadow:0 10px 22px rgba(236,100,26,.32);">Plan een adviesgesprek</span><span style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:15px;color:#fff;border:2px solid rgba(255,255,255,.75);border-radius:30px;padding:11px 24px;">Doe de verdieping</span><span style="margin-left:auto;font-family:'Lato',sans-serif;font-weight:700;font-size:13.5px;color:rgba(255,255,255,.95);">arboconcern.nl &middot; 071 - 204 1801</span></div></div></div></section>
    </main>${pageFooter(org, datum, '3 / 3')}</section>` +
  TAIL;
}

/* ---------- EINDRAPPORT ---------- */
function renderEindrapport(p) {
  const c = p.contact || {};
  const e = p.eindrapport || {};
  const q = p.quickscan || {};
  const org = c.organisatie || 'Uw organisatie';
  const datum = fmtDate(p.timestamp);
  const prof = q.profiel || {};
  const overall = e.overall ?? 0;
  const rubrieken = e.rubrieken || [];
  const top3 = e.top3_prioriteiten || [];
  const samenvatting = (q.rapportageteksten && q.rapportageteksten.overall && q.rapportageteksten.overall.tekst) || prof.tekst || '';

  const tableRow = (r, last) => {
    const s = r.score, col = stSolid(s);
    return `<tr style="break-inside:avoid;${last ? '' : 'border-bottom:1px solid #f1f2f4;'}"><td style="padding:11px 18px;"><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:14px;color:#4c505a;margin-bottom:7px;">${esc(SHORT_DEF(r.theme))}</div><div style="position:relative;height:5px;background:#eef0f2;border-radius:4px;max-width:300px;"><div style="position:absolute;left:0;top:0;bottom:0;width:${s}%;background:${col};border-radius:4px;"></div><div style="position:absolute;left:80%;top:-2px;bottom:-2px;border-left:1.5px solid #cfd3da;"></div></div></td><td style="text-align:right;padding:11px 14px;font-family:'Comfortaa',sans-serif;font-weight:700;font-size:18px;color:${stText(s)};">${s}%</td><td style="text-align:center;padding:11px 14px;font-family:'Lato',sans-serif;font-size:13px;color:#aeb2bb;">80</td><td style="padding:11px 18px;"><span style="display:inline-flex;align-items:center;gap:8px;font-family:'Lato',sans-serif;font-size:13px;color:#686c7c;"><span style="width:11px;height:11px;border-radius:50%;background:${col};"></span>${statusWord(s)}</span></td></tr>`;
  };
  const prioRow = (pr, i) => {
    const s = pr.score, col = stSolid(s), afst = pr.aandachtsscore ?? (NORM - s);
    return `<div style="display:flex;align-items:center;gap:18px;background:#fff;border:1px solid #edeef0;border-radius:14px;padding:15px 20px;break-inside:avoid;"><div style="flex:none;width:40px;height:40px;border-radius:12px;background:${col};color:#fff;font-family:'Comfortaa',sans-serif;font-weight:700;font-size:19px;display:flex;align-items:center;justify-content:center;">${i + 1}</div><div style="flex:1;"><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:17px;color:#4c505a;margin-bottom:8px;">${esc(SHORT_DEF(pr.thema))}</div><div style="position:relative;height:6px;background:#eef0f2;border-radius:4px;max-width:360px;"><div style="position:absolute;left:0;top:0;bottom:0;width:${s}%;background:${col};border-radius:4px;"></div><div style="position:absolute;left:80%;top:-3px;bottom:-3px;border-left:2px dashed #79c6c0;"></div></div></div><div style="flex:none;text-align:right;"><div style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:24px;color:${stText(s)};line-height:1;">${s}%</div><div style="font-family:'Lato',sans-serif;font-size:12px;color:#9a9ea8;margin-top:4px;">${afst} punten onder de norm</div></div></div>`;
  };

  return HEAD('Volledig eindrapport') +
  // PAGE 1 — COVER (met mini-roos)
  `<section class="sheet" style="display:flex;flex-direction:column;padding:22mm 22mm 0;"><div aria-hidden="true" style="position:absolute;top:-150px;right:-150px;width:440px;height:440px;border-radius:50%;background:radial-gradient(circle at 36% 36%,rgba(133,206,228,.34),rgba(121,198,192,.10) 70%);"></div><div aria-hidden="true" style="position:absolute;bottom:150px;left:-100px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(236,100,26,.07),rgba(236,100,26,0) 70%);"></div>
    <header style="position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-start;"><div style="line-height:1;"><img src="${LOGO}" alt="arboconcern" style="height:54px;width:auto;display:block;"></div><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:2.5px;color:#9a9ea8;text-transform:uppercase;border:1px solid #e7e9ec;border-radius:30px;padding:9px 18px;">Bedrijfsgezondheidscan</div></header>
    <div style="position:relative;z-index:1;flex:1;display:flex;align-items:center;gap:30px;"><div style="flex:1;"><div style="display:inline-block;font-family:'Lato',sans-serif;font-weight:700;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#4ba39c;background:rgba(121,198,192,.16);border-radius:30px;padding:8px 18px;margin-bottom:22px;">Volledig eindrapport</div><h1 style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:36px;line-height:1.16;letter-spacing:-0.5px;color:#4c505a;margin:0;">De gezondheid<br>van jullie bedrijf<br>in één roos</h1><p style="font-family:'Lato',sans-serif;font-size:16px;line-height:1.6;color:#686c7c;margin:24px 0 0;max-width:455px;">De volledige diagnose: negen rubrieken, samengebracht in één heldere roos. Zo ziet u in één oogopslag waar u sterk staat en waar de meeste winst te behalen valt.</p></div>
      <div style="flex:none;width:180px;height:180px;border-radius:50%;background:#f7f8f9;border:1px solid #edeef0;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 2px 12px rgba(76,80,90,.05);">${buildRoosMini(rubrieken)}</div></div>
    <footer style="position:relative;z-index:1;padding:24px 0 30px;border-top:1px solid #edeef0;margin-top:10px;display:flex;gap:70px;"><div><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#aeb2bb;margin-bottom:7px;">Opgesteld voor</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:19px;color:#4c505a;">${esc(org)}</div></div><div><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#aeb2bb;margin-bottom:7px;">Datum</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:19px;color:#4c505a;">${esc(datum)}</div></div></footer>
    <div aria-hidden="true" style="position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg,#79c6c0,#85cee4 45%,#ec641a);"></div></section>` +
  // PAGE 2 — PROFIEL + GROTE ROOS
  `<section class="sheet" style="display:flex;flex-direction:column;padding:16mm 18mm 13mm;">${innerHeader('Volledig eindrapport')}
    <main style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:24px;">
      <section><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#aeb2bb;margin-bottom:12px;">Uw profiel</div><div style="display:flex;gap:24px;align-items:center;background:#f7f8f9;border:1px solid #edeef0;border-radius:18px;padding:22px 26px;"><div style="flex:none;width:56px;background:#fff;border:1px solid #e7e9ec;border-radius:32px;padding:11px 0;display:flex;flex-direction:column;align-items:center;gap:10px;box-shadow:0 5px 14px rgba(76,80,90,.06);">${profileBadge(overall, 24)}</div><div><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#ec8a57;margin-bottom:4px;">Profiel &middot; ${statusWord(overall)}</div><div style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:29px;line-height:1.1;color:${stText(overall)};margin-bottom:8px;">${esc(prof.naam || '')}</div><p style="margin:0;font-family:'Lato',sans-serif;font-size:14.5px;line-height:1.6;color:#686c7c;max-width:540px;">${esc(prof.tekst || '')}</p></div></div></section>
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;"><div style="text-align:center;"><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#aeb2bb;margin-bottom:5px;">De roos</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:21px;color:#4c505a;">De negen rubrieken in beeld</div></div>${buildRoosSvg(rubrieken)}</div>
      <div style="display:flex;justify-content:center;gap:26px;flex-wrap:wrap;"><span style="display:flex;align-items:center;gap:8px;font-family:'Lato',sans-serif;font-size:13px;color:#686c7c;"><span style="display:inline-block;width:26px;border-top:2px dashed #79c6c0;"></span>Norm 80%</span><span style="display:flex;align-items:center;gap:8px;font-family:'Lato',sans-serif;font-size:13px;color:#686c7c;"><span style="width:13px;height:13px;border-radius:50%;background:#4bb3a6;"></span>Op koers</span><span style="display:flex;align-items:center;gap:8px;font-family:'Lato',sans-serif;font-size:13px;color:#686c7c;"><span style="width:13px;height:13px;border-radius:50%;background:#ec641a;"></span>Aandacht</span><span style="display:flex;align-items:center;gap:8px;font-family:'Lato',sans-serif;font-size:13px;color:#686c7c;"><span style="width:13px;height:13px;border-radius:50%;background:#6b6f7e;"></span>Prioriteit</span></div>
    </main>${pageFooter(org, datum, '2 / 4')}</section>` +
  // PAGE 3 — TABEL + TOP-3
  `<section class="sheet" style="display:flex;flex-direction:column;padding:16mm 18mm 13mm;">${innerHeader('Volledig eindrapport')}
    <main style="flex:1;display:flex;flex-direction:column;gap:26px;padding-top:24px;">
      <section><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#aeb2bb;margin-bottom:6px;">Alle rubrieken</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:23px;color:#4c505a;margin-bottom:16px;">Scores per rubriek</div>
        <div style="border:1px solid #edeef0;border-radius:16px;overflow:hidden;"><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f7f8f9;"><th style="text-align:left;padding:13px 18px;font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#9a9ea8;border-bottom:1px solid #e7e9ec;">Rubriek</th><th style="text-align:right;padding:13px 14px;font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#9a9ea8;border-bottom:1px solid #e7e9ec;">Score</th><th style="text-align:center;padding:13px 14px;font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#9a9ea8;border-bottom:1px solid #e7e9ec;">Norm</th><th style="text-align:left;padding:13px 18px;font-family:'Lato',sans-serif;font-weight:700;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#9a9ea8;border-bottom:1px solid #e7e9ec;">Status</th></tr></thead><tbody>${rubrieken.map((r, i) => tableRow(r, i === rubrieken.length - 1)).join('')}</tbody></table></div></section>
      <section><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#aeb2bb;margin-bottom:6px;">Top-3 prioriteiten</div><div style="font-family:'Comfortaa',sans-serif;font-weight:600;font-size:23px;color:#4c505a;margin-bottom:16px;">De grootste afstand tot de norm</div><div style="display:flex;flex-direction:column;gap:12px;">${top3.map(prioRow).join('')}</div></section>
    </main>${pageFooter(org, datum, '3 / 4')}</section>` +
  // PAGE 4 — SAMENVATTING + CTA
  `<section class="sheet" style="display:flex;flex-direction:column;padding:16mm 18mm 13mm;">${innerHeader('Volledig eindrapport')}
    <main style="flex:1;display:flex;flex-direction:column;justify-content:flex-start;gap:24px;padding-top:34px;">
      <section><div style="font-family:'Lato',sans-serif;font-weight:700;font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:#aeb2bb;margin-bottom:14px;">Managementsamenvatting</div><div style="background:#f7f8f9;border:1px solid #edeef0;border-radius:18px;padding:30px 32px;border-left:5px solid #ec641a;"><p style="margin:0 0 18px;font-family:'Lato',sans-serif;font-size:19px;line-height:1.62;color:#4c505a;">${esc(samenvatting)}</p><div style="display:flex;align-items:center;gap:13px;font-family:'Lato',sans-serif;font-size:15px;color:#686c7c;"><span style="flex:none;font-family:'Comfortaa',sans-serif;font-weight:700;font-size:13px;color:#fff;background:#ec641a;border-radius:9px;padding:6px 14px;">Vervolgstap</span>Vertaal de uitkomst naar een 90-dagen verbeterplan.</div></div></section>
      <section><div style="position:relative;overflow:hidden;border-radius:22px;padding:32px 36px;background:linear-gradient(120deg,#79c6c0,#85cee4);break-inside:avoid;"><div aria-hidden="true" style="position:absolute;top:-70px;right:-40px;width:230px;height:230px;border-radius:50%;background:rgba(255,255,255,.14);"></div><div style="position:relative;z-index:1;"><div style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:27px;color:#fff;margin-bottom:10px;">Plan een adviesgesprek</div><p style="margin:0 0 22px;max-width:580px;font-family:'Lato',sans-serif;font-size:15.5px;line-height:1.6;color:rgba(255,255,255,.94);">Bespreek uw roos met een arbo-adviseur en vertaal de uitkomst naar een concreet verbeterplan voor de komende 90 dagen.</p><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;"><span style="font-family:'Comfortaa',sans-serif;font-weight:700;font-size:15px;color:#fff;background:#ec641a;border-radius:30px;padding:14px 28px;box-shadow:0 10px 22px rgba(236,100,26,.32);">Mail onze arbo-adviseur</span><span style="margin-left:auto;font-family:'Lato',sans-serif;font-weight:700;font-size:14px;color:rgba(255,255,255,.95);">arboconcern.nl &middot; 071 - 204 1801</span></div></div></div></section>
    </main>${pageFooter(org, datum, '4 / 4')}</section>` +
  TAIL;
}

/* ---------- entry ---------- */
function renderReport(payload) {
  return payload && payload.event === 'verdieping_compleet'
    ? renderEindrapport(payload)
    : renderTussenrapport(payload);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderReport, renderTussenrapport, renderEindrapport, buildRoosSvg };
}

// lokale test: node render.js  -> /tmp/tussen.html + /tmp/eind.html
if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-payload.json'), 'utf8'));
  fs.writeFileSync('/tmp/tussen.html', renderTussenrapport(sample.quickscan_lead));
  fs.writeFileSync('/tmp/eind.html', renderEindrapport(sample.verdieping_compleet));
  console.log('OK: /tmp/tussen.html + /tmp/eind.html geschreven');
}
