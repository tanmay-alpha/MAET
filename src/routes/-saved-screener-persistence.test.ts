import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const screenerSource = readFileSync(join(import.meta.dir, "_app.screener.tsx"), "utf8");
const clientSource = readFileSync(join(import.meta.dir, "../lib/trpc.ts"), "utf8");
const hookSource = readFileSync(
  join(import.meta.dir, "../hooks/use-research-workspace.ts"),
  "utf8",
);
const workspaceSource = `${clientSource}\n${hookSource}\n${screenerSource}`;

describe("Saved Screener persistence integrity", () => {
  it("uses versioned account-backed definitions for saved configuration", () => {
    expect(screenerSource).toContain("schemaVersion: 1");
    for (const field of ["filters", "view", "sortBy", "sortDir", "hiddenColumns"]) {
      expect(screenerSource).toContain(field);
    }
    for (const operation of ["listSavedScreeners", "saveScreener", "updateScreener", "deleteScreener"]) {
      expect(workspaceSource).toContain(operation);
    }
    expect(screenerSource).not.toContain("runSavedScreener");
  });

  it("supports save, save-as, rename, apply, delete, and dirty state without prompts", () => {
    expect(screenerSource).toContain("activeSavedScreenerId");
    expect(screenerSource).toContain("Save as new");
    expect(screenerSource).toContain("Rename");
    expect(screenerSource).toContain("Delete");
    expect(screenerSource).toContain("Unsaved changes");
    expect(screenerSource).not.toContain("window.prompt");
  });

  it("keeps localStorage read-only except for explicit successful legacy import cleanup", () => {
    expect(screenerSource).toContain('const SAVED_KEY = "maet:screener-v4:views"');
    expect(screenerSource).toContain("Import local saved views");
    expect(screenerSource).toContain("localStorage.getItem(SAVED_KEY)");
    expect(screenerSource).toContain("localStorage.removeItem(SAVED_KEY)");
    expect(screenerSource).not.toContain("localStorage.setItem");
  });

  it("rejects unsupported criteria visibly instead of guessing its meaning", () => {
    expect(screenerSource).toContain("Unsupported saved criteria");
    expect(screenerSource).toContain("schemaVersion !== 1");
  });
});
