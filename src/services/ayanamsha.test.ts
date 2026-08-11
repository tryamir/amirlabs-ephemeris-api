import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AYANAMSHAS, DEFAULT_AYANAMSHA, isAyanamsha } from './ayanamsha.js';
import { calculateChart } from './ephemeris.js';
import { calculateDashas } from './dasha.js';
import { calculateSolarReturn } from './solarReturn.js';

// The same fixed birth moment the other suites use: 24 Oct 1987, 14:07 UTC,
// Tehran.
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

describe('ayanamsha input', () => {
  it('accepts every school it offers and nothing else', () => {
    for (const school of AYANAMSHAS) {
      assert.ok(isAyanamsha(school), `${school} should be accepted`);
    }

    assert.ok(!isAyanamsha('fagan_bradley'), 'a school not offered is not accepted');
    assert.ok(!isAyanamsha('LAHIRI'), 'the value is a fixed token, not free text');
    assert.ok(!isAyanamsha(''));
    assert.ok(!isAyanamsha(1));
    assert.ok(!isAyanamsha(undefined));
    // `in` on a plain object would say yes to these.
    assert.ok(!isAyanamsha('toString'));
    assert.ok(!isAyanamsha('constructor'));
  });

  it('offers the five schools the apps list', () => {
    assert.deepEqual(
      [...AYANAMSHAS].sort(),
      ['jnBhasin', 'krishnamurti', 'lahiri', 'raman', 'yukteshwar'],
    );
  });
});

describe('calculateChart ayanamsha', () => {
  it('defaults to Lahiri, so callers that send nothing are unaffected', () => {
    const implicit = calculateChart({ ...BIRTH });
    const explicit = calculateChart({ ...BIRTH, ayanamsha: DEFAULT_AYANAMSHA });

    assert.equal(DEFAULT_AYANAMSHA, 'lahiri');
    assert.equal(sunLongitude(implicit), sunLongitude(explicit));
    assert.equal(implicit.ayanamsha, explicit.ayanamsha);
  });

  it('gives each school its own offset', () => {
    const offsets = AYANAMSHAS.map(
      ayanamsha => calculateChart({ ...BIRTH, ayanamsha }).ayanamsha,
    );

    assert.equal(new Set(offsets).size, AYANAMSHAS.length, 'two schools reported the same offset');
    for (const offset of offsets) {
      // All five are within about a degree of each other in the modern era.
      assert.ok(offset > 22 && offset < 25, `implausible ayanamsha: ${offset}`);
    }
  });

  /// The schools disagree by up to about a degree, and a longitude moves by
  /// exactly that much — which is the whole reason the setting is worth having.
  it('moves sidereal longitudes by the difference between schools', () => {
    const lahiri = calculateChart({ ...BIRTH, ayanamsha: 'lahiri' });
    const raman = calculateChart({ ...BIRTH, ayanamsha: 'raman' });

    const positionGap = (sunLongitude(raman) - sunLongitude(lahiri) + 360) % 360;
    const offsetGap = (lahiri.ayanamsha - raman.ayanamsha + 360) % 360;

    assert.ok(offsetGap > 0.1, 'Lahiri and Raman should not agree');
    assert.ok(
      Math.abs(positionGap - offsetGap) < 0.001,
      `expected ${offsetGap}, got ${positionGap}`,
    );
  });

  /// A tropical longitude is measured from the equinox, so no school of
  /// sidereal reckoning can move it. Only the reported offset changes, which is
  /// the number a tropical caller would convert with.
  it('leaves tropical longitudes alone', () => {
    const lahiri = calculateChart({ ...BIRTH, zodiac: 'tropical', ayanamsha: 'lahiri' });
    const raman = calculateChart({ ...BIRTH, zodiac: 'tropical', ayanamsha: 'raman' });

    assert.equal(sunLongitude(lahiri), sunLongitude(raman));
    assert.equal(lahiri.ascendant, raman.ascendant);
    assert.notEqual(lahiri.ayanamsha, raman.ayanamsha);
  });
});

describe('calculateDashas ayanamsha', () => {
  /// The periods are read from the Moon's nakshatra, a division of the sidereal
  /// zodiac — so the school moves the boundaries and with them every date.
  it('moves the period dates', () => {
    const lahiri = calculateDashas({ ...BIRTH, ayanamsha: 'lahiri' });
    const raman = calculateDashas({ ...BIRTH, ayanamsha: 'raman' });

    assert.equal(lahiri.length, raman.length);
    assert.notEqual(
      lahiri[0]?.startDate,
      raman[0]?.startDate,
      'the same nakshatra position under two schools',
    );
  });

  it('defaults to Lahiri', () => {
    const implicit = calculateDashas({ ...BIRTH });
    const explicit = calculateDashas({ ...BIRTH, ayanamsha: 'lahiri' });

    assert.deepEqual(implicit[0], explicit[0]);
  });
});

describe('calculateSolarReturn ayanamsha', () => {
  const returnUnder = (ayanamsha: 'lahiri' | 'raman', sunLongitudeAtBirth: number) =>
    calculateSolarReturn({
      sunLongitude: sunLongitudeAtBirth,
      year: 2026,
      birthMonth: BIRTH.month,
      birthDay: BIRTH.day,
      latitude: BIRTH.latitude,
      longitude: BIRTH.longitude,
      ayanamsha,
    });

  const natalSun = (ayanamsha: 'lahiri' | 'raman') =>
    sunLongitude(calculateChart({ ...BIRTH, ayanamsha }));

  /// The schools cancel: the natal degree is lower under Raman by exactly what
  /// the search frame is lower by, so both find the same instant. Which is
  /// right — the Sun physically returns to where it was once a year, and no
  /// choice of where to measure from moves that moment.
  it('finds the same instant when the natal degree was read under the same school', () => {
    const lahiri = returnUnder('lahiri', natalSun('lahiri'));
    const raman = returnUnder('raman', natalSun('raman'));

    const secondsApart = Math.abs(
      (new Date(lahiri.exactUTC).getTime() - new Date(raman.exactUTC).getTime()) / 1000,
    );
    assert.ok(secondsApart <= 1, `${secondsApart}s apart — the frames should cancel`);
  });

  /// The chart cast for that instant is still read in the chosen frame, so the
  /// placements differ by the gap between the schools — which is the reason the
  /// parameter has to reach this endpoint rather than defaulting.
  it('casts the return chart in the chosen school', () => {
    const lahiri = returnUnder('lahiri', natalSun('lahiri'));
    const raman = returnUnder('raman', natalSun('raman'));

    // Raman's offset is the smaller of the two, so subtracting it leaves every
    // longitude the larger — the gap runs the opposite way to the offsets.
    const gap = (raman.chart.ascendant - lahiri.chart.ascendant + 360) % 360;
    const offsetGap = (lahiri.chart.ayanamsha - raman.chart.ayanamsha + 360) % 360;

    assert.ok(offsetGap > 0.1, 'Lahiri and Raman should not agree');
    assert.ok(Math.abs(gap - offsetGap) < 0.001, `expected ${offsetGap}, got ${gap}`);
  });

  /// The hazard the parameter exists to prevent: a degree read under one school
  /// searched for under another is a degree the chart never had, and the Sun
  /// moves about a degree a day.
  it('lands on the wrong day when the school does not match the natal degree', () => {
    const matched = returnUnder('lahiri', natalSun('lahiri'));
    const mismatched = returnUnder('raman', natalSun('lahiri'));

    const hoursApart = Math.abs(
      (new Date(matched.exactUTC).getTime() - new Date(mismatched.exactUTC).getTime()) / 3_600_000,
    );
    assert.ok(hoursApart > 12, `only ${hoursApart}h apart — expected about a day`);
  });
});
