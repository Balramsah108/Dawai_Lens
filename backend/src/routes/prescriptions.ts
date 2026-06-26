import { Router } from 'express';
import { upload } from '../utils/storage.js';
import { requireAuth } from '../middlewares/auth.js';
import {
  createPrescription,
  getPrescriptionImage,
  deletePrescription,
} from '../controllers/prescriptionController.js';

const router = Router();

// POST /api/v1/prescriptions — upload a prescription
router.post(
  '/',
  requireAuth,
  upload.single('prescription'),
  createPrescription
);

// GET /api/v1/prescriptions/:id/image — get image URL
router.get('/:id/image', requireAuth, getPrescriptionImage);

// DELETE /api/v1/prescriptions/:id — delete prescription
router.delete('/:id', requireAuth, deletePrescription);

export default router;
