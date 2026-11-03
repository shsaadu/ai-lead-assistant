/**
 * Paperwork screen: documents arrive, are read and checked, and are filed, held or sent to a person.
 * Shows the document with each field highlighted where it was read, how sure the reader was,
 * every check it ran, and what the practice can do next. Used in the Automation Lab and in the
 * practice's back office. Needs DocReader, DocSamples and an AssistEngine instance.
 *
 *   DocsView.mount(element, engine, { theme: 'dark' | 'light' });
 */
(function (global) {
  'use strict';

  var STATUS = { reading: ['Reading', 'busy'], filed: ['Filed', 'good'], approval: ['Needs the manager', 'warn'], review: ['Needs a person', 'warn'], held: ['Held', 'bad'], duplicate: ['Duplicate', 'mute'], rejected: ['Rejected', 'mute'] };
  var EDITABLE = { supplier: 'text', invoiceNo: 'text', net: 'money', vat: 'money', gross: 'money', name: 'text', email: 'text', guardian: 'text', consent: 'consent' };
  var ICON = { supplier_invoice: '£', patient_form: '✚', unknown: '?' };

  function esc(v) { var d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; }

  function mount(root, E, opts) {
    opts = opts || {};
    var R = global.DocReader, SAMPLES = global.DocSamples || [], selected = '', painted = {}, DAY = E.consts.DAY;
    root.classList.add('dx', opts.theme === 'light' ? 'dx-light' : 'dx-dark');
    root.innerHTML =
      '<div class="dx-section"><div class="dx-h"><b>1 · The inbox</b><span>Pick a document to send. In real life these arrive as email attachments or scans.</span></div><div class="dx-samples" id="dx-samples"></div>' +
      '<details class="dx-own"><summary>Or try your own text</summary><div class="dx-own-in"><label>Name<input id="dx-own-name" type="text" maxlength="60" value="My document"></label><label>Text<textarea id="dx-own-text" rows="6" maxlength="4000" placeholder="Paste or type a made-up invoice or registration form"></textarea></label>' +
      '<p class="dx-fine">Use made-up text only. It is read in your browser and goes nowhere.</p><button class="dx-btn" type="button" data-act="send-own">Send it to the inbox</button></div></details></div>' +
      '<div class="dx-section"><div class="dx-h"><b>2 · What the system did</b><span id="dx-count"></span></div><div class="dx-list" id="dx-list"></div><div id="dx-detail"></div></div>' +
      '<div class="dx-cols"><div class="dx-section"><div class="dx-h"><b>3 · Bills to pay</b><span>The system reminds. The practice pays from its own bank.</span></div><div id="dx-bills"></div></div>' +
      '<div class="dx-section"><div class="dx-h"><b>4 · New patients registered</b><span>Medical details are flagged, never shown in logs or emails.</span></div><div id="dx-regs"></div>' +
      '<details class="dx-sup"><summary>Supplier list the checks compare with</summary><div id="dx-sups"></div></details></div></div>';
    var $ = function (id) { return root.querySelector('#' + id); };
    function paint(id, html) { var el = $(id); if (painted[id] !== html) { painted[id] = html; el.innerHTML = html; } }
    function docs() { return E.state.docs; }
    function current() { var d = docs().filter(function (x) { return x.id === selected; })[0]; return d || docs()[0] || null; }
    function pill(status) { var s = STATUS[status] || [status, 'mute']; return '<span class="dx-pill dx-' + s[1] + '">' + esc(s[0]) + '</span>'; }

    /* ---------- the inbox ---------- */
    function samplesHtml() {
      var sent = {}; docs().forEach(function (d) { if (d.sample) sent[d.sample] = (sent[d.sample] || 0) + 1; });
      return SAMPLES.map(function (s) {
        return '<button type="button" class="dx-sample" data-act="send-sample" data-id="' + esc(s.id) + '"><span class="dx-ico">' + (s.kind === 'form' ? ICON.patient_form : ICON.supplier_invoice) + '</span><span class="dx-st"><b>' + esc(s.title) + '</b><small>' + esc(s.blurb) + '</small></span>' +
          (sent[s.id] ? '<span class="dx-sent">Sent' + (sent[s.id] > 1 ? ' ×' + sent[s.id] : '') + '</span>' : '') + '</button>';
      }).join('');
    }

    /* ---------- the document, with each field highlighted where it was read ---------- */
    function paperHtml(d) {
      var keys = d.order || [], spans = [];
      keys.forEach(function (k, i) { var f = d.fields[k]; if (f && f.value != null && f.s >= 0 && f.e > f.s) spans.push({ s: f.s, e: f.e, k: k, c: i % 9 }); });
      spans.sort(function (a, b) { return a.s - b.s; });
      var out = '', pos = 0;
      spans.forEach(function (sp) { if (sp.s < pos) return; out += esc(d.text.slice(pos, sp.s)) + '<mark class="dx-m dx-c' + sp.c + '" data-k="' + esc(sp.k) + '">' + esc(d.text.slice(sp.s, sp.e)) + '</mark>'; pos = sp.e; });
      return out + esc(d.text.slice(pos));
    }
    function colorOf(d, k) { var i = (d.order || []).indexOf(k); return i < 0 ? 0 : i % 9; }

    function confBar(f) {
      if (f.value == null) return '<span class="dx-conf dx-none">not found</span>';
      var pct = Math.round(f.conf * 100), cls = f.conf >= R.SURE ? 'dx-hi' : 'dx-lo';
      return '<span class="dx-conf ' + cls + '"><i style="width:' + pct + '%"></i></span><em>' + pct + '%</em>';
    }
    function fieldRow(d, k, canEdit) {
      var f = d.fields[k]; if (!f) return '';
      var kind = EDITABLE[k], shown = f.display == null ? '' : f.display, med = d.type === 'patient_form' && (k === 'allergies' || k === 'conditions');
      var cell;
      if (med) cell = '<span class="dx-med">' + (f.value && !/^(none|no|nil)$/i.test(String(f.value)) ? 'Recorded: flagged on the record' : 'None declared') + '</span>';
      else if (canEdit && kind === 'consent') cell = '<select class="dx-in" data-edit="consent"><option value="true"' + (f.value === true ? ' selected' : '') + '>Ticked</option><option value="false"' + (f.value === false ? ' selected' : '') + '>Not ticked</option></select>';
      else if (canEdit && kind) cell = '<input class="dx-in" data-edit="' + k + '" data-kind="' + kind + '" value="' + esc(kind === 'money' && f.value != null ? f.value.toFixed(2) : shown) + '" placeholder="Type it in">';
      else cell = esc(shown) || '<em class="dx-miss">missing</em>';
      return '<tr data-k="' + k + '"><th scope="row"><i class="dx-sw dx-c' + colorOf(d, k) + '"></i>' + esc(f.label) + '</th><td>' + cell + (f.note ? '<small class="dx-note">' + esc(f.note) + '</small>' : '') + '</td><td class="dx-cf">' + (med ? '' : confBar(f)) + '</td></tr>';
    }
    function actionsHtml(d) {
      var b = function (act, label, cls) { return '<button type="button" class="dx-btn ' + (cls || '') + '" data-act="' + act + '">' + label + '</button>'; };
      if (d.status === 'approval') return b('approve', 'Approve it (manager)', 'dx-go') + b('reject', 'Reject');
      if (d.status === 'held' && d.type === 'supplier_invoice') return b('confirm-bank', 'I phoned the supplier: the new account is genuine', 'dx-go') + b('reject', 'It is a fraud attempt: reject it');
      if (d.status === 'held') return b('save', 'The patient has now ticked it: check again', 'dx-go') + b('reject', 'Reject');
      if (d.status === 'review') return b('save', 'Save my corrections and check again', 'dx-go') + b('approve', 'I have checked it myself: approve as it is') + b('reject', 'Reject');
      return '';
    }
    function detailHtml(d) {
      if (!d) return '<p class="dx-empty">Nothing yet. Send a document above and watch it being read and checked.</p>';
      var o = d.outcome, canEdit = d.type !== 'unknown' && (d.status === 'review' || (d.status === 'held' && d.type === 'patient_form'));
      var tone = (STATUS[d.status] || [0, 'mute'])[1];
      var rows = (d.order || []).map(function (k) { return fieldRow(d, k, canEdit); }).join('');
      var checks = (d.checks || []).map(function (c) {
        var ico = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : c.status === 'warn' ? '!' : 'i';
        return '<li class="dx-ck dx-' + c.status + '"><span class="dx-ci" aria-hidden="true">' + ico + '</span><div><b>' + esc(c.label) + '</b><small>' + esc(c.detail) + '</small></div></li>';
      }).join('');
      var hist = (d.history || []).slice().reverse().slice(0, 6).map(function (h) { return '<li>' + esc(h.text) + '</li>'; }).join('');
      return '<div class="dx-detail dx-t-' + tone + '"><div class="dx-banner dx-b-' + tone + '"><div><span class="dx-kind">' + esc(d.type ? R.TYPE_NAME[d.type] : 'Document') + ' · from ' + esc(d.from) + '</span><b>' + esc(o ? o.headline : 'Reading…') + '</b>' + (o && o.why ? '<small>' + esc(o.why) + '</small>' : '') + '</div>' + pill(d.status) + '</div>' +
        '<div class="dx-grid"><div class="dx-paperwrap"><div class="dx-cap">The document <small>Colours show where each field was read</small></div><pre class="dx-paper">' + paperHtml(d) + '</pre></div>' +
        '<div class="dx-result"><div class="dx-cap">What was read <small>and how sure the reader is</small></div>' + (rows ? '<table class="dx-fields"><tbody>' + rows + '</tbody></table>' : '') +
        '<div class="dx-cap dx-cap2">The checks <small>a careful person would make the same ones</small></div><ul class="dx-checks">' + checks + '</ul>' +
        (actionsHtml(d) ? '<div class="dx-actions">' + actionsHtml(d) + '</div>' : '') + (hist ? '<details class="dx-hist"><summary>What happened</summary><ul>' + hist + '</ul></details>' : '') + '</div></div></div>';
    }
    function listHtml() {
      return docs().map(function (d, i) { var cur = current(); return '<button type="button" class="dx-row' + (cur && cur.id === d.id ? ' on' : '') + '" data-act="select" data-id="' + esc(d.id) + '"><span class="dx-ico">' + (ICON[d.type] || ICON.unknown) + '</span><span class="dx-rn">' + esc(d.name) + '</span>' + pill(d.status) + '</button>'; }).join('');
    }
    function billsHtml() {
      var bills = E.state.bills, now = E.state.now;
      if (!bills.length) return '<p class="dx-empty">No bills yet. A filed invoice becomes a bill, with reminders.</p>';
      return '<ul class="dx-bills">' + bills.map(function (b) {
        var late = E.helpers.isBillLate(b), left = Math.ceil((b.dueAt - now) / DAY), st = b.status === 'paid' ? ['Paid', 'good'] : late ? ['Overdue', 'bad'] : left <= 0 ? ['Due today', 'warn'] : ['Due in ' + left + ' day' + (left === 1 ? '' : 's'), 'mute'];
        return '<li><div><b>' + esc(b.supplier) + '</b><small>' + esc(b.number) + ' · due ' + esc(R.dateFromDay(R.dayAt(b.dueAt))) + '</small></div><div class="dx-amt">' + esc(R.pounds(b.amount)) + '</div><span class="dx-pill dx-' + st[1] + '">' + esc(st[0]) + '</span>' +
          (b.status === 'to_pay' ? '<button type="button" class="dx-btn dx-sm" data-act="paid" data-id="' + esc(b.id) + '">We paid it</button>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    function regsHtml() {
      var regs = E.state.regs;
      if (!regs.length) return '<p class="dx-empty">No patients registered from forms yet.</p>';
      return '<ul class="dx-bills">' + regs.map(function (r) { return '<li><div><b>' + esc(r.name) + '</b><small>Born ' + esc(r.dob) + '</small></div>' + (r.alert ? '<span class="dx-pill dx-warn">Medical alert</span>' : '<span></span>') + '<span class="dx-pill dx-good">Registered</span></li>'; }).join('') + '</ul>';
    }
    function supsHtml() {
      return '<ul class="dx-sups">' + E.state.suppliers.map(function (s) { return '<li><b>' + esc(s.name) + '</b><small>' + (s.sort ? esc(s.sort + ' / ' + s.acct) : 'Direct Debit') + '</small></li>'; }).join('') + '</ul>';
    }

    function render() {
      var d = current();
      paint('dx-samples', samplesHtml());
      paint('dx-list', listHtml());
      $('dx-count').textContent = docs().length ? docs().length + ' document' + (docs().length === 1 ? '' : 's') + ' so far' : '';
      paint('dx-detail', detailHtml(d));
      paint('dx-bills', billsHtml()); paint('dx-regs', regsHtml()); paint('dx-sups', supsHtml());
    }

    /* ---------- clicks ---------- */
    function pickSelected(after) { return E.idle().then(function () { var d = docs()[0]; if (d && (!after || d.at >= 0)) selected = d.id; painted['dx-detail'] = null; painted['dx-list'] = null; render(); }); }
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]'); if (!t) return;
      var act = t.dataset.act, d = current();
      if (act === 'send-sample') { var s = SAMPLES.filter(function (x) { return x.id === t.dataset.id; })[0]; if (s) { E.receiveDocument({ name: s.name, from: s.from, text: s.text, sample: s.id }); pickSelected(); } }
      else if (act === 'send-own') { var tx = $('dx-own-text').value; if (tx.trim()) { E.receiveDocument({ name: $('dx-own-name').value || 'My document', from: 'you', text: tx }); pickSelected(); } }
      else if (act === 'select') { selected = t.dataset.id; painted['dx-detail'] = null; render(); }
      else if (act === 'approve' && d) E.approveDoc(d.id, 'Checked by hand');
      else if (act === 'reject' && d) E.rejectDoc(d.id);
      else if (act === 'confirm-bank' && d) E.confirmBank(d.id);
      else if (act === 'paid') E.markBillPaid(t.dataset.id);
      else if (act === 'save' && d) {
        var patch = {};
        root.querySelectorAll('[data-edit]').forEach(function (inp) {
          var k = inp.dataset.edit, f = d.fields[k]; if (!f) return; var v = inp.value;
          if (k === 'consent') { var b = v === 'true'; if (b !== f.value) patch[k] = b; return; }
          if (inp.dataset.kind === 'money') { var n = parseFloat(String(v).replace(/[£,\s]/g, '')); if (!isNaN(n) && Math.abs(n - (f.value == null ? NaN : f.value)) > 0.004) patch[k] = Math.round(n * 100) / 100; return; }
          if (String(v).trim() !== String(f.display == null ? '' : f.display).trim()) patch[k] = v.trim();
        });
        if (d.type === 'patient_form' && d.status === 'held' && d.fields.consent && d.fields.consent.value !== true && !('consent' in patch)) patch.consent = true;
        E.correctDoc(d.id, patch);
      }
    });
    // hovering a field lights up where it was read on the document
    root.addEventListener('mouseover', function (e) {
      var tr = e.target.closest('tr[data-k]'), on = root.querySelector('.dx-m.dx-on'); if (on) on.classList.remove('dx-on');
      if (tr) { var m = root.querySelector('.dx-m[data-k="' + tr.dataset.k + '"]'); if (m) m.classList.add('dx-on'); }
    });
    E.onChange(render); render();
    return { select: function (id) { selected = id; painted['dx-detail'] = null; render(); } };
  }

  global.DocsView = { mount: mount };
})(window);
