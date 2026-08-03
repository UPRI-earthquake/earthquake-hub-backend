const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Joi = require('joi');
const mongoose = require('mongoose');
const Account = require('../models/account.model');
const {
  CURRENT_PASSWORD_POLICY_VERSION,
  passwordSchema,
  usernameSchema,
} = require('../controllers/helpers');
const AuditLogService = require('./auditLog.service');

const LOCK_ID = 'first-admin-bootstrap-v1';
const LOCK_TTL_MS = 10 * 60 * 1000;

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bootstrapSchema() {
  return Joi.object({
    username: usernameSchema('Admin username').trim().required(),
    email: Joi.string().trim().lowercase().email().max(254).required(),
    password: passwordSchema('Admin password').required(),
  }).required();
}

function bootstrapError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function acquireBootstrapLock(now = new Date()) {
  const collection = mongoose.connection.collection('administrative_locks');
  const ownerId = crypto.randomUUID();
  const document = {
    _id: LOCK_ID,
    ownerId,
    acquiredAt: now,
    expiresAt: new Date(now.getTime() + LOCK_TTL_MS),
  };

  try {
    await collection.insertOne(document);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const released = await collection.deleteOne({ _id: LOCK_ID, expiresAt: { $lte: now } });
    if (!released.deletedCount) {
      throw bootstrapError(
        'ADMIN_BOOTSTRAP_IN_PROGRESS',
        'Another first-admin bootstrap is currently running.',
      );
    }
    await collection.insertOne(document);
  }

  return async () => {
    await collection.deleteOne({ _id: LOCK_ID, ownerId });
  };
}

async function recordBootstrap(outcome, target, metadata = {}) {
  return AuditLogService.record({
    username: 'system-bootstrap',
    role: 'system',
    method: 'MAINTENANCE',
    path: '/scripts/bootstrap-admin',
    headers: {},
  }, {
    eventType: 'admin.account.bootstrap',
    outcome,
    target,
    metadata,
  });
}

async function bootstrapFirstAdmin(input) {
  const { error, value } = bootstrapSchema().validate(input, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) throw error;

  if (await Account.exists({ roles: 'admin' })) {
    throw bootstrapError(
      'ADMIN_ALREADY_EXISTS',
      'An admin account already exists; first-admin bootstrap is permanently disabled.',
    );
  }

  const releaseLock = await acquireBootstrapLock();
  let account;
  try {
    if (await Account.exists({ roles: 'admin' })) {
      throw bootstrapError(
        'ADMIN_ALREADY_EXISTS',
        'An admin account already exists; first-admin bootstrap is permanently disabled.',
      );
    }
    if (await Account.exists({ username: value.username })) {
      throw bootstrapError('USERNAME_EXISTS', 'The requested admin username is already in use.');
    }
    if (await Account.exists({
      email: new RegExp(`^${escapeRegex(value.email)}$`, 'i'),
    })) {
      throw bootstrapError('EMAIL_EXISTS', 'The requested admin email is already in use.');
    }

    const pendingTarget = {
      type: 'admin_account',
      id: value.username,
      label: value.username,
    };
    await recordBootstrap('started', pendingTarget);

    try {
      account = await Account.create({
        username: value.username,
        email: value.email,
        password: await bcrypt.hash(value.password, 10),
        roles: ['admin'],
        isApproved: true,
        isActive: true,
        adminRole: 'super_admin',
        sessionVersion: 0,
        passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
        passwordUpdatedAt: new Date(),
      });
    } catch (createError) {
      await recordBootstrap('failed', pendingTarget, {
        errorCode: createError.code || createError.name || 'account_create_failed',
      }).catch(() => {});
      throw createError;
    }

    const createdTarget = {
      type: 'admin_account',
      id: String(account._id),
      label: account.username,
    };
    try {
      await recordBootstrap('succeeded', createdTarget, {
        passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
      });
    } catch (auditError) {
      const rollback = await Account.deleteOne({ _id: account._id, roles: 'admin' });
      await recordBootstrap('failed', createdTarget, {
        accountRolledBack: rollback.deletedCount === 1,
        errorCode: 'success_audit_failed',
      }).catch(() => {});
      if (rollback.deletedCount !== 1) {
        throw bootstrapError(
          'ADMIN_BOOTSTRAP_ROLLBACK_FAILED',
          'Admin account was created but its audit record and automatic rollback failed.',
        );
      }
      throw bootstrapError(
        'ADMIN_BOOTSTRAP_AUDIT_FAILED',
        'Admin account creation was rolled back because its audit record could not be stored.',
      );
    }

    return {
      accountId: String(account._id),
      email: account.email,
      username: account.username,
      adminRole: account.adminRole,
    };
  } finally {
    await releaseLock();
  }
}

module.exports = {
  acquireBootstrapLock,
  bootstrapFirstAdmin,
  bootstrapSchema,
};
