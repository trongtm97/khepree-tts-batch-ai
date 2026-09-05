/** Map Khepree access gate codes to Vietnamese operator messages. */
export const KHEPREE_ACCESS_ERROR_VI = {
  BOOTING: "Đang khởi động bản quyền — thử lại sau vài giây.",
  AUTH_REQUIRED: "Cần đăng nhập Khepree trước khi tổng hợp giọng.",
  VALIDATING_SESSION: "Đang kiểm tra phiên Khepree — thử lại sau vài giây.",
  ENTITLEMENT_MISSING:
    "Chưa có bản quyền — mở tab Khepree, đăng nhập để kích hoạt dùng thử 1 ngày hoặc mua gói Tháng/Năm.",
  ENTITLEMENT_EXPIRED: "Bản quyền đã hết hạn — mua gói Tháng/Năm trên tab Khepree.",
  ENTITLEMENT_SUSPENDED: "Bản quyền đang bị tạm khóa — kiểm tra tài khoản Khepree.",
  DEVICE_REMOVED: "Thiết bị đã bị gỡ khỏi bản quyền — đăng nhập lại để kích hoạt.",
  DEVICE_BLOCKED: "Thiết bị bị chặn — liên hệ hỗ trợ Khepree.",
  OFFLINE_COLD_START: "Không kết nối được Khepree — kiểm tra mạng rồi nhấn Làm mới.",
  ERROR: "Lỗi bản quyền Khepree — mở tab Khepree và làm mới phiên.",
  KHEPREE_ACCESS_REQUIRED: "Cần bản quyền Khepree hợp lệ để tổng hợp giọng.",
};

export function formatKhepreeAccessError(code) {
  const raw = String(code || "").trim();
  if (!raw) return KHEPREE_ACCESS_ERROR_VI.KHEPREE_ACCESS_REQUIRED;
  if (raw.startsWith("KHEPREE_FEATURE_NOT_ALLOWED:")) {
    return `Tính năng không được phép: ${raw.slice("KHEPREE_FEATURE_NOT_ALLOWED:".length)}`;
  }
  return KHEPREE_ACCESS_ERROR_VI[raw] || raw;
}
