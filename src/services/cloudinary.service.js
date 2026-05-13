const cloudinary = require('cloudinary').v2;

const DEFAULT_UPLOAD_PRESET = 'upri_comments';
const DEFAULT_ROOT_FOLDER = 'upri/comments';
const DEFAULT_ALLOWED_FORMATS = 'jpg,jpeg,png,webp,gif';
const MAX_PUBLIC_ID_LENGTH = 120;

class CloudinarySignatureError extends Error {
  constructor(code, message, httpStatus = 500) {
    super(message);
    this.name = 'CloudinarySignatureError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function requireCloudinaryConfig(env = process.env) {
  const cloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();

  const missing = [];
  if (!cloudName) missing.push('CLOUDINARY_CLOUD_NAME');
  if (!apiKey) missing.push('CLOUDINARY_API_KEY');
  if (!apiSecret) missing.push('CLOUDINARY_API_SECRET');

  if (missing.length) {
    throw new CloudinarySignatureError(
      'config_missing',
      `Cloudinary upload signing is not configured. Missing: ${missing.join(', ')}`,
      500,
    );
  }

  return { cloudName, apiKey, apiSecret };
}

function sanitizeFolderSegment(value) {
  const segment = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!segment) {
    throw new CloudinarySignatureError(
      'invalid_user',
      'Authenticated user is missing a usable identifier.',
      400,
    );
  }

  return segment.slice(0, 80);
}

function normalizeOptionalPublicId(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const publicId = String(value).trim();
  if (
    publicId.length > MAX_PUBLIC_ID_LENGTH
    || publicId.includes('/')
    || !/^[A-Za-z0-9_-]+$/.test(publicId)
  ) {
    throw new CloudinarySignatureError(
      'invalid_public_id',
      'publicId may only contain letters, numbers, underscores, and hyphens.',
      400,
    );
  }

  return publicId;
}

function buildUploadParams({ username, publicId, timestamp = Math.round(Date.now() / 1000) }) {
  const userSegment = sanitizeFolderSegment(username);
  const paramsToSign = {
    timestamp,
    folder: `${DEFAULT_ROOT_FOLDER}/${userSegment}`,
    upload_preset: process.env.CLOUDINARY_COMMENTS_UPLOAD_PRESET || DEFAULT_UPLOAD_PRESET,
    tags: `comment,user_${userSegment}`,
    context: `app=earthquake_hub|feature=comments|username=${userSegment}`,
    allowed_formats: process.env.CLOUDINARY_COMMENTS_ALLOWED_FORMATS || DEFAULT_ALLOWED_FORMATS,
  };

  const normalizedPublicId = normalizeOptionalPublicId(publicId);
  if (normalizedPublicId) {
    paramsToSign.public_id = normalizedPublicId;
  }

  return paramsToSign;
}

function createCommentUploadSignature({ username, publicId, timestamp } = {}) {
  const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig();
  const paramsToSign = buildUploadParams({ username, publicId, timestamp });
  const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

  return {
    signature,
    timestamp: paramsToSign.timestamp,
    api_key: apiKey,
    cloud_name: cloudName,
    folder: paramsToSign.folder,
    upload_preset: paramsToSign.upload_preset,
    tags: paramsToSign.tags,
    context: paramsToSign.context,
    allowed_formats: paramsToSign.allowed_formats,
    public_id: paramsToSign.public_id,
  };
}

module.exports = {
  CloudinarySignatureError,
  buildUploadParams,
  createCommentUploadSignature,
};
