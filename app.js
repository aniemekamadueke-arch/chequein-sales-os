/* ChequeIn Sales OS — application logic. No dependencies, no build step. */
(function () {
  "use strict";

  const KEY = "chequein-sales-os-v1";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const today = () => CI.iso(new Date());
  const parse = (d) => new Date(d + "T00:00:00");
  const addDays = (d, n) => CI.iso(new Date(parse(d).getTime() + n * CI.DAY));
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / CI.DAY);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const naira = (n) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");
  const num = (n) => Number(n || 0).toLocaleString("en-NG");
  const pct = (n) => Math.round((Number(n) || 0) * 100) + "%";
  const sum = (arr, fn) => arr.reduce((t, x) => t + (Number(fn(x)) || 0), 0);
  const spell = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const TYPE_LABEL = { whatsapp: "WhatsApp", call: "Call", email: "Email", session: "Session", review: "Review", admin: "Admin" };
  const TYPE_SHORT = { whatsapp: "WA", call: "CALL", email: "MAIL", session: "SESSION", review: "CHECK", admin: "TASK" };

  /* ------------------------------------------------------------------ sync */
  const SYNC = {
    enabled: !!window.CHEQUEIN_SYNC,
    code: "",
    editor: "",
    version: 0,
    status: "local",
    ready: false,
    dirty: false,
    pushing: false,
    queued: false,
    applying: false,
    conflict: null,
    timer: null,
    pollTimer: null,
    failures: 0,
    lastAt: null,
    lastBy: ""
  };
  try {
    SYNC.code = localStorage.getItem("chequein-team-code") || "";
    SYNC.editor = localStorage.getItem("chequein-editor") || "";
  } catch (e) { /* storage blocked — local mode */ }

  /* ------------------------------------------------------------------ state */
  let state = load();
  const ui = { drawer: null, search: "", tab: "pitch", addOpen: false, bulkOpen: false, settingsOpen: false, route: null };

  function load() {
    let s = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) { s = null; }
    if (!s || !Array.isArray(s.employers)) s = CI.seed();
    s.tasks = s.tasks || [];
    s.log = s.log || {};
    s.checklist = s.checklist || {};
    s.revPerActive = s.revPerActive || 900;
    s.employers.forEach((e) => {
      e.activity = e.activity || [];
      e.metrics = e.metrics || { employees: 0, ewaActive: 0, savingsFunded: 0, revenue: 0 };
      e.compliance = e.compliance || {};
      e.compliance.checks = e.compliance.checks || CI.blankChecks();
      e.qualification = e.qualification || {};
    });
    return s;
  }

  function persistLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast("Could not save — storage is blocked in this browser."); }
  }

  function save() {
    persistLocal();
    if (SYNC.enabled && SYNC.ready && !SYNC.applying) {
      SYNC.dirty = true;
      syncQueue();
    }
  }

  /* ------------------------------------------------------------------ dates */
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }
  function longDate(d) {
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  }
  function shortDate(s) {
    return parse(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function dueLabel(s) {
    const n = diffDays(s, today());
    if (n < 0) return Math.abs(n) + "d overdue";
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    return parse(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  /* ------------------------------------------------------------------ domain */
  const stageOrder = ["lead", "contacted", "qualified", "demo", "compliance", "live"];
  const stage = (id) => CI.STAGES.find((s) => s.id === id) || CI.STAGES[0];
  const nextStage = (id) => {
    const i = stageOrder.indexOf(id);
    return i >= 0 && i < stageOrder.length - 1 ? stageOrder[i + 1] : null;
  };
  const requiredMissing = (e) => CI.REQUIRED_CHECKS.filter((c) => e.compliance.checks[c.id] !== true);
  const compliancePassed = (e) => requiredMissing(e).length === 0;
  const complianceStatus = (e) => {
    if (e.stage === "lost") return "closed";
    if (compliancePassed(e)) return "passed";
    if (e.compliance.failReason) return "failed";
    return "pending";
  };
  function qualScore(e) {
    const q = e.qualification || {};
    let s = 0;
    if (Number(q.staffCount) >= 10) s += 2;
    if (q.paidByTransfer === true) s += 2;
    if (q.decisionMaker === true) s += 2;
    if (q.registered === true) s += 2;
    if (q.noDeductions === true) s += 1;
    if (q.consentPossible === true) s += 1;
    return s;
  }
  function qualComplete(e) {
    const q = e.qualification || {};
    return !!(Number(q.staffCount) > 0 && Number(q.monthlyPayroll) > 0 &&
      q.paidByTransfer !== null && q.paidByTransfer !== undefined &&
      q.decisionMaker !== null && q.decisionMaker !== undefined &&
      q.registered !== null && q.registered !== undefined &&
      q.noDeductions !== null && q.noDeductions !== undefined &&
      q.consentPossible !== null && q.consentPossible !== undefined);
  }
  const isQualified = (e) => qualComplete(e) && qualScore(e) >= 7 &&
    e.qualification.paidByTransfer === true && e.qualification.registered === true &&
    Number(e.qualification.staffCount) >= 10;

  function gateTo(emp, to) {
    if (!to) return { ok: false, message: "This employer is already at the final stage." };
    if (to === "contacted" && !(emp.phone || emp.email)) return { ok: false, message: "Add a phone number or email first." };
    if (to === "qualified" && !isQualified(emp)) {
      return { ok: false, message: "Qualification gate: complete all 7 answers, score 7/10+, 10+ staff, transfer payroll and CAC/TIN. Currently " + qualScore(emp) + "/10." };
    }
    if (to === "compliance" && !emp.qualification.demoDone) return { ok: false, message: "Mark the demo as completed below before moving to compliance." };
    if (to === "live" && !compliancePassed(emp)) {
      const missing = requiredMissing(emp).map((c) => c.label).join(", ");
      return { ok: false, message: "Compliance gate: still missing " + missing + "." };
    }
    return { ok: true, message: "" };
  }

  function advance(emp) {
    const to = nextStage(emp.stage);
    const g = gateTo(emp, to);
    if (!g.ok) { toast(g.message); return; }
    emp.stage = to;
    pushActivity(emp, "stage", "Moved to " + stage(to).label);
    if (to === "live") {
      if (!emp.metrics.employees) emp.metrics.employees = Number(emp.staffEstimate) || 0;
      if (!emp.metrics.revenue) emp.metrics.revenue = emp.metrics.employees * Number(state.revPerEmployee || 300);
      emp.nextAction = CI.stepAction("activation", 0, emp);
    } else if ((to === "demo" || to === "compliance") && emp.nextAction && emp.nextAction.seq === "school") {
      emp.nextAction = null;
    }
    save();
    render();
    toast("Moved to " + stage(to).label);
  }

  function seqFor(emp) {
    if (emp.stage === "live") return "activation";
    if (complianceStatus(emp) === "failed" || (emp.stage === "compliance" && emp.compliance.failReason)) return "recovery";
    return "school";
  }

  function completeEmployerAction(emp) {
    const na = emp.nextAction;
    if (!na) return;
    pushActivity(emp, "done", (TYPE_LABEL[na.type] || "Action") + ": " + na.title);
    if (emp.stage === "lead" && na.seq === "school") emp.stage = "contacted";
    const seq = CI.SEQUENCES[na.seq];
    const next = na.step + 1;
    if (seq && next < seq.steps.length) {
      emp.nextAction = CI.stepAction(na.seq, next, emp);
      toast("Done. Next: " + emp.nextAction.title + " · " + dueLabel(emp.nextAction.due));
    } else {
      emp.nextAction = null;
      toast("Cadence finished. Restart it or move the employer forward.");
    }
    save();
    render();
  }

  function snoozeAction(emp) {
    if (!emp.nextAction) return;
    emp.nextAction.due = addDays(today(), 1);
    save();
    render();
    toast("Snoozed to tomorrow.");
  }

  function restartCadence(emp) {
    emp.nextAction = CI.stepAction(seqFor(emp), 0, emp);
    pushActivity(emp, "note", "Cadence restarted");
    save();
    render();
    toast("Cadence restarted.");
  }

  function pushActivity(emp, type, text) {
    emp.activity = emp.activity || [];
    emp.activity.unshift({ date: today(), type: type, text: text });
  }

  function allActions() {
    const list = [];
    state.employers.forEach((e) => {
      if (e.stage !== "lost" && e.nextAction) {
        list.push(Object.assign({}, e.nextAction, { kind: "employer", emp: e, key: e.id }));
      }
    });
    state.tasks.forEach((t) => {
      if (!t.done) list.push(Object.assign({}, t, { kind: "task", key: t.id }));
    });
    return list.sort((a, b) => String(a.due).localeCompare(String(b.due)));
  }

  function currentNumbers() {
    const live = state.employers.filter((e) => e.stage === "live");
    const employees = sum(live, (e) => e.metrics.employees);
    const revenue = sum(live, (e) => e.metrics.revenue);
    return {
      live: live.length,
      employees: employees,
      revenue: revenue,
      perEmployee: employees ? Math.round(revenue / employees) : 0,
      ewa: sum(live, (e) => e.metrics.ewaActive),
      savings: sum(live, (e) => e.metrics.savingsFunded)
    };
  }

  function last7() {
    const out = { whatsapp: 0, calls: 0, demos: 0, packs: 0 };
    for (let i = 0; i < 7; i++) {
      const l = state.log[addDays(today(), -i)];
      if (!l) continue;
      out.whatsapp += Number(l.whatsapp) || 0;
      out.calls += Number(l.calls) || 0;
      out.demos += Number(l.demos) || 0;
      out.packs += Number(l.packs) || 0;
    }
    return out;
  }

  function logToday() {
    const d = today();
    if (!state.log[d]) state.log[d] = { whatsapp: 0, calls: 0, demos: 0, packs: 0 };
    return state.log[d];
  }

  /* ------------------------------------------------------------------ icons */
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    flow: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M10 6.5h4a3 3 0 0 1 3 3V14M6.5 10v4a3 3 0 0 0 3 3H14"/>',
    shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5Z"/><path d="M4 17.5h16"/>',
    chart: '<path d="M3 21h18M6 21V10M12 21V4M18 21v-7"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  function icon(name, cls) {
    return '<svg class="ico ' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }

  /* ------------------------------------------------------------------ shared bits */
  function stageBadge(id) {
    const s = stage(id);
    return '<span class="badge stage-' + s.id + '">' + esc(s.label) + "</span>";
  }
  function complianceBadge(e) {
    const st = complianceStatus(e);
    const label = st === "passed" ? "Compliance passed" : st === "failed" ? "Compliance failed" : st === "closed" ? "Closed" : "Compliance in progress";
    return '<span class="badge comp-' + st + '">' + label + "</span>";
  }
  function dueClass(d) {
    const n = diffDays(d, today());
    return n < 0 ? "overdue" : n === 0 ? "today" : "soon";
  }
  function progressBar(value, max, cls) {
    const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
    return '<div class="bar ' + (cls || "") + '"><span style="width:' + w + '%"></span></div>';
  }

  function displayStepTitle(t) {
    return String(t)
      .replace(" to {contact}", "")
      .replace(" to {name}", "")
      .replace(" at {name}", "")
      .replace("{contact}", "the contact")
      .replace("{name}", "the employer");
  }

  function scriptCard(id, opts) {
    const s = CI.SCRIPTS[id];
    if (!s) return "";
    const o = opts || {};
    return (
      '<div class="script-card">' +
      '<div class="script-head"><div><div class="script-title">' + esc(s.title) + "</div>" +
      '<div class="script-meta">' + esc(s.channel) + (s.when ? " · " + esc(s.when) : "") + "</div></div>" +
      '<button class="copy-btn" data-action="copy" data-script="' + id + '" type="button">Copy</button></div>' +
      (s.subject ? '<div class="script-subject">Subject: ' + esc(s.subject) + "</div>" : "") +
      '<pre class="script-body">' + esc(s.body) + "</pre>" +
      (o.next ? o.next : "") +
      "</div>"
    );
  }

  /* ------------------------------------------------------------------ TODAY */
  function viewToday() {
    const now = currentNumbers();
    const acts = allActions();
    const overdue = acts.filter((a) => diffDays(a.due, today()) < 0);
    const dueToday = acts.filter((a) => diffDays(a.due, today()) === 0);
    const next3 = acts.filter((a) => {
      const n = diffDays(a.due, today());
      return n > 0 && n <= 3;
    });
    const week = last7();
    const t = state.targets.weekly;
    const dueNow = overdue.length + dueToday.length;
    const live = state.employers.filter((e) => e.stage === "live").length;
    const triageLeft = state.employers.filter((e) => complianceStatus(e) === "failed" && e.compliance.fixable == null).length;

    const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
    let headline;
    if (overdue.length) headline = overdue.length + " overdue.<br>Clear " + dueNow + " today.";
    else if (dueNow) headline = (dueNow <= 10 ? words[dueNow] : String(dueNow)) + " " + (dueNow === 1 ? "action" : "actions") + "<br>before lunch.";
    else headline = "Queue clear.<br>Find ten schools.";

    const groups = [
      { title: "Overdue", items: overdue, cls: "overdue" },
      { title: "Today", items: dueToday, cls: "today" },
      { title: "Next 3 days", items: next3, cls: "soon" }
    ].filter((g) => g.items.length);

    return (
      '<section class="hero">' +
      '<div class="hero-main">' +
      '<div class="hero-eyebrow">' + esc(longDate(new Date())) + " · " + esc(isoWeek(new Date()) ? "Week " + isoWeek(new Date()) : "") + "</div>" +
      "<h1>" + headline + "</h1>" +
      '<p class="hero-sub">Free payroll is the door. Activation is the revenue. Every action in this queue points at the same number: naira per employee per month.</p>' +
      '<div class="hero-actions"><button class="light-btn" data-action="open-add" type="button">+ Add employer</button>' +
      '<button class="link-btn light" data-action="goto" data-route="pipeline" type="button">Source 25 targets ' + icon("arrow") + "</button></div>" +
      "</div>" +
      '<div class="hero-stats">' +
      heroStat("Due now", dueNow, overdue.length ? overdue.length + " overdue" : "keep it at zero") +
      heroStat("WhatsApp · 7d", week.whatsapp + " / " + t.whatsapp, week.whatsapp >= t.whatsapp ? "on pace" : t.whatsapp - week.whatsapp + " to go") +
      heroStat("Calls · 7d", week.calls + " / " + t.calls, week.calls >= t.calls ? "on pace" : t.calls - week.calls + " to go") +
      heroStat("Live payrolls", live, naira(now.revenue) + " / month") +
      "</div></section>" +

      '<div class="grid-main">' +
      '<div class="col">' +
      '<section class="card">' +
      '<div class="card-head"><div><div class="eyebrow">Do this now</div><h2>Action queue</h2></div>' +
      '<span class="pill">' + acts.length + " open</span></div>" +
      (groups.length ? groups.map(actionGroup).join("") :
        '<div class="empty"><div class="empty-icon">' + icon("check") + '</div><h3>Nothing scheduled</h3><p>Add employers and the 21-day cadence will fill this queue for you.</p><button class="primary-btn" data-action="open-add" type="button">Add your first employer</button></div>') +
      (acts.length > dueNow + next3.length ? '<div class="queue-foot">' + (acts.length - dueNow - next3.length) + " more scheduled later. " + '<button class="link-btn" data-action="goto" data-route="pipeline" type="button">See pipeline ' + icon("arrow") + "</button></div>" : "") +
      "</section>" +

      '<section class="card">' +
      '<div class="card-head"><div><div class="eyebrow">Daily discipline</div><h2>Log today</h2></div>' +
      '<span class="muted small">' + esc(shortDate(today())) + "</span></div>" +
      '<div class="counter-grid">' +
      counter("whatsapp", "WhatsApp sent", logToday().whatsapp) +
      counter("calls", "Calls made", logToday().calls) +
      counter("demos", "Demos run", logToday().demos) +
      counter("packs", "Compliance packs", logToday().packs) +
      "</div>" +
      '<p class="muted small counter-note">The scorecard is only as honest as this log. Count what you actually sent, not what you planned.</p>' +
      "</section>" +
      "</div>" +

      '<div class="col side">' +
      '<section class="card">' +
      '<div class="card-head"><div><div class="eyebrow">Last 7 days</div><h2>This week</h2></div></div>' +
      '<div class="metric-list">' +
      metricRow("WhatsApp", week.whatsapp, t.whatsapp) +
      metricRow("Calls", week.calls, t.calls) +
      metricRow("Demos", week.demos, t.demos) +
      metricRow("Compliance packs", week.packs, t.compliancePacks) +
      "</div></section>" +

      '<section class="card offer-card">' +
      '<div class="eyebrow">The offer</div>' +
      '<blockquote>“Free payroll for the school. Financial wellbeing for the staff. We earn when they save or use salary they have already earned.”</blockquote>' +
      '<button class="ghost-btn" data-action="goto" data-route="playbook" type="button">Open the playbook ' + icon("arrow") + "</button>" +
      "</section>" +

      '<section class="card">' +
      '<div class="card-head"><div><div class="eyebrow">First 30 minutes</div><h2>Start here</h2></div><span class="pill">' + doneChecklist() + "/" + Object.keys(state.checklist).length + "</span></div>" +
      '<div class="checklist">' +
      Object.keys(state.checklist).map((k, i) =>
        '<label class="check-item"><input type="checkbox" data-action="checklist" data-key="' + esc(k) + '" ' + (state.checklist[k] ? "checked" : "") + ">" +
        "<span>" + esc(k) + "</span></label>").join("") +
      "</div></section>" +

      (triageLeft ? '<section class="card alert-card"><div class="alert-head">' + icon("shield") + "<div><strong>" + triageLeft + " failed employers still unclassified</strong><p>Fixable or not a fit — decide this week. They are not a pipeline until you do.</p></div></div>" +
        '<button class="ghost-btn" data-action="goto" data-route="compliance" type="button">Triage them ' + icon("arrow") + "</button></section>" : "") +
      "</div></div>"
    );
  }

  function heroStat(label, value, sub) {
    return '<div class="hero-stat"><span>' + esc(label) + "</span><strong>" + esc(value) + "</strong><em>" + esc(sub) + "</em></div>";
  }
  function doneChecklist() {
    return Object.keys(state.checklist).filter((k) => state.checklist[k]).length;
  }
  function metricRow(label, value, target) {
    const ok = value >= target;
    return '<div class="metric-row"><div class="metric-top"><span>' + esc(label) + "</span><strong class=\"" + (ok ? "good" : "") + "\">" + value + " <i>/ " + target + "</i></strong></div>" +
      progressBar(value, target, ok ? "good" : "") + "</div>";
  }
  function counter(metric, label, value) {
    return '<div class="counter"><div class="counter-label">' + esc(label) + '</div>' +
      '<div class="counter-row"><button class="step-btn" data-action="log" data-metric="' + metric + '" data-delta="-1" type="button" aria-label="Decrease">−</button>' +
      '<span class="counter-val" id="count-' + metric + '">' + value + "</span>" +
      '<button class="step-btn" data-action="log" data-metric="' + metric + '" data-delta="1" type="button" aria-label="Increase">+</button></div></div>';
  }
  function actionGroup(g) {
    return '<div class="queue-group"><div class="queue-title ' + g.cls + '">' + esc(g.title) + '<span>' + g.items.length + "</span></div>" +
      g.items.map(actionRow).join("") + "</div>";
  }
  function actionRow(a) {
    const emp = a.kind === "employer" ? a.emp : null;
    const name = emp ? emp.name : null;
    const detail = a.detail || "";
    const isTask = a.kind === "task";
    return '<div class="action-row">' +
      '<span class="type-chip tc-' + esc(a.type || "admin") + '">' + esc(TYPE_SHORT[a.type] || "TASK") + "</span>" +
      '<div class="action-main" data-action="' + (isTask ? "open-task" : "open") + '" ' + (isTask ? 'data-task="' + esc(a.id) + '"' : 'data-emp="' + esc(emp.id) + '"') + ' role="button" tabindex="0">' +
      '<div class="action-title">' + esc(a.title) + "</div>" +
      '<div class="action-meta">' + (name ? esc(name) + " · " : "") + esc(detail) +
      (a.script ? ' · <span class="has-script">script attached</span>' : "") + "</div>" +
      "</div>" +
      '<span class="due ' + dueClass(a.due) + '">' + esc(dueLabel(a.due)) + "</span>" +
      '<div class="action-btns">' +
      '<button class="done-btn" data-action="' + (isTask ? "complete-task" : "complete") + '" ' + (isTask ? 'data-task="' + esc(a.id) + '"' : 'data-emp="' + esc(emp.id) + '"') + ' type="button">Done</button>' +
      '<button class="snooze-btn" data-action="' + (isTask ? "snooze-task" : "snooze") + '" ' + (isTask ? 'data-task="' + esc(a.id) + '"' : 'data-emp="' + esc(emp.id) + '"') + ' type="button" title="Snooze one day">+1d</button>' +
      "</div></div>";
  }

  /* ------------------------------------------------------------------ PIPELINE */
  function viewPipeline() {
    const live = state.employers.filter((e) => e.stage !== "lost");
    const cols = CI.STAGES.filter((s) => s.id !== "lost");
    const lost = state.employers.filter((e) => e.stage === "lost");
    return (
      '<header class="page-head">' +
      '<div><div class="eyebrow">Where the money comes from</div><h1>Pipeline</h1><p>Source in batches, qualify before you demo, and never sell past the compliance gate.</p></div>' +
      '<div class="head-actions"><button class="ghost-btn" data-action="open-bulk" type="button">Paste a list</button>' +
      '<button class="primary-btn" data-action="open-add" type="button">+ Add employer</button></div></header>' +

      '<section class="card source-card" id="source">' +
      '<div class="card-head"><div><div class="eyebrow">Step one</div><h2>Find 25 employers this week</h2></div><span class="pill">' + live.length + " in pipeline</span></div>" +
      '<p class="muted">Schools first: 10–150 staff, monthly payroll, salaries paid by transfer. Two of your three live employers are schools — copy what already works.</p>' +
      '<div class="source-grid">' + CI.SOURCING.map((s) =>
        '<a class="source-link" href="' + esc(s.href) + '" target="_blank" rel="noopener">' +
        "<strong>" + esc(s.label) + "</strong><span>" + esc(s.detail) + "</span>" + icon("arrow") + "</a>").join("") +
      "</div>" +
      '<div class="source-tip">' + icon("check") + "<span><strong>Qualify on the first call.</strong> Cash payroll, no CAC or no TIN means they will fail the gate — park them and keep moving.</span></div>" +
      "</section>" +

      '<div class="board-tools"><input class="search" id="pipe-search" placeholder="Search employer, contact or area…" autocomplete="off">' +
      '<span class="muted small">Click any card to open the record. Stages are gated.</span></div>' +

      '<div class="board">' + cols.map((s) => {
        const items = state.employers.filter((e) => e.stage === s.id);
        return '<div class="board-col"><div class="board-col-head"><span class="dot dot-' + s.id + '"></span><strong>' + esc(s.label) + "</strong><em>" + items.length + "</em></div>" +
          '<div class="board-col-hint">' + esc(s.hint) + "</div>" +
          (items.length ? items.map(boardCard).join("") : '<div class="board-empty">Nothing here yet</div>') +
          "</div>";
      }).join("") + "</div>" +

      (lost.length ? '<div class="lost-strip"><span class="muted small">Parked / lost · ' + lost.length + "</span>" +
        lost.map((e) => '<button class="lost-chip" data-action="open" data-emp="' + esc(e.id) + '" type="button">' + esc(e.name) + "</button>").join("") + "</div>" : "")
    );
  }

  function boardCard(e) {
    const st = complianceStatus(e);
    const due = e.nextAction ? dueLabel(e.nextAction.due) : "No next action";
    return '<article class="employer-card" data-action="open" data-emp="' + esc(e.id) + '" data-search="' + esc((e.name + " " + (e.contact || "") + " " + (e.city || "")).toLowerCase()) + '" tabindex="0">' +
      (st === "failed" ? '<div class="ec-top"><span class="mini-flag">Gate failed</span></div>' : "") +
      '<h3>' + esc(e.name) + "</h3>" +
      '<div class="ec-meta">' + esc(e.segment || "—") + (e.city ? " · " + esc(e.city) : "") + "</div>" +
      '<div class="ec-foot"><span>' + (Number(e.staffEstimate) ? num(e.staffEstimate) + " staff" : "staff unknown") + "</span>" +
      '<span class="due ' + dueClass(e.nextAction ? e.nextAction.due : today()) + '">' + esc(due) + "</span></div>" +
      "</article>";
  }

  /* ------------------------------------------------------------------ COMPLIANCE */
  function viewCompliance() {
    const failed = state.employers.filter((e) => complianceStatus(e) === "failed");
    const passed = state.employers.filter((e) => complianceStatus(e) === "passed" && e.stage === "live").length;
    const triaged = failed.filter((e) => e.compliance.fixable != null).length;
    const unclassified = failed.length - triaged;
    return (
      '<header class="page-head">' +
      '<div><div class="eyebrow">The gate that killed 7 of 11</div><h1>Compliance</h1><p>Seven of eleven employers failed after they signed up. That is a sales problem, not just an operations problem — so the gate now sits in front of the sale.</p></div>' +
      "</header>" +

      '<div class="stat-row">' +
      stat("Signed up", "11", "historical") +
      stat("Passed", "4", "36% pass rate", "warn") +
      stat("Live &amp; paying", String(passed), "current pipeline") +
      stat("Failed", String(failed.length), unclassified + " untriaged", "bad") +
      "</div>" +

      '<div class="grid-two">' +
      '<section class="card">' +
      '<div class="card-head"><div><div class="eyebrow">Before the first demo</div><h2>The pre-qualification gate</h2></div></div>' +
      '<div class="gate-steps">' +
      '<div class="gate-step"><span>1</span><div><strong>Ask the six questions on the first call.</strong><p>Staff count, payroll value, transfer vs cash, decision maker, CAC/TIN, existing deductions.</p></div></div>' +
      '<div class="gate-step"><span>2</span><div><strong>Score 7/10 or park them.</strong><p>Below 10 staff or cash payroll is a no for now. Politely close and revisit next term.</p></div></div>' +
      '<div class="gate-step"><span>3</span><div><strong>Collect documents before the demo.</strong><p>If they cannot produce CAC, TIN and a staff list, the demo is a waste of both calendars.</p></div></div>' +
      '<div class="gate-step"><span>4</span><div><strong>No exceptions at go-live.</strong><p>All eight required checks must pass. The partner bank will ask; better you ask first.</p></div></div>' +
      "</div></section>" +

      '<section class="card">' +
      '<div class="card-head"><div><div class="eyebrow">Copy and send</div><h2>Document request</h2></div>' +
      '<button class="copy-btn" data-action="copy" data-script="wa_docs" type="button">Copy</button></div>' +
      '<p class="muted small">Send this after the qualification call, before you book the demo.</p>' +
      '<ul class="doc-list">' + CI.REQUIRED_CHECKS.map((c) => "<li><strong>" + esc(c.label) + "</strong><span>" + esc(c.detail) + "</span></li>").join("") + "</ul>" +
      "</section></div>" +

      '<section class="card" id="triage">' +
      '<div class="card-head"><div><div class="eyebrow">Clean up the past</div><h2>Triage the seven</h2></div><span class="pill">' + triaged + " / " + failed.length + " classified</span></div>" +
      (failed.length ? '<div class="triage-table">' + failed.map(triageRow).join("") + "</div>" :
        '<div class="empty small-empty"><h3>Nothing failed in the pipeline</h3><p>Either compliance is clean or the failed records were removed.</p></div>') +
      '<p class="muted small triage-note">Rename each record to the real employer first. A reason is not a diagnosis: “documents missing” is not fixable until you know which document.</p>' +
      "</section>" +

      '<section class="card">' +
      '<div class="card-head"><div><div class="eyebrow">Say no earlier</div><h2>Red flags</h2></div></div>' +
      '<div class="flag-grid">' + CI.RED_FLAGS.map((f, i) =>
        '<div class="flag"><span class="flag-num">0' + (i + 1) + "</span><div><strong>" + esc(f.title) + "</strong><p>" + esc(f.detail) + "</p></div></div>").join("") +
      "</div></section>"
    );
  }
  function stat(label, value, sub, cls) {
    return '<div class="stat ' + (cls || "") + '"><span>' + label + '</span><strong>' + value + "</strong><em>" + sub + "</em></div>";
  }
  function triageRow(e) {
    const fix = e.compliance.fixable;
    return '<div class="triage-row">' +
      '<div class="triage-name"><button class="link-btn" data-action="open" data-emp="' + esc(e.id) + '" type="button">' + esc(e.name) + "</button>" +
      '<span class="muted small">' + esc(e.compliance.failReason || "Reason not recorded") + "</span></div>" +
      '<div class="seg" role="group" aria-label="Fixable?">' +
      '<button class="seg-btn ' + (fix === true ? "active" : "") + '" data-action="fixable" data-emp="' + esc(e.id) + '" data-value="yes" type="button">Fixable</button>' +
      '<button class="seg-btn ' + (fix === false ? "active danger" : "") + '" data-action="fixable" data-emp="' + esc(e.id) + '" data-value="no" type="button">Not a fit</button>' +
      "</div>" +
      '<div class="triage-next">' + (e.nextAction ? '<span class="due ' + dueClass(e.nextAction.due) + '">' + esc(dueLabel(e.nextAction.due)) + "</span>" : '<span class="muted small">No next action</span>') + "</div>" +
      "</div>";
  }

  /* ------------------------------------------------------------------ PLAYBOOK */
  function viewPlaybook() {
    const tabs = [
      ["pitch", "The pitch"], ["qualify", "Qualify"], ["outreach", "Outreach"],
      ["activate", "Activate"], ["objections", "Objections"], ["recovery", "Recovery"]
    ];
    let body = "";
    if (ui.tab === "pitch") body = tabPitch();
    if (ui.tab === "qualify") body = tabQualify();
    if (ui.tab === "outreach") body = tabOutreach();
    if (ui.tab === "activate") body = tabActivate();
    if (ui.tab === "objections") body = tabObjections();
    if (ui.tab === "recovery") body = tabRecovery();
    return '<header class="page-head"><div><div class="eyebrow">Say it the same way every time</div><h1>Playbook</h1>' +
      '<p>The exact words for the first call, the cadence, the staff session and the payday push. Copy, replace the brackets, send.</p></div></header>' +
      '<div class="tabs">' + tabs.map((t) =>
        '<button class="tab ' + (ui.tab === t[0] ? "active" : "") + '" data-action="tab" data-tab="' + t[0] + '" type="button">' + t[1] + "</button>").join("") +
      "</div>" + body;
  }

  function tabPitch() {
    return '<section class="card pitch-main"><div class="eyebrow">One breath</div>' +
      '<h2 class="pitch-line">“We run your payroll for free. Your staff get a salary account with savings and access to pay they have already earned. The school pays nothing.”</h2>' +
      '<p class="muted">Then stop talking. The next question is theirs.</p>' +
      '<div class="pitch-cols">' +
      '<div><h4>The school gets</h4><ul><li>Payroll run free, every month</li><li>Salaries paid on time</li><li>No setup fee, no per-staff fee</li><li>A cleaner payroll record</li></ul></div>' +
      '<div><h4>The staff get</h4><ul><li>A salary account in their name</li><li>Savings on payday</li><li>Earned-salary access, capped</li><li>No loan-app spiral</li></ul></div>' +
      '<div><h4>ChequeIn earns</h4><ul><li>When staff save</li><li>When staff use earned salary</li><li>Later: credit through the partner bank</li><li>Not from the employer</li></ul></div>' +
      "</div></section>" +
      '<div class="three-col">' +
      '<section class="card"><div class="eyebrow">The maths that matters</div><h2>₦300 × staff</h2>' +
      '<p class="muted small">Baseline revenue per employee per month. 106 employees produce ₦31,905.</p>' +
      '<div class="math-box"><div><span>45 staff</span><strong>₦13,500</strong><em>per month</em></div><div><span>10 employers</span><strong>₦135,000</strong><em>per month</em></div></div>' +
      '<p class="muted small">That is why a 45-person school is worth more than five 8-person shops — and why activation matters more than sign-ups.</p>' +
      '<p class="muted small note">At 50% activation and ₦900 per active user, the same school is worth ₦20,250 a month.</p></section>' +
      '<section class="card"><div class="eyebrow">Who to target</div><h2>Schools, 10–150 staff</h2>' +
      '<ul class="tight"><li>Monthly payroll, paid by transfer</li><li>CAC + TIN already in place</li><li>Owner or proprietor reachable</li><li>Two of your three live employers are schools — copy that</li></ul>' +
      '<p class="muted small note">Clinics and agencies are the next segment — same payroll profile, but check seasonality before you promise a payday rhythm.</p>' +
      '<button class="ghost-btn" data-action="goto" data-route="pipeline" type="button">Open pipeline ' + icon("arrow") + "</button></section>" +
      scriptCard("call_opener") +
      "</div>" +
      '<section class="card after-card"><div class="card-head"><div><div class="eyebrow">Between yes and first payroll</div><h2>What happens next</h2></div><span class="pill">the handoff is the sale</span></div>' +
      '<div class="after-grid">' +
      afterStep(1, "Same day", "Send the document list", "WhatsApp, not email. Photos are fine. Name the two documents you actually need first.") +
      afterStep(2, "Within 48h", "Run compliance", "Send the pack to the partner bank and tell the employer what is still missing — not that it is 'in review'.") +
      afterStep(3, "Day 3–5", "Book the staff session", "Put it in the calendar for payday week. The session is the product, not an afterthought.") +
      afterStep(4, "Payday", "First payroll + session", "Run payroll, then 20 minutes with staff. Help the ones who get stuck, in person.") +
      afterStep(5, "Payday +1", "Activation nudge", "Send the employer the list of staff who did not finish. Then send the payday savings push.") +
      "</div>" +
      '<p class="muted small after-note">Most deals die in this gap, not in the pitch. Keep the next action in the system and the employer never waits on you.</p></section>';
  }

  function afterStep(n, when, title, text) {
    return '<div class="after-step"><div class="after-num">' + n + '</div><div class="after-when">' + esc(when) + '</div><h4>' + esc(title) + "</h4><p>" + esc(text) + "</p></div>";
  }

  function tabQualify() {
    return '<div class="grid-two">' +
      '<section class="card"><div class="card-head"><div><div class="eyebrow">12 minutes, first call</div><h2>The six questions</h2></div>' +
      '<span class="pill">score ≥ 7/10</span></div>' +
      '<div class="qual-table">' + CI.QUALIFICATION.map((q, i) =>
        '<div class="qual-row"><span class="q-num">0' + (i + 1) + "</span><div><strong>" + esc(q.label) + "</strong><p>" + esc(q.hint) + "</p></div></div>").join("") + "</div>" +
      '<p class="muted small">Staff count and payroll value are numbers. The rest are yes/no. Ask them in this order — the cash question early saves everyone time.</p></section>' +
      '<section class="col"><div class="card">' +
      '<div class="eyebrow">Kill criteria</div><h2>Say no early</h2>' +
      '<ul class="stop-list"><li><strong>Cash payroll</strong> — no salary trail, no account.</li><li><strong>No CAC or TIN</strong> — will fail the bank review.</li><li><strong>Under 10 staff</strong> — revenue never covers onboarding.</li><li><strong>No decision maker</strong> — you are collecting maybes.</li><li><strong>Another lender’s deduction</strong> — partner sign-off first.</li></ul>' +
      '<div class="callout">Seven of eleven employers failed after sign-up. Most of those conversations should never have reached compliance. Every “no” on this call buys you an hour for a school that can actually go live.</div>' +
      "</div>" +
      '<div class="card"><div class="eyebrow">The compliance question</div><h2>Ask for documents now</h2>' +
      '<p class="muted small">“To get you live we need eight documents. Can you send photos of the CAC, TIN and staff list today? I’ll tell you exactly what’s missing before we book the demo.”</p>' +
      '<button class="ghost-btn" data-action="copy" data-script="wa_docs" type="button">Copy the request</button></div></section></div>';
  }

  function tabOutreach() {
    const seq = CI.SEQUENCES.school;
    return '<section class="card">' +
      '<div class="card-head"><div><div class="eyebrow">' + esc(seq.label) + '</div><h2>Eight touches, 21 days</h2></div>' +
      '<span class="pill">WhatsApp first</span></div>' +
      '<p class="muted">The cadence schedules itself when you add an employer. Each touch below is already written. Do not skip the break-up — it is the one that gets replies.</p>' +
      '<div class="timeline">' + seq.steps.map((s, i) => {
        const script = s.script ? CI.SCRIPTS[s.script] : null;
        return '<div class="tl-item"><div class="tl-dot">' + (i + 1) + "</div><div class=\"tl-body\">" +
          '<div class="tl-head"><span class="type-chip tc-' + s.type + '">' + esc(TYPE_SHORT[s.type]) + "</span>" +
          "<strong>" + esc(displayStepTitle(s.title)) + "</strong><em>Day " + s.gap + "</em></div>" +
          '<p class="muted small">' + esc(s.detail) + "</p>" +
          (script ? '<details class="inline-script"><summary>View script · ' + esc(script.channel) + "</summary><pre>" + esc(script.body) + '</pre><button class="copy-btn" data-action="copy" data-script="' + s.script + '" type="button">Copy</button></details>' : "") +
          "</div></div>";
      }).join("") + "</div></section>" +
      '<div class="grid-two"><section class="card"><h2>Send it well</h2><ul class="tight">' +
      "<li>WhatsApp before 9am — that is when administrators do admin.</li><li>One message, one ask. Never two questions.</li><li>Voice notes after a reply; they convert better than paragraphs.</li><li>Log every send in Today. The scorecard depends on it.</li></ul></section>" +
      '<section class="card"><h2>The only metric</h2><p class="muted">Demos booked per 25 messages. If it is under one, the list is wrong — not the script. Change the list before you change the words.</p>' +
      '<div class="math-box"><div><span>25 sent</span><strong>1 demo</strong><em>minimum</em></div><div><span>8 demos</span><strong>2 live</strong><em>target</em></div></div></section></div>';
  }

  function tabActivate() {
    const seq = CI.SEQUENCES.activation;
    return '<section class="card">' +
      '<div class="card-head"><div><div class="eyebrow">' + esc(seq.label) + '</div><h2>Sign-up is not activation</h2></div><span class="pill">8% save · 33% EWA</span></div>' +
      '<p class="muted">24 of 25 recent sign-ups completed KYC. Two funded savings. One came back within 30 days. The gap is not the app — it is the absence of a human at the moment salary lands.</p>' +
      '<div class="timeline compact">' + seq.steps.map((s, i) => {
        const script = s.script ? CI.SCRIPTS[s.script] : null;
        return '<div class="tl-item"><div class="tl-dot">' + (i + 1) + "</div><div class=\"tl-body\">" +
          '<div class="tl-head"><span class="type-chip tc-' + s.type + '">' + esc(TYPE_SHORT[s.type]) + "</span>" +
          "<strong>" + esc(displayStepTitle(s.title)) + "</strong><em>Day " + s.gap + "</em></div>" +
          '<p class="muted small">' + esc(s.detail) + "</p>" +
          (script ? '<details class="inline-script"><summary>View script</summary><pre>' + esc(script.body) + '</pre><button class="copy-btn" data-action="copy" data-script="' + s.script + '" type="button">Copy</button></details>' : "") +
          "</div></div>";
      }).join("") + "</div></section>" +
      '<div class="grid-two">' + scriptCard("activation_session") + scriptCard("payday_push") + "</div>" +
      '<section class="card callout-card"><div class="eyebrow">The rule</div><p class="big-quote">“A new employer without a staff session is a payroll, not a customer. The session is the product.”</p></section>';
  }

  function tabObjections() {
    return '<div class="grid-two"><section class="card"><div class="eyebrow">Expect these</div><h2>Objections</h2>' +
      CI.OBJECTIONS.map((o) => '<details class="objection"><summary>' + esc(o.q) + "</summary><p>" + esc(o.a) + '</p><button class="copy-btn" data-action="copy-text" data-text="' + esc(o.a) + '" type="button">Copy answer</button></details>').join("") +
      "</section>" +
      '<section class="col"><div class="card"><div class="eyebrow">Tone</div><h2>How to say it</h2><ul class="tight">' +
      "<li>Slow down on “free”. Let the silence do the work.</li><li>Never argue with “we already have someone”. Offer a parallel month.</li><li>Do not defend the EWA fee. Explain the cap and the alternative.</li><li>If they are cash-paid, say no in the first call. Politely.</li><li>Ask for the decision maker by name. “Who signs payroll?”</li></ul></div>" +
      '<div class="card"><div class="eyebrow">After the demo</div><h2>The close</h2><p class="muted small">“I’ll send the document list today. If you send the CAC, TIN and staff list by Friday, I can hold an onboarding slot for the first week of next month. Does that work?”</p>' +
      '<button class="ghost-btn" data-action="copy" data-script="wa_docs" type="button">Copy document list</button></div></section></div>';
  }

  function tabRecovery() {
    return '<div class="grid-two"><section class="card"><div class="eyebrow">The seven</div><h2>Triage, don’t re-sell</h2>' +
      '<p class="muted">These employers already said yes once. Do not pitch them again — find the exact blocker and remove it.</p>' +
      '<div class="timeline compact">' + CI.SEQUENCES.recovery.steps.map((s, i) =>
        '<div class="tl-item"><div class="tl-dot">' + (i + 1) + '</div><div class="tl-body"><div class="tl-head"><span class="type-chip tc-' + s.type + '">' + esc(TYPE_SHORT[s.type]) + "</span><strong>" + esc(displayStepTitle(s.title)) + "</strong><em>Day " + s.gap + "</em></div><p class=\"muted small\">" + esc(s.detail) + "</p></div></div>").join("") +
      "</div></section>" +
      '<section class="col">' + scriptCard("recovery_call") + scriptCard("recovery_docs") + "</section></div>" +
      '<section class="card"><div class="eyebrow">Decision rule</div><h2>Fixable or out</h2>' +
      '<div class="decision-grid"><div><strong>Fixable</strong><p>Missing or expired document, name mismatch, consent not collected. Give it 14 days and a named next action.</p></div>' +
      '<div><strong>Not a fit</strong><p>Cash payroll, no registration, refuses consent, or 14 days of silence. Park it, log why, revisit next term.</p></div>' +
      '<div><strong>Unknown</strong><p>Do not leave it here. Unknown is how seven deals sat dead for weeks.</p></div></div></section>';
  }

  /* ------------------------------------------------------------------ NUMBERS */
  function viewNumbers() {
    const n = currentNumbers();
    const b = state.baseline;
    const q = state.targets.quarter;
    const week = last7();
    const wt = state.targets.weekly;
    const modelRev = state.revPerActive || (n.ewa ? Math.round(n.revenue / n.ewa) : 900);
    return '<header class="page-head"><div><div class="eyebrow">The only scoreboard</div><h1>Numbers</h1>' +
      '<p>' + n.employees + ' employees, ' + naira(n.revenue) + ' a month. The job is more employees paid through ChequeIn, and more revenue from each one.</p></div>' +
      '<div class="head-actions"><span class="pill">Baseline ' + esc(b.asOf) + "</span></div></header>" +

      '<div class="kpi-grid">' +
      kpi("Monthly revenue", naira(n.revenue), "live payrolls", "") +
      kpi("Employees paid", num(n.employees), "through ChequeIn", "") +
      kpi("Revenue / employee", naira(n.perEmployee), "target " + naira(q.revenuePerEmployee), n.perEmployee < q.revenuePerEmployee ? "warn" : "good") +
      kpi("Live employers", String(n.live), "target " + q.employersLive, n.live < q.employersLive ? "warn" : "good") +
      kpi("EWA users", pct(n.employees ? n.ewa / n.employees : b.ewaPenetration), "baseline 33%", "") +
      kpi("Savings funded", pct(n.employees ? n.savings / n.employees : b.savingsRate), "baseline 8%", "bad") +
      kpi("30-day retention", pct(b.retained30d / b.signups30d), "1 of 25 sign-ups", "bad") +
      kpi("EWA repayment", (b.repayment * 100).toFixed(1) + "%", "verify definition", "bad") +
      "</div>" +

      '<div class="grid-two">' +
      '<section class="card"><div class="card-head"><div><div class="eyebrow">The funnel, honestly</div><h2>Where it leaks</h2></div></div>' +
      '<div class="funnel">' +
      funnelRow("Employers signed", 11, 11, "11") +
      funnelRow("Passed compliance", 4, 11, "4") +
      funnelRow("Live payrolls", 3, 11, "3") +
      funnelRow("Employees paid", 106, 106, "106") +
      funnelRow("Using EWA", 35, 106, "33%") +
      funnelRow("Funded savings", 8, 106, "8%") +
      "</div>" +
      '<p class="muted small">The biggest drop is not sign-up — it is activation. 106 people are paid through you and eight save. Fix that before adding more employers.</p></section>' +

      '<section class="card"><div class="card-head"><div><div class="eyebrow">Direction</div><h2>Quarter target</h2></div><span class="pill">90 days</span></div>' +
      progressRow("Live employers", n.live, q.employersLive) +
      progressRow("Employees paid", n.employees, q.activeEmployees) +
      progressRow("Revenue / employee", n.perEmployee, q.revenuePerEmployee) +
      progressRow("Compliance pass rate", 0.36, q.compliancePass) +
      progressRow("Activation (any product)", 0.33, q.activation) +
      progressRow("Savings rate", 0.08, q.savingsRate) +
      '<div class="callout">To hit ' + naira(q.activeEmployees * q.revenuePerEmployee) + " a month you need " + q.employersLive + " employers at about 50 staff each — and half of those staff using a product. The first number is sales. The second is activation.</div>" +
      "</section></div>" +

      '<section class="card model-card"><div class="card-head"><div><div class="eyebrow">Play with it</div><h2>Revenue model</h2></div><span class="pill">₦' + num(modelRev) + " / active user</span></div>" +
      '<div class="model-grid">' +
      '<div class="model-controls">' +
      modelSlider("m-emp", "Employers", 1, 30, 8, "") +
      modelSlider("m-staff", "Staff per employer", 5, 150, 50, "") +
      modelSlider("m-act", "Activation rate", 10, 90, 50, "%") +
      modelSlider("m-rev", "Revenue per active user", 200, 2000, modelRev, "₦", 50) +
      "</div>" +
      '<div class="model-out">' +
      '<div class="model-big"><span>Monthly revenue</span><strong id="m-out-mrr">₦0</strong></div>' +
      '<div class="model-sub three"><div><span>Employees paid</span><strong id="m-out-paid">0</strong></div>' +
      '<div><span>Active users</span><strong id="m-out-active">0</strong></div>' +
      '<div><span>Annual run-rate</span><strong id="m-out-arr">₦0</strong></div></div>' +
      '<p class="muted small">Baseline: ' + num(n.employees) + ' paid employees, ' + num(n.ewa) + ' active users and ' + naira(n.revenue) + ' a month — about ' + naira(modelRev) + ' per active user.</p>' +
      "</div></div></section>" +

      '<div class="grid-two">' +
      '<section class="card" id="scorecard"><div class="card-head"><div><div class="eyebrow">Last 7 days</div><h2>Weekly scorecard</h2></div><span class="pill">inputs</span></div>' +
      '<div class="score-table">' +
      scoreRow("WhatsApp sent", week.whatsapp, wt.whatsapp) +
      scoreRow("Calls made", week.calls, wt.calls) +
      scoreRow("Demos run", week.demos, wt.demos) +
      scoreRow("Compliance packs", week.packs, wt.compliancePacks) +
      "</div>" +
      '<p class="muted small">Inputs are the only thing you control. If these are green for four weeks, the outputs follow.</p></section>' +

      '<section class="card"><div class="card-head"><div><div class="eyebrow">Watch this</div><h2>Repayment warning</h2></div></div>' +
      '<p class="muted">EWA repayment is reported at <strong>6.4%</strong>. If that means recovered ÷ due, EWA is not working and credit is not the next product — collections is. Confirm the definition with your partner bank this week, then track it weekly here.</p>' +
      '<div class="callout danger">Do not market credit on a repayment number you cannot explain.</div></section></div>' +

      '<section class="card"><div class="card-head"><div><div class="eyebrow">Next 90 days</div><h2>The plan</h2></div></div>' +
      '<div class="phase-grid">' +
      phase("Weeks 1–2", "Fix the gate, fill the list", ["Rename and triage the 7 failed employers", "Build 25 school targets with phone numbers", "Send the first 10 openers", "Run the Will’B’ staff session"], "25 targets · 7 triaged") +
      phase("Weeks 3–6", "First new go-live", ["40 conversations · 8 demos", "3 compliance packs out", "1–2 new employers live", "First staff session at a new school"], "2 new live · 80 staff") +
      phase("Weeks 7–12", "Activation proof", ["50% of staff on a product", "25% funding savings", "EWA recovery understood and ≥ 90%", "8 live employers · 400 employees"], "₦180k MRR") +
      "</div></section>";
  }

  function kpi(label, value, sub, cls) {
    return '<div class="kpi ' + (cls || "") + '"><span>' + esc(label) + "</span><strong>" + esc(value) + "</strong><em>" + esc(sub) + "</em></div>";
  }
  function funnelRow(label, value, max, display) {
    return '<div class="funnel-row"><span class="f-label">' + esc(label) + "</span>" +
      '<div class="f-bar"><span style="width:' + Math.max(2, Math.round((value / max) * 100)) + '%"></span></div>' +
      "<strong>" + esc(display) + "</strong></div>";
  }
  function progressRow(label, value, target) {
    const p = Math.min(100, Math.round((value / target) * 100));
    return '<div class="progress-row"><div class="progress-top"><span>' + esc(label) + "</span><strong>" + p + "%</strong></div>" + progressBar(value, target) + "</div>";
  }
  function scoreRow(label, actual, target) {
    const cls = actual >= target ? "good" : actual === 0 ? "bad" : "warn";
    return '<div class="score-row"><span>' + esc(label) + "</span><strong class=\"" + cls + "\">" + actual + "</strong><em>/ " + target + "</em>" + progressBar(actual, target, cls) + "</div>";
  }
  function modelSlider(id, label, min, max, value, suffix, step) {
    return '<label class="model-slider"><span>' + esc(label) + ' <strong id="' + id + '-label">' + (suffix === "₦" ? "₦" + num(value) : value + (suffix || "")) + "</strong></span>" +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + value + '" data-model="' + id + '"></label>';
  }
  function phase(when, title, items, target) {
    return '<div class="phase"><div class="phase-when">' + esc(when) + '</div><h3>' + esc(title) + "</h3><ul>" + items.map((i) => "<li>" + esc(i) + "</li>").join("") + '</ul><div class="phase-target">' + esc(target) + "</div></div>";
  }

  /* ------------------------------------------------------------------ DRAWER */
  function waNumber(phone) {
    let d = String(phone || "").replace(/[^\d]/g, "");
    if (!d) return "";
    if (d.charAt(0) === "0") d = "234" + d.slice(1);
    return d.length >= 10 ? d : "";
  }
  function fillScript(text, emp) {
    return String(text || "")
      .replace(/\{contact\}/g, emp.contact || emp.name)
      .replace(/\{employer\}/g, emp.name)
      .replace(/\{name\}/g, emp.name);
  }
  function outreachLink(emp, na) {
    if (!na) return "";
    const phone = String(emp.phone || "").trim();
    if (na.type === "whatsapp" && phone) {
      const n = waNumber(phone);
      if (!n) return "";
      const body = na.script && CI.SCRIPTS[na.script] ? fillScript(CI.SCRIPTS[na.script].body, emp) : "";
      return '<a class="ghost-btn wa-link" target="_blank" rel="noopener" href="https://wa.me/' + n + (body ? "?text=" + encodeURIComponent(body) : "") + '">Open WhatsApp</a>';
    }
    if (na.type === "call" && phone) {
      return '<a class="ghost-btn" href="tel:' + esc(phone.replace(/[^\d+]/g, "")) + '">Call now</a>';
    }
    if (na.type === "email" && emp.email) {
      const sc = na.script ? CI.SCRIPTS[na.script] : null;
      const subject = sc && sc.subject ? fillScript(sc.subject, emp) : "Free payroll for " + emp.name;
      const body = sc ? fillScript(sc.body, emp) : "";
      return '<a class="ghost-btn" href="mailto:' + esc(emp.email) + "?subject=" + encodeURIComponent(subject) + "&amp;body=" + encodeURIComponent(body) + '">Compose email</a>';
    }
    return "";
  }

  function renderDrawer() {
    const drawer = $("#drawer");
    const emp = state.employers.find((e) => e.id === ui.drawer);
    if (!emp) {
      drawer.hidden = true;
      drawer.dataset.empId = "";
      $("#scrim").hidden = true;
      document.body.classList.remove("locked");
      return;
    }
    const keepScroll = drawer.dataset.empId === emp.id ? drawer.scrollTop : 0;
    const st = complianceStatus(emp);
    const next = nextStage(emp.stage);
    const gate = gateTo(emp, next);
    const missing = requiredMissing(emp);
    const score = qualScore(emp);
    const target = stage(emp.stage);
    drawer.hidden = false;
    drawer.dataset.empId = emp.id;
    $("#scrim").hidden = false;
    document.body.classList.add("locked");
    drawer.innerHTML =
      '<div class="drawer-head">' +
      '<div><div class="eyebrow">' + esc(emp.segment || "Employer") + (emp.city ? " · " + esc(emp.city) : "") + "</div>" +
      "<h2>" + esc(emp.name) + "</h2>" +
      '<div class="badge-row">' + stageBadge(emp.stage) + complianceBadge(emp) + "</div></div>" +
      '<button class="icon-btn" data-action="close-drawer" type="button" aria-label="Close">✕</button></div>' +
      '<div class="drawer-body">' +

      '<div class="drawer-kpis">' +
      drawerKpi("Staff", num(emp.staffEstimate) || "—") +
      drawerKpi("Employees paid", num(emp.metrics.employees)) +
      drawerKpi("Revenue / mo", naira(emp.metrics.revenue)) +
      drawerKpi("Compliance", missing.length ? missing.length + " missing" : "8 / 8") +
      "</div>" +

      '<section class="d-section next-section">' +
      '<div class="d-title">Next action</div>' +
      (emp.nextAction ?
        '<div class="next-card"><div><div class="next-title">' + esc(emp.nextAction.title) + '</div><div class="muted small">' + esc(emp.nextAction.detail) + " · " + esc(dueLabel(emp.nextAction.due)) + "</div></div>" +
        '<div class="next-btns"><button class="done-btn" data-action="complete" data-emp="' + esc(emp.id) + '" type="button">Done</button>' +
        '<button class="snooze-btn" data-action="snooze" data-emp="' + esc(emp.id) + '" type="button">+1d</button></div></div>' +
        '<div class="next-tools">' +
        (emp.nextAction.script ? '<button class="ghost-btn script-jump" data-action="copy" data-script="' + esc(emp.nextAction.script) + '" type="button">Copy the script</button>' : "") +
        outreachLink(emp, emp.nextAction) +
        "</div>" :
        '<div class="muted small">No next action. <button class="link-btn" data-action="restart" data-emp="' + esc(emp.id) + '" type="button">Restart the cadence</button></div>') +
      "</section>" +

      '<section class="d-section">' +
      '<div class="d-title">Stage</div>' +
      '<div class="stage-rail">' + stageOrder.map((s, i) => {
        const cur = stageOrder.indexOf(emp.stage);
        const cls = s === emp.stage ? "current" : i < cur ? "done" : "";
        return '<span class="stage-node ' + cls + '">' + esc(stage(s).short) + "</span>";
      }).join("") + "</div>" +
      '<p class="muted small">' + esc(target.hint) + "</p>" +
      (next ? '<button class="primary-btn wide" data-action="advance" data-emp="' + esc(emp.id) + '" ' + (gate.ok ? "" : "disabled") + ">Move to " + esc(stage(next).label) + "</button>" +
        (gate.ok ? "" : '<p class="gate-note">' + esc(gate.message) + "</p>") : '<p class="gate-note">This employer is at the final stage.</p>') +
      (emp.stage === "lost" ? '<button class="primary-btn wide" data-action="reopen" data-emp="' + esc(emp.id) + '" type="button">Reopen as lead</button>' : "") +
      (emp.stage === "demo" || emp.stage === "qualified" ?
        '<label class="check-line roomy"><input type="checkbox" data-field="qualification.demoDone" ' + (emp.qualification.demoDone ? "checked" : "") + '><span>Demo completed (unlocks compliance)</span></label>' : "") +
      "</section>" +

      '<section class="d-section">' +
      '<div class="d-title">Contact &amp; details</div>' +
      '<div class="form-grid">' +
      dField(emp, "name", "Employer name") +
      dField(emp, "contact", "Contact person") +
      dField(emp, "role", "Role") +
      dField(emp, "phone", "Phone / WhatsApp") +
      dField(emp, "email", "Email") +
      dField(emp, "city", "City / area") +
      dField(emp, "segment", "Segment") +
      dField(emp, "staffEstimate", "Staff estimate", "number") +
      "</div>" +
      '<label class="field"><span>Notes</span><textarea class="textarea small" rows="2" data-field="notes">' + esc(emp.notes || "") + "</textarea></label>" +
      "</section>" +

      '<section class="d-section">' +
      '<div class="d-title">Qualification <span class="score ' + (score >= 7 ? "good" : "bad") + '">' + score + "/10</span></div>" +
      '<div class="qual-grid">' +
      '<label class="mini-field"><span>Staff on payroll</span><input type="number" min="0" data-qual="staffCount" value="' + esc(emp.qualification.staffCount == null ? "" : emp.qualification.staffCount) + '" placeholder="e.g. 45"></label>' +
      '<label class="mini-field"><span>Monthly payroll (₦)</span><input type="number" min="0" data-qual="monthlyPayroll" value="' + esc(emp.qualification.monthlyPayroll == null ? "" : emp.qualification.monthlyPayroll) + '" placeholder="e.g. 4500000"></label>' +
      "</div>" +
      '<div class="bool-list">' + CI.QUALIFICATION.filter((q) => q.type === "bool").map((q) =>
        '<div class="bool-row"><div><strong>' + esc(q.label) + '</strong><span class="muted tiny">' + esc(q.hint) + "</span></div>" +
        '<div class="seg small"><button class="seg-btn ' + (emp.qualification[q.id] === true ? "active" : "") + '" data-qual="' + q.id + '" data-value="true" type="button">Yes</button>' +
        '<button class="seg-btn ' + (emp.qualification[q.id] === false ? "active danger" : "") + '" data-qual="' + q.id + '" data-value="false" type="button">No</button></div></div>').join("") +
      "</div>" +
      '<p class="gate-note ' + (isQualified(emp) ? "good" : "") + '">' + (isQualified(emp) ? "Qualified — the demo gate is open." : "Needs 7/10, all answers, 10+ staff, transfer payroll, CAC/TIN and a decision maker before Demo.") + "</p>" +
      "</section>" +

      '<section class="d-section">' +
      '<div class="d-title">Compliance <span class="score ' + (st === "passed" ? "good" : "bad") + '">' + (st === "passed" ? "Passed" : missing.length + " missing") + "</span></div>" +
      '<div class="compliance-list">' + CI.REQUIRED_CHECKS.map((c) =>
        '<label class="comp-item"><input type="checkbox" data-check="' + c.id + '" ' + (emp.compliance.checks[c.id] === true ? "checked" : "") + ">" +
        "<span><strong>" + esc(c.label) + "</strong><em>" + esc(c.detail) + "</em></span></label>").join("") +
      "</div>" +
      '<details class="optional-checks"><summary>Optional checks</summary>' + CI.OPTIONAL_CHECKS.map((c) =>
        '<label class="comp-item"><input type="checkbox" data-check="' + c.id + '" ' + (emp.compliance.checks[c.id] === true ? "checked" : "") + "><span><strong>" + esc(c.label) + "</strong><em>" + esc(c.detail) + "</em></span></label>").join("") + "</details>" +
      '<label class="field"><span>Failure reason (if any)</span><input data-field="compliance.failReason" value="' + esc(emp.compliance.failReason || "") + '" placeholder="e.g. TIN name mismatch"></label>' +
      (emp.compliance.fixable != null || st === "failed" ?
        '<div class="fixable-row"><span class="muted small">Triage</span><div class="seg"><button class="seg-btn ' + (emp.compliance.fixable === true ? "active" : "") + '" data-action="fixable" data-emp="' + esc(emp.id) + '" data-value="yes" type="button">Fixable</button>' +
        '<button class="seg-btn ' + (emp.compliance.fixable === false ? "active danger" : "") + '" data-action="fixable" data-emp="' + esc(emp.id) + '" data-value="no" type="button">Not a fit</button></div></div>' : "") +
      '<button class="ghost-btn" data-action="copy" data-script="wa_docs" type="button">Copy document request</button>' +
      "</section>" +

      '<section class="d-section">' +
      '<div class="d-title">Revenue &amp; activation</div>' +
      '<div class="form-grid">' +
      dField(emp, "metrics.employees", "Employees paid", "number") +
      dField(emp, "metrics.ewaActive", "Using salary access", "number") +
      dField(emp, "metrics.savingsFunded", "Funding savings", "number") +
      dField(emp, "metrics.revenue", "Monthly revenue (₦)", "number") +
      "</div>" +
      '<p class="muted tiny">Revenue per employee: ' + (emp.metrics.employees ? naira(Math.round(emp.metrics.revenue / emp.metrics.employees)) : "—") + "</p>" +
      "</section>" +

      '<section class="d-section">' +
      '<div class="d-title">Activity</div>' +
      '<form class="note-form" data-note="' + esc(emp.id) + '"><input name="note" placeholder="Add a note — what was said?" autocomplete="off"><button class="primary-btn" type="submit">Add</button></form>' +
      '<div class="activity">' + (emp.activity && emp.activity.length ? emp.activity.slice(0, 12).map((a) =>
        '<div class="activity-item"><span class="act-dot ' + esc(a.type) + '"></span><div><div>' + esc(a.text) + '</div><div class="muted tiny">' + esc(shortDate(a.date)) + "</div></div></div>").join("") :
        '<p class="muted small">No activity yet.</p>') + "</div>" +
      "</section>" +

      '<div class="drawer-foot"><button class="ghost-btn danger-text" data-action="delete" data-emp="' + esc(emp.id) + '" type="button">Delete employer</button>' +
      '<span class="muted tiny">Changes save automatically.</span></div>' +
      "</div>";
    drawer.scrollTop = keepScroll;
  }
  function drawerKpi(label, value) {
    return '<div><span>' + esc(label) + "</span><strong>" + esc(value) + "</strong></div>";
  }
  function dField(emp, path, label, type) {
    const value = path.split(".").reduce((o, k) => (o == null ? o : o[k]), emp);
    return '<label class="field"><span>' + esc(label) + '</span><input type="' + (type || "text") + '" data-field="' + path + '" value="' + esc(value == null ? "" : value) + '"></label>';
  }

  /* ------------------------------------------------------------------ render */
  const ROUTES = { today: viewToday, pipeline: viewPipeline, compliance: viewCompliance, playbook: viewPlaybook, numbers: viewNumbers };

  function currentRoute() {
    const h = (location.hash || "#/today").replace(/^#\/?/, "");
    return ROUTES[h] ? h : "today";
  }

  function render() {
    const route = currentRoute();
    if (ui.route !== route) {
      ui.route = route;
      window.scrollTo(0, 0);
    }
    const view = $("#view");
    view.innerHTML = ROUTES[route]();
    $$("#nav .nav-item").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
    $("#crumb").textContent = { today: "Today", pipeline: "Pipeline", compliance: "Compliance gate", playbook: "Playbook", numbers: "Numbers" }[route];
    $("#week-chip").textContent = "Week " + isoWeek(new Date());
    if (route === "numbers") modelUpdate();
    if (route === "pipeline") {
      const s = $("#pipe-search");
      if (s) s.addEventListener("input", filterBoard);
    }
    navCounts();
    renderDrawer();
    $("#sidebar").classList.remove("open");
    if (SYNC.enabled) updateSyncUI();
  }

  function navCounts() {
    const acts = allActions();
    const due = acts.filter((a) => diffDays(a.due, today()) <= 0).length;
    const active = state.employers.filter((e) => e.stage !== "lost").length;
    const failed = state.employers.filter((e) => complianceStatus(e) === "failed" && e.compliance.fixable == null).length;
    $("#nav-due").textContent = due || "";
    $("#nav-pipeline").textContent = active || "";
    $("#nav-compliance").textContent = failed || "";
    const n = currentNumbers();
    $("#sidebar-rev").textContent = naira(n.revenue);
    $("#sidebar-rev-meta").textContent = "per month · " + num(n.employees) + " employees";
  }

  function filterBoard(e) {
    const q = e.target.value.toLowerCase().trim();
    $$(".employer-card").forEach((c) => {
      c.style.display = !q || (c.dataset.search || "").includes(q) ? "" : "none";
    });
  }

  function modelUpdate() {
    const emp = Number(($("#m-emp") || {}).value || 0);
    const staff = Number(($("#m-staff") || {}).value || 0);
    const act = Number(($("#m-act") || {}).value || 0);
    const rev = Number(($("#m-rev") || {}).value || 0);
    if (!$("#m-out-mrr")) return;
    const paid = emp * staff;
    const active = Math.round(paid * (act / 100));
    const mrr = active * rev;
    $("#m-out-mrr").textContent = naira(mrr);
    $("#m-out-paid").textContent = num(paid);
    $("#m-out-active").textContent = num(active);
    $("#m-out-arr").textContent = naira(mrr * 12);
    const labels = { "m-emp": emp, "m-staff": staff, "m-act": act + "%", "m-rev": "₦" + num(rev) };
    Object.keys(labels).forEach((k) => {
      const el = document.getElementById(k + "-label");
      if (el) el.textContent = labels[k];
    });
  }

  /* ------------------------------------------------------------------ sheets */
  function openAdd(open) {
    ui.addOpen = open;
    $("#add-sheet").hidden = !open;
    $("#add-scrim").hidden = !open;
    document.body.classList.toggle("locked", open || !!ui.drawer);
    if (open) setTimeout(() => { const i = $("#add-form input[name=name]"); if (i) i.focus(); }, 50);
  }
  function openBulk(open) {
    ui.bulkOpen = open;
    $("#bulk-sheet").hidden = !open;
    $("#add-scrim").hidden = !open;
    document.body.classList.toggle("locked", open || !!ui.drawer);
  }
  function openSettings(open) {
    ui.settingsOpen = open;
    $("#settings-sheet").hidden = !open;
    $("#add-scrim").hidden = !open;
    document.body.classList.toggle("locked", open || !!ui.drawer);
    if (open) $("#rev-per-emp").value = state.revPerEmployee;
  }
  function closeSheets() {
    openAdd(false); openBulk(false); openSettings(false);
  }

  function addEmployer(data) {
    const id = "e_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const emp = {
      id: id,
      name: data.name,
      segment: data.segment || "Other",
      city: data.city || "",
      contact: data.contact || "",
      role: data.role || "",
      phone: data.phone || "",
      email: "",
      source: data.source || "",
      staffEstimate: Number(data.staff) || 0,
      stage: "lead",
      createdAt: today(),
      qualification: { staffCount: Number(data.staff) || null, monthlyPayroll: null, paidByTransfer: null, decisionMaker: null, registered: null, noDeductions: null, consentPossible: null, demoDone: false },
      compliance: { checks: CI.blankChecks(), notes: "", failReason: "", fixable: null },
      metrics: { employees: 0, ewaActive: 0, savingsFunded: 0, revenue: 0 },
      nextAction: data.startSequence ? CI.stepAction("school", 0, data) : null,
      activity: [{ date: today(), type: "note", text: "Added to pipeline" + (data.source ? " · " + data.source : "") }],
      notes: ""
    };
    state.employers.push(emp);
    save();
    render();
    toast(data.startSequence ? "Added. First WhatsApp is in Today." : "Added to pipeline.");
  }

  function parseRows(text) {
    return text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      return { name: parts[0], contact: parts[1] || "", phone: parts[2] || "", staff: parts[3] || "", city: parts[4] || "", segment: "School" };
    }).filter((r) => r.name);
  }

  /* ------------------------------------------------------------------ toast */
  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
  }

  function copyText(text) {
    const done = () => toast("Copied to clipboard.");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("Select the text and copy manually."); }
    ta.remove();
  }

  /* ------------------------------------------------------------------ events */
  document.addEventListener("click", function (e) {
    const qualBtn = e.target.closest("[data-qual][data-value]");
    if (qualBtn) {
      const qEmp = state.employers.find((x) => x.id === ui.drawer);
      if (qEmp) {
        qEmp.qualification[qualBtn.dataset.qual] = qualBtn.dataset.value === "true";
        save();
        render();
      }
      return;
    }
    const t = e.target.closest("[data-action]");
    if (!t) {
      if (e.target.classList && e.target.classList.contains("scrim")) { closeDrawer(); closeSheets(); }
      return;
    }
    const act = t.dataset.action;
    const empId = t.dataset.emp;
    const emp = empId ? state.employers.find((x) => x.id === empId) : null;

    if (act === "goto") { location.hash = "#/" + t.dataset.route; return; }
    if (act === "open-add") { openAdd(true); return; }
    if (act === "open-bulk") { openBulk(true); return; }
    if (act === "close-drawer") { closeDrawer(); return; }
    if (act === "open") { ui.drawer = empId; renderDrawer(); return; }
    if (act === "open-task") {
      const task = state.tasks.find((x) => x.id === t.dataset.task);
      if (task && task.route) location.hash = "#/" + task.route;
      if (task && task.anchor) setTimeout(() => { const el = document.getElementById(task.anchor); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 80);
      return;
    }
    if (act === "complete" && emp) { completeEmployerAction(emp); return; }
    if (act === "snooze" && emp) { snoozeAction(emp); return; }
    if (act === "restart" && emp) { restartCadence(emp); return; }
    if (act === "advance" && emp) { advance(emp); return; }
    if (act === "reopen" && emp) {
      emp.stage = "lead";
      if (!emp.nextAction) emp.nextAction = CI.stepAction("school", 0, emp);
      pushActivity(emp, "stage", "Reopened");
      save(); render(); toast("Reopened as a lead.");
      return;
    }
    if (act === "delete" && emp) {
      if (confirm("Delete " + emp.name + "? This cannot be undone.")) {
        state.employers = state.employers.filter((x) => x.id !== emp.id);
        ui.drawer = null; save(); render(); toast("Employer deleted.");
      }
      return;
    }
    if (act === "fixable" && emp) {
      const v = t.dataset.value;
      emp.compliance.fixable = v === "yes" ? true : v === "no" ? false : null;
      if (v === "no") {
        emp.stage = "lost";
        emp.nextAction = null;
        pushActivity(emp, "stage", "Marked not a fit · " + (emp.compliance.failReason || "compliance"));
        toast("Parked as not a fit. It moves to Lost.");
      } else {
        emp.nextAction = CI.stepAction("recovery", 1, emp);
        pushActivity(emp, "note", "Marked fixable — fix list is the next step");
        toast("Fixable. Send the fix list today.");
      }
      save(); render(); return;
    }
    if (act === "copy") {
      const s = CI.SCRIPTS[t.dataset.script];
      if (s) copyText(s.subject ? "Subject: " + s.subject + "\n\n" + s.body : s.body);
      return;
    }
    if (act === "copy-text") { copyText(t.dataset.text); return; }
    if (act === "tab") { ui.tab = t.dataset.tab; render(); return; }
    if (act === "log") {
      const m = t.dataset.metric;
      const d = t.dataset.delta;
      const l = logToday();
      l[m] = Math.max(0, (Number(l[m]) || 0) + Number(d));
      save();
      render();
      return;
    }
    if (act === "checklist") {
      const k = t.dataset.key;
      state.checklist[k] = t.checked;
      save();
      render();
      return;
    }
    if (act === "complete-task") {
      const task = state.tasks.find((x) => x.id === t.dataset.task);
      if (task) { task.done = true; save(); render(); toast("Task done."); }
      return;
    }
    if (act === "snooze-task") {
      const task = state.tasks.find((x) => x.id === t.dataset.task);
      if (task) { task.due = addDays(today(), 1); save(); render(); toast("Snoozed to tomorrow."); }
      return;
    }
    if (act === "quick-add") { openAdd(true); return; }
  });

  document.addEventListener("change", function (e) {
    const el = e.target;
    if (el.matches("[data-field]")) {
      const emp = state.employers.find((x) => x.id === ui.drawer);
      if (!emp) return;
      const path = el.dataset.field.split(".");
      let obj = emp;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      let val = el.type === "number" ? (el.value === "" ? 0 : Number(el.value)) : el.value;
      if (el.type === "checkbox") val = el.checked;
      obj[path[path.length - 1]] = val;
      save();
      render();
      return;
    }
    if (el.matches("[data-check]")) {
      const emp = state.employers.find((x) => x.id === ui.drawer);
      if (!emp) return;
      emp.compliance.checks[el.dataset.check] = el.checked;
      if (compliancePassed(emp)) emp.compliance.failReason = "";
      save();
      render();
      return;
    }
    if (el.matches("[data-qual]")) {
      const emp = state.employers.find((x) => x.id === ui.drawer);
      if (!emp) return;
      const q = el.dataset.qual;
      const v = el.dataset.value;
      emp.qualification[q] = q === "staffCount" || q === "monthlyPayroll" ? (el.value === "" ? null : Number(el.value)) : v === "true";
      if (q === "staffCount" && !emp.staffEstimate) emp.staffEstimate = Number(el.value) || 0;
      save();
      render();
      return;
    }
    if (el.id === "rev-per-emp") {
      state.revPerEmployee = Number(el.value) || 300;
      save();
      return;
    }
  });

  document.addEventListener("input", function (e) {
    if (e.target.matches("[data-model]")) {
      if (e.target.id === "m-rev") state.revPerActive = Number(e.target.value) || 900;
      modelUpdate();
    }
    if (e.target.id === "rev-per-emp") {
      state.revPerEmployee = Number(e.target.value) || 300;
      save();
    }
  });

  document.addEventListener("submit", function (e) {
    if (e.target.id === "add-form") {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      if (!String(data.name || "").trim()) return;
      data.startSequence = fd.get("startSequence") === "on";
      addEmployer(data);
      e.target.reset();
      openAdd(false);
      location.hash = "#/pipeline";
      return;
    }
    if (e.target.id === "bulk-form") {
      e.preventDefault();
      const rows = parseRows(new FormData(e.target).get("rows") || "");
      if (!rows.length) { toast("Add at least one name."); return; }
      rows.forEach((r) => addEmployer(Object.assign({}, r, { startSequence: true, segment: r.segment })));
      e.target.reset();
      openBulk(false);
      location.hash = "#/pipeline";
      toast(rows.length + " employers added. First WhatsApps are in Today.");
      return;
    }
    if (e.target.matches("[data-note]")) {
      e.preventDefault();
      const emp = state.employers.find((x) => x.id === e.target.dataset.note);
      const input = e.target.querySelector("input[name=note]");
      if (!emp || !input.value.trim()) return;
      pushActivity(emp, "note", input.value.trim());
      save();
      input.value = "";
      renderDrawer();
      return;
    }
  });

  function closeDrawer() {
    ui.drawer = null;
    renderDrawer();
  }


  /* ------------------------------------------------------------------ shared workspace */
  function timeAgo(iso) {
    if (!iso) return "just now";
    const t = new Date(iso).getTime();
    if (!t) return "just now";
    const sec = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return sec + "s ago";
    if (sec < 3600) return Math.round(sec / 60) + "m ago";
    if (sec < 86400) return Math.round(sec / 3600) + "h ago";
    return Math.round(sec / 86400) + "d ago";
  }

  function syncSummary() {
    if (SYNC.status === "shared") {
      return "Shared workspace · last saved " + (SYNC.lastBy ? "by " + SYNC.lastBy + " " : "") + timeAgo(SYNC.lastAt);
    }
    if (SYNC.status === "saving") return "Saving to the shared workspace…";
    if (SYNC.status === "offline") return "Offline — changes are saved on this device and will sync when you reconnect.";
    if (SYNC.status === "conflict") return "A teammate saved newer changes. Choose which version to keep.";
    if (SYNC.status === "connecting") return "Connecting to the shared workspace…";
    return "Local only — changes stay in this browser.";
  }

  function setSyncStatus(status) {
    SYNC.status = status;
    updateSyncUI();
  }

  function updateSyncUI() {
    const pill = $("#sync-pill");
    if (!pill) return;
    const labels = { connecting: "Connecting", shared: "Shared", saving: "Saving", offline: "Offline", conflict: "Conflict", local: "Local" };
    pill.className = "sync-pill " + (labels[SYNC.status] ? SYNC.status : "local");
    const text = $(".sync-text", pill);
    if (text) text.textContent = labels[SYNC.status] || "Local";
    pill.title = syncSummary();
  }

  function buildSyncUI() {
    const topbar = $(".topbar");
    if (!topbar) return;
    const banner = document.createElement("div");
    banner.id = "sync-banner";
    banner.className = "sync-banner";
    banner.hidden = true;
    topbar.parentNode.insertBefore(banner, topbar.nextSibling);
    banner.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-sync]");
      if (!btn) return;
      if (btn.dataset.sync === "theirs") {
        if (SYNC.conflict) applyRemote(SYNC.conflict);
        SYNC.conflict = null;
        hideConflict();
        setSyncStatus("shared");
        toast("Loaded the shared version.");
      } else {
        SYNC.conflict = null;
        hideConflict();
        setSyncStatus("saving");
        syncPush(true);
        toast("Replacing the shared version with yours.");
      }
    });
    const right = $(".topbar-right");
    if (right) {
      const pill = document.createElement("button");
      pill.id = "sync-pill";
      pill.className = "sync-pill local";
      pill.type = "button";
      pill.innerHTML = '<span class="sync-dot"></span><span class="sync-text">Local</span>';
      right.insertBefore(pill, right.firstChild);
      pill.addEventListener("click", function () {
        if (SYNC.status === "local" || !SYNC.code) showSyncGate("");
        else toast(syncSummary());
      });
    }
    const gate = document.createElement("div");
    gate.id = "sync-gate";
    gate.className = "sync-gate";
    gate.hidden = true;
    gate.innerHTML =
      '<div class="sync-gate-card">' +
      '<div class="sync-brand"><span class="brand-mark">C</span><div><strong>ChequeIn</strong><em>Sales OS</em></div></div>' +
      '<div class="eyebrow">Shared workspace</div>' +
      "<h2>Enter the team code</h2>" +
      '<p>This workspace is shared with the ChequeIn sales team. The code keeps the pipeline private — ask your manager for it.</p>' +
      '<form id="sync-form">' +
      '<label class="field"><span>Team code</span><input name="code" autocomplete="off" required placeholder="Team code"></label>' +
      '<label class="field"><span>Your name <em class="muted">(optional)</em></span><input name="name" autocomplete="off" placeholder="e.g. Tunde"></label>' +
      '<p class="sync-error" id="sync-error" hidden></p>' +
      '<button class="primary-btn wide" type="submit">Open shared workspace</button>' +
      "</form>" +
      '<button class="link-btn sync-offline" type="button">Use this device only</button>' +
      "</div>";
    document.body.appendChild(gate);
    const form = $("#sync-form", gate);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const code = String(form.code.value || "").trim();
      const name = String(form.name.value || "").trim();
      if (!code) return;
      SYNC.code = code;
      SYNC.editor = name;
      try {
        localStorage.setItem("chequein-team-code", code);
        localStorage.setItem("chequein-editor", name);
        localStorage.removeItem("chequein-sync-off");
      } catch (err) { /* ignore */ }
      gate.hidden = true;
      document.body.classList.remove("locked");
      syncConnect();
    });
    $(".sync-offline", gate).addEventListener("click", function () {
      try { localStorage.setItem("chequein-sync-off", "1"); } catch (err) { /* ignore */ }
      SYNC.code = "";
      SYNC.ready = false;
      gate.hidden = true;
      document.body.classList.remove("locked");
      setSyncStatus("local");
      toast("Using this device only. Your changes stay in this browser.");
    });
    updateSyncUI();
  }

  function showSyncGate(message) {
    const gate = $("#sync-gate");
    if (!gate) return;
    gate.hidden = false;
    document.body.classList.add("locked");
    const err = $("#sync-error", gate);
    if (err) {
      err.textContent = message || "";
      err.hidden = !message;
    }
    const input = $('#sync-form input[name="code"]', gate);
    if (input) {
      input.value = SYNC.code || "";
      setTimeout(function () { input.focus(); }, 40);
    }
  }

  function invalidCode(message) {
    SYNC.code = "";
    SYNC.ready = false;
    try { localStorage.removeItem("chequein-team-code"); } catch (err) { /* ignore */ }
    setSyncStatus("local");
    showSyncGate(message);
  }

  function syncInit() {
    if (!SYNC.enabled) return;
    buildSyncUI();
    let off = false;
    try { off = localStorage.getItem("chequein-sync-off") === "1"; } catch (err) { /* ignore */ }
    if (off) { setSyncStatus("local"); return; }
    if (!SYNC.code) { showSyncGate(""); return; }
    syncConnect();
  }

  function syncConnect() {
    setSyncStatus("connecting");
    fetch("/api/state", { headers: { "x-team-code": SYNC.code }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) {
          invalidCode("That code wasn't recognised. Check it with your manager.");
          return null;
        }
        if (r.status === 404) {
          const type = r.headers.get("content-type") || "";
          if (type.indexOf("application/json") === -1) {
            setSyncStatus("offline");
            toast("Shared sync is not available on this host. Changes stay on this device.");
            return null;
          }
          SYNC.ready = true;
          setSyncStatus("shared");
          startPolling();
          syncPush(true);
          return null;
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        SYNC.ready = true;
        applyRemote(data);
        setSyncStatus("shared");
        startPolling();
      })
      .catch(function () {
        SYNC.ready = true;
        setSyncStatus("offline");
        startPolling();
      });
  }

  function applyRemote(data) {
    if (!data || !data.state || !Array.isArray(data.state.employers)) return false;
    SYNC.applying = true;
    state = loadFrom(data.state);
    SYNC.version = Number(data.version) || 0;
    SYNC.lastAt = data.updatedAt || null;
    SYNC.lastBy = data.updatedBy || "";
    SYNC.dirty = false;
    SYNC.applying = false;
    persistLocal();
    render();
    updateSyncUI();
    return true;
  }

  function syncQueue() {
    if (!SYNC.enabled || !SYNC.ready || SYNC.status === "conflict") return;
    clearTimeout(SYNC.timer);
    if (SYNC.status !== "offline") setSyncStatus("saving");
    SYNC.timer = setTimeout(function () { syncPush(false); }, 700);
  }

  function syncPush(force) {
    if (!SYNC.enabled || !SYNC.ready) return;
    if (SYNC.pushing) { SYNC.queued = true; return; }
    if (SYNC.status === "conflict" && !force) return;
    SYNC.pushing = true;
    SYNC.queued = false;
    if (!force) setSyncStatus("saving");
    fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json", "x-team-code": SYNC.code },
      body: JSON.stringify({ state: state, baseVersion: SYNC.version, editor: SYNC.editor, force: !!force })
    })
      .then(function (r) {
        if (r.status === 401) {
          invalidCode("Your session expired. Enter the team code again.");
          return null;
        }
        if (r.status === 409) {
          return r.json().then(function (data) {
            if (SYNC.version === 0 && !SYNC.dirty) {
              applyRemote(data);
              setSyncStatus("shared");
              return null;
            }
            SYNC.conflict = data;
            setSyncStatus("conflict");
            showConflict(data);
            return null;
          });
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || data.error) return;
        const pending = SYNC.queued;
        SYNC.version = Number(data.version) || SYNC.version + 1;
        SYNC.lastAt = data.updatedAt || new Date().toISOString();
        SYNC.lastBy = data.updatedBy || SYNC.editor || "";
        if (!pending) SYNC.dirty = false;
        SYNC.failures = 0;
        hideConflict();
        setSyncStatus("shared");
      })
      .catch(function () {
        SYNC.failures += 1;
        setSyncStatus("offline");
        if (SYNC.dirty) {
          setTimeout(function () { syncPush(false); }, Math.min(15000, 3000 * SYNC.failures));
        }
      })
      .finally(function () {
        SYNC.pushing = false;
        if (SYNC.queued && SYNC.dirty && SYNC.status !== "conflict") {
          setTimeout(function () { syncPush(false); }, 50);
        }
      });
  }

  function showConflict(data) {
    const banner = $("#sync-banner");
    if (!banner) return;
    const who = data && data.updatedBy ? esc(data.updatedBy) : "A teammate";
    const when = data && data.updatedAt ? timeAgo(data.updatedAt) : "just now";
    banner.innerHTML =
      '<div class="sync-banner-inner"><div><strong>' + who + " saved a newer version</strong>" +
      "<span>Last saved " + esc(when) + '. “Keep mine” replaces their version; “Load theirs” discards yours.</span></div>' +
      '<div class="sync-actions"><button class="ghost-btn" data-sync="theirs" type="button">Load theirs</button>' +
      '<button class="primary-btn" data-sync="mine" type="button">Keep mine</button></div></div>';
    banner.hidden = false;
  }

  function hideConflict() {
    const banner = $("#sync-banner");
    if (banner) {
      banner.hidden = true;
      banner.innerHTML = "";
    }
  }

  function startPolling() {
    if (!SYNC.pollStarted) {
      SYNC.pollStarted = true;
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) pollRemote();
      });
      window.addEventListener("online", function () {
        pollRemote();
        if (SYNC.dirty) syncPush(false);
      });
    }
    if (SYNC.pollTimer) clearInterval(SYNC.pollTimer);
    SYNC.pollTimer = setInterval(pollRemote, 12000);
  }

  function pollRemote() {
    if (!SYNC.enabled || !SYNC.ready || SYNC.pushing || document.hidden) return;
    if (SYNC.status === "saving" || SYNC.status === "conflict") return;
    fetch("/api/state", { headers: { "x-team-code": SYNC.code }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) {
          invalidCode("Your session expired. Enter the team code again.");
          return null;
        }
        if (!r.ok) return null;
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        if (Number(data.version) > SYNC.version) {
          if (SYNC.dirty) {
            SYNC.conflict = data;
            setSyncStatus("conflict");
            showConflict(data);
          } else {
            applyRemote(data);
            setSyncStatus("shared");
          }
        } else if (SYNC.status === "offline" && !SYNC.dirty) {
          setSyncStatus("shared");
        }
      })
      .catch(function () {
        if (SYNC.status === "shared") setSyncStatus("offline");
      });
  }

  window.addEventListener("hashchange", render);

  /* ------------------------------------------------------------------ boot */
  function boot() {
    $$("#nav [data-icon]").forEach((s) => { s.innerHTML = icon(s.dataset.icon); });
    $("#btn-quick-add").addEventListener("click", () => openAdd(true));
    $("#btn-settings-sheet").addEventListener("click", () => openSettings(true));
    $("#btn-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#scrim").addEventListener("click", closeDrawer);
    $("#add-scrim").addEventListener("click", () => { closeSheets(); });
    $$("[data-close]").forEach((b) => b.addEventListener("click", (ev) => {
      ev.preventDefault();
      closeSheets();
    }));
    $("#btn-export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "chequein-sales-os-" + today() + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Backup downloaded.");
    });
    $("#file-import").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data.employers) throw new Error("bad file");
          state = loadFrom(data);
          save(); render(); openSettings(false); toast("Backup imported.");
        } catch (err) { toast("That file doesn't look like a backup."); }
      };
      reader.readAsText(f);
    });
    $("#btn-reset").addEventListener("click", () => {
      if (!confirm("Reset everything to the seeded baseline? Your current pipeline will be replaced.")) return;
      state = CI.seed();
      save(); render(); openSettings(false); toast("Reset to baseline.");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeDrawer(); closeSheets(); }
    });
    const tab = new URLSearchParams(location.search).get("tab");
    if (tab && ["pitch", "qualify", "outreach", "activate", "objections", "recovery"].includes(tab)) ui.tab = tab;
    render();
    syncInit();
  }

  function loadFrom(data) {
    const s = data;
    s.tasks = s.tasks || [];
    s.log = s.log || {};
    s.checklist = s.checklist || {};
    s.revPerActive = s.revPerActive || 900;
    s.employers.forEach((e) => {
      e.activity = e.activity || [];
      e.metrics = e.metrics || { employees: 0, ewaActive: 0, savingsFunded: 0, revenue: 0 };
      e.compliance = e.compliance || {};
      e.compliance.checks = e.compliance.checks || CI.blankChecks();
      e.qualification = e.qualification || {};
    });
    return s;
  }

  boot();
})();
