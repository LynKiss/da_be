// Ten role admin mac dinh cua he thong.
// Chon "ADMIN" de dong bo voi logic hien tai trong users/auth service.
export const ADMIN_ROLE = 'ADMIN';

// Ten role user mac dinh cua he thong.
// Chon "USER" de phu hop voi flow register() dang tim role nay.
export const USER_ROLE = 'USER';

// Danh sach permission mau se duoc seed vao database khi app khoi dong.
// Moi object ben duoi tuong ung 1 quyen truy cap API trong he thong.
export const INIT_PERMISSIONS = [
  {
    // Ten hien thi cua permission tren giao dien/admin.
    name: 'Get Users',
    // Duong dan API duoc cap quyen.
    apiPath: '/api/v1/users',
    // HTTP method cua API.
    method: 'GET',
    // Module ma permission nay thuoc ve.
    module: 'USERS',
  },
  {
    name: 'Create User',
    apiPath: '/api/v1/users',
    method: 'POST',
    module: 'USERS',
  },
  {
    name: 'Get Jobs',
    apiPath: '/api/v1/jobs',
    method: 'GET',
    module: 'JOBS',
  },
  {
    name: 'Create Resume',
    apiPath: '/api/v1/resumes',
    method: 'POST',
    module: 'RESUMES',
  },
  {
    name: 'Get Companies',
    apiPath: '/api/v1/companies',
    method: 'GET',
    module: 'COMPANIES',
  },
];

// Danh sach user mau se duoc tao neu chua ton tai trong database.
// password khong de o day vi password se duoc lay tu .env va hash trong service.
export const INIT_USERS = [
  {
    // Ten hien thi cua user.
    name: 'System Admin',
    // Email dang nhap cua admin mac dinh.
    email: 'admin@gmail.com',
    // Tuoi demo.
    age: 30,
    // Gioi tinh demo.
    gender: 'MALE',
    // Dia chi demo.
    address: 'VietNam',
    // roleName la ten role de service tim _id role tu collection roles roi gan vao user.
    roleName: ADMIN_ROLE,
  },
  {
    name: 'Normal User',
    email: 'user@gmail.com',
    age: 25,
    gender: 'MALE',
    address: 'VietNam',
    roleName: USER_ROLE,
  },
];
