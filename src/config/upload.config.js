const path = require('path');

const DEFAULT_PUBLIC_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads_dev');
const DEFAULT_PUBLIC_UPLOAD_PATH = '/uploads';
const LEGACY_PUBLIC_UPLOAD_PATH = '/uploads_dev';

function isProductionEnv() {
  return process.env.NODE_ENV === 'production';
}

function normalizePublicUploadPath(value) {
  if (typeof value !== 'string') return DEFAULT_PUBLIC_UPLOAD_PATH;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_PUBLIC_UPLOAD_PATH;
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '') || DEFAULT_PUBLIC_UPLOAD_PATH;
}

function resolveUploadDir() {
  const configuredDir = typeof process.env.UPLOAD_DIR === 'string' ? process.env.UPLOAD_DIR.trim() : '';
  if (!configuredDir) {
    if (isProductionEnv()) {
      throw new Error('UPLOAD_DIR must be configured when NODE_ENV=production.');
    }
    return DEFAULT_PUBLIC_UPLOAD_DIR;
  }
  return path.resolve(configuredDir);
}

function getUploadConfig() {
  return {
    uploadDir: resolveUploadDir(),
    publicUploadPath: normalizePublicUploadPath(process.env.UPLOAD_PUBLIC_PATH),
    legacyPublicUploadPath: LEGACY_PUBLIC_UPLOAD_PATH,
    defaultPublicUploadDir: DEFAULT_PUBLIC_UPLOAD_DIR,
  };
}

module.exports = {
  DEFAULT_PUBLIC_UPLOAD_DIR,
  DEFAULT_PUBLIC_UPLOAD_PATH,
  LEGACY_PUBLIC_UPLOAD_PATH,
  getUploadConfig,
  isProductionEnv,
  normalizePublicUploadPath,
};
