#!/usr/bin/env python3
"""
Second pass: rename collection relations to the PLURAL forms the codebase expects.

The codebase was originally written against a Prisma schema where one-to-many
relations used plural aliases (e.g. Course.requests, Course.sessions,
Course.certificates, Course.questions). After `prisma db pull --force`, the
introspected schema uses Prisma's default singular names (trainingRequest,
trainingSession, certificate, question).

This script applies a manual mapping table to rename the most common collection
relations to their expected plural forms. The DB schema is unaffected (relation
field names are Prisma-only — the underlying FK column is what matters).
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

SCHEMA_PATH = Path("/home/z/my-project/prisma/schema.prisma")

# (Model, current_field_name) -> new_field_name
# These are the renames needed to make the codebase's existing queries work.
RENAMES: dict[tuple[str, str], str] = {
    # ── Course ────────────────────────────────────────────────────────────
    ("Course", "trainingRequest"): "requests",
    ("Course", "trainingSession"): "sessions",
    ("Course", "certificate"): "certificates",
    ("Course", "question"): "questions",
    ("Course", "courseEvaluation"): "evaluations",
    ("Course", "complianceRule"): "complianceRules",
    ("Course", "courseResource"): "resources",
    ("Course", "trainerCertification"): "trainerCertifications",
    ("Course", "trainingRequestCourse"): "requestCourses",
    # ── TrainingRequest ───────────────────────────────────────────────────
    ("TrainingRequest", "trainingSession"): "sessions",
    ("TrainingRequest", "trainingRequestCourse"): "requestCourses",
    ("TrainingRequest", "invoice"): "invoices",
    ("TrainingRequest", "quotation"): "quotations",
    ("TrainingRequest", "course"): "course",  # already singular, keep
    ("TrainingRequest", "company"): "company",  # already singular, keep
    # ── Company ───────────────────────────────────────────────────────────
    ("Company", "trainingRequest"): "trainingRequests",
    ("Company", "certificate"): "certificates",
    ("Company", "companyContact"): "contacts",
    ("Company", "courseEvaluation"): "evaluations",
    ("Company", "examAttempt"): "examAttempts",
    ("Company", "invoice"): "invoices",
    ("Company", "payment"): "payments",
    ("Company", "quotation"): "quotations",
    ("Company", "receipt"): "receipts",
    ("Company", "sessionCompany"): "sessionCompanies",
    ("Company", "sessionEnrollment"): "enrollments",
    ("Company", "sessionPayment"): "sessionPayments",
    ("Company", "testResult"): "testResults",
    ("Company", "trainee"): "trainees",
    ("Company", "user"): "users",
    ("Company", "workerPassport"): "workerPassports",
    ("Company", "tenant"): "tenant",  # singular, keep
    # ── TrainingSession ───────────────────────────────────────────────────
    ("TrainingSession", "attendance"): "attendances",  # if code uses attendances
    ("TrainingSession", "certificate"): "certificates",
    ("TrainingSession", "checkInAttempt"): "checkIns",
    ("TrainingSession", "sessionEnrollment"): "enrollments",
    ("TrainingSession", "testResult"): "testResults",
    ("TrainingSession", "courseEvaluation"): "evaluations",
    ("TrainingSession", "examAttempt"): "examAttempts",
    ("TrainingSession", "sessionCompany"): "sessionCompanies",
    ("TrainingSession", "sessionPayment"): "sessionPayments",
    # ── Trainer ───────────────────────────────────────────────────────────
    ("Trainer", "trainingSession"): "sessions",
    ("Trainer", "courseEvaluation"): "evaluations",
    ("Trainer", "trainerCertification"): "qualifications",
    ("Trainer", "user"): "user",  # singular, keep
    # ── Trainee ───────────────────────────────────────────────────────────
    ("Trainee", "sessionEnrollment"): "enrollments",
    ("Trainee", "testResult"): "testResults",
    ("Trainee", "certificate"): "certificates",
    ("Trainee", "examAttempt"): "examAttempts",
    ("Trainee", "workerPassport"): "workerPassport",  # singular, keep
    # ── Certificate ───────────────────────────────────────────────────────
    ("Certificate", "certificateVerification"): "verifications",
    ("Certificate", "certificate"): "renewedFrom",  # self-relation, code uses renewedFrom
    # ── Invoice ───────────────────────────────────────────────────────────
    ("Invoice", "payment"): "payments",
    ("Invoice", "receipt"): "receipts",
    # ── User ──────────────────────────────────────────────────────────────
    ("User", "auditLog"): "auditLogs",
    ("User", "loginHistory"): "loginHistories",
    ("User", "notification"): "notifications",
    # ── Question ──────────────────────────────────────────────────────────
    ("Question", "examAttempt"): "examAttempts",
    # ── BankAccount ───────────────────────────────────────────────────────
    ("BankAccount", "invoice"): "invoices",
    ("BankAccount", "payment"): "payments",
    ("BankAccount", "receipt"): "receipts",
    # ── ComplianceRule ────────────────────────────────────────────────────
    ("ComplianceRule", "course"): "courses",
    ("ComplianceRule", "complianceRuleVersion"): "versions",
}


def main() -> int:
    src = SCHEMA_PATH.read_text(encoding="utf-8")
    lines = src.split("\n")

    out: list[str] = []
    current_model: str | None = None
    applied: list[tuple[str, str, str]] = []

    field_re = re.compile(
        r"^(\s+)([A-Za-z_][A-Za-z0-9_]*)(\s+)([A-Z][a-zA-Z0-9_]*)(\s*)(\[\]|\?)?(\s.*)?$"
    )

    for line in lines:
        m_open = re.match(r"^\s*(model|type)\s+([A-Z][a-zA-Z0-9_]*)\s*\{", line)
        if m_open:
            current_model = m_open.group(2)
            out.append(line)
            continue
        if re.match(r"^\s*\}", line):
            current_model = None
            out.append(line)
            continue

        if current_model is None:
            out.append(line)
            continue

        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("@@") or stripped.startswith("@"):
            out.append(line)
            continue

        m = field_re.match(line)
        if not m:
            out.append(line)
            continue

        indent, fname, ws1, tname, ws2, opt, rest = m.groups()
        key = (current_model, fname)
        if key in RENAMES:
            new_name = RENAMES[key]
            if new_name == fname:
                out.append(line)
                continue
            applied.append((current_model, fname, new_name))
            new_line = f"{indent}{new_name}{ws1}{tname}{ws2}{opt or ''}{rest or ''}"
            out.append(new_line)
        else:
            out.append(line)

    new_src = "\n".join(out)
    SCHEMA_PATH.write_text(new_src, encoding="utf-8")

    print(f"\n✓ Applied {len(applied)} plural-alias renames\n", file=sys.stderr)
    by_model: dict[str, list[tuple[str, str]]] = {}
    for model, old, new in applied:
        by_model.setdefault(model, []).append((old, new))
    for model in sorted(by_model):
        print(f"  {model}:", file=sys.stderr)
        for old, new in by_model[model]:
            print(f"    {old} → {new}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
