// validators/affiliateValidator.js
module.exports = {
  validateWithdrawal(points) {
    if (!points || isNaN(points) || points <= 0) {
      return "Invalid points value";
    }
    return null;
  },
};
