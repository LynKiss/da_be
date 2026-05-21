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
  | 'product_recommendation'
  | 'cart_add'
  | 'cart_view'
  | 'checkout'
  | 'identity'
  | 'my_orders'
  | 'order_lookup'
  | 'expiry_info'
  | 'cancel_order'
  | 'short_delivery_report'
  | 'rice_diagnosis_help'
  | 'promotion'
  | 'warranty'
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

type SupportBotAction = {
  type:
    | 'navigate'
    | 'switch_tab'
    | 'send_message'
    | 'login'
    | 'view_product'
    | 'add_to_cart';
  label: string;
  target: string;
};

type SupportBotSeverity = 'info' | 'warning' | 'success';

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
  'Giao hàng toàn quốc trong 2–4 ngày làm việc. Đơn từ 500.000₫ được miễn phí vận chuyển.',
  'Phí vận chuyển thông thường từ 25.000₫ tuỳ khu vực.',
  'Đổi trả trong 7 ngày nếu sản phẩm lỗi hoặc sai mô tả. Khách cần giữ nguyên bao bì và hoá đơn.',
  'Hoàn tiền thường được xử lý trong 3–5 ngày làm việc sau khi duyệt yêu cầu trả hàng.',
  'Hỗ trợ thanh toán: COD, chuyển khoản ngân hàng, MoMo, VNPay, ZaloPay; có hạn mức mua nợ cho khách doanh nghiệp được duyệt.',
  'Hotline 1800 6863, email support@cultivatedledger.vn, giờ hỗ trợ 7:00–21:00 mỗi ngày.',
  'Kho áp dụng FIFO/FEFO — luôn ưu tiên xuất lô gần hết hạn trước; sản phẩm khách nhận sẽ có HSD còn lại tối thiểu 3 tháng, trừ lô đang giảm giá vì cận date.',
  'Khách có thể tự huỷ đơn khi đang ở trạng thái "Chờ xử lý"; đơn đã xác nhận hoặc đang giao cần liên hệ nhân viên.',
  'Đối với chẩn đoán bệnh cây trồng hoặc hướng dẫn sử dụng thuốc nông nghiệp, ưu tiên chuyển nhân viên kỹ thuật hoặc dùng tính năng Chẩn đoán lúa AI thay vì khẳng định tuyệt đối.',
];

const FAQ_RULES: Array<{ keywords: string[]; reply: string }> = [
  {
    keywords: ['giao hang', 'van chuyen', 'ship'],
    reply:
      '🚚 Chúng tôi giao hàng toàn quốc trong 2–4 ngày làm việc. Đơn từ 500.000₫ được freeship, còn lại phí ship từ 25.000₫ tuỳ khu vực.',
  },
  {
    keywords: ['doi tra', 'tra hang', 'hoan tien'],
    reply:
      '↩️ Đổi trả áp dụng trong 7 ngày nếu sản phẩm lỗi hoặc sai mô tả. Sau khi duyệt, hoàn tiền mất 3–5 ngày làm việc về phương thức thanh toán ban đầu. Bạn có thể tự tạo yêu cầu trả hàng ngay trong trang "Đơn hàng của tôi".',
  },
  {
    keywords: ['thanh toan', 'momo', 'vnpay', 'zalopay', 'cod'],
    reply:
      '💳 Hệ thống đang hỗ trợ: COD (trả khi nhận), chuyển khoản ngân hàng, MoMo, VNPay, ZaloPay. Khách doanh nghiệp được duyệt còn có hình thức mua nợ.',
  },
  {
    keywords: ['hotline', 'lien he', 'so dien thoai', 'email'],
    reply:
      '📞 Hotline: 1800 6863 (miễn phí). Email: support@cultivatedledger.vn. Giờ hỗ trợ: 7:00–21:00 mỗi ngày.',
  },
  {
    keywords: ['han su dung', 'hsd', 'het han', 'date', 'lo hang'],
    reply:
      '⏱️ Kho áp dụng FIFO/FEFO — luôn xuất lô sắp hết hạn trước. HSD còn lại của sản phẩm bạn nhận tối thiểu 3 tháng (trừ khi bạn chọn lô đang giảm giá vì cận date).',
  },
  {
    keywords: ['huy don', 'cancel'],
    reply:
      '❌ Bạn có thể tự huỷ đơn khi đang ở trạng thái "Chờ xử lý" — vào trang "Đơn hàng của tôi" và bấm "Huỷ đơn hàng". Đơn đã xác nhận hoặc đang giao cần chuyển tab "Nhân viên".',
  },
  {
    keywords: ['nhan thieu', 'thieu hang', 'giao thieu'],
    reply:
      '⚠️ Nếu shipper giao thiếu hàng, bạn vào "Đơn hàng của tôi" → đơn đang giao → bấm "Báo nhận thiếu" → nhập số lượng thực nhận. Admin sẽ xác minh với đơn vị vận chuyển và xử lý hoàn tiền/giao bù phần thiếu.',
  },
  {
    keywords: ['benh lua', 'chan doan'],
    reply:
      '🌾 Vào menu "Chẩn đoán lúa AI" trên trang chính → chụp hoặc tải ảnh lá lúa → AI gợi ý bệnh và thuốc. Kết quả mang tính tham khảo; cây bị nặng nên hỏi nhân viên kỹ thuật.',
  },
  {
    keywords: ['khuyen mai', 'giam gia', 'voucher', 'coupon'],
    reply:
      '🎁 Khuyến mãi xem ở banner trang chủ hoặc filter "Đang giảm giá" trong trang Sản phẩm. Mã voucher hiển thị ở "Ví voucher" sau khi đăng nhập.',
  },
  {
    keywords: ['bao hanh', 'warranty'],
    reply:
      '🛡️ Bảo hành theo chính sách nhà sản xuất. Vui lòng giữ hoá đơn để được hỗ trợ tốt nhất; với máy móc nông nghiệp, bảo hành tiêu chuẩn 12 tháng.',
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
  'lua',
  'rau',
  'cay',
  'sau',
  'nam',
  'co dai',
];

const PRODUCT_RECOMMENDATION_KEYWORDS = [
  'goi y san pham',
  'tu van san pham',
  'de xuat san pham',
  'nen mua',
  'mua gi',
  'chon san pham',
  'san pham phu hop',
  'phu hop voi',
];

const PRODUCT_STOP_WORDS = new Set([
  'hien',
  'dang',
  'nhung',
  'cac',
  'gi',
  'nao',
  'nay',
  'nen',
  'dung',
  'su',
  'de',
  'xuat',
  'chon',
  'phu',
  'hop',
  'voi',
  'em',
  'minh',
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
      throw new BadRequestException('Nội dung câu hỏi không được để trống');
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
        intent: this.toPublicIntent(context.intent),
        cartChanged: Boolean(context.cartActionSummary),
        ...this.buildReplyMeta(context),
      };
    }

    if (!this.hasAiConfiguration()) {
      return {
        reply: fallbackReply,
        source: 'fallback' as const,
        handoffSuggested,
        products: context.products,
        intent: this.toPublicIntent(context.intent),
        cartChanged: Boolean(context.cartActionSummary),
        ...this.buildReplyMeta(context),
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
          intent: this.toPublicIntent(context.intent),
          cartChanged: Boolean(context.cartActionSummary),
          ...this.buildReplyMeta(context),
        };
      }

      return {
        reply: aiReply,
        source: 'ai' as const,
        handoffSuggested,
        products: context.products,
        intent: this.toPublicIntent(context.intent),
        cartChanged: Boolean(context.cartActionSummary),
        ...this.buildReplyMeta(context),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Support bot AI fallback: ${reason}`);

      return {
        reply: fallbackReply,
        source: 'fallback' as const,
        handoffSuggested,
        products: context.products,
        intent: this.toPublicIntent(context.intent),
        cartChanged: Boolean(context.cartActionSummary),
        ...this.buildReplyMeta(context),
      };
    }
  }

  private buildReplyMeta(context: SupportBotContext): {
    actions: SupportBotAction[];
    suggestedQuestions: string[];
    severity: SupportBotSeverity;
  } {
    const actions: SupportBotAction[] = [];
    const pushAction = (action: SupportBotAction) => {
      if (!actions.some((item) => item.type === action.type && item.target === action.target)) {
        actions.push(action);
      }
    };

    if (context.intent === 'human_handoff') {
      pushAction({ type: 'switch_tab', label: 'Gặp nhân viên', target: 'support' });
    }

    if (
      context.intent === 'my_orders' ||
      context.intent === 'order_lookup' ||
      context.intent === 'cancel_order' ||
      context.orderSummary ||
      context.orderLookupInstruction ||
      context.myOrdersSummary
    ) {
      pushAction({ type: 'navigate', label: 'Xem đơn hàng', target: '/client/orders' });
    }

    if (context.intent === 'cart_view' || context.intent === 'cart_add' || context.cartActionSummary) {
      pushAction({ type: 'navigate', label: 'Mở giỏ hàng', target: '/client/cart' });
    }

    if (context.intent === 'checkout') {
      pushAction({ type: 'navigate', label: 'Thanh toán', target: '/client/checkout' });
    }

    if (context.products.length > 0 || context.intent === 'product_search' || context.intent === 'product_recommendation') {
      pushAction({ type: 'navigate', label: 'Xem sản phẩm', target: '/client/products' });
    }

    if (context.intent === 'promotion') {
      pushAction({ type: 'navigate', label: 'Ví voucher', target: '/client/vouchers' });
    }

    if (context.intent === 'rice_diagnosis_help') {
      pushAction({ type: 'navigate', label: 'Chẩn đoán lúa', target: '/client/rice-diagnosis' });
      pushAction({ type: 'switch_tab', label: 'Gặp kỹ thuật viên', target: 'support' });
    }

    if (context.intent === 'identity' && !context.userSummary) {
      pushAction({ type: 'login', label: 'Đăng nhập', target: '/client/login' });
    }

    if (context.orderLookupError || context.cartActionError) {
      pushAction({ type: 'switch_tab', label: 'Gặp nhân viên', target: 'support' });
    }

    const suggestedQuestions = this.buildSuggestedQuestions(context);
    const severity: SupportBotSeverity =
      context.orderLookupError ||
      context.cartActionError ||
      context.intent === 'human_handoff' ||
      context.intent === 'rice_diagnosis_help'
        ? 'warning'
        : context.cartActionSummary || context.orderSummary || context.myOrdersSummary
          ? 'success'
          : 'info';

    return {
      actions: actions.slice(0, 4),
      suggestedQuestions,
      severity,
    };
  }

  private buildSuggestedQuestions(context: SupportBotContext) {
    const byIntent: Partial<Record<SupportBotIntent, string[]>> = {
      greeting: ['Chính sách giao hàng?', 'Tìm phân NPK', 'Đơn hàng của tôi đang ở đâu?'],
      shipping: ['Đơn hàng của tôi đang ở đâu?', 'Tôi muốn hủy đơn', 'Gặp nhân viên'],
      returns: ['Bao lâu được hoàn tiền?', 'Tôi muốn đổi trả hàng', 'Gặp nhân viên'],
      payment: ['Các hình thức thanh toán?', 'Mã giảm giá hôm nay', 'Thanh toán đơn hàng'],
      product_search: ['Tìm phân NPK', 'Tư vấn hạt giống lúa', 'Chẩn đoán bệnh lúa'],
      product_recommendation: ['Tìm phân NPK', 'Tư vấn hạt giống lúa', 'Gặp nhân viên'],
      cart_add: ['Mở giỏ hàng', 'Thanh toán đơn hàng', 'Tìm thêm sản phẩm'],
      cart_view: ['Thanh toán đơn hàng', 'Tìm thêm sản phẩm', 'Mã giảm giá hôm nay'],
      checkout: ['Mã giảm giá hôm nay', 'Các hình thức thanh toán?', 'Chính sách giao hàng?'],
      my_orders: ['Tôi muốn hủy đơn', 'Đổi trả như thế nào?', 'Gặp nhân viên'],
      order_lookup: ['Đơn hàng của tôi đang ở đâu?', 'Tôi muốn hủy đơn', 'Gặp nhân viên'],
      rice_diagnosis_help: ['Mở chẩn đoán bệnh lúa', 'Gặp kỹ thuật viên', 'Tìm thuốc BVTV'],
      promotion: ['Mã giảm giá hôm nay', 'Tìm sản phẩm đang giảm giá', 'Mở ví voucher'],
      identity: ['Đơn hàng của tôi đang ở đâu?', 'Mở giỏ hàng', 'Quên mật khẩu'],
      general: ['Chính sách giao hàng?', 'Tìm phân NPK', 'Gặp nhân viên'],
    };

    return (byIntent[context.intent] ?? byIntent.general ?? []).slice(0, 3);
  }

  private toPublicIntent(intent: SupportBotIntent) {
    const map: Partial<Record<SupportBotIntent, string>> = {
      shipping: 'shipping_policy',
      returns: 'return_refund',
      expiry_info: 'product_policy',
      cancel_order: 'order_tracking',
      short_delivery_report: 'return_refund',
      rice_diagnosis_help: 'rice_diagnosis',
      my_orders: 'order_tracking',
      order_lookup: 'order_tracking',
      product_recommendation: 'product_search',
      cart_add: 'cart',
      cart_view: 'cart',
      human_handoff: 'human_handoff',
      identity: 'account',
      greeting: 'account',
      promotion: 'promotion',
      checkout: 'checkout',
      payment: 'payment',
    };

    return map[intent] ?? intent;
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
      if (
        PRODUCT_RECOMMENDATION_KEYWORDS.some((keyword) =>
          normalizedMessage.includes(keyword),
        )
      ) {
        return 'product_recommendation';
      }

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

    // ── Intents bổ sung (mở rộng phạm vi chatbot) ──
    if (
      normalizedMessage.includes('han su dung') ||
      normalizedMessage.includes('hsd') ||
      normalizedMessage.includes('het han') ||
      normalizedMessage.includes('con han') ||
      normalizedMessage.includes('date') ||
      normalizedMessage.includes('lo hang') ||
      normalizedMessage.includes('batch')
    ) {
      return 'expiry_info';
    }

    if (
      normalizedMessage.includes('huy don') ||
      normalizedMessage.includes('cancel order') ||
      normalizedMessage.includes('huy bo don')
    ) {
      return 'cancel_order';
    }

    if (
      normalizedMessage.includes('nhan thieu') ||
      normalizedMessage.includes('thieu hang') ||
      normalizedMessage.includes('giao thieu') ||
      normalizedMessage.includes('khong du hang')
    ) {
      return 'short_delivery_report';
    }

    if (
      normalizedMessage.includes('benh lua') ||
      normalizedMessage.includes('chan doan') ||
      normalizedMessage.includes('lua bi') ||
      normalizedMessage.includes('cay bi')
    ) {
      return 'rice_diagnosis_help';
    }

    if (
      normalizedMessage.includes('khuyen mai') ||
      normalizedMessage.includes('giam gia') ||
      normalizedMessage.includes('voucher') ||
      normalizedMessage.includes('ma giam') ||
      normalizedMessage.includes('coupon') ||
      normalizedMessage.includes('sale')
    ) {
      return 'promotion';
    }

    if (
      normalizedMessage.includes('bao hanh') ||
      normalizedMessage.includes('warranty')
    ) {
      return 'warranty';
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
      intent === 'product_recommendation' ||
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
    const productQuery =
      intent === 'product_recommendation'
        ? extractedProductQuery
        : this.isBroadProductQuestion(normalizedMessage, extractedProductQuery)
          ? null
          : extractedProductQuery;

    try {
      let products = await this.findProductSuggestions(productQuery);

      if (products.length === 0 && productQuery) {
        if (intent === 'cart_add' || intent === 'product_recommendation') {
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

      if (
        (intent === 'cart_add' || intent === 'product_recommendation') &&
        productQuery &&
        products.length > 1
      ) {
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

  private buildProductRecommendationReason(
    productQuery: string | null,
    product: SupportBotProductSuggestion,
  ) {
    if (!productQuery) {
      return 'Sản phẩm đang hiển thị trong catalog và có dữ liệu giá/tồn kho xác thực.';
    }

    const normalizedName = this.normalizeText(product.productName);
    const matchedTokens = this.getProductQueryTokens(productQuery).filter(
      (token) => normalizedName.includes(token),
    );

    if (matchedTokens.length > 0) {
      return `Phù hợp vì tên sản phẩm khớp các từ khóa: ${matchedTokens.slice(0, 4).join(', ')}.`;
    }

    return 'Phù hợp để bạn xem thêm trong nhóm sản phẩm liên quan.';
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
          'Bạn cần đăng nhập để tôi xem giỏ hàng hoặc thêm sản phẩm vào giỏ.',
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
                ? 'Tôi tìm thấy nhiều sản phẩm gần đúng. Bạn hãy bấm vào sản phẩm cần mua hoặc nhập tên cụ thể hơn trước khi thêm vào giỏ.'
                : 'Tôi chưa xác định được sản phẩm cần thêm vào giỏ. Bạn hãy nói rõ tên sản phẩm, ví dụ: "thêm 2 phân NPK vào giỏ".',
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
            `Đã thêm ${quantity} x ${addedItem.productName ?? product.productName} vào giỏ hàng.`,
            `Giỏ hàng hiện có ${cart.totalQuantity} sản phẩm, tạm tính ${this.formatCurrency(cart.totalAmount)}.`,
            'Bạn có thể vào giỏ hàng để kiểm tra lại và thanh toán.',
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
          'Bạn cần đăng nhập để tôi xem danh sách đơn hàng của tài khoản hiện tại.',
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
          'Nếu bạn cần tra cứu đơn hàng, hãy gửi mã đơn dạng UUID. Đơn khách vãng lai cần thêm số điện thoại đặt hàng; đơn của tài khoản đăng ký thì vui lòng đăng nhập để xem.',
        orderLookupError: null,
      };
    }

    const phone = this.extractPhone(message);
    if (!phone) {
      return {
        orderSummary: null,
        orderLookupInstruction:
          'Tôi đã nhận được mã đơn. Nếu đây là đơn khách vãng lai, bạn vui lòng gửi thêm số điện thoại đặt hàng để tôi tra cứu. Nếu đây là đơn của tài khoản đã đăng ký, vui lòng đăng nhập để xem chi tiết đơn.',
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
          'Tôi chưa tra cứu được đơn hàng này. Bạn vui lòng kiểm tra lại mã đơn, số điện thoại, hoặc chuyển sang tab Nhân viên để được hỗ trợ trực tiếp.',
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
        return 'Bạn chưa đăng nhập nên tôi chưa xác định được tài khoản hiện tại. Hãy đăng nhập để tôi hỗ trợ theo đúng thông tin của bạn.';
      }

      return [
        'Bạn đang đăng nhập với thông tin:',
        context.userSummary,
        'Tôi chỉ dùng thông tin của chính tài khoản này để hỗ trợ, không truy cập dữ liệu của người dùng khác.',
      ].join('\n');
    }

    if (context.intent === 'cart_view') {
      return (
        context.cartSummary ??
        'Tôi chưa đọc được giỏ hàng. Nếu bạn chưa đăng nhập, hãy đăng nhập để xem giỏ hàng của mình.'
      );
    }

    if (context.intent === 'checkout') {
      return [
        context.cartSummary ?? 'Tôi chưa đọc được giỏ hàng hiện tại.',
        'Để đặt hàng an toàn, bạn vui lòng vào trang giỏ hàng/thanh toán để xác nhận địa chỉ, phương thức giao hàng và thanh toán. Tôi có thể hỗ trợ thêm sản phẩm vào giỏ trước khi bạn checkout.',
      ].join('\n');
    }

    if (context.intent === 'human_handoff') {
      return [
        'Tôi có thể chuyển hướng sang hỗ trợ trực tiếp.',
        'Bạn hãy mở tab "Nhân viên" để chat với CSKH, hoặc gọi 1800 6863 nếu cần xử lý nhanh.',
      ].join('\n');
    }

    if (
      context.intent === 'product_recommendation' &&
      context.products.length > 0
    ) {
      const lines = context.products.slice(0, 4).map((product, index) => {
        const reason = this.buildProductRecommendationReason(
          context.productQuery,
          product,
        );

        return `${index + 1}. ${product.productName} - ${this.formatCurrency(product.effectivePrice)}${product.unit ? `/${product.unit}` : ''}. ${reason}`;
      });

      return [
        context.productQuery
          ? `Tôi gợi ý các sản phẩm phù hợp với nhu cầu "${context.productQuery}":`
          : 'Tôi gợi ý một số sản phẩm đang có trong catalog:',
        ...lines,
        'Bạn có thể bấm vào thẻ sản phẩm để xem chi tiết. Nếu cần chẩn đoán bệnh cây trồng hoặc cách dùng thuốc, hãy chuyển sang tab Nhân viên/Chẩn đoán lúa để được hỗ trợ đúng hơn.',
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
          ? `Tôi đã tìm thấy ${context.products.length} gợi ý phù hợp với "${context.productQuery}":`
          : `Hiện có ${context.products.length} sản phẩm đang hiển thị:`,
        ...lines,
        'Bạn có thể bấm vào gợi ý để xem chi tiết, hoặc chuyển sang tab Nhân viên nếu cần tư vấn kỹ hơn.',
      ].join('\n');
    }

    if (context.intent === 'product_search') {
      return 'Tôi chưa tìm thấy sản phẩm phù hợp. Bạn thử mô tả rõ hơn tên hàng hóa, công dụng, hoặc chuyển sang tab Nhân viên để được tư vấn sản phẩm.';
    }

    const faqReply = this.matchFaqReply(message);
    if (faqReply) {
      return faqReply;
    }

    if (context.intent === 'greeting') {
      return 'Chào bạn. Tôi có thể hỗ trợ giao hàng, thanh toán, đổi trả, tìm sản phẩm, hoặc hướng dẫn tra cứu đơn hàng.';
    }

    return [
      'Tôi có thể hỗ trợ các việc sau:',
      '- Giải đáp chính sách giao hàng, đổi trả, thanh toán',
      '- Tìm sản phẩm phù hợp từ catalog hiện có',
      '- Hướng dẫn tra cứu đơn khách vãng lai bằng mã đơn + số điện thoại',
      '- Chuyển sang nhân viên khi bạn cần xử lý nghiệp vụ chi tiết',
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
      return 'Giỏ hàng của bạn đang trống.';
    }

    const lines = cart.items
      .slice(0, 5)
      .map(
        (item, index) =>
          `${index + 1}. ${item.productName ?? 'Sản phẩm'} x${item.quantity} - ${this.formatCurrency(item.lineTotal)}`,
      );

    return [
      `Giỏ hàng hiện có ${cart.totalQuantity} sản phẩm, tạm tính ${this.formatCurrency(cart.totalAmount)}:`,
      ...lines,
      cart.items.length > 5
        ? `Còn ${cart.items.length - 5} dòng sản phẩm khác.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatMyOrdersSummary(orders: MyOrderSummaryResult[], total: number) {
    if (orders.length === 0) {
      return 'Tài khoản của bạn hiện chưa có đơn hàng nào.';
    }

    const lines = orders.map((order, index) => {
      const createdAt = new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(order.createdAt));

      return `${index + 1}. Đơn ${this.shortId(order.id)} - ${this.mapOrderStatus(order.status)} - ${this.formatCurrency(order.totalPayment)} - ${order.totalQuantity} sản phẩm - ngày ${createdAt}`;
    });

    return [
      `Bạn có ${total} đơn hàng. ${orders.length < total ? `Đây là ${orders.length} đơn mới nhất:` : 'Danh sách đơn hàng:'}`,
      ...lines,
      'Nếu muốn xem chi tiết một đơn, hãy gửi mã đơn hoặc vào mục Tài khoản > Đơn hàng.',
    ].join('\n');
  }

  private formatOrderSummary(order: OrderLookupResult) {
    const statusLabel = this.mapOrderStatus(order.status);
    const itemsPreview = (order.items ?? [])
      .slice(0, 3)
      .map((item) => `- ${item.productName} x${item.quantity}`)
      .join('\n');

    const summaryLines = [
      `Đơn hàng ${order.id}`,
      `Trạng thái: ${statusLabel}`,
      `Tổng tiền: ${this.formatCurrency(order.totalPayment)}`,
      `Số lượng: ${order.totalQuantity} sản phẩm`,
      `Người nhận: ${order.fullName} - ${order.phone}`,
    ];

    if (itemsPreview) {
      summaryLines.push('Mặt hàng tiêu biểu:');
      summaryLines.push(itemsPreview);
    }

    return summaryLines.join('\n');
  }

  private mapOrderStatus(status: string) {
    const labels: Record<string, string> = {
      pending: 'Chờ xử lý',
      backordered: 'Chờ hàng',
      confirmed: 'Đã xác nhận',
      processing: 'Đang xử lý',
      shipping: 'Đang giao',
      delivered: 'Đã giao',
      partial_delivered: 'Giao một phần',
      cancelled: 'Đã hủy',
      returned: 'Đã trả hàng',
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

    return `${amount.toLocaleString('vi-VN')}đ`;
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
      'Bạn là CHATBOT CSKH cho Cultivated Ledger — hệ thống thương mại điện tử vật tư nông nghiệp.',
      '',
      'NGÔN NGỮ:',
      '- BẮT BUỘC trả lời bằng tiếng Việt CÓ DẤU ĐẦY ĐỦ. Tuyệt đối không viết kiểu "khong dau".',
      '- Văn phong: ngắn gọn, lịch sự, thân thiện, dùng "anh/chị" hoặc "bạn".',
      '- Định dạng số tiền có "₫" và dấu phân cách ngàn. Định dạng ngày kiểu dd/mm/yyyy.',
      '- Có thể dùng emoji nhẹ (📦 🚚 ✅ ⚠️) để dễ đọc, nhưng không lạm dụng.',
      '',
      'NGUYÊN TẮC CHẤT LƯỢNG:',
      '- CHỈ được trả lời dựa trên thông tin có trong BUSINESS CONTEXT bên dưới.',
      '- TUYỆT ĐỐI KHÔNG tự bịa giá, tồn kho, trạng thái đơn, chính sách, khuyến mãi, hay hướng dẫn sử dụng thuốc nông nghiệp nếu không có dữ liệu xác thực.',
      '- Nếu thiếu dữ liệu, phải nói rõ "tôi chưa xác nhận được thông tin này" và đề xuất chuyển sang tab "Nhân viên" hoặc gọi hotline.',
      '- Chỉ thực hiện hành động giỏ hàng (thêm/xóa) khi BUSINESS CONTEXT đã trả về kết quả hành động hợp lệ.',
      '- Không tự ý tạo đơn hàng khi chưa có xác nhận địa chỉ + giao hàng + thanh toán.',
      '',
      'KHI NÀO CHUYỂN NHÂN VIÊN:',
      '- Khách muốn gặp người thật, khiếu nại, đổi/trả phức tạp, tranh chấp.',
      '- Hỏi chẩn đoán bệnh cây trồng cụ thể, kê đơn thuốc nông nghiệp.',
      '- Yêu cầu vượt thẩm quyền của chatbot (sửa giá, hoàn tiền, override stock).',
      '→ Hướng dẫn khách bấm tab "Nhân viên" trong widget chat.',
      '',
      'CẤU TRÚC PHẢN HỒI MONG MUỐN:',
      '1) Câu trả lời chính (1–3 câu).',
      '2) Nếu có sản phẩm liên quan → liệt kê tối đa 3 mục dạng bullet.',
      '3) Nếu cần action tiếp theo → đề xuất 1 bước rõ ràng (vd: "Bấm Thêm vào giỏ" hoặc "Vui lòng đăng nhập").',
      '4) Không viết đoạn dài lê thê quá 6 dòng.',
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
                `${item.role === 'user' ? 'Khách' : 'Bot'}: ${item.content}`,
            )
            .join('\n')
        : 'Không có lịch sử hội thoại trước đó.';

    const productBlock =
      context.products.length > 0
        ? context.products
            .map(
              (product, index) =>
                `${index + 1}. ${product.productName} | giá ${this.formatCurrency(product.effectivePrice)} | tồn ${product.quantityAvailable}${product.unit ? ` ${product.unit}` : ''}`,
            )
            .join('\n')
        : 'Không có gợi ý sản phẩm xác thực.';

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
              : 'Không có dữ liệu đơn hàng nào được xác thực trong request này.';

    const userBlock = context.userSummary
      ? context.userSummary
      : 'Khách chưa đăng nhập hoặc request không có token.';

    const cartBlock = context.cartActionSummary
      ? context.cartActionSummary
      : context.cartActionError
        ? context.cartActionError
        : context.cartSummary
          ? context.cartSummary
          : 'Không có dữ liệu giỏ hàng trong request này.';

    return [
      '=== BUSINESS CONTEXT ===',
      `Ý định (intent): ${context.intent}`,
      `Cần ưu tiên chuyển nhân viên: ${handoffSuggested ? 'CÓ' : 'KHÔNG'}`,
      '',
      '--- Tài khoản hiện tại ---',
      userBlock,
      '',
      '--- Chính sách áp dụng ---',
      ...context.policies.map((policy) => `• ${policy}`),
      '',
      '--- Giỏ hàng / Hành động giỏ hàng ---',
      cartBlock,
      '',
      '--- Dữ liệu đơn hàng ---',
      orderBlock,
      '',
      '--- Sản phẩm liên quan ---',
      productBlock,
      '',
      '--- Lịch sử hội thoại ---',
      historyBlock,
      '',
      '=== CÂU HỎI HIỆN TẠI ===',
      message,
      '',
      'Hãy trả lời TIẾNG VIỆT CÓ DẤU đầy đủ, đúng nghiệp vụ, dựa vào BUSINESS CONTEXT bên trên. Nếu thiếu dữ liệu, nói rõ và đề xuất tab Nhân viên hoặc hotline.',
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
