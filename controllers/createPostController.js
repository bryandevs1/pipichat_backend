const db = require('../config/db');
const { uploadToGoogleCloud } = require('../utils/googleCloud'); // Your GCloud util

class PostController {

    // Add this method to the PostController class

// 15. Colored Pattern Post
static async createColoredPost(postData, files) {
  const { 
    pattern_type, background_image, background_color_1, 
    background_color_2, text_color, ...baseData 
  } = postData;

  let backgroundImageUrl = background_image;
  
  // Upload background image if provided
  if (files.background_image) {
    const uploadResult = await uploadToGoogleCloud(files.background_image[0], "colored-patterns");
    backgroundImageUrl = uploadResult.url;
  }

  // First create the colored pattern
  const patternQuery = `
    INSERT INTO posts_colored_patterns (
      type, background_image, background_color_1, background_color_2, text_color
    ) VALUES (?, ?, ?, ?, ?)
  `;
  const [patternResult] = await db.execute(patternQuery, [
    pattern_type || 'color',
    backgroundImageUrl,
    background_color_1,
    background_color_2,
    text_color
  ]);
  const patternId = patternResult.insertId;

  // Create the post with reference to the colored pattern
  const postId = await this.createBasePost({
    ...baseData,
    post_type: 'colored',
    colored_pattern: patternId
  });

  const completePost = await this.getPost(postId);
  return { 
    post_id: postId, 
    pattern_id: patternId, 
    post: completePost 
  };
}
  
  // Main method to create any type of post
  static async createPost(req, res) {
    try {
      const { type } = req.params;
      const postData = req.body;
      const files = req.files || {};

      let result;

      switch (type) {
        case 'text':
          result = await this.createTextPost(postData);
          break;
        case 'article':
          result = await this.createArticlePost(postData, files);
          break;
        case 'video':
          result = await this.createVideoPost(postData, files);
          break;
        case 'photo':
          result = await this.createPhotoPost(postData, files);
          break;
        case 'poll':
          result = await this.createPollPost(postData);
          break;
        case 'product':
          result = await this.createProductPost(postData, files);
          break;
        case 'job':
          result = await this.createJobPost(postData, files);
          break;
        case 'funding':
          result = await this.createFundingPost(postData, files);
          break;
        case 'offer':
          result = await this.createOfferPost(postData, files);
          break;
        case 'live':
          result = await this.createLivePost(postData, files);
          break;
        case 'audio':
          result = await this.createAudioPost(postData, files);
          break;
        case 'link':
          result = await this.createLinkPost(postData);
          break;
        case 'file':
          result = await this.createFilePost(postData, files);
          break;
        case 'media':
          result = await this.createMediaPost(postData);
              break;
        case 'colored': // ← ADD THIS LINE
          result = await this.createColoredPost(postData, files); // ← ADD THIS LINE
              break;
        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid post type'
          });
      }

      res.status(201).json({
        success: true,
        message: `${type.charAt(0).toUpperCase() + type.slice(1)} post created successfully`,
        data: result
      });

    } catch (error) {
      console.error('Post creation error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // ===== BASE POST CREATION =====
  static async createBasePost(postData) {
    const {
      user_id, user_type, in_group, group_id, group_approved, in_event, event_id, event_approved,
      in_wall, wall_id, post_type, colored_pattern, origin_id, time, location, privacy, text,
      feeling_action, feeling_value, boosted, boosted_by, comments_disabled, is_hidden,
      for_adult, is_anonymous, tips_enabled, for_subscriptions, is_paid, post_price, paid_text
    } = postData;

    const query = `
      INSERT INTO posts (
        user_id, user_type, in_group, group_id, group_approved, in_event, event_id, event_approved,
        in_wall, wall_id, post_type, colored_pattern, origin_id, time, location, privacy, text,
        feeling_action, feeling_value, boosted, boosted_by, comments_disabled, is_hidden,
        for_adult, is_anonymous, tips_enabled, for_subscriptions, is_paid, post_price, paid_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.execute(query, [
      user_id, user_type || 'user', in_group || '0', group_id, group_approved || '1', 
      in_event || '0', event_id, event_approved || '1', in_wall || '0', wall_id, 
      post_type, colored_pattern, origin_id, time || new Date(), location, privacy || 'public', text,
      feeling_action, feeling_value, boosted || '0', boosted_by, comments_disabled || '0', 
      is_hidden || '0', for_adult || '0', is_anonymous || '0', tips_enabled || '0', 
      for_subscriptions || '0', is_paid || '0', post_price || 0, paid_text
    ]);

    return result.insertId;
  }

  // ===== SPECIFIC POST TYPE METHODS =====

  // 1. Text Post
  static async createTextPost(postData) {
    const postId = await this.createBasePost({
      ...postData,
      post_type: 'text'
    });

    const completePost = await this.getPost(postId);
    return { post_id: postId, post: completePost };
  }

  // 2. Article Post
  static async createArticlePost(postData, files) {
    const { cover, title, article_text, category_id, tags, ...baseData } = postData;

    let coverImageUrl = null;
    if (files.cover) {
      const uploadResult = await uploadToGoogleCloud(files.cover[0], "articles");
      coverImageUrl = uploadResult.url;
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'article'
    });

    // Create article entry
    const articleQuery = `
      INSERT INTO posts_articles (post_id, cover, title, text, category_id, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await db.execute(articleQuery, [postId, coverImageUrl, title, article_text, category_id, tags]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, article_id: postId, post: completePost };
  }

  // 3. Video Post
  static async createVideoPost(postData, files) {
    const { 
      source, source_240p, source_360p, source_480p, source_720p, source_1080p, 
      source_1440p, source_2160p, thumbnail, category_id, ...baseData 
    } = postData;

    let videoUrl = source;
    let thumbnailUrl = thumbnail;

    // Upload video file if provided
    if (files.video) {
      const uploadResult = await uploadToGoogleCloud(files.video[0], "videos");
      videoUrl = uploadResult.url;
    }

    // Upload thumbnail if provided
    if (files.thumbnail) {
      const uploadResult = await uploadToGoogleCloud(files.thumbnail[0], "videos/thumbnails");
      thumbnailUrl = uploadResult.url;
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'video'
    });

    // Create video entry
    const videoQuery = `
      INSERT INTO posts_videos (
        post_id, source, source_240p, source_360p, source_480p, source_720p,
        source_1080p, source_1440p, source_2160p, thumbnail, category_id, views
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `;
    await db.execute(videoQuery, [
      postId, videoUrl, source_240p, source_360p, source_480p, source_720p,
      source_1080p, source_1440p, source_2160p, thumbnailUrl, category_id
    ]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, video_id: postId, post: completePost };
  }

  // 4. Photo Post (Single or Multiple)
  static async createPhotoPost(postData, files) {
    const { photos, album_id, ...baseData } = postData;

    if (!files.photos || files.photos.length === 0) {
      throw new Error('At least one photo is required');
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'photos'
    });

    // Upload all photos
    const photoUrls = [];
    for (const photoFile of files.photos) {
      const uploadResult = await uploadToGoogleCloud(photoFile, "photos");
      photoUrls.push({
        url: uploadResult.url,
        blur: '0',
        pinned: '0'
      });
    }

    // Create photo entries
    const photoValues = photoUrls.map(photo => [postId, album_id, photo.url, photo.blur, photo.pinned]);
    const photoQuery = 'INSERT INTO posts_photos (post_id, album_id, source, blur, pinned) VALUES ?';
    await db.execute(photoQuery, [photoValues]);

    const completePost = await this.getPost(postId);
    return { 
      post_id: postId, 
      photos_count: photoUrls.length, 
      photos: photoUrls,
      post: completePost 
    };
  }

  // 5. Poll Post
  static async createPollPost(postData) {
    const { options, ...baseData } = postData;

    if (!options || !Array.isArray(options) || options.length < 2) {
      throw new Error('At least 2 options are required for a poll');
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'poll'
    });

    // Create poll
    const pollQuery = `INSERT INTO posts_polls (post_id, votes) VALUES (?, 0)`;
    const [pollResult] = await db.execute(pollQuery, [postId]);
    const pollId = pollResult.insertId;

    // Create options
    const optionValues = options.map(option => [pollId, option.text || option]);
    const optionQuery = 'INSERT INTO posts_polls_options (poll_id, text) VALUES ?';
    await db.execute(optionQuery, [optionValues]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, poll_id: pollId, post: completePost };
  }

  // 6. Product Post
  static async createProductPost(postData, files) {
    const {
      name, price, quantity, category_id, status, product_location,
      available, is_digital, product_download_url, product_file_source, ...baseData
    } = postData;

    let coverImageUrl = null;
    if (files.cover) {
      const uploadResult = await uploadToGoogleCloud(files.cover[0], "products");
      coverImageUrl = uploadResult.url;
    }

    let downloadFileUrl = product_download_url;
    if (files.digital_file && is_digital === '1') {
      const uploadResult = await uploadToGoogleCloud(files.digital_file[0], "products/files");
      downloadFileUrl = uploadResult.url;
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'product'
    });

    // Create product entry
    const productQuery = `
      INSERT INTO posts_products (
        post_id, name, price, quantity, category_id, status, location,
        available, is_digital, product_download_url, product_file_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.execute(productQuery, [
      postId, name, price, quantity, category_id, status || 'new', product_location,
      available || '1', is_digital || '0', downloadFileUrl, product_file_source
    ]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, product_id: postId, post: completePost };
  }

  // 7. Job Post
  static async createJobPost(postData, files) {
    const {
      category_id, title, job_location, salary_minimum, salary_maximum,
      pay_salary_per, type, question_1_type, question_1_title, question_1_choices,
      question_2_type, question_2_title, question_2_choices, question_3_type,
      question_3_title, question_3_choices, cover_image, available, ...baseData
    } = postData;

    let coverImageUrl = cover_image;
    if (files.cover_image) {
      const uploadResult = await uploadToGoogleCloud(files.cover_image[0], "jobs");
      coverImageUrl = uploadResult.url;
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'job'
    });

    // Create job entry
    const jobQuery = `
      INSERT INTO posts_jobs (
        post_id, category_id, title, location, salary_minimum, salary_maximum,
        pay_salary_per, type, question_1_type, question_1_title, question_1_choices,
        question_2_type, question_2_title, question_2_choices, question_3_type,
        question_3_title, question_3_choices, cover_image, available
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.execute(jobQuery, [
      postId, category_id, title, job_location, salary_minimum, salary_maximum,
      pay_salary_per, type, question_1_type, question_1_title, question_1_choices,
      question_2_type, question_2_title, question_2_choices, question_3_type,
      question_3_title, question_3_choices, coverImageUrl, available || '1'
    ]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, job_id: postId, post: completePost };
  }

  // 8. Funding Post
  static async createFundingPost(postData, files) {
    const { title, amount, cover_image, end_date, ...baseData } = postData;

    let coverImageUrl = null;
    if (files.cover_image) {
      const uploadResult = await uploadToGoogleCloud(files.cover_image[0], "funding");
      coverImageUrl = uploadResult.url;
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'funding'
    });

    // Create funding entry
    const fundingQuery = `
      INSERT INTO posts_funding (post_id, title, amount, raised_amount, total_donations, cover_image, end_date)
      VALUES (?, ?, ?, 0, 0, ?, ?)
    `;
    await db.execute(fundingQuery, [postId, title, amount, coverImageUrl, end_date]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, funding_id: postId, post: completePost };
  }

  // 9. Offer Post
  static async createOfferPost(postData, files) {
    const {
      category_id, title, discount_type, discount_percent, discount_amount,
      buy_x, get_y, spend_x, amount_y, end_date, price, thumbnail, ...baseData
    } = postData;

    let thumbnailUrl = thumbnail;
    if (files.thumbnail) {
      const uploadResult = await uploadToGoogleCloud(files.thumbnail[0], "offers");
      thumbnailUrl = uploadResult.url;
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'offer'
    });

    // Create offer entry
    const offerQuery = `
      INSERT INTO posts_offers (
        post_id, category_id, title, discount_type, discount_percent, discount_amount,
        buy_x, get_y, spend_x, amount_y, end_date, price, thumbnail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.execute(offerQuery, [
      postId, category_id, title, discount_type, discount_percent, discount_amount,
      buy_x, get_y, spend_x, amount_y, end_date, price, thumbnailUrl
    ]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, offer_id: postId, post: completePost };
  }

  // 10. Live Stream Post
  static async createLivePost(postData, files) {
    const {
      video_thumbnail, agora_uid, agora_channel_name,
      agora_resource_id, agora_sid, agora_file, ...baseData
    } = postData;

    let thumbnailUrl = video_thumbnail;
    if (files.video_thumbnail) {
      const uploadResult = await uploadToGoogleCloud(files.video_thumbnail[0], "live/thumbnails");
      thumbnailUrl = uploadResult.url;
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'live'
    });

    // Create live entry
    const liveQuery = `
      INSERT INTO posts_live (
        post_id, video_thumbnail, agora_uid, agora_channel_name,
        agora_resource_id, agora_sid, agora_file, live_ended, live_recorded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '0', '0')
    `;
    await db.execute(liveQuery, [
      postId, thumbnailUrl, agora_uid, agora_channel_name,
      agora_resource_id, agora_sid, agora_file
    ]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, live_id: postId, post: completePost };
  }

  // 11. Audio Post
  static async createAudioPost(postData, files) {
    const { source, ...baseData } = postData;

    let audioUrl = source;
    if (files.audio) {
      const uploadResult = await uploadToGoogleCloud(files.audio[0], "audio");
      audioUrl = uploadResult.url;
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'audio'
    });

    // Create audio entry
    const audioQuery = `INSERT INTO posts_audios (post_id, source, views) VALUES (?, ?, 0)`;
    await db.execute(audioQuery, [postId, audioUrl]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, audio_id: postId, post: completePost };
  }

  // 12. Link Post
  static async createLinkPost(postData) {
    const { source_url, source_host, source_title, source_text, source_thumbnail, ...baseData } = postData;

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'link'
    });

    // Create link entry
    const linkQuery = `
      INSERT INTO posts_links (post_id, source_url, source_host, source_title, source_text, source_thumbnail)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await db.execute(linkQuery, [
      postId, source_url, source_host, source_title, source_text, source_thumbnail
    ]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, link_id: postId, post: completePost };
  }

  // 13. File Post
  static async createFilePost(postData, files) {
    const { source, ...baseData } = postData;

    let fileUrl = source;
    if (files.file) {
      const uploadResult = await uploadToGoogleCloud(files.file[0], "files");
      fileUrl = uploadResult.url;
    }

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'file'
    });

    // Create file entry
    const fileQuery = `INSERT INTO posts_files (post_id, source) VALUES (?, ?)`;
    await db.execute(fileQuery, [postId, fileUrl]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, file_id: postId, post: completePost };
  }

  // 14. Media Post (Embedded)
  static async createMediaPost(postData) {
    const { 
      source_url, source_provider, source_type, source_title, 
      source_text, source_html, source_thumbnail, ...baseData 
    } = postData;

    const postId = await this.createBasePost({
      ...baseData,
      post_type: 'media'
    });

    // Create media entry
    const mediaQuery = `
      INSERT INTO posts_media (
        post_id, source_url, source_provider, source_type, source_title, 
        source_text, source_html, source_thumbnail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.execute(mediaQuery, [
      postId, source_url, source_provider, source_type, source_title,
      source_text, source_html, source_thumbnail
    ]);

    const completePost = await this.getPost(postId);
    return { post_id: postId, media_id: postId, post: completePost };
  }

  // ===== UTILITY METHODS =====

  // Get complete post data
  static async getPost(postId) {
    const [postRows] = await db.execute('SELECT * FROM posts WHERE post_id = ?', [postId]);
    if (!postRows.length) return null;

    const post = postRows[0];
    let typeData = null;

    // Get post type specific data
    switch (post.post_type) {
      case 'article':
        [typeData] = await db.execute('SELECT * FROM posts_articles WHERE post_id = ?', [postId]);
        break;
      case 'video':
        [typeData] = await db.execute('SELECT * FROM posts_videos WHERE post_id = ?', [postId]);
        break;
      case 'photos':
        [typeData] = await db.execute('SELECT * FROM posts_photos WHERE post_id = ?', [postId]);
        break;
      case 'poll':
        const [pollData] = await db.execute('SELECT * FROM posts_polls WHERE post_id = ?', [postId]);
        if (pollData.length) {
          const [options] = await db.execute('SELECT * FROM posts_polls_options WHERE poll_id = ?', [pollData[0].poll_id]);
          typeData = { ...pollData[0], options };
        }
        break;
      case 'product':
        [typeData] = await db.execute('SELECT * FROM posts_products WHERE post_id = ?', [postId]);
        break;
      case 'job':
        [typeData] = await db.execute('SELECT * FROM posts_jobs WHERE post_id = ?', [postId]);
        break;
      case 'funding':
        [typeData] = await db.execute('SELECT * FROM posts_funding WHERE post_id = ?', [postId]);
        break;
      case 'offer':
        [typeData] = await db.execute('SELECT * FROM posts_offers WHERE post_id = ?', [postId]);
        break;
      case 'live':
        [typeData] = await db.execute('SELECT * FROM posts_live WHERE post_id = ?', [postId]);
        break;
      case 'audio':
        [typeData] = await db.execute('SELECT * FROM posts_audios WHERE post_id = ?', [postId]);
        break;
      case 'link':
        [typeData] = await db.execute('SELECT * FROM posts_links WHERE post_id = ?', [postId]);
        break;
      case 'file':
        [typeData] = await db.execute('SELECT * FROM posts_files WHERE post_id = ?', [postId]);
        break;
      case 'media':
        [typeData] = await db.execute('SELECT * FROM posts_media WHERE post_id = ?', [postId]);
        break;
    }

    return {
      ...post,
      type_data: typeData && typeData.length ? typeData[0] : null
    };
  }

  // Update post
  static async updatePost(req, res) {
    try {
      const { postId } = req.params;
      const updateData = req.body;

      const fields = Object.keys(updateData).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updateData);
      values.push(postId);

      const query = `UPDATE posts SET ${fields} WHERE post_id = ?`;
      const [result] = await db.execute(query, values);

      res.json({
        success: true,
        message: 'Post updated successfully',
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Delete post
  static async deletePost(req, res) {
    try {
      const { postId } = req.params;
      const [result] = await db.execute('DELETE FROM posts WHERE post_id = ?', [postId]);

      res.json({
        success: true,
        message: 'Post deleted successfully',
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get post by ID
  static async getPostById(req, res) {
    try {
      const { postId } = req.params;
      const post = await this.getPost(postId);

      if (!post) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }

      res.json({
        success: true,
        data: post
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = PostController;