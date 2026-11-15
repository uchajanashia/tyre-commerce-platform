import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RadialFilterOption, RadialFilterSelect } from './radial-filter-select';

describe('RadialFilterSelect compact dialog', () => {
  let fixture: ComponentFixture<RadialFilterSelect>;
  const options: RadialFilterOption[] = [
    { value: '', label: 'ყველა დიამეტრი' },
    { value: '16', label: 'R16' },
    { value: '20', label: 'R20' },
  ];
  const flushFocusTimer = (delay = 0): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, delay));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RadialFilterSelect] }).compileComponents();
    fixture = TestBed.createComponent(RadialFilterSelect);
    fixture.componentRef.setInput('label', 'დისკის დიამეტრი');
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('value', '');
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.body.style.overflow = '';
  });

  it('opens an accessible dialog, locks scrolling, and focuses the grid', async () => {
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('.filter-trigger')!.click();
    fixture.detectChanges();
    await flushFocusTimer();

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    const listbox = host.querySelector<HTMLElement>('[role="listbox"]');
    const targets = Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('დისკის დიამეტრი');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(listbox);
    expect(targets).toHaveLength(3);
    expect(targets.every((target) => getComputedStyle(target).minHeight === '44px')).toBe(true);
  });

  it('supports arrow selection, emits the value, and restores trigger focus', async () => {
    const emitted = vi.fn();
    fixture.componentInstance.valueChange.subscribe(emitted);
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>('.filter-trigger')!;

    trigger.click();
    fixture.detectChanges();
    await flushFocusTimer();
    const listbox = host.querySelector<HTMLElement>('[role="listbox"]')!;
    listbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    listbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    await flushFocusTimer(175);

    expect(emitted).toHaveBeenCalledWith('16');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape without changing the value', async () => {
    const emitted = vi.fn();
    fixture.componentInstance.valueChange.subscribe(emitted);
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('.filter-trigger')!.click();
    fixture.detectChanges();
    await flushFocusTimer();

    host
      .querySelector<HTMLElement>('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await flushFocusTimer(175);

    expect(emitted).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
