/**
 * Assist Street document reader.
 * Reads the text of a document (a supplier invoice, a new-patient form), says what it is, pulls out the
 * fields with a confidence for each, and runs the checks a careful person would run before filing it:
 * do the totals add up, have we seen it before, is the supplier known, did the bank details change.
 *
 * This demo reads TEXT with fixed rules, in the browser. Nothing is uploaded anywhere. A real build adds
 * an OCR step for scans and photos (and optionally an AI model for messy layouts) in front of the very
 * same checks, and keeps a person in the loop for anything the checks cannot settle.
 *
 * Calendar: simulated Day 1 is Monday 2 November 2026, so documents can carry real-looking dates.
 */
(function (global) {
  'use strict';

  var DAY = 1440;
  var EPOCH = Date.UTC(2026, 10, 2);               // Day 1
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var SURE = 0.75;           // below this a field needs a person to confirm it
  var APPROVAL_LIMIT = 500;  // invoices above this need the manager's OK

  /** The practice's list of suppliers it already pays, with the bank details it holds for each. */
  var DEFAULT_SUPPLIERS = [
    { name: 'Mercer Dental Supplies', sort: '60-12-34', acct: '22334455', terms: 30 },
    { name: 'Brightsmile Dental Lab', sort: '20-45-67', acct: '40981234', terms: 30 },
    { name: 'Eastlight Energy', sort: '', acct: '', terms: 21 },
    { name: 'Clearwater Clinical Waste', sort: '30-90-12', acct: '11223344', terms: 30 }
  ];
  var TYPE_NAME = { supplier_invoice: 'Supplier invoice', patient_form: 'New-patient form', unknown: 'Unknown document' };

  /* ---------------- small helpers ---------------- */
  function clean(text) { return String(text == null ? '' : text).replace(/\r/g, '').replace(/\t/g, '  '); }
  function lines(text) { var out = [], pos = 0; text.split('\n').forEach(function (t) { out.push({ t: t, s: pos }); pos += t.length + 1; }); return out; }
  function pounds(n) { if (n == null || isNaN(n)) return '–'; var neg = n < 0, v = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (neg ? '-' : '') + '£' + v; }
  function dayFromDate(y, m, d) { return Math.round((Date.UTC(y, m, d) - EPOCH) / 864e5) + 1; }
  function dateFromDay(n) { var d = new Date(EPOCH + (n - 1) * 864e5); return WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function dayAt(minutes) { return Math.floor(minutes / DAY) + 1; }
  function minutesFor(day) { return (day - 1) * DAY + 9 * 60; }

  var DATE_RES = [/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/, /(\d{1,2})\/(\d{1,2})\/(\d{4})/];
  function parseDate(str) {
    var m = DATE_RES[0].exec(str);
    if (m) { var mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (mi >= 0) return { y: +m[3], m: mi, d: +m[1], day: dayFromDate(+m[3], mi, +m[1]) }; }
    m = DATE_RES[1].exec(str);
    if (m && +m[2] >= 1 && +m[2] <= 12) return { y: +m[3], m: +m[2] - 1, d: +m[1], day: dayFromDate(+m[3], +m[2] - 1, +m[1]) };
    return null;
  }

  var MONEY_RES = [/£\s?[\dOolI][\dOolI,]*(?:\.[\dOolI]{1,2})?/, /[\dOolI][\dOolI,]*\.[\dOolI]{2}/, /\d[\d,]*/];
  /** "£2l2.5O" is what a poor scan makes of "£212.50": read it, but say it was a guess. */
  function parseMoney(tok) {
    var raw = tok.replace(/[£\s,]/g, '');
    if (!/\d/.test(raw)) return null;
    var fixed = /[OolI]/.test(raw), num = parseFloat(raw.replace(/[Oo]/g, '0').replace(/[lI]/g, '1'));
    return isNaN(num) ? null : { value: Math.round(num * 100) / 100, fixed: fixed };
  }

  /**
   * Find the first line that carries one of the labels, then the value after it (or on the next line).
   * `skip` ignores lines that look like something else (for example "Total ex VAT" when looking for the total).
   */
  function grab(L, labels, valueRes, skip, sameLine) {
    for (var li = 0; li < L.length; li++) {
      var ln = L[li];
      if (skip && skip.test(ln.t)) continue;
      for (var k = 0; k < labels.length; k++) {
        var m = labels[k].exec(ln.t);
        if (!m) continue;
        var after = ln.t.slice(m.index + m[0].length), base = ln.s + m.index + m[0].length, src = after;
        var hit = firstMatch(valueRes, src);
        if (!hit && !sameLine && /^[\s:\-–]*$/.test(after) && L[li + 1]) { src = L[li + 1].t; base = L[li + 1].s; hit = firstMatch(valueRes, src); }
        if (hit) return { raw: hit[0], s: base + hit.index, e: base + hit.index + hit[0].length, label: m[0].trim() };
      }
    }
    return null;
  }
  function firstMatch(res, str) { for (var i = 0; i < res.length; i++) { var m = res[i].exec(str); if (m) return m; } return null; }
  function field(key, label, value, display, conf, hit, note) {
    return { key: key, label: label, value: value, display: display, conf: value == null ? 0 : conf, s: hit ? hit.s : -1, e: hit ? hit.e : -1, note: note || '', edited: false };
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  /* ---------------- what is it? ---------------- */
  function classify(text) {
    var t = clean(text), inv = 0, form = 0, why = [];
    [[/invoice/i, 'says "invoice"'], [/\bvat\b/i, 'has VAT'], [/(?:total|amount|balance)\s*(?:due|payable)|grand total/i, 'has a total due'], [/payment\s*terms|pay\s*by|due\s*date|bill\s*ref/i, 'has payment terms'], [/sort\s*code|account\s*(?:no|number)/i, 'has bank details']]
      .forEach(function (p) { if (p[0].test(t)) { inv++; why.push(p[1]); } });
    var fwhy = [];
    [[/registration|new patient/i, 'says "registration"'], [/date of birth|\bdob\b/i, 'asks for a date of birth'], [/allerg/i, 'asks about allergies'], [/consent|\bI agree\b/i, 'has a consent line'], [/medical history|medication/i, 'has a medical history']]
      .forEach(function (p) { if (p[0].test(t)) { form++; fwhy.push(p[1]); } });
    if (inv >= 2 && inv > form) return { type: 'supplier_invoice', confidence: Math.min(0.99, 0.55 + inv * 0.09), why: why };
    if (form >= 2 && form > inv) return { type: 'patient_form', confidence: Math.min(0.99, 0.55 + form * 0.09), why: fwhy };
    return { type: 'unknown', confidence: 0.3, why: [] };
  }

  /* ---------------- supplier invoices ---------------- */
  function readInvoice(text, suppliers) {
    var T = clean(text), L = lines(T), F = {}, sup = suppliers || DEFAULT_SUPPLIERS, tLower = T.toLowerCase();

    // supplier: a name we already know, else the top of the page
    var known = null, at = -1;
    sup.forEach(function (s) { var i = tLower.indexOf(s.name.toLowerCase()); if (i >= 0 && (at < 0 || i < at)) { known = s; at = i; } });
    if (known) F.supplier = field('supplier', 'Supplier', known.name, known.name, 0.97, { s: at, e: at + known.name.length });
    else {
      var top = null; for (var i = 0; i < L.length && !top; i++) { var tt = L[i].t.trim(); if (tt && /[A-Za-z]/.test(tt) && !/^(tax\s+)?(invoice|bill|statement|reminder)/i.test(tt)) top = L[i]; }
      var nm = top ? top.t.trim().replace(/[\s,;:–-]+$/, '').split(/\s{3,}/)[0] : null;
      F.supplier = field('supplier', 'Supplier', nm, nm, 0.7, top ? { s: top.s + top.t.indexOf(nm), e: top.s + top.t.indexOf(nm) + nm.length } : null, 'Not a supplier we know: taken from the top of the page');
    }

    var no = grab(L, [/invoice\s*(?:no\.?|number|#|ref(?:erence)?)\s*[:#\-]?/i, /bill\s*ref(?:erence)?\s*[:#\-]?/i, /inv(?:oice)?\s*(?:no\.?|ref)\s*[:#\-]?/i], [/[A-Za-z0-9][A-Za-z0-9\-\/]{2,}/]);
    F.invoiceNo = field('invoiceNo', 'Invoice number', no && no.raw, no && no.raw, 0.97, no);

    var iss = grab(L, [/(?:invoice|issue|bill|tax\s*point)\s*date\s*[:\-]?/i, /date\s*of\s*issue\s*[:\-]?/i, /^\s*date\s*[:\-]/i], DATE_RES);
    var issD = iss && parseDate(iss.raw);
    F.issued = field('issued', 'Invoice date', issD ? issD.day : null, issD ? dateFromDay(issD.day) : null, 0.97, iss);

    var due = grab(L, [/(?:due\s*date|payment\s*due|due\s*on|pay(?:ment)?\s*by|pay\s*before)\s*[:\-]?/i], DATE_RES, /total|amount|balance/i), dueD = due && parseDate(due.raw);
    if (dueD) F.due = field('due', 'Due date', dueD.day, dateFromDay(dueD.day), 0.97, due);
    else {
      var tm = grab(L, [/(?:payment\s*)?terms\s*[:\-]?\s*(?:net\s*)?/i], [/\d+(?=\s*days)/]);
      if (tm && issD) { var dd = issD.day + parseInt(tm.raw, 10); F.due = field('due', 'Due date', dd, dateFromDay(dd), 0.85, tm, 'Worked out from the payment terms (' + tm.raw + ' days)'); }
      else F.due = field('due', 'Due date', null, null, 0, null);
    }

    function money(key, label, labels, skip) {
      var h = grab(L, labels, MONEY_RES, skip), p = h && parseMoney(h.raw);
      F[key] = p ? field(key, label, p.value, pounds(p.value), p.fixed ? 0.6 : 0.97, h, p.fixed ? 'The scan was unclear: "' + h.raw.trim() + '" looks like ' + pounds(p.value) + '. Please confirm' : '') : field(key, label, null, null, 0, null);
    }
    money('net', 'Total before VAT', [/sub\s?-?total/i, /net(?:\s*(?:total|amount))?/i, /(?:charges|goods|services|total)?\s*\(?\s*ex(?:cl(?:uding)?)?\.?\s*vat\)?/i], /total\s*(?:inc|due|payable)|amount\s*(?:due|payable)/i);
    money('vat', 'VAT', [/vat(?!\s*(?:no|number|reg))(?:\s*(?:@|at)?\s*\d+(?:\.\d+)?\s*%)?\s*[:\-]?/i], /total|number|reg|\bno\b|ex\.?\s*vat|excl|\bnet\b|sub\s?-?total|\binc/i);
    money('gross', 'Total to pay', [/total\s*inc(?:l(?:uding)?)?\.?\s*vat/i, /amount\s*(?:due|payable)/i, /total\s*(?:due|payable)/i, /balance\s*due/i, /grand\s*total/i, /^\s*total\s*[:\-]?/i], /ex\.?\s*vat|excl|sub\s?-?total|\bnet\b/i);

    var sc = /(?:sort\s*code|s\/c)\s*[:\-]?\s*(\d{2})[-\s]?(\d{2})[-\s]?(\d{2})/i.exec(T), ac = /(?:account(?:\s*(?:no|number))?|a\/c)\s*[:\-]?\s*(\d{8})/i.exec(T);
    F.sort = field('sort', 'Bank sort code', sc ? sc[1] + '-' + sc[2] + '-' + sc[3] : null, sc ? sc[1] + '-' + sc[2] + '-' + sc[3] : null, 0.97, sc ? { s: sc.index, e: sc.index + sc[0].length } : null);
    F.acct = field('acct', 'Bank account', ac ? ac[1] : null, ac ? ac[1] : null, 0.97, ac ? { s: ac.index, e: ac.index + ac[0].length } : null);
    return { type: 'supplier_invoice', text: T, fields: F, order: ['supplier', 'invoiceNo', 'issued', 'due', 'net', 'vat', 'gross', 'sort', 'acct'] };
  }

  function supplierByName(sup, name) { var n = norm(name); return (sup || []).filter(function (s) { return norm(s.name) === n; })[0]; }
  function same(a, b) { return Math.abs(a - b) < 0.015; }

  /** The checks a careful person runs before paying. Each is pass, warn (needs a person) or fail. */
  function checkInvoice(read, ctx) {
    var f = read.fields, out = [], v = function (k) { return f[k] ? f[k].value : null; }, today = dayAt(ctx.now || 0), sup = ctx.suppliers || DEFAULT_SUPPLIERS;
    var add = function (id, label, status, detail) { out.push({ id: id, label: label, status: status, detail: detail }); };

    var missing = ['supplier', 'invoiceNo', 'issued', 'gross'].filter(function (k) { return v(k) == null; }).map(function (k) { return f[k].label.toLowerCase(); });
    if (missing.length) add('fields', 'Key details found', 'fail', 'Could not find: ' + missing.join(', ') + '.');
    else add('fields', 'Key details found', 'pass', 'Supplier, number, date and total were all found.');

    var shaky = Object.keys(f).filter(function (k) { return f[k].value != null && f[k].conf < SURE && ['supplier', 'invoiceNo', 'issued', 'due', 'net', 'vat', 'gross'].indexOf(k) >= 0; });
    if (shaky.length) add('confidence', 'Read with confidence', 'warn', 'Not sure about: ' + shaky.map(function (k) { return f[k].label.toLowerCase(); }).join(', ') + '. A person should confirm.');
    else add('confidence', 'Read with confidence', 'pass', 'Every field was read clearly.');

    if (v('net') != null && v('vat') != null && v('gross') != null) {
      var sum = Math.round((v('net') + v('vat')) * 100) / 100;
      if (!same(sum, v('gross'))) add('maths', 'Totals add up', 'fail', pounds(v('net')) + ' + ' + pounds(v('vat')) + ' is ' + pounds(sum) + ', but the document asks for ' + pounds(v('gross')) + '.');
      else if (v('net') > 0 && Math.abs(v('vat') / v('net') - 0.2) > 0.005) add('maths', 'Totals add up', 'warn', 'The sum is right, but the VAT is ' + (Math.round(v('vat') / v('net') * 1000) / 10) + '%, not the usual 20%.');
      else add('maths', 'Totals add up', 'pass', pounds(v('net')) + ' + ' + pounds(v('vat')) + ' VAT = ' + pounds(v('gross')) + '.');
    } else add('maths', 'Totals add up', v('gross') == null ? 'fail' : 'warn', v('gross') == null ? 'There is no total to check.' : 'Only the total was found, so the sum could not be checked.');

    if (v('issued') != null && v('due') != null && v('due') < v('issued')) add('dates', 'Dates make sense', 'fail', 'The due date is before the invoice date.');
    else if (v('issued') != null && v('issued') > today) add('dates', 'Dates make sense', 'warn', 'The invoice is dated in the future (' + dateFromDay(v('issued')) + ').');
    else add('dates', 'Dates make sense', v('issued') == null ? 'warn' : 'pass', v('issued') == null ? 'There is no invoice date.' : 'Dated ' + dateFromDay(v('issued')) + (v('due') != null ? ', due ' + dateFromDay(v('due')) + '.' : '.'));

    var dup = (ctx.docs || []).filter(function (d) {
      if (d.id === ctx.selfId || d.type !== 'supplier_invoice' || !d.fields || d.status === 'rejected') return false;
      var g = function (k) { return d.fields[k] ? d.fields[k].value : null; };
      return norm(g('supplier')) === norm(v('supplier')) && ((g('invoiceNo') && g('invoiceNo') === v('invoiceNo')) || (g('gross') != null && v('gross') != null && same(g('gross'), v('gross')) && g('issued') === v('issued')));
    })[0];
    if (dup) add('duplicate', 'Not seen before', 'fail', 'Already received as document ' + (dup.no ? '#' + dup.no : '') + ' (' + (dup.fields.invoiceNo.value || 'same amount and date') + '). It will not be paid twice.');
    else add('duplicate', 'Not seen before', 'pass', 'No earlier document from this supplier matches.');

    var known = supplierByName(sup, v('supplier'));
    if (known) add('supplier', 'Known supplier', 'pass', known.name + ' is on the supplier list.');
    else add('supplier', 'Known supplier', 'warn', 'First invoice from this supplier. A person should approve it and add them to the list.');

    if (known && v('sort') && v('acct') && known.sort && known.acct) {
      if (known.sort === v('sort') && known.acct === v('acct')) add('bank', 'Bank details match our records', 'pass', 'Same account as before (' + known.sort + ' / ' + known.acct + ').');
      else add('bank', 'Bank details match our records', 'fail', 'The account is different from the one we hold (' + known.sort + ' / ' + known.acct + ' became ' + v('sort') + ' / ' + v('acct') + '). Changed bank details are a common fraud.');
    } else if (!v('sort') && !v('acct')) add('bank', 'Bank details match our records', 'pass', known && !known.sort ? 'Paid by Direct Debit: no bank details to check.' : 'No bank details on this document.');
    else add('bank', 'Bank details match our records', 'warn', known ? 'We hold no bank details for this supplier to compare with.' : 'New supplier: no earlier details to compare with.');

    if (v('gross') != null && v('gross') > APPROVAL_LIMIT) add('limit', 'Within the approval limit', 'warn', pounds(v('gross')) + ' is over ' + pounds(APPROVAL_LIMIT) + ', so the manager must approve it.');
    else add('limit', 'Within the approval limit', 'pass', v('gross') != null ? pounds(v('gross')) + ' is under ' + pounds(APPROVAL_LIMIT) + '.' : '');
    return out;
  }

  /* ---------------- new-patient forms ---------------- */
  function readForm(text) {
    var T = clean(text), L = lines(T), F = {};
    var one = function (key, label, labels, valRe, tf, conf, skip) {
      var h = grab(L, labels, valRe, skip, true), val = h ? h.raw.trim() : null; if (val === '') val = null;
      F[key] = field(key, label, val == null ? null : tf ? tf(val) : val, val, conf || 0.97, h);
    };
    var rest = [/[^\s].*$/];
    one('name', 'Full name', [/(?:full|patient)?\s*name\s*[:\-]?/i], rest, null, null, /guardian|parent|signed/i);
    var dob = grab(L, [/(?:date\s*of\s*birth|d\.?o\.?b\.?)\s*[:\-]?/i], DATE_RES), dobD = dob && parseDate(dob.raw);
    F.dob = field('dob', 'Date of birth', dobD ? dobD.day : null, dobD ? dateFromDay(dobD.day).replace(/^\w+ /, '') : null, 0.97, dob);
    F.dob.ymd = dobD ? [dobD.y, dobD.m, dobD.d] : null;
    var em = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/.exec(T);
    F.email = field('email', 'Email', em ? em[0] : null, em ? em[0] : null, 0.97, em ? { s: em.index, e: em.index + em[0].length } : null);
    one('phone', 'Mobile', [/(?:mobile|phone|tel(?:ephone)?)\s*[:\-]?/i], [/[\d+][\d\s]{7,}\d/]);
    one('address', 'Address', [/address\s*[:\-]?/i], rest);
    one('allergies', 'Allergies', [/allerg(?:y|ies)\s*[:\-]?/i], rest);
    one('conditions', 'Medical conditions', [/conditions?\s*[:\-]?/i], rest);
    one('guardian', 'Parent or guardian', [/(?:parent|guardian)[^:\n]*[:\-]\s*/i], rest);
    var yes = /\[\s*[xX✓✔]\s*\]\s*I agree/.exec(T), no = /\[\s*\]\s*I agree/.exec(T), c = yes || no;
    F.consent = field('consent', 'Consent given', yes ? true : no ? false : null, yes ? 'Ticked' : no ? 'Not ticked' : null, 0.97, c ? { s: c.index, e: c.index + c[0].length } : null);
    F.consent.conf = c ? 0.97 : 0;
    var sg = grab(L, [/signed\s*[:\-]?/i], [/[A-Za-z][A-Za-z .'\-]+/]);
    F.signed = field('signed', 'Signed by', sg ? sg.raw.trim() : null, sg ? sg.raw.trim() : null, 0.9, sg);
    return { type: 'patient_form', text: T, fields: F, order: ['name', 'dob', 'email', 'phone', 'address', 'allergies', 'conditions', 'guardian', 'consent', 'signed'] };
  }

  function ageOn(ymd, day) { if (!ymd) return null; var t = new Date(EPOCH + (day - 1) * 864e5), a = t.getUTCFullYear() - ymd[0]; if (t.getUTCMonth() < ymd[1] || (t.getUTCMonth() === ymd[1] && t.getUTCDate() < ymd[2])) a--; return a; }
  var NONE = /^(none|no|nil|n\/a|-|–)\.?$/i;
  function hasAlert(f) { return [f.allergies, f.conditions].some(function (x) { return x && x.value && !NONE.test(String(x.value).trim()); }); }

  function checkForm(read, ctx) {
    var f = read.fields, out = [], v = function (k) { return f[k] ? f[k].value : null; }, today = dayAt(ctx.now || 0);
    var add = function (id, label, status, detail) { out.push({ id: id, label: label, status: status, detail: detail }); };
    var missing = ['name', 'dob', 'email'].filter(function (k) { return v(k) == null; }).map(function (k) { return f[k].label.toLowerCase(); });
    add('fields', 'Key details found', missing.length ? 'fail' : 'pass', missing.length ? 'Could not find: ' + missing.join(', ') + '.' : 'Name, date of birth and email were all found.');
    var age = ageOn(f.dob && f.dob.ymd, today);
    if (f.dob && f.dob.value != null && (f.dob.value > today || age > 110)) add('dob', 'Date of birth is plausible', 'fail', 'The date of birth does not look right.');
    else add('dob', 'Date of birth is plausible', f.dob && f.dob.value != null ? 'pass' : 'warn', age != null ? 'Age ' + age + '.' : 'No date of birth to check.');
    var okMail = v('email') && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'));
    add('email', 'Email address is valid', okMail ? 'pass' : 'warn', okMail ? 'The format is valid.' : 'The email is missing or not valid, so we cannot write to the patient.');
    if (age != null && age < 18) {
      if (v('guardian') == null || NONE.test(String(v('guardian')))) add('minor', 'Under 18: parent or guardian named', 'warn', 'The patient is ' + age + ', so a parent or guardian must be named and must give the consent.');
      else add('minor', 'Under 18: parent or guardian named', 'pass', 'Guardian: ' + v('guardian') + '.');
    } else add('minor', 'Under 18: parent or guardian named', 'pass', age != null ? 'The patient is an adult.' : '');
    if (v('consent') === true) add('consent', 'Consent to store their details', 'pass', 'The consent box is ticked.');
    else add('consent', 'Consent to store their details', 'fail', v('consent') === false ? 'The consent box is not ticked. The details must not be filed until the patient gives consent.' : 'There is no consent line on this form.');
    var dup = (ctx.docs || []).filter(function (d) { return d.id !== ctx.selfId && d.type === 'patient_form' && d.fields && d.status !== 'rejected' && norm(d.fields.name.value) === norm(v('name')) && d.fields.dob.value === v('dob'); })[0];
    add('duplicate', 'Not already registered', dup ? 'fail' : 'pass', dup ? v('name') + ' is already registered (document #' + dup.no + '). The form is kept, not filed twice.' : 'No patient with this name and date of birth.');
    add('alert', 'Medical alert', 'info', hasAlert(f) ? 'Allergy or condition recorded. It is flagged on the patient record and is not shown in logs or emails.' : 'No allergies or conditions declared.');
    return out;
  }

  /* ---------------- what happens next ---------------- */
  var FIX = { fields: 1, confidence: 1, maths: 1, dates: 1, supplier: 1, minor: 1, dob: 1, email: 1 };
  /** Strictest outcome wins: duplicate, then held, then review, then approval, then filed. */
  function decide(type, checks) {
    var by = function (id) { return checks.filter(function (c) { return c.id === id; })[0]; };
    var bad = checks.filter(function (c) { return c.status === 'fail'; }), warn = checks.filter(function (c) { return c.status === 'warn'; });
    if (by('duplicate') && by('duplicate').status === 'fail') return { status: 'duplicate', headline: 'Already received: kept, not filed again', why: by('duplicate').detail };
    if (type === 'supplier_invoice' && by('bank') && by('bank').status === 'fail') return { status: 'held', headline: 'Held: the bank details changed', why: by('bank').detail };
    if (type === 'patient_form' && by('consent') && by('consent').status === 'fail') return { status: 'held', headline: 'Held: no consent on the form', why: by('consent').detail };
    var needs = bad.concat(warn.filter(function (c) { return FIX[c.id]; }));
    if (needs.length) return { status: 'review', headline: 'Needs a person: ' + needs.map(function (c) { return c.label.toLowerCase(); }).join(', '), why: needs.map(function (c) { return c.detail; }).join(' ') };
    if (by('limit') && by('limit').status === 'warn') return { status: 'approval', headline: 'Waiting for the manager to approve', why: by('limit').detail };
    return { status: 'filed', headline: type === 'supplier_invoice' ? 'Filed: ready to pay, reminders set' : 'Filed: the patient is registered', why: 'Every check passed, so nobody had to touch it.' };
  }

  global.DocReader = {
    clean: clean, classify: classify, readInvoice: readInvoice, readForm: readForm, checkInvoice: checkInvoice, checkForm: checkForm, decide: decide,
    pounds: pounds, dateFromDay: dateFromDay, dayAt: dayAt, minutesFor: minutesFor, hasAlert: hasAlert, ageOn: ageOn,
    TYPE_NAME: TYPE_NAME, DEFAULT_SUPPLIERS: DEFAULT_SUPPLIERS, SURE: SURE, APPROVAL_LIMIT: APPROVAL_LIMIT
  };
})(window);
