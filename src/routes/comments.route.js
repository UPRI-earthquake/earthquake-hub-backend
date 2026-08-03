const express = require('express');
const router = express.Router();
const CommentsController = require('../controllers/comments.controller');
const multer = require('multer');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { getUploadConfig } = require('../config/upload.config');
const { createInMemoryRateLimiter, positiveIntegerEnv } = require('../middlewares/rateLimit.middleware');
const { requireAdminCsrf } = require('../middlewares/adminCsrf.middleware');
const AdminCommunityReportsController = require('../controllers/adminCommunityReports.controller');
const {
  requireAdminCapability,
  requireTypedTargetConfirmation,
} = require('../middlewares/adminActionPolicy.middleware');
const { ACTIONS } = require('../services/adminCapabilities.service');

const {
  getTokenFromCookie,
  getTokenFromBearerIfPresent,
  verifyTokenWithRole,
  verifyTokenWithRoleOptional,
  getTokenFromCookieIfPresent
} = require('../middlewares/token.middleware')

const { uploadDir: UPLOAD_DIR, publicUploadPath: PUBLIC_UPLOAD_PATH } = getUploadConfig();
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REPORT_POST_RATE_LIMIT_WINDOW_MS = positiveIntegerEnv('REPORT_POST_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
const REPORT_POST_RATE_LIMIT_MAX = positiveIntegerEnv('REPORT_POST_RATE_LIMIT_MAX', 10);
const ALLOWED_IMAGE_EXTENSIONS = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer setup for report image storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const extension = ALLOWED_IMAGE_EXTENSIONS[file.mimetype];
    const filename = `${Date.now()}-${randomUUID()}${extension}`;
    req.imageURL = `${PUBLIC_UPLOAD_PATH}/${filename}`;
    cb(null, filename);
  }
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: function (req, file, cb) {
    if (!ALLOWED_IMAGE_EXTENSIONS[file.mimetype]) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
      return;
    }
    cb(null, true);
  },
});

const limitReportPosts = createInMemoryRateLimiter({
  windowMs: REPORT_POST_RATE_LIMIT_WINDOW_MS,
  max: REPORT_POST_RATE_LIMIT_MAX,
  keyGenerator: (req) => req.accountId || req.username || req.ip || 'anonymous',
  message: 'Too many report submissions. Please try again later.',
});

function uploadReportImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      const isSizeError = err.code === 'LIMIT_FILE_SIZE';
      res.status(400).json({
        status: 1,
        message: isSizeError
          ? 'Report image must be 5 MB or smaller.'
          : 'Report image must be a JPG, PNG, GIF, or WebP file.',
      });
      return;
    }

    next(err);
  });
}

/**
 * @swagger
 * tags:
 *   name: Comments
 *   description: API for managing comments on events
 *
 * /comments:
 *   post:
 *     summary: Create a new comment on an event
 *     tags: [Comments]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - eventId
 *             properties:
 *               eventId:
 *                 type: string
 *                 description: The ID of the event being commented on
 *               anonymous:
 *                 type: boolean
 *                 description: Whether to hide the authenticated citizen username. Defaults to true.
 *               content:
 *                 type: string
 *                 description: Optional text content. A report must include text or an uploaded image.
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Optional uploaded report image.
 *     responses:
 *       201:
 *         description: Comment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   description: The status code for the response.
 *                   example: 0
 *                 message:
 *                   type: string
 *                   description: The message associated with the response.
 *                   example: "Comment created successfully"
 *                 payload:
 *                   $ref: '#/components/schemas/Comment'
 *   get:
 *     summary: Get all comments for a specific event
 *     tags: [Comments]
 *     parameters:
 *       - in: query
 *         name: eventId
 *         schema:
 *           type: string
 *         description: The ID of the event to retrieve comments for
 *         required: true
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Maximum number of comments to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of comments to skip before returning results
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Cursor returned by the previous page. When supplied, cursor pagination is used instead of offset.
 *     responses:
 *       200:
 *         description: Comments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: number
 *                   description: The status code for the response.
 *                   example: 0
 *                 message:
 *                   type: string
 *                   description: The message associated with the response.
 *                   example: "Comments retrieved successfully"
 *                 payload:
 *                   type: array
 *                   description: An array of comments for the specified event.
 *                   items:
 *                     $ref: '#/components/schemas/Comment'
 *       404:
 *         description: Event not found
 *
 * /comments/{commentId}/status:
 *   patch:
 *     summary: Update comment moderation status (admin only)
 *     tags: [Comments]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID identifier of the comment to moderate
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentStatus
 *               - currentCaseStatus
 *               - currentCaseVersion
 *               - status
 *               - reason
 *             properties:
 *               currentStatus:
 *                 type: string
 *                 enum: [pending, approved, rejected]
 *               currentCaseStatus:
 *                 type: string
 *                 enum: [open, investigating, escalated, resolved]
 *               currentCaseVersion:
 *                 type: integer
 *                 minimum: 0
 *               status:
 *                 type: string
 *                 enum: [pending, approved, rejected]
 *               reason:
 *                 type: string
 *                 description: Required administrator audit and case-history note
 *     responses:
 *       200:
 *         description: Comment status updated successfully
 *       403:
 *         description: Forbidden - admin authentication required
 *       404:
 *         description: Comment not found
 *
 * /comments/{commentId}:
 *   delete:
 *     summary: Delete a comment (admin only)
 *     tags: [Comments]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID identifier of the comment to delete
 *     responses:
 *       200:
 *         description: Comment deleted successfully
 *       403:
 *         description: Forbidden - admin authentication required
 *       404:
 *         description: Comment not found
 */

router.post('/', getTokenFromCookieIfPresent, verifyTokenWithRoleOptional('citizen'), limitReportPosts, uploadReportImage, CommentsController.createComment);
router.get('/', getTokenFromCookieIfPresent, verifyTokenWithRoleOptional('citizen'), CommentsController.getCommentsByEventId);
router.put('/:commentId/helpful', getTokenFromCookieIfPresent, verifyTokenWithRoleOptional('citizen'), CommentsController.markCommentHelpful);
router.delete('/:commentId/helpful', getTokenFromCookieIfPresent, verifyTokenWithRoleOptional('citizen'), CommentsController.unmarkCommentHelpful);
router.post('/:commentId/issues', getTokenFromCookieIfPresent, verifyTokenWithRoleOptional('citizen'), CommentsController.reportCommentIssue);
router.patch(
  '/:commentId/status',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.COMMUNITY_REPORT_MODERATION),
  AdminCommunityReportsController.updateCommunityReportStatus,
);
router.delete(
  '/:commentId',
  getTokenFromCookie,
  verifyTokenWithRole('admin'),
  requireAdminCsrf,
  requireAdminCapability(ACTIONS.COMMUNITY_REPORT_DELETION),
  requireTypedTargetConfirmation({
    actionId: ACTIONS.COMMUNITY_REPORT_DELETION,
    eventType: 'community_report.delete',
    paramName: 'commentId',
    targetType: 'community_report',
  }),
  AdminCommunityReportsController.deleteCommunityReport,
);
module.exports = router;
