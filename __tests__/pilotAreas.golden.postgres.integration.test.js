// The dev setup: Pilot areas that have moved run on PostgreSQL
const { describePilotAreasGolden } = require('./fixtures/pilotAreasGolden');

describePilotAreasGolden({ JOB_LOCKS_DB: 'postgres', PUSH_SUBSCRIPTIONS_DB: 'postgres', SIGNIFICANT_EQS_DB: 'postgres' });
