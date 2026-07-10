import { Router } from "express";
import { getPublicBlogList, getPublicBlogPost } from "../controllers/blog.controller.js";

const router = Router();

router.get("/:companyId", getPublicBlogList);
router.get("/:companyId/:slug", getPublicBlogPost);

export default router;
