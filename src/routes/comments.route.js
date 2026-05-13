const express = require('express');
const router = express.Router();
const CommentsController = require('../controllers/comments.controller');
const {
  getTokenFromCookie,
  verifyTokenWithRole,
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
 *               - userId
 *               - content
 *             properties:
 *               eventId:
 *                 type: string
 *                 description: The ID of the event being commented on
 *               userId:
 *                 type: string
 *                 description: The ID of the user making the comment
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
 */

router.post('/', CommentsController.createComment);
router.get('/', CommentsController.getCommentsByEventId);
router.delete('/:commentId', getTokenFromCookie, verifyTokenWithRole('admin'), CommentsController.deleteComment);
module.exports = router;