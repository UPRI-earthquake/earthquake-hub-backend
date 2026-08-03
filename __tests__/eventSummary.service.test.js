const EventSummaryService = require('../src/services/eventSummary.service');

function event(overrides = {}) {
  return {
    publicID: 'event-1',
    OT: '2026-04-02T00:48:00.000Z',
    latitude_value: 0.85,
    longitude_value: 126.71,
    magnitude_value: 7.3,
    depth_value: 24.4,
    place: '524 km S 16° E of Balut Island',
    ...overrides,
  };
}

describe('canonical event summary publication', () => {
  it('generates deterministic plain text in Philippine time', () => {
    expect(EventSummaryService.generateEventSummary(event())).toBe(
      'A magnitude 7.3 earthquake was recorded near 524 km S 16° E of Balut Island on April 2, 2026, at 8:48:00 AM PHT, with a reported depth of 24 km. The reported epicenter was located at 0.850°N latitude and 126.710°E longitude.',
    );
  });

  it('publishes only an approved custom summary by default', () => {
    const draft = EventSummaryService.serializePublicEvent(event({
      summaryOverride: { text: 'Unapproved draft.', reviewStatus: 'draft', editedBy: 'operator' },
    }), { allowUnapproved: false });
    expect(draft.eventSummary).toBe(draft.generatedSummary);
    expect(draft.summaryOverride).toBeUndefined();
    expect(draft.summaryPublication).toMatchObject({
      compatibilityMode: false,
      policy: 'approved_only',
      source: 'generated',
    });

    const approved = EventSummaryService.serializePublicEvent(event({
      summaryOverride: { text: 'Reviewed public summary.', reviewStatus: 'approved', approvedBy: 'reviewer' },
    }), { allowUnapproved: false });
    expect(approved.eventSummary).toBe('Reviewed public summary.');
    expect(approved.summaryOverride).toEqual({
      text: 'Reviewed public summary.',
      reviewStatus: 'approved',
    });
    expect(approved.summaryPublication.source).toBe('approved_custom');
    expect(approved.summaryOverride.approvedBy).toBeUndefined();
  });

  it('supports an explicit temporary compatibility mode for unapproved summaries', () => {
    const published = EventSummaryService.serializePublicEvent(event({
      summaryOverride: { text: 'Legacy public summary.', reviewStatus: 'needs_review' },
    }), { allowUnapproved: true });
    expect(published.eventSummary).toBe('Legacy public summary.');
    expect(published.summaryPublication).toMatchObject({
      compatibilityMode: true,
      policy: 'compatibility',
      source: 'compatibility_custom',
    });
  });

  it('retains unpublished custom content only in the admin projection', () => {
    const admin = EventSummaryService.enrichAdminEvent(event({
      summaryOverride: { text: 'Needs review.', reviewStatus: 'needs_review', editedBy: 'operator' },
    }), { allowUnapproved: false });
    expect(admin.summaryOverride.text).toBe('Needs review.');
    expect(admin.effectiveSummary).toBe(admin.generatedSummary);
    expect(admin.summaryPublication).toMatchObject({
      customReviewStatus: 'needs_review',
      customSummaryAvailable: true,
      customSummaryPublished: false,
    });
  });
});
