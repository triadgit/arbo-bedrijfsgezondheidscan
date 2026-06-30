# Arbo Concern: Bedrijfsgezondheidscan

Statische marketing-landingspagina met een tweetraps bedrijfsgezondheidscan, in de huisstijl
van Arbo Concern. Te hosten op `scan.arboconcern.nl`.

## Wat is dit

Een op zichzelf staande landingspagina (zonder de gewone header/footer, alleen een kale merkbalk
met logo) die bezoekers door een bedrijfsgezondheidscan leidt:

1. Een **quickscan** van 16 vragen (1 vraag per scherm).
2. Een **lead-poort**: na de quickscan vult de bezoeker eerst gegevens in, daarna verschijnt het
   profiel met stoplicht en tips.
3. Een optionele **verdieping** van 45 extra vragen, die eindigt in een eindrapport met een
   roos/radar en de top-3 aandachtspunten.

De pagina is **statisch en build-loos** (vanilla JS, ES-modules). Alle scan-logica, vragen,
teksten en instellingen staan in losse JSON-configbestanden onder `public/config/`. De pagina
slaat zelf niets op: leads gaan via een **n8n-webhook** (`POST`, fire-and-forget). n8n rendert
en mailt vervolgens het gebrande PDF-rapport. De pagina maakt zelf geen PDF.

Er worden geen medische persoonsgegevens verwerkt, alleen gegevens op organisatieniveau. Fonts
zijn self-hosted (geen externe calls) en er is standaard geen tracking.

## Mapstructuur

```
arbo-bedrijfsgezondheidscan/
├── public/                      <- de deployable web root (dit is alles wat live moet)
│   ├── index.html
│   ├── assets/
│   │   ├── css/scan.css
│   │   ├── js/
│   │   │   ├── scoring.js        pure, DOM-vrije scorelogica (ook gebruikt door de tests)
│   │   │   └── scan.js           UI/flow van de funnel
│   │   ├── fonts/                self-hosted Comfortaa + Lato (woff2)
│   │   └── img/                  logo's (arboconcern-logo.svg + -white.svg)
│   └── config/
│       ├── questions.json        alle vragen (quickscan + verdieping), thema's en sub-labels
│       ├── scoring.json          antwoordwaarden, drempels, profielroutes, norm (roos)
│       ├── content.json          alle teksten: intro, profielen, tips, rapportageteksten
│       └── settings.json         instellingen: webhook, links, kleuren, lead-velden
├── n8n/
│   ├── webhook-contract.md       het contract van de twee webhook-events
│   ├── pdf-template.html         HTML-template dat n8n naar PDF rendert
│   └── sample-payload.json       voorbeeldpayload om de n8n-flow mee te testen
├── tests/scoring.test.mjs        node --test op de scorelogica
├── Dockerfile
├── docker-compose.yml
└── README.md
```

Wat elk configbestand doet:

- **questions.json**: de daadwerkelijke vragen, ingedeeld in thema's en sub-labels, voor zowel de
  quickscan als de verdieping. Hier pas je vraagteksten aan zonder code aan te raken.
- **scoring.json**: de scoreregels (antwoordwaarden zoals Ja volledig=100 ... Nee=0, N.v.t. telt
  niet mee), de stoplichtdrempels (Groen >= 75, Oranje 55-74, Rood < 55), de norm voor de roos
  (80) en de profielroutes R1-R5.
- **content.json**: alle teksten die de bezoeker ziet: intro, profielomschrijvingen, tips en de
  voorgekauwde rapportageteksten die ook in de webhook-payload meegaan.
- **settings.json**: de knoppen die je bij oplevering omzet: webhook-URL, privacy/advies-links,
  merkkleuren en de lead-velden.

## Configureren

Alle aanpassingen gaan via de JSON-bestanden in `public/config/`. Code raak je niet aan.

### Webhook aanzetten (`public/config/settings.json`)

Standaard staat de webhook uit. Om leads naar n8n te sturen:

1. Vul `webhook_url` met de productie-URL van de n8n-webhook.
2. Zet `webhook_enabled` op `true`.

```json
{
  "webhook_url": "https://n8n.example.nl/webhook/arbo-scan",
  "webhook_enabled": true
}
```

Zolang `webhook_enabled` `false` is of `webhook_url` leeg is, draait de scan wel maar wordt er
niets verstuurd (handig bij lokaal testen).

### Links

- `privacy_url`: link naar het privacybeleid (getoond bij de toestemming-checkbox).
- `advies_url`: link naar de contact-/adviespagina.

### Kleuren (huisstijl)

Onder `branding` staan de design-tokens die als CSS custom properties in de pagina worden
geladen. Pas hier de huisstijlkleuren aan (`primary` oranje `#ec641a`, `accent` teal `#79c6c0`,
enzovoort) en de logo-paden.

### Lead-velden

`lead_fields` bepaalt welke velden de lead-poort toont en welke verplicht zijn. Verplicht in v1:
`organisatie`, `email` en `toestemming`. Optioneel: `sector`, `aantal_medewerkers`,
`contactpersoon`, `telefoon`. Je kunt labels, volgorde en `required` hier aanpassen.

### Vragen en teksten

Vragen pas je aan in `questions.json`, teksten (intro, profielen, tips, rapportage) in
`content.json`. Beide zonder ook maar één regel code te wijzigen. Let op: als je vragen of
thema's wijzigt, controleer dan dat `scoring.json` daar nog bij past (rubrieken/profielroutes).

## Lokaal draaien

ES-modules en `fetch()` van de JSON-config werken niet via `file://`. Start daarom een eenvoudige
http-server vanuit `public/`:

```bash
cd public
python3 -m http.server 8000
```

Open daarna `http://localhost:8000`.

## Deploy optie A: kale zip

De site is volledig statisch, dus elke webhost volstaat.

1. Zip de **inhoud** van `public/` (dus `index.html`, `assets/` en `config/` in de root van de zip,
   niet de map `public/` zelf).
2. Plaats die op de webhost onder `scan.arboconcern.nl`.
3. Pas alleen `config/settings.json` aan: `webhook_url` invullen en `webhook_enabled: true`.

Verder is er niets te bouwen of te installeren.

## Deploy optie B: Coolify (Docker)

De repo bevat een `Dockerfile` (nginx:alpine die `public/` serveert) en een `docker-compose.yml`.

- **Coolify**: kan rechtstreeks vanuit de `Dockerfile` bouwen (geen compose nodig). Stel het
  domein in Coolify in: begin met een **Triad-subdomein** om te testen en zet dat later om naar
  een **CNAME `scan.arboconcern.nl`**.
- **Lokaal/zelf testen met Docker**:

  ```bash
  docker compose up --build
  # site op http://localhost:8080
  ```

De nginx-config zet gzip aan voor css/js/json/svg, geeft `assets/` en woff2-fonts een lange cache
en houdt `index.html` en `config/*.json` op `no-cache`, zodat content-edits direct live gaan.

**Let op (Cloudflare-wildcard-gotcha)**: als het DNS-beheer een wildcard-record (`*`) heeft, kan
een nieuw subdomein onbedoeld via een verkeerde origin of proxy-instelling lopen. Controleer bij
het toevoegen van `scan.arboconcern.nl` dat het CNAME-record specifiek naar de juiste origin wijst
en dat de proxy-/SSL-instelling klopt, in plaats van te leunen op de wildcard.

## n8n-webhook

Het volledige contract staat in `n8n/webhook-contract.md`. Kort:

- De pagina doet twee `POST`-calls naar `settings.webhook_url`:
  - **`quickscan_lead`** bij de lead-poort (met contactgegevens + quickscan-uitslag).
  - **`verdieping_compleet`** na de verdieping (met het eindrapport).
- De webhook in n8n moet **CORS** van de scan-origin (`scan.arboconcern.nl`) toestaan, anders
  blokkeert de browser de `POST`.
- n8n **rendert en mailt** het gebrande PDF-rapport op basis van `n8n/pdf-template.html`. De
  payload bevat per antwoord de volledige vraagtekst, het thema en het sub-label plus de
  voorgekauwde rapportageteksten, zodat n8n niets opnieuw hoeft af te leiden.

De calls zijn fire-and-forget met een korte timeout en falen nooit de funnel. Bij een mislukte
call wordt de payload in `localStorage` bewaard en bij het volgende event opnieuw geprobeerd.

## Rooktest-checklist

Loop deze stappen handmatig door na een deploy of contentwijziging:

1. Doorloop de **16 quickscan-vragen** en geef per vraag een antwoord.
2. Kom bij de **lead-poort**: controleer dat verplichte velden (organisatie, e-mail, toestemming)
   afgedwongen worden.
3. Controleer dat het **profiel en het stoplicht** kloppen bij de gegeven antwoorden.
4. Controleer dat de bijbehorende **tips** verschijnen (en de melding "rapport onderweg").
5. Doorloop de **verdieping** (45 extra vragen).
6. Controleer het **eindrapport**: de roos/radar met normlijn op 80% en de **top-3
   aandachtspunten**.
7. Controleer in n8n dat **beide webhook-events** binnenkomen (`quickscan_lead` en
   `verdieping_compleet`) en dat de PDF-mail wordt verstuurd.

## Tests

De scorelogica is een pure, DOM-vrije module en wordt getest met de ingebouwde test-runner:

```bash
node --test
```

Dit draait `tests/scoring.test.mjs`: de 5 profielroutes inclusief grensgevallen (54/55/74/75),
de N.v.t.-uitsluiting en de top-3-prioriteit.

## Overdracht

Arbo Concern krijgt een volledig statisch, overdraagbaar pakket dat op elke host of via Coolify
draait. Zelf te beheren, zonder ontwikkelaar of build-stap:

- **Vragen** aanpassen in `public/config/questions.json`.
- **Teksten** (intro, profielen, tips, rapportage) in `public/config/content.json`.
- **Scoreregels, drempels en profielroutes** in `public/config/scoring.json`.
- **Instellingen** in `public/config/settings.json`: webhook-URL, privacy-/advieslinks,
  huisstijlkleuren en lead-velden.

De n8n-webhook en de PDF-mail (template + verzending) worden aan de n8n-kant beheerd; zie de
bestanden in `n8n/`.
