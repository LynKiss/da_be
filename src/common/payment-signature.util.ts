import { createHmac } from 'node:crypto';

/**
 * Verify HMAC SHA256 signature từ MoMo IPN/redirect callback.
 *
 * MoMo signature spec (https://developers.momo.vn):
 *   rawSignature = "accessKey={accessKey}&amount={amount}&extraData={extraData}
 *                  &message={message}&orderId={orderId}&orderInfo={orderInfo}
 *                  &orderType={orderType}&partnerCode={partnerCode}
 *                  &payType={payType}&requestId={requestId}
 *                  &responseTime={responseTime}&resultCode={resultCode}
 *                  &transId={transId}"
 *   signature   = HMAC_SHA256(rawSignature, secretKey).hex
 *
 * Trả về true nếu signature trong body khớp với chữ ký tính lại.
 */
export function verifyMomoSignature(
  body: Record<string, any>,
  accessKey: string,
  secretKey: string,
): boolean {
  if (!accessKey || !secretKey) return false;
  const incomingSignature = String(body.signature ?? '').trim();
  if (!incomingSignature) return false;

  // MoMo gửi field theo CamelCase trong body, phải đảm bảo string hóa đúng
  const fields = {
    accessKey,
    amount: String(body.amount ?? ''),
    extraData: String(body.extraData ?? ''),
    message: String(body.message ?? ''),
    orderId: String(body.orderId ?? ''),
    orderInfo: String(body.orderInfo ?? ''),
    orderType: String(body.orderType ?? ''),
    partnerCode: String(body.partnerCode ?? ''),
    payType: String(body.payType ?? ''),
    requestId: String(body.requestId ?? ''),
    responseTime: String(body.responseTime ?? ''),
    resultCode: String(body.resultCode ?? ''),
    transId: String(body.transId ?? ''),
  };

  const rawSignature = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const expected = createHmac('sha256', secretKey)
    .update(rawSignature, 'utf8')
    .digest('hex');

  // Constant-time compare để tránh timing attack
  if (expected.length !== incomingSignature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ incomingSignature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify VNPay secure hash (SHA512 với secret key).
 * VNPay spec: dùng vnp_SecureHash = HMAC_SHA512(rawData, vnp_HashSecret)
 * trong đó rawData = các field vnp_* sort theo alpha, nối query string.
 */
type VnpayValue = string | number | boolean | null | undefined | string[];

function normalizeVnpayValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function encodeVnpayValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function buildVnpaySignData(params: Record<string, unknown>): string {
  return Object.keys(params)
    .filter((key) => key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType')
    .filter((key) => key.startsWith('vnp_'))
    .filter((key) => normalizeVnpayValue(params[key]) !== '')
    .sort()
    .map((key) => `${key}=${encodeVnpayValue(normalizeVnpayValue(params[key]))}`)
    .join('&');
}

export function buildVnpaySecureHash(
  params: Record<string, unknown>,
  hashSecret: string,
): string {
  const signData = buildVnpaySignData(params);
  return createHmac('sha512', hashSecret).update(signData, 'utf8').digest('hex');
}

export function buildVnpayPaymentQuery(
  params: Record<string, unknown>,
  hashSecret: string,
): string {
  const secureHash = buildVnpaySecureHash(params, hashSecret);
  const signedParams = { ...params, vnp_SecureHash: secureHash };
  return buildVnpaySignData(signedParams);
}

export function verifyVnpaySignature(
  query: Record<string, unknown>,
  hashSecret: string,
): boolean {
  if (!hashSecret) return false;
  const incomingHash = normalizeVnpayValue(query.vnp_SecureHash)
    .toLowerCase()
    .trim();
  if (!incomingHash) return false;

  const expected = buildVnpaySecureHash(query, hashSecret).toLowerCase();

  if (expected.length !== incomingHash.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ incomingHash.charCodeAt(i);
  }
  return diff === 0;
}

export function verifyZaloPayCallback(
  body: Record<string, any>,
  key2: string,
): boolean {
  if (!key2) return false;
  const data = String(body.data ?? '');
  const incomingMac = String(body.mac ?? '').toLowerCase().trim();
  if (!data || !incomingMac) return false;

  const expected = createHmac('sha256', key2)
    .update(data, 'utf8')
    .digest('hex')
    .toLowerCase();

  if (expected.length !== incomingMac.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ incomingMac.charCodeAt(i);
  }
  return diff === 0;
}
