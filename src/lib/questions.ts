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
    correctAnswers: [] as number[],
    imageUrl: "",
  };
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
