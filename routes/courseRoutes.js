const express = require("express");
const router = express.Router();
const CourseController = require("../controllers/courseController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/categories", authMiddleware, CourseController.getCategories);
router.get("/", authMiddleware, CourseController.getCourses);
router.get("/:courseId/applications", authMiddleware, CourseController.getApplications);
router.post("/:courseId/apply", authMiddleware, CourseController.applyForCourse);

module.exports = router;
