import { Router } from "express";
import { requireAuth, requireRoles, requirePermission } from "../middlewares/auth.js";
import {
  listBlogPosts,
  getBlogPost,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
  generateBlogDraft,
  regenerateSection,
  approveBlogPost,
  publishBlogPost,
  unpublishBlogPost,
  exportBlogPost,
  scheduleBlogPost,
} from "../controllers/blog.controller.js";

const router = Router();

const staff = requireRoles(["ADMIN", "STAFF"]);
const canManage = requirePermission("blog.manage");

router.get("/", requireAuth, staff, listBlogPosts);
router.get("/:id", requireAuth, staff, getBlogPost);
router.get("/:id/export", requireAuth, staff, exportBlogPost);

router.post("/", requireAuth, staff, canManage, createBlogPost);
router.post("/generate", requireAuth, staff, canManage, generateBlogDraft);
router.patch("/:id", requireAuth, staff, canManage, updateBlogPost);
router.delete("/:id", requireAuth, staff, canManage, deleteBlogPost);
router.post(
  "/:id/regenerate-section",
  requireAuth,
  staff,
  canManage,
  regenerateSection,
);

router.post("/:id/approve", requireAuth, staff, canManage, approveBlogPost);
router.post("/:id/publish", requireAuth, staff, canManage, publishBlogPost);
router.post("/:id/unpublish", requireAuth, staff, canManage, unpublishBlogPost);
router.post("/:id/schedule", requireAuth, staff, canManage, scheduleBlogPost);

export default router;
