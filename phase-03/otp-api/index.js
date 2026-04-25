import express from "express";
import { createClient } from "redis";

import logger from "./logger.js";

const app = express();
const port = 3000;

app.use(express.json());
app.set("trust proxy", true);
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
  await redisClient.set(`otp:valid:${mobile}`, otp, { EX: 300 }); // 5 mins expiry
  await redisClient.set(`otp:sent:${mobile}`, Date.now()); // Mark as sent

  console.log(`[SEND OTP] ${mobile} -> ${otp}`);
  logger.info(`[${req.method}] [${mobile}] -> [OTP Sent] [${new Date().toISOString()}]`);

  // TODO: Send OTP via SMS/Email
  res.json({ message: "OTP sent successfully", otp });
});

app.post("/verify-otp", async (req, res) => {
  const { mobile, otp } = req.body;

  if (!mobile || !otp) {
    return res.status(400).json({ error: "Mobile and OTP are required" });
  }
  


  // WAY -- 1
  // const invalidAt = await redisClient.get(`otp:invalid:${mobile}`);

  // if (invalidAt) {
  //   const age = Math.floor((Date.now() - invalidAt) / 1000);
  //   if (age < 5) {
  //     return res
  //       .status(429)
  //       .json({ error: `Please wait ${5 - age} seconds before submiting OTP again` });
  //   }
  // }



  // WAY -- 2
  // const cooldown = await redisClient.get(`otp:cooldown:${mobile}`);
  // if (cooldown) {
    //   return res
    //     .status(429)
    //     .json({ error: `Please wait ${expiry} seconds before submiting OTP again` });
    //   // return res.status(429).json({ error: `Please wait before submitting OTP again` });
    // }
  
    

  // WAY -- 3
    const attemptsKey = `otp:attempts:${mobile}`;
    const cooldownKey = `otp:cooldown:${mobile}`;
    const ttl = await redisClient.ttl(cooldownKey);
    if (ttl > 0) {
      logger.error(`[${req.method}] [${mobile}] -> [Rate Limited] cooling for ${ttl} seconds | [${new Date().toISOString()}]`);
      return res.status(429).json({
        error: `Please wait ${ttl} seconds before submitting OTP again`
      });
    }


  const storedOtp = await redisClient.get(`otp:valid:${mobile}`);

  if (!storedOtp) {
    logger.error(`[${req.method}] [${mobile}] -> [Expired OTP] | [${new Date().toISOString()}]`);
    return res.status(400).json({ error: "Expired OTP" });
  }

  if (parseInt(storedOtp) !== parseInt(otp)) {
    // await redisClient.set(`otp:invalid:${mobile}`, Date.now()); // WAY -- 1
    
    // await redisClient.set(`otp:cooldown:${mobile}`, "1", { EX: 15 }); // WAY -- 2

    const attempts = await redisClient.incr(attemptsKey); // WAY -- 3
    if (attempts > 5) {
      logger.error(`[${req.method}] [${mobile}] -> [Too many attempts] attempts: ${attempts} | [${new Date().toISOString()}]`);
      return res.status(400).json({ error: "Too many attempts" });
    }
    const expiry = attempts * 10;
    await redisClient.set(cooldownKey, "1", { EX: expiry });
    
    logger.error(`[${req.method}] [${mobile}] -> [Invalid OTP] attempts: ${attempts} | cooling for ${expiry} seconds | [${new Date().toISOString()}]`);
    return res.status(400).json({ error: "Invalid OTP" });
  }

  // Clear OTP after successful verification
  await redisClient.del(`otp:valid:${mobile}`);
  await redisClient.del(`otp:sent:${mobile}`);

  // await redisClient.del(`otp:invalid:${mobile}`); // WAY -- 1

  // await redisClient.del(`otp:cooldown:${mobile}`); // WAY -- 2
  
  await redisClient.del(attemptsKey); // WAY -- 3
  await redisClient.del(cooldownKey); // WAY -- 3

  console.log(`[VERIFY OTP] ${mobile} -> Verified`);
  logger.info(`[${req.method}] [${mobile}] -> [Verified OTP] | [${new Date().toISOString()}]`);

  res.json({ message: "OTP verified successfully" });
});



app.get("/", (req, res) => {
  logger.info("Home route accessed");
  res.send("Hello");
});


app.listen(port, () => {
  console.log(`OTP Service running on port ${port}`);
});