// 📄 ไฟล์นี้ทำหน้าที่: รวม helper แปลงค่า URL/path รูปภาพระหว่างรูปแบบที่เก็บใน Firebase Storage
// กับรูปแบบที่ปลอดภัยสำหรับส่งออกไปกับ API response (proxy ref) ใช้ทั้งตอนบันทึกลง DB และตอนส่งข้อมูล
// ออกให้ client
// 🚀 แปลง Firebase Storage URL (ที่มี download token ยาวๆ ติดมาด้วย) ให้กลายเป็น
// path ภายในของเราเอง แล้วเปลี่ยนเป็น "รูปอ้างอิง" ที่ชี้ไปที่ backend proxy ของเราแทน
// เพื่อไม่ให้ token ของ Firebase หลุดออกไปกับ response ของ API เลย
import { BACKEND_PUBLIC_URL } from '../config/env';

// รูปที่แสดงต่อสาธารณะได้โดยไม่ต้อง login (รูปหอพัก/ห้องพัก/โปรไฟล์) — ให้โหลดผ่าน
// /api/images/proxy (ไม่มี verifyToken) เพื่อให้หน้า Feed หอพักที่เป็น public endpoint ใช้งานได้
const PUBLIC_IMAGE_PREFIXES = ['profiles/', 'dorm_images/', 'room_images/'] as const;

// เอกสารอ่อนไหว (บัตรประชาชน/เอกสารสิทธิ์ครอบครอง) — ให้ Admin ที่ login แล้วเท่านั้นดูได้
// ผ่าน /api/admin/image-proxy (มี verifyToken + requireRole('Admin','Master_Admin'))
const SENSITIVE_IMAGE_PREFIXES = ['id_cards/', 'ownership_proof/'] as const;

export const ALLOWED_IMAGE_PREFIXES = [
  ...PUBLIC_IMAGE_PREFIXES,
  ...SENSITIVE_IMAGE_PREFIXES,
] as const;

export function extractStoragePath(value: string | null | undefined): string | null {
  if (!value) return null;

  // ถ้าเป็น URL แบบ https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media&token=...
  const urlMatch = value.match(/\/o\/([^?]+)/);
  if (urlMatch) {
    try {
      return decodeURIComponent(urlMatch[1]);
    } catch {
      return null;
    }
  }

  // ถ้าเป็น proxy ref ของเราเอง (/api/images/proxy?path=... หรือ /admin/image-proxy?path=...)
  // ดึง query param "path" กลับมาเป็น storage path ดิบ
  const proxyMatch = value.match(/[?&]path=([^&]+)/);
  if (proxyMatch) {
    try {
      const decoded = decodeURIComponent(proxyMatch[1]);
      if (ALLOWED_IMAGE_PREFIXES.some((p) => decoded.startsWith(p))) return decoded;
    } catch {
      return null;
    }
  }

  // ถ้าเป็น path เปล่าอยู่แล้ว (ไม่ใช่ http URL) และขึ้นต้นด้วยโฟลเดอร์ที่อนุญาต
  if (!/^https?:\/\//.test(value) && ALLOWED_IMAGE_PREFIXES.some((p) => value.startsWith(p))) {
    return value;
  }

  return null;
}

export function isAllowedImagePath(storagePath: string): boolean {
  return ALLOWED_IMAGE_PREFIXES.some((prefix) => storagePath.startsWith(prefix));
}

export function isPublicImagePath(storagePath: string): boolean {
  return PUBLIC_IMAGE_PREFIXES.some((prefix) => storagePath.startsWith(prefix));
}

// 🔐 ใช้ตอน "บันทึก" รูปเดี่ยวลง DB — ตัด token ของ Firebase ทิ้ง เหลือแค่ path เปล่าๆ
// (ยกเว้นเป็น URL ภายนอกที่ไม่ใช่ของเราเอง เช่น รูปโปรไฟล์จาก Google OAuth ซึ่งไม่มี token
// ลับอะไรให้ต้องปิด จึงปล่อยผ่านไปตรงๆได้)
export function sanitizeImageInput(value: unknown): string | null {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;

  const storagePath = extractStoragePath(str);
  if (storagePath && isAllowedImagePath(storagePath)) return storagePath;

  if (/^https?:\/\//.test(str)) return str;

  return null;
}

// 🔐 ใช้ตอน "บันทึก" รูปหลายรูป (JSON string ของ array เช่น Dorm_Images/Room_Images) ลง DB
export function sanitizeImageListInput(value: unknown): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return null;
    const cleaned = parsed
      .map((item) => sanitizeImageInput(item))
      .filter((item): item is string => !!item);
    return JSON.stringify(cleaned);
  } catch {
    return null;
  }
}

// แปลง URL/path เดี่ยว → proxy ref ที่ frontend/app เอาไปโชว์ได้ตรงๆ
// - รูป public (profiles/dorm_images/room_images) -> absolute URL ไปที่ /api/images/proxy
//   (ไม่ต้อง login ก็โหลดได้ ใช้ได้ทั้ง Flutter Image.network ตรงๆ และ Angular <img> ตรงๆ)
// - เอกสารอ่อนไหว (id_cards/ownership_proof) -> relative ref ไปที่ /admin/image-proxy
//   (Angular AuthImage จะ fetch ผ่าน HttpClient ที่แนบ Bearer token ให้เอง)
// - ไม่ใช่ path ของเราเอง (เช่น รูปจาก Google OAuth) -> ปล่อยผ่านค่าเดิมไปตรงๆ (ไม่มี token ลับ)
export function toImageProxyRef(value: string | null | undefined): string | null {
  if (!value) return null;

  const storagePath = extractStoragePath(value);
  if (storagePath && isAllowedImagePath(storagePath)) {
    const encoded = encodeURIComponent(storagePath);
    return isPublicImagePath(storagePath)
      ? `${BACKEND_PUBLIC_URL}/api/images/proxy?path=${encoded}`
      : `/admin/image-proxy?path=${encoded}`;
  }

  if (/^https?:\/\//.test(value)) return value;

  return null;
}

// แปลง JSON string ของ array รูปภาพ (เช่น Dorm_Images, Room_Images) ให้เป็น JSON string
// ของ array proxy ref แทน โดยยังคง "รูปร่างเป็น JSON string ของ array" เหมือนเดิม
// เพื่อไม่ต้องแก้โค้ดฝั่ง frontend ที่ JSON.parse() ค่านี้อยู่แล้ว
export function toImageProxyRefListJson(jsonString: string | null | undefined): string | null {
  if (!jsonString) return null;
  try {
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) return null;
    const refs = parsed.map((url) => toImageProxyRef(url)).filter((ref): ref is string => !!ref);
    return JSON.stringify(refs);
  } catch {
    return null;
  }
}
