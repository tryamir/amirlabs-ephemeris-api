import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateChart } from './ephemeris.js';

// A fixed birth moment: 24 Oct 1987, 14:07 UTC, Tehran.
const BIRTH = {
  year: 1987,
  month: 10,
  day: 24,
  hour: 14.1167,
  latitude: 35.6682,
  longitude: 51.3744,
};

function sunLongitude(chart: ReturnType<typeof calculateChart>): number {
  const sun = chart.positions.find(p => p.planet === 'Sun');
  assert.ok(sun, 'chart should include the Sun');
  return sun.longitude;
}

describe('calculateChart zodiac', () => {
  it('defaults to sidereal so existing callers are unaffected', () => {
    const explicit = calculateChart({ ...BIRTH, zodiac: 'sidereal' });
    const implicit = calculateChart(BIRTH);

    assert.equal(sunLongitude(implicit), sunLongitude(explicit));
    assert.equal(implicit.ascendant, explicit.ascendant);
  });

  it('separates the two zodiacs by exactly the ayanamsha', () => {
    const sidereal = calculateChart({ ...BIRTH, zodiac: 'sidereal' });
    const tropical = calculateChart({ ...BIRTH, zodiac: 'tropical' });

    const difference =
      (sunLongitude(tropical) - sunLongitude(sidereal) + 360) % 360;

    assert.ok(
      Math.abs(difference - sidereal.ayanamsha) < 0.001,
      `expected ${sidereal.ayanamsha}, got ${difference}`
    );
  });

  it('reports the ayanamsha in both modes', () => {
    const sidereal = calculateChart({ ...BIRTH, zodiac: 'sidereal' });
    const tropical = calculateChart({ ...BIRTH, zodiac: 'tropical' });

    assert.ok(sidereal.ayanamsha > 20 && sidereal.ayanamsha < 30);
    assert.equal(tropical.ayanamsha, sidereal.ayanamsha);
  });

  it('shifts the ascendant by the ayanamsha too', () => {
    const sidereal = calculateChart({ ...BIRTH, zodiac: 'sidereal' });
    const tropical = calculateChart({ ...BIRTH, zodiac: 'tropical' });

    const difference = (tropical.ascendant - sidereal.ascendant + 360) % 360;
    assert.ok(
      Math.abs(difference - sidereal.ayanamsha) < 0.001,
      `expected ${sidereal.ayanamsha}, got ${difference}`
    );
  });

  it('puts the Sun in the expected sign in each zodiac', () => {
    // Late October: tropical Scorpio, sidereal still Libra — the ~24° gap is
    // exactly what makes the two readings disagree about someone's sign.
    const sidereal = calculateChart({ ...BIRTH, zodiac: 'sidereal' });
    const tropical = calculateChart({ ...BIRTH, zodiac: 'tropical' });

    assert.equal(sidereal.positions.find(p => p.planet === 'Sun')?.sign, 'Libra');
    assert.equal(tropical.positions.find(p => p.planet === 'Sun')?.sign, 'Scorpio');
  });
});

describe('calculateChart whole sign houses', () => {
  it('places cusps at 0° of each sign in both zodiacs', () => {
    for (const zodiac of ['sidereal', 'tropical'] as const) {
      const chart = calculateChart({ ...BIRTH, zodiac, houseSystem: 'W' });

      for (const cusp of chart.houses) {
        assert.ok(
          Math.abs(cusp.longitude % 30) < 0.0001,
          `${zodiac} house ${cusp.house} sits at ${cusp.longitude}, not a sign boundary`
        );
        assert.ok(Math.abs(cusp.degree) < 0.0001);
      }
    }
  });

  it('starts the first house in the ascendant sign', () => {
    for (const zodiac of ['sidereal', 'tropical'] as const) {
      const chart = calculateChart({ ...BIRTH, zodiac, houseSystem: 'W' });
      const first = chart.houses.find(h => h.house === 1);

      assert.equal(
        Math.floor(chart.ascendant / 30),
        Math.floor((first?.longitude ?? -1) / 30),
        `${zodiac} first house should share the ascendant's sign`
      );
    }
  });
});

describe('calculateChart placidus houses', () => {
  it('separates the two zodiacs by the ayanamsha', () => {
    const sidereal = calculateChart({ ...BIRTH, zodiac: 'sidereal', houseSystem: 'P' });
    const tropical = calculateChart({ ...BIRTH, zodiac: 'tropical', houseSystem: 'P' });

    for (const cusp of sidereal.houses) {
      const other = tropical.houses.find(h => h.house === cusp.house);
      const difference = ((other?.longitude ?? 0) - cusp.longitude + 360) % 360;
      assert.ok(
        Math.abs(difference - sidereal.ayanamsha) < 0.001,
        `house ${cusp.house}: expected ${sidereal.ayanamsha}, got ${difference}`
      );
    }
  });

  it('does not force cusps onto sign boundaries', () => {
    const chart = calculateChart({ ...BIRTH, zodiac: 'tropical', houseSystem: 'P' });
    const onBoundary = chart.houses.every(h => Math.abs(h.longitude % 30) < 0.0001);

    assert.equal(onBoundary, false, 'Placidus cusps are angles, not sign starts');
  });
});
