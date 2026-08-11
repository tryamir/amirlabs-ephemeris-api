import sweph from 'sweph';
import { applySiderealMode } from './ayanamsha.js';
import type { BirthData } from './ephemeris.js';

const { constants } = sweph;

// Vimshottari Dasha sequence and period lengths (in years, total = 120)
const DASHA_SEQUENCE = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'] as const;
type DashaPlanet = typeof DASHA_SEQUENCE[number];

const DASHA_YEARS: Record<DashaPlanet, number> = {
  Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7,
  Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17,
};

// 27 nakshatras, each 13°20' wide, ruled in repeating Dasha sequence order
const NAKSHATRA_LORDS: DashaPlanet[] = Array.from({ length: 27 }, (_, i) => DASHA_SEQUENCE[i % 9] as DashaPlanet);

const NAKSHATRA_SPAN = 360 / 27; // 13.333...°
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function julianDayToDate(jd: number): Date {
  return new Date((jd - 2440587.5) * 86400000);
}

function addYears(date: Date, years: number): Date {
  return new Date(date.getTime() + years * MS_PER_YEAR);
}

// Returns index into DASHA_SEQUENCE for a given planet
function dashaIndex(planet: DashaPlanet): number {
  return DASHA_SEQUENCE.indexOf(planet);
}

// Returns the planet that is N positions after `start` in the dasha cycle
function dashaAt(start: DashaPlanet, offset: number): DashaPlanet {
  return DASHA_SEQUENCE[(dashaIndex(start) + offset) % 9] as DashaPlanet;
}

export interface PratyandarDasha {
  planet: string;
  startDate: string;
  endDate: string;
}

export interface AntarDasha {
  planet: string;
  startDate: string;
  endDate: string;
  pratyantar: PratyandarDasha[];
}

export interface MahaDasha {
  planet: string;
  startDate: string;
  endDate: string;
  antardasha: AntarDasha[];
}

export function calculateDashas(birth: BirthData): MahaDasha[] {
  const julianDay = sweph.julday(
    birth.year, birth.month, birth.day, birth.hour,
    constants.SE_GREG_CAL
  );

  // The periods are read from the Moon's nakshatra, which is a division of the
  // sidereal zodiac — so the ayanamsha moves the boundaries, and with them
  // every date in the cycle. A dasha computed under one school is not the same
  // cycle as one computed under another.
  applySiderealMode(birth.ayanamsha);

  const moonResult = sweph.calc_ut(julianDay, constants.SE_MOON, constants.SEFLG_SPEED | constants.SEFLG_SIDEREAL);
  const moonLon = ((moonResult.data[0] ?? 0) + 360) % 360;

  const nakshatraIndex = Math.floor(moonLon / NAKSHATRA_SPAN);
  const lord = NAKSHATRA_LORDS[nakshatraIndex] as DashaPlanet;
  const positionInNakshatra = moonLon % NAKSHATRA_SPAN;
  const fractionRemaining = 1 - positionInNakshatra / NAKSHATRA_SPAN;
  const remainingYears = fractionRemaining * DASHA_YEARS[lord];

  const birthDate = julianDayToDate(julianDay);
  const mahaStartDate = new Date(birthDate.getTime() - (DASHA_YEARS[lord] - remainingYears) * MS_PER_YEAR);

  const mahas: MahaDasha[] = [];
  let mahaStart = mahaStartDate;

  for (let m = 0; m < 9; m++) {
    const mahaPlanet = dashaAt(lord, m);
    const mahaYears = DASHA_YEARS[mahaPlanet];
    const mahaEnd = addYears(mahaStart, mahaYears);

    const antardashas: AntarDasha[] = [];
    let antarStart = mahaStart;

    for (let a = 0; a < 9; a++) {
      const antarPlanet = dashaAt(mahaPlanet, a);
      const antarYears = (mahaYears * DASHA_YEARS[antarPlanet]) / 120;
      const antarEnd = addYears(antarStart, antarYears);

      const pratyantars: PratyandarDasha[] = [];
      let pratStart = antarStart;

      for (let p = 0; p < 9; p++) {
        const pratPlanet = dashaAt(antarPlanet, p);
        const pratYears = (antarYears * DASHA_YEARS[pratPlanet]) / 120;
        const pratEnd = addYears(pratStart, pratYears);

        pratyantars.push({
          planet: pratPlanet,
          startDate: pratStart.toISOString().split('T')[0] as string,
          endDate: pratEnd.toISOString().split('T')[0] as string,
        });

        pratStart = pratEnd;
      }

      antardashas.push({
        planet: antarPlanet,
        startDate: antarStart.toISOString().split('T')[0] as string,
        endDate: antarEnd.toISOString().split('T')[0] as string,
        pratyantar: pratyantars,
      });

      antarStart = antarEnd;
    }

    mahas.push({
      planet: mahaPlanet,
      startDate: mahaStart.toISOString().split('T')[0] as string,
      endDate: mahaEnd.toISOString().split('T')[0] as string,
      antardasha: antardashas,
    });

    mahaStart = mahaEnd;
  }

  return mahas;
}
