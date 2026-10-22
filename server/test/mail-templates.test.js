'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { customerMail, cancelMail } = require('../mail-templates');

const BOOKING = {
  id: 'abc123', site: 'optika', name: '<b>Teszt</b> Elek', email: 'a@b.hu',
  serviceName: 'Általános szemvizsgálat', duration: 30,
  date: '2026-11-03', start: '09:00', end: '09:30'
};

describe('A lemondó levél', () => {
  const mail = cancelMail(BOOKING, {});

  it('a lemondott időpontot és az azonosítót mutatja', () => {
    assert.match(mail.subject, /lemondva/);
    assert.match(mail.html, /Általános szemvizsgálat/);
    assert.match(mail.html, /abc123/);
    assert.match(mail.text, /9:00 – 9:30/);
  });

  it('a vendég nevét nem engedi nyers HTML-ként a levélbe', () => {
    assert.ok(!mail.html.includes('<b>Teszt</b>'));
    assert.match(mail.html, /&lt;b&gt;Teszt/);
  });

  it('különbözik a visszaigazolástól', () => {
    assert.notEqual(mail.subject, customerMail(BOOKING, {}).subject);
  });
});
