const express = require("express");

const healthRoutes = require("./health");
const examRoutes = require("./exams");
const recordingRoutes = require("./recordings");

/** Every route in the service hangs off /api. */
const router = express.Router();

router.use(healthRoutes);
router.use(examRoutes);
router.use(recordingRoutes);

module.exports = router;
