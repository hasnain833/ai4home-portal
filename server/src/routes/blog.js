import { Router } from "express";
import { requireAuth, requireRoles, requirePermission } from "../middlewares/auth.js";
import {
  listBlogPosts,
  getBlogPost,
  updateBlogPost,
  deleteBlogPost,
  listLibraryArticles,
  useLibraryArticle,
  approveBlogPost,
  publishBlogPost,
  unpublishBlogPost,
  exportBlogPost,
} from "../controllers/blog.controller.js";

const router = Router();

const staff = requireRoles(["ADMIN", "STAFF"]);
const canManage = requirePermission("blog.manage");

router.get("/", requireAuth, staff, listBlogPosts);
// Articles approved by the AI4Home team. Builders publish only these (no own AI drafts or new posts).
router.get("/library", requireAuth, staff, listLibraryArticles);
router.post("/library/:id/use", requireAuth, staff, canManage, useLibraryArticle);
router.get("/:id", requireAuth, staff, getBlogPost);
router.get("/:id/export", requireAuth, staff, exportBlogPost);

router.patch("/:id", requireAuth, staff, canManage, updateBlogPost);
router.delete("/:id", requireAuth, staff, canManage, deleteBlogPost);

router.post("/:id/approve", requireAuth, staff, canManage, approveBlogPost);
router.post("/:id/publish", requireAuth, staff, canManage, publishBlogPost);
router.post("/:id/unpublish", requireAuth, staff, canManage, unpublishBlogPost);

export default router;
