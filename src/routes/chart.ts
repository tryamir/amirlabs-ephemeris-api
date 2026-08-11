import { Router, type Request, type Response } from 'express';
import { AYANAMSHAS, isAyanamsha } from '../services/ayanamsha.js';
import { calculateChart, type BirthData } from '../services/ephemeris.js';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { year, month, day, hour, latitude, longitude, houseSystem, zodiac, ayanamsha } =
    req.body as BirthData;

  if ([year, month, day, hour, latitude, longitude].some(v => v === undefined)) {
    res.status(400).json({ error: 'Missing required fields: year, month, day, hour, latitude, longitude' });
    return;
  }

  if (zodiac !== undefined && zodiac !== 'sidereal' && zodiac !== 'tropical') {
    res.status(400).json({ error: "Invalid zodiac: expected 'sidereal' or 'tropical'" });
    return;
  }

  if (ayanamsha !== undefined && !isAyanamsha(ayanamsha)) {
    res.status(400).json({ error: `Invalid ayanamsha: expected one of ${AYANAMSHAS.join(', ')}` });
    return;
  }

  const result = calculateChart({
    year, month, day, hour, latitude, longitude,
    ...(houseSystem && { houseSystem }),
    ...(zodiac && { zodiac }),
    ...(ayanamsha && { ayanamsha }),
  });
  res.json(result);
});

export default router;
