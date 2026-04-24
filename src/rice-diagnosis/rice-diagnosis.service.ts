import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductsService } from '../products/products.service';
import { ProductEntity } from '../products/entities/product.entity';
import type { IUser } from '../users/users.interface';
import { CreateRiceDiseaseDto } from './dto/create-rice-disease.dto';
import { QueryAdminRiceDiseasesDto } from './dto/query-admin-rice-diseases.dto';
import { UpdateRiceDiseaseDto } from './dto/update-rice-disease.dto';
import {
  RiceDiagnosisHistoryEntity,
  RiceDiagnosisRecommendationLevel,
} from './entities/rice-diagnosis-history.entity';
import { RiceDiseaseRecommendationEntity } from './entities/rice-disease-recommendation.entity';
import {
  RiceDiseaseEntity,
  RiceDiseaseSeverity,
} from './entities/rice-disease.entity';

type UploadedImageFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

type InferencePrediction = {
  label: string;
  canonicalLabel: string;
  normalizedKey: string;
  confidence: number;
};

type InferenceResult = {
  predictedLabel: string;
  rawPredictedLabel: string;
  predictedKey: string;
  confidence: number;
  confidenceMargin: number | null;
  lowConfidence: boolean;
  ambiguousPrediction: boolean;
  lowQuality: boolean;
  qualityIssues: string[];
  topPredictions: InferencePrediction[];
  modelVersion: string | null;
  modelTask: string | null;
  rawResponse: Record<string, unknown>;
};

@Injectable()
export class RiceDiagnosisService {
  constructor(
    @InjectRepository(RiceDiseaseEntity)
    private readonly riceDiseasesRepository: Repository<RiceDiseaseEntity>,
    @InjectRepository(RiceDiseaseRecommendationEntity)
    private readonly riceDiseaseRecommendationsRepository: Repository<RiceDiseaseRecommendationEntity>,
    @InjectRepository(RiceDiagnosisHistoryEntity)
    private readonly riceDiagnosisHistoryRepository: Repository<RiceDiagnosisHistoryEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
    private readonly productsService: ProductsService,
    private readonly configService: ConfigService,
  ) {}

  async predict(file: UploadedImageFile, currentUser?: IUser) {
    this.validateImage(file);

    const inference = await this.requestInference(file);
    const diseases = await this.riceDiseasesRepository.find({
      where: { isActive: true },
      order: { diseaseName: 'ASC' },
    });
    const disease = this.matchDisease(
      diseases,
      inference.predictedKey,
      inference.predictedLabel,
    );

    const recommendationLevel = this.resolveRecommendationLevel(
      disease,
      inference.confidence,
      inference,
    );

    const topPredictions = inference.topPredictions.map((prediction) => {
      const matchedDisease = this.matchDisease(
        diseases,
        prediction.normalizedKey,
        prediction.label,
      );

      return {
        label: prediction.label,
        canonicalLabel: prediction.canonicalLabel,
        normalizedKey: prediction.normalizedKey,
        confidence: prediction.confidence,
        diseaseId: matchedDisease?.diseaseId ?? null,
        diseaseName:
          matchedDisease?.diseaseName ??
          this.humanizePredictionLabel(prediction.canonicalLabel),
        diseaseSlug: matchedDisease?.diseaseSlug ?? null,
      };
    });

    const explicitRecommendations = disease
      ? await this.riceDiseaseRecommendationsRepository.find({
          where: { diseaseId: disease.diseaseId },
          order: {
            isPrimary: 'DESC',
            sortOrder: 'ASC',
            riceDiseaseRecommendationId: 'ASC',
          },
        })
      : [];

    const recommendedProducts =
      disease && recommendationLevel !== RiceDiagnosisRecommendationLevel.LOW
        ? await this.productsService.getRecommendationCards({
            productIds: explicitRecommendations.map((item) => item.productId),
            keywordHints: this.buildKeywordHints(disease),
            limit: 4,
          })
        : [];

    const diagnosisId = randomUUID();
    await this.riceDiagnosisHistoryRepository.save(
      this.riceDiagnosisHistoryRepository.create({
        diagnosisId,
        userId: currentUser?._id ?? null,
        diseaseId: disease?.diseaseId ?? null,
        originalFileName: file.originalname ?? null,
        imageMimeType: file.mimetype ?? null,
        imageSizeBytes: file.size ?? null,
        imageSha256: createHash('sha256').update(file.buffer).digest('hex'),
        predictedLabel: inference.predictedLabel,
        predictedDiseaseKey: inference.predictedKey,
        confidence: inference.confidence.toFixed(5),
        recommendationLevel,
        modelVersion: inference.modelVersion,
        modelTask: inference.modelTask,
        topPredictions: inference.topPredictions,
        rawResponse: inference.rawResponse,
      }),
    );

    return {
      diagnosisId,
      savedToHistory: true,
      confidence: inference.confidence,
      recommendationLevel,
      model: {
        version: inference.modelVersion,
        task: inference.modelTask,
      },
      disease: disease ? this.mapDisease(disease) : null,
      inferenceFlags: {
        lowConfidence: inference.lowConfidence,
        ambiguousPrediction: inference.ambiguousPrediction,
        lowQuality: inference.lowQuality,
        confidenceMargin: inference.confidenceMargin,
        qualityIssues: inference.qualityIssues,
      },
      topPredictions,
      recommendedProducts,
      advisory: this.buildAdvisory(disease, recommendationLevel, inference),
    };
  }

  async listMyHistory(currentUser: IUser) {
    const items = await this.riceDiagnosisHistoryRepository.find({
      where: { userId: currentUser._id },
      order: { createdAt: 'DESC' },
      take: 20,
    });

    const diseaseIds = items
      .map((item) => item.diseaseId)
      .filter((value): value is string => !!value);
    const diseases = diseaseIds.length
      ? await this.riceDiseasesRepository.find({
          where: { diseaseId: In(diseaseIds) },
        })
      : [];
    const diseaseMap = new Map(
      diseases.map((disease) => [disease.diseaseId, disease]),
    );

    return items.map((item) => ({
      diagnosisId: item.diagnosisId,
      confidence: Number(item.confidence),
      recommendationLevel: item.recommendationLevel,
      predictedLabel: item.predictedLabel,
      disease: item.diseaseId ? this.mapDisease(diseaseMap.get(item.diseaseId) ?? null) : null,
      model: {
        version: item.modelVersion,
        task: item.modelTask,
      },
      createdAt: item.createdAt,
    }));
  }

  async listPublicDiseases() {
    const diseases = await this.riceDiseasesRepository.find({
      where: { isActive: true },
      order: { diseaseName: 'ASC' },
    });

    return diseases.map((disease) => this.mapDisease(disease));
  }

  async getPublicDiseaseBySlug(slug: string) {
    const disease = await this.riceDiseasesRepository.findOneBy({
      diseaseSlug: slug,
      isActive: true,
    });

    if (!disease) {
      throw new NotFoundException('Rice disease not found');
    }

    return this.mapDisease(disease);
  }

  async getAdminServiceStatus() {
    const baseUrl = this.getServiceBaseUrl();
    const headers = this.getServiceHeaders();

    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.getServiceTimeoutMs()),
      });
      const payload = (await response.json()) as Record<string, unknown>;

      return {
        configured: true,
        reachable: response.ok,
        baseUrl,
        statusCode: response.status,
        payload,
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        baseUrl,
        statusCode: null,
        payload: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async listAdminProducts(search?: string, limit = 24) {
    return this.productsService.getAdminProductOptions(search, limit);
  }

  async listAdminDiseases(query: QueryAdminRiceDiseasesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;

    const queryBuilder =
      this.riceDiseasesRepository.createQueryBuilder('disease');

    if (query.search?.trim()) {
      queryBuilder.andWhere(
        '(disease.disease_name LIKE :search OR disease.disease_key LIKE :search OR disease.disease_slug LIKE :search)',
        { search: `%${query.search.trim()}%` },
      );
    }

    if (query.isActive !== undefined) {
      queryBuilder.andWhere('disease.is_active = :isActive', {
        isActive: query.isActive,
      });
    }

    queryBuilder
      .orderBy('disease.updated_at', 'DESC')
      .addOrderBy('disease.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();
    const recommendationCounts = await this.loadRecommendationCounts(
      items.map((item) => item.diseaseId),
    );

    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      items: items.map((item) => ({
        ...this.mapDisease(item),
        mappedProductCount: recommendationCounts.get(item.diseaseId) ?? 0,
      })),
    };
  }

  async getAdminDisease(diseaseId: string) {
    const disease = await this.riceDiseasesRepository.findOneBy({ diseaseId });
    if (!disease) {
      throw new NotFoundException('Rice disease not found');
    }

    const recommendations = await this.riceDiseaseRecommendationsRepository.find({
      where: { diseaseId },
      order: {
        isPrimary: 'DESC',
        sortOrder: 'ASC',
        riceDiseaseRecommendationId: 'ASC',
      },
    });
    const products = await this.productsService.getRecommendationCards({
      productIds: recommendations.map((item) => item.productId),
      keywordHints: [],
      limit: Math.max(1, recommendations.length),
    });
    const productMap = new Map(
      products.map((product) => [product.productId, product]),
    );

    return {
      ...this.mapDisease(disease),
      mappedProductCount: recommendations.length,
      recommendedProducts: recommendations.map((item) => ({
        recommendationId: item.riceDiseaseRecommendationId,
        productId: item.productId,
        note: item.note,
        rationale: item.rationale,
        isPrimary: item.isPrimary,
        sortOrder: item.sortOrder,
        product: productMap.get(item.productId) ?? null,
      })),
    };
  }

  async createDisease(createRiceDiseaseDto: CreateRiceDiseaseDto) {
    const payload = this.normalizeDiseasePayload(createRiceDiseaseDto);
    await this.ensureUniqueDisease(payload);
    await this.ensureRecommendedProductsExist(payload.recommendedProducts);

    const disease = await this.riceDiseasesRepository.save(
      this.riceDiseasesRepository.create({
        diseaseKey: payload.diseaseKey,
        diseaseSlug: payload.diseaseSlug,
        diseaseName: payload.diseaseName,
        summary: payload.summary,
        symptoms: payload.symptoms,
        causes: payload.causes,
        treatmentGuidance: payload.treatmentGuidance,
        preventionGuidance: payload.preventionGuidance,
        severity: payload.severity,
        recommendedIngredients: payload.recommendedIngredients,
        searchKeywords: payload.searchKeywords,
        confidenceThreshold: payload.confidenceThreshold.toFixed(4),
        coverImageUrl: payload.coverImageUrl,
        isActive: payload.isActive,
      }),
    );

    await this.replaceRecommendations(
      disease.diseaseId,
      payload.recommendedProducts ?? [],
    );

    return this.getAdminDisease(disease.diseaseId);
  }

  async updateDisease(diseaseId: string, updateRiceDiseaseDto: UpdateRiceDiseaseDto) {
    const disease = await this.riceDiseasesRepository.findOneBy({ diseaseId });
    if (!disease) {
      throw new NotFoundException('Rice disease not found');
    }

    const payload = this.normalizeDiseasePayload(updateRiceDiseaseDto, disease);
    await this.ensureUniqueDisease(payload, diseaseId);
    if (payload.recommendedProducts !== undefined) {
      await this.ensureRecommendedProductsExist(payload.recommendedProducts);
    }

    disease.diseaseKey = payload.diseaseKey;
    disease.diseaseSlug = payload.diseaseSlug;
    disease.diseaseName = payload.diseaseName;
    disease.summary = payload.summary;
    disease.symptoms = payload.symptoms;
    disease.causes = payload.causes;
    disease.treatmentGuidance = payload.treatmentGuidance;
    disease.preventionGuidance = payload.preventionGuidance;
    disease.severity = payload.severity;
    disease.recommendedIngredients = payload.recommendedIngredients;
    disease.searchKeywords = payload.searchKeywords;
    disease.confidenceThreshold = payload.confidenceThreshold.toFixed(4);
    disease.coverImageUrl = payload.coverImageUrl;
    disease.isActive = payload.isActive;

    await this.riceDiseasesRepository.save(disease);

    if (payload.recommendedProducts !== undefined) {
      await this.replaceRecommendations(diseaseId, payload.recommendedProducts);
    }

    return this.getAdminDisease(diseaseId);
  }

  async toggleDiseaseActive(diseaseId: string) {
    const disease = await this.riceDiseasesRepository.findOneBy({ diseaseId });
    if (!disease) {
      throw new NotFoundException('Rice disease not found');
    }

    disease.isActive = !disease.isActive;
    await this.riceDiseasesRepository.save(disease);
    return this.getAdminDisease(diseaseId);
  }

  private validateImage(file?: UploadedImageFile) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required');
    }

    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Only image files are supported');
    }

    if (file.size > 8 * 1024 * 1024) {
      throw new BadRequestException('Image size must not exceed 8MB');
    }
  }

  private async requestInference(file: UploadedImageFile): Promise<InferenceResult> {
    const formData = new FormData();
    const binary = Uint8Array.from(file.buffer);
    const blob = new Blob([binary.buffer], { type: file.mimetype });
    formData.append('file', blob, file.originalname || 'rice-leaf.jpg');

    let response: Response;
    try {
      response = await fetch(`${this.getServiceBaseUrl()}/infer/rice-disease`, {
        method: 'POST',
        headers: this.getServiceHeaders(),
        body: formData,
        signal: AbortSignal.timeout(this.getServiceTimeoutMs()),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `AI inference service is unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InternalServerErrorException(
        'AI inference service returned an invalid JSON response',
      );
    }

    if (!response.ok) {
      const message =
        typeof payload === 'object' &&
        payload &&
        'message' in payload &&
        typeof payload.message === 'string'
          ? payload.message
          : `AI inference request failed with ${response.status}`;
      throw new ServiceUnavailableException(message);
    }

    return this.normalizeInferencePayload(payload);
  }

  private normalizeInferencePayload(payload: unknown): InferenceResult {
    if (!payload || typeof payload !== 'object') {
      throw new InternalServerErrorException(
        'AI inference response payload is invalid',
      );
    }

    const source = payload as Record<string, unknown>;
    const predictedLabel =
      this.readString(source.canonical_predicted_class) ??
      this.readString(source.predicted_class) ??
      this.readString(source.class_name) ??
      this.readString(source.label) ??
      this.readString(source.prediction);
    const rawPredictedLabel =
      this.readString(source.raw_predicted_class) ??
      this.readString(source.canonical_raw_predicted_class) ??
      predictedLabel;

    const confidence = this.readNumber(source.confidence);
    const confidenceMargin = this.readNumber(source.confidence_margin);
    const lowConfidence = Boolean(source.low_confidence);
    const ambiguousPrediction = Boolean(source.ambiguous_prediction);
    const lowQuality = Boolean(source.low_quality);
    const qualityIssues = Array.isArray(source.quality_issues)
      ? source.quality_issues.filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0,
        )
      : [];

    if (!predictedLabel || confidence === null) {
      throw new InternalServerErrorException(
        'AI inference response is missing required prediction fields',
      );
    }

    const rawPredictions = Array.isArray(source.top_predictions)
      ? source.top_predictions
      : Array.isArray(source.predictions)
        ? source.predictions
        : [];

    const topPredictions = rawPredictions
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const label =
          this.readString((item as Record<string, unknown>).label) ??
          this.readString((item as Record<string, unknown>).canonical_label) ??
          this.readString((item as Record<string, unknown>).class_name) ??
          this.readString((item as Record<string, unknown>).predicted_class);
        const itemConfidence = this.readNumber(
          (item as Record<string, unknown>).confidence,
        );

        if (!label || itemConfidence === null) {
          return null;
        }

        const canonicalLabel =
          this.readString((item as Record<string, unknown>).canonical_label) ?? label;

        return {
          label,
          canonicalLabel,
          normalizedKey: this.normalizeModelLabel(canonicalLabel),
          confidence: itemConfidence,
        };
      })
      .filter((item): item is InferencePrediction => !!item);

    if (topPredictions.length === 0) {
      topPredictions.push({
        label: predictedLabel,
        canonicalLabel: predictedLabel,
        normalizedKey: this.normalizeModelLabel(predictedLabel),
        confidence,
      });
    }

    return {
      predictedLabel,
      rawPredictedLabel: rawPredictedLabel ?? predictedLabel,
      predictedKey: this.normalizeModelLabel(predictedLabel),
      confidence,
      confidenceMargin,
      lowConfidence,
      ambiguousPrediction,
      lowQuality,
      qualityIssues,
      topPredictions,
      modelVersion: this.readString(source.model_version) ?? 'yolov9c-cls.pt',
      modelTask: this.readString(source.model_task) ?? 'classification',
      rawResponse: source,
    };
  }

  private resolveRecommendationLevel(
    disease: RiceDiseaseEntity | null,
    confidence: number,
    inference: Pick<
      InferenceResult,
      'lowConfidence' | 'ambiguousPrediction' | 'lowQuality'
    >,
  ) {
    const reviewThreshold = Number(
      this.configService.get<string>('RICE_AI_MIN_CONFIDENCE') ?? '0.75',
    );
    const strongThreshold = disease
      ? Number(disease.confidenceThreshold)
      : Number(this.configService.get<string>('RICE_AI_HIGH_CONFIDENCE') ?? '0.9');

    if (inference.lowConfidence || confidence < reviewThreshold) {
      return RiceDiagnosisRecommendationLevel.LOW;
    }

    if (inference.lowQuality || inference.ambiguousPrediction) {
      return RiceDiagnosisRecommendationLevel.LOW;
    }

    if (confidence < strongThreshold) {
      return RiceDiagnosisRecommendationLevel.REVIEW;
    }

    return RiceDiagnosisRecommendationLevel.HIGH;
  }

  private buildAdvisory(
    disease: RiceDiseaseEntity | null,
    recommendationLevel: RiceDiagnosisRecommendationLevel,
    inference: Pick<
      InferenceResult,
      'lowQuality' | 'ambiguousPrediction' | 'qualityIssues'
    >,
  ) {
    if (inference.lowQuality) {
      const issues = inference.qualityIssues.length
        ? ` Van de phat hien: ${inference.qualityIssues.join(', ')}.`
        : '';
      return {
        headline:
          'Anh tai len chua dat chat luong de dua ra chan doan on dinh.',
        disclaimer:
          `Hay chup lai la lua ro hon, du sang, can hon vung ton thuong va tranh rung tay.${issues}`,
      };
    }

    if (inference.ambiguousPrediction) {
      return {
        headline:
          'AI dang phan van giua nhieu nhan benh gan nhau, nen chua nen de xuat xu ly tu dong.',
        disclaimer:
          'Hay doi chieu them top du doan, chup them 1-2 anh khac, hoac nhan vien ky thuat xem lai truoc khi mua thuoc.',
      };
    }

    if (!disease) {
      return {
        headline: 'AI da nhan dang du lieu, nhung chua doi chieu duoc voi danh muc benh noi bo.',
        disclaimer:
          'Ket qua nay chi nen duoc xem la tham khao. Hay lien he nhan vien de xac minh truoc khi mua thuoc.',
      };
    }

    if (disease.diseaseKey === 'healthy_rice_leaf') {
      return {
        headline: 'La lua hien tai co dau hieu khoe manh hoac chua thay bieu hien benh ro rang.',
        disclaimer:
          'Tiep tuc theo doi ruong, duy tri canh tac can bang va chup lai neu trieu chung thay doi.',
      };
    }

    if (recommendationLevel === RiceDiagnosisRecommendationLevel.LOW) {
      return {
        headline:
          'Do tin cay hien con thap. He thong khong de xuat mua thuoc tu dong.',
        disclaimer:
          'Hay chup canh la ro hon, anh du sang hon, hoac mo chat widget chat voi nhan vien ky thuat.',
      };
    }

    if (recommendationLevel === RiceDiagnosisRecommendationLevel.REVIEW) {
      return {
        headline:
          'He thong da nhan dang duoc benh nghiem trong muc tham khao, nen doi chieu them truoc khi xu ly dien rong.',
        disclaimer:
          'Nen kiem tra them top du doan ben duoi va doc huong dan phong tri truoc khi mua thuoc.',
      };
    }

    return {
      headline:
        'Ket qua AI dat nguong tin cay cao, he thong co the dua ra phac do tham khao va san pham de nghi.',
      disclaimer:
        'Van can su dung theo nhan mac, lieu luong va khuyen cao an toan thuc vat truoc khi phun.',
    };
  }

  private matchDisease(
    diseases: RiceDiseaseEntity[],
    predictedKey: string,
    predictedLabel: string,
  ) {
    const normalizedPredictedKey = this.normalizeModelLabel(predictedKey);
    const normalizedPredictedLabel = this.normalizeModelLabel(predictedLabel);

    return (
      diseases.find((item) => item.diseaseKey === normalizedPredictedKey) ??
      diseases.find((item) => item.diseaseSlug === normalizedPredictedLabel) ??
      diseases.find(
        (item) =>
          this.normalizeModelLabel(item.diseaseName) === normalizedPredictedKey ||
          this.normalizeModelLabel(item.diseaseName) === normalizedPredictedLabel,
      ) ??
      null
    );
  }

  private buildKeywordHints(disease: RiceDiseaseEntity) {
    return [
      disease.diseaseName,
      ...(disease.searchKeywords ?? []),
      ...(disease.recommendedIngredients ?? []),
    ]
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  private async loadRecommendationCounts(diseaseIds: string[]) {
    const counts = new Map<string, number>();

    if (diseaseIds.length === 0) {
      return counts;
    }

    const items = await this.riceDiseaseRecommendationsRepository.find({
      where: { diseaseId: In(diseaseIds) },
    });

    for (const item of items) {
      counts.set(item.diseaseId, (counts.get(item.diseaseId) ?? 0) + 1);
    }

    return counts;
  }

  private normalizeDiseasePayload(
    payload: Partial<CreateRiceDiseaseDto>,
    current?: RiceDiseaseEntity,
  ) {
    const diseaseName = (payload.diseaseName ?? current?.diseaseName ?? '').trim();
    const diseaseKey = this.normalizeModelLabel(
      payload.diseaseKey ?? current?.diseaseKey ?? diseaseName,
    );
    const diseaseSlug = this.normalizeSlug(
      payload.diseaseSlug ?? current?.diseaseSlug ?? diseaseName,
    );

    if (!diseaseName || !diseaseKey || !diseaseSlug) {
      throw new BadRequestException('Disease name, key and slug are required');
    }

    return {
      diseaseKey,
      diseaseSlug,
      diseaseName,
      summary: this.optionalText(payload.summary, current?.summary ?? null),
      symptoms: this.optionalText(payload.symptoms, current?.symptoms ?? null),
      causes: this.optionalText(payload.causes, current?.causes ?? null),
      treatmentGuidance: this.optionalText(
        payload.treatmentGuidance,
        current?.treatmentGuidance ?? null,
      ),
      preventionGuidance: this.optionalText(
        payload.preventionGuidance,
        current?.preventionGuidance ?? null,
      ),
      severity: payload.severity ?? current?.severity ?? RiceDiseaseSeverity.MEDIUM,
      recommendedIngredients: this.normalizeTextArray(
        payload.recommendedIngredients ?? current?.recommendedIngredients ?? [],
      ),
      searchKeywords: this.normalizeTextArray(
        payload.searchKeywords ?? current?.searchKeywords ?? [],
      ),
      confidenceThreshold:
        payload.confidenceThreshold ??
        Number(current?.confidenceThreshold ?? '0.9000'),
      coverImageUrl: this.optionalText(
        payload.coverImageUrl,
        current?.coverImageUrl ?? null,
      ),
      isActive: payload.isActive ?? current?.isActive ?? true,
      recommendedProducts: payload.recommendedProducts?.map((item, index) => ({
        productId: item.productId,
        note: this.optionalText(item.note, null),
        rationale: this.optionalText(item.rationale, null),
        isPrimary: item.isPrimary ?? index === 0,
        sortOrder: item.sortOrder ?? index,
      })),
    };
  }

  private async ensureUniqueDisease(
    payload: { diseaseKey: string; diseaseSlug: string },
    excludeDiseaseId?: string,
  ) {
    const existingByKey = await this.riceDiseasesRepository.findOneBy({
      diseaseKey: payload.diseaseKey,
    });
    if (existingByKey && existingByKey.diseaseId !== excludeDiseaseId) {
      throw new BadRequestException('Disease key already exists');
    }

    const existingBySlug = await this.riceDiseasesRepository.findOneBy({
      diseaseSlug: payload.diseaseSlug,
    });
    if (existingBySlug && existingBySlug.diseaseId !== excludeDiseaseId) {
      throw new BadRequestException('Disease slug already exists');
    }
  }

  private async ensureRecommendedProductsExist(
    products:
      | Array<{
          productId: string;
        }>
      | undefined,
  ) {
    if (!products?.length) {
      return;
    }

    const uniqueIds = [...new Set(products.map((item) => item.productId))];
    const existing = await this.productsRepository.find({
      where: { productId: In(uniqueIds) },
      select: {
        productId: true,
      },
    });
    if (existing.length !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more recommended products were not found',
      );
    }
  }

  private async replaceRecommendations(
    diseaseId: string,
    items: Array<{
      productId: string;
      note: string | null;
      rationale: string | null;
      isPrimary: boolean;
      sortOrder: number;
    }>,
  ) {
    await this.riceDiseaseRecommendationsRepository.delete({ diseaseId });

    if (items.length === 0) {
      return;
    }

    const normalizedItems = items.map((item, index) =>
      this.riceDiseaseRecommendationsRepository.create({
        diseaseId,
        productId: item.productId,
        note: item.note,
        rationale: item.rationale,
        isPrimary: index === 0 ? true : item.isPrimary,
        sortOrder: item.sortOrder ?? index,
      }),
    );

    await this.riceDiseaseRecommendationsRepository.save(normalizedItems);
  }

  private getServiceBaseUrl() {
    return (
      this.configService
        .get<string>('RICE_AI_SERVICE_URL')
        ?.replace(/\/+$/, '') ?? 'http://127.0.0.1:5001'
    );
  }

  private getServiceTimeoutMs() {
    return Number(
      this.configService.get<string>('RICE_AI_TIMEOUT_MS') ?? '20000',
    );
  }

  private getServiceHeaders() {
    const token = this.configService.get<string>('RICE_AI_SERVICE_TOKEN');
    return token ? ({ 'x-api-key': token } as Record<string, string>) : {};
  }

  private normalizeModelLabel(value: string) {
    const normalized = value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');

    const aliases: Record<string, string> = {
      blast: 'leaf_blast',
      hispa: 'rice_hispa',
      normal: 'healthy_rice_leaf',
      healthy: 'healthy_rice_leaf',
    };

    return aliases[normalized] ?? normalized;
  }

  private normalizeSlug(value: string) {
    return value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-');
  }

  private normalizeTextArray(items: string[]) {
    return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  }

  private optionalText(value: string | undefined | null, fallback: string | null) {
    if (value === undefined) {
      return fallback;
    }

    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private humanizePredictionLabel(value: string) {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private readNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private mapDisease(disease: RiceDiseaseEntity | null) {
    if (!disease) {
      return null;
    }

    return {
      diseaseId: disease.diseaseId,
      diseaseKey: disease.diseaseKey,
      diseaseSlug: disease.diseaseSlug,
      diseaseName: disease.diseaseName,
      summary: disease.summary,
      symptoms: disease.symptoms,
      causes: disease.causes,
      treatmentGuidance: disease.treatmentGuidance,
      preventionGuidance: disease.preventionGuidance,
      severity: disease.severity,
      recommendedIngredients: disease.recommendedIngredients ?? [],
      searchKeywords: disease.searchKeywords ?? [],
      confidenceThreshold: Number(disease.confidenceThreshold),
      coverImageUrl: disease.coverImageUrl,
      isActive: disease.isActive,
      createdAt: disease.createdAt,
      updatedAt: disease.updatedAt,
    };
  }
}
