const express = require("express");
const router = express.Router();
const CourseController = require("../controllers/courseController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.get("/categories", authenticateToken, CourseController.getCategories);
router.get("/", authenticateToken, CourseController.getCourses);
router.get("/:courseId/applications", authenticateToken, CourseController.getApplications);
router.post("/:courseId/apply", authenticateToken, CourseController.applyForCourse);

module.exports = router;
