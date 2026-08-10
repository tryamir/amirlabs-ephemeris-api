import { Router, type Request, type Response } from 'express';
import { calculateChart, type BirthData } from '../services/ephemeris.js';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const { year, month, day, hour, latitude, longitude, houseSystem, zodiac } = req.body as BirthData;

  if ([year, month, day, hour, latitude, longitude].some(v => v === undefined)) {
    res.status(400).json({ error: 'Missing required fields: year, month, day, hour, latitude, longitude' });
    return;
  }

  if (zodiac !== undefined && zodiac !== 'sidereal' && zodiac !== 'tropical') {
    res.status(400).json({ error: "Invalid zodiac: expected 'sidereal' or 'tropical'" });
    return;
  }

  const result = calculateChart({
    year, month, day, hour, latitude, longitude,
    ...(houseSystem && { houseSystem }),
    ...(zodiac && { zodiac }),
  });
  res.json(result);
});

export default router;
