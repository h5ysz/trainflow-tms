// Shared prompt marker constants used by BOTH the question generator (which
// builds the AI prompt) and the Mock AI provider (which parses it). Kept in
// their own module so the provider never has to import the generator (and the
// two never form an import cycle through provider/index.ts).
export const DO_NOT_REPEAT_TEXT_BEGIN = "DO_NOT_REPEAT_TEXT_BEGIN";
export const DO_NOT_REPEAT_TEXT_END = "DO_NOT_REPEAT_TEXT_END";
export const FIGURES_BEGIN = "FIGURES_BEGIN";
export const FIGURES_END = "FIGURES_END";
