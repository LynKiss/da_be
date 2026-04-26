/**
 * Tax / VAT engine basic.
 *
 * Hiện tại VN VAT phổ biến: 10% (mặc định), 8% (giảm theo nghị quyết),
 * 5% (sản phẩm thiết yếu), 0% (xuất khẩu).
 *
 * Hệ thống lưu tax rate ở settings (`commerce.taxRate`). Khi tính order:
 *   - subtotalAmount đã bao gồm giá bán (giá đã VAT theo thực tế VN)
 *   - vatAmount = subtotal × taxRate / (100 + taxRate)
 *   - netAmount = subtotal - vatAmount
 *
 * Nếu bật `taxInclusive=false`, VAT được cộng thêm:
 *   - vatAmount = subtotal × taxRate / 100
 *   - totalPayment = subtotal + vatAmount + delivery - discount
 */
export interface TaxConfig {
  enabled: boolean;
  taxRate: number;        // % (0-100)
  taxInclusive: boolean;  // giá bán đã bao gồm VAT chưa
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  enabled: false,
  taxRate: 10,
  taxInclusive: true,
};

export interface TaxBreakdown {
  netAmount: number;
  vatAmount: number;
  grossAmount: number; // tổng đã bao gồm VAT
  taxRate: number;
  config: TaxConfig;
}

/**
 * Tách tax từ subtotal.
 * @param subtotal Số tiền hàng (chưa bao gồm phí ship, chưa giảm giá)
 * @param config Cấu hình tax
 */
export function calculateTax(subtotal: number, config: TaxConfig): TaxBreakdown {
  if (!config.enabled || config.taxRate <= 0) {
    return {
      netAmount: subtotal,
      vatAmount: 0,
      grossAmount: subtotal,
      taxRate: 0,
      config,
    };
  }

  const rate = config.taxRate / 100;

  if (config.taxInclusive) {
    const netAmount = subtotal / (1 + rate);
    const vatAmount = subtotal - netAmount;
    return {
      netAmount: Math.round(netAmount * 100) / 100,
      vatAmount: Math.round(vatAmount * 100) / 100,
      grossAmount: subtotal,
      taxRate: config.taxRate,
      config,
    };
  }

  const vatAmount = Math.round(subtotal * rate * 100) / 100;
  return {
    netAmount: subtotal,
    vatAmount,
    grossAmount: subtotal + vatAmount,
    taxRate: config.taxRate,
    config,
  };
}
