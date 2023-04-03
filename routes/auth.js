const express = require('express');
const { registerAccount } = require('../services/auth');

const authRouter = express.Router();

authRouter.post("/signup", registerAccount);

module.exports = authRouter;