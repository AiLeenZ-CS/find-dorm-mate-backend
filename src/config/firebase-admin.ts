// 📄 ไฟล์นี้ทำหน้าที่: ตั้งค่าและ initialize Firebase Admin SDK กลางของระบบ ให้ฟีเจอร์ที่ต้องพึ่ง
// Firebase (Storage proxy, Custom Token แชท, sync Firestore, Push Notification ผ่าน FCM) เรียกใช้
// ร่วมกันผ่าน getStorageBucket/getFirebaseAuth/getFirestoreDb/getMessaging
import admin from 'firebase-admin';
import path from 'path';

// 🚀 ต้องมีไฟล์ Service Account Key จาก Firebase Console ก่อนถึงจะใช้งานได้จริง — Service
// Account ตัวเดียวนี้ครอบคลุมทุกฟีเจอร์ของ Firebase Admin SDK พร้อมกัน (Storage proxy, Custom
// Token สำหรับแชท, sync Firestore, และ Push Notification ผ่าน FCM) ไม่ต้องขอไฟล์แยกสำหรับ FCM
// วิธีได้มา: Firebase Console → เลือกโปรเจกต์ → ⚙️ Project Settings → แท็บ "Service Accounts"
//           → กด "Generate new private key" → ดาวน์โหลดไฟล์ .json ที่ได้มา
// แล้วนำไฟล์มาวางไว้ที่ Backend/firebase-service-account.json (อยู่ใน .gitignore แล้ว ห้าม commit
// ขึ้น git เด็ดขาด เพราะเป็นกุญแจเข้าถึงโปรเจกต์ Firebase ทั้งหมด)
// จากนั้นตั้งค่าใน .env (ไฟล์ Backend/.env):
//   FIREBASE_SERVICE_ACCOUNT_PATH="./firebase-service-account.json"
//   FIREBASE_STORAGE_BUCKET="find-dorm-mate.firebasestorage.app"
// ไม่ต้องตั้งค่าอะไรเพิ่มใน Firebase Console สำหรับ FCM โดยเฉพาะ — แค่โปรเจกต์ Firebase เปิดใช้
// Cloud Messaging API ไว้แล้ว (ค่าเริ่มต้นเปิดอยู่แล้วสำหรับทุกโปรเจกต์) ก็ยิง push ได้ทันที
//
// 🚀 ตอน deploy ขึ้น host (Railway ฯลฯ) จะไม่มีไฟล์ .json นี้อยู่ในเครื่อง (ไม่ได้ commit ขึ้น git)
// ให้ตั้งค่า FIREBASE_SERVICE_ACCOUNT_JSON แทน โดยเอาเนื้อหาทั้งไฟล์ (เป็น JSON string บรรทัดเดียว)
// ไปวางเป็นค่า environment variable บน host ตรงๆ — โค้ดจะ parse ตรงนี้แทนการเปิดไฟล์จากดิสก์
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

let bucket: ReturnType<admin.storage.Storage['bucket']> | null = null;

export function isFirebaseAdminConfigured(): boolean {
  return !!((serviceAccountPath || serviceAccountJson) && storageBucket);
}

// 🚀 ใช้ร่วมกันทุกฟีเจอร์ที่ต้องพึ่ง Firebase Admin SDK (Storage proxy, ออก Custom Token
// ผูก Member_ID สำหรับระบบแชท, sync ข้อมูลลง Firestore) — initializeApp แค่ครั้งเดียว
function ensureInitialized(): void {
  if (!isFirebaseAdminConfigured()) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า FIREBASE_SERVICE_ACCOUNT_PATH (หรือ FIREBASE_SERVICE_ACCOUNT_JSON) / FIREBASE_STORAGE_BUCKET ใน .env — ฟีเจอร์ที่ต้องใช้ Firebase Admin SDK จะยังใช้งานไม่ได้'
    );
  }

  if (!admin.apps.length) {
    const credential = serviceAccountJson
      ? admin.credential.cert(JSON.parse(serviceAccountJson))
      : admin.credential.cert(path.resolve(process.cwd(), serviceAccountPath!));
    admin.initializeApp({ credential, storageBucket });
  }
}

export function getStorageBucket() {
  if (bucket) return bucket;
  ensureInitialized();
  bucket = admin.storage().bucket();
  return bucket;
}

// 🆕 ใช้ออก Firebase Custom Token ผูกกับ Member_ID จริง (ดู getFirebaseToken ใน
// auth.controller.ts) ให้ Firestore Security Rules เช็ค request.auth.uid ได้ถูกต้อง
// แทนที่จะเป็น anonymous uid สุ่มๆ ที่ไม่รู้ว่าเป็นสมาชิกคนไหน
export function getFirebaseAuth() {
  ensureInitialized();
  return admin.auth();
}

// 🆕 ใช้ฝั่ง backend เท่านั้น (Admin SDK เขียนข้าม Security Rules ได้) สำหรับ sync รายชื่อ
// participant ของห้องแชทตอนอนุมัติคำขอจับคู่ (ดู respondToMatchRequest ใน
// roommate.controller.ts) — ฝั่ง Flutter ห้าม insert participantIds เอง ต้องมาจาก backend
// ที่ตรวจสิทธิ์แล้วเท่านั้น ไม่งั้นใครก็เขียนตัวเองเข้าห้องแชทของคนอื่นได้
export function getFirestoreDb() {
  ensureInitialized();
  return admin.firestore();
}

// 🆕 ใช้ยิง Push Notification (FCM) ไปที่ Device Token ของผู้ใช้ — ดู createNotification
// ใน Backend/src/utils/notifications.ts (ยิง push ควบคู่กับบันทึกแจ้งเตือนลง MySQL เสมอ)
export function getMessaging() {
  ensureInitialized();
  return admin.messaging();
}
