# Rapporten & n8n-flow — runbook

De logica op papier: waar rapporten ontstaan, hoe de n8n-flow eruitziet, en de
prompts om de PDF-templates via Claude Design te maken.

## 1. Status

**Af (pagina-kant):**
- Funnel, scores, profielroutes, roos.
- Twee webhook-events met rapport-klare payload (zie `webhook-contract.md` + `sample-payload.json`).
- Fail-safe POST (fire-and-forget, retry via localStorage).
- Basis PDF-template (`pdf-template.html`) als referentie/fallback.

**Te doen:**
1. PDF-templates definitief maken via **Claude Design** (sectie 5).
2. **n8n-flow** bouwen (sectie 3).
3. **HTML -> PDF** render-stap: **Gotenberg op Coolify** (sectie 4).
4. **Resend**-afzender `gezondheidsscan@arboconcern.nl` (domein al gekoppeld).
5. **Google Sheet** koppelen (sectie 6).
6. **commercieel@arboconcern.nl** lead-notificatie.
7. **CORS** op de webhook + `webhook_url` in `config/settings.json` zetten, `webhook_enabled: true`.

## 2. De twee rapport-momenten

| # | Event | Trigger | Rapport | Ontvangers |
|---|-------|---------|---------|-----------|
| 1 | `quickscan_lead` | Lead-poort na 16 vragen | **Stoplicht-tussenrapport** (profiel, 2 balken, thema-uitleg, tips, CTA) | Lead (PDF) + commercieel@ (notificatie + PDF) |
| 2 | `verdieping_compleet` | Roos-scherm na 45 vragen | **Volledig eindrapport** (alles van #1 + roos + top-3 + adviesroute) | Lead (PDF) + commercieel@ (notificatie + PDF) |

Beide gebruiken **dezelfde template-bron**; het roos-blok is leeg bij #1, gevuld bij #2.

## 3. De n8n-workflow

Eén Webhook, splitsen op `event`, per tak: opslaan -> renderen -> mailen.

```
[Webhook  POST]  (Respond: Immediately, 200)   ← CORS-headers voor scan-origin
      │
 [Switch  {{$json.body.event}}]
      │
      ├── "quickscan_lead" ───────────────────────────────────────────────┐
      │     [Google Sheets: Append row]   (nieuwe lead)                     │
      │     [Code: buildTussenrapportHTML(payload)]  -> html               │
      │     [HTTP Request -> Gotenberg /forms/chromium/convert/html] -> pdf │
      │     [Resend: mail lead]      (van gezondheidsscan@, PDF bijlage)    │
      │     [Resend: mail commercieel@]  (leaddetails + scores + PDF)       │
      │
      └── "verdieping_compleet" ──────────────────────────────────────────┐
            [Google Sheets: Update row]  (match email + timestamp)         │
            [Code: buildEindrapportHTML(payload)]  -> html (incl. roos-SVG)│
            [HTTP Request -> Gotenberg] -> pdf                             │
            [Resend: mail lead]      (volledig rapport)                    │
            [Resend: mail commercieel@]  (verrijkte lead + PDF)            │
```

Notities:
- **Respond Immediately**: de Webhook-node antwoordt meteen 200, daarna draait de
  rest async. De pagina is toch fire-and-forget.
- **Switch** op `event`: in n8n staat de body vaak onder `{{$json.body}}` (afhankelijk
  van de Webhook-instelling). Controleer het pad bij het bouwen.
- **Matching** (event 2): zoek de Sheet-rij op `contact.email` + `quickscan`-`timestamp`
  uit event 1. De pagina stuurt bij event 2 dezelfde `contact.email`; als de oorspronkelijke
  timestamp ontbreekt, match op meest recente open rij van dat e-mailadres.

## 4. HTML -> PDF: Gotenberg op Coolify

n8n heeft geen ingebouwde HTML->PDF. **Gotenberg** is een kleine, gratis, self-hosted
Chromium-renderer. Eenmalig als Docker-service op de Triad-Coolify zetten (image
`gotenberg/gotenberg:8`, poort 3000, intern bereikbaar). Daarna:

- n8n **Code-node** bouwt de volledige HTML-string uit de payload (template-literals +
  `.map()` voor lijsten; geen Handlebars-afhankelijkheid nodig, dus geen `{{add}}`-helper).
- n8n **HTTP Request** POST de HTML naar `http://gotenberg:3000/forms/chromium/convert/html`
  (multipart, veld `files` met `index.html`), responsetype **file** -> PDF-binary.
- PDF als bijlage in de Resend-node.

**De roos in de PDF**: niet als canvas (dat rendert niet betrouwbaar in PDF), maar als
**inline SVG** die de Code-node berekent uit `eindrapport.rubrieken` (zelfde scores als
op het scherm, normlijn 80%). Print-scherp en zonder JS.

Waarom Gotenberg en geen cloud-API: gratis, onbeperkt, data blijft in eigen beheer
(AVG-net), en de template blijft in onze repo i.p.v. bij een derde partij.

## 5. PDF-templates via Claude Design — de prompts

Claude Design maakt de **visuele opmaak** (statische HTML met voorbeelddata). Daarna zet
ik die om naar een **render-functie** voor de n8n Code-node (placeholders -> echte data,
lijsten via `.map()`, roos als SVG). Eén template met een conditioneel roos-blok, of twee
losse; ik raad **twee prompts** aan voor focus.

### Prompt A — Stoplicht-tussenrapport (na de quickscan)

> Ontwerp een **print-PDF-rapport op A4** (staand) voor "Arbo Concern
> Bedrijfsgezondheidscan". Het is een zakelijk maar warm tussenrapport voor een werkgever
> die net een quickscan over verzuim deed. Huisstijl: fonts **Comfortaa** (koppen) +
> **Lato** (tekst); kleuren oranje `#ec641a`, teal `#79c6c0`, cyaan `#85cee4`, inkt
> `#4c505a`, zacht `#f7f7f7`. Rond, vriendelijk, veel witruimte, afgeronde hoeken (14px),
> zachte schaduwen. Print-veilig: `@page A4` met marges, geen afbreken binnen kaarten.
> Blokken in deze volgorde:
> 1. **Cover**: groot logo, titel "Hoe gezond is uw bedrijf?", organisatienaam + datum.
> 2. **Profiel**: een gekleurde stoplicht-badge + de profielnaam (bijv. "Praktische
>    verbeteraar") + een korte duiding.
> 3. **Twee scores**: horizontale balken voor "Verzuimbeeld en data" en "Leidinggevende
>    regie", elk met percentage en stoplichtkleur (groen/oranje/rood) + een 80%-normmarkering.
> 4. **Wat betekent dit**: twee korte tekstblokken die per thema uitleggen wat een hoge/lage
>    score zegt.
> 5. **Tips**: 3-4 genummerde tipkaarten.
> 6. **CTA**: een blok "Plan een adviesgesprek" met knop/contact.
> Gebruik realistische voorbeeldteksten. Lever schone, zelfstandige HTML + CSS (inline of
> in `<style>`), geschikt om naar PDF te renderen.

### Prompt B — Volledig eindrapport (na de verdieping)

> Zelfde huisstijl en print-PDF-eisen als het tussenrapport, maar nu het **volledige
> eindrapport** na de verdieping. Voeg na de tips deze blokken toe, elk op een eigen pagina:
> 1. **De roos**: een **radar/spider-diagram** met 9 rubrieken (Verzuimbeeld en data,
>    Leidinggevende regie, Beleid en Poortwachter, Preventie en werkbelasting, Medewerker en
>    cultuur, Arbodienst en samenwerking, Kosten en risico, Vitaliteit en inzetbaarheid,
>    Governance), elke as 0-100%, met een gestippelde normlijn op 80% en het scorevlak in
>    oranje. Lever dit als **inline SVG** (geen canvas/JS).
> 2. **Rubriektabel**: per rubriek score %, norm 80, en een stoplicht-stip.
> 3. **Top-3 prioriteiten**: de drie rubrieken met de grootste afstand tot de norm.
> 4. **Adviesroute + CTA**: korte managementsamenvatting + "Plan een adviesgesprek".
> Realistische voorbeelddata, schone zelfstandige HTML + SVG, print-veilig.

(Aansturen kan via claude.ai/design of de `designer`-tool; zie `project_triadagency_designer_tool`.)

## 6. Google Sheet — kolommen

Eén tab "Leads", één rij per lead (event 1 maakt, event 2 verrijkt):

`timestamp | organisatie | contactpersoon | email | telefoon | sector | aantal_medewerkers |
toestemming | data_score | regie_score | overall_quickscan | profiel | stoplicht_quickscan |
verdieping_overall | top3 | adviesroute | status (lead / verdieping_compleet) | url`

## 7. Resend & ontvangers

- **Afzender**: `gezondheidsscan@arboconcern.nl` (domein arboconcern.nl al in Resend gekoppeld;
  check dat dit adres mag verzenden + SPF/DKIM staan).
- **Lead** krijgt: event 1 het tussenrapport-PDF, event 2 het eindrapport-PDF, met korte
  begeleidende mailtekst (huisstijl).
- **commercieel@arboconcern.nl** krijgt: bij elk event een notificatie met leaddetails +
  scores + de PDF als bijlage, zodat de salesopvolging direct kan starten.
- Let op de M365-gotcha: "delivered" bij Resend != inbox bij M365 (quarantaine). Testmail
  naar een echt arboconcern.nl-adres voordat we live gaan.

## 8. CORS & activeren

- Webhook-node moet de scan-origin toestaan (`Access-Control-Allow-Origin`) en de preflight
  `OPTIONS` afhandelen. In n8n via een "Respond to Webhook"-node met de juiste headers, of
  CORS-instelling op de node.
- Daarna `config/settings.json`: `webhook_url` = productie-URL, `webhook_enabled: true`.

## 9. Volgorde van uitvoeren

1. Gotenberg op Coolify zetten.
2. Claude Design: prompt A + B uitvoeren -> 2 HTML-ontwerpen.
3. Ik zet die om naar render-functies (Code-node) + roos-SVG.
4. n8n-flow bouwen: Webhook -> Switch -> (Sheet, render, Gotenberg, Resend x2) per tak.
5. Google Sheet aanmaken + koppelen.
6. Resend-afzender + commercieel@ instellen.
7. Test-run met de `sample-payload.json` (beide events) -> controleer Sheet + 2 mails + PDF's.
8. CORS + `webhook_url` in settings.json -> end-to-end test vanaf de live pagina.
