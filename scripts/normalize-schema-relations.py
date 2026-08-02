#!/usr/bin/env python3
"""
Rename all PascalCase relation fields in prisma/schema.prisma to camelCase.

Background:
  After `prisma db pull --force`, all relation fields are named in PascalCase
  (e.g. `Company Company? @relation(...)`, `Role Role? @relation(...)`).
  But the entire application codebase uses camelCase (`user.company`, `user.role`,
  `course.requests`, etc.). The cleanest one-shot fix is to rename the schema
  field declarations to camelCase and regenerate the Prisma client.

Rules:
  1. A relation field is a line inside a `model X { ... }` block whose type
     token is the name of another model (or itself for self-relations).
  2. Rename ONLY the field name (first non-whitespace token on the line).
     Leave the type (second token) as PascalCase.
  3. Special case: `Role` field on User — codebase uses BOTH `role` (string enum
     column) AND `Role` (relation). Renaming the relation to `role` would
     collide with the existing string `role` column. So we keep `Role` as
     `roleRecord` (the legacy name still used in some places).
  4. Special case: relations named exactly the same as the model type after
     lowercasing the first letter are fine (e.g. `company Company?` → `company`).
  5. Do NOT touch:
     - Lines starting with `model`, `enum`, `type`, `//`, `@@`, `@`
     - Lines that are scalar fields (type token is not a model name)
     - The id / column fields (those have `@id`, `@default`, etc.)

Output:
  - Rewrites prisma/schema.prisma in place.
  - Prints a summary of all renames performed.
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

SCHEMA_PATH = Path("/home/z/my-project/prisma/schema.prisma")

def main() -> int:
    src = SCHEMA_PATH.read_text(encoding="utf-8")
    lines = src.split("\n")

    # 1) Collect all model/type names so we can recognize relation fields.
    model_names: set[str] = set()
    for line in lines:
        m = re.match(r"^\s*(model|type)\s+([A-Z][a-zA-Z0-9_]*)\s*\{", line)
        if m:
            model_names.add(m.group(2))
    print(f"Found {len(model_names)} model/type declarations", file=sys.stderr)

    # 2) Walk through the file tracking the current model context.
    out: list[str] = []
    current_model: str | None = None
    renames: list[tuple[str, str, str]] = []  # (model, old, new)

    # Field-line regex: indent + NAME + whitespace + TYPE + optional `[]`/`?` + rest
    # Group 1 = indent, Group 2 = field name, Group 3 = type name, Group 4 = trailing
    field_re = re.compile(
        r"^(\s+)([A-Za-z_][A-Za-z0-9_]*)(\s+)([A-Z][a-zA-Z0-9_]*)(\s*)(\[\]|\?)?(\s.*)?$"
    )

    # Map specific field name collisions to their preferred camelCase alias.
    # The most important one: User.Role -> roleRecord (because User.role is
    # already a string column, and the codebase historically used roleRecord).
    FIELD_OVERRIDES: dict[tuple[str, str], str] = {
        ("User", "Role"): "roleRecord",
        # Add more here if other collisions are discovered.
    }

    for line in lines:
        # Track model context
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

        # Skip comments and decorators
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("@@") or stripped.startswith("@"):
            out.append(line)
            continue

        m = field_re.match(line)
        if not m:
            out.append(line)
            continue

        indent, fname, ws1, tname, ws2, opt, rest = m.groups()
        # Only treat as relation if the type is a known model
        if tname not in model_names:
            out.append(line)
            continue

        # Skip if field name already starts lowercase
        if fname[0].islower():
            out.append(line)
            continue

        # Compute new name
        if (current_model, fname) in FIELD_OVERRIDES:
            new_name = FIELD_OVERRIDES[(current_model, fname)]
        else:
            new_name = fname[0].lower() + fname[1:]

        # Don't rename if the new name would collide with the existing field on the same model.
        # We can't see all fields of the current model in a streaming pass, so we rely on
        # the override map above for the known collision (User.Role).
        renames.append((current_model, fname, new_name))
        new_line = f"{indent}{new_name}{ws1}{tname}{ws2}{opt or ''}{rest or ''}"
        out.append(new_line)

    new_src = "\n".join(out)
    SCHEMA_PATH.write_text(new_src, encoding="utf-8")

    # 3) Print summary
    print(f"\n✓ Renamed {len(renames)} relation fields to camelCase\n", file=sys.stderr)
    by_model: dict[str, list[tuple[str, str]]] = {}
    for model, old, new in renames:
        by_model.setdefault(model, []).append((old, new))
    for model in sorted(by_model):
        print(f"  {model}:", file=sys.stderr)
        for old, new in by_model[model]:
            print(f"    {old} → {new}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
