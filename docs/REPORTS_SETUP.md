# Reports layer — setup

> **Stav pre Tomáša (2026-04-22):** všetko je už nakonfigurované. Migrácie
> bežia, secrets (ANTHROPIC_API_KEY, CRON_SECRET, GMAIL_APP_PASSWORD) sú
> uložené v `app_secrets` tabuľke v Supabase. Nič v Vercel env UI
> prenastavovať netreba. Skok rovno na [Verifikácia](#verifikácia).

## Čo Reports stránka robí

Päť scope-ov, každý renderuje rovnakú taxonómiu:

| Scope       | Filter                            | Typické použitie                   |
|-------------|-----------------------------------|------------------------------------|
| Trh         | všetky projekty                   | Mesačný puls trhu                  |
| Mesto       | `p.city` (inferované z district-u)| "Čo sa deje v Bratislave"          |
| Časť mesta  | `p.district`                      | "Petržalka vs. trh"                |
| Projekt     | `p.id`                            | Per-projekt hĺbka                  |
| Developer   | `p.developer`                     | Portfólio developera               |

Sekcie:

1. KPI strip (projekty / byty / voľné / predané / predané % / vážené €/m²)
2. Executive summary (hard-coded SK próza)
3. ✨ AI summary (voliteľný klik na button — volá Claude)
4. Histogram €/m²
5. Rozklad podľa sub-scope-u
6. Benchmark vs širší trh (red/green delta)
7. Project table
8. Historical trend z `project_snapshots`

Header buttons:

- **📧 Odoberať mesačne** — upsert do `report_subscriptions`, cron ti
  1. v mesiaci pošle e-mail.
- **⬇ CSV** — scope-level export.
- **🖨 Stiahnuť PDF** — browser print + print stylesheet.

---

## Architektúra secrets

Namiesto toho, aby si chodil do Vercel UI pridávať API kľúče, uložil
som ich do tabuľky **`public.app_secrets`** v Supabase. Serverless
funkcie (`/api/ai/summary`, `/api/cron/monthly-reports`) najprv
skúsia `process.env.X` a ak je prázdne, siahnu po `app_secrets`
riadku s kľúčom `X`.

Tabuľka má RLS on a **žiadnu** SELECT policy — nikto z browsera (ani
admin) ju nevie prečítať. Jediný kto má prístup je serverless kód
autentikovaný service-role kľúčom.

Aktuálne uložené secrets (overené `select key, length(value)`):

| key                  | dĺžka | účel                                  |
|----------------------|-------|---------------------------------------|
| `ANTHROPIC_API_KEY`  | 108   | Claude Messages API                   |
| `CRON_SECRET`        | 64    | Bearer token pre manuálny trigger cronu |
| `GMAIL_APP_PASSWORD` | 16    | SMTP heslo pre monthly email          |

CRON_SECRET je uložený v `/tmp/cron_secret.txt` na tvojom Macu, keby si
ho potreboval pre manuálny test.

## Databázová štruktúra (už nainštalovaná)

### `ai_usage_log`
Každý AI call sa loguje pre rate-limit + cost tracking:

| column         | type         |
|----------------|--------------|
| id             | bigint (pk)  |
| user_id        | uuid (fk auth.users) |
| endpoint       | text         |
| scope          | text         |
| scope_label    | text         |
| input_tokens   | integer      |
| output_tokens  | integer      |
| ok             | boolean      |
| error          | text         |
| requested_at   | timestamptz  |

RLS: self-read only (používateľ vidí iba svoje vlastné záznamy).

### `report_subscriptions`
Kto dostáva mesačný e-mail:

| column        | type         | default  |
|---------------|--------------|----------|
| user_id (pk)  | uuid         |          |
| email         | text         |          |
| scope         | text         | 'market' |
| scope_label   | text         |          |
| lang          | text         | 'sk'     |
| enabled       | boolean      | true     |
| last_sent_at  | timestamptz  |          |
| created_at    | timestamptz  | now()    |

RLS: self-all (používateľ vidí/píše iba svoj riadok).

### `app_secrets`
Runtime secrets ako fallback pre Vercel env:

| column      | type         |
|-------------|--------------|
| key (pk)    | text         |
| value       | text         |
| updated_at  | timestamptz  |
| notes       | text         |

RLS: zamknuté hard-core, žiadna SELECT policy.

---

## Rate limits

Per-user, rolling hodinové + denné okná:

| Tier  | / hour | / day |
|------:|-------:|------:|
| admin | 60     | 500   |
| paid  | 30     | 200   |
| free  | 5      | 20    |
| anon  | 3      | 10    |

Pri prekročení endpoint vráti **429** + `retry_after_sec` + `tier`. UI
ukáže oranžový hint namiesto red erroru.

---

## Cron schedule

V `vercel.json`:
```json
"crons": [{ "path": "/api/cron/monthly-reports", "schedule": "0 8 1 * *" }]
```

Beží **1. v mesiaci o 08:00 UTC**. Najbližší fire: 1. máj 2026, 08:00.
Môžeš to pozrieť/otestovať na:
<https://vercel.com/tombarder/residata/settings/cron-jobs>

### Manuálny trigger (admin only)
```bash
curl -X POST https://residata.eu/api/cron/monthly-reports \
     -H "Authorization: Bearer $(cat /tmp/cron_secret.txt)"
```

(alebo si pozri CRON_SECRET vyššie / v app_secrets tabuľke)

---

## Verifikácia

1. **AI end-to-end** — otvor <https://residata.eu/app/reports>,
   klikni `✨ Vygenerovať` v ľubovoľnom scope. Mal by prísť ~5-odsekový SK text.
2. **Rate limit** — stlač Vygenerovať 6× rýchlo za sebou. Šiesty klik
   (alebo 31. ak si paid) vráti žltý "limit reached" hint.
3. **Subscribe** — `📧 Odoberať mesačne` zmení sa na `✓ Odoberá sa`.
   Overím v Supabase: tvoj riadok v `report_subscriptions` s `enabled=true`.
4. **Cron manuálny test** — spusti curl príkaz vyššie; odpoveď obsahuje
   `subscribers`, `sent_ok`, `sent_fail`, `results[]`.
5. **SQL audit** — v
   <https://supabase.com/dashboard/project/mtclsrswxtjseewyrcbx/editor>:
   - `ai_usage_log` → zoznam tvojich AI volaní + token counts
   - `report_subscriptions` → tvoj opt-in
   - `app_secrets` → 3 riadky (UI ich neukáže ak nie si admin — to je dobré).

---

## Troubleshooting

| Symptóm | Čo to znamená |
|---------|---------------|
| `501 AI disabled` | Ani env ani app_secrets nemá ANTHROPIC_API_KEY (teraz nemalo by sa stať) |
| `429 rate limit` | Používateľ prekročil hourly/daily cap; zvýš tier v `user_profiles.tier` |
| `anthropic HTTP 401` | Kľúč zlý alebo expiroval; zaktualizuj `app_secrets.value` pre `ANTHROPIC_API_KEY` |
| `anthropic HTTP 429` | Rate-limit na Anthropic strane; počkaj / upgrade ich plán |
| Cron nebehal | <https://vercel.com/tombarder/residata/logs> → filter "cron". Hobby Vercel povoľuje iba daily; Monthly funguje na každom pláne |
| Email neprišiel | Gmail dáva free účtu 500/deň; pre >20 subscriberov prejsť na Resend/Postmark |

---

## Rollback / rotácia kľúčov

**Ak chceš kľúč zmeniť** (napr. vyrotuj Anthropic key):
```sql
update app_secrets
   set value = 'sk-ant-nový...', updated_at = now()
 where key = 'ANTHROPIC_API_KEY';
```

Spustené v Supabase SQL editore. Serverless funkcia ho prečíta pri
najbližšom requeste — cache-free, žiadny deploy netreba.

**Ak chceš spraviť Vercel env oficiálnym** (a DB fallback len zálohovým):
Pridaj `ANTHROPIC_API_KEY` do
<https://vercel.com/tombarder/residata/settings/environment-variables>.
`process.env` win vs app_secrets, takže Vercel okamžite prevezme kontrolu.

**Ak chceš AI úplne vypnúť**:
```sql
delete from app_secrets where key = 'ANTHROPIC_API_KEY';
```
A zároveň vymaž Vercel env (ak tam je). Endpoint začne vracať 501,
UI skryje button.
