const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../config/db");

const DEFAULT_COUNTS = {
  users: Number(process.env.SEED_USERS || 50),
  pages: Number(process.env.SEED_PAGES || 5),
  groups: Number(process.env.SEED_GROUPS || 5),
  events: Number(process.env.SEED_EVENTS || 5),
  conversations: Number(process.env.SEED_CONVERSATIONS || 10),
  messagesPerConversation: Number(process.env.SEED_MESSAGES_PER_CONVERSATION || 5),
  posts: Number(process.env.SEED_POSTS || 100),
};

const RESET = process.argv.includes("--reset") || process.env.SEED_RESET === "1";
const RUN_TAG = Date.now().toString(36);
const PASSWORD_HASH = bcrypt.hashSync("Password123!", 10);

const FIRST_NAMES = [
  "Amani",
  "Zuri",
  "Kofi",
  "Nia",
  "Omar",
  "Tia",
  "Imani",
  "Biko",
  "Lina",
  "Musa",
  "Asha",
  "Juma",
  "Ruth",
  "Dayo",
  "Zola",
  "Sana",
];

const LAST_NAMES = [
  "Mwamba",
  "Adebayo",
  "Otieno",
  "Ndlovu",
  "Diallo",
  "Kamau",
  "Mensah",
  "Hassan",
  "Kone",
  "Moyo",
  "Okafor",
  "Sow",
  "Khalil",
  "Bello",
  "Kariuki",
  "Toure",
];

const CITIES = [
  "Nairobi",
  "Lagos",
  "Accra",
  "Kampala",
  "Dar es Salaam",
  "Johannesburg",
  "Cairo",
  "Dakar",
  "Abuja",
  "Kigali",
];

const POST_TEXTS = [
  "Working on something new today.",
  "Community update coming in a few minutes.",
  "Sharing a quick thought from the field.",
  "Today felt like progress.",
  "Fresh content, fresh energy.",
  "Building in public one post at a time.",
  "A little inspiration for the timeline.",
];

const LINK_TITLES = [
  "A useful guide",
  "Project update",
  "New resource",
  "Event details",
  "Announcement",
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(items) {
  return items[randomInt(0, items.length - 1)];
}

function sample(items, count) {
  const copy = [...items];
  const picked = [];
  while (copy.length && picked.length < count) {
    const index = randomInt(0, copy.length - 1);
    picked.push(copy.splice(index, 1)[0]);
  }
  return picked;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function now() {
  return new Date();
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function hoursAgo(hours) {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date;
}

function minutesAgo(minutes) {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutes);
  return date;
}

function futureDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function randomUrl(kind, seed) {
  return `https://picsum.photos/seed/${encodeURIComponent(
    `${kind}-${seed}`,
  )}/1200/800`;
}

function randomAvatar(seed) {
  return `https://i.pravatar.cc/300?u=${encodeURIComponent(seed)}`;
}

function randomPhone() {
  return `+2547${randomInt(10000000, 99999999)}`;
}

async function getColumns(connection, tableName) {
  const [rows] = await connection.query(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName],
  );

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function getSchema(connection, tableNames) {
  const schema = {};
  for (const tableName of tableNames) {
    schema[tableName] = await getColumns(connection, tableName);
  }
  return schema;
}

async function insertRow(connection, schema, tableName, data) {
  const columns = schema[tableName];
  if (!columns || columns.size === 0) {
    throw new Error(`Table not found or has no columns: ${tableName}`);
  }

  const entries = Object.entries(data).filter(
    ([key, value]) => columns.has(key) && value !== undefined,
  );

  if (entries.length === 0) {
    throw new Error(`No matching columns to insert into ${tableName}`);
  }

  const sql = `INSERT INTO \`${tableName}\` (${entries
    .map(([key]) => `\`${key}\``)
    .join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`;
  const values = entries.map(([, value]) => value);
  const [result] = await connection.query(sql, values);
  return result.insertId;
}

async function truncateTables(connection, schema, tableNames) {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const tableName of tableNames) {
    if (schema[tableName] && schema[tableName].size > 0) {
      await connection.query(`TRUNCATE TABLE \`${tableName}\``);
    }
  }
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
}

async function seedCategories(connection, schema, tableName, labels) {
  if (!schema[tableName] || schema[tableName].size === 0) {
    return [];
  }

  const ids = [];
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const id = await insertRow(connection, schema, tableName, {
      category_parent_id: 0,
      category_name: `${label} ${RUN_TAG}`,
      category_description: `${label} category for seeded demo content`,
      category_order: index + 1,
    });
    ids.push(id);
  }
  return ids;
}

async function seedUsers(connection, schema, count, countryIds) {
  const userIds = [];
  for (let index = 0; index < count; index += 1) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const handle = `${slugify(firstName)}${slugify(lastName)}${RUN_TAG}${index + 1}`;
    const city = pick(CITIES);
    const countryId = countryIds.length ? pick(countryIds) : null;
    const userId = await insertRow(connection, schema, "users", {
      user_master_account: 0,
      user_group: 3,
      user_group_custom: 0,
      user_demo: "0",
      user_name: handle,
      user_email: `${handle}@example.test`,
      user_email_verified: "1",
      user_email_verification_code: null,
      user_phone: randomPhone(),
      user_phone_verified: "0",
      user_phone_verification_code: null,
      user_password: PASSWORD_HASH,
      user_two_factor_enabled: "0",
      user_two_factor_type: null,
      user_two_factor_key: null,
      user_two_factor_gsecret: null,
      user_activated: "1",
      user_approved: "1",
      user_reseted: "0",
      user_reset_key: null,
      user_subscribed: "0",
      user_package: null,
      user_subscription_date: null,
      user_boosted_posts: 0,
      user_boosted_pages: 0,
      user_boosted_groups: 0,
      user_boosted_events: 0,
      user_started: "1",
      user_verified: randomInt(0, 1) ? "1" : "0",
      user_banned: "0",
      user_latitude: "0",
      user_longitude: "0",
      user_firstname: firstName,
      user_lastname: lastName,
      user_gender: randomInt(1, 3),
      user_picture: randomAvatar(handle),
      user_cover: randomUrl("cover", handle),
      user_cover_position: "0px 0px",
      user_registered: daysAgo(randomInt(1, 730)),
      user_country: countryId,
      user_birthdate: daysAgo(randomInt(7_000, 12_000)),
      user_relationship: pick(["single", "married", "complicated"]),
      user_biography: `Seeded profile for ${firstName} ${lastName}.`,
      user_website: `https://example.test/${handle}`,
      user_work_title: pick(["Creator", "Builder", "Founder", "Designer", "Developer"]),
      user_work_place: pick(["Pipi Africa", "Open Studio", "Digital House", "Community Lab"]),
      user_work_url: `https://example.test/work/${handle}`,
      user_current_city: city,
      user_hometown: pick(CITIES),
      user_edu_major: pick(["Business", "Computer Science", "Design", "Media", "Economics"]),
      user_edu_school: pick(["Nairobi University", "Makerere University", "University of Ghana", "Cairo University"]),
      user_social_facebook: `https://facebook.com/${handle}`,
      user_social_twitter: `https://x.com/${handle}`,
      user_social_instagram: `https://instagram.com/${handle}`,
      user_social_linkedin: `https://linkedin.com/in/${handle}`,
      user_profile_background: randomUrl("profile-background", handle),
      user_chat_enabled: "1",
      user_newsletter_enabled: "1",
      user_tips_enabled: "1",
      user_online_status: pick(["online", "offline", "away"]),
      user_last_active: minutesAgo(randomInt(1, 3000)),
      user_referrer_id: userIds.length ? pick(userIds) : null,
      user_referral_code: crypto.randomBytes(4).toString("hex").toUpperCase(),
      fcm_token: `fcm_${handle}`,
      points_earned: "0",
      user_points: randomInt(0, 500),
      user_wallet_balance: randomInt(0, 250),
      user_affiliate_balance: randomInt(0, 100),
      user_market_balance: randomInt(0, 100),
      user_funding_balance: randomInt(0, 100),
      user_monetization_enabled: randomInt(0, 1) ? "1" : "0",
      user_monetization_chat_price: randomInt(0, 20),
      user_monetization_call_price: randomInt(0, 30),
      user_monetization_min_price: randomInt(0, 10),
      user_monetization_plans: 0,
      user_monetization_balance: randomInt(0, 75),
      chat_sound: "1",
      notifications_sound: "1",
      user_language: "en_us",
      user_free_tried: "0",
      is_fake: "0",
    });

    userIds.push(userId);
  }
  return userIds;
}

async function seedPages(connection, schema, count, adminUserIds, countryIds, pageCategoryIds) {
  const pageIds = [];
  for (let index = 0; index < count; index += 1) {
    const title = `Page ${index + 1} ${RUN_TAG}`;
    const pageName = `${slugify(title)}-${index + 1}`;
    const pageId = await insertRow(connection, schema, "pages", {
      page_admin: pick(adminUserIds),
      page_category: pageCategoryIds.length ? pick(pageCategoryIds) : 1,
      page_name: pageName,
      page_title: title,
      page_picture: randomAvatar(pageName),
      page_cover: randomUrl("page-cover", pageName),
      page_country: countryIds.length ? pick(countryIds) : 1,
      page_description: `Seeded page ${title}.`,
      page_action_text: "Follow",
      page_action_color: "blue",
      page_action_url: `https://example.test/pages/${pageName}`,
      page_company: `${title} Company`,
      page_phone: randomPhone(),
      page_website: `https://example.test/pages/${pageName}`,
      page_location: pick(CITIES),
      page_verified: randomInt(0, 1) ? "1" : "0",
      page_tips_enabled: "1",
      page_boosted: "0",
      page_date: daysAgo(randomInt(1, 365)),
      page_monetization_enabled: "0",
    });
    pageIds.push(pageId);

    await insertRow(connection, schema, "pages_admins", {
      page_id: pageId,
      user_id: pick(adminUserIds),
    });

    const likeCount = randomInt(3, Math.min(10, adminUserIds.length));
    for (const userId of sample(adminUserIds, likeCount)) {
      await insertRow(connection, schema, "pages_likes", {
        page_id: pageId,
        user_id: userId,
      });
    }
  }
  return pageIds;
}

async function seedGroups(connection, schema, count, adminUserIds, groupCategoryIds) {
  const groupIds = [];
  for (let index = 0; index < count; index += 1) {
    const title = `Group ${index + 1} ${RUN_TAG}`;
    const groupName = `${slugify(title)}-${index + 1}`;
    const groupId = await insertRow(connection, schema, "groups", {
      group_privacy: pick(["public", "closed", "secret"]),
      group_admin: pick(adminUserIds),
      group_category: groupCategoryIds.length ? pick(groupCategoryIds) : 1,
      group_name: groupName,
      group_title: title,
      group_description: `Seeded group ${title}.`,
      group_publish_enabled: "1",
      group_publish_approval_enabled: "0",
      group_picture: randomAvatar(groupName),
      group_cover: randomUrl("group-cover", groupName),
      group_cover_position: "0px 0px",
      group_members: randomInt(5, 30),
      group_monetization_enabled: randomInt(0, 1) ? "1" : "0",
      group_monetization_min_price: randomInt(0, 20),
      group_rate: randomInt(0, 5),
      group_date: daysAgo(randomInt(1, 365)),
    });
    groupIds.push(groupId);

    await insertRow(connection, schema, "groups_admins", {
      group_id: groupId,
      user_id: pick(adminUserIds),
    });

    const memberIds = sample(adminUserIds, randomInt(6, Math.min(15, adminUserIds.length)));
    for (const userId of memberIds) {
      await insertRow(connection, schema, "groups_members", {
        group_id: groupId,
        user_id: userId,
        approved: "1",
      });
    }
  }
  return groupIds;
}

async function seedEvents(connection, schema, count, adminUserIds, pageIds, eventCategoryIds) {
  const eventIds = [];
  for (let index = 0; index < count; index += 1) {
    const title = `Event ${index + 1} ${RUN_TAG}`;
    const eventId = await insertRow(connection, schema, "events", {
      event_privacy: pick(["public", "closed", "secret"]),
      event_admin: pick(adminUserIds),
      event_page_id: pageIds.length && randomInt(0, 1) ? pick(pageIds) : null,
      event_category: eventCategoryIds.length ? pick(eventCategoryIds) : 1,
      event_title: title,
      event_location: pick(CITIES),
      event_description: `Seeded event ${title}.`,
      event_start_date: futureDays(randomInt(1, 30)),
      event_end_date: futureDays(randomInt(31, 60)),
      event_publish_enabled: "1",
      event_publish_approval_enabled: "0",
      event_cover: randomUrl("event-cover", title),
      event_cover_position: "0px 0px",
      chatbox_enabled: "1",
      event_tickets_link: `https://example.test/events/${slugify(title)}`,
      event_prices: JSON.stringify([10, 25, 50]),
      event_rate: randomInt(0, 5),
      event_date: daysAgo(randomInt(1, 365)),
    });
    eventIds.push(eventId);

    const attendeeIds = sample(adminUserIds, randomInt(6, Math.min(15, adminUserIds.length)));
    for (const userId of attendeeIds) {
      await insertRow(connection, schema, "events_members", {
        event_id: eventId,
        user_id: userId,
        is_invited: randomInt(0, 1) ? "1" : "0",
        is_interested: randomInt(0, 1) ? "1" : "0",
        is_going: randomInt(0, 1) ? "1" : "0",
      });
    }
  }
  return eventIds;
}

async function seedConnections(connection, schema, userIds) {
  const friendPairs = new Set();
  const followPairs = new Set();

  for (const userId of userIds) {
    const follows = sample(userIds.filter((id) => id !== userId), randomInt(2, 6));
    for (const followingId of follows) {
      const key = `${userId}:${followingId}`;
      if (followPairs.has(key)) continue;
      followPairs.add(key);
      await insertRow(connection, schema, "followings", {
        user_id: userId,
        following_id: followingId,
        points_earned: "0",
        time: daysAgo(randomInt(1, 90)),
      });
    }
  }

  const attempts = userIds.length * 2;
  for (let index = 0; index < attempts; index += 1) {
    const pair = sample(userIds, 2);
    if (pair.length < 2) continue;
    const [userOneId, userTwoId] = pair[0] < pair[1] ? pair : [pair[1], pair[0]];
    const key = `${userOneId}:${userTwoId}`;
    if (friendPairs.has(key)) continue;
    friendPairs.add(key);
    await insertRow(connection, schema, "friends", {
      user_one_id: userOneId,
      user_two_id: userTwoId,
      status: 1,
    });
  }
}

async function seedConversations(connection, schema, userIds, count, messagesPerConversation) {
  if (!schema.conversations || schema.conversations.size === 0 || !schema.conversations_users || schema.conversations_users.size === 0 || !schema.conversations_messages || schema.conversations_messages.size === 0) {
    return [];
  }

  const conversationIds = [];
  const usedPairs = new Set();

  for (let index = 0; index < count; index += 1) {
    const pair = sample(userIds, 2);
    if (pair.length < 2) continue;
    const [userOneId, userTwoId] = pair[0] < pair[1] ? pair : [pair[1], pair[0]];
    const pairKey = `${userOneId}:${userTwoId}`;
    if (usedPairs.has(pairKey)) {
      index -= 1;
      continue;
    }
    usedPairs.add(pairKey);

    const conversationId = await insertRow(connection, schema, "conversations", {
      last_message_id: 0,
      color: `#${crypto.randomBytes(3).toString("hex")}`,
      node_id: null,
      node_type: null,
    });
    conversationIds.push(conversationId);

    for (const userId of [userOneId, userTwoId]) {
      await insertRow(connection, schema, "conversations_users", {
        conversation_id: conversationId,
        user_id: userId,
        seen: "1",
        typing: "0",
        deleted: "0",
        last_seen_time: minutesAgo(randomInt(1, 500)),
      });
    }

    let lastMessageId = null;
    for (let messageIndex = 0; messageIndex < messagesPerConversation; messageIndex += 1) {
      const senderId = messageIndex % 2 === 0 ? userOneId : userTwoId;
      lastMessageId = await insertRow(connection, schema, "conversations_messages", {
        conversation_id: conversationId,
        user_id: senderId,
        message: pick([
          "Hey, did you see this?",
          "This looks good.",
          "Let’s move forward.",
          "I left a note for you.",
          "Sounds like a plan.",
        ]),
        image: randomInt(0, 4) === 0 ? randomUrl("message-image", `${conversationId}-${messageIndex}`) : null,
        voice_note: randomInt(0, 8) === 0 ? randomUrl("voice-note", `${conversationId}-${messageIndex}`) : null,
        time: minutesAgo(randomInt(1, 200)),
      });
    }

    if (lastMessageId) {
      await connection.query(
        "UPDATE conversations SET last_message_id = ? WHERE conversation_id = ?",
        [lastMessageId, conversationId],
      );
    }
  }

  return conversationIds;
}

async function seedPosts(
  connection,
  schema,
  userIds,
  pageIds,
  groupIds,
  eventIds,
  categoryIdsByType,
  count,
) {
  const postIds = [];
  const postTypes = [
    "normal",
    "photo",
    "video",
    "article",
    "link",
    "product",
    "job",
    "poll",
    "live",
    "funding",
    "offer",
  ];

  for (let index = 0; index < count; index += 1) {
    const postType = postTypes[index % postTypes.length];
    const usePage = pageIds.length > 0 && randomInt(0, 4) === 0;
    const authorId = usePage ? pick(pageIds) : pick(userIds);
    const userType = usePage ? "page" : "user";
    const isGroupPost = groupIds.length > 0 && randomInt(0, 3) === 0;
    const isEventPost = !isGroupPost && eventIds.length > 0 && randomInt(0, 5) === 0;
    const groupId = isGroupPost ? pick(groupIds) : null;
    const eventId = isEventPost ? pick(eventIds) : null;
    const caption = `${pick(POST_TEXTS)} ${index + 1} ${RUN_TAG}`;
    const postId = await insertRow(connection, schema, "posts", {
      user_id: authorId,
      user_type: userType,
      in_group: isGroupPost ? "1" : "0",
      group_id: groupId,
      group_approved: isGroupPost ? "1" : "1",
      in_event: isEventPost ? "1" : "0",
      event_id: eventId,
      event_approved: isEventPost ? "1" : "1",
      in_wall: "0",
      wall_id: null,
      post_type: postType,
      colored_pattern: null,
      origin_id: null,
      time: hoursAgo(randomInt(1, 720)),
      location: pick(CITIES),
      privacy: pick(["public", "friends"]),
      text: caption,
      feeling_action: randomInt(0, 1) ? pick(["feeling", "thinking", "watching", "listening"]) : null,
      feeling_value: randomInt(0, 1) ? pick(["great", "focused", "ready", "grateful"]) : null,
      boosted: randomInt(0, 5) === 0 ? "1" : "0",
      boosted_by: null,
      comments_disabled: "0",
      is_hidden: "0",
      for_adult: "0",
      is_anonymous: randomInt(0, 8) === 0 ? "1" : "0",
      reaction_like_count: randomInt(0, 200),
      reaction_love_count: randomInt(0, 40),
      reaction_haha_count: randomInt(0, 20),
      reaction_yay_count: randomInt(0, 20),
      reaction_wow_count: randomInt(0, 20),
      reaction_sad_count: randomInt(0, 10),
      reaction_angry_count: randomInt(0, 10),
      comments: randomInt(0, 30),
      shares: randomInt(0, 12),
      views: randomInt(10, 500),
      post_rate: randomInt(0, 5),
      points_earned: "0",
      tips_enabled: randomInt(0, 1) ? "1" : "0",
      for_subscriptions: randomInt(0, 6) === 0 ? "1" : "0",
      is_paid: randomInt(0, 8) === 0 ? "1" : "0",
      post_price: randomInt(0, 25),
      paid_text: randomInt(0, 8) === 0 ? "Paid content preview" : null,
      processing: "0",
      pre_approved: "1",
      has_approved: "1",
    });

    postIds.push(postId);

    if (schema.posts_photos && schema.posts_photos.size > 0 && postType === "photo") {
      const photoCount = randomInt(1, 4);
      for (let photoIndex = 0; photoIndex < photoCount; photoIndex += 1) {
        await insertRow(connection, schema, "posts_photos", {
          post_id: postId,
          album_id: null,
          source: randomUrl("post-photo", `${postId}-${photoIndex}`),
          storage_type: "local",
          storage_data: JSON.stringify({ seed: `${postId}-${photoIndex}` }),
          filename: `photo-${postId}-${photoIndex}.jpg`,
          blur: "0",
          pinned: photoIndex === 0 ? "1" : "0",
        });
      }
    }

    if (schema.posts_videos && schema.posts_videos.size > 0 && postType === "video") {
      await insertRow(connection, schema, "posts_videos", {
        post_id: postId,
        category_id: categoryIdsByType.posts_videos.length
          ? pick(categoryIdsByType.posts_videos)
          : 1,
        source: randomUrl("post-video", postId),
        source_240p: null,
        source_360p: null,
        source_480p: null,
        source_720p: null,
        source_1080p: null,
        source_1440p: null,
        source_2160p: null,
        thumbnail: randomUrl("video-thumb", postId),
        views: randomInt(5, 250),
      });
    }

    if (schema.posts_articles && schema.posts_articles.size > 0 && postType === "article") {
      await insertRow(connection, schema, "posts_articles", {
        post_id: postId,
        cover: randomUrl("article-cover", postId),
        title: `Article ${postId}`,
        text: `Detailed article content for post ${postId}.`,
        category_id: categoryIdsByType.blogs.length ? pick(categoryIdsByType.blogs) : 1,
        tags: "seed,article,demo",
        views: randomInt(10, 200),
      });
    }

    if (schema.posts_links && schema.posts_links.size > 0 && postType === "link") {
      await insertRow(connection, schema, "posts_links", {
        post_id: postId,
        source_url: `https://example.test/articles/${postId}`,
        source_host: "example.test",
        source_title: pick(LINK_TITLES),
        source_text: `Link preview for post ${postId}.`,
        source_thumbnail: randomUrl("link-thumb", postId),
      });
    }

    if (schema.posts_products && schema.posts_products.size > 0 && postType === "product") {
      await insertRow(connection, schema, "posts_products", {
        post_id: postId,
        name: `Product ${postId}`,
        price: randomInt(10, 100),
        quantity: randomInt(1, 20),
        category_id: categoryIdsByType.market.length ? pick(categoryIdsByType.market) : 1,
        status: pick(["new", "old"]),
        location: pick(CITIES),
        available: "1",
        is_digital: randomInt(0, 1) ? "1" : "0",
        product_download_url: null,
        product_file_source: null,
      });
    }

    if (schema.posts_jobs && schema.posts_jobs.size > 0 && postType === "job") {
      const jobId = await insertRow(connection, schema, "posts_jobs", {
        post_id: postId,
        category_id: categoryIdsByType.jobs.length ? pick(categoryIdsByType.jobs) : 1,
        title: `Job ${postId}`,
        location: pick(CITIES),
        salary_minimum: randomInt(500, 2000),
        salary_maximum: randomInt(2000, 6000),
        pay_salary_per: pick(["hour", "week", "month"]),
        type: pick(["full-time", "part-time", "contract"]),
        question_1_type: "text",
        question_1_title: "Why are you a fit?",
        question_1_choices: null,
        question_2_type: "text",
        question_2_title: "Share experience.",
        question_2_choices: null,
        question_3_type: "text",
        question_3_title: "When can you start?",
        question_3_choices: null,
        cover_image: randomUrl("job-cover", postId),
        available: "1",
      });

      if (schema.posts_jobs_applications && schema.posts_jobs_applications.size > 0) {
        const applicants = sample(userIds, randomInt(1, 4));
        for (const applicantId of applicants) {
          await insertRow(connection, schema, "posts_jobs_applications", {
            post_id: postId,
            user_id: applicantId,
            name: `Applicant ${applicantId}`,
            location: pick(CITIES),
            phone: randomPhone(),
            email: `applicant${applicantId}@example.test`,
            work_place: pick(["Company A", "Company B", "Studio C"]),
            work_position: pick(["Manager", "Designer", "Developer"]),
            work_description: "Seeded application.",
            work_from: "2020",
            work_to: "2024",
            work_now: "0",
            question_1_answer: "Yes",
            question_2_answer: "A lot",
            question_3_answer: "Soon",
            cv: `https://example.test/cv/${applicantId}.pdf`,
            applied_time: minutesAgo(randomInt(5, 500)),
          });
        }
      }
    }

    if (schema.posts_polls && schema.posts_polls.size > 0 && postType === "poll") {
      const pollId = await insertRow(connection, schema, "posts_polls", {
        post_id: postId,
        votes: randomInt(5, 250),
      });

      if (schema.posts_polls_options && schema.posts_polls_options.size > 0) {
        const optionTexts = ["Option A", "Option B", "Option C"];
        for (const optionText of optionTexts) {
          const optionId = await insertRow(connection, schema, "posts_polls_options", {
            poll_id: pollId,
            text: `${optionText} ${index + 1}`,
          });

          if (schema.posts_polls_options_users && schema.posts_polls_options_users.size > 0) {
            const voters = sample(userIds, randomInt(1, 5));
            for (const voterId of voters) {
              await insertRow(connection, schema, "posts_polls_options_users", {
                user_id: voterId,
                poll_id: pollId,
                option_id: optionId,
              });
            }
          }
        }
      }
    }

    if (schema.posts_live && schema.posts_live.size > 0 && postType === "live") {
      const liveId = await insertRow(connection, schema, "posts_live", {
        post_id: postId,
        video_thumbnail: randomUrl("live-thumb", postId),
        agora_uid: randomInt(1000, 9999),
        agora_channel_name: `channel-${postId}`,
        agora_resource_id: null,
        agora_sid: null,
        agora_file: null,
        live_ended: randomInt(0, 1) ? "0" : "1",
        live_recorded: randomInt(0, 1) ? "1" : "0",
      });

      if (schema.posts_live_users && schema.posts_live_users.size > 0) {
        for (const userId of sample(userIds, randomInt(2, 6))) {
          await insertRow(connection, schema, "posts_live_users", {
            user_id: userId,
            post_id: postId,
          });
        }
      }
    }

    if (schema.posts_funding && schema.posts_funding.size > 0 && postType === "funding") {
      const fundingId = await insertRow(connection, schema, "posts_funding", {
        post_id: postId,
        title: `Funding ${postId}`,
        amount: randomInt(500, 5000),
        raised_amount: randomInt(50, 2500),
        total_donations: randomInt(1, 25),
        cover_image: randomUrl("funding-cover", postId),
      });

      if (schema.posts_funding_donors && schema.posts_funding_donors.size > 0) {
        for (const donorId of sample(userIds, randomInt(1, 5))) {
          await insertRow(connection, schema, "posts_funding_donors", {
            user_id: donorId,
            post_id: postId,
            donation_amount: randomInt(5, 250),
            donation_time: minutesAgo(randomInt(1, 2000)),
          });
        }
      }
    }

    if (schema.posts_offers && schema.posts_offers.size > 0 && postType === "offer") {
      await insertRow(connection, schema, "posts_offers", {
        post_id: postId,
        category_id: categoryIdsByType.offers.length ? pick(categoryIdsByType.offers) : 1,
        title: `Offer ${postId}`,
        discount_type: pick(["percentage", "amount"]),
        discount_percent: randomInt(5, 50),
        discount_amount: randomInt(5, 100),
        buy_x: randomInt(1, 3),
        get_y: randomInt(1, 3),
        spend_x: randomInt(10, 50),
        amount_y: randomInt(5, 20),
        end_date: futureDays(randomInt(1, 30)),
        price: randomInt(10, 80),
        thumbnail: randomUrl("offer-thumb", postId),
      });
    }

    if (schema.posts_reactions && schema.posts_reactions.size > 0) {
      for (const reactorId of sample(userIds, randomInt(1, 4))) {
        await insertRow(connection, schema, "posts_reactions", {
          post_id: postId,
          user_id: reactorId,
          reaction: pick(["like", "love", "haha", "wow", "sad", "angry"]),
          reaction_time: minutesAgo(randomInt(1, 4000)),
          points_earned: "0",
        });
      }
    }

    if (schema.posts_saved && schema.posts_saved.size > 0 && randomInt(0, 3) === 0) {
      for (const saverId of sample(userIds, randomInt(1, 3))) {
        await insertRow(connection, schema, "posts_saved", {
          post_id: postId,
          user_id: saverId,
          time: minutesAgo(randomInt(1, 4000)),
        });
      }
    }
  }

  return postIds;
}

async function main() {
  const connection = await pool.getConnection();

  const baseTables = [
    "users",
    "pages",
    "groups",
    "events",
    "followings",
    "friends",
    "pages_admins",
    "pages_likes",
    "groups_admins",
    "groups_members",
    "events_members",
    "conversations",
    "conversations_users",
    "conversations_messages",
    "posts",
    "posts_photos",
    "posts_videos",
    "posts_articles",
    "posts_links",
    "posts_products",
    "posts_jobs",
    "posts_jobs_applications",
    "posts_polls",
    "posts_polls_options",
    "posts_polls_options_users",
    "posts_live",
    "posts_live_users",
    "posts_funding",
    "posts_funding_donors",
    "posts_offers",
    "posts_reactions",
    "posts_saved",
    "blogs_categories",
    "pages_categories",
    "groups_categories",
    "events_categories",
    "jobs_categories",
    "market_categories",
    "offers_categories",
    "posts_videos_categories",
    "system_countries",
  ];

  try {
    await connection.beginTransaction();

    const schema = await getSchema(connection, baseTables);

    if (RESET) {
      await truncateTables(connection, schema, [
        "posts_saved",
        "posts_reactions",
        "posts_funding_donors",
        "posts_funding",
        "posts_live_users",
        "posts_live",
        "posts_polls_options_users",
        "posts_polls_options",
        "posts_polls",
        "posts_jobs_applications",
        "posts_jobs",
        "posts_products",
        "posts_links",
        "posts_articles",
        "posts_videos",
        "posts_photos",
        "posts",
        "conversations_messages",
        "conversations_users",
        "conversations",
        "events_members",
        "events",
        "groups_members",
        "groups_admins",
        "groups",
        "pages_likes",
        "pages_admins",
        "pages",
        "followings",
        "friends",
        "users",
        "blogs_categories",
        "pages_categories",
        "groups_categories",
        "events_categories",
        "jobs_categories",
        "market_categories",
        "offers_categories",
        "posts_videos_categories",
        "system_countries",
      ]);
    }

    const countryIds = [];
    if (schema.system_countries && schema.system_countries.size > 0) {
      const [countries] = await connection.query(
        "SELECT country_id FROM system_countries ORDER BY country_id ASC LIMIT 10",
      );
      for (const row of countries) {
        countryIds.push(row.country_id);
      }
    }

    const blogsCategoryIds = await seedCategories(connection, schema, "blogs_categories", [
      "News",
      "Opinion",
      "Tutorial",
    ]);
    const pageCategoryIds = await seedCategories(connection, schema, "pages_categories", [
      "Creator",
      "Business",
      "Community",
    ]);
    const groupCategoryIds = await seedCategories(connection, schema, "groups_categories", [
      "Community",
      "Business",
      "Learning",
    ]);
    const eventCategoryIds = await seedCategories(connection, schema, "events_categories", [
      "Workshop",
      "Meetup",
      "Launch",
    ]);
    const jobCategoryIds = await seedCategories(connection, schema, "jobs_categories", [
      "Full-time",
      "Part-time",
      "Contract",
    ]);
    const marketCategoryIds = await seedCategories(connection, schema, "market_categories", [
      "Electronics",
      "Fashion",
      "Services",
    ]);
    const offersCategoryIds = await seedCategories(connection, schema, "offers_categories", [
      "Discount",
      "Bundle",
      "Clearance",
    ]);
    const videoCategoryIds = await seedCategories(connection, schema, "posts_videos_categories", [
      "Short-form",
      "Documentary",
      "Tutorial",
    ]);

    const users = await seedUsers(connection, schema, DEFAULT_COUNTS.users, countryIds);
    const pages = await seedPages(
      connection,
      schema,
      DEFAULT_COUNTS.pages,
      users,
      countryIds,
      pageCategoryIds,
    );
    const groups = await seedGroups(
      connection,
      schema,
      DEFAULT_COUNTS.groups,
      users,
      groupCategoryIds,
    );
    const events = await seedEvents(
      connection,
      schema,
      DEFAULT_COUNTS.events,
      users,
      pages,
      eventCategoryIds,
    );

    await seedConnections(connection, schema, users);
    await seedConversations(
      connection,
      schema,
      users,
      DEFAULT_COUNTS.conversations,
      DEFAULT_COUNTS.messagesPerConversation,
    );

    const postIds = await seedPosts(
      connection,
      schema,
      users,
      pages,
      groups,
      events,
      {
        blogs: blogsCategoryIds,
        jobs: jobCategoryIds,
        market: marketCategoryIds,
        offers: offersCategoryIds,
        posts_videos: videoCategoryIds,
      },
      DEFAULT_COUNTS.posts,
    );

    await connection.commit();

    console.log("Demo data seeded successfully.");
    console.log({
      users: users.length,
      pages: pages.length,
      groups: groups.length,
      events: events.length,
      posts: postIds.length,
      reset: RESET,
      runTag: RUN_TAG,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main();
