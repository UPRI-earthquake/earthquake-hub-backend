const fs = require('fs/promises');
const path = require('path');

// Local overlay cache paths. Stored in repo under src/data/overlays.
const OVERLAY_PATHS = {
  faults: path.join(__dirname, '..', 'data', 'overlays', 'faults.geojson'),
  plates: path.join(__dirname, '..', 'data', 'overlays', 'plates.geojson'),
};

async function loadOverlay(key) {
  const filePath = OVERLAY_PATHS[key];
  if (!filePath) throw new Error(`Unknown overlay: ${key}`);
  const buf = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  return { buf, mtime: stat.mtime };
}

module.exports = {
  loadOverlay,
  OVERLAY_PATHS,
};
