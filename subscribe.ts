import cron from "node-cron";
import axios from "axios";
import  Configuration, { OpenAI } from "openai";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Uses the OpenAI SDK to decode a subscription prompt.
 * The prompt should be in the format:
 *    "subscribe to <address> for <amount> usdc"
 *
 * Returns a JSON object like:
 *    { "address": "<address>", "amount": <number> }
 */
async function decodeSubscriptionPrompt(
  prompt: string
): Promise<{ address: string; amount: number }> {
 
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const messages = [
    {
      role: "system",
      content:
        'You are an assistant that extracts subscription parameters from a prompt. The prompt is in the format: "subscribe to <address> for <amount> usdc". Return only valid JSON in the format: {"address": "<address>", "amount": <number>}.',
    },
    { role: "user", content: prompt },
  ];

  // Use the updated OpenAI SDK method as in your previous usage
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages,
  });

  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error("No response from OpenAI.");
  }
  try {
    console.log("Content:", content);
    const result = JSON.parse(content);
    return result;
  } catch (error) {
    throw new Error("Failed to parse OpenAI response: " + content);
  }
}


export async function scheduleSubscriptionJob(address: string, amount: string) {
  cron.schedule("*/10 * * * * *", async () => {
    const payload = { prompt: `send ${amount} usdc to ${address}"` };

    try {
      const response = await axios.post("http://localhost:3060/prompt", payload);
      console.log(`[${new Date().toISOString()}] Response:`, response.data);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error sending prompt:`, error);
    }
  });

  console.log("Cron job scheduled to send every 5 seconds.");
}

