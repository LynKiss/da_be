import { IntelligenceService } from './intelligence.service';

describe('IntelligenceService ML core', () => {
  let service: IntelligenceService;

  beforeEach(() => {
    service = new IntelligenceService({} as never, {} as never, {} as never);
  });

  it('trains a matrix factorization model from purchase interactions', () => {
    const model = (
      service as unknown as {
        trainMatrixFactorization: (items: unknown[]) => {
          status: string;
          trainInteractions?: number;
          factors?: number;
          evaluation?: { precisionAtK: number; holdoutUsers: number };
          products?: string[];
        };
      }
    ).trainMatrixFactorization([
      { userId: 'u1', productId: 'npk', quantity: 3, orderCount: 2 },
      { userId: 'u1', productId: 'seed', quantity: 1, orderCount: 1 },
      { userId: 'u2', productId: 'npk', quantity: 2, orderCount: 1 },
      { userId: 'u2', productId: 'sprayer', quantity: 1, orderCount: 1 },
      { userId: 'u3', productId: 'seed', quantity: 4, orderCount: 2 },
      { userId: 'u3', productId: 'sprayer', quantity: 1, orderCount: 1 },
    ]);

    expect(model.status).toBe('trained');
    expect(model.trainInteractions).toBe(6);
    expect(model.factors).toBeGreaterThanOrEqual(4);
    expect(model.products).toEqual(
      expect.arrayContaining(['npk', 'seed', 'sprayer']),
    );
    expect(model.evaluation?.holdoutUsers).toBeGreaterThan(0);
    expect(model.evaluation?.precisionAtK).toBeGreaterThanOrEqual(0);
  });

  it('trains a ridge-regression time-series model and forecasts demand', () => {
    const history = Array.from({ length: 75 }, (_, index) => {
      const date = new Date('2026-01-01T00:00:00.000Z');
      date.setDate(date.getDate() + index);
      const weeklyPulse = date.getDay() === 1 ? 6 : 0;
      return {
        date: date.toISOString().slice(0, 10),
        quantity: 4 + weeklyPulse + index * 0.08,
      };
    });

    const typedService = service as unknown as {
      trainDemandRegressionModel: (items: unknown[]) => {
        status: string;
        evaluation?: { trainRows: number; testRows: number; mae: number };
      };
      buildRegressionForecast: (
        items: unknown[],
        horizon: number,
        model: unknown,
      ) => Array<{ date: string; forecastQuantity: number }>;
    };
    const model = typedService.trainDemandRegressionModel(history);

    expect(model.status).toBe('trained');
    expect(model.evaluation?.trainRows).toBeGreaterThan(30);
    expect(model.evaluation?.testRows).toBeGreaterThan(0);
    expect(model.evaluation?.mae).toBeGreaterThanOrEqual(0);

    const forecast = typedService.buildRegressionForecast(history, 14, model);
    expect(forecast).toHaveLength(14);
    expect(forecast.every((point) => point.forecastQuantity >= 0)).toBe(true);
  });
});
