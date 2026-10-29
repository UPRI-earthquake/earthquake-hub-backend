// The per-area database settings: defaults, typos, and areas that can only move after the areas they
// point to (src/db/areaDatabase.js)
const { areaDatabase, selectRepository } = require('../src/db/areaDatabase');

describe('area database settings', () => {
  const saved = { ...process.env };
  const implementations = { mongodb: () => 'mongodb repo', postgres: () => 'postgres repo' };

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.EARTHQUAKES_DB;
    delete process.env.PEOPLE_AND_SENSORS_DB;
  });

  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  test('unset means mongodb; a value in another case or with spaces is accepted', () => {
    expect(areaDatabase('EARTHQUAKES_DB')).toBe('mongodb');
    process.env.EARTHQUAKES_DB = ' Postgres ';
    expect(areaDatabase('EARTHQUAKES_DB')).toBe('postgres');
  });

  test('an unknown value stops the backend', () => {
    process.env.EARTHQUAKES_DB = 'postgress';
    expect(() => areaDatabase('EARTHQUAKES_DB')).toThrow('EARTHQUAKES_DB must be "mongodb" or "postgres" (got "postgress")');
  });

  test('an area can be on PostgreSQL only when the areas it points to are too', () => {
    const select = () => selectRepository('earthquake events', 'EARTHQUAKES_DB', implementations, { dependsOn: ['PEOPLE_AND_SENSORS_DB'] });

    expect(select()).toBe('mongodb repo');
    process.env.PEOPLE_AND_SENSORS_DB = 'postgres';
    expect(select()).toBe('mongodb repo');
    process.env.EARTHQUAKES_DB = 'postgres';
    expect(select()).toBe('postgres repo');
    process.env.PEOPLE_AND_SENSORS_DB = 'mongodb';
    expect(select).toThrow('EARTHQUAKES_DB=postgres needs PEOPLE_AND_SENSORS_DB=postgres: earthquake events point to that data in PostgreSQL');
  });

  test('the events repository refuses EARTHQUAKES_DB=postgres while accounts and devices are on MongoDB', () => {
    process.env.EARTHQUAKES_DB = 'postgres';
    process.env.PEOPLE_AND_SENSORS_DB = 'mongodb';

    jest.isolateModules(() => {
      expect(() => require('../src/repositories/events.repo')).toThrow(/EARTHQUAKES_DB=postgres needs PEOPLE_AND_SENSORS_DB=postgres/);
    });
  });
});
