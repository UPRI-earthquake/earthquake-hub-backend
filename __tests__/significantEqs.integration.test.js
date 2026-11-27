// The significant earthquakes endpoints on PostgreSQL, through the real app: the list the significance
// score picks (src/services/significance.js), one earthquake with its details, the admin endpoints that
// set those details, and the event summary admins edit on the earthquake detail page. Responses the
// frontend reads are also compared with golden files (significant-eqs.*.json).
jest.mock('../src/services/email.service', () => ({ sendMail: jest.fn().mockResolvedValue({}) }));
jest.mock('axios', () => ({ get: jest.fn().mockRejectedValue(new Error('no network in tests')), create: jest.fn() }));

const request = require('supertest');
const { startPostgres, PG_STARTUP_TIMEOUT_MS } = require('./fixtures/postgres.fixture');
const { expectGolden } = require('./fixtures/golden');
const { seedEvent, legacyId } = require('./fixtures/significantEqs');

const PASSWORD = 'Significant-Password-2026!';
const ADMIN = { accountId: '6a00000000000000000000ad', username: 'golden_admin', role: 'admin' };

describe('significant earthquakes (every area on PostgreSQL)', () => {
  let pg;
  let app;
  let adminCookie;

  const send = (req, agent = null) => {
    let call = (agent || request(app))[req.method.toLowerCase()](req.path);
    Object.entries(req.headers || {}).forEach(([name, value]) => { call = call.set(name, value); });
    return req.body === undefined ? call : call.send(req.body).set('Content-Type', 'application/json');
  };
  // The admin's session cookie is recorded as a placeholder
  const recorded = (req) => (req.headers?.Cookie ? { ...req, headers: { ...req.headers, Cookie: '<admin session cookie>' } } : req);
  const check = async (name, req) => {
    const res = await send(req);
    expectGolden(name, recorded(req), res);
    return res;
  };
  const asAdmin = (req) => ({ ...req, headers: { ...(req.headers || {}), Cookie: adminCookie } });

  const LIST = { method: 'GET', path: '/significant-eqs/all' };
  const DETAIL = (id) => ({ method: 'POST', path: '/significant-eqs', body: { id } });
  const DETAILS = (id, body) => ({ method: 'PUT', path: `/significant-eqs/${id}/details`, body });
  const REMOVE_DETAILS = (id) => ({ method: 'DELETE', path: `/significant-eqs/${id}/details` });

  const signedIn = async (username) => {
    const register = await request(app).post('/accounts/register').send({
      role: 'citizen', username, email: `${username}@example.org`, password: PASSWORD, confirmPassword: PASSWORD,
    });
    if (register.status !== 200) throw new Error(`register ${username} failed: ${register.status}`);
    const agent = request.agent(app);
    const res = await agent.post('/accounts/authenticate').send({ identifier: username, password: PASSWORD, role: 'citizen' });
    if (res.status !== 200) throw new Error(`sign-in ${username} failed: ${res.status}`);
    return agent;
  };
  const report = (agent, eventId, content = 'Felt it.') => agent.post('/comments').send({ eventId, content, anonymous: false });

  // Scores (src/services/significance.js): 754, 603 and, with 6 reporters, 615 qualify; 441, 590, the
  // far one and the one with no location don't
  const seedList = async () => ({
    m70: await seedEvent(pg.db, { n: 1, publicID: 'sig2026am70', magnitude: 7.0, at: 'manila', time: '2026-05-01T00:00:00.000Z', place: '3 km N of Quezon City, Metro Manila, Philippines' }),
    deep: await seedEvent(pg.db, { n: 2, publicID: 'sig2026bdeep', magnitude: 7.0, depth: 100, at: 'cebu', time: '2026-04-01T00:00:00.000Z', place: 'Unavailable', region: 'Visayas, Philippines' }),
    offshore: await seedEvent(pg.db, { n: 3, publicID: 'sig2023coff', magnitude: 6.4, depth: 130, at: 'offshoreSouth', time: '2023-02-24T00:00:00.000Z', region: 'Talaud Islands, Indonesia' }),
    far: await seedEvent(pg.db, { n: 4, publicID: 'sig2026dfar', magnitude: 7.7, at: 'tonga', time: '2026-03-24T00:00:00.000Z', region: 'Tonga Islands' }),
    felt6: await seedEvent(pg.db, { n: 5, publicID: 'sig2026efelt', magnitude: 5.5, at: 'davao', time: '2026-03-01T00:00:00.000Z', place: '5 km N of Davao City, Davao del Sur, Philippines', region: 'Mindanao, Philippines' }),
    felt5: await seedEvent(pg.db, { n: 6, publicID: 'sig2026ffelt', magnitude: 5.5, at: 'davao', time: '2026-02-01T00:00:00.000Z', region: 'Mindanao, Philippines' }),
    noLocation: await seedEvent(pg.db, { n: 7, publicID: 'sig2026gnoloc', magnitude: 7.9, at: null, time: '2026-01-01T00:00:00.000Z' }),
  });

  beforeAll(async () => {
    pg = await startPostgres();
    Object.assign(process.env, pg.env, {
      COMMENTS_DEFAULT_STATUS: 'approved',
      REPORT_POST_RATE_LIMIT_MAX: '1000', // every report here comes from one address
      RATE_LIMIT_MAX: '10000',
    });
    app = require('../src/app');
    const { generateAccessToken } = require('../src/controllers/helpers');
    adminCookie = `accessToken=${generateAccessToken(ADMIN, 'web')}`;
  }, PG_STARTUP_TIMEOUT_MS);

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await pg.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await require('../src/db/knex').db.destroy();
    if (pg) await pg.stop();
  });

  describe('the list', () => {
    test('nothing qualifies: 200 with an empty list', async () => {
      await seedEvent(pg.db, { n: 3, publicID: 'sig2023coff', magnitude: 6.4, depth: 130, at: 'offshoreSouth' });
      await seedEvent(pg.db, { n: 4, publicID: 'sig2026dfar', magnitude: 7.7, at: 'tonga' });

      const res = await check('significant-eqs.all.empty', LIST);

      expect(res.status).toBe(200);
      expect(res.body.payload).toEqual([]);
    });

    test('picked and ordered by the significance score; reports count once per signed-in account, if approved', async () => {
      const seeded = await seedList();
      const accounts = [];
      for (let i = 1; i <= 7; i += 1) accounts.push(await signedIn(`reporter${i}`));
      // 6 accounts report on felt6 (one of them twice); 5 on felt5, plus a signed-out report and a rejected one
      for (const agent of accounts.slice(0, 6)) expect((await report(agent, seeded.felt6._id)).status).toBe(201);
      expect((await report(accounts[0], seeded.felt6._id, 'Again.')).status).toBe(201);
      for (const agent of accounts.slice(0, 5)) expect((await report(agent, seeded.felt5._id)).status).toBe(201);
      expect((await request(app).post('/comments').send({ eventId: seeded.felt5._id, content: 'Signed out.', anonymous: true })).status).toBe(201);
      const rejected = await report(accounts[6], seeded.felt5._id, 'To be rejected.');
      expect((await send(asAdmin({ method: 'PATCH', path: `/comments/${rejected.body.payload.commentId}/status`, body: { status: 'rejected' } }))).status).toBe(200);

      const res = await check('significant-eqs.all', LIST);

      expect(res.status).toBe(200);
      expect(res.body.payload.map((eq) => [eq.publicID, eq.significance])).toEqual([
        ['sig2026am70', 754],
        ['sig2026efelt', 615],
        ['sig2026bdeep', 603],
      ]);
      expect(res.body.payload[2]).toMatchObject({
        _id: seeded.deep._id,
        title: 'M7.0 Earthquake, Visayas, Philippines', // no usable place: the region
        location: 'Visayas, Philippines',
        magnitude: 7,
        depth: 100,
        eventSummary: 'A magnitude 7.0 earthquake struck Visayas, Philippines on April 1, 2026 at a depth of 100 km.',
      });
    });

    test('ties: newest first, then by publicID; at most 50', async () => {
      for (let i = 0; i < 55; i += 1) {
        await seedEvent(pg.db, {
          n: 100 + i, publicID: `sig-tie-${String(i).padStart(2, '0')}`, magnitude: 6.5, at: 'manila',
          time: i < 2 ? '2026-06-01T00:00:00.000Z' : '2025-01-01T00:00:00.000Z',
        });
      }

      const { payload } = (await request(app).get('/significant-eqs/all')).body;

      expect(payload).toHaveLength(50);
      expect(payload.slice(0, 4).map((eq) => eq.publicID)).toEqual(['sig-tie-00', 'sig-tie-01', 'sig-tie-02', 'sig-tie-03']);
    });

    test('a summary edited on the earthquake detail page shows on both significant earthquake pages', async () => {
      const seeded = await seedList();
      const edit = await send(asAdmin({ method: 'PATCH', path: '/eq-events/sig2026am70/summary', body: { text: 'Strong shaking across Metro Manila.' } }));
      expect(edit.status).toBe(200);

      const [list, detail] = await Promise.all([request(app).get('/significant-eqs/all'), send(DETAIL(seeded.m70._id))]);

      expect(list.body.payload[0]).toMatchObject({ publicID: 'sig2026am70', eventSummary: 'Strong shaking across Metro Manila.' });
      expect(detail.body.payload.eventSummary).toBe('Strong shaking across Metro Manila.');
    });
  });

  describe('one earthquake', () => {
    test('with empty recordings and references when an admin added none', async () => {
      const seeded = await seedList();

      const res = await check('significant-eqs.by-id', DETAIL(seeded.m70._id));

      expect(res.status).toBe(200);
      expect(res.body.payload).toMatchObject({
        _id: seeded.m70._id,
        publicID: 'sig2026am70',
        title: 'M7.0 Earthquake, 3 km N of Quezon City, Metro Manila, Philippines',
        instrumentRecordings: [],
        references: [],
      });
    });

    test('any event can be opened, significant or not', async () => {
      const seeded = await seedList();
      expect((await send(DETAIL(seeded.far._id))).body.payload).toMatchObject({ publicID: 'sig2026dfar' });
    });

    test('an invalid id: 400; an unknown one: 404', async () => {
      await check('significant-eqs.by-id.invalid', DETAIL('not-an-id'));
      const res = await check('significant-eqs.by-id.not-found', DETAIL(legacyId(999)));
      expect(res.status).toBe(404);
    });
  });

  describe('details (admins)', () => {
    test('set recordings and references; they show on the detail page; a list left out keeps its value', async () => {
      const seeded = await seedList();

      const set = await send(asAdmin(DETAILS(seeded.m70._id, {
        instrumentRecordings: ['r3b2d', 'R1382', 'R3B2D'],
        references: ['https://earthquake.phivolcs.dost.gov.ph/2026_Earthquake_Information/May/2026_0501_0000_B1.html'],
      })));
      expect(set.status).toBe(200);
      expect(set.body.payload).toMatchObject({ instrumentRecordings: ['R3B2D', 'R1382'], editedBy: 'golden_admin' });

      const detail = await check('significant-eqs.by-id.with-details', DETAIL(seeded.m70._id));
      expect(detail.body.payload).toMatchObject({
        instrumentRecordings: ['R3B2D', 'R1382'],
        references: ['https://earthquake.phivolcs.dost.gov.ph/2026_Earthquake_Information/May/2026_0501_0000_B1.html'],
      });

      await send(asAdmin(DETAILS(seeded.m70._id, { references: [] })));
      expect((await send(DETAIL(seeded.m70._id))).body.payload).toMatchObject({ instrumentRecordings: ['R3B2D', 'R1382'], references: [] });
    });

    test('remove them; removing again: 404', async () => {
      const seeded = await seedList();
      await send(asAdmin(DETAILS(seeded.m70._id, { instrumentRecordings: ['R3B2D'] })));

      expect((await send(asAdmin(REMOVE_DETAILS(seeded.m70._id)))).status).toBe(200);
      expect((await send(DETAIL(seeded.m70._id))).body.payload).toMatchObject({ instrumentRecordings: [], references: [] });
      expect((await send(asAdmin(REMOVE_DETAILS(seeded.m70._id)))).status).toBe(404);
    });

    test('only admins: signed out or as a citizen, 403', async () => {
      const seeded = await seedList();
      const citizen = await signedIn('plain_citizen');

      expect((await send(DETAILS(seeded.m70._id, { instrumentRecordings: ['R3B2D'] }))).status).toBe(403);
      expect((await citizen.put(`/significant-eqs/${seeded.m70._id}/details`).send({ instrumentRecordings: ['R3B2D'] })).status).toBe(403);
      expect((await citizen.delete(`/significant-eqs/${seeded.m70._id}/details`)).status).toBe(403);
      expect(await pg.db('significant_eq_details').count({ n: '*' }).first()).toEqual({ n: '0' });
    });

    test('invalid input: 400; an unknown event: 404', async () => {
      const seeded = await seedList();
      const put = (id, body) => send(asAdmin(DETAILS(id, body)));

      expect((await put(seeded.m70._id, {})).status).toBe(400);
      expect((await put(seeded.m70._id, { instrumentRecordings: ['R-3B2D'] })).status).toBe(400);
      expect((await put(seeded.m70._id, { references: ['ftp://example.org/report'] })).status).toBe(400);
      expect((await put(seeded.m70._id, { references: 'https://example.org' })).status).toBe(400);
      expect((await put('not-an-id', { references: [] })).status).toBe(400);
      expect((await put(legacyId(999), { references: [] })).status).toBe(404);
    });

    test('deleted with their event', async () => {
      const seeded = await seedList();
      await send(asAdmin(DETAILS(seeded.m70._id, { instrumentRecordings: ['R3B2D'] })));

      await pg.db('events').where({ id: seeded.m70.id }).del();

      expect(await pg.db('significant_eq_details').count({ n: '*' }).first()).toEqual({ n: '0' });
    });
  });
});
