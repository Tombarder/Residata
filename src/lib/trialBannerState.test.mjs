/**
 * The trial banner is decided before the first paint (lib/trialBannerState),
 * so it is drawn in the app's first frame instead of pushing the fixed nav down
 * one frame later — the layout shift Lighthouse measured on every marketing page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { firstPaintBanner, hasStoredSession, firstPaintScript, KEY_BANNER_DISMISSED, KEY_OFFER_REMEMBERED } from "./trialBannerState.js";
import { LANG_STORAGE_KEY } from "./locale.js";
import { addressLang, initialPick, shownLang } from "./langChoice.js";

function store(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null) };
}
const NOW = Date.parse("2026-09-28T12:00:00Z");
const SESSION = { "sb-mtclsrswxtjseewyrcbx-auth-token": "{}" };

test("an anonymous visitor is offered the trial from the first frame", () => {
  assert.deepEqual(firstPaintBanner(store(), NOW), { dismissed: false, eligible: true });
});

test("a dismissal stands until it expires", () => {
  assert.equal(firstPaintBanner(store({ [KEY_BANNER_DISMISSED]: String(NOW + 1000) }), NOW).dismissed, true);
  assert.equal(firstPaintBanner(store({ [KEY_BANNER_DISMISSED]: String(NOW - 1000) }), NOW).dismissed, false);
});

test("a logged-in visitor gets the answer remembered from the last visit, never a guess", () => {
  assert.equal(hasStoredSession(store(SESSION)), true);
  assert.equal(hasStoredSession(store({ "sb-x-something-else": "1", residata_lang: "sk" })), false);
  assert.equal(firstPaintBanner(store(SESSION), NOW).eligible, false, "nothing remembered: not shown until the profile says so");
  assert.equal(firstPaintBanner(store({ ...SESSION, [KEY_OFFER_REMEMBERED]: "1" }), NOW).eligible, true);
  assert.equal(firstPaintBanner(store({ ...SESSION, [KEY_OFFER_REMEMBERED]: "0" }), NOW).eligible, false);
});

test("blocked storage reads as an anonymous visitor, not a crash", () => {
  const blocked = { get length() { throw new Error("SecurityError"); }, key() { throw new Error("x"); }, getItem() { throw new Error("x"); } };
  assert.deepEqual(firstPaintBanner(blocked, NOW), { dismissed: false, eligible: true });
});

// Addresses with and without a language of their own, in the shapes a visitor
// can type them — the script parses the address itself, so each shape counts.
const PATHS = ["/", "/pricing", "/sk", "/sk/", "/SK/Cennik", "/sk/cennik", "/sk/nothing-here",
  "/skyline", "/sk-foo", "/analyzy", "/analyzy/ba-prehlad-2026-q3", "/app/projects"];

test("the before-paint script reaches the app's answer in every state, on every address", () => {
  // It runs in <head> before the app, so a pre-built page shows the banner the
  // app will show; if the two ever disagreed, the text would jump by a banner.
  const script = firstPaintScript();
  const future = String(Date.now() + 86400000), past = String(Date.now() - 86400000);
  const states = [];
  for (const session of [false, true]) for (const remembered of [null, "1", "0"])
    for (const dismissed of [null, future, past]) for (const lang of [null, "sk", "en", "cs", "xx"]) {
      const e = {};
      if (session) e["sb-mtclsrswxtjseewyrcbx-auth-token"] = "{}";
      if (remembered !== null) e[KEY_OFFER_REMEMBERED] = remembered;
      if (dismissed !== null) e[KEY_BANNER_DISMISSED] = dismissed;
      if (lang !== null) e[LANG_STORAGE_KEY] = lang;
      states.push(e);
    }
  let checked = 0;
  for (const pathname of PATHS) for (const e of states) {
    const attrs = {};
    const ctx = { window: { localStorage: store(e), location: { pathname } },
      document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } }, Date };
    vm.runInNewContext(script, ctx);
    const app = firstPaintBanner(store(e));
    // what App.jsx renders first: lib/langChoice, from the same address and storage
    const shown = shownLang(addressLang(pathname), initialPick(pathname, store(e)));
    const want = app.eligible && !app.dismissed ? shown : "none";
    assert.equal(attrs["data-rd-banner"], want, `${pathname} ${JSON.stringify(e)}`);
    checked++;
  }
  assert.equal(checked, PATHS.length * 90);
  // blocked storage: the app shows the banner in the address's language, else its default
  for (const pathname of PATHS) {
    const attrs = {};
    vm.runInNewContext(script, { window: { get localStorage() { throw new Error("SecurityError"); }, location: { pathname } },
      document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } }, Date });
    const blocked = { getItem() { throw new Error("SecurityError"); } };
    assert.equal(attrs["data-rd-banner"], shownLang(addressLang(pathname), initialPick(pathname, blocked)), pathname);
  }
});

test("a Slovak address shows Slovak whatever the pick; every other address shows the pick", () => {
  const kept = (lang) => store({ [LANG_STORAGE_KEY]: lang });
  // an English pick opening a Slovak link: the Slovak page, and the pick untouched
  assert.equal(shownLang(addressLang("/sk/cennik"), initialPick("/sk/cennik", kept("en"))), "sk");
  assert.equal(initialPick("/sk/cennik", kept("en")), "en");
  // a first visit on a Slovak address picks Slovak; on an ordinary one, English (Boss 2026-08-15)
  assert.equal(initialPick("/sk/cennik", store()), "sk");
  assert.equal(initialPick("/pricing", store()), "en");
  assert.equal(shownLang(addressLang("/"), initialPick("/", store())), "en");
  // a Slovak pick on an English address shows Slovak (the app then moves the address)
  assert.equal(shownLang(addressLang("/pricing"), initialPick("/pricing", kept("sk"))), "sk");
  // the analyses and the app have no language address: they show the pick
  assert.equal(shownLang(addressLang("/analyzy"), "en"), "en");
  assert.equal(shownLang(addressLang("/app/projects"), "sk"), "sk");
  // a stale or unknown pick is no pick
  assert.equal(initialPick("/", kept("cs")), "en");
  assert.equal(initialPick("/sk", kept("xx")), "sk");
  // look-alikes are not Slovak addresses
  for (const p of ["/skyline", "/sk-foo", "/pricing/sk"]) assert.equal(addressLang(p), null, p);
});
