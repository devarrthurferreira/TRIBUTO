import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleAgentJob } from '../src/clients/agent-schedule.mjs';

test('janelas fiscais distintas em São Paulo preservam a autorização do lote', () => {
  const invoice = { source: 'NFE', enabled: true };
  const serviceInvoice = { source: 'NFSE', enabled: true };
  const profile = { active: true, invoiceSchedule: { period: 'day', time: '08:00' },
    serviceInvoiceSchedule: { period: 'night', time: '22:00' } };
  const morning = new Date('2026-11-26T11:00:00Z');
  const check = (job, iso) => scheduleAgentJob(job, profile, new Date(iso)).inCollectionWindow;
  assert.equal(scheduleAgentJob(invoice, undefined, morning), invoice);
  assert.equal(check(invoice, '2026-11-26T10:59:00Z'), false);
  assert.equal(check(invoice, '2026-11-26T11:00:00Z'), true);
  assert.equal(check(invoice, '2026-11-26T21:00:00Z'), false);
  assert.equal(check(serviceInvoice, '2026-11-27T00:59:00Z'), false);
  assert.equal(check(serviceInvoice, '2026-11-27T01:00:00Z'), true);
  assert.equal(check(serviceInvoice, '2026-11-27T08:59:00Z'), true);
  assert.equal(check(serviceInvoice, '2026-11-27T09:00:00Z'), false);
  assert.equal(scheduleAgentJob(invoice, { ...profile, active: false }, morning).inCollectionWindow, false);
  assert.equal(scheduleAgentJob(invoice, { ...profile, invoiceSchedule: { period: 'disabled', time: null } }, morning).enabled, true);
  const afterMidnight = { ...profile, serviceInvoiceSchedule: { period: 'night', time: '03:00' } };
  assert.equal(scheduleAgentJob(serviceInvoice, afterMidnight, new Date('2026-11-27T05:59:00Z')).inCollectionWindow, false);
  assert.equal(scheduleAgentJob(serviceInvoice, afterMidnight, new Date('2026-11-27T06:00:00Z')).inCollectionWindow, true);
});
