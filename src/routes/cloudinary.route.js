const express = require('express');
const router = express.Router();

const CloudinaryController = require('../controllers/cloudinary.controller');
const {
  getTokenFromCookie,
  verifyTokenWithRole,
} = require('../middlewares/token.middleware');

/**
 * @swagger
 * tags:
 *   name: Cloudinary
 *   description: Signed upload helpers for Cloudinary direct uploads
 *
 * /cloudinary/sign:
 *   post:
 *     summary: Create a short-lived signed upload payload for comment images
 *     tags: [Cloudinary]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               publicId:
 *                 type: string
 *                 description: Optional Cloudinary public id, without slashes.
 *     responses:
 *       200:
 *         description: Signature generated
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Authentication required
 */
router.post(
  '/sign',
  getTokenFromCookie,
  verifyTokenWithRole(['citizen', 'admin']),
  CloudinaryController.signCommentUpload,
);

module.exports = router;
