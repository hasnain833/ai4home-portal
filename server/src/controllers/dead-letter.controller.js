import {
  listDeadLetters,
  countByStatus,
  replayDeadLetter,
  discardDeadLetter,
} from "../lib/dead-letter.js";

export const getDeadLetters = async (req, res) => {
  const { status, refId, limit } = req.query;
  const [rows, counts] = await Promise.all([
    listDeadLetters(req.user.companyId, { status, refId, limit }),
    countByStatus(req.user.companyId),
  ]);

  return res.json({ counts, deadLetters: rows });
};

export const replayDeadLetterEntry = async (req, res) => {
  const result = await replayDeadLetter(req.user.companyId, req.params.id);
  if (!result.success) {
    return res
      .status(400)
      .json({ message: result.reason || "Replay failed" });
  }
  return res.json({ success: true, message: "Message re-sent." });
};

export const discardDeadLetterEntry = async (req, res) => {
  const result = await discardDeadLetter(req.user.companyId, req.params.id);
  if (!result.success) {
    return res.status(404).json({ message: result.reason || "Not found" });
  }
  return res.json({ success: true, message: "Entry discarded." });
};
