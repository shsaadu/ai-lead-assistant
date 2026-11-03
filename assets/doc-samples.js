/**
 * Made-up documents for the document-reading demo. Every name, number and bank detail is invented.
 * Each one is built to show a different outcome: filed untouched, held, sent to a person, ignored as a duplicate.
 * Simulated Day 1 is Monday 2 November 2026.
 */
(function (global) {
  'use strict';

  var SAMPLES = [
    {
      id: 'mercer', kind: 'invoice', expect: 'filed', from: 'accounts@mercerdental.example', name: 'Mercer invoice MDS-20418',
      title: 'A clean supplier invoice', blurb: 'Everything is in order. Watch it get filed without anyone touching it.',
      text: [
        'MERCER DENTAL SUPPLIES',
        '12 Tannery Lane, Leeds LS9 8AA        VAT no: GB 284 1190 33',
        '',
        'INVOICE',
        'Invoice number: MDS-20418',
        'Invoice date: 30 Oct 2026',
        'Payment terms: 30 days',
        'Customer: Aldbridge Dental, 4 Aldgate Court, London',
        '',
        'Description                        Qty    Price    Amount',
        'Nitrile gloves, medium (box 100)    20    £4.25    £85.00',
        'Face masks type IIR (box 50)        10    £6.50    £65.00',
        'Prophy paste, mint (tub)            12    £5.00    £60.00',
        'Delivery                                           £2.50',
        '',
        '                          Total ex VAT:   £212.50',
        '                          VAT @ 20%:       £42.50',
        '                          Total due:      £255.00',
        '',
        'Pay by bank transfer',
        'Sort code: 60-12-34     Account: 22334455',
        'Reference: MDS-20418'
      ].join('\n')
    },
    {
      id: 'lab', kind: 'invoice', expect: 'approval', from: 'billing@brightsmilelab.example', name: 'Brightsmile Lab invoice BDL-7731',
      title: 'An invoice over the approval limit', blurb: 'Correct in every way, but it is over £500, so the manager must say yes first.',
      text: [
        'Brightsmile Dental Lab Ltd',
        'Unit 4, Foundry Park, Bristol BS2 0QD',
        '',
        'TAX INVOICE',
        'Invoice no. BDL-7731',
        'Date of issue: 29 Oct 2026',
        'Due date: 28 Nov 2026',
        '',
        'Patient work for Aldbridge Dental',
        '2 x zirconia crowns (shade A2)           £360.00',
        '1 x night guard, hard                    £120.00',
        '',
        'Subtotal      £480.00',
        'VAT (20%)      £96.00',
        'Amount due    £576.00',
        '',
        'Bank: Sort code 20-45-67  Account number 40981234'
      ].join('\n')
    },
    {
      id: 'energy', kind: 'invoice', expect: 'filed', from: 'noreply@eastlightenergy.example', name: 'Eastlight Energy bill EL-5530-1186',
      title: 'A utility bill in a different layout', blurb: 'Different words, different order, paid by Direct Debit. The same checks still apply.',
      text: [
        'EASTLIGHT ENERGY',
        'Your business electricity bill',
        '',
        'Bill reference: EL-5530-1186',
        'Bill date: 28 Oct 2026',
        'Pay by: 20 Nov 2026',
        '',
        'Electricity used: 1,842 kWh',
        'Charges (excl. VAT)          £260.00',
        'VAT at 20%                    £52.00',
        'Amount payable               £312.00',
        '',
        'We will collect this by Direct Debit on the date above.'
      ].join('\n')
    },
    {
      id: 'mercer-again', kind: 'invoice', expect: 'duplicate', from: 'accounts@mercerdental.example', name: 'Mercer invoice MDS-20418 (reminder)',
      title: 'The same invoice, sent again', blurb: 'A "reminder" copy of invoice MDS-20418. Send the first one before this one.',
      text: [
        'MERCER DENTAL SUPPLIES',
        'REMINDER: PLEASE CHECK YOUR RECORDS',
        '',
        'INVOICE',
        'Invoice number: MDS-20418',
        'Invoice date: 30 Oct 2026',
        'Payment terms: 30 days',
        '',
        'Total ex VAT:   £212.50',
        'VAT @ 20%:       £42.50',
        'Total due:      £255.00',
        '',
        'Sort code: 60-12-34     Account: 22334455'
      ].join('\n')
    },
    {
      id: 'maths', kind: 'invoice', expect: 'review', from: 'accounts@mercerdental.example', name: 'Mercer invoice MDS-20431',
      title: 'An invoice whose sums are wrong', blurb: 'The total asks for £10 more than the lines add up to. A person should look.',
      text: [
        'MERCER DENTAL SUPPLIES',
        '',
        'INVOICE',
        'Invoice number: MDS-20431',
        'Invoice date: 31 Oct 2026',
        'Payment terms: 30 days',
        '',
        'Composite syringes x 24',
        'Etchant gel x 6',
        '',
        'Total ex VAT:   £118.00',
        'VAT @ 20%:       £23.60',
        'Total due:      £151.60',
        '',
        'Sort code: 60-12-34     Account: 22334455'
      ].join('\n')
    },
    {
      id: 'bank-change', kind: 'invoice', expect: 'held', from: 'billing@brightsmilelab.example', name: 'Brightsmile Lab invoice BDL-7740',
      title: 'An invoice with new bank details', blurb: 'Looks perfect, but the account number is not the one we hold. A classic payment fraud.',
      text: [
        'Brightsmile Dental Lab Ltd',
        '',
        'INVOICE',
        'Invoice no. BDL-7740',
        'Date of issue: 2 Nov 2026',
        'Due date: 2 Dec 2026',
        '',
        'IMPORTANT: our bank details have changed. Please update your records and pay to the new account below.',
        '',
        'Subtotal      £300.00',
        'VAT (20%)      £60.00',
        'Amount due    £360.00',
        '',
        'Sort code 20-45-99   Account number 90871234'
      ].join('\n')
    },
    {
      id: 'scan', kind: 'invoice', expect: 'review', from: 'scanner@aldbridgedental.example', name: 'Clearwater invoice CCW-0192 (scan)',
      title: 'A poor scan', blurb: 'The scan has smudged digits. The reader makes its best guess and asks a person to confirm.',
      text: [
        'CLEARWATER CLINICAL WASTE',
        '',
        'INVOICE',
        'Invoice number: CCW-0192',
        'Invoice date: 1 Nov 2026',
        'Payment terms: 30 days',
        '',
        'Monthly clinical waste collection',
        '',
        'Total ex VAT:   £l5O.OO',
        'VAT @ 20%:       £3O.OO',
        'Total due:      £18O.OO',
        '',
        'Sort code: 30-90-12     Account: 11223344'
      ].join('\n')
    },
    {
      id: 'new-supplier', kind: 'invoice', expect: 'review', from: 'hello@kestrelprint.example', name: 'Kestrel Print invoice KPS-0088',
      title: 'A supplier we have never paid', blurb: 'Fine on paper, but a first-time supplier. A person approves them before anything is paid.',
      text: [
        'Kestrel Print & Signage',
        '8 Mill Row, Leicester LE1 5TT',
        '',
        'INVOICE',
        'Invoice number: KPS-0088',
        'Invoice date: 30 Oct 2026',
        'Payment terms: 14 days',
        '',
        'Waiting room sign and appointment cards',
        '',
        'Total ex VAT:   £95.00',
        'VAT @ 20%:      £19.00',
        'Total due:     £114.00',
        '',
        'Sort code: 77-33-11     Account: 12345678'
      ].join('\n')
    },
    {
      id: 'form-maria', kind: 'form', expect: 'filed', from: 'maria.lopez@example.com', name: 'Registration form: Maria Lopez',
      title: 'A new-patient form', blurb: 'A complete form with an allergy. It is filed, and the allergy is flagged without being shown in logs.',
      text: [
        'ALDBRIDGE DENTAL: NEW PATIENT REGISTRATION',
        '',
        'Full name: Maria Lopez',
        'Date of birth: 14 Mar 1991',
        'Email: maria.lopez@example.com',
        'Mobile: 07700 900123',
        'Address: 12 Fenwick Road, London E1 4AB',
        '',
        'Medical history',
        'Allergies: Penicillin',
        'Conditions: None',
        '',
        'Consent',
        '[x] I agree to Aldbridge Dental storing my details to provide my care.',
        'Signed: Maria Lopez   Date: 2 Nov 2026'
      ].join('\n')
    },
    {
      id: 'form-noconsent', kind: 'form', expect: 'held', from: 'chen.wei@example.com', name: 'Registration form: Chen Wei',
      title: 'A form without consent', blurb: 'Everything is filled in except the consent box. It is held, not filed.',
      text: [
        'ALDBRIDGE DENTAL: NEW PATIENT REGISTRATION',
        '',
        'Full name: Chen Wei',
        'Date of birth: 3 Aug 1987',
        'Email: chen.wei@example.com',
        'Mobile: 07700 900456',
        'Address: 55 Bishop Street, London E2 7DD',
        '',
        'Medical history',
        'Allergies: None',
        'Conditions: None',
        '',
        'Consent',
        '[ ] I agree to Aldbridge Dental storing my details to provide my care.',
        'Signed: Chen Wei   Date: 2 Nov 2026'
      ].join('\n')
    },
    {
      id: 'form-minor', kind: 'form', expect: 'review', from: 'okafor.family@example.com', name: 'Registration form: Sam Okafor',
      title: 'A form for a 15-year-old', blurb: 'No parent or guardian named. A person has to sort that out before the child is registered.',
      text: [
        'ALDBRIDGE DENTAL: NEW PATIENT REGISTRATION',
        '',
        'Full name: Sam Okafor',
        'Date of birth: 9 Jun 2011',
        'Email: okafor.family@example.com',
        'Mobile: 07700 900789',
        'Address: 3 Harbour Close, London E14 9XY',
        'Parent or guardian name:',
        '',
        'Medical history',
        'Allergies: None',
        'Conditions: Asthma',
        '',
        'Consent',
        '[x] I agree to Aldbridge Dental storing my details to provide my care.',
        'Signed: Sam Okafor   Date: 2 Nov 2026'
      ].join('\n')
    }
  ];

  global.DocSamples = SAMPLES;
})(window);
