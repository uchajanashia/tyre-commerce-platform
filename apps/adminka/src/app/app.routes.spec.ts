import { routes } from './app.routes';

describe('public identity routes', () => {
  it('exposes the self-contained demo outside the authenticated shell', async () => {
    const demoRoute = routes.find((candidate) => candidate.path === 'demo');
    const shellIndex = routes.findIndex((candidate) => candidate.path === '');
    const demoIndex = routes.findIndex((candidate) => candidate.path === 'demo');

    expect(demoRoute).toBeDefined();
    expect(demoRoute?.canActivate).toBeUndefined();
    expect(demoRoute?.children).toBeUndefined();
    expect(demoRoute?.loadComponent).toEqual(expect.any(Function));
    expect(demoIndex).toBeGreaterThan(-1);
    expect(demoIndex).toBeLessThan(shellIndex);

    const component = await demoRoute?.loadComponent?.();
    expect(component).toBeDefined();
  });

  it('matches the backend-issued fragment landing paths without an auth guard', () => {
    for (const path of [
      'admin/invitations/accept',
      'admin/password-reset',
      'admin/recovery',
      'password-reset/request',
    ]) {
      const route = routes.find((candidate) => candidate.path === path);
      expect(route).toBeDefined();
      expect(route?.canActivate).toBeUndefined();
      expect(route?.loadComponent).toEqual(expect.any(Function));
    }
  });

  it('gates governance list and detail routes with both rollout and permission metadata', () => {
    const children = routes.find((route) => route.path === '')?.children ?? [];
    for (const expected of [
      { path: 'approvals', feature: 'approvals', permission: 'approvals.read' },
      { path: 'approvals/:id', feature: 'approvals', permission: 'approvals.read' },
      { path: 'audit', feature: 'audit', permission: 'audit.read' },
      { path: 'audit/:id', feature: 'audit', permission: 'audit.read' },
      { path: 'jobs', feature: 'jobs', permission: 'jobs.read' },
      { path: 'jobs/:id', feature: 'jobs', permission: 'jobs.read' },
    ]) {
      const route = children.find((candidate) => candidate.path === expected.path);
      expect(route?.canActivate).toHaveLength(2);
      if (expected.feature === 'approvals') expect(route?.canDeactivate).toHaveLength(1);
      else expect(route?.canDeactivate).toBeUndefined();
      expect(route?.data).toEqual(
        expect.objectContaining({
          governanceFeature: expected.feature,
          permission: expected.permission,
        }),
      );
    }
  });

  it('binds both jobs reader routes to the distinct jobs flag and literal jobs.read permission', () => {
    const children = routes.find((route) => route.path === '')?.children ?? [];
    for (const path of ['jobs', 'jobs/:id']) {
      const route = children.find((candidate) => candidate.path === path);
      expect(route?.data).toEqual({
        governanceFeature: 'jobs',
        permission: 'jobs.read',
        exactPermission: true,
      });
      expect(route?.canActivate).toHaveLength(2);
    }
  });

  it('binds both audit reader routes to the distinct audit flag and literal audit.read permission', () => {
    const children = routes.find((route) => route.path === '')?.children ?? [];
    for (const path of ['audit', 'audit/:id']) {
      const route = children.find((candidate) => candidate.path === path);
      expect(route?.data).toEqual({
        governanceFeature: 'audit',
        permission: 'audit.read',
        exactPermission: true,
      });
      expect(route?.canActivate).toHaveLength(2);
    }
  });
});
