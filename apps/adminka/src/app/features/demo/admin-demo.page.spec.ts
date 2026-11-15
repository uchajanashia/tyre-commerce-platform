import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminDemoPage } from './admin-demo.page';

describe('AdminDemoPage', () => {
  let fixture: ComponentFixture<AdminDemoPage>;
  let component: AdminDemoPage;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AdminDemoPage] }).compileComponents();
    fixture = TestBed.createComponent(AdminDemoPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('labels the workspace as synthetic and renders the overview command center', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('DEMO • სინთეტიკური მონაცემები');
    expect(text).toContain('ცვლილებები არ ინახება');
    expect(text).toContain('დღის სურათი');
    expect(text).toContain('მოქმედებას ითხოვს');
  });

  it('starts with mobile navigation closed and keeps its accessible state in sync', () => {
    const shell = fixture.nativeElement.querySelector('.demo-shell') as HTMLElement;
    const menu = fixture.nativeElement.querySelector('.menu-button') as HTMLButtonElement;

    expect(component.navOpen()).toBe(false);
    expect(shell.classList.contains('demo-shell--nav-open')).toBe(false);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-label')).toBe('ნავიგაციის გახსნა');

    menu.click();
    fixture.detectChanges();
    expect(component.navOpen()).toBe(true);
    expect(shell.classList.contains('demo-shell--nav-open')).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('aria-label')).toBe('ნავიგაციის დახურვა');

    const scrim = fixture.nativeElement.querySelector('.nav-scrim') as HTMLButtonElement;
    scrim.click();
    fixture.detectChanges();
    expect(component.navOpen()).toBe(false);
    expect(shell.classList.contains('demo-shell--nav-open')).toBe(false);
  });

  it('navigates across all five operational views without a production service', () => {
    const headings: Array<[Parameters<AdminDemoPage['selectView']>[0], string]> = [
      ['overview', 'დღის სურათი'],
      ['orders', 'შეკვეთების რიგი'],
      ['payments', 'გადახდების გადამოწმება'],
      ['crm', 'კლიენტების სივრცე'],
      ['inventory', 'მარაგის ჯანმრთელობა'],
    ];

    for (const [view, heading] of headings) {
      component.selectView(view);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(heading);
    }
  });

  it('filters orders and keeps selectable master-detail context', () => {
    component.selectView('orders');
    component.query.set('ალფა ავტო');
    fixture.detectChanges();

    expect(component.filteredOrders()).toHaveLength(1);
    expect(component.filteredOrders()[0]?.id).toBe('ORD-1047');

    component.selectedOrderId.set('ORD-1047');
    fixture.detectChanges();
    const detail = fixture.nativeElement.querySelector('.detail-pane')?.textContent as string;
    expect(detail).toContain('შპს ალფა ავტო');
    expect(detail).toContain('ოპერაციის ქრონოლოგია');
  });

  it('confirms a payment decision only in local demo state', () => {
    component.selectView('payments');
    component.openDecision('PAY-0814', 'approve');
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('გადახდის დამტკიცება?');
    expect(dialog.textContent).toContain('მხოლოდ მიმდინარე დემო სესიაში');

    component.confirmDecision();
    fixture.detectChanges();
    expect(component.paymentStatus('PAY-0814')).toBe('დამტკიცებული');
    expect(component.pendingDecision()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('მხოლოდ დემო');
  });
});
