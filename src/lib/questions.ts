// Shared between the pre-test and final-test question banks, which post the
// same shape to /api/questions and differ only by testType.

export function newQuestionDefaults(testType: "PRE_TEST" | "FINAL_TEST") {
  return {
    type: "SINGLE_CHOICE",
    testType,
    points: 1,
    order: 1,
    isActive: true,
    options: ["", "", "", ""],
    optionsAr: [] as string[],
    correctAnswers: [] as number[],
    imageUrl: "",
  };
}

/** Localized label for a question type (e.g. TRUE_FALSE → "True / False"). */
export function questionTypeLabel<T extends string>(t: (key: T) => string, type: string): string {
  const label = t(`questions.type.${type}` as T);
  return label && !label.startsWith("questions.type.") ? label : type.replace("_", " ");
}

/**
 * Returns an error message, or null when the question is valid. The backend
 * rejects fewer than 2 options or zero correct answers, so catch it here.
 */
export function validateQuestion(
  form: Record<string, unknown>,
  messages: { course: string; text: string; minOptions: string; minCorrect: string }
): string | null {
  if (!form.courseId) return messages.course;
  if (!form.text) return messages.text;

  const options = ((form.options as string[]) ?? []).filter((o) => o.trim() !== "");
  if (options.length < 2) return messages.minOptions;

  if (((form.correctAnswers as number[]) ?? []).length === 0) return messages.minCorrect;
  return null;
}
