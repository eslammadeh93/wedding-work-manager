import assert from 'node:assert/strict';
import test from 'node:test';
import { PLATFORM_PERMISSIONS, platformRoleHasPermission } from '../src/multiTenant/platform/permissions/platformPermissions';
import { PLATFORM_ROUTES } from '../src/multiTenant/platform/routes';

test('platform owner keeps every platform permission', () => {
  for (const permission of PLATFORM_PERMISSIONS) assert.equal(platformRoleHasPermission('platform_owner', permission), true);
});

test('read-only platform role cannot mutate companies or manage admins', () => {
  assert.equal(platformRoleHasPermission('platform_read_only', 'platform:companies:read'), true);
  assert.equal(platformRoleHasPermission('platform_read_only', 'platform:companies:update'), false);
  assert.equal(platformRoleHasPermission('platform_read_only', 'platform:admins:manage'), false);
});

test('support impersonation is limited to the support-capable role and owner', () => {
  assert.equal(platformRoleHasPermission('platform_support', 'platform:support:impersonate'), true);
  assert.equal(platformRoleHasPermission('platform_admin', 'platform:support:impersonate'), false);
  assert.equal(platformRoleHasPermission('platform_owner', 'platform:support:impersonate'), true);
});

test('navigation visibility follows the permission matrix', () => {
  const visible = (role: Parameters<typeof platformRoleHasPermission>[0]) => PLATFORM_ROUTES.filter(route => platformRoleHasPermission(role, route.permission)).map(route => route.id);
  assert.equal(visible('platform_owner').length, PLATFORM_ROUTES.length);
  assert.equal(visible('platform_support').includes('admins'), false);
  assert.equal(visible('platform_read_only').includes('companies'), true);
  assert.equal(visible('platform_read_only').includes('settings'), false);
});
