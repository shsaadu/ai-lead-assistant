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

  // What the patient reads on their own phone, in their own language. (The practice's screens stay English.)
  var UI = {
    en: {
      title: 'Messages', labels: { follow: 'Message', book: 'Booking confirmed', remind: 'Reminder', invoice: 'Invoice', warn: 'Overdue notice', escalate: 'Final notice', info: 'Message' },
      book: 'Book a time', viewInv: 'View invoice', yourAppt: 'Your appointment', diffTime: 'Want a different time? Pick one below, or cancel.', cancelAppt: 'Cancel my appointment',
      pick: function (n) { return 'Pick a time that suits you, ' + n + '.'; }, paid: 'Paid', overdue: 'Overdue', due: 'Due ', leftOf: ' left of ', yourInv: 'Your invoices', noInv: 'No invoices yet.',
      howTitle: 'How to pay', howText: 'Pay the practice directly: by bank transfer, or by card over the phone at reception. Please quote the invoice number. The practice confirms once it has arrived.',
      noMsgs: function (n) { return 'No messages for ' + n + ' yet.'; }, close: 'Close'
    },
    es: {
      title: 'Mensajes', labels: { follow: 'Mensaje', book: 'Reserva confirmada', remind: 'Recordatorio', invoice: 'Factura', warn: 'Aviso de vencimiento', escalate: 'Aviso final', info: 'Mensaje' },
      book: 'Reservar una hora', viewInv: 'Ver factura', yourAppt: 'Tu cita', diffTime: '¿Prefieres otra hora? Elige una abajo o cancela.', cancelAppt: 'Cancelar mi cita',
      pick: function (n) { return 'Elige la hora que mejor te venga, ' + n + '.'; }, paid: 'Pagada', overdue: 'Vencida', due: 'Vence ', leftOf: ' pendientes de ', yourInv: 'Tus facturas', noInv: 'Aún no hay facturas.',
      howTitle: 'Cómo pagar', howText: 'Paga directamente a la clínica: por transferencia bancaria o con tarjeta por teléfono en recepción. Indica el número de factura. La clínica confirmará cuando lo reciba.',
      noMsgs: function (n) { return 'Aún no hay mensajes para ' + n + '.'; }, close: 'Cerrar'
    },
    ar: {
      title: 'الرسائل', labels: { follow: 'رسالة', book: 'تأكيد الحجز', remind: 'تذكير', invoice: 'فاتورة', warn: 'إشعار تأخر', escalate: 'إشعار أخير', info: 'رسالة' },
      book: 'احجز موعدًا', viewInv: 'عرض الفاتورة', yourAppt: 'موعدك', diffTime: 'تريد وقتًا آخر؟ اختر من الأسفل أو ألغِ الموعد.', cancelAppt: 'إلغاء موعدي',
      pick: function (n) { return 'اختر الوقت المناسب لك، ' + n + '.'; }, paid: 'مدفوعة', overdue: 'متأخرة', due: 'تستحق ', leftOf: ' متبقٍ من ', yourInv: 'فواتيرك', noInv: 'لا توجد فواتير بعد.',
      howTitle: 'طريقة الدفع', howText: 'ادفع للعيادة مباشرة: بالتحويل المصرفي أو بالبطاقة عبر الهاتف في الاستقبال. يرجى ذكر رقم الفاتورة. ستؤكد العيادة عند وصول الدفعة.',
      noMsgs: function (n) { return 'لا توجد رسائل لـ ' + n + ' بعد.'; }, close: 'إغلاق'
    }
  };
  function ui(lead) { return (lead && UI[lead.lang]) || UI.en; }
  function dirAttr(lead) { return lead && lead.lang === 'ar' ? ' dir="rtl"' : ''; }

  function esc(v) { var d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; }

  function mount(root, E) {
    var F = E.fmt, H = E.helpers, selected = '', sheet = null, painted = {};
    root.innerHTML =
      '<div class="ph-frame"><div class="ph-notch" aria-hidden="true"></div>' +
      '<div class="ph-screen">' +
      '<div class="ph-status"><b id="ph-clock">09:00</b><span aria-hidden="true">5G ▪▪▪</span></div>' +
      '<div class="ph-head"><div><b id="ph-title">Messages</b><small id="ph-who">Choose a patient</small></div><label class="ph-pick">Phone of<select id="ph-select" aria-label="Whose phone is this?"></select></label></div>' +
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
      var st = E.state, U = ui(lead), L = lead.lang, d = dirAttr(lead);
      var x = '<button class="ph-x" data-act="close" aria-label="' + esc(U.close) + '">×</button>';
      if (sheet === 'book') {
        var b = openBooking(lead), opts = Object.keys(E.SLOTS).map(function (k) { var sl = E.SLOTS[k]; return '<button class="ph-slot" data-slot="' + k + '" type="button">' + esc((sl.labels && sl.labels[L]) || sl.label) + '</button>'; }).join('');
        if (b) {
          return '<div class="ph-sheet-in"' + d + '><div class="ph-sheet-top"><b>' + esc(U.yourAppt) + '</b>' + x + '</div>' +
            '<p class="ph-big">' + esc(F.fmtSlot(b.at, L)) + '</p><p class="ph-sm">' + esc(U.diffTime) + '</p><div class="ph-slots">' + opts + '</div>' +
            '<button class="ph-link" data-act="cancel-appt" type="button">' + esc(U.cancelAppt) + '</button></div>';
        }
        return '<div class="ph-sheet-in"' + d + '><div class="ph-sheet-top"><b>' + esc(U.book) + '</b>' + x + '</div>' +
          '<p class="ph-sm">' + esc(U.pick(lead.name.split(' ')[0])) + '</p><div class="ph-slots">' + opts + '</div></div>';
      }
      if (sheet === 'invoice') {
        var mine = st.invoices.filter(function (i) { return i.leadId === lead.id && i.status !== 'void'; });
        var rows = mine.length ? mine.map(function (i) {
          var left = i.amount - i.paid, late = H.isOverdue(i);
          return '<div class="ph-inv' + (late ? ' late' : '') + (i.status === 'paid' ? ' paid' : '') + '"><div class="ph-inv-top"><b>' + esc(i.number) + '</b><span>' + (i.status === 'paid' ? esc(U.paid) : late ? esc(U.overdue) : esc(U.due) + esc(F.fmtDue(i.dueAt, L))) + '</span></div>' +
            '<p>' + esc(i.desc) + '</p><p class="ph-amt">' + (i.status === 'paid' ? F.money(i.amount) : F.money(left) + (i.paid ? esc(U.leftOf) + F.money(i.amount) : '')) + '</p></div>';
        }).join('') : '<p class="ph-sm">' + esc(U.noInv) + '</p>';
        return '<div class="ph-sheet-in"' + d + '><div class="ph-sheet-top"><b>' + esc(U.yourInv) + '</b>' + x + '</div>' + rows +
          '<div class="ph-howto"><b>' + esc(U.howTitle) + '</b><p>' + esc(U.howText) + '</p></div></div>';
      }
      return '';
    }

    function render() {
      var st = E.state, list = patients(), lead = currentLead();
      var h = Math.floor((st.now % 1440) / 60), m = Math.floor(st.now % 60);
      $('ph-clock').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      paint('ph-select', list.length ? list.map(function (l) { return '<option value="' + esc(l.email.toLowerCase()) + '"' + (lead && l.id === lead.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') : '<option value="">No patients yet</option>');
      $('ph-title').textContent = ui(lead).title;
      $('ph-who').textContent = lead ? lead.name + ' · ' + E.LANG[lead.lang].name : 'Choose a patient';
      if (!lead) { paint('ph-thread', '<p class="ph-empty">Nothing yet. When a patient contacts the practice, their messages appear here.</p>'); $('ph-sheet').hidden = true; return; }
      var msgs = st.emails.filter(function (x) { return x.to === lead.email; }).slice().reverse();
      paint('ph-thread', msgs.length ? msgs.map(function (x) {
        var U = ui(lead);
        var btn = x.link === true ? '<button class="ph-btn" data-act="book" type="button">' + esc(U.book) + '</button>' : x.link === 'a payment link' ? '<button class="ph-btn alt" data-act="invoice" type="button">' + esc(U.viewInv) + '</button>' : '';
        return '<div class="ph-msg ' + esc(x.tone) + '"' + dirAttr(lead) + '><div class="ph-label">' + esc(U.labels[x.tone] || U.labels.info) + ' · ' + esc(F.fmtTime(x.t)) + '</div><div class="ph-text">' + esc(x.subject) + '</div>' + btn + '</div>';
      }).join('') : '<p class="ph-empty">' + esc(ui(lead).noMsgs(lead.name)) + '</p>');
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
