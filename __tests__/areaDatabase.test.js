// The per-area database settings (src/db/areaDatabase.js): every area is on PostgreSQL. Unset means
// postgres, and anything else, mongodb included, stops the backend at startup.
const { areaDatabase, selectRepository } = require('../src/db/areaDatabase');

describe('area database settings', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.EARTHQUAKES_DB;
  });

  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  test('unset or empty means postgres; a value in another case or with spaces is accepted', () => {
    expect(areaDatabase('EARTHQUAKES_DB')).toBe('postgres');
    process.env.EARTHQUAKES_DB = '';
    expect(areaDatabase('EARTHQUAKES_DB')).toBe('postgres');
    process.env.EARTHQUAKES_DB = ' Postgres ';
    expect(areaDatabase('EARTHQUAKES_DB')).toBe('postgres');
  });

  test('mongodb, or a typo, stops the backend', () => {
    process.env.EARTHQUAKES_DB = 'mongodb';
    expect(() => areaDatabase('EARTHQUAKES_DB')).toThrow('EARTHQUAKES_DB must be "postgres" (got "mongodb")');
    process.env.EARTHQUAKES_DB = 'postgress';
    expect(() => areaDatabase('EARTHQUAKES_DB')).toThrow('EARTHQUAKES_DB must be "postgres" (got "postgress")');
  });

  test('a repository loads only its PostgreSQL implementation', () => {
    const implementations = { mongodb: jest.fn(() => 'mongodb repo'), postgres: jest.fn(() => 'postgres repo') };

    expect(selectRepository('earthquake events', 'EARTHQUAKES_DB', implementations)).toBe('postgres repo');
    expect(implementations.mongodb).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('[db] earthquake events: postgres (EARTHQUAKES_DB)');
  });

  test('a repository refuses to load with its area set to mongodb', () => {
    process.env.EARTHQUAKES_DB = 'mongodb';

    jest.isolateModules(() => {
      expect(() => require('../src/repositories/events.repo')).toThrow('EARTHQUAKES_DB must be "postgres" (got "mongodb")');
    });
  });
});
