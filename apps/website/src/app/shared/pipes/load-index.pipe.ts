import { Pipe, PipeTransform } from '@angular/core';

import { loadIndexKg } from '@core/models';

/** 91 → "91 · 615 კგ" (load index + max load per tire); absent → "—". */
@Pipe({ name: 'loadIndex' })
export class LoadIndexPipe implements PipeTransform {
  transform(index: number | null | undefined): string {
    if (index == null) {
      return '—';
    }
    const kg = loadIndexKg(index);
    return kg === null ? `${index}` : `${index} · ${kg} კგ`;
  }
}
