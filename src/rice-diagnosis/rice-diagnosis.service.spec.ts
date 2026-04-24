import { ConfigService } from '@nestjs/config';
import { RiceDiagnosisService } from './rice-diagnosis.service';
import {
  RiceDiagnosisRecommendationLevel,
} from './entities/rice-diagnosis-history.entity';
import {
  RiceDiseaseSeverity,
} from './entities/rice-disease.entity';

function createRepositoryMock() {
  return {
    find: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

describe('RiceDiagnosisService', () => {
  const diseasesRepository = createRepositoryMock();
  const recommendationsRepository = createRepositoryMock();
  const historyRepository = createRepositoryMock();
  const productsRepository = createRepositoryMock();
  const productsService = {
    getRecommendationCards: jest.fn(),
    getAdminProductOptions: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'RICE_AI_SERVICE_URL') return 'http://127.0.0.1:5001';
      if (key === 'RICE_AI_TIMEOUT_MS') return '20000';
      if (key === 'RICE_AI_MIN_CONFIDENCE') return '0.75';
      if (key === 'RICE_AI_HIGH_CONFIDENCE') return '0.9';
      return undefined;
    }),
  } as unknown as ConfigService;

  let service: RiceDiagnosisService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new RiceDiagnosisService(
      diseasesRepository as never,
      recommendationsRepository as never,
      historyRepository as never,
      productsRepository as never,
      productsService as never,
      configService,
    );

    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('returns high-confidence recommendations when AI confidence meets threshold', async () => {
    diseasesRepository.find.mockResolvedValue([
      {
        diseaseId: '1',
        diseaseKey: 'brown_spot',
        diseaseSlug: 'brown-spot',
        diseaseName: 'Brown Spot',
        summary: 'summary',
        symptoms: 'symptoms',
        causes: 'causes',
        treatmentGuidance: 'treatment',
        preventionGuidance: 'prevention',
        severity: RiceDiseaseSeverity.HIGH,
        recommendedIngredients: ['Azoxystrobin'],
        searchKeywords: ['brown spot'],
        confidenceThreshold: '0.9000',
        coverImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    recommendationsRepository.find.mockResolvedValue([
      {
        riceDiseaseRecommendationId: '11',
        diseaseId: '1',
        productId: 'prod-1',
        note: null,
        rationale: null,
        isPrimary: true,
        sortOrder: 0,
      },
    ]);
    productsService.getRecommendationCards.mockResolvedValue([
      {
        productId: 'prod-1',
        productName: 'Thuoc A',
      },
    ]);
    historyRepository.save.mockResolvedValue(undefined);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        canonical_predicted_class: 'brown_spot',
        raw_predicted_class: 'brown_spot',
        confidence: 0.94,
        confidence_margin: 0.9,
        top_predictions: [
          {
            label: 'brown_spot',
            canonical_label: 'brown_spot',
            confidence: 0.94,
          },
          {
            label: 'leaf_blast',
            canonical_label: 'leaf_blast',
            confidence: 0.04,
          },
        ],
        model_version: 'yolov9c-cls.pt',
        model_task: 'classification',
      }),
    });

    const result = await service.predict({
      buffer: Buffer.from('fake'),
      mimetype: 'image/jpeg',
      originalname: 'leaf.jpg',
      size: 128,
    });

    expect(result.recommendationLevel).toBe(
      RiceDiagnosisRecommendationLevel.HIGH,
    );
    expect(result.disease?.diseaseKey).toBe('brown_spot');
    expect(result.recommendedProducts).toHaveLength(1);
    expect(productsService.getRecommendationCards).toHaveBeenCalledWith(
      expect.objectContaining({
        productIds: ['prod-1'],
      }),
    );
    expect(result.inferenceFlags.lowQuality).toBe(false);
  });

  it('does not suggest products when confidence is below review threshold', async () => {
    diseasesRepository.find.mockResolvedValue([
      {
        diseaseId: '2',
        diseaseKey: 'leaf_blast',
        diseaseSlug: 'leaf-blast',
        diseaseName: 'Leaf Blast',
        summary: 'summary',
        symptoms: 'symptoms',
        causes: 'causes',
        treatmentGuidance: 'treatment',
        preventionGuidance: 'prevention',
        severity: RiceDiseaseSeverity.CRITICAL,
        recommendedIngredients: ['Tricyclazole'],
        searchKeywords: ['leaf blast'],
        confidenceThreshold: '0.9000',
        coverImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    recommendationsRepository.find.mockResolvedValue([]);
    historyRepository.save.mockResolvedValue(undefined);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        canonical_predicted_class: 'leaf_blast',
        raw_predicted_class: 'blast',
        confidence: 0.62,
        confidence_margin: 0.2,
        low_confidence: true,
        top_predictions: [
          {
            label: 'blast',
            canonical_label: 'leaf_blast',
            confidence: 0.62,
          },
        ],
        model_version: 'yolov9c-cls.pt',
      }),
    });

    const result = await service.predict({
      buffer: Buffer.from('fake'),
      mimetype: 'image/png',
      originalname: 'leaf.png',
      size: 256,
    });

    expect(result.recommendationLevel).toBe(
      RiceDiagnosisRecommendationLevel.LOW,
    );
    expect(result.recommendedProducts).toEqual([]);
    expect(productsService.getRecommendationCards).not.toHaveBeenCalled();
  });

  it('downgrades recommendation when AI marks image as low quality', async () => {
    diseasesRepository.find.mockResolvedValue([
      {
        diseaseId: '3',
        diseaseKey: 'healthy_rice_leaf',
        diseaseSlug: 'healthy-rice-leaf',
        diseaseName: 'Healthy Rice Leaf',
        summary: 'summary',
        symptoms: 'symptoms',
        causes: 'causes',
        treatmentGuidance: 'treatment',
        preventionGuidance: 'prevention',
        severity: RiceDiseaseSeverity.LOW,
        recommendedIngredients: [],
        searchKeywords: ['healthy'],
        confidenceThreshold: '0.9300',
        coverImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    recommendationsRepository.find.mockResolvedValue([]);
    historyRepository.save.mockResolvedValue(undefined);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        canonical_predicted_class: 'healthy_rice_leaf',
        raw_predicted_class: 'normal',
        confidence: 0.97,
        confidence_margin: 0.85,
        low_quality: true,
        quality_issues: ['blurry', 'image_too_small'],
        top_predictions: [
          {
            label: 'normal',
            canonical_label: 'healthy_rice_leaf',
            confidence: 0.97,
          },
        ],
        model_version: 'best.pt',
      }),
    });

    const result = await service.predict({
      buffer: Buffer.from('fake'),
      mimetype: 'image/jpeg',
      originalname: 'leaf.jpg',
      size: 128,
    });

    expect(result.recommendationLevel).toBe(
      RiceDiagnosisRecommendationLevel.LOW,
    );
    expect(result.disease?.diseaseKey).toBe('healthy_rice_leaf');
    expect(result.inferenceFlags.lowQuality).toBe(true);
    expect(result.advisory.headline).toContain('chat luong');
  });
});
