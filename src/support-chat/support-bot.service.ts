import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CartsService } from '../carts/carts.service';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { QueryProductsDto } from '../products/dto/query-products.dto';
import type { IUser } from '../users/users.interface';
import { UsersService } from '../users/users.service';
import {
  CreateSupportBotReplyDto,
  SupportBotHistoryItemDto,
} from './dto/create-support-bot-reply.dto';

type SupportBotIntent =
  | 'greeting'
  | 'shipping'
  | 'returns'
  | 'payment'
  | 'product_search'
  | 'cart_add'
  | 'cart_view'
  | 'checkout'
  | 'identity'
  | 'my_orders'
  | 'order_lookup'
  | 'human_handoff'
  | 'general';

type SupportBotProductSuggestion = {
  productId: string;
  productName: string;
  effectivePrice: string;
  basePrice: string;
  unit: string | null;
  quantityAvailable: number;
  primaryImageUrl: string | null;
};

type ProductSearchResult = SupportBotProductSuggestion & {
  productSlug?: string;
};

type OrderLookupResult = {
  id: string;
  status: string;
  totalPayment: string | number;
  totalQuantity: number;
  fullName: string;
  phone: string;
  items?: Array<{
    productName: string;
    quantity: number;
  }>;
};

type MyOrderSummaryResult = {
  id: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  totalPayment: string | number;
  totalQuantity: number;
  createdAt: string | Date;
};

type SupportBotContext = {
  intent: SupportBotIntent;
  userSummary: string | null;
  productQuery: string | null;
  products: SupportBotProductSuggestion[];
  cartSummary: string | null;
  cartActionSummary: string | null;
  cartActionError: string | null;
  myOrdersSummary: string | null;
  myOrdersError: string | null;
  orderSummary: string | null;
  orderLookupInstruction: string | null;
  orderLookupError: string | null;
  policies: string[];
};

type OpenAiCompatibleChatResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PHONE_PATTERN = /(?:\+?84|0)(?:[\s.]?\d){8,10}/;

const BUSINESS_POLICIES = [
  'Giao hang toan quoc trong 2-4 ngay lam viec. Don tu 500.000d duoc freeship.',
  'Phi van chuyen thuong tu 25.000d tuy khu vuc.',
  'Doi tra trong 7 ngay neu san pham loi hoac sai mo ta. Khach can giu bao bi va hoa don.',
  'Hoan tien thuong duoc xu ly trong 3-5 ngay lam viec sau khi duyet tra hang.',
  'Ho tro COD, chuyen khoan ngan hang, MoMo, VNPay va ZaloPay.',
  'Hotline 1800 6863, email support@cultivatedledger.vn, gio ho tro 7:00-21:00 hang ngay.',
  'Neu cau hoi lien quan den chan doan benh cay trong hoac huong dan su dung thuoc, uu tien chuyen nhan vien hoac tinh nang rice diagnosis thay vi khang dinh tuyet doi.',
];

const FAQ_RULES: Array<{ keywords: string[]; reply: string }> = [
  {
    keywords: ['giao hang', 'van chuyen', 'ship'],
    reply:
      'Chung toi giao hang toan quoc trong 2-4 ngay lam viec. Don tu 500.000d duoc freeship, con lai phi ship thuong tu 25.000d tuy khu vuc.',
  },
  {
    keywords: ['doi tra', 'tra hang', 'hoan tien'],
    reply:
      'Chinh sach doi tra la 7 ngay neu san pham loi hoac sai mo ta. Sau khi duyet, hoan tien thuong mat 3-5 ngay lam viec ve phuong thuc thanh toan ban dau.',
  },
  {
    keywords: ['thanh toan', 'momo', 'vnpay', 'zalopay', 'cod'],
    reply:
      'He thong dang ho tro COD, chuyen khoan ngan hang, MoMo, VNPay va ZaloPay.',
  },
  {
    keywords: ['hotline', 'lien he', 'so dien thoai', 'email'],
    reply:
      'Ban co the lien he 1800 6863 hoac email support@cultivatedledger.vn. Khung gio ho tro la 7:00-21:00 hang ngay.',
  },
];

const HUMAN_HANDOFF_KEYWORDS = [
  'nhan vien',
  'tu van',
  'goi lai',
  'hotline',
  'khieu nai',
  'gap nguoi that',
  'gap nguoi',
  'staff',
  'human',
];

const PRODUCT_HINT_KEYWORDS = [
  'san pham',
  'phan',
  'phan bon',
  'npk',
  'thuoc',
  'thuoc sau',
  'giong',
  'hat giong',
  'nong duoc',
  'dung cu',
  'may',
];

const PRODUCT_STOP_WORDS = new Set([
  'hien',
  'dang',
  'nhung',
  'cac',
  'gi',
  'nao',
  'nay',
  'them',
  'vao',
  'gio',
  'dat',
  'datmua',
  'mua',
  'lay',
  'giup',
  'tim',
  'kiem',
  'san',
  'pham',
  'toi',
  'can',
  'cho',
  'tu',
  'van',
  've',
  'gia',
  'co',
  'ban',
  'goi',
  'y',
  'mot',
  'loai',
  'hang',
  'cua',
  'shop',
  'cua',
]);

@Injectable()
export class SupportBotService {
  private readonly logger = new Logger(SupportBotService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly productsService: ProductsService,
    private readonly ordersService: OrdersService,
    private readonly cartsService: CartsService,
    private readonly usersService: UsersService,
  ) {}

  async createReply(
    createSupportBotReplyDto: CreateSupportBotReplyDto,
    currentUser?: IUser | null,
  ) {
    const message = createSupportBotReplyDto.message.trim();
    if (!message) {
      throw new BadRequestException('Noi dung cau hoi khong duoc de trong');
    }

    const history = this.normalizeHistory(createSupportBotReplyDto.history);
    const context = await this.buildContext(message, currentUser ?? null);
    const handoffSuggested =
      context.intent === 'human_handoff' || this.shouldSuggestHuman(message);
    const fallbackReply = this.buildFallbackReply(message, context);

    if (
      context.intent === 'human_handoff' ||
      context.orderSummary ||
      context.orderLookupInstruction ||
      context.orderLookupError ||
      context.cartActionSummary ||
      context.cartActionError ||
      context.myOrdersSummary ||
      context.myOrdersError ||
      context.intent === 'identity' ||
      context.intent === 'cart_view' ||
      context.intent === 'checkout'
    ) {
      return {
        reply: fallbackReply,
        source: 'fallback' as const,
        handoffSuggested,
        products: context.products,
        intent: context.intent,
        cartChanged: Boolean(context.cartActionSummary),
      };
    }

    if (!this.hasAiConfiguration()) {
      return {
        reply: fallbackReply,
        source: 'fallback' as const,
        handoffSuggested,
        products: context.products,
        intent: context.intent,
        cartChanged: Boolean(context.cartActionSummary),
      };
    }

    try {
      const aiReply = await this.generateAiReply(
        message,
        history,
        context,
        handoffSuggested,
      );

      if (!aiReply) {
        return {
          reply: fallbackReply,
          source: 'fallback' as const,
          handoffSuggested,
          products: context.products,
          intent: context.intent,
          cartChanged: Boolean(context.cartActionSummary),
        };
      }

      return {
        reply: aiReply,
        source: 'ai' as const,
        handoffSuggested,
        products: context.products,
        intent: context.intent,
        cartChanged: Boolean(context.cartActionSummary),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Support bot AI fallback: ${reason}`);

      return {
        reply: fallbackReply,
        source: 'fallback' as const,
        handoffSuggested,
        products: context.products,
        intent: context.intent,
        cartChanged: Boolean(context.cartActionSummary),
      };
    }
  }

  private normalizeHistory(history?: SupportBotHistoryItemDto[]) {
    return (history ?? [])
      .map((item) => ({
        role: item.role,
        content: item.content.trim(),
      }))
      .filter((item) => item.content.length > 0)
      .slice(-12);
  }

  private async buildContext(
    message: string,
    currentUser: IUser | null,
  ): Promise<SupportBotContext> {
    const normalized = this.normalizeText(message);
    const intent = this.detectIntent(message, normalized);

    const productContext = await this.lookupRelevantProducts(
      message,
      normalized,
      intent,
    );
    const [orderContext, cartContext, myOrdersContext] = await Promise.all([
      intent === 'my_orders'
        ? Promise.resolve({
            orderSummary: null,
            orderLookupInstruction: null,
            orderLookupError: null,
          })
        : this.lookupGuestOrder(message, normalized),
      this.buildCartContext(
        message,
        intent,
        currentUser,
        productContext.products,
        productContext.productQuery,
      ),
      this.lookupMyOrders(intent, currentUser),
    ]);

    return {
      intent,
      userSummary: this.buildUserSummary(currentUser),
      products: productContext.products,
      productQuery: productContext.productQuery,
      cartSummary: cartContext.cartSummary,
      cartActionSummary: cartContext.cartActionSummary,
      cartActionError: cartContext.cartActionError,
      myOrdersSummary: myOrdersContext.myOrdersSummary,
      myOrdersError: myOrdersContext.myOrdersError,
      orderSummary: orderContext.orderSummary,
      orderLookupInstruction: orderContext.orderLookupInstruction,
      orderLookupError: orderContext.orderLookupError,
      policies: BUSINESS_POLICIES,
    };
  }

  private detectIntent(
    message: string,
    normalizedMessage: string,
  ): SupportBotIntent {
    if (/^(xin chao|chao|hello|hi|hey)\b/.test(normalizedMessage)) {
      return 'greeting';
    }

    if (this.shouldSuggestHuman(message)) {
      return 'human_handoff';
    }

    if (
      normalizedMessage.includes('toi la ai') ||
      normalizedMessage.includes('tai khoan cua toi') ||
      normalizedMessage.includes('thong tin cua toi') ||
      normalizedMessage.includes('toi dang dang nhap')
    ) {
      return 'identity';
    }

    if (
      (normalizedMessage.includes('them') &&
        normalizedMessage.includes('gio')) ||
      (normalizedMessage.includes('bo') && normalizedMessage.includes('gio')) ||
      (normalizedMessage.includes('cho') &&
        normalizedMessage.includes('gio')) ||
      normalizedMessage.includes('them vao gio') ||
      normalizedMessage.includes('bo vao gio') ||
      normalizedMessage.includes('cho vao gio') ||
      normalizedMessage.includes('them gio hang') ||
      normalizedMessage.includes('mua giup')
    ) {
      return 'cart_add';
    }

    if (
      normalizedMessage.includes('gio hang') ||
      normalizedMessage.includes('trong gio') ||
      normalizedMessage.includes('xem gio')
    ) {
      return 'cart_view';
    }

    if (
      normalizedMessage.includes('dat hang') ||
      normalizedMessage.includes('thanh toan don') ||
      normalizedMessage.includes('checkout')
    ) {
      return 'checkout';
    }

    if (
      normalizedMessage.includes('don hang cua toi') ||
      normalizedMessage.includes('don cua toi') ||
      normalizedMessage.includes('toi co nhung don hang') ||
      normalizedMessage.includes('toi co don hang') ||
      normalizedMessage.includes('nhung don hang nao') ||
      normalizedMessage.includes('cac don hang') ||
      normalizedMessage.includes('trang thai don hang cua toi')
    ) {
      return 'my_orders';
    }

    if (
      UUID_PATTERN.test(message) ||
      normalizedMessage.includes('don hang') ||
      normalizedMessage.includes('tra cuu')
    ) {
      return 'order_lookup';
    }

    if (
      PRODUCT_HINT_KEYWORDS.some((keyword) =>
        normalizedMessage.includes(keyword),
      )
    ) {
      return 'product_search';
    }

    if (
      normalizedMessage.includes('doi tra') ||
      normalizedMessage.includes('hoan tien') ||
      normalizedMessage.includes('bao hanh')
    ) {
      return 'returns';
    }

    if (
      normalizedMessage.includes('thanh toan') ||
      normalizedMessage.includes('momo') ||
      normalizedMessage.includes('vnpay') ||
      normalizedMessage.includes('zalopay') ||
      normalizedMessage.includes('cod')
    ) {
      return 'payment';
    }

    if (
      normalizedMessage.includes('giao hang') ||
      normalizedMessage.includes('van chuyen') ||
      normalizedMessage.includes('ship')
    ) {
      return 'shipping';
    }

    return 'general';
  }

  private async lookupRelevantProducts(
    message: string,
    normalizedMessage: string,
    intent: SupportBotIntent,
  ) {
    const shouldSearch =
      intent === 'product_search' ||
      intent === 'cart_add' ||
      PRODUCT_HINT_KEYWORDS.some((keyword) =>
        normalizedMessage.includes(keyword),
      );

    if (!shouldSearch) {
      return {
        productQuery: null,
        products: [] as SupportBotProductSuggestion[],
      };
    }

    const extractedProductQuery = this.extractProductQuery(
      message,
      intent === 'cart_add',
    );
    const productQuery = this.isBroadProductQuestion(
      normalizedMessage,
      extractedProductQuery,
    )
      ? null
      : extractedProductQuery;

    try {
      let products = await this.findProductSuggestions(productQuery);

      if (products.length === 0 && productQuery) {
        if (intent === 'cart_add') {
          const catalogProducts = await this.findProductSuggestions(null, 50);
          products = this.rankProductsByQuery(productQuery, catalogProducts)
            .filter((item) => item.score > 0)
            .slice(0, 4)
            .map((item) => item.product);

          return {
            productQuery,
            products,
          };
        }

        const fallbackProducts = await this.findProductSuggestions(null);
        return {
          productQuery: null,
          products: fallbackProducts,
        };
      }

      if (intent === 'cart_add' && productQuery && products.length > 1) {
        products = this.rankProductsByQuery(productQuery, products).map(
          (item) => item.product,
        );
      }

      return {
        productQuery,
        products,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Product lookup fallback: ${reason}`);
      return {
        productQuery,
        products: [] as SupportBotProductSuggestion[],
      };
    }
  }

  private isBroadProductQuestion(
    normalizedMessage: string,
    productQuery: string | null,
  ) {
    return (
      !productQuery ||
      productQuery.split(' ').length <= 1 ||
      normalizedMessage.includes('san pham gi') ||
      normalizedMessage.includes('san pham nao') ||
      normalizedMessage.includes('nhung san pham') ||
      normalizedMessage.includes('cac san pham')
    );
  }

  private async findProductSuggestions(productQuery: string | null, limit = 4) {
    const dto = Object.assign(new QueryProductsDto(), {
      page: 1,
      limit,
      includeHidden: false,
      ...(productQuery ? { search: productQuery } : {}),
    });

    const result = await this.productsService.findAll(dto);
    return ((result.items ?? []) as ProductSearchResult[]).map((product) => ({
      productId: product.productId,
      productName: product.productName,
      effectivePrice: product.effectivePrice,
      basePrice: product.basePrice,
      unit: product.unit,
      quantityAvailable: product.quantityAvailable,
      primaryImageUrl: product.primaryImageUrl ?? null,
    }));
  }

  private buildUserSummary(currentUser: IUser | null) {
    if (!currentUser) {
      return null;
    }

    return [
      `ID: ${currentUser._id}`,
      `Username: ${currentUser.username}`,
      `Email: ${currentUser.email}`,
      `Role: ${currentUser.role.name}`,
    ].join('\n');
  }

  private rankProductsByQuery(
    productQuery: string,
    products: SupportBotProductSuggestion[],
  ) {
    return products
      .map((product) => ({
        product,
        score: this.scoreProductMatch(productQuery, product),
      }))
      .sort((left, right) => right.score - left.score);
  }

  private selectProductForCart(
    productQuery: string | null,
    products: SupportBotProductSuggestion[],
  ) {
    if (products.length === 0) {
      return null;
    }

    if (products.length === 1 || !productQuery) {
      return products[0];
    }

    const ranked = this.rankProductsByQuery(productQuery, products);
    const [best, second] = ranked;
    const queryTokens = this.getProductQueryTokens(productQuery);
    const minimumScore = Math.max(6, queryTokens.length * 2);

    if (
      best &&
      best.score >= minimumScore &&
      (!second || best.score >= second.score + 2)
    ) {
      return best.product;
    }

    return null;
  }

  private scoreProductMatch(
    productQuery: string,
    product: SupportBotProductSuggestion,
  ) {
    const normalizedQuery = this.normalizeText(productQuery);
    const normalizedName = this.normalizeText(product.productName);
    const queryTokens = this.getProductQueryTokens(productQuery);

    let score = 0;
    if (normalizedName === normalizedQuery) {
      score += 100;
    } else if (normalizedName.includes(normalizedQuery)) {
      score += 30;
    }

    const nameTokens = new Set(normalizedName.split(' ').filter(Boolean));
    for (const token of queryTokens) {
      if (nameTokens.has(token)) {
        score += /^\d+$/.test(token) ? 5 : 3;
      } else if (normalizedName.includes(token)) {
        score += /^\d+$/.test(token) ? 3 : 1;
      }
    }

    return score;
  }

  private async buildCartContext(
    message: string,
    intent: SupportBotIntent,
    currentUser: IUser | null,
    products: SupportBotProductSuggestion[],
    productQuery: string | null,
  ) {
    if (!['cart_add', 'cart_view', 'checkout'].includes(intent)) {
      return {
        cartSummary: null,
        cartActionSummary: null,
        cartActionError: null,
      };
    }

    if (!currentUser) {
      return {
        cartSummary: null,
        cartActionSummary: null,
        cartActionError:
          'Ban can dang nhap de toi xem gio hang hoac them san pham vao gio.',
      };
    }

    try {
      if (intent === 'cart_add') {
        const product = this.selectProductForCart(productQuery, products);
        if (!product) {
          return {
            cartSummary: null,
            cartActionSummary: null,
            cartActionError:
              products.length > 1
                ? 'Toi tim thay nhieu san pham gan dung. Ban hay bam vao san pham can mua hoac nhap ten cu the hon truoc khi them vao gio.'
                : 'Toi chua xac dinh duoc san pham can them vao gio. Ban hay noi ro ten san pham, vi du: "them 2 phan NPK vao gio".',
          };
        }

        const quantity = this.extractRequestedQuantity(message);
        const addedItem = await this.cartsService.addItem(currentUser._id, {
          productId: product.productId,
          quantity,
        });
        const cart = await this.cartsService.getMyCart(currentUser._id);

        return {
          cartSummary: this.formatCartSummary(cart),
          cartActionSummary: [
            `Da them ${quantity} x ${addedItem.productName ?? product.productName} vao gio hang.`,
            `Gio hang hien co ${cart.totalQuantity} san pham, tam tinh ${this.formatCurrency(cart.totalAmount)}.`,
            'Ban co the vao gio hang de kiem tra lai va thanh toan.',
          ].join('\n'),
          cartActionError: null,
        };
      }

      const cart = await this.cartsService.getMyCart(currentUser._id);
      return {
        cartSummary: this.formatCartSummary(cart),
        cartActionSummary: null,
        cartActionError: null,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        cartSummary: null,
        cartActionSummary: null,
        cartActionError: reason,
      };
    }
  }

  private async lookupMyOrders(
    intent: SupportBotIntent,
    currentUser: IUser | null,
  ) {
    if (intent !== 'my_orders') {
      return {
        myOrdersSummary: null,
        myOrdersError: null,
      };
    }

    if (!currentUser) {
      return {
        myOrdersSummary: null,
        myOrdersError:
          'Ban can dang nhap de toi xem danh sach don hang cua tai khoan hien tai.',
      };
    }

    try {
      const result = (await this.usersService.findMyOrders(currentUser._id, {
        page: 1,
        limit: 5,
      })) as {
        items: MyOrderSummaryResult[];
        total: number;
      };

      return {
        myOrdersSummary: this.formatMyOrdersSummary(result.items, result.total),
        myOrdersError: null,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        myOrdersSummary: null,
        myOrdersError: reason,
      };
    }
  }

  private async lookupGuestOrder(message: string, normalizedMessage: string) {
    const orderId = message.match(UUID_PATTERN)?.[0] ?? null;
    const orderLikeMessage =
      Boolean(orderId) ||
      normalizedMessage.includes('tra cuu') ||
      normalizedMessage.includes('don hang');

    if (!orderLikeMessage) {
      return {
        orderSummary: null,
        orderLookupInstruction: null,
        orderLookupError: null,
      };
    }

    if (!orderId) {
      return {
        orderSummary: null,
        orderLookupInstruction:
          'Neu ban can tra cuu don hang, hay gui ma don dang UUID. Don guest can them so dien thoai dat hang; don cua tai khoan dang ky thi vui long dang nhap de xem.',
        orderLookupError: null,
      };
    }

    const phone = this.extractPhone(message);
    if (!phone) {
      return {
        orderSummary: null,
        orderLookupInstruction:
          'Toi da nhan duoc ma don. Neu day la don guest, ban vui long gui them so dien thoai dat hang de toi tra cuu. Neu day la don cua tai khoan da dang ky, vui long dang nhap de xem chi tiet don.',
        orderLookupError: null,
      };
    }

    try {
      const order = (await this.ordersService.findGuestOrder(
        orderId,
        phone,
      )) as OrderLookupResult;

      return {
        orderSummary: this.formatOrderSummary(order),
        orderLookupInstruction: null,
        orderLookupError: null,
      };
    } catch {
      return {
        orderSummary: null,
        orderLookupInstruction: null,
        orderLookupError:
          'Toi chua tra cuu duoc don hang nay. Ban vui long kiem tra lai ma don, so dien thoai, hoac chuyen sang tab Nhan vien de duoc ho tro truc tiep.',
      };
    }
  }

  private buildFallbackReply(message: string, context: SupportBotContext) {
    if (context.orderSummary) {
      return context.orderSummary;
    }

    if (context.orderLookupInstruction) {
      return context.orderLookupInstruction;
    }

    if (context.orderLookupError) {
      return context.orderLookupError;
    }

    if (context.cartActionSummary) {
      return context.cartActionSummary;
    }

    if (context.cartActionError) {
      return context.cartActionError;
    }

    if (context.myOrdersSummary) {
      return context.myOrdersSummary;
    }

    if (context.myOrdersError) {
      return context.myOrdersError;
    }

    if (context.intent === 'identity') {
      if (!context.userSummary) {
        return 'Ban chua dang nhap nen toi chua xac dinh duoc tai khoan hien tai. Hay dang nhap de toi ho tro theo dung thong tin cua ban.';
      }

      return [
        'Ban dang dang nhap voi thong tin:',
        context.userSummary,
        'Toi chi dung thong tin cua chinh tai khoan nay de ho tro, khong truy cap du lieu cua nguoi dung khac.',
      ].join('\n');
    }

    if (context.intent === 'cart_view') {
      return (
        context.cartSummary ??
        'Toi chua doc duoc gio hang. Neu ban chua dang nhap, hay dang nhap de xem gio hang cua minh.'
      );
    }

    if (context.intent === 'checkout') {
      return [
        context.cartSummary ?? 'Toi chua doc duoc gio hang hien tai.',
        'De dat hang an toan, ban vui long vao trang gio hang/thanh toan de xac nhan dia chi, phuong thuc giao hang va thanh toan. Toi co the ho tro them san pham vao gio truoc khi ban checkout.',
      ].join('\n');
    }

    if (context.intent === 'human_handoff') {
      return [
        'Toi co the chuyen huong sang ho tro truc tiep.',
        'Ban hay mo tab "Nhan vien" de chat voi CSKH, hoac goi 1800 6863 neu can xu ly nhanh.',
      ].join('\n');
    }

    if (context.products.length > 0) {
      const lines = context.products
        .slice(0, 4)
        .map(
          (product, index) =>
            `${index + 1}. ${product.productName} - ${this.formatCurrency(product.effectivePrice)}${product.unit ? `/${product.unit}` : ''}`,
        );

      return [
        context.productQuery
          ? `Toi da tim thay ${context.products.length} goi y phu hop voi "${context.productQuery}":`
          : `Hien co ${context.products.length} san pham dang hien thi:`,
        ...lines,
        'Ban co the bam vao goi y de xem chi tiet, hoac chuyen sang tab Nhan vien neu can tu van ky hon.',
      ].join('\n');
    }

    if (context.intent === 'product_search') {
      return 'Toi chua tim thay san pham phu hop. Ban thu mo ta ro hon ten hang hoa, cong dung, hoac chuyen sang tab Nhan vien de duoc tu van san pham.';
    }

    const faqReply = this.matchFaqReply(message);
    if (faqReply) {
      return faqReply;
    }

    if (context.intent === 'greeting') {
      return 'Chao ban. Toi co the ho tro giao hang, thanh toan, doi tra, tim san pham, hoac huong dan tra cuu don hang.';
    }

    return [
      'Toi co the ho tro cac viec sau:',
      '- Giai dap chinh sach giao hang, doi tra, thanh toan',
      '- Tim san pham phu hop tu catalog hien co',
      '- Huong dan tra cuu don guest bang ma don + so dien thoai',
      '- Chuyen sang nhan vien khi ban can xu ly nghiep vu chi tiet',
    ].join('\n');
  }

  private matchFaqReply(message: string) {
    const normalized = this.normalizeText(message);

    for (const rule of FAQ_RULES) {
      if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
        return rule.reply;
      }
    }

    return null;
  }

  private shouldSuggestHuman(message: string) {
    const normalized = this.normalizeText(message);
    return HUMAN_HANDOFF_KEYWORDS.some((keyword) =>
      normalized.includes(keyword),
    );
  }

  private extractProductQuery(message: string, stripLeadingQuantity = false) {
    const normalized = this.normalizeText(message)
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tokens = normalized
      .split(' ')
      .filter(
        (token) =>
          (token.length >= 2 || /^\d+$/.test(token)) &&
          !PRODUCT_STOP_WORDS.has(token),
      )
      .slice(0, 8);

    if (stripLeadingQuantity && tokens.length > 1 && /^\d+$/.test(tokens[0])) {
      tokens.shift();
    }

    const query = tokens.join(' ').trim();

    return query.length >= 2 ? query : null;
  }

  private getProductQueryTokens(productQuery: string) {
    return this.normalizeText(productQuery)
      .split(' ')
      .filter(
        (token) =>
          (token.length >= 2 || /^\d+$/.test(token)) &&
          !PRODUCT_STOP_WORDS.has(token),
      );
  }

  private extractPhone(message: string) {
    const rawPhone = message.match(PHONE_PATTERN)?.[0] ?? null;
    if (!rawPhone) {
      return null;
    }

    const compact = rawPhone.replace(/[^\d+]/g, '');
    if (compact.startsWith('+84')) {
      return `0${compact.slice(3)}`;
    }

    if (compact.startsWith('84')) {
      return `0${compact.slice(2)}`;
    }

    return compact;
  }

  private extractRequestedQuantity(message: string) {
    const normalized = this.normalizeText(message);
    const explicitQuantity = normalized.match(/\b(\d{1,3})\b/);
    if (explicitQuantity) {
      const quantity = Number(explicitQuantity[1]);
      if (Number.isInteger(quantity) && quantity > 0) {
        return Math.min(quantity, 999);
      }
    }

    return 1;
  }

  private formatCartSummary(cart: {
    totalItems: number;
    totalQuantity: number;
    totalAmount: string;
    items: Array<{
      productName: string | null;
      quantity: number;
      lineTotal: string;
    }>;
  }) {
    if (cart.items.length === 0) {
      return 'Gio hang cua ban dang trong.';
    }

    const lines = cart.items
      .slice(0, 5)
      .map(
        (item, index) =>
          `${index + 1}. ${item.productName ?? 'San pham'} x${item.quantity} - ${this.formatCurrency(item.lineTotal)}`,
      );

    return [
      `Gio hang hien co ${cart.totalQuantity} san pham, tam tinh ${this.formatCurrency(cart.totalAmount)}:`,
      ...lines,
      cart.items.length > 5
        ? `Con ${cart.items.length - 5} dong san pham khac.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatMyOrdersSummary(orders: MyOrderSummaryResult[], total: number) {
    if (orders.length === 0) {
      return 'Tai khoan cua ban hien chua co don hang nao.';
    }

    const lines = orders.map((order, index) => {
      const createdAt = new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(order.createdAt));

      return `${index + 1}. Don ${this.shortId(order.id)} - ${this.mapOrderStatus(order.status)} - ${this.formatCurrency(order.totalPayment)} - ${order.totalQuantity} san pham - ngay ${createdAt}`;
    });

    return [
      `Ban co ${total} don hang. ${orders.length < total ? `Day la ${orders.length} don moi nhat:` : 'Danh sach don hang:'}`,
      ...lines,
      'Neu muon xem chi tiet mot don, hay gui ma don hoac vao muc Tai khoan > Don hang.',
    ].join('\n');
  }

  private formatOrderSummary(order: OrderLookupResult) {
    const statusLabel = this.mapOrderStatus(order.status);
    const itemsPreview = (order.items ?? [])
      .slice(0, 3)
      .map((item) => `- ${item.productName} x${item.quantity}`)
      .join('\n');

    const summaryLines = [
      `Don hang ${order.id}`,
      `Trang thai: ${statusLabel}`,
      `Tong tien: ${this.formatCurrency(order.totalPayment)}`,
      `So luong: ${order.totalQuantity} san pham`,
      `Nguoi nhan: ${order.fullName} - ${order.phone}`,
    ];

    if (itemsPreview) {
      summaryLines.push('Mat hang tieu bieu:');
      summaryLines.push(itemsPreview);
    }

    return summaryLines.join('\n');
  }

  private mapOrderStatus(status: string) {
    const labels: Record<string, string> = {
      pending: 'Cho xu ly',
      backordered: 'Cho hang',
      confirmed: 'Da xac nhan',
      processing: 'Dang xu ly',
      shipping: 'Dang giao',
      delivered: 'Da giao',
      partial_delivered: 'Giao mot phan',
      cancelled: 'Da huy',
      returned: 'Da tra hang',
    };

    return labels[status] ?? status;
  }

  private shortId(value: string) {
    return value.length > 8 ? value.slice(0, 8) : value;
  }

  private formatCurrency(value: string | number) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return String(value);
    }

    return `${amount.toLocaleString('vi-VN')}d`;
  }

  private normalizeText(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hasAiConfiguration() {
    return Boolean(
      this.configService.get<string>('SUPPORT_BOT_API_KEY') &&
      this.configService.get<string>('SUPPORT_BOT_MODEL'),
    );
  }

  private async generateAiReply(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    context: SupportBotContext,
    handoffSuggested: boolean,
  ) {
    const apiKey = this.configService.get<string>('SUPPORT_BOT_API_KEY');
    const model = this.configService.get<string>('SUPPORT_BOT_MODEL');

    if (!apiKey || !model) {
      return null;
    }

    const controller = new AbortController();
    const timeoutMs = Number(
      this.configService.get<string>('SUPPORT_BOT_TIMEOUT_MS') ?? 15000,
    );
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.getAiEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 500,
          messages: [
            {
              role: 'system',
              content: this.buildSystemPrompt(),
            },
            {
              role: 'user',
              content: this.buildUserPrompt(
                message,
                history,
                context,
                handoffSuggested,
              ),
            },
          ],
        }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as OpenAiCompatibleChatResponse;
      if (!response.ok) {
        throw new Error(
          payload.error?.message ??
            `Support bot AI request failed with ${response.status}`,
        );
      }

      return this.extractAiText(payload);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildSystemPrompt() {
    return [
      'Ban la chatbot CSKH cho Cultivated Ledger, mot he thong ecommerce vat tu nong nghiep.',
      'Tra loi bang tieng Viet, gon, ro, uu tien tinh dung nghiep vu.',
      'Chi duoc tra loi dua tren thong tin trong BUSINESS CONTEXT.',
      'Khong duoc tu dat ra gia, ton kho, trang thai don, chinh sach, khuyen mai, hoac huong dan su dung thuoc nong nghiep neu khong co du lieu xac thuc.',
      'Neu thieu du lieu, phai noi ro la chua xac nhan duoc va huong dan chuyen sang nhan vien.',
      'Chi thuc hien hanh dong gio hang khi backend da tra ve ket qua hanh dong trong BUSINESS CONTEXT.',
      'Khong tu dong tao don hang neu chua co xac nhan dia chi, giao hang va thanh toan.',
      'Neu nguoi dung muon gap nguoi that, khieu nai, doi tra phuc tap, hoac hoi sang chan doan/thuoc cho cay trong, uu tien huong dan qua tab Nhan vien.',
    ].join('\n');
  }

  private buildUserPrompt(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    context: SupportBotContext,
    handoffSuggested: boolean,
  ) {
    const historyBlock =
      history.length > 0
        ? history
            .map(
              (item) =>
                `${item.role === 'user' ? 'Khach' : 'Bot'}: ${item.content}`,
            )
            .join('\n')
        : 'Khong co lich su hoi thoai truoc do.';

    const productBlock =
      context.products.length > 0
        ? context.products
            .map(
              (product, index) =>
                `${index + 1}. ${product.productName} | gia ${this.formatCurrency(product.effectivePrice)} | ton ${product.quantityAvailable}${product.unit ? ` | don vi ${product.unit}` : ''}`,
            )
            .join('\n')
        : 'Khong co goi y san pham xac thuc.';

    const orderBlock = context.orderSummary
      ? context.orderSummary
      : context.orderLookupInstruction
        ? context.orderLookupInstruction
        : context.orderLookupError
          ? context.orderLookupError
          : context.myOrdersSummary
            ? context.myOrdersSummary
            : context.myOrdersError
              ? context.myOrdersError
              : 'Khong co du lieu don hang nao duoc xac thuc.';

    const userBlock = context.userSummary
      ? context.userSummary
      : 'Khach chua dang nhap hoac request khong co token.';

    const cartBlock = context.cartActionSummary
      ? context.cartActionSummary
      : context.cartActionError
        ? context.cartActionError
        : context.cartSummary
          ? context.cartSummary
          : 'Khong co du lieu gio hang trong request nay.';

    return [
      'BUSINESS CONTEXT',
      `Intent: ${context.intent}`,
      `Can uu tien chuyen nhan vien: ${handoffSuggested ? 'co' : 'khong'}`,
      '',
      'Tai khoan hien tai:',
      userBlock,
      'Chinh sach:',
      ...context.policies.map((policy) => `- ${policy}`),
      '',
      'Gio hang / hanh dong gio hang:',
      cartBlock,
      '',
      'Du lieu don hang:',
      orderBlock,
      '',
      'San pham lien quan:',
      productBlock,
      '',
      'Lich su hoi thoai:',
      historyBlock,
      '',
      `Cau hoi hien tai cua khach: ${message}`,
      '',
      'Hay tra loi dung nghiep vu, neu khong du du lieu thi noi ro va huong dan tab Nhan vien.',
    ].join('\n');
  }

  private getAiEndpoint() {
    const configuredBaseUrl =
      this.configService.get<string>('SUPPORT_BOT_API_BASE_URL') ??
      'https://api.openai.com/v1';
    const trimmed = configuredBaseUrl.replace(/\/+$/, '');

    if (trimmed.endsWith('/chat/completions')) {
      return trimmed;
    }

    return `${trimmed}/chat/completions`;
  }

  private extractAiText(payload: OpenAiCompatibleChatResponse) {
    const content = payload.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => item.text?.trim() ?? '')
        .filter(Boolean)
        .join('\n')
        .trim();
    }

    return null;
  }
}
