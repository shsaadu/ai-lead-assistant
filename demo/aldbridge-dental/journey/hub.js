/**
 * Aldbridge Practice Hub: the clinic's back office (Aldbridge Dental journey demo).
 * A simulated patient-management screen built on the shared automation engine: today's overview,
 * enquiries pipeline, diary, invoices, weekly report and an activity log, in dental language.
 * Invoices are reminders only: the practice records when a payment has arrived, and nothing here
 * ever takes money. Everything is simulated, with made-up people.
 */
(function (global) {
  'use strict';

  var TREATMENTS = [
    ['Check-up', 75], ['Hygiene visit', 70], ['Emergency appointment (private)', 95],
    ['Filling', 120], ['Teeth whitening', 295], ['Implant, first stage', 2400]
  ];
  var TABS = [['today', 'Today'], ['enquiries', 'Enquiries'], ['diary', 'Diary'], ['invoices', 'Invoices'], ['report', 'Weekly report'], ['activity', 'Activity']];
  var SYSTEM = { up: ['online', 'ok'], error: ['having errors', 'warn'], down: ['unreachable', 'bad'], slow: ['slow to respond', 'warn'], gone: ['disconnected', 'bad'] };

  function esc(v) { var d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; }

  function mount(root, E) {
    var F = E.fmt, H = E.helpers, tab = 'today', painted = {}, state;
    root.innerHTML =
      '<div class="hub">' +
      '<header class="hub-bar"><div class="hub-brand"><span class="hub-mark" aria-hidden="true">A</span><div><b>Aldbridge Practice Hub</b><small>Reception view · simulated</small></div></div>' +
      '<div class="hub-meta"><span class="hub-sys" id="hub-sys"></span><span class="hub-clock" id="hub-clock"></span></div></header>' +
      '<nav class="hub-tabs" id="hub-tabs" role="tablist"></nav>' +
      '<div class="hub-body" id="hub-body"></div></div>';
    var $ = function (id) { return root.querySelector('#' + id); };
    function paint(id, html) { var el = $(id); if (painted[id] !== html) { painted[id] = html; el.innerHTML = html; } }
    var money = F.money;

    /* ---------- helpers ---------- */
    function leadFor(id) { return state.saved.filter(function (l) { return l.id === id; })[0]; }
    function contactFor(id) { return state.contacts.filter(function (c) { return c.leadId === id; })[0]; }
    function waiting() { return state.saved.filter(function (l) { return !l.contacted; }); }
    function owing() { return state.invoices.filter(function (i) { return H.isOverdue(i); }); }
    function stuck() { return state.runs.filter(function (r) { return r.kind === 'webhook' && (r.status === 'failed' || r.status === 'dead'); }); }
    function openBookings() { return state.bookings.filter(function (b) { return b.status === 'booked'; }); }
    function langChip(l) { return '<span class="hchip lang">' + esc(E.LANG[l.lang].name) + '</span>'; }
    function tags(c) {
      var l = leadFor(c.leadId), out = '';
      if (c.hot) out += '<span class="hchip hot">Wants to book</span>';
      if (c.person) out += '<span class="hchip person">Needs a person</span>';
      if (c.merged) out += '<span class="hchip merge">asked again ×' + c.merged + '</span>';
      var owed = state.invoices.filter(function (i) { return i.leadId === c.leadId && H.isOverdue(i); }).reduce(function (t, i) { return t + i.amount - i.paid; }, 0);
      if (owed) out += '<span class="hchip owes">Owes ' + money(owed) + '</span>';
      return out + (l ? langChip(l) : '');
    }

    /* ---------- tabs ---------- */
    function today() {
      var nw = waiting().length, od = owing(), ob = openBookings(), st = stuck();
      var dayStart = Math.floor(state.now / 1440) * 1440;
      var todays = ob.filter(function (b) { return b.at >= dayStart && b.at < dayStart + 1440; });
      var kpi = function (n, l, cls) { return '<div class="kpi ' + (cls || '') + '"><b>' + n + '</b><span>' + l + '</span></div>'; };
      var needs = [];
      waiting().forEach(function (l) { needs.push(['bad', l.name + ' is waiting for a reply (enquiry sent ' + F.fmtTime(l.at) + ')']); });
      od.forEach(function (i) { needs.push(['bad', i.lead.name + ' owes ' + money(i.amount - i.paid) + ' (' + i.number + ', due ' + F.fmtDue(i.dueAt) + ')' + (i.atRisk ? ': please phone them' : '')]); });
      state.bookings.filter(function (b) { return b.status === 'noshow'; }).forEach(function (b) { needs.push(['warn', b.lead.name + ' missed ' + F.fmtSlot(b.at) + '. A message offering a new time has gone out']); });
      st.forEach(function (r) { needs.push([r.status === 'dead' ? 'bad' : 'warn', r.lead.name + ' is not in the patient system yet' + (r.status === 'dead' ? ' (automatic retries stopped: ask support)' : ' (retrying automatically)')]); });
      var list = needs.length ? needs.map(function (n) { return '<li class="' + n[0] + '">' + esc(n[1]) + '</li>'; }).join('') : '<li class="ok">Nothing needs attention right now.</li>';
      var diary = todays.length ? todays.sort(function (a, b) { return a.at - b.at; }).map(function (b) { return '<li><b>' + esc(F.fmtSlot(b.at).split(' at ')[1]) + '</b> ' + esc(b.lead.name) + '</li>'; }).join('') : '<li class="muted">No appointments today.</li>';
      return '<div class="kpis">' + kpi(state.saved.length, 'Enquiries so far') + kpi(nw, 'Waiting for a reply', nw ? 'bad' : '') + kpi(ob.length, 'Appointments booked') + kpi(money(od.reduce(function (t, i) { return t + i.amount - i.paid; }, 0)), 'Overdue invoices', od.length ? 'bad' : '') + '</div>' +
        '<div class="cols"><section><h3>Needs attention</h3><ul class="needs">' + list + '</ul></section><section><h3>Today in the diary</h3><ul class="plain">' + diary + '</ul></section></div>';
    }

    function enquiries() {
      var cols = [['new', 'New enquiry'], ['contacted', 'Contacted'], ['booked', 'Booked']];
      if (!state.contacts.length) return '<p class="empty">No enquiries yet. When someone asks Ava a question and leaves their details, they appear here.</p>';
      return '<div class="board">' + cols.map(function (col) {
        var list = state.contacts.filter(function (c) { return c.stage === col[0]; });
        return '<div class="lane"><h3>' + col[1] + ' <span class="count">' + list.length + '</span></h3>' + list.map(function (c) {
          var l = leadFor(c.leadId);
          return '<article class="pcard"><header><b>' + esc(c.name) + '</b></header><div class="hchips">' + tags(c) + '</div><p class="em">' + esc(c.email) + '</p><p class="pnote">' + esc(c.notes[0]) + '</p>' +
            '<footer>' + (l && !l.contacted ? '<button class="mini" data-act="contacted" data-id="' + c.leadId + '" type="button">We contacted them</button>' : '') + (c.stage !== 'booked' ? '<button class="mini" data-act="mark-booked" data-id="' + c.id + '" type="button">Mark as booked</button>' : '') + '</footer></article>';
        }).join('') + '</div>';
      }).join('') + '</div>';
    }

    function diary() {
      var all = state.bookings.slice().sort(function (a, b) { return a.at - b.at; });
      if (!all.length) return '<p class="empty">The diary is empty. When a patient picks a time from their message, it appears here.</p>';
      var slotOpts = Object.keys(E.SLOTS).map(function (k) { return '<option value="' + k + '">' + esc(E.SLOTS[k].label) + '</option>'; }).join('');
      var order = ['confirm', 'rem24', 'rem1', 'noshow'], names = { confirm: 'Confirmed', rem24: '24h reminder', rem1: '1h reminder', noshow: 'No-show check' };
      return '<div class="row-tools"><label>Move an appointment to <select id="hub-slot">' + slotOpts + '</select></label></div><ul class="diary">' + all.map(function (b) {
        var chips = order.map(function (k) {
          var r = state.runs.filter(function (x) { return x.bookingId === b.id && x.kind === k; })[0];
          if (!r) return '<span class="step skip">' + names[k] + ': not needed</span>';
          return '<span class="step ' + (r.status === 'succeeded' ? 'done' : r.status === 'cancelled' ? 'skip' : 'wait') + '">' + names[k] + ': ' + (r.status === 'succeeded' ? '✓' : r.status === 'cancelled' ? 'cancelled' : F.fmtIn(r.nextAt - state.now)) + '</span>';
        }).join('');
        var started = state.now >= b.at;
        return '<li class="appt ' + b.status + '"><div class="appt-top"><b>' + esc(F.fmtSlot(b.at)) + '</b><span>' + esc(b.lead.name) + '</span><span class="pill ' + b.status + '">' + (b.status === 'noshow' ? 'did not attend' : b.status) + '</span></div><div class="steps">' + chips + '</div>' +
          (b.status === 'booked' ? '<div class="acts">' + (started ? '<button class="mini" data-act="attended" data-id="' + b.id + '" type="button">Attended</button>' : '<button class="mini" disabled title="Available once the appointment starts" type="button">Attended (after it starts)</button>') + '<button class="mini" data-act="move" data-id="' + b.id + '" type="button">Move</button><button class="mini" data-act="cancel-appt" data-id="' + b.id + '" type="button">Cancel</button></div>' : '') + '</li>';
      }).join('') + '</ul>';
    }

    function invoices() {
      var tot = function (f) { return state.invoices.reduce(function (t, i) { return t + f(i); }, 0); };
      var pats = state.saved.map(function (l) { return '<option value="' + l.id + '"' + (state.ui.invLead === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('');
      var treat = TREATMENTS.map(function (t, i) { return '<option value="' + i + '">' + esc(t[0]) + ' (' + money(t[1]) + ')</option>'; }).join('');
      var form = state.saved.length ?
        '<div class="inv-form"><label>Patient<select id="hub-inv-lead">' + pats + '</select></label><label>Treatment<select id="hub-inv-treat">' + treat + '</select></label><label>Payment due in<select id="hub-inv-days"><option value="7">7 days</option><option value="14" selected>14 days</option><option value="30">30 days</option></select></label><button class="hbtn" data-act="new-invoice" type="button">Treatment done: send invoice</button></div>'
        : '<p class="empty">No patients yet.</p>';
      var kinds = ['inv_send', 'inv_pre', 'inv_due', 'inv_od7', 'inv_od14'], names = { inv_send: 'Sent', inv_pre: '3-day heads-up', inv_due: 'Due date', inv_od7: '7 days late', inv_od14: 'Final notice' };
      var rows = state.invoices.length ? state.invoices.map(function (i) {
        var left = i.amount - i.paid, late = H.isOverdue(i), st = i.status === 'paid' ? 'paid' : i.status === 'void' ? 'void' : late ? 'overdue' : 'sent';
        var chips = kinds.map(function (k) {
          var r = state.runs.filter(function (x) { return x.invoiceId === i.id && x.kind === k; })[0];
          if (!r) return '<span class="step skip">' + names[k] + ': not needed</span>';
          return '<span class="step ' + (r.status === 'succeeded' ? 'done' : r.status === 'cancelled' ? 'skip' : 'wait') + '">' + names[k] + ': ' + (r.status === 'succeeded' ? '✓' : r.status === 'cancelled' ? 'cancelled' : F.fmtIn(r.nextAt - state.now)) + '</span>';
        }).join('');
        return '<li class="inv ' + st + '"><div class="appt-top"><b>' + esc(i.number) + '</b><span>' + esc(i.lead.name) + ' · ' + esc(i.desc) + '</span><span class="amt">' + (i.paid && i.status === 'sent' ? money(left) + ' left of ' + money(i.amount) : money(i.amount)) + '</span><span class="pill ' + st + '">' + st + '</span></div>' +
          '<div class="steps">' + chips + '</div>' +
          (i.status === 'sent' ? '<div class="acts"><button class="mini" data-act="paid" data-id="' + i.id + '" type="button">Payment received</button><button class="mini" data-act="part" data-id="' + i.id + '" type="button">Part payment received (half)</button><button class="mini" data-act="extend" data-id="' + i.id + '" type="button">Give 7 more days</button><button class="mini" data-act="void" data-id="' + i.id + '" type="button">Cancel invoice</button></div>' : '') + '</li>';
      }).join('') : '<li class="empty">No invoices yet.</li>';
      return '<p class="note-box"><b>The practice is paid directly.</b> Assist Street sends the invoice and the reminders; it never takes a payment. You record when money has arrived in your own bank or card system.</p>' + form +
        '<div class="kpis three"><div class="kpi"><b>' + money(tot(function (i) { return i.status === 'sent' ? i.amount - i.paid : 0; })) + '</b><span>Outstanding</span></div><div class="kpi bad"><b>' + money(tot(function (i) { return H.isOverdue(i) ? i.amount - i.paid : 0; })) + '</b><span>Overdue</span></div><div class="kpi good"><b>' + money(tot(function (i) { return i.paid; })) + '</b><span>Received</span></div></div><ul class="diary">' + rows + '</ul>';
    }

    function report() {
      var r = state.preview || state.reports[0];
      var buttons = '<div class="row-tools"><button class="mini" data-act="preview" type="button">Preview this week</button><button class="mini" data-act="send-report" type="button">Email it to me now</button></div>';
      if (!r) return buttons + '<p class="empty">No weekly report yet. It is emailed to the practice every Monday at 08:00. Use the demo controls to skip ahead, or preview this week.</p>';
      var max = Math.max.apply(null, r.byDay.concat([1])), delta = r.prev == null ? '' : (r.enquiries - r.prev >= 0 ? '+' : '') + (r.enquiries - r.prev) + ' on last week';
      var kpi = function (v, l, s) { return '<div class="kpi"><b>' + esc(v) + '</b><span>' + esc(l) + '</span>' + (s ? '<em>' + esc(s) + '</em>' : '') + '</div>'; };
      var bars = r.byDay.map(function (n, i) { return '<div class="bar"><b>' + n + '</b><i style="height:' + Math.round(n / max * 100) + '%"></i><span>' + F.dayName(r.from + i * 1440) + '</span></div>'; }).join('');
      var notes = E.highlights(r).map(function (h) { return '<li class="' + h[0] + '">' + esc(h[1]) + '</li>'; }).join('');
      return buttons + '<div class="report' + (state.preview ? ' preview' : '') + '"><header><b>' + (state.preview ? 'Preview (not sent): your week so far' : 'Your week at Aldbridge Dental') + '</b></header><div class="kpis">' + kpi(r.enquiries, 'Enquiries', delta) + kpi(r.withinHour + ' of ' + r.enquiries, 'Contacted within 1 hour', r.median != null ? 'typical: ' + F.fmtDur(r.median) : '') + kpi(r.booked, 'Booked', '') + kpi(r.hot, 'Wanted to book', r.person ? r.person + ' needed a person' : '') + '</div><div class="bars">' + bars + '</div><ul class="needs">' + notes + '</ul></div>';
    }

    var KIND = {
      ack: function (r, e) { return ['ok', 'Ava acknowledged ' + r.lead.name + ' in ' + E.LANG[r.lead.lang].name]; },
      email: function (r) { return ['ok', 'Reception was emailed about ' + r.lead.name]; },
      hot: function (r) { return ['good', 'Urgent alert: ' + r.lead.name + ' wants to book']; },
      human: function (r) { return ['warn', 'Reception asked to speak to ' + r.lead.name + ': Ava could not fully answer']; },
      webhook: function (r, e) { return e.ok ? ['ok', r.lead.name + (e.n > 1 ? ' reached the patient system after ' + e.n + ' attempts' : ' was added to the patient system')] : ['warn', 'Could not add ' + r.lead.name + ' to the patient system (' + e.text + '). Trying again']; },
      sla1: function (r, e) { return /cancel/i.test(e.text) ? ['muted', 'Reminder cancelled for ' + r.lead.name + ': the team had already been in touch'] : ['warn', 'Reminder to reception: nobody has contacted ' + r.lead.name + ' yet']; },
      sla2: function (r, e) { return /cancel/i.test(e.text) ? ['muted', 'Escalation cancelled for ' + r.lead.name] : ['bad', 'Escalated to the practice manager: ' + r.lead.name + ' has waited 4 hours']; },
      followup: function (r, e) { return /cancel|not needed/i.test(e.text) ? ['muted', 'Follow-up not needed for ' + r.lead.name] : ['ok', 'Follow-up sent to ' + r.lead.name]; },
      confirm: function (r) { return ['good', r.lead.name + ' booked. Confirmation sent']; },
      rem24: function (r) { return ['ok', '24-hour reminder sent to ' + r.lead.name]; },
      rem1: function (r) { return ['ok', '1-hour reminder sent to ' + r.lead.name]; },
      noshow: function (r, e) { return /attended/i.test(e.text) ? ['muted', r.lead.name + ' attended'] : ['warn', r.lead.name + ' did not attend. Offered a new time']; },
      inv_send: function (r) { return ['ok', 'Invoice sent to ' + r.lead.name]; },
      inv_pre: function (r) { return ['ok', 'Friendly payment heads-up sent to ' + r.lead.name]; },
      inv_due: function (r) { return ['ok', 'Due-today reminder sent to ' + r.lead.name]; },
      inv_od7: function (r) { return ['warn', r.lead.name + ' is a week late. Firmer reminder sent']; },
      inv_od14: function (r) { return ['bad', r.lead.name + ' is two weeks late. Final notice sent: please phone them']; },
      weekly: function () { return ['good', 'Weekly report emailed to the practice']; },
      watch: function (r, e) { return e.text === 'All clear' ? ['muted', 'Daily health check: all clear'] : ['warn', 'Daily health check: ' + e.text]; }
    };
    function activity() {
      var items = [];
      state.runs.forEach(function (r) { (r.log || []).forEach(function (e) { var f = KIND[r.kind]; var m = f ? f(r, e) : ['ok', r.automation + ': ' + e.text]; items.push({ t: e.t, tone: m[0], text: m[1], k: r.kind }); }); });
      items.sort(function (a, b) { return b.t - a.t; });
      if (!items.length) return '<p class="empty">Nothing has happened yet.</p>';
      return '<ul class="activity">' + items.slice(0, 80).map(function (x) { return '<li class="' + x.tone + '"><time>' + esc(F.fmtTime(x.t)) + '</time>' + esc(x.text) + '</li>'; }).join('') + '</ul>';
    }

    var RENDER = { today: today, enquiries: enquiries, diary: diary, invoices: invoices, report: report, activity: activity };

    function render() {
      state = E.state;
      var sys = SYSTEM[state.mode] || SYSTEM.up;
      $('hub-sys').className = 'hub-sys ' + sys[1]; $('hub-sys').textContent = 'Patient system: ' + sys[0];
      $('hub-clock').textContent = F.fmtTime(state.now);
      var badge = { today: waiting().length + owing().length + stuck().length, enquiries: waiting().length, diary: 0, invoices: owing().length, report: 0, activity: 0 };
      paint('hub-tabs', TABS.map(function (t) { return '<button class="hub-tab' + (t[0] === tab ? ' on' : '') + '" role="tab" aria-selected="' + (t[0] === tab) + '" data-tab="' + t[0] + '" type="button">' + t[1] + (badge[t[0]] ? ' <i>' + badge[t[0]] + '</i>' : '') + '</button>'; }).join(''));
      // keep dropdown choices while the screen is redrawn
      var keep = {}; ['hub-slot', 'hub-inv-lead', 'hub-inv-treat', 'hub-inv-days'].forEach(function (id) { var el = $(id); if (el) keep[id] = el.value; });
      paint('hub-body', RENDER[tab]());
      Object.keys(keep).forEach(function (id) { var el = $(id); if (el && keep[id] !== undefined) el.value = keep[id]; });
    }

    root.addEventListener('change', function (e) { if (e.target.id === 'hub-inv-lead') E.state.ui.invLead = e.target.value; });
    root.addEventListener('click', function (e) {
      var tb = e.target.closest('[data-tab]');
      if (tb) { tab = tb.dataset.tab; painted['hub-body'] = null; render(); return; }
      var t = e.target.closest('[data-act]'); if (!t) return;
      var id = t.dataset.id, a = t.dataset.act;
      if (a === 'contacted') E.markContacted(id);
      else if (a === 'mark-booked') E.moveStage(id, 'booked');
      else if (a === 'attended') E.markAttended(id);
      else if (a === 'move') E.rescheduleBooking(id, ($('hub-slot') || {}).value || 'd1');
      else if (a === 'cancel-appt') E.cancelBooking(id);
      else if (a === 'paid') E.recordPayment(id, false);
      else if (a === 'part') E.recordPayment(id, true);
      else if (a === 'extend') E.extendInvoice(id, 7);
      else if (a === 'void') E.voidInvoice(id);
      else if (a === 'preview') E.previewReport();
      else if (a === 'send-report') E.sendReportNow();
      else if (a === 'new-invoice') {
        var lead = ($('hub-inv-lead') || {}).value, tr = TREATMENTS[Number(($('hub-inv-treat') || {}).value || 0)], days = ($('hub-inv-days') || {}).value;
        if (lead && tr) E.createInvoice({ leadId: lead, desc: tr[0], amount: tr[1], days: days });
      }
    });

    E.onChange(render);
    render();
    return { show: function (name) { if (RENDER[name]) { tab = name; painted['hub-body'] = null; render(); } } };
  }

  global.HubView = { mount: mount };
})(window);
