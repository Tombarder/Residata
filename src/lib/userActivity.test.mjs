// admin → a person's activity: the words on top of the numbers. Each rule here is
// one Boss would read wrong if it drifted ("Power user" for one visit, a script's
// sign-ins shown as a browser, a declined cookie read as "does nothing").

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeUserAgent, fmtMinutes, deltaLine, engagementOf, usualTimes, summarize, eventName, exportName, relDays,
} from "./userActivity.js";
import { pageTitle } from "./pageTitles.js";

const NOW = new Date("2026-10-07T10:00:00+02:00");

test("a browser is named by browser and system, a script as a script", () => {
  assert.equal(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36").label, "Chrome · macOS");
  assert.equal(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1").label, "Safari · iPhone");
  assert.equal(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1").device, "phone");
  assert.equal(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0").label, "Edge · Windows");
  const py = describeUserAgent("Python-urllib/3.13");
  assert.equal(py.script, true);
  assert.equal(py.label, "Script (Python)");
  assert.equal(describeUserAgent("").label, "—");
});

test("minutes read as time", () => {
  assert.equal(fmtMinutes(0), "0 min");
  assert.equal(fmtMinutes(0.4), "< 1 min");
  assert.equal(fmtMinutes(45.2), "45 min");
  assert.equal(fmtMinutes(134), "2 h 14 min");
  assert.equal(fmtMinutes(120), "2 h");
});

test("the change line says which way, by how much, and what it was before", () => {
  assert.deepEqual(deltaLine(5, 2, "en"), { dir: "up", text: "▲ 3 (before: 2)" });
  assert.equal(deltaLine(1, 4, "sk").text, "▼ 3 (predtým 4)");
  assert.equal(deltaLine(0, 0, "en").text, "none before either");
  assert.equal(deltaLine(3, 3, "sk").text, "rovnako ako predtým");
  assert.equal(deltaLine(33.8, 44.2, "en").text, "▼ 10.4 (before: 44.2)");
  assert.equal(deltaLine(134, 60, "en", fmtMinutes).text, "▲ 1 h 14 min (before: 1 h)");
});

const base = (over = {}) => ({
  days: 30,
  person: { created_at: "2026-06-01T00:00:00Z", first_activity_at: "2026-06-02T00:00:00Z", last_active_at: "2026-10-05T10:00:00Z", ...(over.person || {}) },
  kpis: { cur: { active_days: 0, ...(over.cur || {}) }, prev: {} },
  sign_ins: { total: 3 },
  ...over.rest,
});

test("engagement is measured on active days, and a new account is not punished for being new", () => {
  assert.equal(engagementOf(base({ cur: { active_days: 14 } }), NOW).key, "power");
  assert.equal(engagementOf(base({ cur: { active_days: 6 } }), NOW).key, "regular");
  assert.equal(engagementOf(base({ cur: { active_days: 1 } }), NOW).key, "occasional");
  assert.equal(engagementOf(base(), NOW).key, "dormant");
  assert.equal(engagementOf(base({ person: { first_activity_at: null }, rest: { sign_ins: { total: 1 } } }), NOW).key, "never");
  // signed up 4 days ago, active on 3 of them: that is a power user, not "occasional"
  assert.equal(engagementOf(base({ person: { created_at: "2026-10-03T12:00:00+02:00" }, cur: { active_days: 3 } }), NOW).key, "power");
});

test("usual times need enough data, and name the busy days in calendar order", () => {
  assert.equal(usualTimes([{ dow: 2, hour: 9, n: 2 }]), null);
  const h = [
    { dow: 4, hour: 10, n: 6 }, { dow: 2, hour: 9, n: 5 }, { dow: 2, hour: 11, n: 4 },
    { dow: 6, hour: 20, n: 1 },
  ];
  const u = usualTimes(h, "en");
  assert.equal(u.days, "Tue, Thu");
  assert.equal(u.hours, "9:00–12:00");
  assert.equal(u.weekend, false);
  assert.equal(usualTimes(h, "sk").days, "ut, št");
});

test("the summary says what, how much and when — and that a declined cookie hides pages", () => {
  const d = base({
    cur: { active_days: 6, active_min: 134, project_views: 12, exports: 2, ai_questions: 3 },
    person: { analytics_consent: false, has_stripe_subscription: false },
    rest: {
      sections: [{ page: "App:Map2", active_min: 80, visits: 10 }, { page: "App:Sales", active_min: 30, visits: 4 }],
      heatmap: [{ dow: 2, hour: 9, n: 5 }, { dow: 4, hour: 10, n: 6 }],
      features: [{ event: "checkout_started", n: 2 }],
    },
  });
  const en = summarize(d, { lang: "en", now: NOW, pageName: (k) => pageTitle(k, "en") });
  assert.match(en, /Active on 6 of the last 30 days, 2 h 14 min of active use/);
  assert.match(en, /Mostly Market Radar and Sales; usually Tue, Thu, 9:00–12:00\./);
  assert.match(en, /12 project views, 2 downloads, 3 AI questions\./);
  assert.match(en, /Pressed Subscribe \(2×\) but has no subscription\./);
  assert.match(en, /Declined analytics cookies/);
  const sk = summarize(d, { lang: "sk", now: NOW, pageName: (k) => pageTitle(k, "sk") });
  assert.match(sk, /Aktivita v 6 z posledných 30 dní/);
  assert.match(sk, /Najviac Trhový radar a Predaje/);
  // no gendered past tense in the Slovak text
  assert.doesNotMatch(sk, /\b(bol|nebol|klikol|stiahol|aktívny|odmietol)\b/i);
});

test("nothing in the window still says when they were last here", () => {
  const s = summarize(base(), { lang: "en", now: NOW });
  assert.match(s, /No activity in the last 30 days\. Last active 2 days ago\./);
  assert.match(summarize(base({ person: { last_active_at: null } }), { lang: "en", now: NOW }), /Has not used the platform/);
});

test("events, downloads and pages have human names", () => {
  assert.equal(eventName("checkout_started", "en"), "Pressed Subscribe");
  assert.equal(eventName("some_new_event", "en"), "some new event");
  assert.equal(exportName("pivot_table", "sk"), "Pivot — tabuľka");
  assert.equal(pageTitle("App:Map2", "sk"), "Trhový radar");
  assert.equal(pageTitle("App:ProjectDetail:abc", "en"), "Project detail");
  assert.equal(relDays(new Date("2026-10-06T09:00:00+02:00"), NOW, "en"), "yesterday");
});
