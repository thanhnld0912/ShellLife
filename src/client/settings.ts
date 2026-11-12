// Cài đặt người chơi (lưu trong trình duyệt): đồ hoạ, âm thanh, voice chat (dùng từ giai đoạn 2 - chơi mạng), điều khiển.
// Mức đồ hoạ và độ nhạy chuột vẫn lưu ở chỗ cũ (quality.ts, mouseLook.ts) để không mất lựa chọn đã có.

const KEY = 'hopdong30-cai-dat';

export interface Settings {
  // Đồ hoạ
  /** Góc nhìn (độ). */
  fov: number;
  /** Độ sáng (phơi sáng tone mapping). */
  brightness: number;
  /** Hiện số khung hình / giây ở góc màn hình. */
  showFps: boolean;
  // Âm thanh (0..1)
  master: number;
  music: number;
  /** Âm thanh trong game: bước chân, máy quét, Người Kiểm Kê, đồ vật… */
  sfx: number;
  /** Loa thông báo của siêu thị (giọng đọc). */
  announcer: number;
  /** Hiện chữ khi loa đọc. */
  subtitles: boolean;
  // Voice chat (giai đoạn 2: chơi mạng). Đã lưu sẵn để dùng ngay khi có chơi mạng.
  voiceEnabled: boolean;
  /** ptt: giữ phím để nói · open: micro luôn mở (tự cắt khi im lặng). */
  voiceMode: 'ptt' | 'open';
  /** Phím giữ để nói (KeyboardEvent.code). */
  voiceKey: string;
  /** Âm lượng giọng người chơi khác (0..1). */
  voiceVolume: number;
  /** Độ nhạy micro (0..1). */
  micGain: number;
  /** Micro đã chọn (deviceId, '' = mặc định). */
  micId: string;
  /** Giọng nói trong game nghe theo khoảng cách (người ở xa nghe nhỏ, Người Kiểm Kê cũng nghe thấy). */
  voiceProximity: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fov: 72,
  brightness: 1.1,
  showFps: false,
  master: 0.85,
  music: 0.5,
  sfx: 0.9,
  announcer: 0.85,
  subtitles: true,
  voiceEnabled: true,
  voiceMode: 'ptt',
  voiceKey: 'KeyV',
  voiceVolume: 0.9,
  micGain: 0.7,
  micId: '',
  voiceProximity: true,
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* chế độ riêng tư: bỏ qua */
  }
}

/** Tên phím dễ đọc: 'KeyV' → 'V', 'Space' → 'Cách'. */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { Space: 'Cách', CapsLock: 'Caps Lock', AltLeft: 'Alt trái', AltRight: 'Alt phải', ControlLeft: 'Ctrl trái', Backquote: '`' };
  return map[code] ?? code;
}
