import type { Ayanamsha } from './ayanamsha.js';
import { calculateChart, type ChartResult } from './ephemeris.js';
import { findExactTransits } from './exactTiming.js';

export interface SolarReturnInput {
  sunLongitude: number; // natal sun longitude (sidereal)
  year: number;         // return year
  birthMonth: number;   // used to centre the search window
  birthDay: number;
  latitude: number;     // observer location for the return chart
  longitude: number;
  // Applies to both halves, and must match the school the natal sun longitude
  // was read under: the search is for the moment the sun comes back to that
  // degree, and the two schools disagree by up to a degree — about a day of
  // solar motion, which would find the wrong instant.
  ayanamsha?: Ayanamsha;
}

export interface SolarReturnResult {
  exactUTC: string;
  chart: ChartResult;
}

export function calculateSolarReturn(input: SolarReturnInput): SolarReturnResult {
  const { sunLongitude, year, birthMonth, birthDay, latitude, longitude, ayanamsha } = input;

  // ±3-day window around the approximate birthday covers all edge cases.
  const approx = new Date(Date.UTC(year, birthMonth - 1, birthDay));
  const startDate = new Date(approx.getTime() - 3 * 86_400_000);
  const endDate   = new Date(approx.getTime() + 3 * 86_400_000);

  const transits = findExactTransits({
    body: 'sun',
    targetLongitude: sunLongitude,
    startUTC: startDate.toISOString(),
    endUTC: endDate.toISOString(),
    coordinateSystem: 'sidereal',
    ...(ayanamsha && { ayanamsha }),
  });

  if (transits.length === 0) {
    throw new Error(`No solar return found for sun longitude ${sunLongitude.toFixed(4)}° in ${year}`);
  }

  const transit = transits[0]!;
  const returnDate = new Date(transit.exactUTC);
  const hour =
    returnDate.getUTCHours() +
    returnDate.getUTCMinutes() / 60 +
    returnDate.getUTCSeconds() / 3600;

  const chart = calculateChart({
    year:      returnDate.getUTCFullYear(),
    month:     returnDate.getUTCMonth() + 1,
    day:       returnDate.getUTCDate(),
    hour,
    latitude,
    longitude,
    ...(ayanamsha && { ayanamsha }),
  });

  return { exactUTC: transit.exactUTC, chart };
}
