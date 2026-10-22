// The rollback setup (and production's): every Pilot area on MongoDB
const { describePilotAreasGolden } = require('./fixtures/pilotAreasGolden');

describePilotAreasGolden({ JOB_LOCKS_DB: 'mongodb', PUSH_SUBSCRIPTIONS_DB: 'mongodb' });
