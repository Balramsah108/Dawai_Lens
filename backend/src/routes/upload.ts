import { Router, Request, Response } from 'express';
import { upload, getFileUrl } from '../utils/storage.js';

const router = Router();

router.post(
  '/upload',
  upload.single('prescription'),
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        error: { code: 'NO_FILE', message: 'No file uploaded.' },
      });
      return;
    }

    res.json({
      message: 'File uploaded successfully',
      file_url: getFileUrl(req.file.filename),
      original_name: req.file.originalname,
      size_bytes: req.file.size,
      mime_type: req.file.mimetype,
    });
  }
);

export default router;
