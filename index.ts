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
import * as readline from "readline";
import { createWalletClient, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { z } from "zod";
import { processTransferPrompt } from "./bridge";
import { bridgeTokens } from "./cctp";
import { USDC_ADDRESS } from "./constants";
import { submitToNillion } from "./nillion/post";

dotenv.config();

/**
* Validates that required environment variables are set
*
* @throws {Error} - If required environment variables are missing
* @returns {void}
*/
function validateEnvironment(): void {
  const missingVars: string[] = [];

  // Check required variables
  const requiredVars = ["OPENAI_API_KEY", "CDP_API_KEY_NAME", "CDP_API_KEY_PRIVATE_KEY"];
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  // Exit if any required variables are missing
  if (missingVars.length > 0) {
    console.error("Error: Required environment variables are not set");
    missingVars.forEach(varName => {
      console.error(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }

  // Warn about optional NETWORK_ID
  if (!process.env.NETWORK_ID) {
    console.warn("Warning: NETWORK_ID not set, defaulting to base-sepolia testnet");
  }

  console.log("Environment variables are set correctly");
}

// Add this right after imports and before any other code
validateEnvironment();

// Configure a file to persist the agent's CDP MPC Wallet Data
const WALLET_DATA_FILE = "wallet_data.txt";

const customSignMessage = customActionProvider<EvmWalletProvider>({ // wallet types specify which providers can use this action. It can be as generic as WalletProvider or as specific as CdpWalletProvider
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

    return `The bridging token ${amount} USDC  in direction ${direction} has been generated`;
  },
})

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
      const erc20TransferABI = [
        {
          inputs: [
            {
              internalType: "address",
              name: "recipient",
              type: "address",
            },
            {
              internalType: "uint256",
              name: "amount",
              type: "uint256",
            },
          ],
          name: "transfer",
          outputs: [
            {
              internalType: "bool",
              name: "",
              type: "bool",
            },
          ],
          stateMutability: "nonpayable",
          type: "function",
        },
      ]
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
          {
            approvalAmount: BigInt(10000000000000),
          }
        );
      }
      const erc20TransferABI = [
        {
          inputs: [
            {
              internalType: "address",
              name: "recipient",
              type: "address",
            },
            {
              internalType: "uint256",
              name: "amount",
              type: "uint256",
            },
          ],
          name: "transfer",
          outputs: [
            {
              internalType: "bool",
              name: "",
              type: "bool",
            },
          ],
          stateMutability: "nonpayable",
          type: "function",
        },
      ]
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

const customETHToUSDC = customActionProvider<CdpWalletProvider>({
  name: "eth_to_usdc",
  description: "Convert ETH to USDC",
  schema: z.object({
    amount: z.number().positive().describe("The amount of ETH to convert"),
  }),
  invoke: async (walletProvider, args: any) => {
    const { amount } = args;
    return `The conversion of ${amount} ETH to USDC has been completed`;
  },
});



/**
 * Initialize the agent with CDP Agentkit
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

    // Read existing wallet data if available
    if (fs.existsSync(WALLET_DATA_FILE)) {
      try {
        walletDataStr = fs.readFileSync(WALLET_DATA_FILE, "utf8");
      } catch (error) {
        console.error("Error reading wallet data:", error);
        // Continue without wallet data
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

    // Store buffered conversation history in memory
    const memory = new MemorySaver();
    console.log(memory.storage);
    const agentConfig = { configurable: { thread_id: "CDP AgentKit Chatbot Example!" } };

    // Create React Agent using the LLM and CDP AgentKit tools
    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memory,
      messageModifier: `
          You are a helpful agent that can interact onchain using the Coinbase Developer Platform AgentKit. You are 
          empowered to interact onchain using your tools. you are connected to base-sepolia, eth-sepolia and arb-sepolia.
          you dont prompt the user for selecting chain or token
          you can send testnet USDC tokens on the testnets.
          you can also convert eth to USDC.
          once done just response with txover
          `,
    });

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error; // Re-throw to be handled by caller
  }
}

/**
 * Run the agent interactively based on user input
 */
async function runChatMode(agent: any, config: any) {
  console.log("Starting chat mode... Type 'exit' to end.");

  const userInput = "send 1 usdc to 0x49ae3cc2e3aa768b1e5654f5d3c6002144a59581";
  // const userInput = "Fund the wallet with enough eth to pay gas fees for basename registration";

  const stream = await agent.stream({ messages: [new HumanMessage(userInput)] }, config);

  for await (const chunk of stream) {
    if ("agent" in chunk) {
      console.log(chunk.agent.messages[0].content);
    } else if ("tools" in chunk) {
      console.log(chunk.tools.messages[0].content);
    }
    console.log("-------------------");
  }
}


async function main() {
  try {
    const { agent, config } = await initializeAgent();

    await runChatMode(agent, config);

    const stateData = [
      {
        timestamp: new Date().toISOString(),
        data: JSON.stringify(await agent.getState(config))
      }
    ]

    await submitToNillion(stateData);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
    process.exit(1);
  }
}

main();