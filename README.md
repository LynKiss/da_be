# DA_BE

Backend NestJS dung MySQL + TypeORM, JWT access token, refresh token cookie va phan quyen theo:

- `users`
- `permissions`
- `role_permissions`
- `refresh_tokens`

## Chay du an

```bash
npm install
npm run start:dev
```

Mac dinh app chay tai:

```text
http://localhost:8000
```

Base API:

```text
http://localhost:8000/api/v1
```

## Cau hinh `.env`

Toi thieu can:

```env
PORT=8000

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DB=agri_ecommerce

JWT__ACCESS_SECRET=LynABCD
JWT__ACCESS_EXPIRED=300s
JWT_REFRESH_TOKEN=LynABCD
JWT_REFRESH_EXPIRED=6000s
```

## API hien co

### Auth

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/refresh`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/account`

### Users

- `GET /api/v1/users`
- `GET /api/v1/users/me`

## Huong Dan Test Bang Postman

### 1. Tao environment

Tao 2 bien:

- `base_url` = `http://localhost:8000/api/v1`
- `access_token` = de trong luc dau

### 2. Dang nhap

- Method: `POST`
- URL: `{{base_url}}/auth/login`
- Body: `raw -> JSON`

```json
{
  "username": "admin@nongnghiepxanh.vn",
  "password": "123456"
}
```

Neu tai khoan MySQL cua ban dang dung mat khau khac, hay thay bang thong tin that.

Ket qua mong doi:

- response co `access_token`
- response co `user`
- Postman tu luu cookie `refresh_token`

Sau do copy `access_token` vao environment variable `access_token`.

### 3. Them Bearer token

Voi request can dang nhap:

- tab `Authorization`
- Type: `Bearer Token`
- Token: `{{access_token}}`

### 4. Lay thong tin account hien tai

- Method: `GET`
- URL: `{{base_url}}/auth/account`

Dung de kiem tra:

- token con hop le
- user hien tai
- permission hien tai

### 5. Lay profile cua chinh minh

- Method: `GET`
- URL: `{{base_url}}/users/me`

Yeu cau:

- can Bearer token

### 6. Lay danh sach user

- Method: `GET`
- URL: `{{base_url}}/users`

Yeu cau:

- can Bearer token
- user phai co permission `manage_users`

Neu dung admin thi thuong goi duoc. Neu khong du quyen se nhan `403 Forbidden`.

### 7. Refresh access token

- Method: `GET`
- URL: `{{base_url}}/auth/refresh`

Yeu cau:

- khong can Bearer token
- bat buoc phai co cookie `refresh_token`

Ket qua mong doi:

- nhan access token moi
- cookie `refresh_token` duoc cap nhat lai

Sau do cap nhat lai bien `access_token`.

### 8. Logout

- Method: `POST`
- URL: `{{base_url}}/auth/logout`

Yeu cau:

- can Bearer token

Ket qua:

- refresh token trong DB bi revoke
- cookie `refresh_token` bi xoa

## Flow test khuyen nghi

1. `POST /auth/login`
2. `GET /auth/account`
3. `GET /users/me`
4. `GET /users`
5. `GET /auth/refresh`
6. `POST /auth/logout`

## Lenh kiem tra

```bash
npm run build
npm run check
npm test -- --runInBand
```
