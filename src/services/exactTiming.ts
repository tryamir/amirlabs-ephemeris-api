import sweph from 'sweph';
import { applySiderealMode, type Ayanamsha } from './ayanamsha.js';

const { constants } = sweph;

export type CoordinateSystem = 'sidereal' | 'tropical';

export interface LongitudeSample {
  julianDay: number;
  longitude: number;
  latitude: number;
  distance: number;
  longitudeSpeed: number;
}

export interface LongitudeRoot {
  julianDay: number;
  exactUTC: string;
  longitude: number;
}

export interface TransitSearchInput {
  body: string;
  targetLongitude: number;
  startUTC: string;
  endUTC: string;
  coordinateSystem?: CoordinateSystem;
  // Only consulted for a sidereal search — a tropical longitude is measured
  // from the equinox and owes nothing to an ayanamsha.
  ayanamsha?: Ayanamsha;
}

const BODY_IDS: Record<string, number> = {
  sun: constants.SE_SUN,
  moon: constants.SE_MOON,
  mercury: constants.SE_MERCURY,
  venus: constants.SE_VENUS,
  mars: constants.SE_MARS,
  jupiter: constants.SE_JUPITER,
  saturn: constants.SE_SATURN,
  uranus: constants.SE_URANUS,
  neptune: constants.SE_NEPTUNE,
  pluto: constants.SE_PLUTO,
  rahu: constants.SE_TRUE_NODE,
  true_node: constants.SE_TRUE_NODE,
  chiron: constants.SE_CHIRON,
};

const MS_PER_DAY = 86400000;
const DEFAULT_STEP_DAYS = 0.25;
const ROOT_TOLERANCE_DAYS = 0.5 / 86400;
const VALUE_TOLERANCE_DEGREES = 1e-8;

function isInHalfOpenInterval(value: number, start: number, end: number): boolean {
  return value >= start && value < end;
}

export function parseUTCDate(value: string, fieldName: string): Date {
  if (!/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${fieldName} must include a UTC timezone designator`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO UTC date`);
  }
  return date;
}

export function dateToJulianDay(date: Date): number {
  return date.getTime() / MS_PER_DAY + 2440587.5;
}

export function julianDayToDate(julianDay: number): Date {
  return new Date((julianDay - 2440587.5) * MS_PER_DAY);
}

export function formatUTCSecond(julianDay: number): string {
  const roundedMs = Math.round(julianDayToDate(julianDay).getTime() / 1000) * 1000;
  return new Date(roundedMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function signedAngleDegrees(value: number): number {
  const normalized = normalizeDegrees(value + 180) - 180;
  return normalized === -180 ? 180 : normalized;
}

function unwrapNear(value: number, reference: number): number {
  return value + 360 * Math.round((reference - value) / 360);
}

export function calcBodyLongitude(
  julianDay: number,
  bodyId: number,
  coordinateSystem: CoordinateSystem = 'sidereal',
  ayanamsha?: Ayanamsha,
): LongitudeSample {
  if (coordinateSystem === 'sidereal') {
    applySiderealMode(ayanamsha);
  }

  const flags = constants.SEFLG_SPEED | (coordinateSystem === 'sidereal' ? constants.SEFLG_SIDEREAL : 0);
  const result = sweph.calc_ut(julianDay, bodyId, flags);

  return {
    julianDay,
    longitude: normalizeDegrees(result.data[0] ?? 0),
    latitude: result.data[1] ?? 0,
    distance: result.data[2] ?? 0,
    longitudeSpeed: result.data[3] ?? 0,
  };
}

export function bodyIdForName(body: string): number {
  const bodyId = BODY_IDS[body.trim().toLowerCase()];
  if (bodyId === undefined) {
    throw new Error(`Unsupported body: ${body}`);
  }
  return bodyId;
}

function bisectRoot(
  fn: (julianDay: number) => number,
  left: number,
  right: number,
): number {
  let a = left;
  let b = right;
  let fa = fn(a);
  let fb = fn(b);

  if (Math.abs(fa) <= VALUE_TOLERANCE_DEGREES) return a;
  if (Math.abs(fb) <= VALUE_TOLERANCE_DEGREES) return b;

  for (let i = 0; i < 80 && b - a > ROOT_TOLERANCE_DAYS; i++) {
    const mid = (a + b) / 2;
    const fm = fn(mid);

    if (Math.abs(fm) <= VALUE_TOLERANCE_DEGREES) return mid;

    if ((fa <= 0 && fm >= 0) || (fa >= 0 && fm <= 0)) {
      b = mid;
      fb = fm;
    } else {
      a = mid;
      fa = fm;
    }
  }

  return Math.abs(fa) < Math.abs(fb) ? a : b;
}

export function findRootsInInterval(
  fn: (julianDay: number) => number,
  startJulianDay: number,
  endJulianDay: number,
  stepDays = DEFAULT_STEP_DAYS,
): number[] {
  const roots: number[] = [];
  let left = startJulianDay;
  let leftValue = fn(left);

  if (Math.abs(leftValue) <= VALUE_TOLERANCE_DEGREES) {
    roots.push(left);
  }

  while (left < endJulianDay) {
    const right = Math.min(left + stepDays, endJulianDay);
    const rightValue = fn(right);

    const bracketsRoot =
      (leftValue < 0 && rightValue > 0) ||
      (leftValue > 0 && rightValue < 0) ||
      Math.abs(rightValue) <= VALUE_TOLERANCE_DEGREES;

    if (bracketsRoot) {
      const root = bisectRoot(fn, left, right);
      const isDuplicate = roots.some(existing => Math.abs(existing - root) < ROOT_TOLERANCE_DAYS * 2);
      if (!isDuplicate && isInHalfOpenInterval(root, startJulianDay, endJulianDay)) {
        roots.push(root);
      }
    }

    left = right;
    leftValue = rightValue;
  }

  return roots;
}

export function findAngularRootsInInterval(
  angleFn: (julianDay: number) => number,
  targetAngle: number,
  startJulianDay: number,
  endJulianDay: number,
  stepDays = DEFAULT_STEP_DAYS,
): number[] {
  const roots: number[] = [];
  const normalizedTarget = normalizeDegrees(targetAngle);
  let left = startJulianDay;
  let leftAngle = normalizeDegrees(angleFn(left));
  let unwrappedLeft = leftAngle;

  while (left < endJulianDay) {
    const right = Math.min(left + stepDays, endJulianDay);
    const rightAngle = normalizeDegrees(angleFn(right));
    const unwrappedRight = unwrappedLeft + signedAngleDegrees(rightAngle - leftAngle);
    const minAngle = Math.min(unwrappedLeft, unwrappedRight);
    const maxAngle = Math.max(unwrappedLeft, unwrappedRight);
    const firstK = Math.ceil((minAngle - normalizedTarget) / 360);
    const lastK = Math.floor((maxAngle - normalizedTarget) / 360);

    for (let k = firstK; k <= lastK; k++) {
      const target = normalizedTarget + 360 * k;
      const leftValue = unwrappedLeft - target;
      const rightValue = unwrappedRight - target;

      if (
        Math.abs(leftValue) > VALUE_TOLERANCE_DEGREES &&
        Math.abs(rightValue) > VALUE_TOLERANCE_DEGREES &&
        ((leftValue < 0 && rightValue < 0) || (leftValue > 0 && rightValue > 0))
      ) {
        continue;
      }

      const rootFn = (julianDay: number) => unwrapNear(normalizeDegrees(angleFn(julianDay)), target) - target;
      const root = bisectRoot(rootFn, left, right);
      const isDuplicate = roots.some(existing => Math.abs(existing - root) < ROOT_TOLERANCE_DAYS * 2);

      if (!isDuplicate && isInHalfOpenInterval(root, startJulianDay, endJulianDay)) {
        roots.push(root);
      }
    }

    left = right;
    leftAngle = rightAngle;
    unwrappedLeft = unwrappedRight;
  }

  return roots;
}

export function findExactTransits(input: TransitSearchInput): LongitudeRoot[] {
  const startDate = parseUTCDate(input.startUTC, 'startUTC');
  const endDate = parseUTCDate(input.endUTC, 'endUTC');

  if (endDate <= startDate) {
    throw new Error('endUTC must be after startUTC');
  }

  const bodyId = bodyIdForName(input.body);
  const coordinateSystem = input.coordinateSystem ?? 'sidereal';
  const ayanamsha = input.ayanamsha;
  const targetLongitude = normalizeDegrees(input.targetLongitude);
  const startJulianDay = dateToJulianDay(startDate);
  const endJulianDay = dateToJulianDay(endDate);

  const angleFn = (julianDay: number) =>
    calcBodyLongitude(julianDay, bodyId, coordinateSystem, ayanamsha).longitude;

  return findAngularRootsInInterval(angleFn, targetLongitude, startJulianDay, endJulianDay).map(julianDay => ({
    julianDay,
    exactUTC: formatUTCSecond(julianDay),
    longitude: calcBodyLongitude(julianDay, bodyId, coordinateSystem, ayanamsha).longitude,
  }));
}
