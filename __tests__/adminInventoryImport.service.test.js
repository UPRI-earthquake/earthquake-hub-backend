jest.mock('../src/models/device.model', () => ({ find: jest.fn() }));

const Device = require('../src/models/device.model');
const AdminInventoryImportService = require('../src/services/adminInventoryImport.service');

describe('admin inventory import service', () => {
  it('publishes explicit future-integration metadata without enabling host execution', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    const select = jest.fn(() => ({ lean }));
    const sort = jest.fn(() => ({ select }));
    Device.find.mockReturnValue({ sort });

    const workflow = await AdminInventoryImportService.getWorkflow();

    expect(workflow.capabilities).toEqual(expect.objectContaining({
      schemaVersion: '1.0',
      hostExecutorConfigured: false,
      applyEnabled: false,
      hostExecutor: expect.objectContaining({
        available: false,
        unavailability: expect.objectContaining({
          kind: 'implementation_required',
          runbook: expect.objectContaining({ path: 'docs/admin-action-capabilities.md' }),
        }),
      }),
    }));
    expect(workflow.capabilities.hostExecutor.unavailability.prerequisites)
      .toEqual(expect.arrayContaining([expect.stringContaining('least-privilege host identity')]));
  });
});
