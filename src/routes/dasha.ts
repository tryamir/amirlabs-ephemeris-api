import { Router, type Request, type Response } from 'express';
import { AYANAMSHAS, isAyanamsha } from '../services/ayanamsha.js';
import { calculateDashas, type MahaDasha } from '../services/dasha.js';
import type { BirthData } from '../services/ephemeris.js';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { year, month, day, hour, latitude, longitude, ayanamsha } = req.body as BirthData;

  if ([year, month, day, hour, latitude, longitude].some(v => v === undefined)) {
    res.status(400).json({ error: 'Missing required fields: year, month, day, hour, latitude, longitude' });
    return;
  }

  if (ayanamsha !== undefined && !isAyanamsha(ayanamsha)) {
    res.status(400).json({ error: `Invalid ayanamsha: expected one of ${AYANAMSHAS.join(', ')}` });
    return;
  }

  const dashas: MahaDasha[] = calculateDashas({
    year, month, day, hour, latitude, longitude,
    ...(ayanamsha && { ayanamsha }),
  });
  res.json({ dashas });
});

export default router;
