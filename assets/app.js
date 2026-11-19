import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  bookingRowClass,
  filterBookings,
  formatDateTime,
  formatTime,
  malaysiaDateLabel,
  millisecondsUntilMalaysiaMidnight,
  normalizeBooking,
  readableError,
} from "./lib.js";

const SUPABASE_URL = "https://wpssewipanzmsygmhior.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b8ZgFXg5fheb5WV-nIe5MQ_ZKRpquAt";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

const state = {
  procedures: [],
  selectedProcedureIds: new Set(),
  bookings: [],
  activeFilter: "All",
  searchQuery: "",
  pendingRequestId: null,
  listLoaded: false,
  realtimeChannel: null,
  refreshTimer: null,
  midnightTimer: null,
};

const elements = {
  views: document.querySelectorAll(".view"),
  viewButtons: document.querySelectorAll("[data-view]"),
  navLinks: document.querySelectorAll(".nav-link"),
  form: document.querySelector("#booking-form"),
  submitButton: document.querySelector("#submit-button"),
  procedureSearch: document.querySelector("#procedure-search"),
  procedureOptions: document.querySelector("#procedure-options"),
  selectedProcedures: document.querySelector("#selected-procedures"),
  notes: document.querySelector("#notes"),
  notesCount: document.querySelector("#notes-count"),
  todayDate: document.querySelector("#today-date"),
  listDateDescription: document.querySelector("#list-date-description"),
  listLoading: document.querySelector("#list-loading"),
  listError: document.querySelector("#list-error"),
  emptyState: document.querySelector("#empty-state"),
  noResultsState: document.querySelector("#no-results-state"),
  bookingResults: document.querySelector("#booking-results"),
  tableBody: document.querySelector("#booking-table-body"),
  bookingCards: document.querySelector("#booking-cards"),
  bookingSearch: document.querySelector("#booking-search"),
  filterButtons: document.querySelectorAll("[data-filter]"),
  refreshButton: document.querySelector("#refresh-button"),
  retryList: document.querySelector("#retry-list"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionLabel: document.querySelector("#connection-label"),
  lastUpdated: document.querySelector("#last-updated"),
  totalCount: document.querySelector("#total-count"),
  clinicCount: document.querySelector("#clinic-count"),
  wardCount: document.querySelector("#ward-count"),
  navCount: document.querySelector("#nav-count"),
  toastRegion: document.querySelector("#toast-region"),
};

function setView(viewName, updateHistory = true) {
  const resolved = viewName === "list" ? "list" : "booking";
  elements.views.forEach((view) => {
    const active = view.id === `${resolved}-view`;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  elements.navLinks.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === resolved);
  });
  if (updateHistory) history.replaceState(null, "", `#${resolved}`);
  if (resolved === "list") {
    fetchBookings({ silent: state.listLoaded });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setConnection(status) {
  elements.connectionPill.classList.toggle("online", status === "online");
  elements.connectionPill.classList.toggle("offline", status === "offline");
  elements.connectionLabel.textContent =
    status === "online" ? "Live" : status === "offline" ? "Offline" : "Menghubungkan";
}

async function loadProcedureCatalog() {
  const { data, error } = await supabase.rpc("procedure_catalog");
  if (error) throw error;
  state.procedures = data ?? [];
  renderProcedureOptions();
}

function renderProcedureOptions() {
  const query = elements.procedureSearch.value.trim().toLowerCase();
  const matches = state.procedures.filter((procedure) => procedure.name.toLowerCase().includes(query));
  elements.procedureOptions.replaceChildren();

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "option-empty";
    empty.textContent = "Prosedur tidak dijumpai";
    elements.procedureOptions.append(empty);
    return;
  }

  matches.forEach((procedure) => {
    const selected = state.selectedProcedureIds.has(procedure.id);
    const option = document.createElement("button");
    option.type = "button";
    option.className = "procedure-option";
    option.dataset.id = procedure.id;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(selected));

    const name = document.createElement("span");
    name.textContent = procedure.name;
    const check = document.createElement("span");
    check.className = "option-check";
    check.textContent = selected ? "✓" : "";
    option.append(name, check);
    option.addEventListener("click", () => toggleProcedure(procedure.id));
    elements.procedureOptions.append(option);
  });
}

function renderSelectedProcedures() {
  elements.selectedProcedures.replaceChildren();
  state.procedures
    .filter((procedure) => state.selectedProcedureIds.has(procedure.id))
    .forEach((procedure) => {
      const chip = document.createElement("span");
      chip.className = "selected-chip";
      const text = document.createElement("span");
      text.textContent = procedure.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Buang ${procedure.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => toggleProcedure(procedure.id));
      chip.append(text, remove);
      elements.selectedProcedures.append(chip);
    });
}

function toggleProcedure(id) {
  if (state.selectedProcedureIds.has(id)) state.selectedProcedureIds.delete(id);
  else state.selectedProcedureIds.add(id);
  renderSelectedProcedures();
  renderProcedureOptions();
  clearFieldError("procedures");
  elements.procedureSearch.focus();
}

function openProcedureOptions() {
  elements.procedureOptions.hidden = false;
  elements.procedureSearch.setAttribute("aria-expanded", "true");
  renderProcedureOptions();
}

function closeProcedureOptions() {
  elements.procedureOptions.hidden = true;
  elements.procedureSearch.setAttribute("aria-expanded", "false");
}

function fieldContainer(name) {
  const error = document.querySelector(`[data-error-for="${name}"]`);
  return error?.closest(".field");
}

function setFieldError(name, message) {
  const error = document.querySelector(`[data-error-for="${name}"]`);
  if (!error) return;
  error.textContent = message;
  fieldContainer(name)?.classList.add("invalid");
}

function clearFieldError(name) {
  const error = document.querySelector(`[data-error-for="${name}"]`);
  if (!error) return;
  error.textContent = "";
  fieldContainer(name)?.classList.remove("invalid");
}

function validateForm(formData) {
  document.querySelectorAll(".field-error").forEach((error) => {
    error.textContent = "";
    error.closest(".field")?.classList.remove("invalid");
  });

  const errors = [];
  const required = [
    ["doctor", formData.doctor, "Masukkan nama doktor."],
    ["patientName", formData.patientName, "Masukkan nama pesakit."],
    ["subspecialty", formData.subspecialty, "Pilih subspecialty."],
    ["patientSource", formData.patientSource, "Pilih Clinic atau Ward."],
  ];
  required.forEach(([name, value, message]) => {
    if (!value) {
      setFieldError(name, message);
      errors.push(name);
    }
  });
  if (!formData.procedureIds.length) {
    setFieldError("procedures", "Pilih sekurang-kurangnya satu prosedur.");
    errors.push("procedures");
  }
  if (!formData.affectedRegions.length) {
    setFieldError("affectedRegions", "Pilih sekurang-kurangnya satu kawasan.");
    errors.push("affectedRegions");
  }
  return errors;
}

function collectFormData() {
  const formData = new FormData(elements.form);
  return {
    doctor: String(formData.get("doctor") ?? "").trim(),
    patientName: String(formData.get("patientName") ?? "").trim(),
    subspecialty: String(formData.get("subspecialty") ?? ""),
    patientSource: String(formData.get("patientSource") ?? ""),
    procedureIds: [...state.selectedProcedureIds],
    affectedRegions: formData.getAll("affectedRegion").map(String),
    notes: String(formData.get("notes") ?? "").trim(),
  };
}

async function submitBooking(event) {
  event.preventDefault();
  const formData = collectFormData();
  const errors = validateForm(formData);
  if (errors.length) {
    fieldContainer(errors[0])?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  state.pendingRequestId ||= crypto.randomUUID();
  setSubmitting(true);
  const { error } = await supabase.rpc("create_booking", {
    p_request_id: state.pendingRequestId,
    p_doctor: formData.doctor,
    p_patient_name: formData.patientName,
    p_subspecialty: formData.subspecialty,
    p_procedure_ids: formData.procedureIds,
    p_affected_regions: formData.affectedRegions,
    p_patient_source: formData.patientSource,
    p_notes: formData.notes,
  });

  if (error) {
    setSubmitting(false);
    showToast("Booking belum dihantar", readableError(error), "error");
    return;
  }

  state.pendingRequestId = null;
  elements.form.reset();
  state.selectedProcedureIds.clear();
  renderSelectedProcedures();
  renderProcedureOptions();
  elements.notesCount.textContent = "0";
  setSubmitting(false);
  showToast("Booking berjaya dihantar", "Tempahan baharu telah direkodkan dengan status NEW.");
  await Promise.all([fetchBookings({ silent: true }), loadProcedureCatalog()]);
  setView("list");
}

function setSubmitting(isSubmitting) {
  elements.submitButton.disabled = isSubmitting;
  elements.submitButton.classList.toggle("loading", isSubmitting);
  elements.submitButton.setAttribute("aria-busy", String(isSubmitting));
}

async function fetchBookings({ silent = false } = {}) {
  if (!silent) showListState("loading");
  elements.refreshButton.classList.add("loading");

  const columns = [
    "id",
    "booked_at",
    "doctor",
    "patient_name",
    "subspecialty",
    "affected_regions",
    "patient_source",
    "notes",
    "status",
    "updated_at",
    "revision",
    "booking_procedures(procedure_id,procedures(name,uses_bed))",
  ].join(",");

  const { data, error } = await supabase.from("bookings").select(columns).order("booked_at", { ascending: false });
  elements.refreshButton.classList.remove("loading");

  if (error) {
    if (!state.listLoaded) showListState("error");
    setConnection("offline");
    return;
  }

  state.bookings = (data ?? []).map(normalizeBooking);
  state.listLoaded = true;
  updateSummary();
  renderBookings();
  elements.lastUpdated.textContent = formatTime(new Date());
}

function updateSummary() {
  const total = state.bookings.length;
  const clinic = state.bookings.filter((booking) => booking.patient_source === "Clinic").length;
  const ward = total - clinic;
  elements.totalCount.textContent = String(total);
  elements.clinicCount.textContent = String(clinic);
  elements.wardCount.textContent = String(ward);
  elements.navCount.textContent = String(total);
  elements.navCount.hidden = total === 0;
}

function showListState(kind) {
  elements.listLoading.hidden = kind !== "loading";
  elements.listError.hidden = kind !== "error";
  elements.emptyState.hidden = kind !== "empty";
  elements.noResultsState.hidden = kind !== "no-results";
  elements.bookingResults.hidden = kind !== "results";
}

function renderBookings() {
  const filtered = filterBookings(state.bookings, state.searchQuery, state.activeFilter);
  if (!state.bookings.length) {
    showListState("empty");
    return;
  }
  if (!filtered.length) {
    showListState("no-results");
    return;
  }

  showListState("results");
  elements.tableBody.replaceChildren(...filtered.map(createTableRow));
  elements.bookingCards.replaceChildren(...filtered.map(createBookingCard));
}

function createTagList(values) {
  const list = document.createElement("div");
  list.className = "cell-list";
  values.forEach((value) => {
    const tag = document.createElement("span");
    tag.className = "cell-tag";
    tag.textContent = value;
    list.append(tag);
  });
  return list;
}

function statusBadge(status) {
  const badge = document.createElement("span");
  badge.className = `status-badge status-${status.toLowerCase()}`;
  badge.textContent = status;
  return badge;
}

function textCell(value, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = value || "—";
  return cell;
}

function createTableRow(booking) {
  const row = document.createElement("tr");
  row.className = bookingRowClass(booking);
  const procedureCell = document.createElement("td");
  procedureCell.className = "procedure-cell";
  procedureCell.append(createTagList(booking.procedures.map((item) => item.name)));
  const regionCell = document.createElement("td");
  regionCell.append(createTagList(booking.affected_regions));
  const statusCell = document.createElement("td");
  statusCell.append(statusBadge(booking.status));
  row.append(
    textCell(formatDateTime(booking.booked_at)),
    textCell(booking.doctor),
    textCell(booking.patient_name),
    textCell(booking.subspecialty),
    procedureCell,
    regionCell,
    textCell(booking.patient_source),
    textCell(booking.notes),
    statusCell,
  );
  return row;
}

function cardItem(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "card-item";
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = value || "—";
  wrapper.append(labelNode, valueNode);
  return wrapper;
}

function createBookingCard(booking) {
  const card = document.createElement("article");
  card.className = `booking-card ${bookingRowClass(booking)}`.trim();
  const head = document.createElement("div");
  head.className = "card-head";
  const identity = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = booking.patient_name;
  const meta = document.createElement("p");
  meta.textContent = `${formatDateTime(booking.booked_at)} · Dr ${booking.doctor}`;
  identity.append(name, meta);
  head.append(identity, statusBadge(booking.status));

  const body = document.createElement("div");
  body.className = "card-body";
  body.append(
    cardItem("Subspecialty", booking.subspecialty),
    cardItem("Source", booking.patient_source),
    cardItem("Affected Region", booking.affected_regions.join(", ")),
    cardItem("Notes", booking.notes),
  );

  const procedure = document.createElement("div");
  procedure.className = "card-procedure";
  const label = document.createElement("span");
  label.textContent = "Procedure";
  procedure.append(label, createTagList(booking.procedures.map((item) => item.name)));
  card.append(head, body, procedure);
  return card;
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(() => fetchBookings({ silent: true }), 220);
}

function startRealtime() {
  if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  setConnection("connecting");
  state.realtimeChannel = supabase
    .channel("staff-booking-list")
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "booking_procedures" }, scheduleRefresh)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setConnection("online");
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) setConnection("offline");
    });
}

function scheduleMidnightReset() {
  window.clearTimeout(state.midnightTimer);
  state.midnightTimer = window.setTimeout(async () => {
    updateDateLabels();
    await fetchBookings({ silent: false });
    scheduleMidnightReset();
  }, millisecondsUntilMalaysiaMidnight() + 1500);
}

function updateDateLabels() {
  const label = malaysiaDateLabel();
  elements.todayDate.textContent = label;
  elements.listDateDescription.textContent = `${label} · dikemas kini secara automatik`;
}

function showToast(title, message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`.trim();
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  const symbol = document.createElement("span");
  symbol.className = "toast-symbol";
  symbol.textContent = type === "error" ? "!" : "✓";
  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const description = document.createElement("span");
  description.textContent = message;
  copy.append(heading, description);
  toast.append(symbol, copy);
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 5200);
}

function bindEvents() {
  elements.viewButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  elements.form.addEventListener("submit", submitBooking);

  elements.procedureSearch.addEventListener("focus", openProcedureOptions);
  elements.procedureSearch.addEventListener("input", () => {
    openProcedureOptions();
    renderProcedureOptions();
  });
  elements.procedureSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeProcedureOptions();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      elements.procedureOptions.querySelector("button")?.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!document.querySelector("#procedure-select").contains(event.target)) closeProcedureOptions();
  });

  elements.form.addEventListener("input", (event) => {
    if (event.target.name) clearFieldError(event.target.name);
    if (event.target.name === "affectedRegion") clearFieldError("affectedRegions");
  });
  elements.notes.addEventListener("input", () => {
    elements.notesCount.textContent = String(elements.notes.value.length);
  });

  elements.bookingSearch.addEventListener("input", () => {
    state.searchQuery = elements.bookingSearch.value;
    renderBookings();
  });
  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeFilter = button.dataset.filter;
      elements.filterButtons.forEach((item) => item.classList.toggle("active", item === button));
      renderBookings();
    });
  });
  elements.refreshButton.addEventListener("click", () => fetchBookings({ silent: state.listLoaded }));
  elements.retryList.addEventListener("click", () => fetchBookings());
  window.addEventListener("hashchange", () => setView(location.hash.slice(1), false));
  window.addEventListener("online", () => {
    startRealtime();
    fetchBookings({ silent: state.listLoaded });
  });
  window.addEventListener("offline", () => setConnection("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fetchBookings({ silent: state.listLoaded });
  });
}

async function initialise() {
  bindEvents();
  updateDateLabels();
  setView(location.hash.slice(1), false);
  scheduleMidnightReset();
  startRealtime();

  try {
    await Promise.all([loadProcedureCatalog(), fetchBookings()]);
  } catch (error) {
    setConnection("offline");
    showToast("Sistem tidak dapat dimuatkan", readableError(error), "error");
  }
}

initialise();
