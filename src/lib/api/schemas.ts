// GCCLAB TMS — shared zod schemas for security-critical API routes.
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required").max(200),
});

export const registerSchema = z
  .object({
    companyName: z.string().trim().min(1, "Company name is required").max(200),
    crNumber: z.string().trim().max(100).optional(),
    contactPerson: z.string().trim().min(1, "Contact person is required").max(200),
    nationalId: z.string().trim().min(1, "National ID is required").max(50),
    mobileNumber: z.string().trim().min(1, "Mobile number is required").max(50),
    email: z.string().trim().toLowerCase().email("A valid email is required"),
    password: z.string().min(8, "Password must be at least 8 characters").max(200),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// Trainee create/update (used by trainees routes).
export const traineeUpsertSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  nationalId: z.string().trim().min(1).max(50),
  nationality: z.string().trim().max(100).optional().nullable(),
  jobTitle: z.string().trim().max(200).optional().nullable(),
  mobile: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal("")),
  companyId: z.string().trim().min(1),
  status: z.string().trim().max(50).optional(),
  notes: z.string().max(2000).optional().nullable(),
  // URL to the uploaded ID/Iqama scan. Coordinators can replace or clear it
  // at any time per the redesigned workflow (item #6 — full editing rights).
  idAttachmentUrl: z.string().trim().max(500).optional().nullable(),
  // Optional personal info for future compliance modules.
  dateOfBirth: z.string().trim().optional().nullable(),
  idExpiry: z.string().trim().optional().nullable(),
});

// Partial variant for PUT (all fields optional except we still constrain shapes).
export const traineeUpdateSchema = traineeUpsertSchema.partial();

// Exam submission answers.
export const examSubmitSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      selectedAnswerIndices: z.array(z.number().int().nonnegative()),
    })
  ),
});

// Notification patch.
export const notificationPatchSchema = z.object({
  isRead: z.boolean().optional(),
});

// Certificate verify token (query param).
export const verifyTokenSchema = z.object({
  token: z.string().trim().min(1, "Verification token is required").max(200),
});
