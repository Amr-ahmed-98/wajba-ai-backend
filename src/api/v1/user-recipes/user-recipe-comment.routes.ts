import { Router } from "express";
import validate from "../../../middlewares/validate.middleware.js";
import { authenticate } from "../../../middlewares/Auth.middleware.js";
import * as userRecipeCommentController from "./user-recipe-comment.controller.js";
import {
    getCommentsSchema,
    addCommentSchema,
    deleteCommentSchema,
    reactToCommentSchema,
    addReplySchema,
    deleteReplySchema,
    reactToReplySchema,
    upsertRatingSchema,
    getMyRatingSchema,
    deleteRatingSchema,
} from "./user-recipe-comment.validation.js";

const router = Router({ mergeParams: true });

// ─────────────────────────────────────────────────────────────
// RATINGS
// ─────────────────────────────────────────────────────────────

router.get(
    "/ratings/me",
    authenticate,
    validate(getMyRatingSchema),
    userRecipeCommentController.getMyRating
);

router.post(
    "/ratings",
    authenticate,
    validate(upsertRatingSchema),
    userRecipeCommentController.upsertRating
);

router.delete(
    "/ratings",
    authenticate,
    validate(deleteRatingSchema),
    userRecipeCommentController.deleteRating
);

// ─────────────────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────────────────

router.get(
    "/comments",
    validate(getCommentsSchema),
    userRecipeCommentController.getComments
);

router.post(
    "/comments",
    authenticate,
    validate(addCommentSchema),
    userRecipeCommentController.addComment
);

router.delete(
    "/comments/:commentId",
    authenticate,
    validate(deleteCommentSchema),
    userRecipeCommentController.deleteComment
);

router.post(
    "/comments/:commentId/like",
    authenticate,
    validate(reactToCommentSchema),
    userRecipeCommentController.likeComment
);

router.post(
    "/comments/:commentId/dislike",
    authenticate,
    validate(reactToCommentSchema),
    userRecipeCommentController.dislikeComment
);

// ─────────────────────────────────────────────────────────────
// REPLIES
// ─────────────────────────────────────────────────────────────

router.post(
    "/comments/:commentId/replies",
    authenticate,
    validate(addReplySchema),
    userRecipeCommentController.addReply
);

router.delete(
    "/comments/:commentId/replies/:replyId",
    authenticate,
    validate(deleteReplySchema),
    userRecipeCommentController.deleteReply
);

router.post(
    "/comments/:commentId/replies/:replyId/like",
    authenticate,
    validate(reactToReplySchema),
    userRecipeCommentController.likeReply
);

router.post(
    "/comments/:commentId/replies/:replyId/dislike",
    authenticate,
    validate(reactToReplySchema),
    userRecipeCommentController.dislikeReply
);

export default router;
