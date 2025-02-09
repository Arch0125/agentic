import cron from "node-cron";
import axios from "axios";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

// --- Viem Provider Setup ---
// Replace with your own RPC endpoint (e.g., via Alchemy or Infura).
const provider = createPublicClient({
  chain: mainnet,
  transport: http("https://eth-mainnet.alchemy.com/v2/YOUR_ALCHEMY_API_KEY"),
});

// --- Global Reference Price ---
// When ETH is held (and predicted to be “up”), store a reference price to compare for a 0.5% drop.
let lastEthPrice: number | undefined = undefined;

/**
 * Fetch the current ETH price from CoinGecko.
 */
async function getCurrentEthPrice(): Promise<number> {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      {
        params: {
          ids: "ethereum",
          vs_currencies: "usd",
        },
        headers: {
            "x-cg-demo-api-key": "CG-J1f95Y52uQzg4q2NAxPmTno3",
          },
      }
    );
    console.log(`[${new Date().toISOString()}] Current ETH Price: ${response.data.ethereum.usd} USD`);
    return response.data.ethereum.usd;
  } catch (error) {
    console.error("Error fetching current ETH price:", error);
    throw error;
  }
}

async function predictEthPrice(): Promise<number> {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/coins/ethereum/market_chart",
      {
        params: {
          vs_currency: "usd",
          days: 2,
        },
        headers: {
            "x-cg-demo-api-key": "CG-J1f95Y52uQzg4q2NAxPmTno3",
          },
      }
    );

    const data = response.data;
    console.log(data);
    if (!data || !data.prices) {
      throw new Error("No historical price data available.");
    }

    const prices: [number, number][] = data.prices; 
    const n = Math.min(prices.length, 6);
    const recentPrices = prices.slice(-n);

    const baseTime = recentPrices[0][0]; 
    const dataPoints = recentPrices.map(([timestamp, price]) => {
      const hours = (timestamp - baseTime) / (1000 * 60 * 60);
      return { x: hours, y: price };
    });

    const { a, b } = linearRegression(dataPoints);
    const lastX = dataPoints[dataPoints.length - 1].x;
    const predictedPrice = a + b * (lastX + 1);
    console.log(`[${new Date().toISOString()}] Predicted ETH price (next hour): ${predictedPrice}`);
    return predictedPrice;
  } catch (error) {
    console.error("Error predicting ETH price:", error);
    throw error;
  }
}

function linearRegression(data: { x: number; y: number }[]): { a: number; b: number } {
  const n = data.length;
  const sumX = data.reduce((acc, point) => acc + point.x, 0);
  const sumY = data.reduce((acc, point) => acc + point.y, 0);
  const sumXY = data.reduce((acc, point) => acc + point.x * point.y, 0);
  const sumXX = data.reduce((acc, point) => acc + point.x * point.x, 0);

  const b = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const a = (sumY - b * sumX) / n;
  return { a, b };
}

async function convertToUSDC(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Converting ETH to USDC...`);
}

async function monitorDepositsAndPrice() {
  const walletAddress = "YOUR_WALLET_ADDRESS";

  const balance = await provider.getBalance({ address: walletAddress });
  const ethBalance = Number(balance) / 1e18;
  console.log(`[${new Date().toISOString()}] ETH Balance: ${ethBalance}`);

  if (ethBalance > 0) {
    const currentPrice = await getCurrentEthPrice();
    console.log(`[${new Date().toISOString()}] Current ETH Price: ${currentPrice} USD`);

    const predictedPrice = await predictEthPrice();

    if (predictedPrice < currentPrice) {
      console.log(`[${new Date().toISOString()}] Prediction indicates a downward trend. Converting ETH to USDC immediately.`);
      await convertToUSDC();
      lastEthPrice = undefined;
    } else {
      if (lastEthPrice === undefined) {
        lastEthPrice = currentPrice;
        console.log(`[${new Date().toISOString()}] Setting reference price to ${currentPrice} USD.`);
      } else {
        const dropPercent = ((lastEthPrice - currentPrice) / lastEthPrice) * 100;
        console.log(`[${new Date().toISOString()}] Price drop from reference: ${dropPercent.toFixed(2)}%`);
        if (dropPercent >= 0.5) {
          console.log(`[${new Date().toISOString()}] ETH price dropped by at least 0.5% from the reference. Converting ETH to USDC.`);
          await convertToUSDC();
          lastEthPrice = undefined;
        } else {
          if (currentPrice > lastEthPrice) {
            lastEthPrice = currentPrice;
            console.log(`[${new Date().toISOString()}] Updating reference price to ${currentPrice} USD.`);
          }
        }
      }
    }
  } else {
    console.log(`[${new Date().toISOString()}] No ETH deposits to monitor.`);
  }
}

// --- Schedule the Cron Job ---
// This cron schedule ("0 * * * *") runs at the 0th minute of every hour.
// cron.schedule("0 * * * *", async () => {
//   console.log(`[${new Date().toISOString()}] Running hourly ETH monitoring check...`);
//   try {
//     await monitorDepositsAndPrice();
//   } catch (error) {
//     console.error("Error during hourly check:", error);
//   }
// });

getCurrentEthPrice().then(() => {
    console.log("Done");
    }
).catch((error) => {
    console.log(error);
});

predictEthPrice().then(() => {
    console.log("Done");
    }
).catch((error) => {
    console.log(error);
});
