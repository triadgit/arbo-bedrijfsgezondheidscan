/*
 * scoring.js — pure, DOM-vrije scorelogica voor de Bedrijfsgezondheidscan.
 * Bruikbaar in de browser (import als ES-module) en in node --test.
 *
 * Alle functies zijn zij-effectvrij: ze nemen `answers` (map vraagcode/id -> {label, score})
 * en de geladen config, en geven berekende waarden terug. Geen globale state, geen DOM.
 */

export const STOPLICHT_GROEN = 75;
export const STOPLICHT_ORANJE = 55;
export const NORM = 80;

/** Stoplichtlabel voor een score. Groen >=75, Oranje 55-74, Rood <55. */
export function stoplicht(score) {
  if (score >= STOPLICHT_GROEN) return 'Groen';
  if (score >= STOPLICHT_ORANJE) return 'Oranje';
  return 'Rood';
}

/** Kleurtoken-naam voor een score (gekoppeld aan CSS custom properties). */
export function stoplichtKey(score) {
  if (score >= STOPLICHT_GROEN) return 'groen';
  if (score >= STOPLICHT_ORANJE) return 'oranje';
  return 'rood';
}

/**
 * Gemiddelde van geldige antwoorden voor een thema.
 * N.v.t. (score === null) telt NIET mee in de noemer. Onbeantwoord telt ook niet mee.
 * @param {Object} answers  map id -> {label, score|null}
 * @param {Array}  questions lijst vragen
 * @param {string} theme
 * @param {string|null} phase  'Quickscan' | 'Verdieping' | null (=beide)
 * @returns {number} 0-100 (afgerond), 0 als geen geldige antwoorden
 */
export function avgForTheme(answers, questions, theme, phase = null) {
  const valid = questions
    .filter((q) => q.theme === theme && (!phase || q.phase === phase))
    .map((q) => answers[q.id]?.score)
    .filter((v) => v !== undefined && v !== null);
  if (!valid.length) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/** Quickscan-kerngetallen: data, regie, overall (gemiddelde van beide). */
export function quickscanScores(answers, questions) {
  const data = avgForTheme(answers, questions, 'Verzuimbeeld en data', 'Quickscan');
  const regie = avgForTheme(answers, questions, 'Leidinggevende regie', 'Quickscan');
  const overall = Math.round((data + regie) / 2);
  return { data, regie, overall };
}

/**
 * Profielroute op basis van data- en regiescore.
 * R1 overall<55; R2 data>=75 & regie<55; R3 data<55 & regie>=75;
 * R5 data>=75 & regie>=75; R4 = rest.
 * @returns {string} route-id (R1..R5)
 */
export function profileRoute(data, regie) {
  const overall = (data + regie) / 2;
  if (overall < STOPLICHT_ORANJE) return 'R1';
  if (data >= STOPLICHT_GROEN && regie < STOPLICHT_ORANJE) return 'R2';
  if (data < STOPLICHT_ORANJE && regie >= STOPLICHT_GROEN) return 'R3';
  if (data >= STOPLICHT_GROEN && regie >= STOPLICHT_GROEN) return 'R5';
  return 'R4';
}

/** Vind het volledige route-object uit scoring.routes. */
export function resolveRoute(routes, data, regie) {
  const id = profileRoute(data, regie);
  return routes.find((r) => r.id === id) || routes.find((r) => r.id === 'R4');
}

/** Laagst scorende quickscan-rubriek (waar de meeste aandacht nodig is). */
export function laagsteRubriek(data, regie) {
  return data <= regie ? 'Verzuimbeeld en data' : 'Leidinggevende regie';
}

/**
 * Scores per rubriek over alle (of geldige) antwoorden, voor de roos.
 * @returns {Array} [{theme, score, norm, aandachtsscore, stoplicht, stoplichtKey}]
 */
export function rubricScores(answers, questions, rubrics, phase = null) {
  return rubrics
    .map((r) => {
      const score = avgForTheme(answers, questions, r.theme, phase);
      const norm = r.norm ?? NORM;
      return {
        theme: r.theme,
        score,
        norm,
        aandachtsscore: Math.max(0, norm - score),
        stoplicht: stoplicht(score),
        stoplichtKey: stoplichtKey(score),
      };
    })
    .filter((r) => r.score > 0);
}

/** Top-N prioriteiten: grootste afstand tot de norm (aandachtsscore). */
export function topPriorities(rubrics, n = 3) {
  return [...rubrics].sort((a, b) => b.aandachtsscore - a.aandachtsscore).slice(0, n);
}

/**
 * Bouw de rapport-klare antwoordlijst (voor de webhook-payload).
 * Elk item bevat code, thema, sub-label, volledige vraagtekst en het gekozen antwoord.
 */
export function answeredList(answers, questions, phase = null) {
  return questions
    .filter((q) => (!phase || q.phase === phase) && answers[q.id])
    .map((q) => ({
      code: q.code,
      thema: q.theme,
      sub: q.sub,
      vraag: q.text,
      antwoord_label: answers[q.id].label,
      score: answers[q.id].score,
    }));
}
