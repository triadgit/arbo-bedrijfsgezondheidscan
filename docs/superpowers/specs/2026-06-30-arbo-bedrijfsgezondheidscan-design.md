# Arbo Concern — Bedrijfsgezondheidscan (landingspagina)

**Datum:** 2026-06-30
**Doel:** Een lookalike marketing-landingspagina (zonder header/footer) van arboconcern.nl,
met focus op een tweetraps bedrijfsgezondheidscan. Ontwikkeld als overdraagbaar pakket in
de huisstijl van Arbo Concern. Te hosten op `scan.arboconcern.nl`.

## Bevestigde keuzes (brainstorm)

1. **Architectuur:** statisch bundel, **geen build**, vanilla JS. Alle scan-logica en teksten
   in losse config-bestanden (`public/config/*.json`).
2. **Leads:** via een **n8n-webhook** (`settings.json → webhook_url`). Pagina is stateless;
   doet alleen `POST`.
3. **Lead-poort:** **vóór** het resultaat. Na 16 quickscan-vragen eerst gegevens, dan profiel.
4. **Scope v1:** volledige funnel (quickscan + verdieping + roos + eindrapport).
5. **Hosting:** zowel Coolify-deploybaar (Dockerfile/nginx) **als** kale zip (`public/` op elke host).
6. **Huisstijl:** van de live site. Fonts **Comfortaa** (display) + **Lato** (body), self-hosted.
   Logo's: echte `arboconcern-logo.svg` + `-white.svg`. Palet oranje `#ec641a` / teal `#79c6c0`.
7. **Styling:** via de `frontend-design`-skill, productiewaardig. **De meegeleverde demo is
   uitsluitend logica-referentie, NIET visuele referentie** — de demo-look wordt niet hergebruikt.
8. **PDF:** **n8n rendert + mailt** de gebrande PDF (HTML-template → PDF). De pagina genereert
   zelf geen PDF; na de lead-poort triggert de webhook de mail.

## Mapstructuur

```
arbo-bedrijfsgezondheidscan/
├── public/
│   ├── index.html
│   ├── assets/{css/scan.css, js/{scoring.js,scan.js}, fonts/, img/}
│   └── config/{questions.json, scoring.json, content.json, settings.json}
├── n8n/{pdf-template.html, webhook-contract.md, sample-payload.json}
├── tests/scoring.test.mjs
├── Dockerfile, docker-compose.yml, README.md
```

## Funnel (9 schermen)

1. Intro → 2. Quickscan (16×, 1 vraag/scherm) → 3. **Lead-poort 🔒** (webhook `quickscan_lead`)
→ 4. Profiel (R1-R5) → 5. Dataduik (2 balken) → 6. Thema-detail → 7. Tips (+ "rapport onderweg")
→ 8. Verdieping (45×) → 9. Eindrapport/roos (webhook `verdieping_compleet`).

Geen header/footer; alleen een kale merkbalk met logo bovenaan.

## Scorelogica (uit Excel, in `scoring.json`)

- Antwoorden: Ja volledig=100, Grotendeels=75, Deels=50, Nauwelijks=25, Nee=0, N.v.t.=uitsluiten.
- Rubriekscore = gemiddelde van **geldige** antwoorden (N.v.t. uit de noemer).
- Stoplicht: Groen ≥75, Oranje 55-74, Rood <55. Norm (roos) = 80.
- `dataScore` = gem. Verzuimbeeld en data (quickscan); `regieScore` = gem. Leidinggevende regie.
- `overall` = gem. van data + regie.
- Profielroutes: R1 overall<55; R2 data≥75 & regie<55; R3 data<55 & regie≥75;
  R5 data≥75 & regie≥75; R4 = rest.
- Roos top-3 = grootste **aandachtsscore** (norm − rubriekscore) over alle 11 rubrieken.

**`scoring.js` is een pure, DOM-vrije module** (import in browser én `node --test`).

## Webhook-contract (rapport-klaar; ruim genoeg voor een sterk PDF-rapport)

`POST settings.webhook_url`, fire-and-forget, korte timeout, faalt nooit de funnel.
Bij falen: payload in `localStorage`, retry bij event 2.

**Event 1 `quickscan_lead`** (scherm 3): `event`, `timestamp`, `meta`(url, taal),
`contact`(organisatie, sector, aantal_medewerkers, contactpersoon, email, telefoon, toestemming),
`quickscan`{ data_score, regie_score, overall, profiel{route,naam,tekst,icoon},
stoplicht{data,regie}, laagste_rubriek, rapportageteksten{overall,data,regie}, tips[],
antwoorden[ {code, thema, sub, vraag, antwoord_label, score} ] }.

**Event 2 `verdieping_compleet`** (scherm 9): zelfde `contact` + `eindrapport`{ overall, stoplicht,
rubrieken[ {thema, score, norm, aandachtsscore, stoplicht} ], top3_prioriteiten[],
adviesroute, alle 61 antwoorden met tekst }.

De payload bevat dus per antwoord de **volledige vraagtekst, thema en sub-label** plus de
**voorgekauwde rapportageteksten** zodat n8n de PDF kan opmaken zonder iets opnieuw af te leiden.

## Lead-poort velden

Verplicht: organisatie, e-mail, toestemming. Optioneel: sector, aantal_medewerkers,
contactpersoon, telefoon. (Bron: `settings.json → lead_fields`.)

## AVG

Geen medische persoonsgegevens; alleen organisatieniveau. Toestemming-checkbox + privacytekst +
link naar privacybeleid. Self-hosted fonts (geen externe call). Geen tracking standaard.

## Styling-richtlijnen (frontend-design)

Mobiel-eerst, toegankelijk (toetsenbord, contrast, `prefers-reduced-motion`). Sterke componenten:
antwoordknoppen (tactiel, duidelijke selectie), voortgang, stoplichtbalken, profielkaart, en de
**roos/radar** als eindbeeld (canvas of SVG, normlijn 80%). Design-tokens als CSS custom properties,
gevoed vanuit `settings.branding`.

## Testing

`node --test` op `scoring.js`: 5 profielroutes incl. grensgevallen (54/55/74/75), N.v.t.-uitsluiting,
top-3-prioriteit. Handmatige rooktest-checklist in README.

## Deploy

- Coolify: Dockerfile (nginx) serveert `public/`; eerst Triad-subdomein, later CNAME `scan.arboconcern.nl`.
- Kale zip: inhoud van `public/` op elke host; alleen `settings.json → webhook_url` invullen.
