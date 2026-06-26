import { Request, Response } from 'express';
import pool from '../db/db.js';
import { getFileUrl, deleteFile } from '../utils/storage.js';

// POST /api/v1/prescriptions
// Saves the uploaded file info to the DB
export const createPrescription = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        error: { code: 'NO_FILE', message: 'No prescription file uploaded.' },
      });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
      });
      return;
    }

    // Ensure user exists in DB (dev mode auto-creates)
    await pool.query(
      `INSERT INTO users (id, phone, firebase_uid)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, req.user?.phone ?? '9999999999', userId]
    );

    // Get profile_id from body, fall back to primary profile
    const { profile_id } = req.body as { profile_id?: string };

    // Find primary profile if none provided
    let profileId = profile_id;
    if (!profileId) {
      const profileResult = await pool.query(
        'SELECT id FROM family_profiles WHERE user_id = $1 AND is_primary = true LIMIT 1',
        [userId]
      );
      if (profileResult.rows.length === 0) {
        // Auto-create primary profile if it doesn't exist
        const newProfile = await pool.query(
          `INSERT INTO family_profiles (user_id, name, is_primary)
           VALUES ($1, 'Primary', true)
           RETURNING id`,
          [userId]
        );
        profileId = newProfile.rows[0].id as string;
      } else {
        profileId = profileResult.rows[0].id as string;
      }
    }

    // Save prescription record to DB
    const filePath = req.file.filename; // stored filename (UUID-based)
    const result = await pool.query(
      `INSERT INTO prescriptions (user_id, profile_id, file_path)
       VALUES ($1, $2, $3)
       RETURNING id, file_path, uploaded_at`,
      [userId, profileId, filePath]
    );

    const prescription = result.rows[0] as {
      id: string;
      file_path: string;
      uploaded_at: string;
    };

    res.status(201).json({
      prescription_id: prescription.id,
      file_url: getFileUrl(prescription.file_path),
      uploaded_at: prescription.uploaded_at,
      profile_id: profileId,
      // task_id will be added when OCR is implemented
      task_id: null,
    });
  } catch (err) {
    console.error('createPrescription error:', err);
    res.status(500).json({
      error: { code: 'UPLOAD_FAILED', message: 'Upload failed. Please try again.' },
    });
  }
};

// GET /api/v1/prescriptions/:id/image
// Returns the file URL for a prescription image
export const getPrescriptionImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params as { id: string };

    const result = await pool.query(
      'SELECT file_path FROM prescriptions WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prescription not found.' },
      });
      return;
    }

    const filePath = (result.rows[0] as { file_path: string }).file_path;
    res.json({ file_url: getFileUrl(filePath) });
  } catch (err) {
    console.error('getPrescriptionImage error:', err);
    res.status(500).json({
      error: { code: 'SERVER_ERROR', message: 'Something went wrong.' },
    });
  }
};

// DELETE /api/v1/prescriptions/:id
export const deletePrescription = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params as { id: string };

    const result = await pool.query(
      'SELECT file_path FROM prescriptions WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prescription not found.' },
      });
      return;
    }

    const filePath = (result.rows[0] as { file_path: string }).file_path;

    // Delete from DB
    await pool.query('DELETE FROM prescriptions WHERE id = $1', [id]);

    // Delete file from disk
    await deleteFile(filePath);

    res.json({ message: 'Prescription deleted successfully.' });
  } catch (err) {
    console.error('deletePrescription error:', err);
    res.status(500).json({
      error: { code: 'SERVER_ERROR', message: 'Something went wrong.' },
    });
  }
};
