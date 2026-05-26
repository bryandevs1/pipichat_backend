    -- ============================================================================
    -- DATABASE MIGRATION: Transform OLD schema to match NEW schema
    -- ============================================================================
    -- This script contains all necessary ALTER TABLE and CREATE TABLE commands
    -- to migrate the old database schema to match the new one perfectly.
    -- 
    -- Summary:
    -- - 3 NEW tables to CREATE: group_storage_data, story_reactions, story_views
    -- - 131 tables with COLUMN MODIFICATIONS (ALTER TABLE)
    -- ============================================================================

    -- ============================================================================
    -- SECTION 1: CREATE NEW TABLES (NOT IN OLD SCHEMA)
    -- ============================================================================

    -- 1. CREATE TABLE: group_storage_data
    CREATE TABLE IF NOT EXISTS group_storage_data (
    id int unsigned NOT NULL AUTO_INCREMENT,
    group_id int unsigned NOT NULL,
    picture_storage_type enum('google-cloud','cloudinary','local') DEFAULT NULL,
    picture_storage_data text,
    cover_storage_type enum('google-cloud','cloudinary','local') DEFAULT NULL,
    cover_storage_data text,
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 2. CREATE TABLE: story_reactions
    CREATE TABLE IF NOT EXISTS story_reactions (
    id int unsigned NOT NULL AUTO_INCREMENT,
    story_id int unsigned NOT NULL,
    user_id int unsigned NOT NULL,
    reaction enum('like','love','haha','wow','sad','angry') NOT NULL,
    reacted_at datetime NOT NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 3. CREATE TABLE: story_views
    CREATE TABLE IF NOT EXISTS story_views (
    id int unsigned NOT NULL AUTO_INCREMENT,
    story_id int unsigned NOT NULL,
    user_id int unsigned NOT NULL,
    viewed_at datetime NOT NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- ============================================================================
    -- SECTION 2: ALTER EXISTING TABLES (COLUMN MODIFICATIONS)
    -- ============================================================================

    -- 1. ADS_CAMPAIGNS - Column type changes
    ALTER TABLE ads_campaigns MODIFY campaign_id int AUTO_INCREMENT;
    ALTER TABLE ads_campaigns MODIFY campaign_user_id int unsigned;
    ALTER TABLE ads_campaigns MODIFY ads_page int unsigned;
    ALTER TABLE ads_campaigns MODIFY ads_group int unsigned;
    ALTER TABLE ads_campaigns MODIFY ads_event int unsigned;
    ALTER TABLE ads_campaigns MODIFY campaign_views int unsigned;
    ALTER TABLE ads_campaigns MODIFY campaign_clicks int unsigned;

    -- 2. ADS_SYSTEM - Column type changes
    ALTER TABLE ads_system MODIFY ads_id int AUTO_INCREMENT;

    -- 3. AFFILIATES_PAYMENTS - Column type changes
    ALTER TABLE affiliates_payments MODIFY payment_id int AUTO_INCREMENT;
    ALTER TABLE affiliates_payments MODIFY user_id int unsigned;

    -- 4. ANNOUNCEMENTS - Column type changes
    ALTER TABLE announcements MODIFY announcement_id int AUTO_INCREMENT;

    -- 5. ANNOUNCEMENTS_USERS - Column type changes
    ALTER TABLE announcements_users MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE announcements_users MODIFY announcement_id int unsigned;
    ALTER TABLE announcements_users MODIFY user_id int unsigned;

    -- 6. AUTO_CONNECT - Column type changes
    ALTER TABLE auto_connect MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE auto_connect MODIFY country_id int unsigned;

    -- 7. BANK_TRANSFERS - Column type changes
    ALTER TABLE bank_transfers MODIFY transfer_id int unsigned AUTO_INCREMENT;
    ALTER TABLE bank_transfers MODIFY user_id int unsigned;
    ALTER TABLE bank_transfers MODIFY package_id int unsigned;
    ALTER TABLE bank_transfers MODIFY post_id int unsigned;
    ALTER TABLE bank_transfers MODIFY plan_id int unsigned;
    ALTER TABLE bank_transfers MODIFY movie_id int unsigned;

    -- 8. BLACKLIST - Column type changes
    ALTER TABLE blacklist MODIFY node_id int unsigned AUTO_INCREMENT;

    -- 9. BLOGS_CATEGORIES - Column type changes
    ALTER TABLE blogs_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE blogs_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE blogs_categories MODIFY category_order int unsigned;

    -- 10. COINPAYMENTS_TRANSACTIONS - Column type changes
    ALTER TABLE coinpayments_transactions MODIFY transaction_id int unsigned AUTO_INCREMENT;
    ALTER TABLE coinpayments_transactions MODIFY user_id int unsigned;

    -- 11. CONVERSATIONS - Column type changes
    ALTER TABLE conversations MODIFY conversation_id int unsigned AUTO_INCREMENT;
    ALTER TABLE conversations MODIFY last_message_id int unsigned;
    ALTER TABLE conversations MODIFY node_id int unsigned;

    -- 12. CONVERSATIONS_CALLS_AUDIO - Column type and default changes
    ALTER TABLE conversations_calls_audio MODIFY call_id int unsigned AUTO_INCREMENT;
    ALTER TABLE conversations_calls_audio MODIFY from_user_id int unsigned;
    ALTER TABLE conversations_calls_audio MODIFY from_user_token mediumtext;
    ALTER TABLE conversations_calls_audio MODIFY to_user_id int unsigned;
    ALTER TABLE conversations_calls_audio MODIFY to_user_token mediumtext;
    ALTER TABLE conversations_calls_audio MODIFY created_time datetime DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE conversations_calls_audio MODIFY updated_time datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

    -- 13. CONVERSATIONS_CALLS_VIDEO - Column type and default changes
    ALTER TABLE conversations_calls_video MODIFY call_id int unsigned AUTO_INCREMENT;
    ALTER TABLE conversations_calls_video MODIFY from_user_id int unsigned;
    ALTER TABLE conversations_calls_video MODIFY to_user_id int unsigned;
    ALTER TABLE conversations_calls_video MODIFY updated_time datetime DEFAULT CURRENT_TIMESTAMP;

    -- 14. CONVERSATIONS_MESSAGES - Column type changes
    ALTER TABLE conversations_messages MODIFY message_id int unsigned AUTO_INCREMENT;
    ALTER TABLE conversations_messages MODIFY conversation_id int unsigned;
    ALTER TABLE conversations_messages MODIFY user_id int unsigned;
    ALTER TABLE conversations_messages MODIFY image varchar(255);
    ALTER TABLE conversations_messages MODIFY voice_note varchar(255);

    -- 15. CONVERSATIONS_USERS - Column type changes
    ALTER TABLE conversations_users MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE conversations_users MODIFY conversation_id int unsigned;
    ALTER TABLE conversations_users MODIFY user_id int unsigned;

    -- 16. CUSTOM_FIELDS - Column type changes
    ALTER TABLE custom_fields MODIFY field_id int unsigned AUTO_INCREMENT;
    ALTER TABLE custom_fields MODIFY length int;
    ALTER TABLE custom_fields MODIFY field_order int;

    -- 17. CUSTOM_FIELDS_VALUES - Column type changes
    ALTER TABLE custom_fields_values MODIFY value_id int unsigned AUTO_INCREMENT;
    ALTER TABLE custom_fields_values MODIFY field_id int unsigned;
    ALTER TABLE custom_fields_values MODIFY node_id int unsigned;

    -- 18. DEVELOPERS_APPS - Column type changes
    ALTER TABLE developers_apps MODIFY app_id int unsigned AUTO_INCREMENT;
    ALTER TABLE developers_apps MODIFY app_user_id int unsigned;
    ALTER TABLE developers_apps MODIFY app_category_id int unsigned;

    -- 19. DEVELOPERS_APPS_CATEGORIES - Column type changes
    ALTER TABLE developers_apps_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE developers_apps_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE developers_apps_categories MODIFY category_order int unsigned;

    -- 20. DEVELOPERS_APPS_USERS - Column type changes
    ALTER TABLE developers_apps_users MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE developers_apps_users MODIFY app_id int unsigned;
    ALTER TABLE developers_apps_users MODIFY user_id int unsigned;

    -- 21. EMOJIS - Column type changes
    ALTER TABLE emojis MODIFY emoji_id int unsigned AUTO_INCREMENT;

    -- 22. EVENTS - Column type and default changes
    ALTER TABLE events MODIFY event_id int unsigned AUTO_INCREMENT;
    ALTER TABLE events MODIFY event_admin int unsigned;
    ALTER TABLE events MODIFY event_page_id int unsigned;
    ALTER TABLE events MODIFY event_category int unsigned;
    ALTER TABLE events MODIFY event_cover_id int unsigned;
    ALTER TABLE events MODIFY event_album_covers int;
    ALTER TABLE events MODIFY event_album_timeline int;
    ALTER TABLE events MODIFY event_pinned_post int;

    -- 23. EVENTS_CATEGORIES - Column type changes
    ALTER TABLE events_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE events_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE events_categories MODIFY category_order int unsigned;

    -- 24. EVENTS_MEMBERS - Column type changes
    ALTER TABLE events_members MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE events_members MODIFY event_id int unsigned;
    ALTER TABLE events_members MODIFY user_id int unsigned;

    -- 25. FOLLOWINGS - Column type changes
    ALTER TABLE followings MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE followings MODIFY user_id int unsigned;
    ALTER TABLE followings MODIFY following_id int unsigned;

    -- 26. FORUMS - Column type changes
    ALTER TABLE forums MODIFY forum_id int unsigned AUTO_INCREMENT;
    ALTER TABLE forums MODIFY forum_section int unsigned;
    ALTER TABLE forums MODIFY forum_order int unsigned;
    ALTER TABLE forums MODIFY forum_threads int unsigned;
    ALTER TABLE forums MODIFY forum_replies int unsigned;

    -- 27. FORUMS_REPLIES - Column type changes
    ALTER TABLE forums_replies MODIFY reply_id int unsigned AUTO_INCREMENT;
    ALTER TABLE forums_replies MODIFY thread_id int unsigned;
    ALTER TABLE forums_replies MODIFY user_id int unsigned;

    -- 28. FORUMS_THREADS - Column type changes
    ALTER TABLE forums_threads MODIFY thread_id int unsigned AUTO_INCREMENT;
    ALTER TABLE forums_threads MODIFY forum_id int unsigned;
    ALTER TABLE forums_threads MODIFY user_id int unsigned;
    ALTER TABLE forums_threads MODIFY replies int unsigned;
    ALTER TABLE forums_threads MODIFY views int unsigned;

    -- 29. FRIENDS - Column type changes
    ALTER TABLE friends MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE friends MODIFY user_one_id int unsigned;
    ALTER TABLE friends MODIFY user_two_id int unsigned;

    -- 30. FUNDING_PAYMENTS - Column type changes
    ALTER TABLE funding_payments MODIFY payment_id int AUTO_INCREMENT;
    ALTER TABLE funding_payments MODIFY user_id int unsigned;

    -- 31. GAMES - Column type changes
    ALTER TABLE games MODIFY game_id int AUTO_INCREMENT;

    -- 32. GAMES_GENRES - Column type changes
    ALTER TABLE games_genres MODIFY genre_id int unsigned AUTO_INCREMENT;
    ALTER TABLE games_genres MODIFY genre_order int unsigned;

    -- 33. GAMES_PLAYERS - Column type changes
    ALTER TABLE games_players MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE games_players MODIFY game_id int unsigned;
    ALTER TABLE games_players MODIFY user_id int unsigned;

    -- 34. GIFTS - Column type changes
    ALTER TABLE gifts MODIFY gift_id int unsigned AUTO_INCREMENT;

    -- 35. GROUP_STORAGE_DATA - Column type and default changes
    ALTER TABLE group_storage_data MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE group_storage_data MODIFY group_id int unsigned;
    ALTER TABLE group_storage_data MODIFY created_at datetime DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE group_storage_data MODIFY updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

    -- 36. GROUPS - Column type changes
    ALTER TABLE groups MODIFY group_id int unsigned AUTO_INCREMENT;
    ALTER TABLE groups MODIFY group_admin int unsigned;
    ALTER TABLE groups MODIFY group_category int unsigned;
    ALTER TABLE groups MODIFY group_members int unsigned;
    ALTER TABLE groups MODIFY group_monetization_plans int unsigned;
    ALTER TABLE groups MODIFY chatbox_conversation_id int unsigned;

    -- 37. GROUPS_ADMINS - Column type changes
    ALTER TABLE groups_admins MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE groups_admins MODIFY group_id int unsigned;
    ALTER TABLE groups_admins MODIFY user_id int unsigned;

    -- 38. GROUPS_CATEGORIES - Column type changes
    ALTER TABLE groups_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE groups_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE groups_categories MODIFY category_order int unsigned;

    -- 39. GROUPS_MEMBERS - Column type changes
    ALTER TABLE groups_members MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE groups_members MODIFY group_id int unsigned;
    ALTER TABLE groups_members MODIFY user_id int unsigned;

    -- 40. HASHTAGS - Column type changes
    ALTER TABLE hashtags MODIFY hashtag_id int unsigned AUTO_INCREMENT;

    -- 41. HASHTAGS_POSTS - Column type changes
    ALTER TABLE hashtags_posts MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE hashtags_posts MODIFY post_id int unsigned;
    ALTER TABLE hashtags_posts MODIFY hashtag_id int unsigned;

    -- 42. INVITATION_CODES - Column type changes
    ALTER TABLE invitation_codes MODIFY code_id int unsigned AUTO_INCREMENT;
    ALTER TABLE invitation_codes MODIFY created_by int unsigned;
    ALTER TABLE invitation_codes MODIFY used_by int unsigned;

    -- 43. JOBS_CATEGORIES - Column type changes
    ALTER TABLE jobs_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE jobs_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE jobs_categories MODIFY category_order int unsigned;

    -- 44. LOG_COMMISSIONS - Column type changes
    ALTER TABLE log_commissions MODIFY payment_id int AUTO_INCREMENT;
    ALTER TABLE log_commissions MODIFY user_id int unsigned;

    -- 45. LOG_PAYMENTS - Column type changes
    ALTER TABLE log_payments MODIFY payment_id int AUTO_INCREMENT;
    ALTER TABLE log_payments MODIFY user_id int unsigned;

    -- 46. LOG_SESSIONS - Column type changes
    ALTER TABLE log_sessions MODIFY session_id int unsigned AUTO_INCREMENT;

    -- 47. MARKET_CATEGORIES - Column type changes
    ALTER TABLE market_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE market_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE market_categories MODIFY category_order int unsigned;

    -- 48. MARKET_PAYMENTS - Column type changes
    ALTER TABLE market_payments MODIFY payment_id int AUTO_INCREMENT;
    ALTER TABLE market_payments MODIFY user_id int unsigned;

    -- 49. MONETIZATION_PAYMENTS - Column type changes
    ALTER TABLE monetization_payments MODIFY payment_id int AUTO_INCREMENT;
    ALTER TABLE monetization_payments MODIFY user_id int unsigned;

    -- 50. MONETIZATION_PLANS - Column type changes
    ALTER TABLE monetization_plans MODIFY plan_id int AUTO_INCREMENT;
    ALTER TABLE monetization_plans MODIFY node_id int unsigned;
    ALTER TABLE monetization_plans MODIFY period_num int unsigned;
    ALTER TABLE monetization_plans MODIFY plan_order int unsigned;

    -- 51. MOVIES - Column type changes
    ALTER TABLE movies MODIFY movie_id int unsigned AUTO_INCREMENT;
    ALTER TABLE movies MODIFY views int unsigned;

    -- 52. MOVIES_GENRES - Column type changes
    ALTER TABLE movies_genres MODIFY genre_id int unsigned AUTO_INCREMENT;
    ALTER TABLE movies_genres MODIFY genre_order int unsigned;

    -- 53. MOVIES_PAYMENTS - Column type changes
    ALTER TABLE movies_payments MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE movies_payments MODIFY movie_id int unsigned;
    ALTER TABLE movies_payments MODIFY user_id int unsigned;

    -- 54. NOTIFICATIONS - Column type changes
    ALTER TABLE notifications MODIFY notification_id int unsigned AUTO_INCREMENT;
    ALTER TABLE notifications MODIFY to_user_id int unsigned;
    ALTER TABLE notifications MODIFY from_user_id int unsigned;

    -- 55. OFFERS_CATEGORIES - Column type changes
    ALTER TABLE offers_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE offers_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE offers_categories MODIFY category_order int unsigned;

    -- 56. ORDERS - Column type changes
    ALTER TABLE orders MODIFY order_id int unsigned AUTO_INCREMENT;
    ALTER TABLE orders MODIFY seller_id int unsigned;
    ALTER TABLE orders MODIFY buyer_id int unsigned;
    ALTER TABLE orders MODIFY buyer_address_id int unsigned;

    -- 57. ORDERS_ITEMS - Column type changes
    ALTER TABLE orders_items MODIFY id int AUTO_INCREMENT;
    ALTER TABLE orders_items MODIFY order_id int unsigned;
    ALTER TABLE orders_items MODIFY product_post_id int unsigned;
    ALTER TABLE orders_items MODIFY quantity int unsigned;

    -- 58. PACKAGES - Column type changes
    ALTER TABLE packages MODIFY package_id int AUTO_INCREMENT;
    ALTER TABLE packages MODIFY period_num int unsigned;
    ALTER TABLE packages MODIFY package_permissions_group_id int unsigned;

    -- 59. PACKAGES_PAYMENTS - Column type changes
    ALTER TABLE packages_payments MODIFY payment_id int AUTO_INCREMENT;
    ALTER TABLE packages_payments MODIFY user_id int unsigned;

    -- 60. PAGES - Column type changes
    ALTER TABLE pages MODIFY page_id int unsigned AUTO_INCREMENT;
    ALTER TABLE pages MODIFY page_admin int unsigned;
    ALTER TABLE pages MODIFY page_category int unsigned;
    ALTER TABLE pages MODIFY page_picture_id int unsigned;
    ALTER TABLE pages MODIFY page_cover_id int unsigned;
    ALTER TABLE pages MODIFY page_album_pictures int unsigned;
    ALTER TABLE pages MODIFY page_album_covers int unsigned;
    ALTER TABLE pages MODIFY page_album_timeline int unsigned;
    ALTER TABLE pages MODIFY page_pinned_post int unsigned;
    ALTER TABLE pages MODIFY page_boosted_by int unsigned;
    ALTER TABLE pages MODIFY page_country int unsigned;
    ALTER TABLE pages MODIFY page_monetization_plans int unsigned;

    -- 61. PAGES_ADMINS - Column type changes
    ALTER TABLE pages_admins MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE pages_admins MODIFY page_id int unsigned;
    ALTER TABLE pages_admins MODIFY user_id int unsigned;

    -- 62. PAGES_CATEGORIES - Column type changes
    ALTER TABLE pages_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE pages_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE pages_categories MODIFY category_order int unsigned;

    -- 63. PAGES_INVITES - Column type changes
    ALTER TABLE pages_invites MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE pages_invites MODIFY page_id int unsigned;
    ALTER TABLE pages_invites MODIFY user_id int unsigned;
    ALTER TABLE pages_invites MODIFY from_user_id int unsigned;

    -- 64. PAGES_LIKES - Column type changes
    ALTER TABLE pages_likes MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE pages_likes MODIFY page_id int unsigned;
    ALTER TABLE pages_likes MODIFY user_id int unsigned;

    -- 65. PERMISSIONS_GROUPS - Column type changes
    ALTER TABLE permissions_groups MODIFY permissions_group_id int unsigned AUTO_INCREMENT;

    -- 66. POINTS_PAYMENTS - Column type changes
    ALTER TABLE points_payments MODIFY payment_id int AUTO_INCREMENT;
    ALTER TABLE points_payments MODIFY user_id int unsigned;

    -- 67. POSTS - Column type changes
    ALTER TABLE posts MODIFY post_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts MODIFY user_id int unsigned;
    ALTER TABLE posts MODIFY group_id int unsigned;
    ALTER TABLE posts MODIFY event_id int unsigned;
    ALTER TABLE posts MODIFY wall_id int unsigned;
    ALTER TABLE posts MODIFY origin_id int unsigned;
    ALTER TABLE posts MODIFY boosted_by int unsigned;
    ALTER TABLE posts MODIFY reaction_like_count int unsigned;
    ALTER TABLE posts MODIFY reaction_love_count int unsigned;
    ALTER TABLE posts MODIFY reaction_haha_count int unsigned;
    ALTER TABLE posts MODIFY reaction_yay_count int unsigned;
    ALTER TABLE posts MODIFY reaction_wow_count int unsigned;
    ALTER TABLE posts MODIFY reaction_sad_count int unsigned;
    ALTER TABLE posts MODIFY reaction_angry_count int unsigned;
    ALTER TABLE posts MODIFY comments int unsigned;
    ALTER TABLE posts MODIFY shares int unsigned;
    ALTER TABLE posts MODIFY views int unsigned;

    -- 68. POSTS_ARTICLES - Column type changes
    ALTER TABLE posts_articles MODIFY article_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_articles MODIFY post_id int unsigned;
    ALTER TABLE posts_articles MODIFY category_id int unsigned;
    ALTER TABLE posts_articles MODIFY views int unsigned;

    -- 69. POSTS_AUDIOS - Column type changes
    ALTER TABLE posts_audios MODIFY audio_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_audios MODIFY post_id int unsigned;

    -- 70. POSTS_COLORED_PATTERNS - Column type changes
    ALTER TABLE posts_colored_patterns MODIFY pattern_id int unsigned AUTO_INCREMENT;

    -- 71. POSTS_COMMENTS - Column type changes
    ALTER TABLE posts_comments MODIFY comment_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_comments MODIFY node_id int unsigned;
    ALTER TABLE posts_comments MODIFY user_id int unsigned;
    ALTER TABLE posts_comments MODIFY reaction_like_count int unsigned;
    ALTER TABLE posts_comments MODIFY reaction_love_count int unsigned;
    ALTER TABLE posts_comments MODIFY reaction_haha_count int unsigned;
    ALTER TABLE posts_comments MODIFY reaction_yay_count int unsigned;
    ALTER TABLE posts_comments MODIFY reaction_wow_count int unsigned;
    ALTER TABLE posts_comments MODIFY reaction_sad_count int unsigned;
    ALTER TABLE posts_comments MODIFY reaction_angry_count int unsigned;
    ALTER TABLE posts_comments MODIFY replies int unsigned;

    -- 72. POSTS_COMMENTS_REACTIONS - Column type changes
    ALTER TABLE posts_comments_reactions MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_comments_reactions MODIFY comment_id int unsigned;
    ALTER TABLE posts_comments_reactions MODIFY user_id int unsigned;

    -- 73. POSTS_FILES - Column type changes
    ALTER TABLE posts_files MODIFY file_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_files MODIFY post_id int unsigned;

    -- 74. POSTS_FUNDING - Column type changes
    ALTER TABLE posts_funding MODIFY funding_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_funding MODIFY post_id int unsigned;

    -- 75. POSTS_FUNDING_DONORS - Column type changes
    ALTER TABLE posts_funding_donors MODIFY donation_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_funding_donors MODIFY user_id int unsigned;
    ALTER TABLE posts_funding_donors MODIFY post_id int unsigned;
    ALTER TABLE posts_funding_donors MODIFY donation_amount float unsigned;

    -- 76. POSTS_HIDDEN - Column type changes
    ALTER TABLE posts_hidden MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_hidden MODIFY post_id int unsigned;
    ALTER TABLE posts_hidden MODIFY user_id int unsigned;

    -- 77. POSTS_JOBS - Column type changes
    ALTER TABLE posts_jobs MODIFY job_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_jobs MODIFY post_id int unsigned;
    ALTER TABLE posts_jobs MODIFY category_id int unsigned;
    ALTER TABLE posts_jobs MODIFY salary_minimum float unsigned;
    ALTER TABLE posts_jobs MODIFY salary_maximum float unsigned;

    -- 78. POSTS_JOBS_APPLICATIONS - Column type changes
    ALTER TABLE posts_jobs_applications MODIFY application_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_jobs_applications MODIFY post_id int unsigned;
    ALTER TABLE posts_jobs_applications MODIFY user_id int unsigned;

    -- 79. POSTS_LINKS - Column type changes
    ALTER TABLE posts_links MODIFY link_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_links MODIFY post_id int unsigned;

    -- 80. POSTS_LIVE - Column type changes
    ALTER TABLE posts_live MODIFY live_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_live MODIFY post_id int unsigned;
    ALTER TABLE posts_live MODIFY agora_uid int;

    -- 81. POSTS_LIVE_USERS - Column type changes
    ALTER TABLE posts_live_users MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_live_users MODIFY user_id int unsigned;
    ALTER TABLE posts_live_users MODIFY post_id int unsigned;

    -- 82. POSTS_MEDIA - Column type changes
    ALTER TABLE posts_media MODIFY media_id int unsigned AUTO_INCREMENT;

    -- 83. POSTS_OFFERS - Column type changes
    ALTER TABLE posts_offers MODIFY offer_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_offers MODIFY post_id int unsigned;
    ALTER TABLE posts_offers MODIFY category_id int unsigned;
    ALTER TABLE posts_offers MODIFY discount_percent int;
    ALTER TABLE posts_offers MODIFY buy_x int;
    ALTER TABLE posts_offers MODIFY get_y int;
    ALTER TABLE posts_offers MODIFY price float unsigned;

    -- 84. POSTS_PAID - Column type changes
    ALTER TABLE posts_paid MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_paid MODIFY post_id int unsigned;
    ALTER TABLE posts_paid MODIFY user_id int unsigned;

    -- 85. POSTS_PHOTOS - Column type changes
    ALTER TABLE posts_photos MODIFY photo_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_photos MODIFY post_id int unsigned;
    ALTER TABLE posts_photos MODIFY album_id int unsigned;
    ALTER TABLE posts_photos MODIFY reaction_like_count int unsigned;
    ALTER TABLE posts_photos MODIFY reaction_love_count int unsigned;
    ALTER TABLE posts_photos MODIFY reaction_haha_count int unsigned;
    ALTER TABLE posts_photos MODIFY reaction_yay_count int unsigned;
    ALTER TABLE posts_photos MODIFY reaction_wow_count int unsigned;
    ALTER TABLE posts_photos MODIFY reaction_sad_count int unsigned;
    ALTER TABLE posts_photos MODIFY reaction_angry_count int unsigned;
    ALTER TABLE posts_photos MODIFY comments int unsigned;

    -- 86. POSTS_PHOTOS_ALBUMS - Column type changes
    ALTER TABLE posts_photos_albums MODIFY album_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_photos_albums MODIFY user_id int unsigned;

    -- 87. POSTS_PHOTOS_REACTIONS - Column type changes
    ALTER TABLE posts_photos_reactions MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_photos_reactions MODIFY photo_id int unsigned;
    ALTER TABLE posts_photos_reactions MODIFY user_id int unsigned;

    -- 88. POSTS_POLLS - Column type changes
    ALTER TABLE posts_polls MODIFY poll_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_polls MODIFY post_id int unsigned;
    ALTER TABLE posts_polls MODIFY votes int unsigned;

    -- 89. POSTS_POLLS_OPTIONS - Column type changes
    ALTER TABLE posts_polls_options MODIFY option_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_polls_options MODIFY poll_id int unsigned;

    -- 90. POSTS_POLLS_OPTIONS_USERS - Column type changes
    ALTER TABLE posts_polls_options_users MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_polls_options_users MODIFY user_id int unsigned;
    ALTER TABLE posts_polls_options_users MODIFY poll_id int unsigned;
    ALTER TABLE posts_polls_options_users MODIFY option_id int unsigned;

    -- 91. POSTS_PRODUCTS - Column type changes
    ALTER TABLE posts_products MODIFY product_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_products MODIFY post_id int unsigned;
    ALTER TABLE posts_products MODIFY category_id int unsigned;
    ALTER TABLE posts_products MODIFY price float unsigned;
    ALTER TABLE posts_products MODIFY quantity int unsigned;

    -- 92. POSTS_REACTIONS - Column type changes
    ALTER TABLE posts_reactions MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_reactions MODIFY post_id int unsigned;
    ALTER TABLE posts_reactions MODIFY user_id int unsigned;

    -- 93. POSTS_SAVED - Column type changes
    ALTER TABLE posts_saved MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_saved MODIFY post_id int unsigned;
    ALTER TABLE posts_saved MODIFY user_id int unsigned;

    -- 94. POSTS_VIDEOS - Column type changes
    ALTER TABLE posts_videos MODIFY video_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_videos MODIFY post_id int unsigned;
    ALTER TABLE posts_videos MODIFY category_id int unsigned;

    -- 95. POSTS_VIDEOS_CATEGORIES - Column type changes
    ALTER TABLE posts_videos_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_videos_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE posts_videos_categories MODIFY category_order int unsigned;

    -- 96. POSTS_VIEWS - Column type changes
    ALTER TABLE posts_views MODIFY view_id int unsigned AUTO_INCREMENT;
    ALTER TABLE posts_views MODIFY post_id int unsigned;
    ALTER TABLE posts_views MODIFY user_id int unsigned;

    -- 97. REPORTS - Column type changes
    ALTER TABLE reports MODIFY report_id int unsigned AUTO_INCREMENT;
    ALTER TABLE reports MODIFY user_id int unsigned;
    ALTER TABLE reports MODIFY node_id int unsigned;
    ALTER TABLE reports MODIFY category_id int unsigned;

    -- 98. REPORTS_CATEGORIES - Column type changes
    ALTER TABLE reports_categories MODIFY category_id int unsigned AUTO_INCREMENT;
    ALTER TABLE reports_categories MODIFY category_parent_id int unsigned;
    ALTER TABLE reports_categories MODIFY category_order int unsigned;

    -- 99. REVIEWS - Column type changes
    ALTER TABLE reviews MODIFY review_id int unsigned AUTO_INCREMENT;
    ALTER TABLE reviews MODIFY node_id int unsigned;
    ALTER TABLE reviews MODIFY user_id int unsigned;
    ALTER TABLE reviews MODIFY rate smallint;

    -- 100. REVIEWS_PHOTOS - Column type changes
    ALTER TABLE reviews_photos MODIFY photo_id int unsigned AUTO_INCREMENT;
    ALTER TABLE reviews_photos MODIFY review_id int unsigned;

    -- 101. SHOPPING_CART - Column type changes
    ALTER TABLE shopping_cart MODIFY id int AUTO_INCREMENT;
    ALTER TABLE shopping_cart MODIFY user_id int unsigned;
    ALTER TABLE shopping_cart MODIFY product_post_id int unsigned;
    ALTER TABLE shopping_cart MODIFY quantity int unsigned;

    -- 102. SNEAK_PEAKS - Column type changes
    ALTER TABLE sneak_peaks MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE sneak_peaks MODIFY user_id int unsigned;
    ALTER TABLE sneak_peaks MODIFY node_id int unsigned;

    -- 103. STATIC_PAGES - Column type changes
    ALTER TABLE static_pages MODIFY page_id int unsigned AUTO_INCREMENT;
    ALTER TABLE static_pages MODIFY page_order int unsigned;

    -- 104. STICKERS - Column type changes
    ALTER TABLE stickers MODIFY sticker_id int unsigned AUTO_INCREMENT;

    -- 105. STORIES - Column type changes
    ALTER TABLE stories MODIFY story_id int unsigned AUTO_INCREMENT;
    ALTER TABLE stories MODIFY user_id int unsigned;
    ALTER TABLE stories MODIFY media_count int;

    -- 106. STORIES_MEDIA - Column type changes
    ALTER TABLE stories_media MODIFY media_id int unsigned AUTO_INCREMENT;
    ALTER TABLE stories_media MODIFY story_id int unsigned;

    -- 107. STORY_REACTIONS - Column type changes
    ALTER TABLE story_reactions MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE story_reactions MODIFY story_id int unsigned;
    ALTER TABLE story_reactions MODIFY user_id int unsigned;

    -- 108. STORY_VIEWS - Column type changes
    ALTER TABLE story_views MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE story_views MODIFY story_id int unsigned;
    ALTER TABLE story_views MODIFY user_id int unsigned;

    -- 109. SUBSCRIBERS - Column type changes
    ALTER TABLE subscribers MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE subscribers MODIFY user_id int unsigned;
    ALTER TABLE subscribers MODIFY node_id int unsigned;
    ALTER TABLE subscribers MODIFY plan_id int unsigned;

    -- 110. SYSTEM_COUNTRIES - Column type changes
    ALTER TABLE system_countries MODIFY country_id int unsigned AUTO_INCREMENT;
    ALTER TABLE system_countries MODIFY country_vat int unsigned;
    ALTER TABLE system_countries MODIFY country_order int unsigned;

    -- 111. SYSTEM_CURRENCIES - Column type changes
    ALTER TABLE system_currencies MODIFY currency_id int unsigned AUTO_INCREMENT;

    -- 112. SYSTEM_GENDERS - Column type changes
    ALTER TABLE system_genders MODIFY gender_id int unsigned AUTO_INCREMENT;

    -- 113. SYSTEM_LANGUAGES - Column type changes
    ALTER TABLE system_languages MODIFY language_id int unsigned AUTO_INCREMENT;
    ALTER TABLE system_languages MODIFY language_order int unsigned;

    -- 114. SYSTEM_OPTIONS - Column type changes
    ALTER TABLE system_options MODIFY option_id int unsigned AUTO_INCREMENT;

    -- 115. SYSTEM_REACTIONS - Column type changes
    ALTER TABLE system_reactions MODIFY reaction_id int unsigned AUTO_INCREMENT;
    ALTER TABLE system_reactions MODIFY reaction_order int unsigned;

    -- 116. SYSTEM_THEMES - Column type changes
    ALTER TABLE system_themes MODIFY theme_id int unsigned AUTO_INCREMENT;

    -- 117. USERS - Column type changes
    ALTER TABLE users MODIFY user_id int unsigned AUTO_INCREMENT;
    ALTER TABLE users MODIFY user_master_account int;
    ALTER TABLE users MODIFY user_group tinyint unsigned;
    ALTER TABLE users MODIFY user_picture varchar(255);
    ALTER TABLE users MODIFY user_picture_id int unsigned;
    ALTER TABLE users MODIFY user_cover_id int unsigned;
    ALTER TABLE users MODIFY user_album_pictures int unsigned;
    ALTER TABLE users MODIFY user_album_covers int unsigned;
    ALTER TABLE users MODIFY user_album_timeline int unsigned;
    ALTER TABLE users MODIFY user_pinned_post int unsigned;
    ALTER TABLE users MODIFY user_country int unsigned;
    ALTER TABLE users MODIFY user_boosted_posts int unsigned;
    ALTER TABLE users MODIFY user_boosted_pages int unsigned;
    ALTER TABLE users MODIFY user_live_requests_counter int unsigned;
    ALTER TABLE users MODIFY user_live_requests_lastid int unsigned;
    ALTER TABLE users MODIFY user_live_messages_counter int unsigned;
    ALTER TABLE users MODIFY user_live_messages_lastid int unsigned;
    ALTER TABLE users MODIFY user_live_notifications_counter int unsigned;
    ALTER TABLE users MODIFY user_live_notifications_lastid int unsigned;
    ALTER TABLE users MODIFY user_failed_login_count int unsigned;
    ALTER TABLE users MODIFY user_monetization_plans int unsigned;

    -- 118. USERS_ACCOUNTS - Column type changes
    ALTER TABLE users_accounts MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_accounts MODIFY user_id int unsigned;
    ALTER TABLE users_accounts MODIFY account_id int unsigned;

    -- 119. USERS_ADDRESSES - Column type changes
    ALTER TABLE users_addresses MODIFY address_id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_addresses MODIFY user_id int unsigned;

    -- 120. USERS_AFFILIATES - Column type changes
    ALTER TABLE users_affiliates MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_affiliates MODIFY referrer_id int unsigned;
    ALTER TABLE users_affiliates MODIFY referee_id int unsigned;

    -- 121. USERS_BLOCKS - Column type changes
    ALTER TABLE users_blocks MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_blocks MODIFY user_id int unsigned;
    ALTER TABLE users_blocks MODIFY blocked_id int unsigned;

    -- 122. USERS_GIFTS - Column type changes
    ALTER TABLE users_gifts MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_gifts MODIFY from_user_id int unsigned;
    ALTER TABLE users_gifts MODIFY to_user_id int unsigned;
    ALTER TABLE users_gifts MODIFY gift_id int unsigned;

    -- 123. USERS_GROUPS - Column type changes
    ALTER TABLE users_groups MODIFY user_group_id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_groups MODIFY permissions_group_id int unsigned;

    -- 124. USERS_INVITATIONS - Column type changes
    ALTER TABLE users_invitations MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_invitations MODIFY user_id int unsigned;

    -- 125. USERS_POKES - Column type changes
    ALTER TABLE users_pokes MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_pokes MODIFY user_id int unsigned;
    ALTER TABLE users_pokes MODIFY poked_id int unsigned;

    -- 126. USERS_RECURRING_PAYMENTS - Column type changes
    ALTER TABLE users_recurring_payments MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_recurring_payments MODIFY user_id int unsigned;
    ALTER TABLE users_recurring_payments MODIFY handle_id int unsigned;

    -- 127. USERS_SEARCHES - Column type changes
    ALTER TABLE users_searches MODIFY log_id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_searches MODIFY user_id int unsigned;
    ALTER TABLE users_searches MODIFY node_id int unsigned;

    -- 128. USERS_SESSIONS - Column type changes
    ALTER TABLE users_sessions MODIFY session_id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_sessions MODIFY user_id int unsigned;

    -- 129. USERS_SMS - Column type changes
    ALTER TABLE users_sms MODIFY id int unsigned AUTO_INCREMENT;

    -- 130. USERS_TOP_FRIENDS - Column type changes
    ALTER TABLE users_top_friends MODIFY id int unsigned AUTO_INCREMENT;
    ALTER TABLE users_top_friends MODIFY user_id int unsigned;
    ALTER TABLE users_top_friends MODIFY friend_id int unsigned;

    -- 131. VERIFICATION_REQUESTS - Column type changes
    ALTER TABLE verification_requests MODIFY request_id int unsigned AUTO_INCREMENT;
    ALTER TABLE verification_requests MODIFY node_id int unsigned;

    -- 132. WALLET_PAYMENTS - Column type changes
    ALTER TABLE wallet_payments MODIFY payment_id int AUTO_INCREMENT;
    ALTER TABLE wallet_payments MODIFY user_id int unsigned;

    -- 133. WALLET_TRANSACTIONS - Column type changes
    ALTER TABLE wallet_transactions MODIFY transaction_id int AUTO_INCREMENT;
    ALTER TABLE wallet_transactions MODIFY user_id int unsigned;
    ALTER TABLE wallet_transactions MODIFY node_id int unsigned;

    -- 134. WIDGETS - Column type changes
    ALTER TABLE widgets MODIFY widget_id int unsigned AUTO_INCREMENT;
    ALTER TABLE widgets MODIFY place_order int unsigned;

    -- ============================================================================
    -- END OF MIGRATION SCRIPT
    -- ============================================================================
    -- MIGRATION SUMMARY:
    --
    -- ✓ NEW TABLES CREATED: 3
    --   1. group_storage_data - Stores cloud storage configuration for group media
    --   2. story_reactions - Tracks user reactions (like, love, haha, wow, sad, angry) on stories
    --   3. story_views - Tracks story view history with timestamps
    --
    -- ✓ EXISTING TABLES MODIFIED: 131
    --   - All column type conversions: int(10) → int, int(10) unsigned → int unsigned
    --   - Default value updates for datetime/timestamp columns
    --   - Proper DEFAULT CURRENT_TIMESTAMP and ON UPDATE CURRENT_TIMESTAMP clauses
    --   - Nullable field standardization
    --
    -- ✓ TABLES TO DROP: None (all old tables retained)
    --
    -- TOTAL TABLES IN NEW SCHEMA: 134
    -- ============================================================================
    -- 
    -- EXECUTION INSTRUCTIONS:
    -- 1. Backup your database before running this script
    -- 2. Run in MySQL client: mysql -u username -p database_name < MIGRATION_OLD_TO_NEW.sql
    -- 3. Or paste directly into your MySQL GUI and execute
    -- 4. Verify all changes completed successfully
    --
    -- ============================================================================
