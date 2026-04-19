# Postman Manual Endpoints

Base URL:

```text
http://localhost:3000/api/v1
```

Auth:

- Các API trừ `POST /auth/register` và `POST /auth/login` cần header:

```text
Authorization: Bearer <access_token>
```

Postman collection notes:

- `Create Order Happy Path`: khong dung coupon, de chay on dinh hon.
- `Create Order With Discount`: dung `WELCOME10`, chi chay khi ma hop le voi du lieu hien tai.
- Folder `Admin Orders` dung bien `adminAccessToken`.
  Paste token admin vao collection variable `adminAccessToken` truoc khi chay.

## 1. Auth

### Get Available Discounts

```http
GET /discounts
```

Public API, không cần token.

### Register

```http
POST /auth/register
```

```json
{
  "username": "testuser01",
  "email": "testuser01@example.com",
  "password": "Secret123",
  "avatarUrl": "https://example.com/avatar.jpg"
}
```

### Login

```http
POST /auth/login
```

Body type: `x-www-form-urlencoded`

```text
username=testuser01
password=Secret123
```

### Get Account

```http
GET /auth/account
```

### Logout

```http
POST /auth/logout
```

## 2. Profile

### Get My Profile

```http
GET /users/me
```

### Update My Profile

```http
PATCH /users/me
```

```json
{
  "username": "testuser01_updated",
  "avatarUrl": "https://example.com/avatar-new.jpg"
}
```

### Change Password

```http
PATCH /users/me/change-password
```

```json
{
  "oldPassword": "Secret123",
  "newPassword": "Secret1234"
}
```

## 3. Shipping Addresses

### Get My Addresses

```http
GET /users/me/addresses
```

### Create Address

```http
POST /users/me/addresses
```

```json
{
  "recipientName": "Nguyen Van A",
  "phone": "0901234567",
  "addressLine": "123 Test Street",
  "ward": "Ward 1",
  "district": "District 1",
  "province": "Ho Chi Minh",
  "isDefault": true
}
```

### Update Address

```http
PATCH /users/me/addresses/:id
```

Example:

```text
PATCH /users/me/addresses/1
```

```json
{
  "phone": "0907654321",
  "addressLine": "456 Updated Street"
}
```

### Delete Address

```http
DELETE /users/me/addresses/:id
```

Example:

```text
DELETE /users/me/addresses/1
```

### Set Default Address

```http
PATCH /users/me/addresses/:id/default
```

Example:

```text
PATCH /users/me/addresses/1/default
```

## 4. Cart

### Get Cart

```http
GET /cart
```

### Add Item To Cart

```http
POST /cart/items
```

```json
{
  "productId": "prd-0001-1111-1111-1111111111111111",
  "quantity": 1
}
```

### Update Cart Item

```http
PATCH /cart/items/:id
```

Example:

```text
PATCH /cart/items/1
```

```json
{
  "quantity": 2
}
```

### Delete Cart Item

```http
DELETE /cart/items/:id
```

Example:

```text
DELETE /cart/items/1
```

## 5. Wishlist

### Get Wishlist

```http
GET /wishlist
```

### Add Product To Wishlist

```http
POST /wishlist/:productId
```

Example:

```text
POST /wishlist/prd-0001-1111-1111-1111111111111111
```

### Remove Product From Wishlist

```http
DELETE /wishlist/:productId
```

Example:

```text
DELETE /wishlist/prd-0001-1111-1111-1111111111111111
```

## 6. Orders User

### Create Order

```http
POST /orders
```

```json
{
  "shippingAddressId": "1",
  "deliveryId": "1",
  "paymentMethod": "cod",
  "note": "Please call before delivery",
  "discountCode": "WELCOME10"
}
```

### Get Order Detail

```http
GET /orders/:id
```

Example:

```text
GET /orders/your-order-id
```

### Cancel Order

```http
PATCH /orders/:id/cancel
```

Example:

```text
PATCH /orders/your-order-id/cancel
```

### Get My Orders

```http
GET /users/me/orders
```

### Get My Order Detail

```http
GET /users/me/orders/:id
```

Example:

```text
GET /users/me/orders/your-order-id
```

## 7. Orders Admin

Yêu cầu account có permission `manage_orders`.

### Get Orders List

```http
GET /orders
```

Có thể thêm query:

```text
/orders?page=1&limit=10
/orders?status=pending
/orders?search=0901
```

### Get Any Order Detail

```http
GET /orders/:id
```

### Update Order Status

```http
PATCH /orders/:id/status
```

```json
{
  "status": "confirmed",
  "note": "Admin confirmed order"
}
```

Status hợp lệ:

```text
pending
confirmed
processing
shipping
delivered
cancelled
returned
```

Thu tu admin state machine nen test:

```text
confirmed -> processing -> shipping -> delivered
```

## 8. Discounts Admin

Yeu cau account co permission `manage_discounts`.

### Get Discounts For Admin

```http
GET /discounts/admin
```

### Get Discount Detail

```http
GET /discounts/admin/:id
```

### Create Discount

```http
POST /discounts
```

```json
{
  "discountCode": "ADMINTEST10",
  "discountName": "Admin Test Discount",
  "discountType": "percent",
  "appliesTo": "order",
  "startAt": "2026-04-19T00:00:00.000Z",
  "expireDate": "2026-12-31T23:59:59.000Z",
  "discountDescription": "Discount for admin manual test",
  "discountValue": "10",
  "isActive": true,
  "usageLimit": 100,
  "minOrderValue": "100000",
  "maxDiscountAmount": "50000"
}
```

Neu `appliesTo = category` thi them:

```json
{
  "categoryIds": ["1", "2"]
}
```

Neu `appliesTo = product` thi them:

```json
{
  "productIds": ["prd-0001-1111-1111-1111111111111111"]
}
```

### Update Discount

```http
PATCH /discounts/:id
```

```json
{
  "discountName": "Admin Test Discount Updated",
  "usageLimit": 120,
  "isActive": true
}
```

### Delete Discount

```http
DELETE /discounts/:id
```

## 9. Inventory Admin

Yeu cau account co permission `manage_inventory`.

### Get Inventory Transactions

```http
GET /inventory/transactions
```

Co the them query:

```text
/inventory/transactions?page=1&limit=10
/inventory/transactions?productId=prd-0001-1111-1111-1111111111111111
/inventory/transactions?transactionType=export
/inventory/transactions?relatedOrderId=your-order-id
```

## 10. Products With Applied Discount

### Get Products List

```http
GET /products
```

Response hien tai co them:

```text
basePrice
effectivePrice
appliedDiscount
```

### Get Product Detail

```http
GET /products/:id
```

Response detail cung co:

```text
basePrice
effectivePrice
appliedDiscount
```

## 11. Reports Admin

Yeu cau account co permission `manage_reports`.

### Get Dashboard Report

```http
GET /reports/dashboard
```

Response hien tai co them:

```text
salesByDay
topCustomers
```

### Get Sales Summary

```http
GET /reports/sales-summary
```

Co the them query:

```text
/reports/sales-summary?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z
```

Response hien tai co them:

```text
salesByDay
topCustomers
```

## 12. Permission Seed Note

Trong file SQL seed hien tai da bo sung:

```text
manage_reports
```

Va da map cho:

```text
admin
staff
```

## 13. Admin Customer Management

Yeu cau permission `manage_users`.

### Get Customers List

```http
GET /users?page=1&limit=10&role=customer&isActive=true&search=alice
```

### Get Customer Detail

```http
GET /users/admin/customers/:id
```

### Update Customer Active Status

```http
PATCH /users/admin/customers/:id/status
```

Body:

```json
{
  "isActive": false
}
```

## 14. Reviews After Purchase

### Get Product Reviews

```http
GET /reviews/products/:productId
```

### Create Review

```http
POST /reviews/products/:productId
```

Body:

```json
{
  "orderItemId": "1",
  "rating": 5,
  "content": "San pham tot, giao dung mo ta"
}
```

Rule:

```text
chi user da mua va don da delivered moi duoc review
1 user / 1 order item / 1 review
```

## 15. Return / Refund Workflow

### Create Return Request

```http
POST /returns
```

Body:

```json
{
  "orderId": "order-id",
  "orderItemId": "1",
  "reason": "San pham loi",
  "description": "Bi dap vo khi nhan hang"
}
```

### Get My Returns

```http
GET /returns/me
```

### Get Returns List

```http
GET /returns/admin
```

Yeu cau permission `manage_orders`.

### Update Return Status

```http
PATCH /returns/:id/status
```

Body:

```json
{
  "status": "approved",
  "note": "Da xac nhan yeu cau"
}
```

Trang thai ho tro:

```text
requested -> approved/rejected
approved -> received/rejected
received -> refunded
```

## 16. Payment Integration Endpoints

### Initiate Payment

```http
POST /payments/orders/:orderId/initiate
```

Body:

```json
{
  "returnUrl": "http://localhost:3000/payment-return"
}
```

Ho tro order co `paymentMethod`:

```text
vnpay
momo
zalopay
```

### Payment Callback

```http
POST /payments/callback/:provider
```

Body:

```json
{
  "orderId": "order-id",
  "transactionRef": "order-id-1710000000000",
  "amount": "199000.00",
  "success": true,
  "gatewayCode": "00",
  "gatewayMessage": "Success",
  "rawPayload": {
    "providerTxnId": "demo-123"
  }
}
```

### Get Payment Transactions

```http
GET /payments/orders/:orderId/transactions
```

## 17. Inventory Admin Actions

Yeu cau permission `manage_inventory`.

### Import Inventory

```http
POST /inventory/transactions/import
```

Body:

```json
{
  "productId": "product-id",
  "quantity": 50,
  "note": "Nhap kho dau ngay"
}
```

### Adjust Inventory

```http
POST /inventory/transactions/adjust
```

Body:

```json
{
  "productId": "product-id",
  "mode": "decrease",
  "quantity": 2,
  "note": "Hang hong"
}
```

Mode ho tro:

```text
set
increase
decrease
```

## 18. Notifications

### Get My Notifications

```http
GET /notifications/me
```

He thong se tao notification cho:

```text
tao don hang
doi trang thai don hang
cap nhat ket qua thanh toan
yeu cau tra hang
```

## 19. Coupon Usage Report

Yeu cau permission `manage_reports`.

### Get Coupon Usage Report

```http
GET /reports/coupon-usage?page=1&limit=10&discountId=1&userId=user-id
```

Co the them query thoi gian:

```text
/reports/coupon-usage?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.000Z
```
