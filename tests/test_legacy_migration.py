import importlib.util
import unittest
from datetime import datetime
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "prepare_legacy_migration.py"
SPEC = importlib.util.spec_from_file_location("prepare_legacy_migration", SCRIPT)
MIGRATION = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MIGRATION)


class LegacyMigrationTests(unittest.TestCase):
    def test_multi_value_parsing(self):
        self.assertEqual(MIGRATION.split_multi("EUM, Flex | Biopsy"), ["EUM", "Flex", "Biopsy"])

    def test_degree_symbol_repairs(self):
        values, corrections = MIGRATION.normalize_procedures("0�, 30�")
        self.assertEqual(values, ["0°", "30°"])
        self.assertEqual(len(corrections), 2)

    def test_blank_procedure_is_retained_as_legacy_placeholder(self):
        values, _ = MIGRATION.normalize_procedures(None)
        self.assertEqual(values, ["Unspecified (Legacy)"])

    def test_source_typo_repairs(self):
        self.assertEqual(MIGRATION.normalize_source("Cinic")[0], "Clinic")
        self.assertEqual(MIGRATION.normalize_source("wad")[0], "Ward")
        self.assertEqual(MIGRATION.normalize_source(None)[0], "Clinic")

    def test_blank_status_is_closed_as_done(self):
        self.assertEqual(MIGRATION.normalize_status(None)[0], "DONE")

    def test_local_timestamp_preserves_malaysia_offset(self):
        value = MIGRATION.parse_local_datetime("17/11/26 15:12")
        self.assertEqual(value, datetime.fromisoformat("2026-11-17T15:12:00+08:00"))


if __name__ == "__main__":
    unittest.main()
