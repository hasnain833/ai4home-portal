import multer from "multer";

export function handleUploadErrors(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            message: "That file is too large. Please upload a smaller one.",
            code: "FILE_TOO_LARGE",
          });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({
            message: "Unexpected file field in the upload.",
            code: "UNEXPECTED_FILE",
          });
        }
        return res.status(400).json({ message: "That upload could not be read.", code: err.code });
      }

      console.error("[upload] Unexpected upload error:", err?.message || err);
      return res.status(400).json({ message: "That upload could not be read." });
    });
  };
}
