const jwt = require('jsonwebtoken');
const request = require('supertest');
const cloudinary = require('cloudinary').v2;

function signCitizenToken(payload = {}) {
  return jwt.sign(
    {
      username: 'citizen.owner@example.com',
      role: 'citizen',
      ...payload,
    },
    process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB,
    { expiresIn: '1h' },
  );
}

describe('Cloudinary signed upload route', () => {
  let app;
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      ACCESS_TOKEN_PRIVATE_KEY_WEB: 'test-web-secret',
      REFRESH_TOKEN_PRIVATE_KEY_WEB: 'test-refresh-secret',
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-api-key',
      CLOUDINARY_API_SECRET: 'test-api-secret',
    };
    app = require('../src/app');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects unauthenticated signing requests', async () => {
    const response = await request(app).post('/api/cloudinary/sign').send({});

    expect(response.statusCode).toBe(403);
  });

  it('generates a signed payload scoped to the authenticated user', async () => {
    const token = signCitizenToken();
    const response = await request(app)
      .post('/api/cloudinary/sign')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`])
      .send({ publicId: 'comment_upload_1' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      api_key: 'test-api-key',
      cloud_name: 'test-cloud',
      folder: 'upri/comments/citizen_owner_example_com',
      upload_preset: 'upri_comments',
      tags: 'comment,user_citizen_owner_example_com',
      public_id: 'comment_upload_1',
    });
    expect(response.body).not.toHaveProperty('api_secret');

    const expectedSignature = cloudinary.utils.api_sign_request(
      {
        timestamp: response.body.timestamp,
        folder: response.body.folder,
        upload_preset: response.body.upload_preset,
        tags: response.body.tags,
        context: response.body.context,
        allowed_formats: response.body.allowed_formats,
        public_id: response.body.public_id,
      },
      'test-api-secret',
    );
    expect(response.body.signature).toBe(expectedSignature);
    expect(response.body.payload.signature).toBe(expectedSignature);
  });

  it('does not allow clients to override server-controlled upload scope', async () => {
    const token = signCitizenToken({ username: 'safe-user' });
    const response = await request(app)
      .post('/api/cloudinary/sign')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`])
      .send({
        folder: 'upri/comments/other-user',
        upload_preset: 'different',
        tags: 'admin',
      });

    expect(response.statusCode).toBe(400);
    expect(response.body?.status).toBe(101);
  });

  it('rejects unsafe public ids', async () => {
    const token = signCitizenToken();
    const response = await request(app)
      .post('/api/cloudinary/sign')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`])
      .send({ publicId: '../escape' });

    expect(response.statusCode).toBe(400);
    expect(response.body?.message).toMatch(/publicId/i);
  });

  it('reports missing Cloudinary configuration without exposing secrets', async () => {
    const token = signCitizenToken();
    const previousSecret = process.env.CLOUDINARY_API_SECRET;
    delete process.env.CLOUDINARY_API_SECRET;

    const response = await request(app)
      .post('/api/cloudinary/sign')
      .set('Cookie', [`accessToken=${token}; refreshToken=${token}`])
      .send({});

    process.env.CLOUDINARY_API_SECRET = previousSecret;

    expect(response.statusCode).toBe(500);
    expect(response.body?.errorCode).toBe('config_missing');
    expect(JSON.stringify(response.body)).not.toContain('test-api-secret');
  });
});
