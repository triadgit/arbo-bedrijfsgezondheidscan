# Webhook-contract Bedrijfsgezondheidscan

Dit document beschrijft het contract tussen de scan-landingspagina en n8n. De pagina is
stateless en doet alleen een `POST`; n8n verwerkt de payload en regelt opslag, PDF en mail.

## Endpoint

- **Methode:** `POST`
- **URL:** de waarde van `public/config/settings.json -> webhook_url`
- **Content-Type:** `application/json`
- **Body:** een van de twee event-objecten hieronder (UTF-8 JSON)

## Gedrag van de pagina

- **Fire-and-forget.** De pagina stuurt de payload met een korte timeout en wacht niet op
  een inhoudelijk antwoord. De funnel blokkeert nooit op de webhook; de gebruiker gaat altijd
  direct door naar het volgende scherm, ook als n8n traag is of niet reageert.
- **Falen is veilig.** Mislukt event 1 (timeout, netwerk, non-2xx), dan cachet de pagina de
  payload in `localStorage`. Bij event 2 (`verdieping_compleet`) wordt de gecachte event-1-payload
  alsnog meegestuurd of opnieuw geprobeerd, zodat n8n niet zonder lead-context komt te zitten.
- **CORS.** De pagina draait op een andere origin dan n8n. n8n moet daarom:
  - de preflight `OPTIONS` afhandelen, en
  - bij zowel `OPTIONS` als `POST` de header `Access-Control-Allow-Origin` zetten op de
    scan-origin (bijvoorbeeld `https://scan.arboconcern.nl`, of `*` als dat acceptabel is),
  - plus `Access-Control-Allow-Methods: POST, OPTIONS` en
    `Access-Control-Allow-Headers: Content-Type`.
  Zonder deze headers weigert de browser de call en valt de pagina terug op de localStorage-cache.

## Rapport-klaar

De payload is bewust **rapport-klaar**. Per antwoord zit de **volledige vraagtekst**, het
**thema** en het **sub-label** in de payload, plus de **voorgekauwde rapportageteksten**, het
**profiel**, de **stoplichten**, de **tips** en (bij event 2) de **rubrieken, top-3-prioriteiten
en adviesroute**. n8n hoeft dus geen `questions.json`, `content.json` of `scoring.json` opnieuw te
raadplegen of scores opnieuw af te leiden: alles wat het PDF-rapport en de mail nodig hebben staat
al in de payload.

---

## Event 1: `quickscan_lead`

Vuurt bij de **lead-poort (scherm 3)**, direct nadat de bezoeker zijn gegevens heeft ingevuld en
de 16 quickscan-vragen heeft beantwoord.

### Toplevel

| Veld | Type | Omschrijving |
|------|------|--------------|
| `event` | string | Altijd `"quickscan_lead"`. |
| `timestamp` | string (ISO 8601) | Moment van versturen, UTC. Onderdeel van de matching-sleutel. |
| `meta` | object | Zie `meta`. |
| `contact` | object | Zie `contact`. |
| `quickscan` | object | Zie `quickscan`. |

### `meta`

| Veld | Type | Omschrijving |
|------|------|--------------|
| `url` | string | Volledige URL van de pagina waarop de scan is ingevuld. |
| `taal` | string | Taalcode van de interface, bijvoorbeeld `"nl"`. |

### `contact`

| Veld | Type | Verplicht | Omschrijving |
|------|------|-----------|--------------|
| `organisatie` | string | ja | Organisatienaam. |
| `sector` | string | nee | Sector of branche. |
| `aantal_medewerkers` | string | nee | Bandbreedte, bijvoorbeeld `"100-250"`. |
| `contactpersoon` | string | nee | Naam van de contactpersoon. |
| `email` | string | ja | E-mailadres. Onderdeel van de matching-sleutel. |
| `telefoon` | string | nee | Telefoonnummer. |
| `toestemming` | boolean | ja | Toestemming voor contact (AVG). Altijd `true` bij verzenden. |

### `quickscan`

| Veld | Type | Omschrijving |
|------|------|--------------|
| `data_score` | number | Rubriekscore Verzuimbeeld en data (0-100). |
| `regie_score` | number | Rubriekscore Leidinggevende regie (0-100). |
| `overall` | number | Gemiddelde van data + regie (0-100). |
| `profiel` | object | Profielroute, zie hieronder. |
| `stoplicht` | object | `{ data, regie }`, elk `"groen"`, `"oranje"` of `"rood"`. |
| `laagste_rubriek` | string | Naam van de laagst scorende quickscan-rubriek. |
| `rapportageteksten` | object | `{ overall, data, regie }`, voorgekauwde rapporttekst per onderdeel, zie hieronder. |
| `tips` | array | Tips bij de laagst scorende rubriek, zie hieronder. |
| `antwoorden` | array | De 16 quickscan-antwoorden, zie hieronder. |

#### `quickscan.profiel`

| Veld | Type | Omschrijving |
|------|------|--------------|
| `route` | string | Route-id: `"R1"` t/m `"R5"`. |
| `naam` | string | Profielnaam, bijvoorbeeld `"Praktische verbeteraar"`. |
| `tekst` | string | Profielomschrijving. |
| `icoon` | string | Emoji-icoon van de route. |

#### `quickscan.rapportageteksten.{overall,data,regie}`

| Veld | Type | Omschrijving |
|------|------|--------------|
| `tekst` | string | Rapportagetekst voor dit onderdeel bij dit stoplicht. |
| `cta` | string | Bijbehorende call-to-action. |

#### `quickscan.tips[]`

| Veld | Type | Omschrijving |
|------|------|--------------|
| `kop` | string | Korte titel van de tip. |
| `tekst` | string | Tiptekst. |

#### `quickscan.antwoorden[]`

| Veld | Type | Omschrijving |
|------|------|--------------|
| `code` | string | Vraagcode, bijvoorbeeld `"VB01"`. |
| `thema` | string | Thema van de vraag. |
| `sub` | string | Sub-label van de vraag. |
| `vraag` | string | Volledige vraagtekst. |
| `antwoord_label` | string | Gekozen antwoord, bijvoorbeeld `"Deels"`. |
| `score` | number, null | Score (0-100), of `null` bij `"Niet van toepassing"`. |

---

## Event 2: `verdieping_compleet`

Vuurt bij het **eindrapport (scherm 9)**, nadat alle 45 verdiepingsvragen zijn beantwoord.
Bevat dezelfde `meta` en `contact` als event 1.

### Toplevel

| Veld | Type | Omschrijving |
|------|------|--------------|
| `event` | string | Altijd `"verdieping_compleet"`. |
| `timestamp` | string (ISO 8601) | Moment van versturen, UTC. |
| `meta` | object | Zelfde structuur als event 1. |
| `contact` | object | Zelfde structuur als event 1. |
| `eindrapport` | object | Zie `eindrapport`. |

### `eindrapport`

| Veld | Type | Omschrijving |
|------|------|--------------|
| `overall` | number | Totaalscore over alle rubrieken (0-100). |
| `stoplicht` | string | `"groen"`, `"oranje"` of `"rood"` voor de overall-score. |
| `rubrieken` | array | Alle 9 rubrieken (de roos), zie hieronder. |
| `top3_prioriteiten` | array | De 3 rubrieken met de hoogste aandachtsscore, zie hieronder. |
| `adviesroute` | string | Aanbevolen adviesroute / vervolgstap. |
| `antwoorden` | array | Alle 61 antwoorden (16 quickscan + 45 verdieping) met volledige tekst, zelfde structuur als `quickscan.antwoorden[]`. |

#### `eindrapport.rubrieken[]`

| Veld | Type | Omschrijving |
|------|------|--------------|
| `thema` | string | Rubrieknaam. |
| `score` | number | Rubriekscore (0-100). |
| `norm` | number | Normscore voor de roos (80). |
| `aandachtsscore` | number | `norm - score`; hoe hoger, hoe meer aandacht nodig. |
| `stoplicht` | string | `"groen"`, `"oranje"` of `"rood"`. |

#### `eindrapport.top3_prioriteiten[]`

| Veld | Type | Omschrijving |
|------|------|--------------|
| `thema` | string | Rubrieknaam. |
| `score` | number | Rubriekscore (0-100). |
| `aandachtsscore` | number | `norm - score`. De drie hoogste aandachtsscores, aflopend. |

---

## Aanbevolen n8n-flow

1. **Webhook** ontvangt de `POST` (handel ook `OPTIONS` af voor CORS, zet de
   `Access-Control-Allow-*` headers).
2. **Wegschrijven naar Google Sheet of database.** Maak per lead een rij aan. Bij event 1
   ontstaat de rij; bij event 2 wordt diezelfde rij verrijkt.
3. **(Event 1)** **PDF renderen** via `n8n/pdf-template.html` (HTML -> PDF) met de
   voorgekauwde teksten uit de payload, en **mailen** naar de lead (`contact.email`) plus de
   adviseur. De payload is rapport-klaar, dus geen extra lookups nodig.
4. **(Event 2)** **Dezelfde rij verrijken** met het volledige eindrapport (roos, top-3,
   adviesroute, alle 61 antwoorden). Eventueel een tweede, uitgebreider PDF-rapport renderen
   en mailen.

### Matching-sleutel

Match event 2 op de bestaande rij via de combinatie **`contact.email` + `timestamp`** van
event 1. De pagina stuurt bij event 2 de email mee en (indien gecacht) de originele event-1
`timestamp`, zodat de twee events betrouwbaar aan dezelfde lead worden gekoppeld. Val terug op
alleen `contact.email` (meest recente open rij) als de event-1 `timestamp` ontbreekt.
