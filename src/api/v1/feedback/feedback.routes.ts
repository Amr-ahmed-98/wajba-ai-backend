import { Router } from "express";
import multer from "multer";
import { ApiError } from "../../../utils/Apierror.js";
import validate from "../../../middlewares/validate.middleware.js";
import { submitFeedbackSchema } from "./feedback.validation.js";
import * as feedbackController from "./feedback.controller.js";

const router = Router();

// ── Multer — memory storage (no temp files on disk) ──────────
// We stream the buffer straight to Cloudinary, so we never need
// to write the file to the filesystem.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB hard limit
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // Pass an error — multer will forward it to the next error handler
      cb(new ApiError(400, "Screenshot must be a JPEG, PNG, or WebP image."));
    }
  },
});

// ── Submit feedback (public — no auth required) ───────────────
/**
 * @swagger
 * /api/v1/feedback:
 *   post:
 *     summary: Submit user feedback
 *     tags: [Feedback]
 *     description: >
 *       Public endpoint — open to guests and registered users alike.
 *       If a valid Bearer token is provided in the Authorization header,
 *       the submission is linked to the authenticated user.
 *       Send as **multipart/form-data** so the optional screenshot file
 *       can be included alongside the text fields.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [observationType, details]
 *             properties:
 *               observationType:
 *                 type: string
 *                 enum: [suggestion, bug_report, complaint, question, other]
 *                 example: bug_report
 *               importanceLevel:
 *                 type: string
 *                 enum: [normal, urgent]
 *                 default: normal
 *                 example: urgent
 *               details:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 2000
 *                 example: The login button does not respond on mobile Safari.
 *               screenshot:
 *                 type: string
 *                 format: binary
 *                 description: Optional screenshot (JPEG / PNG / WebP, max 5 MB)
 *     responses:
 *       201:
 *         description: Feedback submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Feedback submitted successfully. Thank you for helping us improve!
 *                 data:
 *                   type: object
 *                   properties:
 *                     feedbackId:
 *                       type: string
 *                       example: 665f2c3a4b1e2d0012abc123
 *       400:
 *         description: Validation failed or invalid file type
 *       502:
 *         description: Screenshot upload failed
 */
// POST /api/v1/feedback
router.post(
  "/",
  upload.single("screenshot"),   // field name must be "screenshot"
  validate(submitFeedbackSchema),
  feedbackController.submitFeedback
);

export default router;