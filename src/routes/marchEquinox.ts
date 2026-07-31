import { Router, type Request, type Response } from 'express';
import { calculateMarchEquinoxes, type MarchEquinoxInput } from '../services/marchEquinox.js';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  try {
    const { startYear, endYear } = req.body as MarchEquinoxInput;

    if (startYear === undefined || endYear === undefined) {
      res.status(400).json({ error: 'Missing required fields: startYear, endYear' });
      return;
    }

    res.json(calculateMarchEquinoxes({ startYear, endYear }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid March equinox request' });
  }
});

export default router;
