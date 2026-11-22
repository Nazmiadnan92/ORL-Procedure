import test from "node:test";
import assert from "node:assert/strict";
import {
  bookingRowClass,
  filterAdminBookings,
  filterBookings,
  formatDateTime,
  formatHourMinute,
  millisecondsUntilMalaysiaMidnight,
  malaysiaTodayBounds,
  monthlyStatistics,
  normalizeBooking,
  readyQueue,
  readableError,
} from "../assets/lib.js";

const base = {
  id: "booking-1",
  doctor: "Azlina",
  patient_name: "Abraham",
  subspecialty: "Otology",
  affected_regions: ["Ear"],
  patient_source: "Clinic",
  notes: "Review",
  status: "NEW",
  booking_procedures: [
    { procedure_id: "p2", procedures: { name: "EUM", uses_bed: true } },
    { procedure_id: "p1", procedures: { name: "0°", uses_bed: false } },
  ],
};

test("normalizes nested procedure records alphabetically", () => {
  const booking = normalizeBooking(base);
  assert.deepEqual(booking.procedures.map((item) => item.name), ["0°", "EUM"]);
  assert.deepEqual(booking.procedures.map((item) => item.id), ["p1", "p2"]);
  assert.equal(booking.procedureSearch, "0° eum");
});

test("filters Admin history by source and status", () => {
  const first = normalizeBooking(base);
  const second = normalizeBooking({ ...base, id: "booking-2", patient_source: "Ward", status: "DONE" });
  assert.deepEqual(filterAdminBookings([first, second], "", "Ward", "DONE").map((item) => item.id), ["booking-2"]);
  assert.equal(filterAdminBookings([first, second], "Azlina", "All", "NEW").length, 1);
});

test("applies the agreed clinic and ward bed colours", () => {
  const clinicBed = normalizeBooking(base);
  assert.equal(bookingRowClass(clinicBed), "row-clinic-bed");
  assert.equal(bookingRowClass({ ...clinicBed, patient_source: "Ward" }), "row-ward row-ward-bed");
  assert.equal(
    bookingRowClass({ ...clinicBed, patient_source: "Ward", procedures: [{ name: "Flex", uses_bed: false }] }),
    "row-ward",
  );
});

test("filters by source and patient, doctor or procedure search", () => {
  const first = normalizeBooking(base);
  const second = normalizeBooking({
    ...base,
    id: "booking-2",
    doctor: "Nabila",
    patient_name: "Lim Heng Soon",
    patient_source: "Ward",
    booking_procedures: [{ procedure_id: "p3", procedures: { name: "Flex", uses_bed: false } }],
  });
  assert.equal(filterBookings([first, second], "eum", "All").length, 1);
  assert.equal(filterBookings([first, second], "nabila", "Ward").length, 1);
  assert.equal(filterBookings([first, second], "Abraham", "Ward").length, 0);
});

test("formats timestamps in Malaysia as dd/mm/yy hh:mm", () => {
  assert.equal(formatDateTime("2026-09-23T17:19:25.000Z"), "24/09/26 01:19");
});

test("builds the READY queue with the latest patient first", () => {
  const bookings = [
    { ...base, id: "late", status: "READY", ready_at: "2026-11-21T08:00:00Z" },
    { ...base, id: "ignored", status: "NEW", ready_at: null },
    { ...base, id: "early", status: "READY", ready_at: "2026-11-21T07:30:00Z" },
  ];
  assert.deepEqual(readyQueue(bookings).map((booking) => booking.id), ["late", "early"]);
  assert.equal(formatHourMinute("2026-11-21T07:30:00Z"), "15:30");
});

test("returns a useful network error", () => {
  assert.match(readableError(new Error("Failed to fetch")), /Connection lost/);
});

test("calculates a future Malaysia midnight interval", () => {
  const interval = millisecondsUntilMalaysiaMidnight(new Date("2026-11-19T15:59:50.000Z"));
  assert.equal(interval, 10_000);
});

test("builds exact Malaysia day bounds for the Staff list", () => {
  assert.deepEqual(malaysiaTodayBounds(new Date("2026-11-19T18:00:00.000Z")), {
    start: "2026-11-19T16:00:00.000Z",
    end: "2026-11-20T16:00:00.000Z",
  });
});

test("builds monthly Clinic and Ward statistics in Malaysia time", () => {
  const records = [
    normalizeBooking({
      ...base,
      id: "nov-clinic",
      booked_at: "2026-10-31T18:00:00.000Z",
      patient_source: "Clinic",
      subspecialty: "Otology",
      booking_procedures: [
        { procedure_id: "p1", procedures: { name: "EUM", uses_bed: true } },
        { procedure_id: "p1", procedures: { name: "EUM", uses_bed: true } },
      ],
    }),
    normalizeBooking({
      ...base,
      id: "nov-ward",
      booked_at: "2026-11-20T02:00:00.000Z",
      patient_source: "Ward",
      subspecialty: "Rhinology",
      booking_procedures: [{ procedure_id: "p2", procedures: { name: "Flex", uses_bed: false } }],
    }),
    normalizeBooking({
      ...base,
      id: "dec-clinic",
      booked_at: "2026-11-30T17:00:00.000Z",
      patient_source: "Clinic",
    }),
  ];
  const stats = monthlyStatistics(records, 11, 2026);
  assert.deepEqual({ total: stats.total, clinic: stats.clinic, ward: stats.ward }, { total: 2, clinic: 1, ward: 1 });
  assert.equal(stats.subspecialties.find((item) => item.name === "Otology").clinic, 1);
  assert.deepEqual(stats.procedures.map((item) => [item.name, item.total]), [["EUM", 1], ["Flex", 1]]);
});
