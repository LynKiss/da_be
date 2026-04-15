# CLI GENERATE

File nay tong hop cac lenh Nest CLI de tao nhanh khung module, controller, service theo roadmap hien tai.

## Nguyen tac su dung

- Dung CLI de tao khung nhanh
- Sau do tu chinh tay `entity`, `dto`, `service`, `controller`
- Uu tien dung `--no-spec` de tranh sinh them file test mac dinh neu chua can

## Mau lenh co ban

```bash
nest g mo <module>
nest g co <module> --no-spec
nest g s <module> --no-spec
```

Vi du:

```bash
nest g mo permissions
nest g co permissions --no-spec
nest g s permissions --no-spec
```

## Uu tien 1: Permissions va Roles

```bash
nest g mo permissions
nest g co permissions --no-spec
nest g s permissions --no-spec

nest g mo roles
nest g co roles --no-spec
nest g s roles --no-spec
```

Sau khi generate, tu them:

- `src/permissions/entities/permission.entity.ts`
- `src/permissions/dto/`
- `src/roles/entities/role-permission.entity.ts`

## Uu tien 2: Categories va Products

```bash
nest g mo categories
nest g co categories --no-spec
nest g s categories --no-spec

nest g mo products
nest g co products --no-spec
nest g s products --no-spec
```

Sau khi generate, tu them:

- `src/categories/entities/category.entity.ts`
- `src/categories/dto/`
- `src/products/entities/product.entity.ts`
- `src/products/dto/`

## Uu tien 3: Cart va Orders

```bash
nest g mo carts
nest g co carts --no-spec
nest g s carts --no-spec

nest g mo orders
nest g co orders --no-spec
nest g s orders --no-spec
```

Neu tach chi tiet hon:

```bash
nest g mo cart-items
nest g s cart-items --no-spec

nest g mo order-items
nest g s order-items --no-spec

nest g mo order-status-history
nest g s order-status-history --no-spec
```

## Uu tien 4: Discounts

```bash
nest g mo discounts
nest g co discounts --no-spec
nest g s discounts --no-spec
```

Neu can tach riêng:

```bash
nest g mo discount-categories
nest g s discount-categories --no-spec

nest g mo discount-products
nest g s discount-products --no-spec

nest g mo coupon-usage
nest g s coupon-usage --no-spec
```

## Uu tien 5: News va Comments

```bash
nest g mo news
nest g co news --no-spec
nest g s news --no-spec

nest g mo comments
nest g co comments --no-spec
nest g s comments --no-spec
```

Neu muon tach comments theo nghiep vu:

```bash
nest g mo news-comments
nest g s news-comments --no-spec

nest g mo product-comments
nest g s product-comments --no-spec
```

## Uu tien 6: Contacts

```bash
nest g mo contacts
nest g co contacts --no-spec
nest g s contacts --no-spec
```

## Uu tien 7: Reports

```bash
nest g mo reports
nest g co reports --no-spec
nest g s reports --no-spec
```

## Neu can them guard, interceptor, middleware

### Guard

```bash
nest g gu auth/guards/permission --no-spec
```

### Interceptor

```bash
nest g in common/interceptors/logging --no-spec
```

### Middleware

```bash
nest g mi common/middleware/logger --no-spec
```

## Neu muon tao nhanh bang resource

```bash
nest g resource permissions
```

Nhung voi du an nay, khuyen nghi:

- chi dung de lay khung
- sau do sua tay theo schema MySQL that

Khong nen phu thuoc hoan toan vao resource generate mac dinh.

## Cach lam sau khi generate

1. Them `entity` map dung bang MySQL
2. Them `dto`
3. Sua `module` de import `TypeOrmModule.forFeature(...)`
4. Viet `service`
5. Viet `controller`
6. Gan permission cho endpoint can bao ve
7. Test lai

```bash
npm run build
npm run check
npm test -- --runInBand
```
