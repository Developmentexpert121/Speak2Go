const express = require("express");

const recordingService = require("../services/recordingService");
const { validateFetchRecording } = require("../validators/recordingValidator");
const { asyncHandler } = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/recordings", (req, res) => res.json(recordingService.listAvailableRecordings()));

/**
 * Pull one recording from the Speak2Go platform. Addressed by
 * (userEmail, idDetection) rather than by URL — the bucket is private and the
 * app resolves the key itself after authorising the caller.
 */
router.post(
  "/recordings/fetch",
  asyncHandler(async (req, res) => {
    const input = validateFetchRecording(req.body);
    res.json(await recordingService.fetchRecording(input));
  })
);

module.exports = router;
