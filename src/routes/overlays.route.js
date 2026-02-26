const express = require('express');
const router = express.Router();
const { loadOverlay } = require('../services/overlays.service');

// Serve cached overlay GeoJSON (faults/plates/par) from local disk.
// These are static assets in src/data/overlays/; faults/plates can be refreshed
// via scripts/fetch-overlays.js.
const sendOverlay = (key) => async (req, res, next) => {
  try {
    const { buf, mtime } = await loadOverlay(key);
    res.setHeader('Content-Type', 'application/geo+json');
    // Allow long cache since data changes rarely; clients can bust on deploy/hash.
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=43200');
    res.setHeader('Last-Modified', mtime.toUTCString());
    res.send(buf);
    res.message = `${key} overlay served`;
  } catch (err) {
    err.statusCode = 404;
    next(err);
  }
};

/**
 * @swagger
 * /overlays/faults:
 *   get:
 *     summary: Returns cached Fault Lines GeoJSON (GEM Global Active Faults)
 *     tags: [Overlays]
 *     responses:
 *       200:
 *         description: GeoJSON FeatureCollection
 *         content:
 *           application/geo+json:
 *             schema:
 *               type: object
 *       404:
 *         description: Overlay not available
 */
router.get('/faults', sendOverlay('faults'));

/**
 * @swagger
 * /overlays/plates:
 *   get:
 *     summary: Returns cached Plate Boundaries GeoJSON (PB2002)
 *     tags: [Overlays]
 *     responses:
 *       200:
 *         description: GeoJSON FeatureCollection
 *         content:
 *           application/geo+json:
 *             schema:
 *               type: object
 *       404:
 *         description: Overlay not available
 */
router.get('/plates', sendOverlay('plates'));

/**
 * @swagger
 * /overlays/par:
 *   get:
 *     summary: Returns PAR (Philippine Area of Responsibility) GeoJSON
 *     tags: [Overlays]
 *     responses:
 *       200:
 *         description: GeoJSON FeatureCollection
 *         content:
 *           application/geo+json:
 *             schema:
 *               type: object
 *       404:
 *         description: Overlay not available
 */
router.get('/par', sendOverlay('par'));

module.exports = router;
