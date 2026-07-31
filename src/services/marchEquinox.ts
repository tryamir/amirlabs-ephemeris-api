import sweph from 'sweph';
import {
  calcBodyLongitude,
  dateToJulianDay,
  findAngularRootsInInterval,
  formatUTCSecond,
  normalizeDegrees,
} from './exactTiming.js';

const { constants } = sweph;

export interface MarchEquinoxInput {
  startYear: number;
  endYear: number;
}

export interface MarchEquinoxEvent {
  gregorianYear: number;
  exactUTC: string;
  sunLongitude: number;
}

export interface MarchEquinoxResult {
  events: MarchEquinoxEvent[];
}

export function calculateMarchEquinoxes(input: MarchEquinoxInput): MarchEquinoxResult {
  const { startYear, endYear } = input;
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw new Error('startYear and endYear must be integers');
  }
  if (endYear < startYear) {
    throw new Error('endYear must be greater than or equal to startYear');
  }
  if (endYear - startYear > 50) {
    throw new Error('Year range must be 50 years or less');
  }

  const events: MarchEquinoxEvent[] = [];

  for (let year = startYear; year <= endYear; year++) {
    const start = dateToJulianDay(new Date(Date.UTC(year, 2, 18, 0, 0, 0)));
    const end = dateToJulianDay(new Date(Date.UTC(year, 2, 22, 0, 0, 0)));
    const sunLongitude = (julianDay: number) =>
      calcBodyLongitude(julianDay, constants.SE_SUN, 'tropical').longitude;
    const roots = findAngularRootsInInterval(sunLongitude, 0, start, end);
    const root = roots[0];

    if (root === undefined) {
      throw new Error(`No March equinox found for ${year}`);
    }

    events.push({
      gregorianYear: year,
      exactUTC: formatUTCSecond(root),
      sunLongitude: normalizeDegrees(sunLongitude(root)),
    });
  }

  return { events };
}
