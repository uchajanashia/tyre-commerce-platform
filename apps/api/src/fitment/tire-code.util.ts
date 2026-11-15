import { FitmentTireSize } from './fitment.types';

const SIZE_RE = /(\d{2,3})\s*\/\s*(\d{2,3})\s*R\s*(\d{1,2}(?:\.\d)?)/i;
const LOAD_SPEED_RE = /(\d{2,3})\s*([A-Z])\s*$/;

/**
 * Parses a tire code like "225/45R17 91V" into a structured size plus its
 * embedded load index / speed rating. Falls back to `raw` only (no width/
 * aspect) when the code doesn't match the metric passenger-tire pattern —
 * Wheel-Size occasionally returns non-metric or malformed codes.
 */
export function parseTireCode(raw: string): {
  size: FitmentTireSize;
  loadIndex: number | null;
  speedRating: string | null;
} {
  const trimmed = raw.trim();
  const sizeMatch = trimmed.match(SIZE_RE);
  const loadSpeedMatch = trimmed.match(LOAD_SPEED_RE);

  const size: FitmentTireSize = sizeMatch
    ? {
        widthMm: Number(sizeMatch[1]),
        aspect: Number(sizeMatch[2]),
        rimDiameterInch: Number(sizeMatch[3]),
        raw: trimmed,
      }
    : { rimDiameterInch: NaN, raw: trimmed };

  return {
    size,
    loadIndex: loadSpeedMatch ? Number(loadSpeedMatch[1]) : null,
    speedRating: loadSpeedMatch ? loadSpeedMatch[2].toUpperCase() : null,
  };
}
