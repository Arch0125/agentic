import express from "express";
import cors from "cors";
import {
  AgentKit,
  CdpWalletProvider,
  wethActionProvider,
  walletActionProvider,
  erc20ActionProvider,
  cdpApiActionProvider,
  cdpWalletActionProvider,
  pythActionProvider,
  basenameActionProvider,
  customActionProvider,
  EvmWalletProvider,
  ViemWalletProvider
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import { createWalletClient, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { z } from "zod";
import { processTransferPrompt } from "./bridge";
import { bridgeTokens } from "./cctp";
import { USDC_ADDRESS } from "./constants";
import cron from "node-cron";
import { monitorDepositsAndPrice } from "./trend";
import { scheduleSubscriptionJob } from "./subscribe";
import { getCollectiveUSDCBalance } from "./balance";

dotenv.config();

/**
 * Validates that required environment variables are set
 *
 * @throws {Error} - If required environment variables are missing
 */
function validateEnvironment(): void {
  const missingVars: string[] = [];
  const requiredVars = ["OPENAI_API_KEY", "CDP_API_KEY_NAME", "CDP_API_KEY_PRIVATE_KEY"];
  requiredVars.forEach((varName) => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.error("Error: Required environment variables are not set");
    missingVars.forEach((varName) => {
      console.error(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }

  if (!process.env.NETWORK_ID) {
    console.warn("Warning: NETWORK_ID not set, defaulting to base-sepolia testnet");
  }

  console.log("Environment variables are set correctly");
}

// Validate environment variables immediately
validateEnvironment();

// Configure a file to persist the agent's CDP MPC Wallet Data
const WALLET_DATA_FILE = "wallet_data.txt";

const customSignMessage = customActionProvider<EvmWalletProvider>({
  name: "sign_message",
  description: "Sign arbitrary messages using EIP-191 Signed Message Standard hashing",
  schema: z.object({
    message: z.string().describe("The message to sign"),
  }),
  invoke: async (walletProvider, args: any) => {
    const { message } = args;
    const signature = await walletProvider.signTransaction(message);
    return `The payload signature ${signature}`;
  },
});

const customBridgingToken = customActionProvider<CdpWalletProvider>({
  name: "bridging_token",
  description: "Generate bridging token for cross-chain transactions",
  schema: z.object({
    amount: z.number().positive().describe("The amount of bridging token to generate"),
    direction: z.string().describe("The direction of the bridging token can be sepoliaToBase or baseToSepolia"),
  }),
  invoke: async (walletProvider, args: any) => {
    const { amount, direction } = args;
    return `The bridging token ${amount} USDC in direction ${direction} has been generated`;
  },
});

const customUSDCTransfer = customActionProvider<CdpWalletProvider>({
  name: "usdc_transfer",
  description: "Transfer USDC tokens between accounts",
  schema: z.object({
    amount: z.number().positive().describe("The amount of USDC to transfer"),
    recipient: z.string().describe("The recipient's address"),
  }),
  invoke: async (walletProvider, args: any) => {
    const { amount, recipient } = args;
    const prompt = `send "${amount} usdc to ${recipient}"`;
    const res = await processTransferPrompt(prompt, walletProvider.getAddress());
    if (res.formattedInstructions.length === 0) {
      // Build the encoded transfer transaction
      const erc20TransferABI = [
        {
          inputs: [
            { internalType: "address", name: "recipient", type: "address" },
            { internalType: "uint256", name: "amount", type: "uint256" },
          ],
          name: "transfer",
          outputs: [{ internalType: "bool", name: "", type: "bool" }],
          stateMutability: "nonpayable",
          type: "function",
        },
      ];
      const usdcAddress = USDC_ADDRESS[res.destinationChain as "sepolia" | "arb" | "base"];
      const encodedTx = encodeFunctionData({
        abi: erc20TransferABI,
        functionName: "transfer",
        args: [recipient, BigInt(amount) * 1_000_000n],
      });
      const hash = await walletProvider.sendTransaction({
        to: usdcAddress as `0x${string}`,
        data: encodedTx,
      });
      return `The USDC transfer has been completed with tx hash ${hash}`;
    } else {
      for (const r of res.formattedInstructions) {
        await bridgeTokens(
          r.direction as "baseToSepolia" | "sepoliaToBase" | "arbToBase" | "baseToArb",
          BigInt(Number(r.amount) * 1e6),
          process.env.PVT_KEY as `0x${string}`,
          { approvalAmount: BigInt(10000000000000) }
        );
      }
      const erc20TransferABI = [
        {
          inputs: [
            { internalType: "address", name: "recipient", type: "address" },
            { internalType: "uint256", name: "amount", type: "uint256" },
          ],
          name: "transfer",
          outputs: [{ internalType: "bool", name: "", type: "bool" }],
          stateMutability: "nonpayable",
          type: "function",
        },
      ];
      const usdcAddress = USDC_ADDRESS[res.destinationChain as "sepolia" | "arb" | "base"];
      const encodedTx = encodeFunctionData({
        abi: erc20TransferABI,
        functionName: "transfer",
        args: [recipient, BigInt(amount) * 1_000_000n],
      });
      const hash = await walletProvider.sendTransaction({
        to: usdcAddress as `0x${string}`,
        data: encodedTx,
      });
      return `The USDC transfer has been completed with tx hash ${hash}`;
    }
  },
});

const customSubscriptionPrompt = customActionProvider<CdpWalletProvider>({
    name: "subscription",
    description: "Subscribe to a service",
    schema: z.object({
        address: z.string().describe("The address to subscribe to"),
        amount: z.number().positive().describe("The amount to pay for the subscription"),
    }),
    invoke: async (walletProvider, args: any) => {
        const { address, amount } = args;
        const res = await scheduleSubscriptionJob(address, amount);
        return `You have successfully subscribed to ${address} for ${amount} USDC`;
    },
});


/**
 * Initialize the agent with CDP AgentKit
 *
 * @returns Agent executor and config
 */
async function initializeAgent() {
  try {
    // Initialize LLM
    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    let walletDataStr: string | null = null;

    if (fs.existsSync(WALLET_DATA_FILE)) {
      try {
        walletDataStr = fs.readFileSync(WALLET_DATA_FILE, "utf8");
      } catch (error) {
        console.error("Error reading wallet data:", error);
      }
    }

    // Configure CDP Wallet Provider
    const config = {
      apiKeyName: process.env.CDP_API_KEY_NAME,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      cdpWalletData: walletDataStr || undefined,
      networkId: process.env.NETWORK_ID || "base-sepolia",
    };

    const account = privateKeyToAccount(process.env.PVT_KEY as `0x${string}`);

    const client = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(),
    });

    const walletProvider = new ViemWalletProvider(client);

    // Initialize AgentKit
    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        wethActionProvider(),
        pythActionProvider(),
        walletActionProvider(),
        erc20ActionProvider(),
        basenameActionProvider(),
        customSignMessage,
        customBridgingToken,
        customUSDCTransfer,
        customSubscriptionPrompt,
        cdpApiActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
        cdpWalletActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      ],
    });

    const tools = await getLangChainTools(agentkit);
    const memory = new MemorySaver();
    const agentConfig = { configurable: { thread_id: "CDP AgentKit Chatbot Example!" } };

    // Create React Agent using the LLM and CDP AgentKit tools.
    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memory,
      messageModifier: `
        You are a helpful agent that can interact onchain using the Coinbase Developer Platform AgentKit.
        You are connected to base-sepolia, eth-sepolia and arb-sepolia.
        You don't prompt the user for selecting a chain or token.
        You can send testnet USDC tokens on the testnets.
        you can also register basenames on base-sepolia.
        Once done, just respond with "txover".
      `,
    });

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

/**
 * Start an Express server that exposes a POST endpoint for prompts.
 */
async function startServer() {
  const { agent, config } = await initializeAgent();

  const app = express();
  app.use(express.json());
app.use(cors());

  // POST /prompt expects a JSON body { prompt: string }
  app.post("/prompt", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid prompt" });
    }
    try {
      let responseText = "";
      // Stream agent response
      const stream = await agent.stream({ messages: [new HumanMessage(prompt)] }, config);
      for await (const chunk of stream) {
        if ("agent" in chunk) {
          responseText += chunk.agent.messages[0].content;
        } else if ("tools" in chunk) {
          responseText += chunk.tools.messages[0].content;
        }
      }
      res.json({ response: responseText });
    } catch (error: any) {
      console.error("Error processing prompt:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/balance", async (req, res) => {
    const userAddress = req.query.address as string;
    if (!userAddress) {
      return res.status(400).json({ error: "Missing address query parameter" });
    }
    try {
      const balance = await getCollectiveUSDCBalance(userAddress);
      res.json({ balance: balance.toString() });
    } catch (error: any) {
      console.error("Error fetching balance:", error);
      res.status(500).json({ error: error.message });
    }
  })

  const port = process.env.PORT || 3060;
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

cron.schedule("0 * * * *", async () => {
    console.log(`[${new Date().toISOString()}] Running hourly ETH monitoring cron job...`);
    try {
      await monitorDepositsAndPrice();
    } catch (error) {
      console.error("Error in ETH monitoring cron job:", error);
    }
  });


async function main() {
  try {
    await startServer();
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
