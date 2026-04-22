const express = require('express');
const multer = require('multer');
const PostController = require('../controllers/createPostController');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  }
});

// Create posts with file upload support
router.post('/:type', upload.any(), PostController.createPost);

// Get post by ID
router.get('/:postId', PostController.getPostById);

// Update post
router.put('/:postId', PostController.updatePost);

// Delete post
router.delete('/:postId', PostController.deletePost);

module.exports = router;