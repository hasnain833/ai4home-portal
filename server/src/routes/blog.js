import { Router } from "express";
import { requireAuth, requireRoles } from "../middlewares/auth.js";
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

router.get("/", requireAuth, staff, listBlogPosts);
router.post("/", requireAuth, staff, createBlogPost);
router.post("/generate", requireAuth, staff, generateBlogDraft);
router.get("/:id", requireAuth, staff, getBlogPost);
router.patch("/:id", requireAuth, staff, updateBlogPost);
router.delete("/:id", requireAuth, staff, deleteBlogPost);
router.post("/:id/regenerate-section", requireAuth, staff, regenerateSection);
router.post("/:id/approve", requireAuth, staff, approveBlogPost);
router.post("/:id/publish", requireAuth, staff, publishBlogPost);
router.post("/:id/unpublish", requireAuth, staff, unpublishBlogPost);
router.get("/:id/export", requireAuth, staff, exportBlogPost);
router.post("/:id/schedule", requireAuth, staff, scheduleBlogPost);

export default router;
