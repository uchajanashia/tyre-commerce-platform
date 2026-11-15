import { Pipe, PipeTransform } from '@angular/core';

import { SpeedRating, speedRatingKmh } from '@core/models';

/** 'Y' → "Y · 300 კმ/სთ" (speed rating symbol + max speed); absent → "—". */
@Pipe({ name: 'speedRating' })
export class SpeedRatingPipe implements PipeTransform {
  transform(rating: SpeedRating | null | undefined): string {
    if (!rating) {
      return '—';
    }
    return `${rating} · ${speedRatingKmh(rating)} კმ/სთ`;
  }
}
