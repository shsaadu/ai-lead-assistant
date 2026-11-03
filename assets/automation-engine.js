/**
 * Assist Street automation engine.
 * The rules behind the interactive demos: events, HMAC-signed webhooks, retries with back-off,
 * duplicate protection, follow-ups that stop when the customer replies, reply deadlines,
 * bookings and reminders, invoices and payment reminders (reminders only: the system never
 * touches money), a weekly summary and a daily health check.
 * Everything runs in the browser against a simulated CRM, with made-up people. There is no screen
 * code in this file: each demo page builds its own interface on top of an engine instance, so the
 * same rules can drive the Automation Lab, a clinic back office and a patient's phone.
 *
 *   var engine = AssistEngine.create({ owner: 'reception@clinic.example' });
 *   engine.onChange(function () { redraw(engine.state); });
 *   engine.submitLead({ name: 'Maria', email: 'm@example.com', message: '...', intent: 'ready', lang: 'es' });
 */
(function (global) {
  'use strict';

  function create(config) {
    config = config || {};
    var OWNER = config.owner || 'owner@yourbusiness.example';
    var MANAGER = config.manager || 'manager@yourbusiness.example';
    var OPERATOR = config.operator || 'you@assiststreet.example';
    var listeners = [];
    function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }

  /* ---------------- rules ---------------- */
  var BACKOFF_MIN = [1, 5, 30, 120, 360];   // wait after attempt 1..5
  var MAX_ATTEMPTS = BACKOFF_MIN.length + 1; // six in total
  var DAY = 1440;
  var START_MIN = 9 * 60;
  var WEEK = 7 * DAY;
  var FIRST_WEEKLY = 7 * DAY + 8 * 60;   // Day 8 (the next Monday) at 08:00
  var FIRST_WATCH = DAY + 9 * 60;        // every day at 09:00
  var QUIET_AFTER = 72 * 60;
  var FOLLOW_UP_AFTER = 2 * DAY;
  var SECRET = 'whsec_demo_' + Math.random().toString(36).slice(2, 10);
  var enc = new TextEncoder();

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  async function hmacHex(secret, message) {
    var key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  }
  /** success | retry (temporary) | permanent */
  function classify(result) {
    if (result.kind === 'timeout' || result.kind === 'network') return 'retry';
    var s = result.status;
    if (s >= 200 && s < 300) return 'success';
    if (s === 408 || s === 429 || s >= 500) return 'retry';
    return 'permanent';
  }
  function fmtTime(min) {
    var m = Math.floor(min), day = Math.floor(m / DAY) + 1, h = Math.floor((m % DAY) / 60), mm = m % 60;
    return 'Day ' + day + ' · ' + String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }
  function dayName(min) { return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][Math.floor(min / DAY) % 7]; }
  function fmtDur(m) { return m < 60 ? Math.round(m) + ' min' : (Math.round(m / 6) / 10) + ' hours'; }
  function fmtIn(mins) {
    if (mins <= 0) return 'now';
    if (mins < 60) return 'in ' + Math.ceil(mins) + ' min';
    if (mins < DAY) return 'in ' + Math.round(mins / 6) / 10 + ' h';
    var dd = Math.round(mins / DAY * 10) / 10; return 'in ' + dd + (dd === 1 ? ' day' : ' days');
  }
  function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 8); }

  /* ---------------- state ---------------- */
  var state;
  function fresh() {
    return {
      now: START_MIN, mode: 'up', saved: [], contacts: [], seenEvents: {}, runs: systemRuns(), emails: [], feed: [], reports: [], preview: null, alertedAt: { quiet: -1e9, crm: -1e9 }, bookings: [], invoices: [], invNo: 0, ui: { lead: '' },
      open: {}, flags: { sent: false, down: false, retried: false, recovered: false, dupe: false, replied: false, ack: false, hot: false, escalated: false }
    };
  }
  /** Recurring jobs that belong to the whole business, not to one lead. */
  function systemRuns() {
    var who = { name: 'Whole business', id: null };
    return [
      { id: uid('run'), event: null, kind: 'weekly', automation: 'Weekly summary email (Mondays 08:00)', lead: who, status: 'scheduled', attempts: 0, nextAt: FIRST_WEEKLY, every: WEEK, startedAt: START_MIN, log: [] },
      { id: uid('run'), event: null, kind: 'watch', automation: 'Daily health check (09:00)', lead: who, status: 'scheduled', attempts: 0, nextAt: FIRST_WATCH, every: DAY, startedAt: START_MIN, log: [] }
    ];
  }
  state = fresh();

  var LANG = {
    en: { name: 'English', subject: function (n) { return "We've received your enquiry, " + n; } },
    es: { name: 'Spanish', subject: function (n) { return 'Hemos recibido tu consulta, ' + n; } },
    ar: { name: 'Arabic', subject: function (n) { return 'لقد استلمنا استفسارك، ' + n; } }
  };
  /** The automations set up for one lead. Some only exist for certain kinds of lead. */
  function plan(lead) {
    var hot = lead.intent === 'ready', p = [
      { id: 'a_ack', name: 'Acknowledge the customer (in ' + LANG[lead.lang].name + ')', kind: 'ack', at: 0 },
      { id: 'a_owner', name: 'Email the owner', kind: 'email', at: 0 }
    ];
    if (hot) p.push({ id: 'a_hot', name: 'Hot-lead alert', kind: 'hot', at: 0 });
    if (lead.intent === 'person') p.push({ id: 'a_human', name: 'Needs-a-person alert', kind: 'human', at: 0 });
    p.push({ id: 'a_crm', name: 'Send lead to the CRM', kind: 'webhook', at: 0 });
    p.push({ id: 'a_sla1', name: 'Remind the owner if nobody replies in 2 hours', kind: 'sla1', at: 120 });
    p.push({ id: 'a_sla2', name: 'Escalate to a manager after 4 hours', kind: 'sla2', at: 240 });
    p.push({ id: 'a_follow', name: 'Follow up in ' + (hot ? '1 day' : '2 days') + ' if no reply', kind: 'followup', at: hot ? DAY : FOLLOW_UP_AFTER });
    return p;
  }

  /* ---------------- narrator + emails ---------------- */
  function say(tone, text) { state.feed.unshift({ t: state.now, tone: tone, text: text }); if (state.feed.length > 60) state.feed.pop(); }
  function mail(to, subject, tone, link) { state.emails.unshift({ t: state.now, to: to, subject: subject, tone: tone || 'info', link: link || false }); if (state.emails.length > 30) state.emails.pop(); }

  /* ---------------- the simulated CRM receiver ---------------- */
  /** Returns what the sender would see. 'slow' saves the lead but answers too late. */
  async function receiver(req) {
    var mode = state.mode;
    if (mode === 'down') return { kind: 'network', note: 'Could not connect' };
    if (mode === 'error') return { kind: 'http', status: 500, note: 'Internal Server Error' };
    if (mode === 'gone') return { kind: 'http', status: 410, note: 'Gone: this address no longer exists' };

    // working or slow: the receiver verifies the signature, then processes the event once
    var expected = await hmacHex(SECRET, req.timestamp + '.' + req.body);
    if (expected !== req.signature.replace('v1=', '')) return { kind: 'http', status: 401, note: 'Signature did not match' };
    var evt = JSON.parse(req.body), outcome;
    if (state.seenEvents[evt.id]) {
      outcome = 'duplicate';
      state.flags.dupe = true;
      say('good', 'The CRM saw event ' + evt.id.slice(0, 10) + ' a second time and ignored it, so there is no double entry.');
    } else {
      state.seenEvents[evt.id] = true;
      outcome = upsertContact(evt);
    }
    if (mode === 'slow') return { kind: 'timeout', note: 'No answer within 8 seconds (the CRM did save it)', processed: outcome };
    return { kind: 'http', status: 200, note: outcome === 'duplicate' ? 'Already received: ignored' : outcome === 'merged' ? 'Existing contact updated' : 'Contact created', processed: outcome };
  }
  function upsertContact(evt) {
    var email = evt.lead.email.toLowerCase(), c = null;
    for (var i = 0; i < state.contacts.length; i++) if (state.contacts[i].email === email) c = state.contacts[i];
    if (c) {
      c.merged += 1; c.notes.unshift('Asked again: "' + evt.lead.message + '"'); if (evt.lead.intent === 'ready') c.hot = true;
      state.flags.dupe = true;
      say('good', 'This email is already in the CRM, so the existing contact was updated instead of making a second one.');
      return 'merged';
    }
    state.contacts.push({ freshUntil: Date.now() + 700, hot: evt.lead.intent === 'ready', person: evt.lead.intent === 'person', lang: evt.lead.lang, id: uid('c'), name: evt.lead.name, email: email, stage: bookedAlready(evt.lead) ? 'booked' : 'new', merged: 0, notes: ['Asked: "' + evt.lead.message + '"'], source: 'Website assistant', leadId: evt.lead.id, created: state.now });
    return 'created';
  }

  /* ---------------- sending a signed message ---------------- */
  async function deliver(run) {
    var evt = run.event;
    var body = JSON.stringify({ id: evt.id, version: 1, type: 'lead.created', created_at: fmtTime(evt.at), lead: evt.lead });
    var ts = String(Math.floor(state.now));
    var sig = 'v1=' + await hmacHex(SECRET, ts + '.' + body);
    var result = await receiver({ body: body, timestamp: ts, signature: sig });
    return { sig: sig, ts: ts, result: result };
  }

  /* ---------------- the weekly summary ---------------- */
  function buildReport(end) {
    var from = end - WEEK;
    var leads = state.saved.filter(function (l) { return l.at >= from && l.at < end; });
    var byDay = [], d;
    for (d = 0; d < 7; d++) byDay.push(leads.filter(function (l) { return l.at >= from + d * DAY && l.at < from + (d + 1) * DAY; }).length);
    var times = leads.filter(function (l) { return l.contactedAt != null; }).map(function (l) { return l.contactedAt - l.at; }).sort(function (a, b) { return a - b; });
    var n = times.length, median = n ? (n % 2 ? times[(n - 1) / 2] : (times[n / 2 - 1] + times[n / 2]) / 2) : null;
    var mine = state.runs.filter(function (r) { return r.lead && r.lead.id && leads.indexOf(r.lead) >= 0; });
    var web = mine.filter(function (r) { return r.kind === 'webhook'; });
    var done = function (kind, status) { return mine.filter(function (r) { return r.kind === kind && r.status === status; }).length; };
    return {
      from: from, to: end, enquiries: leads.length, byDay: byDay,
      hot: leads.filter(function (l) { return l.intent === 'ready'; }).length,
      person: leads.filter(function (l) { return l.intent === 'person'; }).length,
      withinHour: times.filter(function (t) { return t <= 60; }).length, median: median,
      waiting: leads.filter(function (l) { return !l.contacted; }).length,
      waitingNames: leads.filter(function (l) { return !l.contacted; }).map(function (l) { return l.name; }),
      booked: state.contacts.filter(function (c) { return c.stage === 'booked' && leads.some(function (l) { return l.id === c.leadId; }); }).length,
      followupsSent: done('followup', 'succeeded'), followupsCancelled: done('followup', 'cancelled'),
      escalations: done('sla2', 'succeeded'),
      crm: { total: web.length, firstTry: web.filter(function (r) { return r.status === 'succeeded' && r.attempts === 1; }).length,
             recovered: web.filter(function (r) { return r.status === 'succeeded' && r.attempts > 1; }).length,
             pending: web.filter(function (r) { return r.status === 'failed' || r.status === 'dead' || r.status === 'queued' || r.status === 'running'; }).length },
      appts: (function () { var mine = state.bookings.filter(function (b) { return leads.indexOf(b.lead) >= 0; }); return { total: mine.length, attended: mine.filter(function (b) { return b.status === 'attended'; }).length, noShows: mine.filter(function (b) { return b.status === 'noshow'; }).length, cancelled: mine.filter(function (b) { return b.status === 'cancelled'; }).length, reminders: state.runs.filter(function (r) { return (r.kind === 'rem24' || r.kind === 'rem1') && r.status === 'succeeded' && leads.indexOf(r.lead) >= 0; }).length }; })(),
      inv: (function () {
        var sum = function (arr, f) { return arr.reduce(function (t, x) { return t + f(x); }, 0); };
        var issued = state.invoices.filter(function (i) { return i.issuedAt >= from && i.issuedAt < end && i.status !== 'void'; });
        var open = state.invoices.filter(function (i) { return i.status === 'sent'; }), late = open.filter(function (i) { return end > i.dueAt && i.amount - i.paid > 0; });
        var payments = []; state.invoices.forEach(function (i) { (i.payments || []).forEach(function (p) { if (p.t >= from && p.t < end) payments.push(p); }); });
        return { count: issued.length, invoiced: sum(issued, function (i) { return i.amount; }), paid: sum(payments, function (p) { return p.amount; }), outstanding: sum(open, function (i) { return i.amount - i.paid; }), overdueCount: late.length, overdue: sum(late, function (i) { return i.amount - i.paid; }), reminders: sum(state.invoices.filter(function (i) { return i.issuedAt < end; }), function (i) { return i.reminders; }) };
      })(),
      prev: state.reports.length ? state.reports[0].enquiries : null
    };
  }
  function highlights(r) {
    var out = [], plural = function (n, w) { return n + ' ' + (n === 1 ? w : /y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'); };
    var invLine = (r.inv && (r.inv.count || r.inv.outstanding || r.inv.paid)) ? [r.inv.overdueCount ? 'warn' : 'good', 'Invoices: ' + r.inv.count + ' sent this week (' + money(r.inv.invoiced) + '), ' + money(r.inv.paid) + ' paid, ' + money(r.inv.outstanding) + ' outstanding in total' + (r.inv.overdueCount ? ', of which ' + r.inv.overdueCount + ' overdue (' + money(r.inv.overdue) + ')' : '') + '. ' + r.inv.reminders + ' payment reminders have gone out automatically.'] : null;
    if (!r.enquiries) return [['warn', 'A quiet week: no new enquiries arrived. If that is not expected, check that the website form and assistant are still working.']].concat(invLine ? [invLine] : []);
    if (r.median != null) out.push(['good', 'Typical time to first contact: ' + fmtDur(r.median) + '. ' + r.withinHour + ' of ' + r.enquiries + ' were contacted within an hour.']);
    if (r.waiting) out.push(['bad', plural(r.waiting, 'lead') + ' still waiting for a reply: ' + r.waitingNames.join(', ') + '.']);
    if (r.escalations) out.push(['warn', plural(r.escalations, 'enquiry') + ' waited over 4 hours and ' + (r.escalations === 1 ? 'was' : 'were') + ' escalated to a manager.']);
    if (r.crm.recovered) out.push(['good', plural(r.crm.recovered, 'lead') + ' did not reach the CRM at first because it was unavailable. ' + (r.crm.pending ? 'Delivered automatically afterwards, except ' + r.crm.pending + ' that still need attention.' : 'All were delivered automatically afterwards, and nobody had to step in.')]);
    else if (r.crm.pending) out.push(['bad', plural(r.crm.pending, 'lead') + ' have not reached the CRM and need attention.']);
    if (r.appts && r.appts.total) out.push(['good', 'Appointments: ' + r.appts.total + ' booked, ' + r.appts.attended + ' attended, ' + r.appts.noShows + ' no-show' + (r.appts.noShows === 1 ? '' : 's') + ' (rebooking offered), ' + r.appts.cancelled + ' cancelled. ' + r.appts.reminders + ' reminders sent automatically.']);
    if (invLine) out.push(invLine);
    if (r.followupsSent || r.followupsCancelled) out.push(['good', 'Follow-ups: ' + r.followupsSent + ' sent, ' + r.followupsCancelled + ' not needed because the customer replied.']);
    return out;
  }
  function sendReport(r) {
    state.reports.unshift(r); state.preview = null; state.flags.report = true;
    mail(OWNER, 'Your week: ' + r.enquiries + ' enquiries, ' + r.withinHour + ' contacted within an hour' + (r.waiting ? ', ' + r.waiting + ' still waiting' : ''), 'report');
  }

  /* ---------------- executing a run ---------------- */
  async function execute(run) {
    var lead = run.event ? run.event.lead : null;
    if (run.kind.indexOf('inv_') === 0) {
      var inv = invoiceById(run.invoiceId), IT = INV_TEXT[lead.lang], left = inv ? inv.amount - inv.paid : 0;
      run.attempts = 1; run.nextAt = null;
      if (!inv || inv.status !== 'sent' || left <= 0) { run.status = 'cancelled'; run.log.push({ n: 1, t: state.now, ok: true, text: 'Already paid or cancelled, so no reminder was needed' }); return; }
      run.status = 'succeeded';
      var cnote = state.contacts.filter(function (x) { return x.leadId === lead.id; })[0];
      if (run.kind === 'inv_send') {
        run.log.push({ n: 1, t: state.now, ok: true, text: 'Invoice sent in ' + LANG[lead.lang].name });
        mail(lead.email, IT.send(inv.number, money(left), fmtDue(inv.dueAt)), 'invoice', 'a payment link');
        mail(OWNER, 'Invoice sent: ' + inv.number + ' to ' + lead.name + ', ' + money(inv.amount), 'info');
        if (cnote) cnote.notes.unshift('Invoice ' + inv.number + ' sent (' + money(inv.amount) + ')');
        say('good', 'The job was marked done, so invoice ' + inv.number + ' (' + money(inv.amount) + ') went to ' + lead.name + ' in ' + LANG[lead.lang].name + ', with a payment link and a due date. Reminders are scheduled.');
      } else if (run.kind === 'inv_pre') {
        run.log.push({ n: 1, t: state.now, ok: true, text: 'Friendly heads-up sent' }); inv.reminders += 1;
        mail(lead.email, IT.pre(inv.number, money(left)), 'remind', 'a payment link');
        say('info', 'Three days before the due date, ' + lead.name + ' got a friendly heads-up. Most people just forget.');
      } else if (run.kind === 'inv_due') {
        run.log.push({ n: 1, t: state.now, ok: true, text: 'Due-today reminder sent' }); inv.reminders += 1;
        mail(lead.email, IT.due(inv.number, money(left)), 'remind', 'a payment link');
        say('info', 'Invoice ' + inv.number + ' is due today, so ' + lead.name + ' was reminded.');
      } else if (run.kind === 'inv_od7') {
        run.log.push({ n: 1, t: state.now, ok: true, text: 'Overdue reminder sent, owner told' }); inv.reminders += 1; state.flags.overdue = true;
        mail(lead.email, IT.od7(inv.number, money(left)), 'warn', 'a payment link');
        mail(OWNER, 'Overdue: ' + lead.name + ' owes ' + money(left) + ' (7 days late)', 'warn');
        if (cnote) cnote.notes.unshift('Invoice ' + inv.number + ' is 7 days overdue');
        say('warn', 'A week overdue: ' + lead.name + ' got a firmer reminder, and the owner was told.');
      } else {
        run.log.push({ n: 1, t: state.now, ok: true, text: 'Final notice sent, owner asked to call' }); inv.reminders += 1; inv.atRisk = true;
        mail(lead.email, IT.od14(inv.number, money(left)), 'escalate', 'a payment link');
        mail(OWNER, 'Call ' + lead.name + ': ' + money(left) + ' is 14 days overdue', 'escalate');
        if (cnote) cnote.notes.unshift('Invoice ' + inv.number + ' is 14 days overdue: call them');
        say('bad', 'Two weeks overdue: a final notice went out and the owner was asked to phone ' + lead.name + '. The automatic chasing stops here, because the next step needs a person.');
      }
      return;
    }
    if (run.kind === 'confirm' || run.kind === 'rem24' || run.kind === 'rem1' || run.kind === 'noshow') {
      var bk = bookingById(run.bookingId), T = BOOK_TEXT[lead.lang];
      run.attempts = 1; run.nextAt = null;
      if (!bk || bk.status === 'cancelled' || (run.kind === 'noshow' && bk.status === 'attended') || (run.kind !== 'noshow' && bk.status !== 'booked')) {
        run.status = 'cancelled'; run.log.push({ n: 1, t: state.now, ok: true, text: run.kind === 'noshow' ? 'They attended, so no follow-up was needed' : 'The booking is no longer active' });
        return;
      }
      run.status = 'succeeded'; var slot = fmtSlot(bk.at);
      if (run.kind === 'confirm') {
        run.log.push({ n: 1, t: state.now, ok: true, text: 'Confirmation sent in ' + LANG[lead.lang].name });
        mail(lead.email, T.confirm(slot), 'book');
        say('good', lead.name + ' booked ' + slot + '. A confirmation went out in ' + LANG[lead.lang].name + ', the CRM card moved to Booked, the chasing follow-up was cancelled, and reminders were scheduled.');
      } else if (run.kind === 'rem24') {
        state.flags.reminded = true; run.log.push({ n: 1, t: state.now, ok: true, text: '24-hour reminder sent' });
        mail(lead.email, T.rem24(slot), 'remind'); say('info', 'Reminder sent to ' + lead.name + ' (24 hours before), in ' + LANG[lead.lang].name + '.');
      } else if (run.kind === 'rem1') {
        state.flags.reminded = true; run.log.push({ n: 1, t: state.now, ok: true, text: '1-hour reminder sent' });
        mail(lead.email, T.rem1(), 'remind'); say('info', 'Last reminder sent to ' + lead.name + ' (1 hour before).');
      } else {
        bk.status = 'noshow'; state.flags.noshow = true; run.log.push({ n: 1, t: state.now, ok: true, text: 'No-show: rebooking offered' });
        mail(lead.email, T.noshow(), 'follow', true); mail(OWNER, 'No-show: ' + lead.name + ' did not attend ' + slot, 'warn');
        var cn = state.contacts.filter(function (x) { return x.leadId === lead.id; })[0];
        if (cn) { cn.stage = 'contacted'; cn.notes.unshift('No-show: rebooking offered'); }
        say('warn', lead.name + ' did not attend. A friendly "pick a new time" message with a booking link went out automatically, and the owner was told.');
      }
      return;
    }
    if (run.kind === 'weekly') {
      var rep = buildReport(run.nextAt);
      sendReport(rep);
      run.attempts += 1; run.log.push({ n: run.attempts, t: state.now, ok: true, text: 'Summary sent: ' + rep.enquiries + ' enquiries' });
      say('good', 'It is Monday 08:00, so the weekly summary was built from the run log and emailed to the owner, without anyone asking for it.');
      run.status = 'scheduled'; run.nextAt += run.every;
      return;
    }
    if (run.kind === 'watch') {
      var last = state.saved.reduce(function (m, l) { return Math.max(m, l.at); }, -1), notes = [];
      if (state.saved.length && state.now - last >= QUIET_AFTER && state.now - state.alertedAt.quiet >= QUIET_AFTER) {
        state.alertedAt.quiet = state.now; notes.push('quiet alert sent'); state.flags.quiet = true;
        mail(OWNER, 'No new enquiries for 3 days. Is your website form or assistant still working?', 'warn');
        say('warn', 'Health check: no enquiries for three days, so the owner was asked to check the website. Silence can mean something broke.');
      }
      var stuck = state.runs.filter(function (r) { return r.kind === 'webhook' && (r.status === 'failed' || r.status === 'dead'); }).length;
      if (stuck && state.now - state.alertedAt.crm >= DAY) {
        state.alertedAt.crm = state.now; notes.push(stuck + ' lead(s) not in the CRM');
        mail(OPERATOR + ', ' + OWNER, 'Health check: ' + stuck + ' lead' + (stuck === 1 ? ' has' : 's have') + ' not reached the CRM yet', 'alert');
        say('bad', 'Health check: ' + stuck + ' lead' + (stuck === 1 ? ' is' : 's are') + ' still not in the CRM, so you were alerted.');
      }
      run.attempts += 1; run.log.push({ n: run.attempts, t: state.now, ok: true, text: notes.length ? notes.join('; ') : 'All clear' });
      run.status = 'scheduled'; run.nextAt += run.every;
      return;
    }
    if (run.kind === 'email') {
      run.attempts = 1; run.status = 'succeeded'; run.nextAt = null;
      run.log.push({ n: 1, t: state.now, ok: true, text: 'Email sent to the owner' });
      mail(OWNER, 'New lead: ' + lead.name, 'info');
      say('info', 'The owner was emailed straight away, as they are today.');
      return;
    }
    if (run.kind === 'ack') {
      run.attempts = 1; run.status = 'succeeded'; run.nextAt = null; state.flags.ack = true;
      run.log.push({ n: 1, t: state.now, ok: true, text: 'Acknowledgement sent in ' + LANG[lead.lang].name });
      mail(lead.email, LANG[lead.lang].subject(lead.name.split(' ')[0]), 'follow', lead.intent === 'ready');
      say('info', lead.name + ' got an acknowledgement within seconds, written in ' + LANG[lead.lang].name + ', so they know they were heard. The owner still gets an English summary.');
      return;
    }
    if (run.kind === 'hot') {
      run.attempts = 1; run.status = 'succeeded'; run.nextAt = null; state.flags.hot = true;
      run.log.push({ n: 1, t: state.now, ok: true, text: 'Urgent alert sent to the owner' });
      mail(OWNER, 'HOT LEAD: ' + lead.name + ' is ready to book', 'hot');
      say('good', lead.name + ' looks ready to book, so the owner got an urgent alert at once and the follow-up is sooner (1 day, not 2).');
      return;
    }
    if (run.kind === 'human') {
      run.attempts = 1; run.status = 'succeeded'; run.nextAt = null;
      run.log.push({ n: 1, t: state.now, ok: true, text: 'Alert sent: the assistant needs a person' });
      mail(OWNER, 'Needs a person: ' + lead.name + ' asked something the assistant could not answer', 'alert');
      say('warn', 'The assistant could not fully answer ' + lead.name + ', so the owner was told straight away, with the question.');
      return;
    }
    if (run.kind === 'sla1' || run.kind === 'sla2') {
      run.attempts = 1; run.nextAt = null;
      if (lead.contacted) { run.status = 'cancelled'; run.log.push({ n: 1, t: state.now, ok: true, text: 'Someone had already contacted them, so no reminder was needed' }); return; }
      run.status = 'succeeded';
      if (run.kind === 'sla1') {
        run.log.push({ n: 1, t: state.now, ok: true, text: 'Reminder sent to the owner' });
        mail(OWNER, 'Reminder: nobody has replied to ' + lead.name + ' yet (2 hours)', 'warn');
        say('warn', 'Two hours have passed and nobody has contacted ' + lead.name + '. The owner was reminded.');
      } else {
        state.flags.escalated = true;
        run.log.push({ n: 1, t: state.now, ok: true, text: 'Escalated to a manager' });
        mail(MANAGER, 'ESCALATION: ' + lead.name + ' has waited 4 hours', 'escalate');
        say('bad', 'Four hours and still no reply to ' + lead.name + ', so a manager was told. This is how slow replies stop turning into lost customers.');
      }
      return;
    }
    if (run.kind === 'followup') {
      run.attempts = 1; run.nextAt = null;
      if (lead.replied) {
        run.status = 'cancelled'; run.log.push({ n: 1, t: state.now, ok: true, text: 'Customer had replied, so no follow-up was needed' });
        return;
      }
      run.status = 'succeeded';
      run.log.push({ n: 1, t: state.now, ok: true, text: 'Follow-up sent to the customer' });
      mail(lead.email, 'Following up on your enquiry', 'follow', true);
      var c = state.contacts.filter(function (x) { return x.leadId === lead.id; })[0];
      if (c) c.notes.unshift('Automatic follow-up sent');
      say('good', (lead.intent === 'ready' ? 'A day' : 'Two days') + ' passed with no reply, so a polite follow-up went to ' + lead.name + ' automatically.');
      return;
    }
    // webhook
    run.attempts += 1; run.status = 'running';
    var out = await deliver(run), verdict = classify(out.result);
    var entry = { n: run.attempts, t: state.now, sig: out.sig, ts: out.ts, ok: verdict === 'success', verdict: verdict, text: describe(out.result) };
    run.log.push(entry);
    if (verdict === 'success') {
      run.status = 'succeeded'; run.nextAt = null;
      if (run.attempts > 1) { state.flags.recovered = true; say('good', 'Attempt ' + run.attempts + ' got through. The lead is now in the CRM, and nobody had to notice or fix anything.'); }
      else say('good', 'The lead was sent to the CRM and a contact card appeared.');
    } else if (verdict === 'permanent') {
      run.status = 'dead'; run.nextAt = null;
      say('bad', 'The CRM said this address is gone for good (error ' + out.result.status + '). Trying again would not help, so the run stopped and you were alerted.');
      alertDead(run);
    } else if (run.attempts >= MAX_ATTEMPTS) {
      run.status = 'dead'; run.nextAt = null;
      say('bad', 'Six attempts failed. The run is marked dead and you were alerted. The lead is still safe in Assist Street.');
      alertDead(run);
    } else {
      var wait = BACKOFF_MIN[run.attempts - 1];
      run.status = 'failed'; run.nextAt = state.now + wait;
      if (run.attempts > 1) state.flags.retried = true;
      say('warn', 'Attempt ' + run.attempts + ' failed (' + entry.text.toLowerCase() + '). The next try is ' + fmtIn(wait) + '.');
      if (out.result.kind === 'timeout') say('info', 'Note: the CRM did save the lead, but answered too late. When we try again it will recognise the same ID and ignore the repeat.');
    }
  }
  function describe(r) {
    if (r.kind === 'network') return 'Could not connect';
    if (r.kind === 'timeout') return 'Timed out after 8 seconds';
    return 'HTTP ' + r.status + ' · ' + r.note;
  }
  function alertDead(run) {
    mail(OPERATOR + ', ' + OWNER, 'Alert: sending ' + run.event.lead.name + ' to the CRM failed', 'alert');
  }

  /* ---------------- scheduler ---------------- */
  var chain = Promise.resolve();
  function enqueue(fn) { chain = chain.then(fn).catch(function (e) { console.error(e); }); return chain; }
  function dueRuns(limit) {
    return state.runs.filter(function (r) { return (r.status === 'queued' || r.status === 'failed' || r.status === 'scheduled') && r.nextAt != null && r.nextAt <= limit; })
      .sort(function (a, b) { return a.nextAt - b.nextAt; });
  }
  async function advance(minutes) {
    var target = state.now + minutes;
    for (;;) {
      var due = dueRuns(target)[0];
      if (!due) break;
      if (due.nextAt > state.now) state.now = due.nextAt;
      await execute(due);
    }
    state.now = target;
    notify();
  }

  /* ---------------- actions ---------------- */
  async function submitLead(data) {
    var lead = { id: uid('lead'), name: data.name.trim(), email: data.email.trim(), message: data.message.trim(), replied: false, contacted: false,
      intent: data.intent || 'looking', lang: LANG[data.lang] ? data.lang : 'en', at: state.now };
    state.saved.unshift(lead);
    state.flags.sent = true;
    if (state.mode === 'down' || state.mode === 'error' || state.mode === 'gone' || state.mode === 'slow') state.flags.down = true;
    say('info', lead.name + ' sent an enquiry. It was saved in Assist Street first, so it can never be lost.');
    var evt = { id: 'evt_' + uid('').slice(1), at: state.now, lead: lead };
    var steps = plan(lead);
    steps.forEach(function (a) {
      state.runs.unshift({
        id: uid('run'), event: evt, automationId: a.id, automation: a.name, kind: a.kind, lead: lead,
        status: a.at > 0 ? 'scheduled' : 'queued', attempts: 0, nextAt: state.now + a.at, startedAt: state.now, log: []
      });
    });
    say('info', 'An event was recorded, and ' + steps.length + ' automations were set up for it' + (lead.intent === 'ready' ? ', including a hot-lead alert.' : lead.intent === 'person' ? ', including a needs-a-person alert.' : '.'));
    notify();
    await advance(0);
  }
  function markContacted(leadId) {
    var lead = state.saved.filter(function (l) { return l.id === leadId; })[0];
    if (!lead || lead.contacted) return;
    lead.contacted = true; lead.contactedAt = state.now;
    var c = state.contacts.filter(function (x) { return x.leadId === leadId; })[0];
    if (c) { if (c.stage === 'new') c.stage = 'contacted'; c.notes.unshift('Someone from the team contacted them'); }
    state.runs.forEach(function (r) {
      if (r.lead === lead && (r.kind === 'sla1' || r.kind === 'sla2') && r.status === 'scheduled') {
        r.status = 'cancelled'; r.nextAt = null; r.log.push({ n: 1, t: state.now, ok: true, text: 'Someone contacted them, so the reminder was cancelled' });
      }
    });
    say('good', 'Someone contacted ' + lead.name + ', so the reminder and the escalation were cancelled. Managers only hear about leads that are really waiting.');
    notify();
  }
  function customerReplied(leadId) {
    var lead = state.saved.filter(function (l) { return l.id === leadId; })[0];
    if (!lead || lead.replied) return;
    lead.replied = true; state.flags.replied = true;
    var c = state.contacts.filter(function (x) { return x.leadId === leadId; })[0];
    if (c) { c.stage = 'contacted'; c.notes.unshift('Customer replied'); }
    state.runs.forEach(function (r) {
      if (r.leadId === leadId || r.lead === lead) if (r.kind === 'followup' && r.status === 'scheduled') {
        r.status = 'cancelled'; r.nextAt = null; r.log.push({ n: 1, t: state.now, ok: true, text: 'Customer replied, so the follow-up was cancelled' });
      }
    });
    say('good', lead.name + ' replied, so the automatic follow-up was cancelled. Nobody gets chased after they have answered.');
    notify();
  }
  function retryNow(runId) {
    var r = state.runs.filter(function (x) { return x.id === runId; })[0];
    if (!r || (r.status !== 'dead' && r.status !== 'failed')) return;
    r.status = 'failed'; r.nextAt = state.now; r.attempts = Math.min(r.attempts, MAX_ATTEMPTS - 1);
    say('info', 'You asked for another attempt. Trying again now.');
    notify(); return enqueue(function () { return advance(0); });
  }
  /* ---------------- bookings and reminders ---------------- */
  var SLOTS = {
    h3: { label: 'Today, in 3 hours', at: function () { return state.now + 180; } },
    d1: { label: 'Tomorrow, 10:00', at: function () { return (Math.floor(state.now / DAY) + 1) * DAY + 600; } },
    d2: { label: 'In 2 days, 14:00', at: function () { return (Math.floor(state.now / DAY) + 2) * DAY + 840; } },
    d3: { label: 'In 3 days, 11:00', at: function () { return (Math.floor(state.now / DAY) + 3) * DAY + 660; } }
  };
  var BOOK_TEXT = {
    en: { confirm: function (s) { return 'Booked: ' + s; }, rem24: function (s) { return 'Reminder: your appointment is tomorrow, ' + s; }, rem1: function () { return 'Reminder: your appointment is in 1 hour'; }, noshow: function () { return 'We missed you today. Would you like to pick a new time?'; }, cancel: function () { return 'Your appointment was cancelled. Rebook any time'; } },
    es: { confirm: function (s) { return 'Reserva confirmada: ' + s; }, rem24: function (s) { return 'Recordatorio: tu cita es mañana, ' + s; }, rem1: function () { return 'Recordatorio: tu cita es dentro de 1 hora'; }, noshow: function () { return 'Te echamos de menos hoy. ¿Elegimos otra hora?'; }, cancel: function () { return 'Tu cita fue cancelada. Reserva de nuevo cuando quieras'; } },
    ar: { confirm: function (s) { return 'تم تأكيد الحجز: ' + s; }, rem24: function (s) { return 'تذكير: موعدك غدًا، ' + s; }, rem1: function () { return 'تذكير: موعدك بعد ساعة واحدة'; }, noshow: function () { return 'افتقدناك اليوم. هل نختار وقتًا جديدًا؟'; }, cancel: function () { return 'تم إلغاء موعدك. يمكنك الحجز مجددًا في أي وقت'; } }
  };
  function fmtSlot(m) { var h = Math.floor((m % DAY) / 60), mm = Math.floor(m % 60); return dayName(m) + ' Day ' + (Math.floor(m / DAY) + 1) + ' at ' + String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); }
  function bookingById(id) { return state.bookings.filter(function (b) { return b.id === id; })[0]; }
  function bookedAlready(lead) { return state.bookings.some(function (b) { return b.leadId === lead.id && b.status === 'booked'; }); }
  function cancelRun(r, text) { r.status = 'cancelled'; r.nextAt = null; r.log.push({ n: 1, t: state.now, ok: true, text: text }); }
  function pushBookingRun(b, kind, name, at) {
    state.runs.unshift({ id: uid('run'), event: { id: 'evt_booking', at: state.now, lead: b.lead }, kind: kind, automation: name, lead: b.lead, bookingId: b.id,
      status: at > state.now ? 'scheduled' : 'queued', attempts: 0, nextAt: Math.max(at, state.now), startedAt: state.now, log: [] });
  }
  function scheduleBookingRuns(b) {
    pushBookingRun(b, 'confirm', 'Confirm the booking (in ' + LANG[b.lead.lang].name + ')', state.now);
    if (b.at - 1440 > state.now) pushBookingRun(b, 'rem24', 'Reminder 24 hours before', b.at - 1440);
    else say('info', 'This appointment is less than 24 hours away, so there is no 24-hour reminder, only the 1-hour one.');
    if (b.at - 60 > state.now) pushBookingRun(b, 'rem1', 'Reminder 1 hour before', b.at - 60);
    pushBookingRun(b, 'noshow', 'No-show check (30 minutes after)', b.at + 30);
  }
  function cancelBookingRuns(b, text) {
    state.runs.forEach(function (r) { if (r.bookingId === b.id && (r.status === 'scheduled' || r.status === 'queued')) cancelRun(r, text); });
  }
  async function createBooking(leadId, slotKey) {
    var lead = state.saved.filter(function (l) { return l.id === leadId; })[0];
    if (!lead || !SLOTS[slotKey] || bookedAlready(lead)) return;
    var b = { id: uid('bk'), leadId: lead.id, lead: lead, at: SLOTS[slotKey].at(), status: 'booked', moved: 0 };
    state.bookings.unshift(b); state.flags.booking = true;
    state.runs.forEach(function (r) { if (r.lead === lead && r.kind === 'followup' && r.status === 'scheduled') cancelRun(r, 'They booked, so no follow-up is needed'); });
    if (!lead.contacted) {
      lead.contacted = true; lead.contactedAt = state.now;
      state.runs.forEach(function (r) { if (r.lead === lead && (r.kind === 'sla1' || r.kind === 'sla2') && r.status === 'scheduled') cancelRun(r, 'They booked, so no reminder is needed'); });
    }
    var c = state.contacts.filter(function (x) { return x.leadId === lead.id; })[0];
    if (c) { c.stage = 'booked'; c.notes.unshift('Booked: ' + fmtSlot(b.at)); }
    scheduleBookingRuns(b);
    notify();
    await advance(0);
  }
  function markAttended(bookingId) {
    var b = bookingById(bookingId); if (!b || b.status !== 'booked' || state.now < b.at) return;
    b.status = 'attended'; state.flags.attended = true;
    var c = state.contacts.filter(function (x) { return x.leadId === b.leadId; })[0]; if (c) c.notes.unshift('Attended the appointment');
    state.runs.forEach(function (r) { if (r.bookingId === b.id && r.kind === 'noshow' && r.status === 'scheduled') cancelRun(r, 'They attended, so no follow-up was needed'); });
    say('good', b.lead.name + ' attended, so the no-show check was cancelled. Nobody is chased for turning up.');
    notify();
  }
  async function rescheduleBooking(bookingId, slotKey) {
    var b = bookingById(bookingId); if (!b || b.status !== 'booked' || !SLOTS[slotKey]) return;
    cancelBookingRuns(b, 'The appointment was moved, so the old reminder was cancelled');
    b.at = SLOTS[slotKey].at(); b.moved += 1; state.flags.moved = true;
    var c = state.contacts.filter(function (x) { return x.leadId === b.leadId; })[0]; if (c) c.notes.unshift('Moved to ' + fmtSlot(b.at));
    say('info', b.lead.name + ' moved the appointment to ' + fmtSlot(b.at) + '. The old reminders were cancelled and new ones scheduled, so nobody gets reminded about the wrong time.');
    scheduleBookingRuns(b); notify(); await advance(0);
  }
  async function cancelBooking(bookingId) {
    var b = bookingById(bookingId); if (!b || b.status !== 'booked') return;
    b.status = 'cancelled'; cancelBookingRuns(b, 'The appointment was cancelled, so this was cancelled too');
    var c = state.contacts.filter(function (x) { return x.leadId === b.leadId; })[0]; if (c) { c.stage = 'contacted'; c.notes.unshift('Appointment cancelled'); }
    mail(b.lead.email, BOOK_TEXT[b.lead.lang].cancel(), 'follow', true);
    say('warn', b.lead.name + ' cancelled. The reminders were cancelled, and a message offering to rebook was sent.');
    notify();
  }

  /* ---------------- invoices and payment reminders (the system never touches the money) ---------------- */
  var INV_TEXT = {
    en: { send: function (n, a, d) { return 'Invoice ' + n + ': ' + a + ' due ' + d; }, pre: function (n, a) { return 'Friendly reminder: invoice ' + n + ' (' + a + ') is due in 3 days'; }, due: function (n, a) { return 'Invoice ' + n + ' (' + a + ') is due today'; }, od7: function (n, a) { return 'Overdue: invoice ' + n + ', ' + a + ' was due 7 days ago'; }, od14: function (n, a) { return 'Final reminder: invoice ' + n + ' (' + a + ') is 14 days overdue'; }, paid: function (n) { return 'Thank you: payment received for ' + n; }, newdate: function (n, d) { return 'Invoice ' + n + ': new due date ' + d; } },
    es: { send: function (n, a, d) { return 'Factura ' + n + ': ' + a + ', vence ' + d; }, pre: function (n, a) { return 'Recordatorio amistoso: la factura ' + n + ' (' + a + ') vence en 3 días'; }, due: function (n, a) { return 'La factura ' + n + ' (' + a + ') vence hoy'; }, od7: function (n, a) { return 'Vencida: la factura ' + n + ', ' + a + ', venció hace 7 días'; }, od14: function (n, a) { return 'Último aviso: la factura ' + n + ' (' + a + ') lleva 14 días vencida'; }, paid: function (n) { return 'Gracias: pago recibido de ' + n; }, newdate: function (n, d) { return 'Factura ' + n + ': nueva fecha de vencimiento ' + d; } },
    ar: { send: function (n, a, d) { return 'فاتورة ' + n + ': ' + a + '، تستحق ' + d; }, pre: function (n, a) { return 'تذكير ودّي: الفاتورة ' + n + ' (' + a + ') تستحق بعد 3 أيام'; }, due: function (n, a) { return 'الفاتورة ' + n + ' (' + a + ') تستحق اليوم'; }, od7: function (n, a) { return 'متأخرة: الفاتورة ' + n + '، ' + a + '، استحقت قبل 7 أيام'; }, od14: function (n, a) { return 'تذكير أخير: الفاتورة ' + n + ' (' + a + ') متأخرة منذ 14 يومًا'; }, paid: function (n) { return 'شكرًا: تم استلام دفعة ' + n; }, newdate: function (n, d) { return 'الفاتورة ' + n + ': موعد استحقاق جديد ' + d; } }
  };
  function money(n) { return '£' + Number(n).toLocaleString('en-GB'); }
  function fmtDue(m) { return dayName(m) + ' Day ' + (Math.floor(m / DAY) + 1); }
  function invoiceById(id) { return state.invoices.filter(function (i) { return i.id === id; })[0]; }
  function isOverdue(i) { return i.status === 'sent' && state.now > i.dueAt && i.amount - i.paid > 0; }
  function pushInvoiceRun(inv, kind, name, at) {
    state.runs.unshift({ id: uid('run'), event: { id: 'evt_invoice', at: state.now, lead: inv.lead }, kind: kind, automation: name, lead: inv.lead, invoiceId: inv.id,
      status: at > state.now ? 'scheduled' : 'queued', attempts: 0, nextAt: Math.max(at, state.now), startedAt: state.now, log: [] });
  }
  function scheduleReminders(inv) {
    if (inv.dueAt - 3 * DAY > state.now) pushInvoiceRun(inv, 'inv_pre', 'Friendly heads-up, 3 days before due', inv.dueAt - 3 * DAY);
    if (inv.dueAt > state.now) pushInvoiceRun(inv, 'inv_due', 'Reminder on the due date', inv.dueAt);
    pushInvoiceRun(inv, 'inv_od7', 'Overdue reminder (7 days) and tell the owner', inv.dueAt + 7 * DAY);
    pushInvoiceRun(inv, 'inv_od14', 'Final notice (14 days) and ask the owner to call', inv.dueAt + 14 * DAY);
  }
  function stopInvoiceRuns(inv, text) { state.runs.forEach(function (r) { if (r.invoiceId === inv.id && r.kind !== 'inv_send' && (r.status === 'scheduled' || r.status === 'queued')) cancelRun(r, text); }); }
  async function createInvoice(d) {
    var lead = state.saved.filter(function (l) { return l.id === d.leadId; })[0], amount = Math.round(Number(d.amount));
    if (!lead || !(amount > 0) || !(Number(d.days) > 0)) return;
    state.invNo += 1;
    var inv = { id: uid('inv'), number: 'INV-' + String(state.invNo).padStart(3, '0'), leadId: lead.id, lead: lead, desc: (d.desc || 'Services').trim() || 'Services', amount: amount, paid: 0, issuedAt: state.now, dueAt: state.now + Number(d.days) * DAY, status: 'sent', reminders: 0, atRisk: false, extended: 0 };
    state.invoices.unshift(inv); state.flags.invoice = true;
    pushInvoiceRun(inv, 'inv_send', 'Send invoice ' + inv.number + ' (in ' + LANG[lead.lang].name + ')', state.now);
    scheduleReminders(inv);
    notify(); await advance(0);
  }
  function recordPayment(invoiceId, part) {
    var inv = invoiceById(invoiceId); if (!inv || inv.status !== 'sent') return;
    var left = inv.amount - inv.paid, pay = part ? Math.max(1, Math.floor(left / 2)) : left;
    inv.paid += pay; (inv.payments = inv.payments || []).push({ t: state.now, amount: pay }); state.flags.paidInv = true;
    var cnote = state.contacts.filter(function (x) { return x.leadId === inv.leadId; })[0];
    if (inv.paid >= inv.amount) {
      inv.status = 'paid'; inv.paidAt = state.now; stopInvoiceRuns(inv, 'It was paid, so the reminder was cancelled');
      mail(inv.lead.email, INV_TEXT[inv.lead.lang].paid(inv.number), 'book'); mail(OWNER, 'Paid: ' + inv.lead.name + ' paid ' + inv.number + ' (' + money(inv.amount) + ')', 'info');
      if (cnote) cnote.notes.unshift('Invoice ' + inv.number + ' paid in full');
      say('good', inv.lead.name + ' paid ' + inv.number + ' in full. A thank-you went out, the remaining reminders were cancelled, and the owner was told. Nobody gets chased for money they have already paid.');
    } else {
      if (cnote) cnote.notes.unshift('Part payment of ' + money(pay) + ' on ' + inv.number);
      say('info', inv.lead.name + ' paid ' + money(pay) + ' of ' + money(inv.amount) + '. The reminders continue, but now ask only for the ' + money(inv.amount - inv.paid) + ' that is left.');
    }
    notify();
  }
  async function extendInvoice(invoiceId, days) {
    var inv = invoiceById(invoiceId); if (!inv || inv.status !== 'sent') return;
    stopInvoiceRuns(inv, 'The due date moved, so this reminder was replaced');
    inv.dueAt += days * DAY; inv.extended += days; inv.atRisk = false; state.flags.extended = true;
    mail(inv.lead.email, INV_TEXT[inv.lead.lang].newdate(inv.number, fmtDue(inv.dueAt)), 'invoice', 'a payment link');
    scheduleReminders(inv);
    say('info', inv.lead.name + ' asked for more time, so the due date moved to ' + fmtDue(inv.dueAt) + '. The old reminders were cancelled and new ones scheduled around the new date.');
    notify(); await advance(0);
  }
  function voidInvoice(invoiceId) {
    var inv = invoiceById(invoiceId); if (!inv || inv.status !== 'sent') return;
    inv.status = 'void'; stopInvoiceRuns(inv, 'The invoice was cancelled, so this reminder was cancelled');
    say('warn', inv.number + ' was cancelled, so all its reminders stopped.'); notify();
  }

  /* a made-up week: [minutes after start, name, email, intent, language, message, contacted after, booked after] */
  var WEEK_SCRIPT = [
    [0, 'Ana Torres', 'ana.t@example.com', 'looking', 'en', 'What are your opening hours?', 25, null],
    [90, 'Marco Bianchi', 'marco.b@example.com', 'ready', 'es', 'Quiero reservar el curso de marzo', 10, 120],
    [300, 'Priya Nair', 'priya.n@example.com', 'looking', 'en', 'Do you offer evening classes?', 200, null],
    [1470, 'Chen Wei', 'chen.w@example.com', 'ready', 'en', 'I would like to book a place', 15, 300],
    [1680, 'Fatima Hassan', 'fatima.h@example.com', 'person', 'ar', 'I need to discuss my visa situation', 50, null],
    [2940, 'Lars Berg', 'lars.b@example.com', 'looking', 'en', 'How much is the IELTS course?', null, null],
    [3210, 'Sofia Rossi', 'sofia.r@example.com', 'ready', 'es', 'Hay plazas disponibles el lunes?', 20, 1000],
    [4420, 'Tom Reed', 'tom.r@example.com', 'looking', 'en', 'Just checking prices', 400, null],
    [5810, 'Ivy Chan', 'ivy.c@example.com', 'looking', 'en', 'Can I visit before I decide?', 30, null],
    [6160, 'Raj Patel', 'raj.p@example.com', 'ready', 'en', 'Ready to sign up today', 5, 200],
    [7400, 'Nora Alvarez', 'nora.a@example.com', 'person', 'es', 'Necesito hablar con alguien', 150, null],
    [8760, 'Ben Walker', 'ben.w@example.com', 'looking', 'en', 'What is the deposit?', null, null],
    [8940, 'Zoe Martin', 'zoe.m@example.com', 'looking', 'en', 'Is there a student discount?', 45, null]
  ];
  async function simulateWeek() {
    var start = state.now, acts = [];
    say('info', 'Simulating a week of made-up activity: 13 enquiries, replies at different speeds, and a four-hour CRM outage on day 3.');
    WEEK_SCRIPT.forEach(function (s) {
      acts.push({ t: s[0], kind: 'lead', s: s });
      if (s[6] != null) acts.push({ t: s[0] + s[6], kind: 'contact', email: s[2] });
      if (s[7] != null) acts.push({ t: s[0] + s[7], kind: 'book', email: s[2] });
    });
    acts.push({ t: 2 * DAY + 300, kind: 'mode', mode: 'down' }, { t: 2 * DAY + 560, kind: 'mode', mode: 'up' });
    acts.sort(function (a, b) { return a.t - b.t; });
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i], gap = start + a.t - state.now;
      if (gap > 0) await advance(gap);
      var lead = state.saved.filter(function (l) { return l.email === a.email; })[0];
      if (a.kind === 'lead') await submitLead({ name: a.s[1], email: a.s[2], intent: a.s[3], lang: a.s[4], message: a.s[5] });
      else if (a.kind === 'contact' && lead) markContacted(lead.id);
      else if (a.kind === 'book' && lead) { var c = state.contacts.filter(function (x) { return x.leadId === lead.id; })[0]; if (c) moveStage(c.id, 'booked'); }
      else if (a.kind === 'mode') setMode(a.mode);
    }
    var rest = start + WEEK - state.now;
    if (rest > 0) await advance(rest);
    notify();
  }
  function reset() { return enqueue(function () { state = fresh(); notify(); }); }
  function moveStage(contactId, stage) {
    var c = state.contacts.filter(function (x) { return x.id === contactId; })[0];
    if (c) { c.stage = stage; if (stage === 'booked') markContacted(c.leadId); notify(); }
  }
  function setMode(mode) {
    state.mode = mode; notify();
    var t = { up: 'The CRM is working again.', error: 'The CRM now returns server errors.', down: 'The CRM can no longer be reached.', slow: 'The CRM now saves things but answers too slowly.', gone: 'The CRM address no longer exists.' };
    say(mode === 'up' ? 'good' : 'warn', t[mode]);
    notify();
  }


  /* ---------------- self test (also used by automated checks) ---------------- */
  async function selfTest() {
    var out = [];
    function check(name, ok) { out.push({ name: name, ok: !!ok }); }
    check('HMAC-SHA256 matches a known vector', await hmacHex('key', 'The quick brown fox jumps over the lazy dog') === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    check('2xx is success', classify({ kind: 'http', status: 200 }) === 'success');
    check('500 is temporary', classify({ kind: 'http', status: 500 }) === 'retry');
    check('429 and 408 are temporary', classify({ kind: 'http', status: 429 }) === 'retry' && classify({ kind: 'http', status: 408 }) === 'retry');
    check('410 and 404 are permanent', classify({ kind: 'http', status: 410 }) === 'permanent' && classify({ kind: 'http', status: 404 }) === 'permanent');
    check('timeout and network errors are temporary', classify({ kind: 'timeout' }) === 'retry' && classify({ kind: 'network' }) === 'retry');
    check('six attempts in total', MAX_ATTEMPTS === 6);
    return out;
  }

    /* ---------------- small actions the screens share ---------------- */
    function skip(minutes) {
      say('info', 'Time machine: skipped ahead ' + (minutes >= WEEK ? 'one week' : minutes >= DAY ? 'one day' : minutes >= 60 ? 'one hour' : minutes + ' minutes') + '.');
      return enqueue(function () { return advance(minutes); });
    }
    function skipToNextReport() {
      var w = state.runs.filter(function (r) { return r.kind === 'weekly'; })[0];
      if (w) return enqueue(function () { return advance(Math.max(0, w.nextAt - state.now)); });
    }
    function previewReport() { state.preview = buildReport(state.now + 1); notify(); }
    function sendReportNow() { return enqueue(function () { sendReport(buildReport(state.now + 1)); say('good', 'You asked for it, so this week so far was emailed to the owner.'); notify(); }); }
    function toggleOpen(runId) { state.open[runId] = !state.open[runId]; notify(); }
    function q(fn) { return function () { var a = arguments; return enqueue(function () { return fn.apply(null, a); }); }; }

    return {
      get state() { return state; },
      config: { owner: OWNER, manager: MANAGER, operator: OPERATOR },
      onChange: function (fn) { listeners.push(fn); },
      idle: function () { return chain; },
      enqueue: enqueue,
      // queued actions (they run one at a time, in order)
      submitLead: q(submitLead), advance: q(advance), reset: reset, simulateWeek: q(simulateWeek),
      createBooking: q(createBooking), rescheduleBooking: q(rescheduleBooking), cancelBooking: q(cancelBooking),
      createInvoice: q(createInvoice), extendInvoice: q(extendInvoice),
      skip: skip, skipToNextReport: skipToNextReport, sendReportNow: sendReportNow,
      // quick actions
      setMode: setMode, markContacted: markContacted, customerReplied: customerReplied, retryNow: retryNow, moveStage: moveStage,
      markAttended: markAttended, recordPayment: recordPayment, voidInvoice: voidInvoice, previewReport: previewReport, toggleOpen: toggleOpen,
      // reading
      buildReport: buildReport, highlights: highlights, selfTest: selfTest,
      fmt: { fmtTime: fmtTime, fmtIn: fmtIn, fmtDur: fmtDur, fmtSlot: fmtSlot, fmtDue: fmtDue, money: money, dayName: dayName },
      helpers: { bookedAlready: bookedAlready, isOverdue: isOverdue, bookingById: bookingById, invoiceById: invoiceById },
      consts: { DAY: DAY, WEEK: WEEK, MAX_ATTEMPTS: MAX_ATTEMPTS, BACKOFF_MIN: BACKOFF_MIN, FIRST_WEEKLY: FIRST_WEEKLY },
      LANG: LANG, SLOTS: SLOTS, say: say
    };
  }

  global.AssistEngine = { create: create };
})(window);
