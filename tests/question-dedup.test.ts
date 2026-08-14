// Unit tests for the anti-duplicate layer of the AI Question Generator:
// normalizeStem / similarity / dedupeQuestions. These are the post-generation
// guard that removes literal AND reworded duplicates within a batch and against
// the question bank / previous drafts.
import { describe, it, expect } from "vitest";
import { normalizeStem, similarity, dedupeQuestions } from "@/lib/ai/question-generator";

describe("normalizeStem", () => {
  it("normalizes case, punctuation and whitespace", () => {
    expect(normalizeStem("  What is  Voltage? ")).toBe(normalizeStem("what is voltage"));
  });

  it("treats Arabic punctuation as noise", () => {
    expect(normalizeStem("ما هو الجهد؟")).toBe("ما هو الجهد");
  });
});

describe("similarity", () => {
  it("returns 0 for empty inputs", () => {
    expect(similarity("", "")).toBe(0);
    expect(similarity("a b c", "")).toBe(0);
  });

  it("scores identical stems as 1", () => {
    expect(similarity("What is the purpose of the permit to work?", "What is the purpose of the permit to work?")).toBe(1);
  });

  it("scores reworded same-fact stems high", () => {
    const a = "Workers must isolate live conductors before starting work";
    const b = "Before beginning work, live conductors must be isolated by workers";
    expect(similarity(a, b)).toBeGreaterThan(0.5);
  });

  it("scores different facts low", () => {
    const a = "Fire extinguishers must be inspected regularly";
    const b = "Assessment results are stored in the question bank";
    expect(similarity(a, b)).toBeLessThan(0.2);
  });
});

interface Item {
  text: string;
  id: number;
}

describe("dedupeQuestions", () => {
  it("keeps distinct questions in order", () => {
    const items: Item[] = [
      { text: "Why must circuits be isolated?", id: 1 },
      { text: "What is the minimum approach distance?", id: 2 },
    ];
    expect(dedupeQuestions(items, []).map((i) => i.id)).toEqual([1, 2]);
  });

  it("removes literal duplicates within a batch", () => {
    const items: Item[] = [
      { text: "Why must circuits be isolated?", id: 1 },
      { text: "Why must circuits be isolated?", id: 2 },
      { text: "What is the minimum approach distance?", id: 3 },
    ];
    expect(dedupeQuestions(items, []).map((i) => i.id)).toEqual([1, 3]);
  });

  it("removes reworded near-duplicates (same fact)", () => {
    const items: Item[] = [
      { text: "Workers must isolate live conductors before starting work", id: 1 },
      { text: "Before beginning work, live conductors must be isolated by workers", id: 2 },
    ];
    expect(dedupeQuestions(items, []).map((i) => i.id)).toEqual([1]);
  });

  it("removes items already present in the exclude list", () => {
    const items: Item[] = [{ text: "Why must circuits be isolated?", id: 1 }];
    expect(dedupeQuestions(items, ["Why must circuits be isolated?"])).toEqual([]);
  });

  it("keeps a different fact even when the exclude list is long", () => {
    const items: Item[] = [{ text: "How often must fire extinguishers be checked?", id: 1 }];
    const excludes = ["Why must circuits be isolated?", "Where is the first aid kit located?"];
    expect(dedupeQuestions(items, excludes).map((i) => i.id)).toEqual([1]);
  });
});
