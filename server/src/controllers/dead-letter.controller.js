import {
  listDeadLetters,
  countByStatus,
  replayDeadLetter,
  discardDeadLetter,
} from "../lib/dead-letter.js";

export const getDeadLetters = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const { status, refId, limit } = req.query;
    const [rows, counts] = await Promise.all([
      listDeadLetters(req.user.companyId, { status, refId, limit }),
      countByStatus(req.user.companyId),
    ]);

    return res.json({ counts, deadLetters: rows });
  } catch (error) {
    console.error("[DLQ] List error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const replayDeadLetterEntry = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const result = await replayDeadLetter(req.user.companyId, req.params.id);
    if (!result.success) {
      return res
        .status(400)
        .json({ message: result.reason || "Replay failed" });
    }
    return res.json({ success: true, message: "Message re-sent." });
  } catch (error) {
    console.error("[DLQ] Replay error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const discardDeadLetterEntry = async (req, res) => {
  try {
    if (!req.user || !req.user.companyId) {
      return res.status(403).json({ message: "No company associated" });
    }

    const result = await discardDeadLetter(req.user.companyId, req.params.id);
    if (!result.success) {
      return res.status(404).json({ message: result.reason || "Not found" });
    }
    return res.json({ success: true, message: "Entry discarded." });
  } catch (error) {
    console.error("[DLQ] Discard error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
