import sweph from 'sweph';
import { applySiderealMode, type Ayanamsha } from './ayanamsha.js';

const { constants } = sweph;

// Supported house systems. 'W' = Whole Sign (default), 'P' = Placidus.
// To add more systems, add the sweph house system character here and update
// the HouseSystem type. See: https://www.astro.com/swisseph/swephprg.htm#_Toc58931102
export type HouseSystem = 'W' | 'P';

// Which zodiac the returned longitudes are measured in. Sidereal (Lahiri) is
// the default because it is what every existing caller already receives —
// changing that silently would move every chart by ~24°.
//
// Tropical measures from the vernal equinox, sidereal from the fixed stars;
// they differ by the ayanamsha, which is returned either way. Western
// astrology reads tropical, Jyotish reads sidereal.
export type Zodiac = 'sidereal' | 'tropical';

export interface BirthData {
  year: number;
  month: number;   // 1-12
  day: number;
  hour: number;    // decimal UTC, e.g. 14.5 = 2:30pm UTC
  latitude: number;
  longitude: number;
  houseSystem?: HouseSystem;
  zodiac?: Zodiac;
  // Ignored for a tropical chart, whose longitudes are not measured against
  // the sidereal frame at all. The reported `ayanamsha` still follows it, since
  // that is the number a tropical caller would convert with.
  ayanamsha?: Ayanamsha;
}

export interface PlanetPosition {
  planet: string;
  longitude: number;
  latitude: number;
  distance: number;
  longitudeSpeed: number;
  sign: string;
  degree: number;
  isRetrograde: boolean;
  house: number;
}

export interface HouseCusp {
  house: number;
  longitude: number;
  sign: string;
  degree: number;
}

export interface ChartResult {
  positions: PlanetPosition[];
  houses: HouseCusp[];
  ascendant: number;
  ayanamsha: number;
}

const PLANETS = [
  { id: constants.SE_SUN, name: 'Sun' },
  { id: constants.SE_MOON, name: 'Moon' },
  { id: constants.SE_MERCURY, name: 'Mercury' },
  { id: constants.SE_VENUS, name: 'Venus' },
  { id: constants.SE_MARS, name: 'Mars' },
  { id: constants.SE_JUPITER, name: 'Jupiter' },
  { id: constants.SE_SATURN, name: 'Saturn' },
  { id: constants.SE_URANUS, name: 'Uranus' },
  { id: constants.SE_NEPTUNE, name: 'Neptune' },
  { id: constants.SE_PLUTO, name: 'Pluto' },
  { id: constants.SE_TRUE_NODE, name: 'Rahu' },
  { id: constants.SE_CHIRON, name: 'Chiron' },
];

const SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

function longitudeToSign(lon: number): { sign: string; degree: number } {
  const normalized = ((lon % 360) + 360) % 360;
  const signIndex = Math.floor(normalized / 30);
  return { sign: SIGNS[signIndex] ?? 'Unknown', degree: normalized % 30 };
}

// Returns 1-12 house number for a given ecliptic longitude given house cusps.
// Currently implemented for Whole Sign only — cusp[0] is the Ascendant sign start (0° of that sign).
// For Placidus and other unequal systems, replace this with a proper cusp boundary search.
function getHouseNumber(planetLon: number, cusps: number[]): number {
  const normalized = ((planetLon % 360) + 360) % 360;
  for (let i = 0; i < 12; i++) {
    const cuspStart = cusps[i] ?? 0;
    const cuspEnd = cusps[(i + 1) % 12] ?? 0;
    if (cuspEnd > cuspStart) {
      if (normalized >= cuspStart && normalized < cuspEnd) return i + 1;
    } else {
      // Wraps around 0°/360°
      if (normalized >= cuspStart || normalized < cuspEnd) return i + 1;
    }
  }
  return 1;
}

export function calculateChart(birth: BirthData): ChartResult {
  const houseSystem: HouseSystem = birth.houseSystem ?? 'W';
  const zodiac: Zodiac = birth.zodiac ?? 'sidereal';
  // Everything sweph returns is tropical unless asked otherwise, so a tropical
  // chart is the sidereal one with this shift never applied.
  const shift = zodiac === 'sidereal' ? 1 : 0;

  const julianDay = sweph.julday(
    birth.year, birth.month, birth.day, birth.hour,
    constants.SE_GREG_CAL
  );

  applySiderealMode(birth.ayanamsha);
  // Returned in both modes: tropical callers need it to convert, and it is the
  // only way to tell which zodiac a cached response was computed in.
  const ayanamsha = sweph.get_ayanamsa_ut(julianDay);

  const houseData = sweph.houses(julianDay, birth.latitude, birth.longitude, houseSystem);
  const ascendant = ((houseData.data.points[0] ?? 0) - ayanamsha * shift + 360) % 360;

  // For Whole Sign, cusps must sit at exactly 0° of each sign starting from the
  // ascendant's sign.  Using sweph's tropical Whole Sign cusps and then
  // subtracting ayanamsha shifts them away from sidereal sign boundaries,
  // causing planets near cusps to land in the wrong house. The same derivation
  // works for tropical, since it starts from whichever ascendant was computed
  // above.
  const rawCusps: number[] = (() => {
    if (houseSystem === 'W') {
      const ascSignIndex = Math.floor(ascendant / 30) % 12;
      return Array.from({ length: 12 }, (_, i) => ((ascSignIndex + i) % 12) * 30);
    }
    return houseData.data.houses.map(lon => ((lon - ayanamsha * shift) + 360) % 360);
  })();

  const houseCusps: HouseCusp[] = rawCusps.map((lon, i) => {
    const { sign, degree } = longitudeToSign(lon);
    return { house: i + 1, longitude: lon, sign, degree };
  });

  const calcFlags = zodiac === 'sidereal'
    ? constants.SEFLG_SPEED | constants.SEFLG_SIDEREAL
    : constants.SEFLG_SPEED;

  const positions: PlanetPosition[] = [];

  for (const { id, name } of PLANETS) {
    const result = sweph.calc_ut(julianDay, id, calcFlags);
    const lon = result.data[0] ?? 0;
    const lat = result.data[1] ?? 0;
    const dist = result.data[2] ?? 0;
    const speed = result.data[3] ?? 0;
    const { sign, degree } = longitudeToSign(lon);
    const house = getHouseNumber(lon, rawCusps);

    positions.push({
      planet: name,
      longitude: lon,
      latitude: lat,
      distance: dist,
      longitudeSpeed: speed,
      sign,
      degree,
      isRetrograde: speed < 0,
      house,
    });

    // Ketu is exactly opposite Rahu
    if (name === 'Rahu') {
      const ketuLon = ((lon + 180) % 360 + 360) % 360;
      const ketuSign = longitudeToSign(ketuLon);
      positions.push({
        planet: 'Ketu',
        longitude: ketuLon,
        latitude: -lat,
        distance: dist,
        longitudeSpeed: speed,
        sign: ketuSign.sign,
        degree: ketuSign.degree,
        isRetrograde: speed < 0,
        house: getHouseNumber(ketuLon, rawCusps),
      });
    }
  }

  return { positions, houses: houseCusps, ascendant, ayanamsha };
}
