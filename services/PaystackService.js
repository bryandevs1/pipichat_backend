// services/PaystackService.js
const axios = require("axios");
require("dotenv").config();

class PaystackService {
  static async initializePayment({ email, amount, userId }) {
    const fee = amount * 0.01; // 1% fee
    const totalAmount = (amount + fee) * 100; // Paystack uses kobo

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: Math.round(totalAmount),
        metadata: { userId: userId.toString() },
        callback_url: `${process.env.FRONTEND_URL}/wallet/success`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.data.authorization_url;
  }

  static async verifyPayment(rawBody, signature) {
    const crypto = require("crypto");
    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest("hex");

    if (hash !== signature) throw new Error("Invalid Paystack signature");

    const event = JSON.parse(rawBody.toString());
    if (event.event !== "charge.success") return null;

    return {
      userId: event.data.metadata.userId,
      amount: event.data.amount / 100, // back to naira
      reference: event.data.reference,
    };
  }
}

module.exports = PaystackService;