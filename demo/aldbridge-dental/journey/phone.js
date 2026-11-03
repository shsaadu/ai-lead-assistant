/**
 * The patient's phone (Aldbridge Dental journey demo).
 * Shows what the patient receives from the practice: the acknowledgement, booking confirmation,
 * reminders, invoices and so on, in the patient's own language. The patient can open a booking
 * sheet and an invoice sheet from the messages. The invoice sheet has no payment button, because
 * Assist Street never handles money: the patient pays the practice directly.
 * Everything is simulated, with made-up people.
 */
(function (global) {
  'use strict';

  var LABELS = { follow: 'Message', book: 'Booking confirmed', remind: 'Reminder', invoice: 'Invoice', warn: 'Overdue notice', escalate: 'Final notice', info: 'Message' };

  function esc(v) { var d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; }
  function isArabic(s) { return /[؀-ۿ]/.test(s); }

  function mount(root, E) {
    var F = E.fmt, H = E.helpers, selected = '', sheet = null, painted = {};
    root.innerHTML =
      '<div class="ph-frame"><div class="ph-notch" aria-hidden="true"></div>' +
      '<div class="ph-screen">' +
      '<div class="ph-status"><b id="ph-clock">09:00</b><span aria-hidden="true">5G ▪▪▪</span></div>' +
      '<div class="ph-head"><div><b>Messages</b><small id="ph-who">Choose a patient</small></div><label class="ph-pick">Phone of<select id="ph-select" aria-label="Whose phone is this?"></select></label></div>' +
      '<div class="ph-thread" id="ph-thread" aria-live="polite"></div>' +
      '<div class="ph-sheet" id="ph-sheet" hidden></div>' +
      '</div></div>';
    var $ = function (id) { return root.querySelector('#' + id); };

    function paint(id, html) { var el = $(id); if (painted[id] !== html) { painted[id] = html; el.innerHTML = html; } }
    function patients() {
      var seen = {}, out = [];
      E.state.saved.forEach(function (l) { var k = l.email.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(l); } });
      return out;
    }
    function currentLead() {
      var list = patients();
      if (!list.length) return null;
      var found = list.filter(function (l) { return l.email.toLowerCase() === selected; })[0];
      // A choice made before the patient exists (a new enquiry is still arriving) is kept, so the phone
      // switches to them as soon as they appear. Until then, show the newest patient.
      if (!found) found = list[0];
      return found;
    }
    function openBooking(lead) { return E.state.bookings.filter(function (b) { return b.leadId === lead.id && b.status === 'booked'; })[0]; }

    function sheetHtml(lead) {
      var st = E.state;
      if (sheet === 'book') {
        var b = openBooking(lead), opts = Object.keys(E.SLOTS).map(function (k) { return '<button class="ph-slot" data-slot="' + k + '" type="button">' + esc(E.SLOTS[k].label) + '</button>'; }).join('');
        if (b) {
          return '<div class="ph-sheet-in"><div class="ph-sheet-top"><b>Your appointment</b><button class="ph-x" data-act="close" aria-label="Close">×</button></div>' +
            '<p class="ph-big">' + esc(F.fmtSlot(b.at)) + '</p><p class="ph-sm">Want a different time? Pick one below, or cancel.</p><div class="ph-slots">' + opts + '</div>' +
            '<button class="ph-link" data-act="cancel-appt" type="button">Cancel my appointment</button></div>';
        }
        return '<div class="ph-sheet-in"><div class="ph-sheet-top"><b>Book a time</b><button class="ph-x" data-act="close" aria-label="Close">×</button></div>' +
          '<p class="ph-sm">Pick a time that suits you, ' + esc(lead.name.split(' ')[0]) + '.</p><div class="ph-slots">' + opts + '</div></div>';
      }
      if (sheet === 'invoice') {
        var mine = st.invoices.filter(function (i) { return i.leadId === lead.id && i.status !== 'void'; });
        var rows = mine.length ? mine.map(function (i) {
          var left = i.amount - i.paid, late = H.isOverdue(i);
          return '<div class="ph-inv' + (late ? ' late' : '') + (i.status === 'paid' ? ' paid' : '') + '"><div class="ph-inv-top"><b>' + esc(i.number) + '</b><span>' + (i.status === 'paid' ? 'Paid' : late ? 'Overdue' : 'Due ' + esc(F.fmtDue(i.dueAt))) + '</span></div>' +
            '<p>' + esc(i.desc) + '</p><p class="ph-amt">' + (i.status === 'paid' ? F.money(i.amount) : F.money(left) + (i.paid ? ' left of ' + F.money(i.amount) : '')) + '</p></div>';
        }).join('') : '<p class="ph-sm">No invoices yet.</p>';
        return '<div class="ph-sheet-in"><div class="ph-sheet-top"><b>Your invoices</b><button class="ph-x" data-act="close" aria-label="Close">×</button></div>' + rows +
          '<div class="ph-howto"><b>How to pay</b><p>Pay the practice directly: by bank transfer, or by card over the phone at reception. Please quote the invoice number. The practice confirms once it has arrived.</p></div></div>';
      }
      return '';
    }

    function render() {
      var st = E.state, list = patients(), lead = currentLead();
      var h = Math.floor((st.now % 1440) / 60), m = Math.floor(st.now % 60);
      $('ph-clock').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      paint('ph-select', list.length ? list.map(function (l) { return '<option value="' + esc(l.email.toLowerCase()) + '"' + (lead && l.id === lead.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') : '<option value="">No patients yet</option>');
      $('ph-who').textContent = lead ? lead.name + ' · ' + E.LANG[lead.lang].name : 'Choose a patient';
      if (!lead) { paint('ph-thread', '<p class="ph-empty">Nothing yet. When a patient contacts the practice, their messages appear here.</p>'); $('ph-sheet').hidden = true; return; }
      var msgs = st.emails.filter(function (x) { return x.to === lead.email; }).slice().reverse();
      paint('ph-thread', msgs.length ? msgs.map(function (x) {
        var btn = x.link === true ? '<button class="ph-btn" data-act="book" type="button">Book a time</button>' : x.link === 'a payment link' ? '<button class="ph-btn alt" data-act="invoice" type="button">View invoice</button>' : '';
        return '<div class="ph-msg ' + esc(x.tone) + '"><div class="ph-label">' + esc(LABELS[x.tone] || 'Message') + ' · ' + esc(F.fmtTime(x.t)) + '</div><div class="ph-text"' + (isArabic(x.subject) ? ' dir="rtl"' : '') + '>' + esc(x.subject) + '</div>' + btn + '</div>';
      }).join('') : '<p class="ph-empty">No messages for ' + esc(lead.name) + ' yet.</p>');
      var sh = $('ph-sheet');
      if (sheet) { sh.hidden = false; paint('ph-sheet', sheetHtml(lead)); } else { sh.hidden = true; }
      var th = $('ph-thread'); if (!th.dataset.stuck) { th.scrollTop = th.scrollHeight; }
    }

    root.addEventListener('change', function (e) { if (e.target.id === 'ph-select') { selected = e.target.value; sheet = null; painted = {}; render(); } });
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-slot]'); if (!t) return;
      var lead = currentLead(); if (!lead) return;
      if (t.dataset.slot) {
        var b = openBooking(lead);
        if (b) E.rescheduleBooking(b.id, t.dataset.slot); else E.createBooking(lead.id, t.dataset.slot);
        sheet = null; render(); return;
      }
      if (t.dataset.act === 'book') sheet = 'book';
      else if (t.dataset.act === 'invoice') sheet = 'invoice';
      else if (t.dataset.act === 'close') sheet = null;
      else if (t.dataset.act === 'cancel-appt') { var bb = openBooking(lead); if (bb) E.cancelBooking(bb.id); sheet = null; }
      painted['ph-sheet'] = null; render();
    });

    E.onChange(render);
    render();
    return { select: function (email) { selected = String(email).toLowerCase(); sheet = null; painted = {}; render(); } };
  }

  global.PhoneView = { mount: mount };
})(window);
