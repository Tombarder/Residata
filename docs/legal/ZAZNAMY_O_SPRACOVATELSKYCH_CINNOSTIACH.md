# Záznamy o spracovateľských činnostiach

**Prevádzkovateľ:** Kamhal & Co. s. r. o., Krasovského 13, 851 01 Bratislava – mestská časť Petržalka, Slovenská republika
**IČO:** 57 849 471 · Zapísaná v Obchodnom registri Mestského súdu Bratislava III, oddiel: Sro, vložka č. 203519/B
**Kontakt:** info@residata.eu
**Zodpovedná osoba (DPO):** nemenovaná — nespĺňame podmienky čl. 37 GDPR (nevykonávame rozsiahle systematické monitorovanie ani rozsiahle spracúvanie osobitných kategórií údajov)

**Vedené podľa:** čl. 30 ods. 1 Nariadenia (EÚ) 2016/679 (GDPR)
**Zostavené:** 3. septembra 2026 · **Verzia:** 1.0

> **Čo je to a prečo to existuje.** Toto nie je dokument pre web. Je to interný
> register, ktorý musí byť na požiadanie predložený Úradu na ochranu osobných
> údajov, a ktorý si pýtajú firemní nákupcovia v bezpečnostných dotazníkoch.
> Každý riadok nižšie bol overený voči reálne bežiacemu systému (kód, databáza,
> DNS), nie voči staršej verzii tohto dokumentu.
>
> **Nebolo skontrolované právnikom.** Obsah je vecne overený; právne
> posúdenie formulácií je samostatný krok.

---

## 1. Prehľad spracovateľských činností

| # | Činnosť | Kategórie dotknutých osôb | Kategórie údajov | Právny základ | Doba uchovávania |
|---|---|---|---|---|---|
| 1 | **Používateľské účty a prihlasovanie** | zákazníci a záujemcovia (fyzické osoby konajúce za podnikateľa) | e-mail, meno (voliteľné), identifikátor účtu, stav prístupu, čas posledného prihlásenia | čl. 6 ods. 1 písm. b — plnenie zmluvy / opatrenia pred uzavretím zmluvy | kým trvá účet; do 30 dní od žiadosti o zmazanie |
| 2 | **Predplatné a platby** | platiaci zákazníci | fakturačné meno a adresa, identifikátor zákazníka a predplatného u platobnej brány, stav platby, platnosť prístupu | čl. 6 ods. 1 písm. b — plnenie zmluvy; čl. 6 ods. 1 písm. c — účtovné a daňové povinnosti | účtovné doklady 10 rokov (zákon o účtovníctve); ostatné kým trvá účet |
| 3 | **Záznamy o používaní služby** | prihlásení používatelia | identifikátor používateľa, navštívené sekcie, čas, typ prehliadača | čl. 6 ods. 1 písm. a — **súhlas** (analytika beží len po súhlase v cookie lište) | údaje viazané na osobu do 90 dní od zrušenia účtu; agregované anonymné bez obmedzenia |
| 4 | **AI asistent** | prihlásení používatelia, ktorí ho použijú | text otázky, identifikátor používateľa, čas | čl. 6 ods. 1 písm. b — poskytovanie funkcie služby | najviac 12 mesiacov |
| 5 | **Spätná väzba a podpora** | používatelia, ktorí nás kontaktujú | e-mail, obsah správy, voliteľná snímka obrazovky | čl. 6 ods. 1 písm. b a písm. f — vybavenie požiadavky | kým trvá účet + primeraná doba na doriešenie |
| 6 | **Bezpečnosť a prevencia zneužitia** | všetci používatelia | technické logy prístupu, identifikátor relácie | čl. 6 ods. 1 písm. f — oprávnený záujem na stabilite a bezpečnosti služby | krátkodobo, v rozsahu logov poskytovateľov infraštruktúry |
| 7 | **Obchodné oslovenie developerov** | kontaktné osoby u developerských spoločností | meno, pracovná pozícia, pracovný e-mail alebo profil na LinkedIn, zamestnávateľ | čl. 6 ods. 1 písm. f — oprávnený záujem na priamom marketingu voči podnikateľom (test vyváženia: `OUTREACH_OPRAVNENY_ZAUJEM.md`) | do námietky; inak najviac 24 mesiacov od posledného kontaktu |

### Čo NIE je osobný údaj v tomto produkte

Jadro produktu — údaje o novostavbách (ceny, plochy, dostupnosť, projekty,
developerské **spoločnosti**) — nie sú osobné údaje. Databáza developerov
(`reference.developers`) obsahuje **iba** názov spoločnosti, krajinu, webovú
stránku a firemný profil na LinkedIn; **žiadne osoby**. Overené 3. 9. 2026
priamo v schéme databázy.

Jediné miesto, kde spracúvame osobné údaje ľudí, ktorí nie sú našimi
používateľmi, je činnosť č. 7 — obchodný zoznam kontaktov.

---

## 2. Príjemcovia a sprostredkovatelia

| Sprostredkovateľ | Čo pre nás robí | Kde spracúva | Prenos mimo EÚ |
|---|---|---|---|
| **Supabase Inc.** | databáza a autentifikácia | EÚ (Frankfurt) | nie |
| **Vercel Inc.** | hosting webovej aplikácie | globálna CDN, primárny región EÚ | áno — štandardné zmluvné doložky |
| **Stripe Payments Europe, Ltd.** | spracovanie platieb a správa predplatného | EÚ (Írsko) | nie |
| **Anthropic PBC** | AI asistent (spracovanie otázok) | USA | áno — štandardné zmluvné doložky |
| **Resend (Plus Five Five, Inc.)** | odosielanie transakčných e-mailov | USA | áno — štandardné zmluvné doložky |
| **Forward Email LLC** | doručovanie pošty na info@residata.eu | USA | áno — štandardné zmluvné doložky |
| **Google LLC** | poštová schránka prevádzkovateľa | USA | áno — štandardné zmluvné doložky |

Osobné údaje **nepredávame** a neposkytujeme tretím stranám na ich vlastné
marketingové účely.

> **Poznámka k údržbe.** Tento zoznam musí zodpovedať zoznamu v Zásadách
> ochrany osobných údajov na webe. Oba vychádzajú z toho, čo systém reálne
> používa — nie z toho, čo sa kedysi používalo. Keď pribudne alebo odíde
> dodávateľ, mení sa obidve miesta naraz.

---

## 3. Technické a organizačné opatrenia (čl. 32)

Overené voči nasadenému systému, nie voči zámeru:

- **Prístup k dátam na úrovni databázy** — Row Level Security nad všetkými
  tabuľkami s údajmi; prístup je viazaný na aktívne predplatné, nie iba na
  úroveň účtu. Denná automatická kontrola, ktorá zlyhá, ak sa v katalógu
  objaví pohľad obchádzajúci túto bránu.
- **Prenos** — HTTPS s HSTS vrátane preload, prísna Content-Security-Policy,
  zákaz vkladania stránky do rámca, `no-store` na API odpovediach.
- **Tajomstvá** — servisné kľúče výhradne na serveri, automatické skenovanie
  na úniky pri každej zmene kódu.
- **Zálohy a obnova** — nočný logický export s hlasitým zlyhaním, 90-dňová
  retencia, nacvičený scenár obnovy.
- **Monitoring** — dvojkanálové upozorňovanie (e-mail + Telegram) na výpadky a
  anomálie.
- **Postup pri úniku údajov** — písomný runbook vrátane 72-hodinovej
  ohlasovacej povinnosti podľa čl. 33.
- **Auditná stopa administrátorských zásahov** — `public.admin_audit_log`
  (zmazanie používateľa, udelenie a odobratie skúšobnej doby, zmena
  predplatného).

### Čo zatiaľ chýba (evidované, nie zamlčané)

- Externý dohľad nad dostupnosťou a verejná stavová stránka.
- Sledovanie chýb v prehliadači.
- Point-in-time recovery u poskytovateľa databázy — nočný export nezahŕňa
  autentifikačné údaje, takže obnova by nevrátila prihlásenia.
- Penetračný test treťou stranou.

---

## 4. Práva dotknutých osôb — ako sa uplatňujú v praxi

| Právo | Ako je zabezpečené |
|---|---|
| Prístup a prenosnosť | samoobslužný export údajov v aplikácii (Nastavenia → Údaje a súkromie) |
| Vymazanie | samoobslužné zmazanie účtu v tej istej sekcii; inak na žiadosť do 30 dní |
| Oprava | v profile používateľa, prípadne na žiadosť |
| Obmedzenie a námietka | na žiadosť na info@residata.eu |
| Odvolanie súhlasu | cookie lišta a odkaz „Nastavenia cookies“ v päte webu |

Lehota na odpoveď: **30 dní**.

---

## 5. História dokumentu

| Dátum | Zmena |
|---|---|
| 2026-09-03 | Prvá verzia. Zostavená v deň zápisu spoločnosti do obchodného registra; každá činnosť, sprostredkovateľ a opatrenie overené voči bežiacemu systému. |
