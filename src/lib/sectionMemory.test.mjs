import { test } from "node:test";
import assert from "node:assert/strict";
import { inProjectsSection, sidebarTarget, sidebarActive, PROJECTS_LIST } from "./sectionMemory.js";

const DETAIL = "App:ProjectDetail:dostupne-byvanie-nitra";

test("the Projects section is the list and any project's detail — nothing else", () => {
  assert.ok(inProjectsSection(PROJECTS_LIST));
  assert.ok(inProjectsSection(DETAIL));
  assert.ok(!inProjectsSection("App:Analytics"));
  assert.ok(!inProjectsSection("App:ProjectDetail:"));   // no id is not a page
  assert.ok(!inProjectsSection(null));
  assert.ok(!inProjectsSection(undefined));
});

test("from elsewhere, Projekty reopens the page you were last on inside it", () => {
  // Boss's case: a project open → Analytics → Projekty must bring the project back.
  assert.equal(sidebarTarget(PROJECTS_LIST, "App:Analytics", DETAIL), DETAIL);
  assert.equal(sidebarTarget(PROJECTS_LIST, "App:Map", PROJECTS_LIST), PROJECTS_LIST);
});

test("from inside the section, Projekty goes to the list", () => {
  assert.equal(sidebarTarget(PROJECTS_LIST, DETAIL, DETAIL), PROJECTS_LIST);
  assert.equal(sidebarTarget(PROJECTS_LIST, PROJECTS_LIST, DETAIL), PROJECTS_LIST);
});

test("a remembered value that is not a Projects page is ignored, never followed", () => {
  // Saved preferences are user-writable; a foreign page must not hijack the entry.
  assert.equal(sidebarTarget(PROJECTS_LIST, "App:Sales", "App:Admin"), PROJECTS_LIST);
  assert.equal(sidebarTarget(PROJECTS_LIST, "App:Sales", "javascript:alert(1)"), PROJECTS_LIST);
  assert.equal(sidebarTarget(PROJECTS_LIST, "App:Sales", undefined), PROJECTS_LIST);
});

test("every other entry goes exactly where it always went", () => {
  assert.equal(sidebarTarget("App:Analytics", DETAIL, DETAIL), "App:Analytics");
  assert.equal(sidebarTarget("App:UnitTimeline", "App:Map", DETAIL), "App:UnitTimeline");
});

test("Projekty is highlighted on a project's detail page", () => {
  assert.ok(sidebarActive(PROJECTS_LIST, DETAIL));
  assert.ok(sidebarActive(PROJECTS_LIST, PROJECTS_LIST));
  assert.ok(!sidebarActive(PROJECTS_LIST, "App:Analytics"));
  assert.ok(sidebarActive("App:Analytics", "App:Analytics"));
  assert.ok(!sidebarActive("App:Analytics", DETAIL));
});
