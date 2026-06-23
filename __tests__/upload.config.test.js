describe('upload.config', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalUploadDir = process.env.UPLOAD_DIR;
  const originalUploadPublicPath = process.env.UPLOAD_PUBLIC_PATH;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (typeof originalUploadDir === 'undefined') {
      delete process.env.UPLOAD_DIR;
    } else {
      process.env.UPLOAD_DIR = originalUploadDir;
    }
    if (typeof originalUploadPublicPath === 'undefined') {
      delete process.env.UPLOAD_PUBLIC_PATH;
    } else {
      process.env.UPLOAD_PUBLIC_PATH = originalUploadPublicPath;
    }
    jest.resetModules();
  });

  test('uses the dev fallback upload directory outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.UPLOAD_DIR;

    const { getUploadConfig, DEFAULT_PUBLIC_UPLOAD_DIR } = require('../src/config/upload.config');

    expect(getUploadConfig().uploadDir).toBe(DEFAULT_PUBLIC_UPLOAD_DIR);
  });

  test('throws in production when UPLOAD_DIR is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.UPLOAD_DIR;

    const { getUploadConfig } = require('../src/config/upload.config');

    expect(() => getUploadConfig()).toThrow('UPLOAD_DIR must be configured when NODE_ENV=production.');
  });

  test('normalizes configured production upload settings', () => {
    process.env.NODE_ENV = 'production';
    process.env.UPLOAD_DIR = '/srv/earthquake-hub/uploads';
    process.env.UPLOAD_PUBLIC_PATH = 'uploads/';

    const { getUploadConfig } = require('../src/config/upload.config');

    expect(getUploadConfig()).toMatchObject({
      uploadDir: '/srv/earthquake-hub/uploads',
      publicUploadPath: '/uploads',
      legacyPublicUploadPath: '/uploads_dev',
    });
  });
});
