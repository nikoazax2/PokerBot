const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const file = path.join(process.cwd(), 'historique.json');
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') return res.status(200).json([]);
        return res.status(500).json({ error: 'Cannot read historique.json' });
      }
      try {
        const json = JSON.parse(data || '[]');
        res.status(200).json(json);
      } catch {
        res.status(500).json({ error: 'Invalid JSON in historique.json' });
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected error' });
  }
};
