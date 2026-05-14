const express = require('express');
const router = express.Router();
const CommentsController = require('../controllers/comments.controller');
const {
  getTokenFromCookie,
  getTokenFromBearerIfPresent,
  verifyTokenWithRole,
  verifyTokenWithRoleOptional,
  getTokenFromCookieIfPresent
} = require('../middlewares/token.middleware')

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
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - eventId
 *               - content
 *             properties:
 *               eventId:
 *                 type: string
 *                 description: The ID of the event being commented on
 *               userId:
 *                 type: string
 *                 description: The ID of the user making the comment, or Anonymous when omitted
 *               content:
 *                 type: string
 *                 description: The text content of the comment
 *               imageURL:
 *                 type: string
 *                 description: Optional URL to an image attached to the comment
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

router.post('/', getTokenFromCookieIfPresent, verifyTokenWithRoleOptional('citizen'), CommentsController.createComment);
router.get('/', CommentsController.getCommentsByEventId);
router.delete('/:commentId', getTokenFromCookie, verifyTokenWithRole('admin'), CommentsController.deleteComment);
module.exports = router;
