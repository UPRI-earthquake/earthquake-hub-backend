jest.mock('../src/repositories/significantEqs.repo', () => ({
  isValidId: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
}));

const SignificantEqsRepo = require('../src/repositories/significantEqs.repo');
const SignificantEQsService = require('../src/services/significantEQs.service');

describe('significantEQs.service', () => {
  const eq = { _id: '650000000000000000000001', title: 'Sample earthquake', magnitude: 6.9 };

  beforeEach(() => {
    jest.clearAllMocks();
    SignificantEqsRepo.isValidId.mockReturnValue(true);
  });

  describe('getAllSignificantEQs', () => {
    test('returns every significant earthquake', async () => {
      SignificantEqsRepo.findAll.mockResolvedValue([eq]);

      await expect(SignificantEQsService.getAllSignificantEQs()).resolves.toEqual({
        str: 'success',
        significantEQs: [eq],
      });
    });

    test('reports an empty list as not found', async () => {
      SignificantEqsRepo.findAll.mockResolvedValue([]);

      await expect(SignificantEQsService.getAllSignificantEQs()).resolves.toEqual({
        str: 'noSignificantEQsFound',
      });
    });
  });

  describe('getEarthquakeInfo', () => {
    test('returns the earthquake with this id', async () => {
      SignificantEqsRepo.findById.mockResolvedValue(eq);

      await expect(SignificantEQsService.getEarthquakeInfo(eq._id)).resolves.toEqual({
        str: 'success',
        earthquakeInfo: eq,
      });
      expect(SignificantEqsRepo.findById).toHaveBeenCalledWith(eq._id);
    });

    test('rejects a malformed id without querying', async () => {
      SignificantEqsRepo.isValidId.mockReturnValue(false);

      await expect(SignificantEQsService.getEarthquakeInfo('not-an-id')).resolves.toEqual({
        str: 'invalidId',
      });
      expect(SignificantEqsRepo.findById).not.toHaveBeenCalled();
    });

    test('reports an unknown id as not found', async () => {
      SignificantEqsRepo.findById.mockResolvedValue(null);

      await expect(SignificantEQsService.getEarthquakeInfo(eq._id)).resolves.toEqual({
        str: 'noEarthquakeInfoFound',
      });
    });
  });
});
