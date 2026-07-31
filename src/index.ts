import express from 'express';
import chartRoutes from './routes/chart.js';
import dashaRoutes from './routes/dasha.js';
import moonPhasesRoutes from './routes/moonPhases.js';
import marchEquinoxRoutes from './routes/marchEquinox.js';
import solarReturnRoutes from './routes/solarReturn.js';
import { requireApiKey } from './middleware/apiKey.js';
import { telemetry, uptimeSeconds, requestCount } from './services/analytics.js';

const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = 2; // Whole Sign house system fix

// First, so that every response is counted — including the 401s below.
app.use(telemetry);

// Unauthenticated on purpose: the uptime prober in .github/workflows/uptime.yml
// runs outside this app's trust boundary, and a health check that needs the API
// key would mean shipping the key to CI just to ask whether the process is up.
// Nothing here is sensitive, and it grants no new ability — an anonymous
// request already reaches the app (it gets a 401) and already wakes a stopped
// machine, so this adds no exposure beyond what the 401 path had.
//
// `uptime_s` is the useful bit: a small value means the machine had stopped and
// this request cold-started it.
app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    uptime_s: uptimeSeconds(),
    requests: requestCount(),
    schemaVersion: API_VERSION,
  });
});

app.use(express.json());
app.use(requireApiKey);

app.get('/api/version', (_req, res) => {
  res.json({ schemaVersion: API_VERSION });
});

app.use('/api/chart', chartRoutes);
app.use('/api/dasha', dashaRoutes);
app.use('/api/moon-phases', moonPhasesRoutes);
app.use('/api/march-equinox', marchEquinoxRoutes);
app.use('/api/solar-return', solarReturnRoutes);

app.listen(PORT, () => {
  console.log(`ephemeris-api running on port ${PORT}`);
});
