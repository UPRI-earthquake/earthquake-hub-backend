import express from 'express';
import { checkDuplicateUsernameOrEmail } from '../middleware/verifySignup.js'
import { registerAccount } from '../controllers/auth.js';

const authRouter = express.Router();

authRouter.post("/signup", checkDuplicateUsernameOrEmail, registerAccount);

export default authRouter;
