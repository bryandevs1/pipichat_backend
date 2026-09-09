/**
 * seedMorePosts.js
 * -----------------------------------------------------------------------------
 * Populate the feed with EXTRA posts assigned to EXISTING users.
 *
 * Unlike seedDemoData.js this does NOT reset/truncate anything and does NOT
 * create new users - it only INSERTs posts (photos / videos / articles / jobs)
 * using random EXISTING, active users as authors.
 *
 * Media comes from REMOTE, brand-free sources (Picsum = real Unsplash photos,
 * no watermark) plus open-movie sample MP4s, so it does NOT depend on the
 * Google Cloud bucket at all. The URLs are stored as full http(s) URLs, which
 * the app passes through unchanged (see getFullUrl()).
 *
 * Usage (run from the backend/ folder):
 *   node scripts/seedMorePosts.js                     # default 30 posts
 *   node scripts/seedMorePosts.js --count 60          # total count
 *   node scripts/seedMorePosts.js --photos 14 --videos 6 --articles 6 --jobs 4
 *
 * Default split for 30 posts: 14 photos, 6 videos, 6 articles, 4 jobs.
 * -----------------------------------------------------------------------------
 */

const pool = require("../config/db");

// ─── CLI / env config ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argVal = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1]) return Number(argv[i + 1]);
  return fallback;
};

const TOTAL = argVal("count", 30);
const WANT = {
  photos: argVal("photos", null),
  videos: argVal("videos", null),
  articles: argVal("articles", null),
  jobs: argVal("jobs", null),
};

function computeSplit(total) {
  const anyGiven = [WANT.photos, WANT.videos, WANT.articles, WANT.jobs].some(
    (v) => v !== null,
  );

  let s;
  if (!anyGiven) {
    // Default ratio so a 30-post run looks organic
    const videos = Math.max(4, Math.round(total * 0.2));
    const jobs = Math.max(3, Math.round(total * 0.13));
    const articles = Math.max(4, Math.round(total * 0.2));
    const photos = Math.max(4, total - videos - jobs - articles);
    s = { photos, videos, articles, jobs };
  } else {
    s = {
      photos: Math.max(0, WANT.photos ?? 0),
      videos: Math.max(0, WANT.videos ?? 0),
      articles: Math.max(0, WANT.articles ?? 0),
      jobs: Math.max(0, WANT.jobs ?? 0),
    };
  }

  let sum = s.photos + s.videos + s.articles + s.jobs;
  if (sum < total) {
    // top up with photo posts
    s.photos += total - sum;
  } else if (sum > total) {
    // trim non-photo buckets first, photos last
    let excess = sum - total;
    for (const key of ["videos", "articles", "jobs"]) {
      const trim = Math.min(s[key], excess);
      s[key] -= trim;
      excess -= trim;
    }
    s.photos = Math.max(0, s.photos - excess);
  }
  return s;
}

// ─── Small helpers ───────────────────────────────────────────────────────────
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(items) {
  return items[randomInt(0, items.length - 1)];
}
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function hoursAgo(h) {
  const d = new Date();
  d.setHours(d.getHours() - h);
  return d;
}

// Deterministic, no-watermark image URL (Picsum serves real Unsplash photos)
const picsum = (seed, w = 1080, h = 1080) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;

// ─── Content ─────────────────────────────────────────────────────────────────
const CITIES = [
  "Lagos", "Nairobi", "Accra", "Johannesburg", "Cairo", "Dakar",
  "Abuja", "Kigali", "Kampala", "Dar es Salaam", "Addis Ababa", "Lusaka",
  "Harare", "Abidjan", "Douala", "Casablanca",
];

const PHOTO_CAPTIONS = [
  "Golden hour in the neighbourhood hits different. 📸 No filter needed.",
  "Market day! The colours, the sounds, the hustle — this is home.",
  "Went back to the motherland for a reset. Best decision I've made this year.",
  "Studio vibes today. New creative direction loading…",
  "Street art tour with the crew. So much talent hiding in plain sight.",
  "The view from the rooftop meeting — this city never stops moving.",
  "Fresh from the kiln 🔥 hand-thrown pottery by a local artisan. Support local!",
  "Coastline walk this morning. Salt air does something to the soul.",
  "Coffee break with the best view in town. Anyone else work remotely like this?",
  "Community clean-up day. 200+ bags collected. Small actions, big change.",
  "Behind the scenes of our latest shoot. Teamwork makes the dream work.",
  "Sunset from the hills. Grateful for this journey and everyone on it.",
  "New week, new energy. What are we building this week?",
  "Textile patterns that tell a story older than all of us. 🇳🇬",
];

const VIDEO_CAPTIONS = [
  "Sneak peek of a short film we shot last month — full drop coming soon. 🎬",
  "POV: the producer asked for 'one more take' and we delivered.",
  "We interviewed a founder who started with $50 in a market stall. Watch till the end.",
  "Timelapse of a full day in the creative district. Sound on! 🔊",
  "Quick studio session that turned into an anthem. Who's feeling this?",
  "Documentary teaser: water, agriculture, and the engineers fixing Africa's food system.",
];

// Brand-free, stable sample MP4s (Blender open movies, no logos/watermarks).
// Swap these out for your own hosted clips whenever you like.
const SAMPLE_VIDEOS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
];

const ARTICLE_POSTS = [
  {
    title: "Why Africa's Creators Are Skipping the Middlemen",
    tags: "creators,economy,culture",
    body:
      "For years, African creators were told the only route to success ran through foreign platforms and foreign managers. That playbook is changing fast.\n\nThe numbers tell the story: direct monetisation, local payment rails and community-owned platforms are letting creators keep a far bigger slice of their earnings. The audience was always there — what was missing was infrastructure.\n\nWe spoke to creators in Lagos, Nairobi and Accra about what this shift means for the next generation.",
  },
  {
    title: "The Quiet Rise of Secondary Cities",
    tags: "startups,investment,africa",
    body:
      "Most of the continent's startup headlines still come from Lagos, Nairobi, Cape Town and Cairo. But a quieter wave is building in secondary cities — and investors are starting to notice.\n\nLower costs, deeper local insight and less competition for talent mean founders in these cities are often building more sustainably than their capital-city peers.\n\nThis piece unpacks the data on where the next unicorn might actually come from.",
  },
  {
    title: "Fintech Is Easy. Trust Is Hard.",
    tags: "fintech,trust,finance",
    body:
      "The last decade proved African fintech can build world-class rails. The next decade will be decided by something far harder to engineer: trust.\n\nFrom digital-first banks to micro-lending, the winners are the ones who treat customer education as a feature, not a cost.\n\nHere is what we learned from the operators doing it best across three markets.",
  },
  {
    title: "A Field Guide to Building Products for the Informal Economy",
    tags: "product,design,informal-economy",
    body:
      "Roughly 80% of workers on the continent operate in the informal economy. Most products are still designed for the 20%.\n\nBuilding for market traders, boda riders and smallholder farmers means rethinking onboarding, trust signals and even the phone hardware your users carry.\n\nWe break down the design decisions that separate tools people actually use from the ones they uninstall.",
  },
  {
    title: "The Green Revolution Needs Software",
    tags: "agritech,climate,technology",
    body:
      "Africa holds 60% of the world's uncultivated arable land — yet imports billions in food every year. Closing that gap is as much a software problem as an agriculture one.\n\nFrom satellite-driven crop advice to cold-chain logistics, a new generation of agritech is wiring the farm to the market for the first time.\n\nThis is how the next decade of food security gets built.",
  },
  {
    title: "What Music Streaming Learned From Afrobeats",
    tags: "music,culture,streaming",
    body:
      "Afrobeats didn't just go global — it forced the streaming giants to rethink how they discover, curate and pay global artists.\n\nThe genre's rise reveals the power of diaspora audiences and local playlists. It also exposes how little of streaming revenue actually reaches artists.\n\nWe look at what the industry still owes the sound that carried it.",
  },
];

const JOB_POSTS = [
  {
    title: "Senior Product Designer",
    location: "Lagos (hybrid)",
    salary: [800, 2500],
    pay: "month",
    type: "full-time",
    cover: picsum("job-product-designer", 1200, 630),
    questions: [
      "Tell us about a product you took from idea to shipped.",
      "How do you handle feedback that disagrees with your design direction?",
      "When can you start?",
    ],
  },
  {
    title: "Backend Engineer (Node.js)",
    location: "Nairobi (remote)",
    salary: [1500, 4000],
    pay: "month",
    type: "full-time",
    cover: picsum("job-backend-engineer", 1200, 630),
    questions: [
      "Describe the largest system you've built or maintained.",
      "How do you approach database performance and scaling?",
      "Share a link to something you're proud of.",
    ],
  },
  {
    title: "Growth & Partnerships Lead",
    location: "Accra",
    salary: [1000, 2200],
    pay: "month",
    type: "full-time",
    cover: picsum("job-growth-partnerships", 1200, 630),
    questions: [
      "Tell us about a partnership you closed and how you found the contact.",
      "How do you measure the success of a growth campaign?",
      "Why do you want to work in the African ecosystem?",
    ],
  },
  {
    title: "Content Strategist (Contract)",
    location: "Remote (Africa time zones)",
    salary: [600, 900],
    pay: "week",
    type: "contract",
    cover: picsum("job-content-strategist", 1200, 630),
    questions: [
      "Show us a content calendar or campaign you planned.",
      "What topics do you think this community needs more of?",
      "How many hours a week can you commit?",
    ],
  },
  {
    title: "Community Manager",
    location: "Kigali (on-site)",
    salary: [500, 1200],
    pay: "month",
    type: "part-time",
    cover: picsum("job-community-manager", 1200, 630),
    questions: [
      "How would you grow engagement in an online community?",
      "Share an example of handling a difficult member gracefully.",
      "What does a healthy community look like to you?",
    ],
  },
  {
    title: "Data Analyst — Fintech",
    location: "Johannesburg (hybrid)",
    salary: [1300, 3000],
    pay: "month",
    type: "full-time",
    cover: picsum("job-data-analyst", 1200, 630),
    questions: [
      "Walk us through an analysis that changed a business decision.",
      "Which SQL/BI tools do you reach for first and why?",
      "Are you comfortable presenting to non-technical stakeholders?",
    ],
  },
];

// ─── Schema helpers (defensive: only insert columns that exist) ─────────────
async function getColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

async function insertRow(connection, schema, table, data) {
  const cols = schema[table];
  if (!cols || cols.size === 0) {
    throw new Error(`Table not found: ${table}`);
  }
  const entries = Object.entries(data).filter(
    ([k, v]) => cols.has(k) && v !== undefined && v !== null,
  );
  if (entries.length === 0) {
    throw new Error(`No insertable columns for ${table}`);
  }
  const sql = `INSERT INTO \`${table}\` (${entries
    .map(([k]) => `\`${k}\``)
    .join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`;
  const [result] = await connection.query(sql, entries.map(([, v]) => v));
  return result.insertId;
}

/**
 * Returns category ids for a category table (creating standard rows only if the
 * table exists and is empty). Category tables may not have any rows yet, and
 * several subtype tables have NOT NULL category_id, so we make sure ids exist.
 */
async function ensureCategoryIds(connection, schema, table, labels) {
  if (!schema[table] || schema[table].size === 0) return [];
  const [rows] = await connection.query(
    `SELECT * FROM \`${table}\` ORDER BY 1 ASC LIMIT 500`,
  );
  if (rows.length > 0) {
    const firstCol = Object.keys(rows[0])[0];
    return rows.map((r) => r[firstCol]);
  }
  const ids = [];
  for (let i = 0; i < labels.length; i += 1) {
    const id = await insertRow(connection, schema, table, {
      category_parent_id: 0,
      category_name: labels[i],
      category_description: `${labels[i]} category`,
      category_order: i + 1,
    });
    ids.push(id);
  }
  return ids;
}

// ─── Post factory ────────────────────────────────────────────────────────────
function basePostRow(authorId, postType, caption) {
  return {
    user_id: authorId,
    user_type: "user",
    in_group: "0",
    group_id: null,
    group_approved: "1",
    in_event: "0",
    event_id: null,
    event_approved: "1",
    in_wall: "0",
    wall_id: null,
    is_collaborative: "0",
    collaborative_percent: 0,
    post_type: postType,
    colored_pattern: null,
    origin_id: null,
    time: hoursAgo(randomInt(1, 72)),
    location: pick(CITIES),
    privacy: randomInt(0, 3) === 0 ? "friends" : "public",
    text: caption,
    feeling_action: null,
    feeling_value: null,
    boosted: "0",
    boosted_by: null,
    comments_disabled: "0",
    is_hidden: "0",
    is_schedule: "0",
    for_adult: "0",
    is_anonymous: "0",
    reaction_like_count: randomInt(2, 180),
    reaction_love_count: randomInt(0, 30),
    reaction_haha_count: randomInt(0, 15),
    reaction_yay_count: randomInt(0, 15),
    reaction_wow_count: randomInt(0, 15),
    reaction_sad_count: randomInt(0, 8),
    reaction_angry_count: randomInt(0, 8),
    comments: randomInt(0, 25),
    shares: randomInt(0, 10),
    views: randomInt(20, 600),
    post_rate: 0,
    points_earned: "0",
    tips_enabled: "0",
    for_subscriptions: "0",
    is_paid: "0",
    is_paid_locked: "0",
    post_price: 0,
    paid_text: null,
    processing: "0",
    pre_approved: "1",
    has_approved: "1",
    post_latitude: "0",
    post_longitude: "0",
  };
}

// ─── Seeders ─────────────────────────────────────────────────────────────────
async function seedPhotoPost(connection, schema, authorId, index) {
  const caption = `${pick(PHOTO_CAPTIONS)} (${CITIES[index % CITIES.length]})`;
  const photoCount = randomInt(1, 4);
  const postId = await insertRow(connection, schema, "posts", {
    ...basePostRow(authorId, "photos", caption),
    comments: randomInt(1, 40),
  });

  for (let p = 0; p < photoCount; p += 1) {
    const seed = `pipi-photo-${index}-${p}`;
    const photoRow = {
      post_id: postId,
      album_id: null,
      source: picsum(seed, p === 0 ? 1080 : 1200, p === 0 ? 1080 : 800),
      blur: "0",
      pinned: p === 0 ? "1" : "0",
    };
    // Only add optional columns when the DB has them
    if (schema.posts_photos.has("storage_type")) photoRow.storage_type = "url";
    if (schema.posts_photos.has("storage_data")) {
      photoRow.storage_data = JSON.stringify({ source: "picsum", seed });
    }
    if (schema.posts_photos.has("filename")) {
      photoRow.filename = `${seed}.jpg`;
    }
    await insertRow(connection, schema, "posts_photos", photoRow);
  }
  return postId;
}

async function seedVideoPost(connection, schema, authorId, index, categoryIds) {
  const caption = pick(VIDEO_CAPTIONS);
  const seed = `pipi-video-${index}`;
  const postId = await insertRow(connection, schema, "posts", {
    ...basePostRow(authorId, "video", caption),
    views: randomInt(100, 3000),
  });

  await insertRow(connection, schema, "posts_videos", {
    post_id: postId,
    category_id: categoryIds.length ? pick(categoryIds) : 1,
    source: SAMPLE_VIDEOS[index % SAMPLE_VIDEOS.length],
    source_240p: null,
    source_360p: null,
    source_480p: null,
    source_720p: null,
    source_1080p: null,
    source_1440p: null,
    source_2160p: null,
    thumbnail: picsum(`${seed}-thumb`, 1280, 720),
    views: randomInt(50, 2000),
  });
  return postId;
}

async function seedArticlePost(connection, schema, authorId, index, categoryIds) {
  const article = ARTICLE_POSTS[index % ARTICLE_POSTS.length];
  const seed = `pipi-article-${index}`;
  const teaser = `${article.body.split("\n\n")[0]} Read the full article on the app.`;
  const postId = await insertRow(connection, schema, "posts", {
    ...basePostRow(authorId, "article", teaser),
    views: randomInt(50, 1200),
  });

  await insertRow(connection, schema, "posts_articles", {
    post_id: postId,
    cover: picsum(`${seed}-cover`, 1200, 630),
    title: article.title,
    text: article.body,
    category_id: categoryIds.length ? pick(categoryIds) : 1,
    tags: article.tags,
    views: randomInt(20, 500),
  });
  return postId;
}

async function seedJobPost(connection, schema, authorId, index, categoryIds) {
  const job = JOB_POSTS[index % JOB_POSTS.length];
  const postId = await insertRow(connection, schema, "posts", {
    ...basePostRow(
      authorId,
      "job",
      `We're hiring! ${job.title} — ${job.location}. Apply now on PipiAfrica.`,
    ),
    views: randomInt(100, 2500),
  });

  const jobRow = {
    post_id: postId,
    category_id: categoryIds.length ? pick(categoryIds) : 1,
    title: job.title,
    location: job.location,
    salary_minimum: job.salary[0],
    salary_maximum: job.salary[1],
    pay_salary_per: job.pay,
    type: job.type,
    question_1_type: "text",
    question_1_title: job.questions[0],
    question_1_choices: null,
    question_2_type: "text",
    question_2_title: job.questions[1],
    question_2_choices: null,
    question_3_type: "text",
    question_3_title: job.questions[2],
    question_3_choices: null,
    cover_image: job.cover,
    available: "1",
  };

  // Some (older) schemas have NOT NULL currency columns on jobs - fill them
  // with the first currency id if those columns exist.
  if (schema.posts_jobs && schema.posts_jobs.has("salary_minimum_currency")) {
    let currencyId = 1;
    try {
      const [curRows] = await connection.query(
        "SELECT * FROM `currencies` ORDER BY 1 ASC LIMIT 1",
      );
      if (curRows.length) currencyId = Object.values(curRows[0])[0];
    } catch (e) {
      /* no currencies table - fall back to id 1 */
    }
    jobRow.salary_minimum_currency = currencyId;
    jobRow.salary_maximum_currency = currencyId;
  }

  await insertRow(connection, schema, "posts_jobs", jobRow);
  return postId;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const split = computeSplit(TOTAL);
  const tables = [
    "posts", "posts_photos", "posts_videos", "posts_articles", "posts_jobs",
    "blogs_categories", "jobs_categories", "posts_videos_categories",
  ];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const schema = {};
    for (const t of tables) schema[t] = await getColumns(connection, t);

    if (!schema.posts || schema.posts.size === 0) {
      throw new Error("Could not read the `posts` table schema. Is the DB name correct in .env?");
    }

    // Existing active users to attribute posts to
    const [userRows] = await connection.query(
      `SELECT user_id FROM users
       WHERE user_activated = '1' AND user_banned = '0' AND user_id IS NOT NULL
       ORDER BY RAND() LIMIT ?`,
      [TOTAL * 4],
    );
    const users = userRows.map((r) => r.user_id);
    if (users.length < 2) {
      throw new Error(
        `Only found ${users.length} active users. Seed/create users first (e.g. seedDemoData.js) or activate some.`,
      );
    }

    // Reuse or create category ids
    const blogCatIds = await ensureCategoryIds(connection, schema, "blogs_categories", [
      "News", "Opinion", "Technology", "Business", "Culture",
    ]);
    const jobCatIds = await ensureCategoryIds(connection, schema, "jobs_categories", [
      "Full-time", "Part-time", "Contract", "Internship",
    ]);
    const videoCatIds = await ensureCategoryIds(connection, schema, "posts_videos_categories", [
      "Entertainment", "Documentary", "Music", "How-to",
    ]);

    const authors = shuffle(users);
    let cursor = 0;
    const nextAuthor = () => authors[cursor++ % authors.length];

    const created = { photos: [], videos: [], articles: [], jobs: [] };

    for (let i = 0; i < split.photos; i += 1) {
      created.photos.push(await seedPhotoPost(connection, schema, nextAuthor(), i));
    }
    for (let i = 0; i < split.videos; i += 1) {
      created.videos.push(await seedVideoPost(connection, schema, nextAuthor(), i, videoCatIds));
    }
    for (let i = 0; i < split.articles; i += 1) {
      created.articles.push(await seedArticlePost(connection, schema, nextAuthor(), i, blogCatIds));
    }
    for (let i = 0; i < split.jobs; i += 1) {
      created.jobs.push(await seedJobPost(connection, schema, nextAuthor(), i, jobCatIds));
    }

    await connection.commit();

    const totalCreated =
      created.photos.length + created.videos.length + created.articles.length + created.jobs.length;
    console.log("✓ Extra posts seeded successfully.");
    console.log({
      total: totalCreated,
      photos: created.photos.length,
      videos: created.videos.length,
      articles: created.articles.length,
      jobs: created.jobs.length,
      distinctAuthorsUsed: Math.min(totalCreated, authors.length),
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
