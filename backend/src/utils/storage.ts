import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

// Ensure uploads folder exists
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for local disk storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

// File filter — only accept allowed types
const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ALLOWED_TYPES = [
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/webp',
    'application/pdf',
  ];

  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('UNSUPPORTED_FILE_TYPE'));
  }
};

// 20 MB limit
export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Helper: get public URL for a stored file
export const getFileUrl = (filename: string): string => {
  return `/uploads/${filename}`;
};

// Helper: delete a file from local storage
export const deleteFile = async (filename: string): Promise<void> => {
  const filePath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};
