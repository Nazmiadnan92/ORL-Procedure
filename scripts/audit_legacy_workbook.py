#!/usr/bin/env python3
"""Audit the legacy Google Sheets export without exposing patient-level data."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import date, datetime
from pathlib import Path

import openpyxl


EXPECTED_HEADERS = [
    "Timestamp",
    "Doctor",
    "Patient Name",
    "Subspecialty",
    "Procedure",
    "Affected Region",
    "Patient Source",
    "Notes",
    "Remark",
    "Status",
    "Updated At",
]


def clean(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value).strip()


def split_multi(value: object) -> list[str]:
    return [part.strip() for part in re.split(r"\s*(?:\||,|;|\n)\s*", clean(value)) if part.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    workbook = openpyxl.load_workbook(args.workbook, data_only=False, read_only=True)
    result: dict[str, object] = {
        "sheets": workbook.sheetnames,
        "sheet_dimensions": {},
    }

    for sheet in workbook.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        used_rows = [row for row in rows if any(clean(cell) for cell in row)]
        result["sheet_dimensions"][sheet.title] = {
            "used_rows": len(used_rows),
            "max_used_columns": max((sum(1 for cell in row if clean(cell)) for row in used_rows), default=0),
        }

    sheet = workbook["Bookings"]
    rows = list(sheet.iter_rows(values_only=True))
    headers = [clean(value) for value in rows[0][: len(EXPECTED_HEADERS)]]
    records = []
    empty_rows = []
    for excel_row, row in enumerate(rows[1:], start=2):
        cells = list(row[: len(EXPECTED_HEADERS)]) + [None] * max(0, len(EXPECTED_HEADERS) - len(row))
        if not any(clean(cell) for cell in cells):
            empty_rows.append(excel_row)
            continue
        records.append((excel_row, cells))

    counters = {
        "subspecialties": Counter(),
        "procedures": Counter(),
        "regions": Counter(),
        "patient_sources": Counter(),
        "statuses": Counter(),
        "timestamp_types": Counter(),
    }
    missing_required = Counter()
    multi_procedure_rows = 0
    multi_region_rows = 0
    anomalies = []
    for _, cells in records:
        timestamp, doctor, patient, subspecialty, procedure, region, source, _, _, status, _ = cells
        counters["timestamp_types"][type(timestamp).__name__] += 1
        counters["subspecialties"][clean(subspecialty)] += 1
        counters["patient_sources"][clean(source)] += 1
        counters["statuses"][clean(status)] += 1
        procedures = split_multi(procedure)
        regions = split_multi(region)
        counters["procedures"].update(procedures)
        counters["regions"].update(regions)
        multi_procedure_rows += int(len(procedures) > 1)
        multi_region_rows += int(len(regions) > 1)
        for label, value in (
            ("Timestamp", timestamp),
            ("Doctor", doctor),
            ("Patient Name", patient),
            ("Subspecialty", subspecialty),
            ("Procedure", procedure),
            ("Affected Region", region),
            ("Patient Source", source),
            ("Status", status),
        ):
            if not clean(value):
                missing_required[label] += 1

    valid_subspecialties = {"Gen ORL", "Otology", "Rhinology", "Head & Neck", "Paeds ORL"}
    valid_regions = {"Ear", "Nose", "Neck", "Throat"}
    valid_sources = {"Clinic", "Ward"}
    valid_statuses = {"NEW", "READY", "DONE", "CANCEL"}
    for excel_row, cells in records:
        timestamp, _, _, subspecialty, procedure, region, source, _, _, status, _ = cells
        issues = []
        if not isinstance(timestamp, datetime):
            issues.append(f"Timestamp={clean(timestamp)!r}")
        if clean(subspecialty) not in valid_subspecialties:
            issues.append(f"Subspecialty={clean(subspecialty)!r}")
        if not split_multi(procedure):
            issues.append("Procedure is blank")
        invalid_regions = sorted(set(split_multi(region)) - valid_regions)
        if not split_multi(region) or invalid_regions:
            issues.append(f"Affected Region={clean(region)!r}")
        if clean(source) not in valid_sources:
            issues.append(f"Patient Source={clean(source)!r}")
        if clean(status) not in valid_statuses:
            issues.append(f"Status={clean(status)!r}")
        if issues:
            anomalies.append({"excel_row": excel_row, "issues": issues})

    result["bookings"] = {
        "headers": headers,
        "headers_match_expected": headers == EXPECTED_HEADERS,
        "record_count": len(records),
        "empty_row_count": len(empty_rows),
        "first_excel_row": records[0][0] if records else None,
        "last_excel_row": records[-1][0] if records else None,
        "multi_procedure_rows": multi_procedure_rows,
        "multi_region_rows": multi_region_rows,
        "missing_required_counts": dict(sorted(missing_required.items())),
        "anomalies": anomalies,
        **{name: dict(sorted(counter.items())) for name, counter in counters.items()},
    }

    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
