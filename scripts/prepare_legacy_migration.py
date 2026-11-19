#!/usr/bin/env python3
"""Prepare an idempotent SQL migration from the legacy Google Sheets export.

The generated SQL contains patient data and must stay in the ignored backups/
directory. This source file contains transformation rules only.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import date, datetime, time, timezone, timedelta
from pathlib import Path

import openpyxl

SHEET_ID = "1qhrB6IWJTGFlqqbKCagV7TKc3J6r0UCm64E9APxk-9I"
MALAYSIA_TZ = timezone(timedelta(hours=8))
VALID_SUBSPECIALTIES = {"Gen ORL", "Otology", "Rhinology", "Head & Neck", "Paeds ORL"}
VALID_REGIONS = {"Ear", "Nose", "Neck", "Throat"}
VALID_SOURCES = {"Clinic", "Ward"}
VALID_STATUSES = {"NEW", "READY", "DONE", "CANCEL"}

PROCEDURE_RENAMES = {
    "0�": "0°",
    "0� Paeds": "0° Paeds",
    "30�": "30°",
    "70�": "70°",
    "90�": "90°",
}
SOURCE_RENAMES = {"Cinic": "Clinic", "wad": "Ward"}


def clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def split_multi(value: object) -> list[str]:
    return [part.strip() for part in re.split(r"\s*(?:\||,|;|\n)\s*", clean(value)) if part.strip()]


def parse_local_datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, time.min)
    else:
        text = clean(value)
        parsed = None
        for pattern in ("%d/%m/%y %H:%M", "%d/%m/%Y %H:%M", "%d/%m/%y", "%d/%m/%Y"):
            try:
                parsed = datetime.strptime(text, pattern)
                break
            except ValueError:
                continue
        if parsed is None:
            raise ValueError(f"Unsupported timestamp: {text!r}")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=MALAYSIA_TZ)
    return parsed


def normalize_procedures(value: object) -> tuple[list[str], list[str]]:
    corrections = []
    parts = split_multi(value)
    if not parts:
        parts = ["Unspecified (Legacy)"]
        corrections.append("blank procedure -> Unspecified (Legacy)")
    normalized = []
    for part in parts:
        renamed = PROCEDURE_RENAMES.get(part, part)
        if renamed != part:
            corrections.append(f"{part} -> {renamed}")
        if renamed not in normalized:
            normalized.append(renamed)
    return normalized, corrections


def normalize_source(value: object) -> tuple[str, str | None]:
    source = clean(value)
    if not source:
        return "Clinic", "blank patient source -> Clinic"
    renamed = SOURCE_RENAMES.get(source, source)
    if renamed not in VALID_SOURCES:
        raise ValueError(f"Invalid patient source: {source!r}")
    return renamed, None if renamed == source else f"{source} -> {renamed}"


def normalize_status(value: object) -> tuple[str, str | None]:
    status = clean(value).upper()
    if not status:
        return "DONE", "blank status -> DONE"
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status!r}")
    return status, None


def workbook_records(path: Path) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    sheet = workbook["Bookings"]
    rows = list(sheet.iter_rows(values_only=True))
    expected = [
        "Timestamp", "Doctor", "Patient Name", "Subspecialty", "Procedure",
        "Affected Region", "Patient Source", "Notes", "Remark", "Status", "Updated At",
    ]
    headers = [clean(value) for value in rows[0][: len(expected)]]
    if headers != expected:
        raise ValueError(f"Bookings headers changed: {headers!r}")

    records = []
    corrections = []
    for excel_row, raw in enumerate(rows[1:], start=2):
        cells = list(raw[: len(expected)]) + [None] * max(0, len(expected) - len(raw))
        if not any(clean(value) for value in cells):
            continue
        (
            timestamp, doctor, patient_name, subspecialty, procedure, region,
            source, notes, remark, status, updated_at,
        ) = cells
        if not clean(doctor) or not clean(patient_name):
            raise ValueError(f"Row {excel_row}: doctor/patient name is blank")
        subspecialty_text = clean(subspecialty)
        if subspecialty_text == "General ORL":
            subspecialty_text = "Gen ORL"
            corrections.append({"row": excel_row, "change": "General ORL -> Gen ORL"})
        if subspecialty_text not in VALID_SUBSPECIALTIES:
            raise ValueError(f"Row {excel_row}: invalid subspecialty {subspecialty_text!r}")
        procedures, procedure_corrections = normalize_procedures(procedure)
        regions = list(dict.fromkeys(split_multi(region)))
        if not regions or set(regions) - VALID_REGIONS:
            raise ValueError(f"Row {excel_row}: invalid affected region {clean(region)!r}")
        source_text, source_correction = normalize_source(source)
        status_text, status_correction = normalize_status(status)
        booked_at = parse_local_datetime(timestamp)
        updated_at_value = parse_local_datetime(updated_at) if clean(updated_at) else booked_at
        for change in procedure_corrections + [source_correction, status_correction]:
            if change:
                corrections.append({"row": excel_row, "change": change})
        records.append({
            "legacy_source_key": f"gsheet:{SHEET_ID}:Bookings:{excel_row}",
            "booked_at": booked_at.isoformat(),
            "doctor": clean(doctor),
            "patient_name": clean(patient_name),
            "subspecialty": subspecialty_text,
            "procedures": procedures,
            "affected_regions": regions,
            "patient_source": source_text,
            "notes": clean(notes),
            "legacy_remark": clean(remark) or None,
            "status": status_text,
            "updated_at": updated_at_value.isoformat(),
        })
    return records, corrections


def generate_sql(records: list[dict[str, object]]) -> str:
    payload = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
    if "$orl_legacy$" in payload:
        raise ValueError("Unexpected SQL delimiter in source data")
    expected = len(records)
    return f"""-- Generated from the read-only legacy workbook export. Do not commit this file.
begin;

create temporary table legacy_import_stage (
  legacy_source_key text primary key,
  booked_at timestamptz not null,
  doctor text not null,
  patient_name text not null,
  subspecialty text not null,
  procedures jsonb not null,
  affected_regions text[] not null,
  patient_source text not null,
  notes text not null,
  legacy_remark text,
  status text not null,
  updated_at timestamptz not null
) on commit drop;

alter table legacy_import_stage enable row level security;

insert into legacy_import_stage
select
  source.legacy_source_key,
  source.booked_at::timestamptz,
  source.doctor,
  source.patient_name,
  source.subspecialty,
  source.procedures,
  array(select jsonb_array_elements_text(source.affected_regions)),
  source.patient_source,
  source.notes,
  source.legacy_remark,
  source.status,
  source.updated_at::timestamptz
from jsonb_to_recordset($orl_legacy${payload}$orl_legacy$::jsonb) as source(
  legacy_source_key text,
  booked_at text,
  doctor text,
  patient_name text,
  subspecialty text,
  procedures jsonb,
  affected_regions jsonb,
  patient_source text,
  notes text,
  legacy_remark text,
  status text,
  updated_at text
);

do $$
begin
  if (select count(*) from legacy_import_stage) <> {expected} then
    raise exception 'Legacy staging count mismatch';
  end if;
end $$;

insert into public.procedures(name, active, uses_bed, display_order)
select distinct item.name, false, false, 10000
from legacy_import_stage stage
cross join lateral jsonb_array_elements_text(stage.procedures) as item(name)
on conflict (name) do nothing;

insert into public.bookings(
  booked_at, doctor, patient_name, subspecialty, affected_regions,
  patient_source, notes, status, updated_at, legacy_remark, legacy_source_key
)
select booked_at, doctor, patient_name, subspecialty, affected_regions,
  patient_source, notes, status, updated_at, legacy_remark, legacy_source_key
from legacy_import_stage
on conflict (legacy_source_key) do nothing;

insert into public.booking_procedures(booking_id, procedure_id)
select booking.id, procedure.id
from legacy_import_stage stage
join public.bookings booking using (legacy_source_key)
cross join lateral jsonb_array_elements_text(stage.procedures) as item(name)
join public.procedures procedure on procedure.name = item.name
on conflict do nothing;

do $$
begin
  if (
    select count(*) from public.bookings
    where legacy_source_key like 'gsheet:{SHEET_ID}:Bookings:%'
  ) <> {expected} then
    raise exception 'Legacy booking count mismatch after import';
  end if;
end $$;

commit;

select jsonb_build_object(
  'expected_bookings', {expected},
  'imported_bookings', count(*),
  'first_booking', min(booked_at),
  'last_booking', max(booked_at),
  'procedure_links', (
    select count(*) from public.booking_procedures bp
    join public.bookings b on b.id = bp.booking_id
    where b.legacy_source_key like 'gsheet:{SHEET_ID}:Bookings:%'
  ),
  'bookings_without_procedure', (
    select count(*) from public.bookings b
    where b.legacy_source_key like 'gsheet:{SHEET_ID}:Bookings:%'
      and not exists (select 1 from public.booking_procedures bp where bp.booking_id = b.id)
  )
) as migration_audit
from public.bookings
where legacy_source_key like 'gsheet:{SHEET_ID}:Bookings:%';
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--sql", required=True, type=Path)
    parser.add_argument("--audit", required=True, type=Path)
    args = parser.parse_args()

    records, corrections = workbook_records(args.workbook)
    args.sql.parent.mkdir(parents=True, exist_ok=True)
    args.audit.parent.mkdir(parents=True, exist_ok=True)
    args.sql.write_text(generate_sql(records), encoding="utf-8")
    procedure_links = sum(len(record["procedures"]) for record in records)
    audit = {
        "records": len(records),
        "procedure_links": procedure_links,
        "first_booking": min(record["booked_at"] for record in records),
        "last_booking": max(record["booked_at"] for record in records),
        "source_counts": dict(Counter(record["patient_source"] for record in records)),
        "status_counts": dict(Counter(record["status"] for record in records)),
        "corrections": corrections,
    }
    args.audit.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
