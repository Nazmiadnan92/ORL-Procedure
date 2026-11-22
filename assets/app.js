import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  bookingRowClass,
  filterBookings,
  formatDateTime,
  formatHourMinute,
  formatTime,
  malaysiaDateLabel,
  malaysiaMonthYear,
  malaysiaTodayBounds,
  millisecondsUntilMalaysiaMidnight,
  normalizeBooking,
  readyQueue,
  readableError,
} from "./lib.js?v=1.3.1";

const SUPABASE_URL = "https://wpssewipanzmsygmhior.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b8ZgFXg5fheb5WV-nIe5MQ_ZKRpquAt";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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
  adminBookings: [],
  adminProcedures: [],
  adminSession: null,
  adminVerified: false,
  adminLoaded: false,
  adminSummary: { total: 0, new_count: 0, ready_count: 0, done_count: 0, cancel_count: 0 },
  adminSearchQuery: "",
  adminSourceFilter: "All",
  adminStatusFilter: "All",
  adminPage: 1,
  adminPageSize: 100,
  adminFilteredCount: 0,
  adminRequestId: 0,
  adminQueryTimer: null,
  adminRefreshTimer: null,
  pendingDeleteId: null,
  adminSection: "bookings",
  statsMonth: malaysiaMonthYear(new Date()).month,
  statsYear: malaysiaMonthYear(new Date()).year,
  statsData: null,
  statsLoadedKey: "",
  statsRequestId: 0,
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
  readyCount: document.querySelector("#ready-count"),
  readyEmpty: document.querySelector("#ready-empty"),
  readyTable: document.querySelector("#ready-table"),
  readyTableBody: document.querySelector("#ready-table-body"),
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
  adminEntry: document.querySelector(".admin-entry"),
  adminLoginPanel: document.querySelector("#admin-login-panel"),
  adminLoginForm: document.querySelector("#admin-login-form"),
  adminEmail: document.querySelector("#admin-email"),
  adminPassword: document.querySelector("#admin-password"),
  togglePassword: document.querySelector("#toggle-password"),
  adminLoginButton: document.querySelector("#admin-login-button"),
  adminLoginError: document.querySelector("#admin-login-error"),
  adminDashboard: document.querySelector("#admin-dashboard"),
  adminAccountEmail: document.querySelector("#admin-account-email"),
  adminLogout: document.querySelector("#admin-logout"),
  adminSearch: document.querySelector("#admin-search"),
  adminSourceFilter: document.querySelector("#admin-source-filter"),
  adminStatusFilter: document.querySelector("#admin-status-filter"),
  adminRefresh: document.querySelector("#admin-refresh"),
  adminRetry: document.querySelector("#admin-retry"),
  adminLoading: document.querySelector("#admin-loading"),
  adminError: document.querySelector("#admin-error"),
  adminEmpty: document.querySelector("#admin-empty"),
  adminNoResults: document.querySelector("#admin-no-results"),
  adminResults: document.querySelector("#admin-results"),
  adminTableBody: document.querySelector("#admin-table-body"),
  adminPagePrevious: document.querySelector("#admin-page-previous"),
  adminPageNext: document.querySelector("#admin-page-next"),
  adminPageInfo: document.querySelector("#admin-page-info"),
  adminLastUpdated: document.querySelector("#admin-last-updated"),
  adminTotalCount: document.querySelector("#admin-total-count"),
  adminNewCount: document.querySelector("#admin-new-count"),
  adminReadyCount: document.querySelector("#admin-ready-count"),
  adminDoneCount: document.querySelector("#admin-done-count"),
  adminCancelCount: document.querySelector("#admin-cancel-count"),
  deleteDialog: document.querySelector("#delete-dialog"),
  deleteDialogCopy: document.querySelector("#delete-dialog-copy"),
  confirmDelete: document.querySelector("#confirm-delete"),
  adminBookingsTab: document.querySelector("#admin-bookings-tab"),
  adminStatsTab: document.querySelector("#admin-stats-tab"),
  adminBookingsPanel: document.querySelector("#admin-bookings-panel"),
  adminStatsPanel: document.querySelector("#admin-stats-panel"),
  statsMonth: document.querySelector("#stats-month"),
  statsYear: document.querySelector("#stats-year"),
  statsPeriodLabel: document.querySelector("#stats-period-label"),
  statsTotal: document.querySelector("#stats-total"),
  statsClinic: document.querySelector("#stats-clinic"),
  statsWard: document.querySelector("#stats-ward"),
  statsClinicPercent: document.querySelector("#stats-clinic-percent"),
  statsWardPercent: document.querySelector("#stats-ward-percent"),
  statsEmpty: document.querySelector("#stats-empty"),
  statsContent: document.querySelector("#stats-content"),
  subspecialtyStatsBody: document.querySelector("#subspecialty-stats-body"),
  procedureStatsList: document.querySelector("#procedure-stats-list"),
};

function setView(viewName, updateHistory = true) {
  const resolved = ["booking", "list", "admin"].includes(viewName) ? viewName : "booking";
  elements.views.forEach((view) => {
    const active = view.id === `${resolved}-view`;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  elements.navLinks.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === resolved);
  });
  elements.adminEntry.classList.toggle("active", resolved === "admin");
  if (updateHistory) history.replaceState(null, "", `#${resolved}`);
  if (resolved === "list") {
    fetchBookings({ silent: state.listLoaded });
  }
  if (resolved === "admin") prepareAdminView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setConnection(status) {
  elements.connectionPill.classList.toggle("online", status === "online");
  elements.connectionPill.classList.toggle("offline", status === "offline");
  elements.connectionLabel.textContent =
    status === "online" ? "Live" : status === "offline" ? "Offline" : "Connecting";
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
    empty.textContent = "No procedures found";
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
      remove.setAttribute("aria-label", `Remove ${procedure.name}`);
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
    ["doctor", formData.doctor, "Enter the doctor's name."],
    ["patientName", formData.patientName, "Enter the patient's name."],
    ["subspecialty", formData.subspecialty, "Select a subspecialty."],
    ["patientSource", formData.patientSource, "Select Clinic or Ward."],
  ];
  required.forEach(([name, value, message]) => {
    if (!value) {
      setFieldError(name, message);
      errors.push(name);
    }
  });
  if (!formData.procedureIds.length) {
    setFieldError("procedures", "Select at least one procedure.");
    errors.push("procedures");
  }
  if (!formData.affectedRegions.length) {
    setFieldError("affectedRegions", "Select at least one affected region.");
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
    showToast("Booking not submitted", readableError(error), "error");
    return;
  }

  state.pendingRequestId = null;
  elements.form.reset();
  state.selectedProcedureIds.clear();
  renderSelectedProcedures();
  renderProcedureOptions();
  elements.notesCount.textContent = "0";
  setSubmitting(false);
  showToast("Booking submitted", "The new booking has been recorded with NEW status.");
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
    "ready_at",
    "updated_at",
    "revision",
    "booking_procedures(procedure_id,procedures(name,uses_bed))",
  ].join(",");

  const today = malaysiaTodayBounds();
  const { data, error } = await supabase
    .from("bookings")
    .select(columns)
    .gte("booked_at", today.start)
    .lt("booked_at", today.end)
    .order("booked_at", { ascending: false });
  elements.refreshButton.classList.remove("loading");

  if (error) {
    if (!state.listLoaded) showListState("error");
    setConnection("offline");
    return;
  }

  state.bookings = (data ?? []).map(normalizeBooking);
  state.listLoaded = true;
  updateSummary();
  renderReadyPatients();
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

function renderReadyPatients() {
  const readyBookings = readyQueue(state.bookings);
  elements.readyCount.textContent = String(readyBookings.length);
  elements.readyEmpty.hidden = readyBookings.length !== 0;
  elements.readyTable.hidden = readyBookings.length === 0;
  elements.readyTableBody.replaceChildren(...readyBookings.map(createReadyRow));
}

function createReadyRow(booking) {
  const row = document.createElement("tr");
  const procedureNames = booking.procedures.map((procedure) => procedure.name).join(", ");
  row.append(
    textCell(formatHourMinute(booking.ready_at ?? booking.updated_at ?? booking.booked_at)),
    textCell(booking.doctor),
    textCell(booking.patient_name),
    textCell(procedureNames),
  );
  return row;
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

function createPersonStack(patientName, doctorName) {
  const stack = document.createElement("div");
  stack.className = "person-stack";
  [["Patient Name", patientName, "patient"], ["Doctor", doctorName, "doctor"]].forEach(([label, value, type]) => {
    const box = document.createElement("div");
    box.className = `person-box person-box-${type}`;
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = value || "—";
    box.append(labelNode, valueNode);
    stack.append(box);
  });
  return stack;
}

function createPersonCell(patientName, doctorName, admin = false) {
  const cell = document.createElement("td");
  cell.className = admin ? "locked-cell person-stack-cell" : "person-stack-cell";
  if (admin) cell.dataset.label = "Patient / Doctor";
  cell.append(createPersonStack(patientName, doctorName));
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
    createPersonCell(booking.patient_name, booking.doctor),
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
  identity.className = "card-identity";
  const meta = document.createElement("p");
  meta.className = "card-timestamp";
  meta.textContent = formatDateTime(booking.booked_at);
  identity.append(createPersonStack(booking.patient_name, booking.doctor), meta);
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

async function prepareAdminView() {
  if (state.adminVerified && state.adminSession) {
    showAdminDashboard();
    if (!state.adminLoaded) {
      await Promise.all([fetchAdminBookings(), populateStatsYears()]);
    }
    return;
  }
  showAdminLogin();
}

function showAdminLogin() {
  elements.adminLoginPanel.hidden = false;
  elements.adminDashboard.hidden = true;
}

function showAdminDashboard() {
  elements.adminLoginPanel.hidden = true;
  elements.adminDashboard.hidden = false;
  elements.adminAccountEmail.textContent = state.adminSession?.user?.email ?? "orlprosedur@gmail.com";
}

function setAdminLoginLoading(loading) {
  elements.adminLoginButton.disabled = loading;
  elements.adminLoginButton.classList.toggle("loading", loading);
  elements.adminLoginButton.setAttribute("aria-busy", String(loading));
}

async function verifyAdminSession(session) {
  if (!session) {
    state.adminSession = null;
    state.adminVerified = false;
    state.adminLoaded = false;
    showAdminLogin();
    return false;
  }

  const { data, error } = await supabase.rpc("is_admin");
  if (error || data !== true) {
    await supabase.auth.signOut();
    state.adminSession = null;
    state.adminVerified = false;
    state.adminLoaded = false;
    showAdminLogin();
    return false;
  }

  state.adminSession = session;
  state.adminVerified = true;
  showAdminDashboard();
  return true;
}

async function handleAdminLogin(event) {
  event.preventDefault();
  elements.adminLoginError.textContent = "";
  if (!elements.adminPassword.value) {
    elements.adminLoginError.textContent = "Enter the Admin password.";
    elements.adminPassword.focus();
    return;
  }

  setAdminLoginLoading(true);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: elements.adminEmail.value,
    password: elements.adminPassword.value,
  });

  if (error || !(await verifyAdminSession(data.session))) {
    elements.adminLoginError.textContent = "Invalid email or password.";
    setAdminLoginLoading(false);
    return;
  }

  elements.adminPassword.value = "";
  setAdminLoginLoading(false);
  showToast("Admin logged in", "Historical records can now be managed.");
  await Promise.all([fetchAdminBookings(), populateStatsYears()]);
}

async function handleAdminLogout() {
  elements.adminLogout.disabled = true;
  await supabase.auth.signOut();
  state.adminSession = null;
  state.adminVerified = false;
  state.adminLoaded = false;
  state.adminBookings = [];
  state.statsData = null;
  state.statsLoadedKey = "";
  elements.adminLogout.disabled = false;
  showAdminLogin();
  showToast("Admin logged out", "Management access has been closed on this device.");
}

async function loadAdminProcedureCatalog() {
  const { data, error } = await supabase
    .from("procedures")
    .select("id,name,uses_bed,active,display_order")
    .order("name", { ascending: true });
  if (error) throw error;
  const usageRank = new Map(state.procedures.map((procedure, index) => [procedure.id, index]));
  state.adminProcedures = (data ?? []).sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.active && b.active) {
      return (usageRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (usageRank.get(b.id) ?? Number.MAX_SAFE_INTEGER);
    }
    return a.name.localeCompare(b.name);
  });
}

async function fetchAdminBookings({ silent = false, resetPage = false } = {}) {
  if (!state.adminVerified) return;
  if (resetPage) state.adminPage = 1;
  const requestId = ++state.adminRequestId;
  if (!silent) showAdminState("loading");
  elements.adminRefresh.classList.add("loading");

  try {
    const { data, error } = await supabase.rpc("admin_booking_page", {
      p_page: state.adminPage,
      p_page_size: state.adminPageSize,
      p_query: state.adminSearchQuery,
      p_source: state.adminSourceFilter,
      p_status: state.adminStatusFilter,
    });
    if (error) throw error;
    if (requestId !== state.adminRequestId) return;
    if (!state.adminProcedures.length) await loadAdminProcedureCatalog();
    if (requestId !== state.adminRequestId) return;

    state.adminFilteredCount = Number(data?.filtered_count ?? 0);
    const totalPages = Math.max(1, Math.ceil(state.adminFilteredCount / state.adminPageSize));
    if (state.adminPage > totalPages) {
      state.adminPage = totalPages;
      return fetchAdminBookings({ silent: true });
    }
    state.adminBookings = (data?.records ?? []).map(normalizeBooking);
    state.adminSummary = {
      total: Number(data?.summary?.total ?? 0),
      new_count: Number(data?.summary?.new_count ?? 0),
      ready_count: Number(data?.summary?.ready_count ?? 0),
      done_count: Number(data?.summary?.done_count ?? 0),
      cancel_count: Number(data?.summary?.cancel_count ?? 0),
    };
    state.adminLoaded = true;
    updateAdminSummary();
    renderAdminBookings();
    elements.adminLastUpdated.textContent = formatTime(new Date());
  } catch (error) {
    if (requestId !== state.adminRequestId) return;
    if (!state.adminLoaded) showAdminState("error");
    showToast("Unable to load Admin records", readableError(error), "error");
  } finally {
    if (requestId === state.adminRequestId) elements.adminRefresh.classList.remove("loading");
  }
}

function updateAdminSummary() {
  elements.adminTotalCount.textContent = String(state.adminSummary.total);
  elements.adminNewCount.textContent = String(state.adminSummary.new_count);
  elements.adminReadyCount.textContent = String(state.adminSummary.ready_count);
  elements.adminDoneCount.textContent = String(state.adminSummary.done_count);
  elements.adminCancelCount.textContent = String(state.adminSummary.cancel_count);
}

function setAdminSection(section) {
  state.adminSection = section === "statistics" ? "statistics" : "bookings";
  const showStats = state.adminSection === "statistics";
  elements.adminBookingsPanel.hidden = showStats;
  elements.adminStatsPanel.hidden = !showStats;
  elements.adminBookingsTab.classList.toggle("active", !showStats);
  elements.adminStatsTab.classList.toggle("active", showStats);
  elements.adminBookingsTab.setAttribute("aria-selected", String(!showStats));
  elements.adminStatsTab.setAttribute("aria-selected", String(showStats));
  const selectedKey = `${state.statsYear}-${state.statsMonth}`;
  if (showStats && state.statsLoadedKey !== selectedKey) {
    fetchMonthlyStatistics({ silent: Boolean(state.statsData) });
  }
}

async function populateStatsYears() {
  const currentYear = malaysiaMonthYear(new Date()).year;
  const { data, error } = await supabase.rpc("admin_statistics_years");
  if (error) throw error;
  const years = new Set([currentYear, ...(data ?? [])].map(Number));
  const sortedYears = [...years].sort((a, b) => b - a);
  elements.statsYear.replaceChildren(
    ...sortedYears.map((year) => {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      return option;
    }),
  );
  if (!years.has(state.statsYear)) state.statsYear = sortedYears[0];
  elements.statsYear.value = String(state.statsYear);
  elements.statsMonth.value = String(state.statsMonth);
}

function percentage(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

async function fetchMonthlyStatistics({ silent = false } = {}) {
  if (!state.adminVerified) return;
  const key = `${state.statsYear}-${state.statsMonth}`;
  const requestId = ++state.statsRequestId;
  if (!silent) elements.statsPeriodLabel.textContent = "Loading…";
  const { data, error } = await supabase.rpc("admin_monthly_statistics", {
    p_year: state.statsYear,
    p_month: state.statsMonth,
  });
  if (requestId !== state.statsRequestId || key !== `${state.statsYear}-${state.statsMonth}`) return;
  if (error) {
    showToast("Unable to load statistics", readableError(error), "error");
    return;
  }
  state.statsData = data;
  state.statsLoadedKey = key;
  renderMonthlyStatistics();
}

function renderMonthlyStatistics() {
  const statistics = state.statsData ?? {
    total: 0,
    clinic: 0,
    ward: 0,
    subspecialties: [],
    procedures: [],
  };
  const monthName = elements.statsMonth.options[elements.statsMonth.selectedIndex]?.textContent ?? "";
  elements.statsPeriodLabel.textContent = `${monthName} ${state.statsYear}`;
  elements.statsTotal.textContent = String(statistics.total);
  elements.statsClinic.textContent = String(statistics.clinic);
  elements.statsWard.textContent = String(statistics.ward);
  elements.statsClinicPercent.textContent = `${percentage(statistics.clinic, statistics.total)}% of cases`;
  elements.statsWardPercent.textContent = `${percentage(statistics.ward, statistics.total)}% of cases`;
  elements.statsEmpty.hidden = statistics.total !== 0;
  elements.statsContent.hidden = statistics.total === 0;

  elements.subspecialtyStatsBody.replaceChildren(
    ...statistics.subspecialties.map((item) => {
      const row = document.createElement("tr");
      [item.name, item.clinic, item.ward, item.total].forEach((value, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        cell.textContent = String(value);
        if (index === 0) cell.scope = "row";
        row.append(cell);
      });
      return row;
    }),
  );

  elements.procedureStatsList.replaceChildren();
  const maximum = Math.max(1, ...statistics.procedures.map((item) => item.total));
  statistics.procedures.forEach((item) => {
    const row = document.createElement("div");
    row.className = "procedure-stat-row";
    const heading = document.createElement("div");
    heading.className = "procedure-stat-heading";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const total = document.createElement("span");
    total.textContent = `${item.total} case${item.total === 1 ? "" : "s"}`;
    heading.append(name, total);

    const track = document.createElement("div");
    track.className = "procedure-bar-track";
    const stack = document.createElement("div");
    stack.className = "procedure-bar-stack";
    stack.style.width = `${(item.total / maximum) * 100}%`;
    const clinic = document.createElement("span");
    clinic.className = "procedure-bar-clinic";
    clinic.style.width = `${percentage(item.clinic, item.total)}%`;
    const ward = document.createElement("span");
    ward.className = "procedure-bar-ward";
    ward.style.width = `${percentage(item.ward, item.total)}%`;
    stack.append(clinic, ward);
    track.append(stack);

    const split = document.createElement("div");
    split.className = "procedure-stat-split";
    const clinicCount = document.createElement("span");
    clinicCount.textContent = `Clinic ${item.clinic}`;
    const wardCount = document.createElement("span");
    wardCount.textContent = `Ward ${item.ward}`;
    split.append(clinicCount, wardCount);
    row.append(heading, track, split);
    elements.procedureStatsList.append(row);
  });
}

function showAdminState(kind) {
  elements.adminLoading.hidden = kind !== "loading";
  elements.adminError.hidden = kind !== "error";
  elements.adminEmpty.hidden = kind !== "empty";
  elements.adminNoResults.hidden = kind !== "no-results";
  elements.adminResults.hidden = kind !== "results";
}

function renderAdminBookings() {
  if (state.adminSummary.total === 0) {
    showAdminState("empty");
    return;
  }
  if (!state.adminBookings.length) {
    showAdminState("no-results");
    return;
  }

  showAdminState("results");
  elements.adminTableBody.replaceChildren(...state.adminBookings.map(createAdminRow));
  updateAdminPagination();
}

function createLockedCell(value) {
  const cell = textCell(value);
  cell.classList.add("locked-cell");
  return cell;
}

function createStackedCell(primaryValue, secondaryValue, primaryLabel, secondaryLabel) {
  const cell = document.createElement("td");
  cell.className = "locked-cell admin-stacked-cell";
  cell.dataset.label = primaryLabel;
  const primary = document.createElement("strong");
  primary.className = "admin-cell-primary";
  primary.textContent = primaryValue;
  const secondary = document.createElement("span");
  secondary.className = "admin-cell-secondary";
  secondary.textContent = `${secondaryLabel}: ${secondaryValue}`;
  cell.append(primary, secondary);
  return cell;
}

function updateAdminPagination() {
  const totalPages = Math.max(1, Math.ceil(state.adminFilteredCount / state.adminPageSize));
  elements.adminPageInfo.textContent = `Page ${state.adminPage} of ${totalPages} · ${state.adminFilteredCount} records`;
  elements.adminPagePrevious.disabled = state.adminPage <= 1;
  elements.adminPageNext.disabled = state.adminPage >= totalPages;
}

function createAdminRow(booking) {
  const row = document.createElement("tr");
  row.className = bookingRowClass(booking);
  row.dataset.bookingId = booking.id;

  const procedureCell = document.createElement("td");
  procedureCell.className = "procedure-cell";
  procedureCell.dataset.label = "Procedure";
  procedureCell.append(createAdminProcedureEditor(booking, row));

  const regionCell = document.createElement("td");
  regionCell.className = "locked-cell";
  regionCell.dataset.label = "Region";
  regionCell.append(createTagList(booking.affected_regions));

  const notesCell = document.createElement("td");
  notesCell.dataset.label = "Notes";
  const notesInput = document.createElement("textarea");
  notesInput.className = "admin-notes-input";
  notesInput.value = booking.notes;
  notesInput.maxLength = 4000;
  notesInput.rows = 2;
  notesInput.setAttribute("aria-label", `Edit notes for ${booking.patient_name}`);
  notesInput.dataset.original = booking.notes;
  notesInput.addEventListener("blur", async () => {
    if (notesInput.value === notesInput.dataset.original) return;
    const saved = await updateAdminBooking(booking.id, { notes: notesInput.value }, row);
    if (saved) notesInput.dataset.original = notesInput.value;
    else notesInput.value = notesInput.dataset.original;
  });
  notesCell.append(notesInput);

  const statusCell = document.createElement("td");
  statusCell.className = "admin-actions-cell";
  statusCell.dataset.label = "Status / Delete";
  const statusGrid = document.createElement("div");
  statusGrid.className = "admin-status-grid";
  statusGrid.setAttribute("role", "group");
  statusGrid.setAttribute("aria-label", `Status for ${booking.patient_name}`);
  ["NEW", "READY", "DONE", "CANCEL"].forEach((status) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `admin-status-button admin-status-${status.toLowerCase()}`;
    button.textContent = status;
    button.setAttribute("aria-pressed", String(status === booking.status));
    button.addEventListener("click", async () => {
      if (status === booking.status) return;
      await updateAdminBooking(booking.id, { status }, row);
    });
    statusGrid.append(button);
  });
  statusCell.append(statusGrid);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-row-button";
  deleteButton.setAttribute("aria-label", `Delete booking for ${booking.patient_name}`);
  deleteButton.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14" /></svg><span>DELETE</span>';
  deleteButton.addEventListener("click", () => openDeleteDialog(booking.id));
  statusCell.append(deleteButton);

  const timestampCell = createLockedCell(formatDateTime(booking.booked_at));
  timestampCell.dataset.label = "Timestamp";

  row.append(
    timestampCell,
    createPersonCell(booking.patient_name, booking.doctor, true),
    createStackedCell(booking.subspecialty, booking.patient_source, "Subspecialty / Source", "Source"),
    procedureCell,
    regionCell,
    notesCell,
    statusCell,
  );
  return row;
}

function createAdminProcedureEditor(booking, row) {
  const wrapper = document.createElement("div");
  wrapper.className = "procedure-editor-anchor";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "editable-procedure";
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `Edit procedures for ${booking.patient_name}`);
  trigger.append(createTagList(booking.procedures.map((item) => item.name)));

  const editor = document.createElement("div");
  editor.className = "procedure-editor";
  editor.hidden = true;
  const search = document.createElement("input");
  search.type = "search";
  search.className = "procedure-editor-search";
  search.placeholder = "Search procedure";
  search.setAttribute("aria-label", "Search procedure options");
  const options = document.createElement("div");
  options.className = "procedure-editor-options";
  const selected = new Set(booking.procedures.map((procedure) => procedure.id));

  const renderOptions = () => {
    const query = search.value.trim().toLowerCase();
    options.replaceChildren();
    state.adminProcedures
      .filter((procedure) => procedure.name.toLowerCase().includes(query))
      .forEach((procedure) => {
        const label = document.createElement("label");
        label.className = "procedure-editor-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = procedure.id;
        checkbox.checked = selected.has(procedure.id);
        checkbox.disabled = !procedure.active && !selected.has(procedure.id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(procedure.id);
          else selected.delete(procedure.id);
        });
        const name = document.createElement("span");
        name.textContent = procedure.active ? procedure.name : `${procedure.name} (archived)`;
        label.append(checkbox, name);
        options.append(label);
      });
  };
  renderOptions();
  search.addEventListener("input", renderOptions);

  const actions = document.createElement("div");
  actions.className = "procedure-editor-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save";

  const positionEditor = () => {
    if (editor.hidden) return;
    const triggerRect = trigger.getBoundingClientRect();
    const viewportGap = 12;
    const preferredWidth = 320;
    const width = Math.min(preferredWidth, window.innerWidth - (viewportGap * 2));
    const left = Math.min(
      Math.max(viewportGap, triggerRect.left),
      window.innerWidth - width - viewportGap,
    );
    editor.style.width = `${width}px`;
    editor.style.left = `${left}px`;
    const editorHeight = Math.min(editor.scrollHeight, window.innerHeight - (viewportGap * 2));
    const spaceBelow = window.innerHeight - triggerRect.bottom - viewportGap;
    const top = spaceBelow >= editorHeight
      ? triggerRect.bottom + 6
      : Math.max(viewportGap, triggerRect.top - editorHeight - 6);
    editor.style.top = `${top}px`;
  };

  const closeOnOutsideClick = (event) => {
    if (!wrapper.contains(event.target)) close();
  };
  const closeOnTableScroll = () => close();
  const close = () => {
    editor.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    window.removeEventListener("resize", positionEditor);
    elements.adminResults.removeEventListener("scroll", closeOnTableScroll);
    document.removeEventListener("click", closeOnOutsideClick);
  };
  editor.closeEditor = close;
  cancel.addEventListener("click", close);
  save.addEventListener("click", async () => {
    if (!selected.size) {
      showToast("Procedure required", "Select at least one procedure.", "error");
      return;
    }
    const saved = await updateAdminBooking(booking.id, { procedureIds: [...selected] }, row);
    if (saved) close();
  });
  actions.append(cancel, save);
  editor.append(search, options, actions);

  trigger.addEventListener("click", () => {
    document.querySelectorAll(".procedure-editor:not([hidden])").forEach((openEditor) => {
      if (openEditor !== editor) openEditor.closeEditor?.();
    });
    const opening = editor.hidden;
    if (!opening) {
      close();
      return;
    }
    editor.hidden = false;
    trigger.setAttribute("aria-expanded", String(!editor.hidden));
    positionEditor();
    window.addEventListener("resize", positionEditor);
    elements.adminResults.addEventListener("scroll", closeOnTableScroll);
    document.addEventListener("click", closeOnOutsideClick);
    search.focus({ preventScroll: true });
  });
  wrapper.append(trigger, editor);
  return wrapper;
}

async function updateAdminBooking(bookingId, patch, row) {
  const booking = state.adminBookings.find((item) => item.id === bookingId);
  if (!booking || row.classList.contains("saving")) return false;
  row.classList.remove("save-error");
  row.classList.add("saving");
  row.querySelectorAll("button,select,textarea,input").forEach((control) => { control.disabled = true; });

  const { data, error } = await supabase.rpc("update_booking", {
    p_booking_id: booking.id,
    p_expected_revision: booking.revision,
    p_procedure_ids: patch.procedureIds ?? null,
    p_notes: Object.hasOwn(patch, "notes") ? patch.notes : null,
    p_status: patch.status ?? null,
  });

  if (error) {
    row.classList.add("save-error");
    showToast(
      "Changes not saved",
      /changed|40001/i.test(String(error.message))
        ? "The record was changed on another device. The list will be refreshed."
        : readableError(error),
      "error",
    );
    await fetchAdminBookings({ silent: true });
    return false;
  }

  booking.revision = data;
  await Promise.all([
    fetchAdminBookings({ silent: true }),
    fetchMonthlyStatistics({ silent: true }),
  ]);
  showToast("Changes saved", "The booking has been updated.");
  return true;
}

function openDeleteDialog(bookingId) {
  const booking = state.adminBookings.find((item) => item.id === bookingId);
  if (!booking) return;
  state.pendingDeleteId = bookingId;
  elements.deleteDialogCopy.textContent = `Are you sure you want to delete the booking for ${booking.patient_name}? It will be removed from the list and statistics.`;
  elements.deleteDialog.showModal();
}

async function deleteAdminBooking() {
  const booking = state.adminBookings.find((item) => item.id === state.pendingDeleteId);
  if (!booking) return;
  elements.confirmDelete.disabled = true;
  const { error } = await supabase.rpc("delete_booking", {
    p_booking_id: booking.id,
    p_expected_revision: booking.revision,
  });
  elements.confirmDelete.disabled = false;
  if (error) {
    showToast("Unable to delete booking", readableError(error), "error");
    elements.deleteDialog.close();
    await fetchAdminBookings({ silent: true });
    return;
  }
  state.pendingDeleteId = null;
  elements.deleteDialog.close();
  await Promise.all([
    fetchAdminBookings({ silent: true }),
    fetchMonthlyStatistics({ silent: true }),
  ]);
  showToast("Booking deleted", "The record is hidden and can still be restored.");
}

function scheduleAdminRefresh() {
  if (!state.adminVerified) return;
  window.clearTimeout(state.adminRefreshTimer);
  state.adminRefreshTimer = window.setTimeout(() => {
    const activeControl = document.activeElement;
    if (activeControl && elements.adminTableBody.contains(activeControl)) {
      scheduleAdminRefresh();
      return;
    }
    fetchAdminBookings({ silent: true });
    fetchMonthlyStatistics({ silent: true });
  }, 420);
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
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
      scheduleRefresh();
      scheduleAdminRefresh();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "booking_procedures" }, () => {
      scheduleRefresh();
      scheduleAdminRefresh();
    })
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
  elements.listDateDescription.textContent = `${label} · updates automatically`;
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
  elements.adminLoginForm.addEventListener("submit", handleAdminLogin);
  elements.togglePassword.addEventListener("click", () => {
    const showing = elements.adminPassword.type === "text";
    elements.adminPassword.type = showing ? "password" : "text";
    elements.togglePassword.textContent = showing ? "Show" : "Hide";
    elements.togglePassword.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
  elements.adminLogout.addEventListener("click", handleAdminLogout);
  elements.adminBookingsTab.addEventListener("click", () => setAdminSection("bookings"));
  elements.adminStatsTab.addEventListener("click", () => setAdminSection("statistics"));
  elements.statsMonth.addEventListener("change", () => {
    state.statsMonth = Number(elements.statsMonth.value);
    state.statsLoadedKey = "";
    fetchMonthlyStatistics();
  });
  elements.statsYear.addEventListener("change", () => {
    state.statsYear = Number(elements.statsYear.value);
    state.statsLoadedKey = "";
    fetchMonthlyStatistics();
  });
  elements.adminSearch.addEventListener("input", () => {
    state.adminSearchQuery = elements.adminSearch.value;
    window.clearTimeout(state.adminQueryTimer);
    state.adminQueryTimer = window.setTimeout(() => fetchAdminBookings({ silent: true, resetPage: true }), 320);
  });
  elements.adminSourceFilter.addEventListener("change", () => {
    state.adminSourceFilter = elements.adminSourceFilter.value;
    fetchAdminBookings({ silent: true, resetPage: true });
  });
  elements.adminStatusFilter.addEventListener("change", () => {
    state.adminStatusFilter = elements.adminStatusFilter.value;
    fetchAdminBookings({ silent: true, resetPage: true });
  });
  elements.adminPagePrevious.addEventListener("click", () => {
    if (state.adminPage <= 1) return;
    state.adminPage -= 1;
    fetchAdminBookings({ silent: true });
  });
  elements.adminPageNext.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.adminFilteredCount / state.adminPageSize));
    if (state.adminPage >= totalPages) return;
    state.adminPage += 1;
    fetchAdminBookings({ silent: true });
  });
  elements.adminRefresh.addEventListener("click", () => {
    fetchAdminBookings({ silent: state.adminLoaded });
    fetchMonthlyStatistics({ silent: true });
  });
  elements.adminRetry.addEventListener("click", () => fetchAdminBookings());
  elements.confirmDelete.addEventListener("click", (event) => {
    event.preventDefault();
    deleteAdminBooking();
  });
  window.addEventListener("hashchange", () => setView(location.hash.slice(1), false));
  window.addEventListener("online", () => {
    startRealtime();
    fetchBookings({ silent: state.listLoaded });
  });
  window.addEventListener("offline", () => setConnection("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchBookings({ silent: state.listLoaded });
      if (state.adminVerified) {
        fetchAdminBookings({ silent: state.adminLoaded });
        fetchMonthlyStatistics({ silent: true });
      }
    }
  });
}

async function initialise() {
  bindEvents();
  updateDateLabels();
  setView(location.hash.slice(1), false);
  scheduleMidnightReset();
  startRealtime();

  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(async () => {
      if (!session) {
        state.adminSession = null;
        state.adminVerified = false;
        state.adminLoaded = false;
        if (location.hash === "#admin") showAdminLogin();
        return;
      }
      if (!state.adminVerified || state.adminSession?.access_token !== session.access_token) {
        await verifyAdminSession(session);
      }
    }, 0);
  });

  try {
    const [{ data: sessionData }] = await Promise.all([
      supabase.auth.getSession(),
      loadProcedureCatalog(),
      fetchBookings(),
    ]);
    if (sessionData.session && (await verifyAdminSession(sessionData.session)) && location.hash === "#admin") {
      await Promise.all([fetchAdminBookings(), populateStatsYears()]);
    }
  } catch (error) {
    setConnection("offline");
    showToast("Unable to load the system", readableError(error), "error");
  }
}

initialise();
