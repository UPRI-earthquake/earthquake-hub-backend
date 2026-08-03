jest.mock('../src/services/EQevents.service', () => ({
  addPlacesAttribute: jest.fn(),
  getEventByPublicID: jest.fn(),
}));

const EQEventsService = require('../src/services/EQevents.service');
const MessagingService = require('../src/services/messaging.service');

describe('SC_EVENT public summary projection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVENT_SUMMARY_ALLOW_UNAPPROVED_COMPAT = 'false';
    MessagingService.eventCache.removeAllListeners('newEvent');
    MessagingService.eventCache.cache = [];
  });

  it('reloads the persisted event and publishes its approved custom summary', async () => {
    const persisted = {
      publicID: 'event-1',
      OT: '2026-04-02T00:48:00.000Z',
      magnitude_value: 5.2,
      depth_value: 14,
      summaryOverride: {
        text: 'Approved operational summary.',
        reviewStatus: 'approved',
        approvedBy: 'reviewer',
      },
    };
    EQEventsService.getEventByPublicID.mockResolvedValue(persisted);
    EQEventsService.addPlacesAttribute.mockResolvedValue([persisted]);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const emitted = new Promise((resolve) => {
      MessagingService.eventCache.once('newEvent', resolve);
    });

    await MessagingService.eventCache.newEvent(
      'SC_*',
      { publicID: 'event-1', eventType: 'UPDATE' },
      'SC_EVENT',
    );

    await expect(emitted).resolves.toMatchObject({
      name: 'SC_EVENT',
      data: {
        effectiveSummary: 'Approved operational summary.',
        summaryOverride: {
          text: 'Approved operational summary.',
          reviewStatus: 'approved',
        },
        summaryPublication: { source: 'approved_custom' },
      },
    });
    expect(EQEventsService.getEventByPublicID).toHaveBeenCalledWith('event-1');
    expect(EQEventsService.addPlacesAttribute).toHaveBeenCalledWith([persisted]);
    log.mockRestore();
  });
});
