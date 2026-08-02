import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCreateCompanyRequest } from './companyProvisioning.js';

const validRequest = {
  companyName: 'Acme Events', slug: 'acme-events', ownerName: 'Owner',
  ownerEmail: 'owner@example.test', ownerPassword: 'Strong-owner-123!', plan: 'trial', subscriptionStart: '2026-01-01',
  subscriptionEnd: '2026-02-01', maxUsers: 2, features: ['orders'],
};

test('accepts a valid company provisioning request', () => {
  assert.equal('success' in validateCreateCompanyRequest(validRequest), false);
});

test('rejects an unsafe slug', () => {
  const result = validateCreateCompanyRequest({ ...validRequest, slug: '../unsafe' });
  assert.equal('success' in result && result.success, false);
  assert.equal('code' in result && result.code, 'INVALID_INPUT');
});

test('rejects invalid email, features, and subscription range', () => {
  for (const request of [
    { ...validRequest, ownerEmail: 'invalid' },
    { ...validRequest, features: ['valid', ''] },
    { ...validRequest, subscriptionEnd: '2025-12-31' },
  ]) {
    const result = validateCreateCompanyRequest(request);
    assert.equal('code' in result && result.code, 'INVALID_INPUT');
  }
});
