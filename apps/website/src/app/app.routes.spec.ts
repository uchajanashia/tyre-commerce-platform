import { routes } from './app.routes';

describe('public routes', () => {
  it('does not expose development demos and renders a real not-found page', () => {
    expect(routes.some((route) => route.path?.startsWith('dev/'))).toBe(false);
    expect(routes.some((route) => route.path?.startsWith('design/'))).toBe(false);
    expect(routes.some((route) => route.path === 'select-lab')).toBe(false);

    const wildcard = routes.find((route) => route.path === '**');
    expect(wildcard).toBeDefined();
    expect(wildcard?.redirectTo).toBeUndefined();
    expect(wildcard?.loadComponent).toBeTypeOf('function');
  });

  it('does not guard an unverified order URL into a transactional page', () => {
    const order = routes.find((route) => route.path === 'order/:id');
    expect(order?.canActivate).toBeUndefined();
  });

  it('exposes stable direct routes for confirmed legal information only', () => {
    const legalPaths = routes
      .filter((route) => ['privacy', 'delivery-returns', 'terms'].includes(route.path ?? ''))
      .map((route) => route.path);

    expect(legalPaths).toEqual(['privacy', 'delivery-returns', 'terms']);
    expect(routes.some((route) => route.path === 'delivery')).toBe(false);
    expect(routes.some((route) => route.path === 'contact')).toBe(false);
  });
});
