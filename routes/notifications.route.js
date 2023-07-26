const express = require('express');
const NotificationsController = require('../controllers/notifications.controller');

const router = express.Router();

router.post('/subscribe', 
  NotificationsController.subscribe
)

module.exports = router

