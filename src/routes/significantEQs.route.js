const express = require('express');
const router = express.Router();
const SignificantEQsController = require('../controllers/significantEQs.controller');
const { cacheSeconds } = require('../middlewares/cache.middleware');
const {
  getTokenFromCookie,
  verifyTokenWithRole,
} = require('../middlewares/token.middleware');

/**
  * @swagger
  * components:
  *   schemas:
  *     SignificantEQ:
  *       type: object
  *       properties:
  *         _id:
  *           type: string
  *           description: The event's id, as in the rest of the API.
  *           example: "6a55b0c31966b94943a86b01"
  *         publicID:
  *           type: string
  *           example: "gfz2026lcqt"
  *         title:
  *           type: string
  *           description: "M<magnitude> Earthquake, <place name, or region>"
  *           example: "M7.8 Earthquake, 24 km SW of Soccsksargen, Philippines"
  *         magnitude:
  *           type: number
  *           example: 7.8
  *         depth:
  *           type: number
  *           description: In kilometres.
  *           example: 10
  *         location:
  *           type: string
  *           description: The place name, or the region text when there's none.
  *           example: "24 km SW of Soccsksargen, Philippines"
  *         eventTime:
  *           type: string
  *           format: date-time
  *           example: "2026-06-07T03:12:45.000Z"
  *         eventSummary:
  *           type: string
  *           description: The event's admin-edited summary (PATCH /eq-events/{publicID}/summary), or one built from the event.
  *           example: "A magnitude 7.8 earthquake struck 24 km SW of Soccsksargen, Philippines on June 7, 2026 at a depth of 10 km."
  *     SignificantEQDetails:
  *       type: object
  *       properties:
  *         instrumentRecordings:
  *           type: array
  *           description: Station codes whose recordings the detail page shows.
  *           items:
  *             type: string
  *           example: ["R3B2D", "R1382"]
  *         references:
  *           type: array
  *           description: Links to reports about the earthquake (http or https).
  *           items:
  *             type: string
  *           example: ["https://earthquake.phivolcs.dost.gov.ph/2026_Earthquake_Information/June/2026_0607_0312_B1.html"]
  */

/**
  * @swagger
  * /significant-eqs/all:
  *   get:
  *     summary: The significant earthquakes, picked and ordered by the significance score
  *     description: >
  *       score = magnitude term (100 x M² / 6.5) x distance weight (1 within 200 km of the Philippines,
  *       0 from 1,500 km) x depth weight (1 to 70 km, 0.8 to 300 km, 0.5 deeper) + 25 per signed-in
  *       account with an approved report (up to 20). Events scoring 600 or more are significant: highest
  *       score first, then newest, then publicID; at most 50. Based on the USGS significance score.
  *     tags: [Significant EQs]
  *     responses:
  *       200:
  *         description: The significant earthquakes (an empty list when none qualify).
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: 0
  *                 message:
  *                   type: string
  *                   example: "All Significant Earthquakes found"
  *                 payload:
  *                   type: array
  *                   items:
  *                     allOf:
  *                       - $ref: '#/components/schemas/SignificantEQ'
  *                       - type: object
  *                         properties:
  *                           significance:
  *                             type: number
  *                             description: The event's score, rounded.
  *                             example: 924
  *       500:
  *         description: Internal server error
  */
router.get('/all', cacheSeconds(300), SignificantEQsController.getAllSignificantEQs);

/**
  * @swagger
  * /significant-eqs:
  *   post:
  *     summary: One earthquake for the significant earthquake page, with its recordings and references
  *     description: Any event can be opened, significant or not.
  *     tags: [Significant EQs]
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             properties:
  *               id:
  *                 type: string
  *                 description: The event's _id.
  *                 example: "6a55b0c31966b94943a86b01"
  *     responses:
  *       200:
  *         description: The earthquake.
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 status:
  *                   type: number
  *                   example: 0
  *                 message:
  *                   type: string
  *                   example: "Earthquake Information found"
  *                 payload:
  *                   allOf:
  *                     - $ref: '#/components/schemas/SignificantEQ'
  *                     - $ref: '#/components/schemas/SignificantEQDetails'
  *       400:
  *         description: Invalid earthquake id.
  *       404:
  *         description: No such earthquake.
  */
router.post('/', SignificantEQsController.getEarthquakeInfo);

/**
  * @swagger
  * /significant-eqs/{id}/details:
  *   put:
  *     summary: Set an earthquake's instrument recordings and/or references (admins)
  *     description: >
  *       A list left out keeps its value; send an empty list to clear one. There's no form for this in
  *       the frontend, so call it directly with an admin session cookie, e.g.
  *       curl -X PUT https://<host>/api/significant-eqs/<id>/details -H 'Content-Type: application/json'
  *       -H 'Cookie: accessToken=<admin session token>'
  *       -d '{"instrumentRecordings": ["R3B2D", "R1382"], "references": ["https://earthquake.phivolcs.dost.gov.ph/..."]}'
  *     tags: [Significant EQs]
  *     security:
  *       - cookieAuth: []
  *     parameters:
  *       - in: path
  *         name: id
  *         required: true
  *         description: The event's _id.
  *         schema:
  *           type: string
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             $ref: '#/components/schemas/SignificantEQDetails'
  *     responses:
  *       200:
  *         description: Saved. The payload is the earthquake's details.
  *       400:
  *         description: Invalid id, or a list that isn't station codes / http(s) links (up to 50 each).
  *       403:
  *         description: Admin session cookie is required.
  *       404:
  *         description: No such earthquake.
  *   delete:
  *     summary: Remove an earthquake's instrument recordings and references (admins)
  *     description: >
  *       e.g. curl -X DELETE https://<host>/api/significant-eqs/<id>/details -H 'Cookie: accessToken=<admin session token>'
  *     tags: [Significant EQs]
  *     security:
  *       - cookieAuth: []
  *     parameters:
  *       - in: path
  *         name: id
  *         required: true
  *         description: The event's _id.
  *         schema:
  *           type: string
  *     responses:
  *       200:
  *         description: Removed.
  *       400:
  *         description: Invalid id.
  *       403:
  *         description: Admin session cookie is required.
  *       404:
  *         description: No such earthquake, or it has no details.
  */
router.put('/:id/details', getTokenFromCookie, verifyTokenWithRole('admin'), SignificantEQsController.setDetails);
router.delete('/:id/details', getTokenFromCookie, verifyTokenWithRole('admin'), SignificantEQsController.removeDetails);

module.exports = router;
