import { describe, expect, it } from "vitest";
import { DirectLinkRule } from "./direct-link-rule";
import { SharedContextRule } from "./shared-context-rule";
import type { ParsedSourceNote } from "./relationship-rule";
import type { GraphEntityNode } from "../types";

const node = (id: string): GraphEntityNode => ({
  id,
  filePath: id,
  label: id.replace(/\.md$/, ""),
  folder: "",
  tags: [],
  projects: [],
  modifiedTime: 1,
});

const note: ParsedSourceNote = {
  sourceNotePath: "Meeting.md",
  sourceNoteName: "Meeting",
  sourceNode: node("Meeting.md"),
  referencedNodes: [node("People/Tom.md"), node("People/Sarah.md")],
  timestamp: 123,
  projects: ["Apollo"],
};

describe("relationship rules", () => {
  it("creates one shared-context pair for two references", () => {
    const contributions = new SharedContextRule().calculate(note);
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({
      source: "People/Sarah.md",
      target: "People/Tom.md",
      ruleId: "shared-context",
      timestamp: 123,
      projects: ["Apollo"],
    });
  });

  it("creates a direct relationship for each outgoing link", () => {
    const contributions = new DirectLinkRule().calculate(note);
    expect(contributions).toHaveLength(2);
    expect(contributions.every((item) => item.ruleId === "direct-link")).toBe(true);
  });
});
