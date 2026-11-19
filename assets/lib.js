const malaysiaDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const malaysiaTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function formatDateTime(value) {
  return malaysiaDateTime.format(new Date(value)).replace(",", "");
}

export function formatTime(value) {
  return malaysiaTime.format(new Date(value));
}

export function bookingRowClass(booking) {
  const usesBed = booking.procedures.some((procedure) => procedure.uses_bed);
  if (booking.patient_source === "Ward") {
    return usesBed ? "row-ward row-ward-bed" : "row-ward";
  }
  return usesBed ? "row-clinic-bed" : "";
}

export function normalizeBooking(record) {
  const procedures = (record.booking_procedures ?? [])
    .map((item) => (item.procedures ? { ...item.procedures, id: item.procedure_id } : null))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...record,
    procedures,
    procedureSearch: procedures.map((item) => item.name).join(" ").toLowerCase(),
  };
}

export function filterBookings(bookings, query, source) {
  const needle = query.trim().toLowerCase();
  return bookings.filter((booking) => {
    const sourceMatches = source === "All" || booking.patient_source === source;
    if (!sourceMatches) return false;
    if (!needle) return true;
    return [
      booking.doctor,
      booking.patient_name,
      booking.subspecialty,
      booking.patient_source,
      booking.notes,
      booking.status,
      booking.procedureSearch,
      ...(booking.affected_regions ?? []),
    ].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
}

export function filterAdminBookings(bookings, query, source, status) {
  return filterBookings(bookings, query, source).filter(
    (booking) => status === "All" || booking.status === status,
  );
}

export function readableError(error) {
  const message = String(error?.message ?? error ?? "");
  if (/failed to fetch|network|load failed/i.test(message)) {
    return "Sambungan terputus. Semak internet dan cuba lagi.";
  }
  if (/Complete all required|22023/i.test(message)) {
    return "Lengkapkan semua ruangan wajib sebelum submit.";
  }
  if (/active procedures/i.test(message)) {
    return "Senarai prosedur telah berubah. Muat semula dan pilih sekali lagi.";
  }
  if (/Request ID already used|23505/i.test(message)) {
    return "Tempahan ini sudah dihantar. Sila semak Booking List.";
  }
  return "Booking tidak dapat dihantar. Cuba sekali lagi.";
}

export function malaysiaDateLabel(value = new Date()) {
  return new Intl.DateTimeFormat("ms-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

export function malaysiaTodayBounds(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const start = new Date(`${values.year}-${values.month}-${values.day}T00:00:00+08:00`);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

export function millisecondsUntilMalaysiaMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const nextMidnightUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day) + 1,
    -8,
  );
  return Math.max(1000, nextMidnightUtc - now.getTime());
}
