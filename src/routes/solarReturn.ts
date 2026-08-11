import { Router, type Request, type Response } from 'express';
import { AYANAMSHAS, isAyanamsha } from '../services/ayanamsha.js';
import { calculateSolarReturn, type SolarReturnInput } from '../services/solarReturn.js';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { sunLongitude, year, birthMonth, birthDay, latitude, longitude, ayanamsha } =
    req.body as SolarReturnInput;

  if (
    [sunLongitude, year, birthMonth, birthDay, latitude, longitude].some(
      v => v === undefined || v === null,
    )
  ) {
    res.status(400).json({
      error:
        'Missing required fields: sunLongitude, year, birthMonth, birthDay, latitude, longitude',
    });
    return;
  }

  if (ayanamsha !== undefined && !isAyanamsha(ayanamsha)) {
    res.status(400).json({ error: `Invalid ayanamsha: expected one of ${AYANAMSHAS.join(', ')}` });
    return;
  }

  try {
    const result = calculateSolarReturn({
      sunLongitude, year, birthMonth, birthDay, latitude, longitude,
      ...(ayanamsha && { ayanamsha }),
    });
    res.json(result);
  } catch (err) {
    res.status(422).json({ error: (err as Error).message });
  }
});

export default router;
