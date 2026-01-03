#!/usr/bin/env node
/* Fetch and cache overlay GeoJSON (faults, plates) locally for serving. */
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const axios = require('axios');
const { OVERLAY_PATHS } = require('../src/services/overlays.service');

const SOURCES = {
  faults:
    'https://cdn.jsdelivr.net/gh/GEMScienceTools/gem-global-active-faults@master/geojson/gem_active_faults_harmonized.geojson',
  plates:
    'https://cdn.jsdelivr.net/gh/fraxen/tectonicplates@master/GeoJSON/PB2002_boundaries.json',
};

// Philippines bbox (lon/lat): 116..127E, 4.5..21.5N
const PH_BBOX = [116, 4.5, 127, 21.5];

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
}

function featureInBbox(feature, bbox) {
  if (!bbox) return true;
  const [minX, minY, maxX, maxY] = bbox;
  const geom = feature && feature.geometry;
  if (!geom) return false;

  const testCoord = ([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY;

  switch (geom.type) {
    case 'LineString':
      return geom.coordinates.some(testCoord);
    case 'MultiLineString':
      return geom.coordinates.some((line) => line.some(testCoord));
    case 'Polygon':
      return geom.coordinates.some((ring) => ring.some(testCoord));
    case 'MultiPolygon':
      return geom.coordinates.some((poly) => poly.some((ring) => ring.some(testCoord)));
    case 'Point':
      return testCoord(geom.coordinates);
    case 'MultiPoint':
      return geom.coordinates.some(testCoord);
    default:
      return true;
  }
}

async function download(key, url, destPath) {
  await ensureDir(destPath);
  // Stream to file to avoid holding large buffers
  const res = await axios.get(url, { responseType: 'stream' });
  await new Promise((resolve, reject) => {
    const write = fs.createWriteStream(destPath);
    res.data.pipe(write);
    write.on('finish', resolve);
    write.on('error', reject);
  });
  const stat = await fsPromises.stat(destPath);
  console.log(`✓ ${key} saved (${(stat.size / 1024 / 1024).toFixed(2)} MB) -> ${destPath}`);
}

async function trimFaultsToPH(destPath) {
  try {
    const raw = await fsPromises.readFile(destPath, 'utf8');
    const gj = JSON.parse(raw);
    const features = Array.isArray(gj.features) ? gj.features : [];
    const trimmed = features.filter((f) => featureInBbox(f, PH_BBOX));
    const fc = { type: 'FeatureCollection', features: trimmed };
    await fsPromises.writeFile(destPath, JSON.stringify(fc));
    const stat = await fsPromises.stat(destPath);
    console.log(
      `  → faults trimmed to PH bbox ${PH_BBOX.join(', ')}: ${trimmed.length}/${features.length} features, ${(stat.size / 1024 / 1024).toFixed(2)} MB`,
    );
  } catch (err) {
    console.warn('  ! Failed to trim faults to PH bbox; serving full dataset.', err.message);
  }
}

async function main() {
  for (const [key, url] of Object.entries(SOURCES)) {
    const dest = OVERLAY_PATHS[key];
    if (!dest) {
      console.warn(`Skipping unknown overlay key: ${key}`);
      continue;
    }
    try {
      console.log(`Fetching ${key} from ${url}`);
      await download(key, url, dest);
      if (key === 'faults') {
        await trimFaultsToPH(dest);
      }
    } catch (err) {
      console.error(`Failed to fetch ${key}:`, err.message);
      process.exitCode = 1;
    }
  }
}

main();
