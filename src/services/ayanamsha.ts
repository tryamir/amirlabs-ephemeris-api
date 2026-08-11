import sweph from 'sweph';

const { constants } = sweph;

// Which ayanamsha a sidereal calculation is measured against.
//
// The ayanamsha is the gap between the tropical zodiac (measured from the
// vernal equinox) and the sidereal one (measured from the fixed stars). It is
// currently about 24°, and it grows by roughly 50 arcseconds a year — but
// exactly where the sidereal zodiac begins is a matter of school rather than
// observation, so there is no single right value. The schools below differ by
// up to about a degree, which is enough to move a planet across a sign
// boundary, and about two hours' worth of nakshatra, which moves dasha dates.
//
// Lahiri is the default because it is the Indian government standard, the most
// widely used, and what every existing caller already receives — changing that
// silently would move charts that are already cached.
export type Ayanamsha =
  | 'lahiri'
  | 'raman'
  | 'krishnamurti'
  | 'yukteshwar'
  | 'jnBhasin';

export const DEFAULT_AYANAMSHA: Ayanamsha = 'lahiri';

const SIDEREAL_MODES: Record<Ayanamsha, number> = {
  lahiri: constants.SE_SIDM_LAHIRI,
  raman: constants.SE_SIDM_RAMAN,
  krishnamurti: constants.SE_SIDM_KRISHNAMURTI,
  yukteshwar: constants.SE_SIDM_YUKTESHWAR,
  jnBhasin: constants.SE_SIDM_JN_BHASIN,
};

export const AYANAMSHAS = Object.keys(SIDEREAL_MODES) as Ayanamsha[];

export function isAyanamsha(value: unknown): value is Ayanamsha {
  // `hasOwn`, not `in`: `in` walks the prototype chain, so "toString" and
  // "constructor" would pass the guard and then index the table to a function,
  // which reaches sweph as a sidereal mode.
  return typeof value === 'string' && Object.hasOwn(SIDEREAL_MODES, value);
}

// Sets the sidereal frame for everything computed after it.
//
// Swiss Ephemeris keeps this as process-global state, so every entry point that
// computes anything sidereal has to set it rather than assume it — which is why
// this is called again per request instead of once at startup.
export function applySiderealMode(ayanamsha: Ayanamsha = DEFAULT_AYANAMSHA): void {
  sweph.set_sid_mode(SIDEREAL_MODES[ayanamsha], 0, 0);
}
