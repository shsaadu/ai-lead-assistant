/**
 * Assist Street Automation Lab: the screen.
 * All the rules (retries, signing, bookings, invoices, summaries) live in
 * /assets/automation-engine.js. This file only draws the interface and passes clicks to the engine.
 * The CRM and the "receiver" are simulated in the browser, with made-up people.
 */
(function () {
  'use strict';
  var E = AssistEngine.create({});

  /* ---------------- helpers from the engine ---------------- */
  var fmtTime = E.fmt.fmtTime, fmtIn = E.fmt.fmtIn, fmtDur = E.fmt.fmtDur, fmtSlot = E.fmt.fmtSlot, fmtDue = E.fmt.fmtDue, money = E.fmt.money, dayName = E.fmt.dayName;
  var bookedAlready = E.helpers.bookedAlready, isOverdue = E.helpers.isOverdue;
  var DAY = E.consts.DAY, WEEK = E.consts.WEEK, MAX_ATTEMPTS = E.consts.MAX_ATTEMPTS;
  var highlights = E.highlights;
  var state;
  function esc(v) { var d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; }

  /* ---------------- rendering ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var MODE_TEXT = {
    up: 'Messages arrive and a contact card appears straight away.',
    error: 'The CRM returns a server error. That is usually temporary, so the system will keep trying.',
    down: 'The CRM cannot be reached at all. Also temporary, so the system will keep trying.',
    slow: 'The CRM saves the lead but takes too long to answer. We cannot tell it worked, so we retry, and the CRM must ignore the repeat.',
    gone: 'The CRM says the address is gone for good. Retrying cannot help, so the run stops at once.'
  };
  var TRY = [
    ['sent', 'Send an enquiry and watch a card appear in the CRM.'],
    ['down', 'Set the CRM to Down, then send another enquiry.'],
    ['retried', 'Use the time machine (+5 min, +1 hour) and watch the retries in the run log.'],
    ['recovered', 'Set the CRM back to Working and watch the lead arrive on its own.'],
    ['dupe', 'Use "Same email again", or set the CRM to Too slow, and see that nothing is duplicated.'],
    ['replied', 'Click "Customer replied" on a card before the 2-day follow-up. Then skip 1 day twice.'],
    ['ack', 'Pick Spanish or Arabic and send. The customer is acknowledged in their own language.'],
    ['hot', 'Choose "Ready to book" and send. The owner is alerted at once and the card is marked HOT.'],
    ['booking', 'In panel 4, pick a customer and "Today, in 3 hours", then press "Book this slot". Watch the confirmation, the card moving to Booked, and the chase being cancelled.'],
    ['noshow', 'Use +1 hour until the reminder goes out. Then let the appointment pass without clicking "Attended" to see the no-show message.'],
    ['invoice', 'In panel 5, press "Job done: send invoice". Watch the invoice email and the row of reminder chips.'],
    ['overdue', 'Use +1 week three or four times without marking it paid. Watch the reminders get firmer, and the owner asked to call.'],
    ['paidInv', 'Click "Mark paid" on an invoice and see every remaining reminder cancelled.'],
    ['doc', 'In panel 8, send "A clean supplier invoice". Watch it being read, checked and filed with nobody touching it, and a bill appear with reminders.'],
    ['docDupe', 'Send "The same invoice, sent again". It is spotted and never paid twice.'],
    ['docHeld', 'Send "An invoice with new bank details". It is held, and the manager is told to phone the supplier. Then try the other documents.'],
    ['report', 'Press "Simulate a week" and read the weekly summary it produces.'],
    ['quiet', 'After that, use +1 day three or four times with no new enquiries. The health check will warn the owner.'],
    ['escalated', 'Send an enquiry, then use +1 hour three times without clicking "We contacted them". Watch the reminder, then the escalation.']
  ];

  var painted = {};
  function paint(id, html) { var el = $(id); if (painted[id] !== html) { painted[id] = html; el.innerHTML = html; } }
  function overdueTag(leadId) {
    var owed = state.invoices.filter(function (i) { return i.leadId === leadId && isOverdue(i); }).reduce(function (t, i) { return t + i.amount - i.paid; }, 0);
    return owed ? '<span class="lab-tag overdue">Owes ' + money(owed) + '</span>' : '';
  }
  function reportHtml(r, isPreview) {
    var max = Math.max.apply(null, r.byDay.concat([1])), delta = r.prev == null ? '' : (r.enquiries - r.prev >= 0 ? '+' : '') + (r.enquiries - r.prev) + ' on last week';
    var kpi = function (v, l, s) { return '<div class="kpi"><strong>' + esc(v) + '</strong><span>' + esc(l) + '</span>' + (s ? '<em>' + esc(s) + '</em>' : '') + '</div>'; };
    var bars = r.byDay.map(function (n, i) { return '<div class="bar"><b>' + n + '</b><i style="height:' + Math.round(n / max * 100) + '%"></i><span>' + dayName(r.from + i * DAY) + '</span></div>'; }).join('');
    var notes = highlights(r).map(function (h) { return '<li class="' + h[0] + '">' + esc(h[1]) + '</li>'; }).join('');
    return '<div class="report-card' + (isPreview ? ' is-preview' : '') + '"><header><b>' + (isPreview ? 'Preview (not sent): your week so far' : 'Your week') + '</b><span>' + dayName(r.from) + ' Day ' + (Math.floor(r.from / DAY) + 1) + ' to ' + dayName(r.to - 1) + ' Day ' + (Math.floor((r.to - 1) / DAY) + 1) + '</span></header>' +
      '<div class="kpis">' + kpi(r.enquiries, 'Enquiries', delta) + kpi(r.withinHour + ' of ' + r.enquiries, 'Contacted within 1 hour', r.median != null ? 'typical: ' + fmtDur(r.median) : '') + kpi(r.booked, 'Booked', '') + kpi(r.hot, 'Hot leads', r.person ? r.person + ' needed a person' : '') + '</div>' +
      '<div class="bars" aria-label="Enquiries per day">' + bars + '</div><ul class="report-notes">' + notes + '</ul></div>';
  }
  function render() {
    state = E.state;
    $('clock').textContent = fmtTime(state.now);
    // mode buttons
    document.querySelectorAll('.mode').forEach(function (b) { var on = b.dataset.mode === state.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    $('modeExplain').textContent = MODE_TEXT[state.mode];
    // saved
    $('savedCount').textContent = state.saved.length;
    paint('savedList', state.saved.length ? state.saved.map(function (l) {
      return '<li><b>' + esc(l.name) + '</b><span>' + esc(l.email) + '</span></li>';
    }).join('') : '<li class="empty">Nothing yet. A lead is always saved here first, whatever happens next.</li>');
    // board
    ['new', 'contacted', 'booked'].forEach(function (stage) {
      var list = state.contacts.filter(function (c) { return c.stage === stage; });
      $('cnt-' + stage).textContent = list.length;
      paint('lane-' + stage, list.map(function (c) {
        var lead = state.saved.filter(function (l) { return l.id === c.leadId; })[0];
        var pending = state.runs.some(function (r) { return r.kind === 'followup' && r.status === 'scheduled' && r.lead && r.lead.id === c.leadId; });
        return '<article class="card' + (Date.now() < (c.freshUntil || 0) ? ' fresh' : '') + '"><header><b>' + esc(c.name) + '</b>' + (c.hot ? '<span class="lab-tag hot">HOT</span>' : '') + (c.person ? '<span class="lab-tag person">Needs a person</span>' : '') + (c.merged ? '<span class="lab-tag merge">merged ×' + c.merged + '</span>' : '') + overdueTag(c.leadId) + '</header>' +
          '<p class="em">' + esc(c.email) + '</p><p class="lab-note-text">' + esc(c.notes[0]) + '</p>' +
          (pending ? '<p class="lab-tag soon">Follow-up scheduled</p>' : '') +
          '<footer>' +
          (lead && !lead.contacted ? '<button class="mini" data-contacted="' + c.leadId + '" type="button">We contacted them</button>' : '') +
          (lead && !lead.replied ? '<button class="mini" data-reply="' + c.leadId + '" type="button">Customer replied</button>' : '') +
          (c.stage !== 'booked' ? '<button class="mini" data-book="' + c.id + '" type="button">Booked</button>' : '') +
          '</footer></article>';
      }).join(''));
    });
    $('boardEmpty').style.display = state.contacts.length ? 'none' : 'block';
    // emails
    paint('emails', state.emails.length ? state.emails.map(function (m) {
      return '<li class="mail ' + m.tone + '"><time>' + esc(fmtTime(m.t)) + '</time><b>' + esc(m.subject) + '</b><span>to ' + esc(m.to) + (m.link ? ' · includes ' + (typeof m.link === 'string' ? m.link : 'a booking link') : '') + '</span></li>';
    }).join('') : '<li class="empty">No emails yet.</li>');
    // feed
    paint('feed', state.feed.length ? state.feed.map(function (f) {
      return '<li class="f ' + f.tone + '"><time>' + esc(fmtTime(f.t)) + '</time>' + esc(f.text) + '</li>';
    }).join('') : '<li class="empty">Send an enquiry to begin.</li>');
    // runs
    var rows = [];
    state.runs.forEach(function (r) {
      var next = r.status === 'failed' || r.status === 'scheduled' || r.status === 'queued' ? fmtIn(r.nextAt - state.now) : r.status === 'dead' ? 'Stopped, alerted' : r.status === 'cancelled' ? 'Cancelled' : 'Done';
      var open = !!state.open[r.id];
      rows.push('<tr class="run' + (open ? ' open' : '') + '" data-run="' + r.id + '" tabindex="0"><td>' + esc(fmtTime(r.startedAt)) + '</td><td>' + esc(r.lead.name) + '</td><td>' + esc(r.automation) + '</td>' +
        '<td><span class="pill ' + r.status + '">' + r.status + '</span></td><td>' + r.attempts + (r.kind === 'webhook' ? ' / ' + MAX_ATTEMPTS : '') + '</td><td>' + esc(next) + '</td>' +
        '<td>' + ((r.status === 'dead' || r.status === 'failed') && r.kind === 'webhook' ? '<button class="mini" data-retry="' + r.id + '" type="button">Retry now</button>' : '') + '</td></tr>');
      if (open) {
        rows.push('<tr class="detail"><td colspan="7"><ol class="attempts">' + (r.log.length ? r.log.map(function (a) {
          return '<li class="' + (a.ok ? 'ok' : 'no') + '"><b>Attempt ' + a.n + '</b> · ' + esc(fmtTime(a.t)) + ' · ' + esc(a.text) +
            (a.sig ? '<code>signature ' + esc(a.sig.slice(0, 19)) + '…</code>' : '') + '</li>';
        }).join('') : '<li>Not started yet.</li>') + '</ol></td></tr>');
      }
    });
    paint('runs', rows.length ? rows.join('') : '<tr class="empty"><td colspan="7">No runs yet.</td></tr>');
    // bookings
    var open = state.saved.filter(function (l) { return !bookedAlready(l); });
    paint('bookLead', open.length ? open.map(function (l) { return '<option value="' + l.id + '"' + (state.ui.lead === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') : '<option value="">No customers waiting to book</option>');
    var order = ['confirm', 'rem24', 'rem1', 'noshow'], labels = { confirm: 'Confirmation', rem24: '24h reminder', rem1: '1h reminder', noshow: 'No-show check' };
    paint('appts', state.bookings.length ? state.bookings.map(function (b) {
      var steps = order.map(function (k) {
        var r = state.runs.filter(function (x) { return x.bookingId === b.id && x.kind === k; })[0];
        if (!r) return '<span class="step-chip skip">' + labels[k] + ': not needed</span>';
        var cls = r.status === 'succeeded' ? 'done' : r.status === 'cancelled' ? 'skip' : 'wait';
        var tx = r.status === 'succeeded' ? '✓' : r.status === 'cancelled' ? 'cancelled' : fmtIn(r.nextAt - state.now);
        return '<span class="step-chip ' + cls + '">' + labels[k] + ': ' + tx + '</span>';
      }).join('');
      return '<li class="appt ' + b.status + '"><div class="appt-top"><b>' + esc(b.lead.name) + '</b><span>' + esc(fmtSlot(b.at)) + '</span><span class="pill ' + (b.status === 'booked' ? 'scheduled' : b.status === 'attended' ? 'succeeded' : b.status === 'noshow' ? 'dead' : 'cancelled') + '">' + (b.status === 'noshow' ? 'no-show' : b.status) + '</span></div><div class="appt-steps">' + steps + '</div>' +
        (b.status === 'booked' ? '<div class="appt-actions">' + (state.now >= b.at ? '<button class="mini" data-attended="' + b.id + '" type="button">Attended</button>' : '<button class="mini" type="button" disabled title="Available once the appointment starts">Attended (after it starts)</button>') + '<button class="mini" data-move="' + b.id + '" type="button">Move to the time chosen above</button><button class="mini" data-cancelbk="' + b.id + '" type="button">Cancel</button></div>' : '') + '</li>';
    }).join('') : '<li class="empty">No appointments yet. Pick a customer and a time above.</li>');
    // invoices
    paint('invLead', state.saved.length ? state.saved.map(function (l) { return '<option value="' + l.id + '"' + (state.ui.invLead === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') : '<option value="">No customers yet</option>');
    var tot = function (f) { return state.invoices.reduce(function (t, i) { return t + f(i); }, 0); };
    paint('cash', '<div class="cashbox"><span>Outstanding</span><b>' + money(tot(function (i) { return i.status === 'sent' ? i.amount - i.paid : 0; })) + '</b></div><div class="cashbox bad"><span>Overdue</span><b>' + money(tot(function (i) { return isOverdue(i) ? i.amount - i.paid : 0; })) + '</b></div><div class="cashbox good"><span>Paid</span><b>' + money(tot(function (i) { return i.paid; })) + '</b></div>');
    var kinds = ['inv_send', 'inv_pre', 'inv_due', 'inv_od7', 'inv_od14'], names = { inv_send: 'Sent', inv_pre: '3-day heads-up', inv_due: 'Due date', inv_od7: '7 days late', inv_od14: 'Final notice' };
    paint('invoices', state.invoices.length ? state.invoices.map(function (i) {
      var left = i.amount - i.paid, late = isOverdue(i), st = i.status === 'paid' ? 'paid' : i.status === 'void' ? 'void' : late ? 'overdue' : 'sent';
      var chips = kinds.map(function (k) {
        var r = state.runs.filter(function (x) { return x.invoiceId === i.id && x.kind === k; })[0];
        if (!r) return '<span class="step-chip skip">' + names[k] + ': not needed</span>';
        var cls = r.status === 'succeeded' ? 'done' : r.status === 'cancelled' ? 'skip' : 'wait';
        return '<span class="step-chip ' + cls + '">' + names[k] + ': ' + (r.status === 'succeeded' ? '✓' : r.status === 'cancelled' ? 'cancelled' : fmtIn(r.nextAt - state.now)) + '</span>';
      }).join('');
      return '<li class="inv ' + st + '"><div class="appt-top"><b>' + esc(i.number) + '</b><span>' + esc(i.lead.name) + ' · ' + esc(i.desc) + '</span><span class="amount">' + (i.paid && i.status === 'sent' ? money(left) + ' left of ' + money(i.amount) : money(i.amount)) + '</span><span class="pill ' + (st === 'paid' ? 'succeeded' : st === 'overdue' ? 'dead' : st === 'void' ? 'cancelled' : 'scheduled') + '">' + st + '</span></div>' +
        '<div class="appt-top sub"><span>Due ' + esc(fmtDue(i.dueAt)) + (i.extended ? ' (extended)' : '') + '</span>' + (i.atRisk ? '<span class="lab-tag overdue">Owner asked to call</span>' : '') + '</div><div class="appt-steps">' + chips + '</div>' +
        (i.status === 'sent' ? '<div class="appt-actions"><button class="mini" data-paid="' + i.id + '" type="button">Mark paid</button><button class="mini" data-part="' + i.id + '" type="button">Part payment (half)</button><button class="mini" data-extend="' + i.id + '" type="button">Give 7 more days</button><button class="mini" data-void="' + i.id + '" type="button">Cancel invoice</button></div>' : '') + '</li>';
    }).join('') : '<li class="empty">No invoices yet. Send an enquiry, then mark a job done above.</li>');
    // weekly summary
    var shown = state.preview || state.reports[0];
    paint('report', shown ? reportHtml(shown, !!state.preview) : '<p class="empty">No summary yet. Simulate a week, or preview this week, to see one.</p>');
    // checklist
    paint('tryList', TRY.map(function (t) { return '<li class="' + (state.flags[t[0]] ? 'done' : '') + '"><span class="tick" aria-hidden="true">' + (state.flags[t[0]] ? '✓' : '') + '</span>' + esc(t[1]) + '</li>'; }).join(''));
  }

  /* ---------------- wiring ---------------- */
  function init() {
    $('year') && ($('year').textContent = new Date().getFullYear());
    $('leadForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = new FormData(e.target);
      E.submitLead({ name: f.get('name'), email: f.get('email'), message: f.get('message'), intent: f.get('intent'), lang: f.get('lang') });
    });
    $('sameEmailBtn').addEventListener('click', function () {
      var f = $('leadForm'); f.elements.message.value = 'Actually, can I start next Monday instead?';
      E.submitLead({ name: f.elements.name.value, email: f.elements.email.value, message: f.elements.message.value, intent: f.elements.intent.value, lang: f.elements.lang.value });
    });
    document.querySelectorAll('.mode').forEach(function (b) { b.addEventListener('click', function () { E.setMode(b.dataset.mode); }); });
    document.querySelectorAll('[data-skip]').forEach(function (b) { b.addEventListener('click', function () { E.skip(Number(b.dataset.skip)); }); });
    $('resetBtn').addEventListener('click', function () { E.reset(); });
    $('simWeekBtn').addEventListener('click', function () { E.simulateWeek(); });
    $('invLead').addEventListener('change', function (e) { E.state.ui.invLead = e.target.value; });
    $('invBtn').addEventListener('click', function () { var d = { leadId: $('invLead').value, desc: $('invDesc').value, amount: $('invAmount').value, days: $('invDays').value }; if (d.leadId) E.createInvoice(d); });
    $('bookLead').addEventListener('change', function (e) { E.state.ui.lead = e.target.value; });
    $('bookBtn').addEventListener('click', function () { var id = $('bookLead').value, slot = $('bookSlot').value; if (id) E.createBooking(id, slot); });
    $('nextMonBtn').addEventListener('click', function () { E.skipToNextReport(); });
    $('previewBtn').addEventListener('click', function () { E.previewReport(); });
    $('sendNowBtn').addEventListener('click', function () { E.sendReportNow(); });
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.dataset.reply) E.customerReplied(t.dataset.reply);
      else if (t.dataset.contacted) E.markContacted(t.dataset.contacted);
      else if (t.dataset.attended) E.markAttended(t.dataset.attended);
      else if (t.dataset.paid) E.recordPayment(t.dataset.paid, false);
      else if (t.dataset.part) E.recordPayment(t.dataset.part, true);
      else if (t.dataset.extend) E.extendInvoice(t.dataset.extend, 7);
      else if (t.dataset.void) E.voidInvoice(t.dataset.void);
      else if (t.dataset.move) E.rescheduleBooking(t.dataset.move, $('bookSlot').value);
      else if (t.dataset.cancelbk) E.cancelBooking(t.dataset.cancelbk);
      else if (t.dataset.book) E.moveStage(t.dataset.book, 'booked');
      else if (t.dataset.retry) { e.stopPropagation(); E.retryNow(t.dataset.retry); }
      else { var row = t.closest && t.closest('tr.run'); if (row) E.toggleOpen(row.dataset.run); }
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.run')) { e.preventDefault(); E.toggleOpen(e.target.dataset.run); }
    });
    setInterval(function () { if (!document.hidden) E.advance(0.25); }, 250);
    E.onChange(render);
    if (window.DocsView && window.DocReader) DocsView.mount($('docsMount'), E, { theme: 'dark' });
    render();
  }

  // The same entry point the automated checks have always used.
  window.AutomationLab = {
    get state() { return E.state; }, engine: E,
    submitLead: E.submitLead, setMode: E.setMode, advance: E.advance, customerReplied: E.customerReplied, markContacted: E.markContacted,
    createInvoice: E.createInvoice, recordPayment: E.recordPayment, extendInvoice: E.extendInvoice, voidInvoice: E.voidInvoice,
    createBooking: E.createBooking, markAttended: E.markAttended, rescheduleBooking: E.rescheduleBooking, cancelBooking: E.cancelBooking,
    simulateWeek: E.simulateWeek, buildReport: E.buildReport, highlights: E.highlights, retryNow: E.retryNow, reset: E.reset,
    selfTest: E.selfTest, BACKOFF_MIN: E.consts.BACKOFF_MIN, idle: E.idle
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
