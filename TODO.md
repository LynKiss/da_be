# TODO

## Cach lam tong quan

1. Tao `entity` map dung bang MySQL truoc
2. Tao `dto` cho create, update, query
3. Tao `service` xu ly nghiep vu va query TypeORM
4. Tao `controller` expose API
5. Gan `permission` cho endpoint can bao ve
6. Test bang Postman
7. Chay lai:

```bash
npm run build
npm run check
npm test -- --runInBand
```

## Uu tien 1: Permissions va Roles

- Tao `permissions` module
- Tao API lay danh sach permissions
- Tao API xem role hien co nhung permission nao
- Tao API cap nhat permission cho role `admin`
- Tao API cap nhat permission cho role `staff`
- Tao API cap nhat permission cho role `customer`
- Them huong dan test Postman cho permissions va roles

### Cach lam

- Tao `src/permissions/entities`, `src/permissions/permissions.service.ts`, `src/permissions/permissions.controller.ts`, `src/permissions/permissions.module.ts`
- Dung bang `permissions` de doc danh sach quyen
- Dung bang `role_permissions` de gan quyen cho tung role
- Tao endpoint:
  - `GET /permissions`
  - `GET /roles/:role/permissions`
  - `PUT /roles/:role/permissions`
- O endpoint update role permission:
  - xoa danh sach quyen cu cua role
  - insert lai danh sach quyen moi
- Sau khi xong, test bang admin token trong Postman

## Uu tien 2: Categories va Products

- Tao `categories` module
- Tao API lay danh sach categories
- Tao API tao category
- Tao API cap nhat category
- Tao `products` module
- Tao API lay danh sach products
- Tao API xem chi tiet product
- Tao API tao product
- Tao API cap nhat product
- Tao API xoa product
- Them filter, search, phan trang cho products

### Cach lam

- Map entity tu bang `categories` va `products`
- Lam `categories` truoc vi `products` phu thuoc `category_id`
- Viet API read truoc:
  - `GET /categories`
  - `GET /products`
  - `GET /products/:id`
- Sau do moi lam API write:
  - `POST /categories`
  - `PATCH /categories/:id`
  - `POST /products`
  - `PATCH /products/:id`
  - `DELETE /products/:id`
- Them DTO query cho search, filter, sort, pagination
- Them permission:
  - `manage_products`
  - co the bo sung `manage_categories` neu can tach rieng

## Uu tien 3: Cart va Orders

- Tao `shopping_carts` module
- Tao API xem gio hang cua user
- Tao API them san pham vao gio hang
- Tao API cap nhat so luong trong gio hang
- Tao API xoa san pham khoi gio hang
- Tao `orders` module
- Tao API tao don hang tu gio hang
- Tao API xem lich su don hang
- Tao API xem chi tiet don hang
- Tao API cap nhat trang thai don hang

### Cach lam

- Lam `shopping_carts` va `cart_items` truoc
- Sau do lam `orders`, `order_items`, `order_status_history`
- Flow nen di:
  1. lay gio hang
  2. them san pham vao gio
  3. cap nhat gio
  4. tao order tu gio hang
  5. xoa hoac reset gio hang sau khi tao order thanh cong
- API admin cap nhat trang thai order can check permission `manage_orders`
- API user xem lich su order phai loc theo `user_id` dang dang nhap

## Uu tien 4: Discounts

- Tao `discounts` module
- Tao API lay danh sach ma giam gia
- Tao API tao ma giam gia
- Tao API ap dung ma giam gia cho order
- Tao API kiem tra dieu kien su dung ma giam gia
- Tao API quan ly `discount_categories`
- Tao API quan ly `discount_products`

### Cach lam

- Map bang `discounts`, `discount_categories`, `discount_products`, `coupon_usage`
- Lam API validate discount truoc khi gan vao order
- Tach ro 2 nhom:
  - admin quan ly ma giam gia
  - user ap ma giam gia vao don
- Khi ap discount, can check:
  - con han
  - `is_active`
  - `usage_limit`
  - `min_order_value`
  - pham vi ap dung theo order, category, product

## Uu tien 5: News va Comments

- Tao `news` module
- Tao API lay danh sach bai viet
- Tao API tao bai viet
- Tao API cap nhat bai viet
- Tao API xoa bai viet
- Tao `comments` module
- Tao API them comment san pham
- Tao API lay danh sach comment theo san pham
- Tao API an/hien comment

### Cach lam

- Lam `news` va `news_comments` rieng voi `comments` cua product
- Product comments nen co:
  - create
  - list theo `product_id`
  - an/hien cho admin
- News module nen co CRUD co ban truoc, sau do moi them comment news
- Permission goi y:
  - `manage_news`

## Uu tien 6: Contacts va Ho tro

- Tao `contacts` module
- Tao API gui lien he
- Tao API lay danh sach lien he
- Tao API cap nhat trang thai lien he

### Cach lam

- Map entity bang `contacts`
- User gui contact thi route co the la public hoac can login tuy ban
- Admin/staff xem danh sach va cap nhat `status`
- Them filter theo `status`, `created_at`

## Uu tien 7: Bao cao va Quan tri

- Tao API thong ke tong so user
- Tao API thong ke tong so order
- Tao API thong ke doanh thu
- Tao API thong ke ton kho

### Cach lam

- Lam service tong hop query bang QueryBuilder hoac raw SQL
- Tach dashboard admin thanh endpoint rieng, vi du:
  - `GET /reports/overview`
  - `GET /reports/revenue`
  - `GET /reports/inventory`
- Chi cho admin hoac staff duoc truy cap
- Them filter theo ngay, thang, nam

## Uu tien 8: Hoan thien he thong

- Viet them DTO cho tung module
- Them validate dau vao day du
- Them exception handling dong bo
- Them logging cho cac nghiep vu chinh
- Them e2e test cho auth
- Them e2e test cho users
- Them Postman collection json
- Tach them config `jwt`, `app`, `env`
- Viet tai lieu API ro rang hon trong README

### Cach lam

- Moi module lam xong phai bo sung DTO va validation ngay
- Moi endpoint moi phai co Postman test case toi thieu
- Hoan thien README sau moi cum tinh nang lon
- Cuoi moi giai doan phai chay:
  - build
  - lint check
  - test
