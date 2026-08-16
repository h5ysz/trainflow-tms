import { describe, expect, it } from "vitest";
import { orderTextForLtr } from "@/lib/pdf/bidi";

describe("orderTextForLtr", () => {
  it("reverses a pure Arabic line into visual order", () => {
    expect(orderTextForLtr("المختبر الخليجي")).toBe("الخليجي المختبر");
    expect(orderTextForLtr("محمد عبدالله القحطاني")).toBe("القحطاني عبدالله محمد");
  });

  it("moves a trailing Latin word to the far left of an Arabic line", () => {
    expect(orderTextForLtr("سلامة وصحة مهنية وإدارة السلامة OSHA")).toBe(
      "OSHA السلامة وإدارة مهنية وصحة سلامة",
    );
    expect(orderTextForLtr("تم توليد PDF للشهادة")).toBe("للشهادة PDF توليد تم");
  });

  it("keeps a contiguous Latin block intact inside an Arabic line", () => {
    expect(orderTextForLtr("شهادة OSHA cert 2026")).toBe("OSHA cert 2026 شهادة");
  });

  it("keeps Arabic words as atomic units (no inner character reversal)", () => {
    expect(orderTextForLtr("سلامة 100 وصحة")).toBe("وصحة 100 سلامة");
  });

  it("leaves pure Latin lines untouched", () => {
    expect(orderTextForLtr("CERTIFICATE OF COMPLETION")).toBe("CERTIFICATE OF COMPLETION");
    expect(orderTextForLtr("Course Code: OSH-101 | Duration: 24 hours | Score: 92%")).toBe(
      "Course Code: OSH-101 | Duration: 24 hours | Score: 92%",
    );
  });

  it("leaves Latin-first mixed lines untouched", () => {
    expect(orderTextForLtr("Course OSHA السلامة")).toBe("Course OSHA السلامة");
    expect(orderTextForLtr("x السلامة وصحة y")).toBe("x وصحة السلامة y");
  });

  it("handles empty and single-token input", () => {
    expect(orderTextForLtr("")).toBe("");
    expect(orderTextForLtr("OSHA")).toBe("OSHA");
    expect(orderTextForLtr("92%")).toBe("92%");
  });
});
