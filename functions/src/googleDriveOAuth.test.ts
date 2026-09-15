import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGoogleDriveRefreshFailure } from './googleDriveOAuth.js';

test('expired or revoked Google grants require reconnecting the account', () => {
  assert.equal(classifyGoogleDriveRefreshFailure(400, { error: 'invalid_grant' }), 'reauth_required');
});

test('OAuth client errors are reported as server configuration errors', () => {
  assert.equal(classifyGoogleDriveRefreshFailure(401, { error: 'invalid_client' }), 'configuration_error');
  assert.equal(classifyGoogleDriveRefreshFailure(400, { error: 'unauthorized_client' }), 'configuration_error');
});

test('rate limits and provider failures stay retryable', () => {
  assert.equal(classifyGoogleDriveRefreshFailure(429, { error: 'rate_limit_exceeded' }), 'temporary_error');
  assert.equal(classifyGoogleDriveRefreshFailure(503, {}), 'temporary_error');
});

