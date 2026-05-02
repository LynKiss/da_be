import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiscountEntity } from '../discounts/entities/discount.entity';
import { NewsEntity } from '../news/entities/news.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { ProductEntity } from '../products/entities/product.entity';
import { SupplierEntity } from '../suppliers/entities/supplier.entity';
import { UserEntity } from '../users/entities/user.entity';
import type { IUser } from '../users/users.interface';
import { WarehouseEntity } from '../warehouses/entities/warehouse.entity';
import { AdminSearchQueryDto } from './dto/admin-search-query.dto';

type SearchItemType =
  | 'command'
  | 'product'
  | 'order'
  | 'customer'
  | 'supplier'
  | 'news'
  | 'discount'
  | 'warehouse';

type SearchItem = {
  id: string;
  type: SearchItemType;
  title: string;
  subtitle: string;
  badge: string;
  path: string;
};

type CommandItem = SearchItem & {
  permissions?: string[];
  keywords: string[];
};

@Injectable()
export class AdminSearchService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
    @InjectRepository(OrderEntity)
    private readonly ordersRepository: Repository<OrderEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(SupplierEntity)
    private readonly suppliersRepository: Repository<SupplierEntity>,
    @InjectRepository(NewsEntity)
    private readonly newsRepository: Repository<NewsEntity>,
    @InjectRepository(DiscountEntity)
    private readonly discountsRepository: Repository<DiscountEntity>,
    @InjectRepository(WarehouseEntity)
    private readonly warehousesRepository: Repository<WarehouseEntity>,
  ) {}

  async search(user: IUser, query: AdminSearchQueryDto) {
    const q = (query.q ?? '').trim();
    const limit = Math.min(10, Math.max(1, query.limit ?? 5));
    if (q.length < 2) {
      return { query: q, total: 0, groups: [] };
    }

    const permissions = new Set(user.permissions?.map((permission) => permission.key) ?? []);
    const groups = await Promise.all([
      this.searchCommands(q, permissions, limit),
      this.hasAny(permissions, ['manage_products'])
        ? this.searchProducts(q, limit)
        : Promise.resolve([]),
      this.hasAny(permissions, ['manage_orders'])
        ? this.searchOrders(q, limit)
        : Promise.resolve([]),
      this.hasAny(permissions, ['manage_users'])
        ? this.searchCustomers(q, limit)
        : Promise.resolve([]),
      this.hasAny(permissions, ['manage_products'])
        ? this.searchSuppliers(q, limit)
        : Promise.resolve([]),
      this.hasAny(permissions, ['manage_news'])
        ? this.searchNews(q, limit)
        : Promise.resolve([]),
      this.hasAny(permissions, ['manage_discounts'])
        ? this.searchDiscounts(q, limit)
        : Promise.resolve([]),
      this.hasAny(permissions, ['manage_inventory'])
        ? this.searchWarehouses(q, limit)
        : Promise.resolve([]),
    ]);

    const namedGroups = [
      { key: 'commands', label: 'Chức năng', items: groups[0] },
      { key: 'products', label: 'Sản phẩm', items: groups[1] },
      { key: 'orders', label: 'Đơn hàng', items: groups[2] },
      { key: 'customers', label: 'Khách hàng', items: groups[3] },
      { key: 'suppliers', label: 'Nhà cung cấp', items: groups[4] },
      { key: 'news', label: 'Bài viết', items: groups[5] },
      { key: 'discounts', label: 'Mã giảm giá', items: groups[6] },
      { key: 'warehouses', label: 'Kho hàng', items: groups[7] },
    ].filter((group) => group.items.length > 0);

    return {
      query: q,
      total: namedGroups.reduce((sum, group) => sum + group.items.length, 0),
      groups: namedGroups,
    };
  }

  private async searchProducts(q: string, limit: number): Promise<SearchItem[]> {
    const search = `%${q}%`;
    const products = await this.productsRepository
      .createQueryBuilder('product')
      .where(
        `product.product_name LIKE :search
        OR product.product_slug LIKE :search
        OR product.product_id LIKE :search
        OR product.barcode LIKE :search
        OR product.box_barcode LIKE :search`,
        { search },
      )
      .orderBy('product.updated_at', 'DESC')
      .take(limit)
      .getMany();

    return products.map((product) => ({
      id: product.productId,
      type: 'product',
      title: product.productName,
      subtitle: `Tồn ${product.quantityAvailable} ${product.unit ?? ''}`.trim(),
      badge: product.isShow ? 'Đang hiển thị' : 'Đang ẩn',
      path: `/admin/products?search=${encodeURIComponent(product.productName)}`,
    }));
  }

  private async searchOrders(q: string, limit: number): Promise<SearchItem[]> {
    const search = `%${q}%`;
    const orders = await this.ordersRepository
      .createQueryBuilder('order')
      .where(
        `order.order_id LIKE :search
        OR order.user_id LIKE :search
        OR order.full_name LIKE :search
        OR order.phone LIKE :search`,
        { search },
      )
      .orderBy('order.created_at', 'DESC')
      .take(limit)
      .getMany();

    return orders.map((order) => ({
      id: order.orderId,
      type: 'order',
      title: `Đơn ${order.orderId.slice(0, 8)}`,
      subtitle: `${order.fullName} - ${order.phone}`,
      badge: order.orderStatus,
      path: `/admin/orders?search=${encodeURIComponent(order.orderId)}`,
    }));
  }

  private async searchCustomers(q: string, limit: number): Promise<SearchItem[]> {
    const search = `%${q}%`;
    const users = await this.usersRepository
      .createQueryBuilder('user')
      .where(
        `user.username LIKE :search
        OR user.email LIKE :search
        OR user.user_id LIKE :search`,
        { search },
      )
      .orderBy('user.updated_at', 'DESC')
      .take(limit)
      .getMany();

    return users.map((customer) => ({
      id: customer.userId,
      type: 'customer',
      title: customer.username,
      subtitle: customer.email,
      badge: customer.isActive ? customer.role : 'inactive',
      path: `/admin/customers?search=${encodeURIComponent(customer.username)}`,
    }));
  }

  private async searchSuppliers(q: string, limit: number): Promise<SearchItem[]> {
    const search = `%${q}%`;
    const suppliers = await this.suppliersRepository
      .createQueryBuilder('supplier')
      .where(
        `supplier.name LIKE :search
        OR supplier.code LIKE :search
        OR supplier.phone LIKE :search
        OR supplier.email LIKE :search
        OR supplier.tax_code LIKE :search`,
        { search },
      )
      .orderBy('supplier.updated_at', 'DESC')
      .take(limit)
      .getMany();

    return suppliers.map((supplier) => ({
      id: supplier.supplierId,
      type: 'supplier',
      title: supplier.name,
      subtitle: [supplier.code, supplier.phone, supplier.email].filter(Boolean).join(' - '),
      badge: supplier.isActive ? 'active' : 'inactive',
      path: `/admin/suppliers?search=${encodeURIComponent(supplier.name)}`,
    }));
  }

  private async searchNews(q: string, limit: number): Promise<SearchItem[]> {
    const search = `%${q}%`;
    const articles = await this.newsRepository
      .createQueryBuilder('news')
      .where(
        `news.title LIKE :search
        OR news.sub_title LIKE :search
        OR news.slug LIKE :search`,
        { search },
      )
      .orderBy('news.updated_at', 'DESC')
      .take(limit)
      .getMany();

    return articles.map((article) => ({
      id: String(article.newsId),
      type: 'news',
      title: article.title,
      subtitle: article.subTitle ?? article.slug,
      badge: article.isPublished ? 'published' : 'draft',
      path: `/admin/news?search=${encodeURIComponent(article.title)}`,
    }));
  }

  private async searchDiscounts(q: string, limit: number): Promise<SearchItem[]> {
    const search = `%${q}%`;
    const discounts = await this.discountsRepository
      .createQueryBuilder('discount')
      .where(
        `discount.discount_code LIKE :search
        OR discount.discount_name LIKE :search
        OR discount.discount_description LIKE :search`,
        { search },
      )
      .orderBy('discount.updated_at', 'DESC')
      .take(limit)
      .getMany();

    return discounts.map((discount) => ({
      id: String(discount.discountId),
      type: 'discount',
      title: discount.discountName,
      subtitle: discount.discountCode,
      badge: discount.isActive ? discount.discountType : 'inactive',
      path: `/admin/discounts?search=${encodeURIComponent(discount.discountCode)}`,
    }));
  }

  private async searchWarehouses(q: string, limit: number): Promise<SearchItem[]> {
    const search = `%${q}%`;
    const warehouses = await this.warehousesRepository
      .createQueryBuilder('warehouse')
      .where(
        `warehouse.name LIKE :search
        OR warehouse.code LIKE :search
        OR warehouse.address LIKE :search
        OR warehouse.manager_name LIKE :search
        OR warehouse.phone LIKE :search`,
        { search },
      )
      .orderBy('warehouse.updated_at', 'DESC')
      .take(limit)
      .getMany();

    return warehouses.map((warehouse) => ({
      id: warehouse.warehouseId,
      type: 'warehouse',
      title: warehouse.name,
      subtitle: [warehouse.code, warehouse.managerName, warehouse.phone].filter(Boolean).join(' - '),
      badge: warehouse.isDefault ? 'Mặc định' : warehouse.isActive ? 'active' : 'inactive',
      path: `/admin/warehouses?search=${encodeURIComponent(warehouse.name)}`,
    }));
  }

  private async searchCommands(q: string, permissions: Set<string>, limit: number) {
    const normalized = this.normalize(q);
    return this.commands()
      .filter((command) => this.hasAny(permissions, command.permissions ?? []))
      .filter((command) =>
        [command.title, command.subtitle, command.badge, ...command.keywords]
          .map((value) => this.normalize(value))
          .some((value) => value.includes(normalized)),
      )
      .slice(0, limit);
  }

  private commands(): CommandItem[] {
    return [
      this.command('dashboard', 'Tổng quan', 'Dashboard điều hành', '/admin', ['dashboard', 'tong quan']),
      this.command('products', 'Tất cả sản phẩm', 'Quản lý catalog, giá, tồn kho', '/admin/products', ['san pham', 'catalog'], ['manage_products']),
      this.command('product-new', 'Thêm sản phẩm', 'Tạo sản phẩm mới', '/admin/products/new', ['them san pham', 'tao san pham'], ['manage_products']),
      this.command('low-stock', 'Tổng quan tồn kho', 'Sản phẩm sắp hết hàng', '/admin/products/inventory-lowstock', ['ton kho', 'sap het hang', 'de xuat nhap hang', 'reorder'], ['manage_inventory']),
      this.command('orders', 'Đơn hàng', 'Quản lý trạng thái đơn hàng', '/admin/orders', ['don hang', 'dang giao', 'cho xac nhan'], ['manage_orders']),
      this.command('returns', 'Trả hàng', 'Xử lý yêu cầu trả hàng', '/admin/returns', ['tra hang', 'hoan hang'], ['manage_orders']),
      this.command('customers', 'Khách hàng', 'Tài khoản và thông tin khách', '/admin/customers', ['khach hang', 'tai khoan', 'user'], ['manage_users']),
      this.command('discounts', 'Mã giảm giá', 'Chương trình khuyến mãi', '/admin/discounts', ['coupon', 'giam gia', 'khuyen mai'], ['manage_discounts']),
      this.command('news', 'Bài viết', 'Tin tức và nội dung', '/admin/news', ['bai viet', 'tin tuc', 'blog'], ['manage_news']),
      this.command('reviews', 'Đánh giá sản phẩm', 'Kiểm duyệt review', '/admin/reviews', ['review', 'danh gia'], ['manage_reviews']),
      this.command('support', 'Chat hỗ trợ', 'Hội thoại khách hàng', '/admin/support-chats', ['chat', 'ho tro'], ['manage_support']),
      this.command('suppliers', 'Nhà cung cấp', 'Danh sách nhà cung cấp', '/admin/suppliers', ['nha cung cap', 'supplier'], ['manage_products']),
      this.command('procurement', 'Mua hàng', 'Phiếu mua và nhập hàng', '/admin/procurement', ['mua hang', 'purchase order'], ['manage_products']),
      this.command('pricing', 'Định giá bán', 'Gợi ý và điều chỉnh giá', '/admin/pricing', ['gia ban', 'pricing'], ['manage_products']),
      this.command('warehouses', 'Kho hàng', 'Quản lý kho', '/admin/warehouses', ['kho hang', 'warehouse'], ['manage_inventory']),
      this.command('ledger', 'Sổ kho chi tiết', 'Lịch sử nhập xuất tồn', '/admin/inventory-ledger', ['so kho', 'nhap xuat ton'], ['manage_inventory']),
      this.command('valuation', 'Giá trị tồn kho', 'Báo cáo giá trị hàng tồn', '/admin/inventory-valuation', ['gia tri ton kho'], ['manage_reports']),
      this.command('reports', 'Báo cáo kinh doanh', 'Doanh thu và thống kê', '/admin/reports', ['bao cao', 'doanh thu'], ['manage_reports']),
      this.command('recommendation-ai', 'AI gợi ý sản phẩm', 'Machine Learning recommendation', '/admin/reports', ['ai', 'ml', 'goi y san pham', 'recommendation'], ['manage_reports']),
      this.command('forecast-ai', 'Dự báo nhu cầu', 'Demand forecasting', '/admin/products/inventory-lowstock', ['du bao', 'forecast', 'demand'], ['manage_inventory']),
      this.command('rice-ai', 'AI bệnh lúa', 'Chẩn đoán bệnh lá lúa', '/admin/rice-diagnosis', ['ai', 'benh lua', 'rice'], ['manage_ai_diagnosis']),
      this.command('settings', 'Cài đặt', 'Cấu hình hệ thống', '/admin/settings', ['cai dat', 'settings']),
      this.command('security', 'Bảo mật', 'Đổi mật khẩu và bảo mật tài khoản', '/admin/security', ['bao mat', 'mat khau']),
    ];
  }

  private command(
    id: string,
    title: string,
    subtitle: string,
    path: string,
    keywords: string[],
    permissions?: string[],
  ): CommandItem {
    return {
      id,
      type: 'command',
      title,
      subtitle,
      badge: 'Điều hướng',
      path,
      keywords,
      permissions,
    };
  }

  private hasAny(permissions: Set<string>, required: string[]) {
    if (required.length === 0) {
      return true;
    }
    return required.some((permission) => permissions.has(permission));
  }

  private normalize(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
