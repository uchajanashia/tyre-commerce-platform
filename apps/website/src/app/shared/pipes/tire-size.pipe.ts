import { Pipe, PipeTransform } from '@angular/core';

import { TireSize } from '@core/models';

/**
 * { widthMm: 225, aspect: 45, rimDiameterInch: 18 } → "225/45 R18".
 * When the structured metric form is absent (truck/commercial/disk from the real
 * catalog), fall back to the raw size string, then to just the rim diameter.
 */
@Pipe({ name: 'tireSize' })
export class TireSizePipe implements PipeTransform {
  transform(size: TireSize | null | undefined): string {
    if (!size) {
      return '';
    }
    if (size.widthMm != null && size.aspect != null) {
      return `${size.widthMm}/${size.aspect} R${size.rimDiameterInch}`;
    }
    return size.raw ?? `R${size.rimDiameterInch}`;
  }
}
