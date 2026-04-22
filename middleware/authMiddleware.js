const jwt = require("jsonwebtoken");
const { updateUserActivity } = require("./userActivity");

async function authenticateToken(req, res, next) {
  console.log("🔹 Running authenticateToken middleware", {
    method: req.method,
    url: req.originalUrl,
    timestamp: new Date().toISOString(),
  });

  const authHeader = req.headers.authorization;
  console.log("🔹 Authorization header:", authHeader || "Missing");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error("🚨 Missing or malformed Authorization header", {
      authHeader,
    });
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Missing or malformed token",
    });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    console.error("🚨 Token is empty");
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: Token is empty" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log("✅ Token decoded successfully", { user_id: decoded.id });

    req.user = {
      id: decoded.id,
      email: decoded.email,
    };

    req.userId = decoded.id; // backward compatibility

    // Optional activity tracking
    if (typeof updateUserActivity === "function") {
      await updateUserActivity(req, res, () => {});
    }

    return next();
  } catch (error) {
    console.error("🚨 Token verification failed", {
      error: error.message,
      name: error.name,
    });

    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: Token expired" });
    }

    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: Invalid token" });
  }
}

function authenticateUser(req, res, next) {
  console.log("🔹 Running authenticateUser middleware", {
    method: req.method,
    url: req.originalUrl,
    timestamp: new Date().toISOString(),
  });

  const authHeader = req.headers.authorization;
  console.log("🔹 Authorization header:", authHeader || "Missing");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error("🚨 Missing or malformed Authorization header", {
      authHeader,
    });
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Missing or malformed token",
    });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    console.error("🚨 Token is empty");
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: Token is empty" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log("✅ Token decoded successfully", { user_id: decoded.id });

    req.user = decoded; // full payload
    req.user.id = decoded.id; // ensure consistency

    return next();
  } catch (error) {
    console.error("🚨 Token verification failed", {
      error: error.message,
      name: error.name,
    });

    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: Token expired" });
    }

    return res
      .status(401)
      .json({ success: false, message: "Unauthorized: Invalid token" });
  }
}

module.exports = { authenticateToken, authenticateUser };
