import express from "express";
import { createClient } from "redis";

const app = express();
const port = 3000;

app.use(express.json());

const redisClient = createClient();

redisClient.on("connect", () => console.log("Redis connected!"));
redisClient.on("error", (err) => console.log("Redis Error:", err));

await redisClient.connect();

// Helper to generate random 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post("/send-otp", async (req, res) => {
  const { mobile } = req.body;

  if (!mobile) {
    return res.status(400).json({ error: "Mobile number is required" });
  }

  // Check if OTP was sent recently (e.g., within 60 seconds)
  const sentAt = await redisClient.get(`otp:sent:${mobile}`);
  if (sentAt) {
    const age = Math.floor((Date.now() - sentAt) / 1000);
    if (age < 60) {
      return res
        .status(429)
        .json({ error: `Please wait ${60 - age} seconds before requesting a new OTP` });
    }
  }

  const otp = generateOTP();

  // Store OTP with expiry
  await redisClient.setEx(`otp:valid:${mobile}`, 300, otp); // 5 mins expiry
  await redisClient.set(`otp:sent:${mobile}`, Date.now()); // Mark as sent

  console.log(`[SEND OTP] ${mobile} -> ${otp}`);

  // TODO: Send OTP via SMS/Email
  res.json({ message: "OTP sent successfully", otp });
});

app.post("/verify-otp", async (req, res) => {
  const { mobile, otp } = req.body;

  if (!mobile || !otp) {
    return res.status(400).json({ error: "Mobile and OTP are required" });
  }

  const storedOtp = await redisClient.get(`otp:valid:${mobile}`);

  if (!storedOtp) {
    return res.status(400).json({ error: "Expired OTP" });
  }

  if (parseInt(storedOtp) !== parseInt(otp)) {
    return res.status(400).json({ error: "Invalid OTP" });
  }

  // Clear OTP after successful verification
  await redisClient.del(`otp:valid:${mobile}`);
  await redisClient.del(`otp:sent:${mobile}`);

  console.log(`[VERIFY OTP] ${mobile} -> Verified`);

  res.json({ message: "OTP verified successfully" });
});

app.listen(port, () => {
  console.log(`OTP Service running on port ${port}`);
});