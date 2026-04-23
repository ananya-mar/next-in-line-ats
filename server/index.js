const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const app = express();

const jobRoutes = require('./routes/jobs');
const applicationRoutes = require('./routes/applications');
const { startDecayScheduler } = require('./services/decayScheduler');

app.use(cors());
app.use(express.json());

app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startDecayScheduler();
});