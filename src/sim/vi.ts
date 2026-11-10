const UNITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc số 0–99 bằng chữ tiếng Việt, để loa đọc. */
export function numberVi(n: number): string {
  n = Math.max(0, Math.floor(n));
  if (n < 10) return UNITS[n];
  if (n >= 100) return String(n);
  const t = Math.floor(n / 10);
  const u = n % 10;
  const head = t === 1 ? 'mười' : `${UNITS[t]} mươi`;
  if (u === 0) return head;
  if (u === 5) return `${head} lăm`;
  if (u === 1 && t > 1) return `${head} mốt`;
  if (u === 4 && t > 1) return `${head} tư`;
  return `${head} ${UNITS[u]}`;
}
