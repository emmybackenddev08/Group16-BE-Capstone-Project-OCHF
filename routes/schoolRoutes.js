const express = require("express");
const router = express.Router();
const {
    getSchools,
    getSchoolById,
    createSchool,
} = require("../controller/schoolController");
const { protect, authorize } = require("../middleware/auth");

// Public endpoints to browse registered institutions
router.get("/", getSchools);
router.get("/:id", getSchoolById);

// Admin-only endpoint to register a new school
router.post("/", protect, authorize("admin"), createSchool);

module.exports = router;
