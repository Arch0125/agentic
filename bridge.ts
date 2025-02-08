import { createPublicClient, http, type PublicClient } from "viem";
import Configuration, { OpenAI } from "openai";
import { arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";

// --- USDC ABI (only the balanceOf function is needed) ---
const USDC_ABI = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
];

// --- Type Definitions ---
interface ChainConfig {
  name: any;
  rpc: string;
  chainId: number;
  usdcAddress: string;
}

interface ChainData {
  chainName: string;
  usdcBalance: bigint; // USDC smallest units (6 decimals)
  gasPrice: bigint;
}

interface BridgingInstruction {
  amount: string; // expressed in whole USDC (e.g. "10")
  direction: string; // e.g. "arb-sepoliaTobase-sepolia"
}

interface ProcessTransferPromptResult {
    formattedInstructions: BridgingInstruction[];
    destinationChain: string;
}

// --- Chain Configuration ---
// Replace the RPC endpoints, chain IDs, and USDC contract addresses with real values.
const chainConfigs: { [key: string]: ChainConfig } = {
  "arb": {
    name: arbitrumSepolia,
    rpc: "https://arb-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML",
    chainId: 421613,
    usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  },
  "sepolia": {
    name: sepolia,
    rpc: "https://eth-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML",
    chainId: 11155111,
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  "base": {
    name: baseSepolia,
    rpc: "https://base-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML",
    chainId: 8453,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Uses ChatGPT to decode a prompt of the form:
 *   send "100 usdc to <destinationAddress>"
 * into a JSON object containing the numeric amount and the destination address.
 */
async function decodePrompt(
  prompt: string
): Promise<{ amount: number; destinationAddress: string }> {
  const messages = [
    {
      role: "system",
      content:
        'You are an assistant that extracts transfer instructions from a user prompt. The prompt is in the format: send "<amount> usdc to <destinationAddress>". Return only valid JSON in the format: {"amount": number, "destinationAddress": string}.',
    },
    { role: "user", content: prompt },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages,
  });

  const completion = response.choices[0].message.content;
  if (!completion) {
    throw new Error("No completion returned by OpenAI.");
  }
  try {
    const parsed = JSON.parse(completion);
    return parsed;
  } catch (err) {
    throw new Error("Failed to parse JSON from OpenAI response: " + completion);
  }
}

/**
 * Uses ChatGPT to format an array of bridging instructions.
 * (This is just to satisfy the requirement to use ChatGPT SDK for generating the JSON.)
 */
async function generateJsonOutput(
  instructions: BridgingInstruction[]
): Promise<BridgingInstruction[]> {
  const messages = [
    {
      role: "system",
      content:
        'You are a helpful assistant that formats bridging instructions into JSON. The instructions are provided as an array of objects. Format the output exactly as a JSON array of objects with the keys "amount" and "direction".',
    },
    {
      role: "user",
      content: `Please format the following instructions: ${JSON.stringify(instructions)}`,
    },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages,
  });

  const completion = response.choices[0].message.content;
  if (!completion) {
    throw new Error("No completion returned by OpenAI for JSON formatting.");
  }
  try {
    const parsed = JSON.parse(completion);
    return parsed;
  } catch (err) {
    console.error("Failed to parse formatted JSON. Returning original instructions.", err);
    return instructions;
  }
}

/**
 * Main function that:
 * 1. Uses ChatGPT to decode the transfer prompt.
 * 2. Fetches USDC balances and current gas prices from three chains.
 * 3. Determines the destination chain (with the lowest gas fees).
 * 4. If the destination chain does not hold enough USDC, computes bridging instructions from other chains.
 * 5. Uses ChatGPT to format the final JSON instructions.
 *
 * The final output is an array of objects such as:
 *   [{"amount": "10", "direction": "arb-sepoliaTobase-sepolia"}]
 */
export async function processTransferPrompt(
  prompt: string,
  sourceAddress: string
): Promise<ProcessTransferPromptResult> {
  // Step 1: Decode the prompt.
  const decoded = await decodePrompt(prompt);
  // Convert the amount to send to USDC's smallest units (6 decimals)
  const amountToSend = BigInt(decoded.amount) * 1_000_000n;

  // Step 2: Create a viem client for each chain using the chain configs.
  const clients: { [chainName: string]: PublicClient } = {};
  for (const chainKey in chainConfigs) {
    const config = chainConfigs[chainKey];
    clients[chainKey] = createPublicClient({
      chain: config.name,
      transport: http(config.rpc),
    });
  }

  // Step 3: Fetch on-chain data: USDC balance and current gas price.
  const chainData: ChainData[] = [];
  for (const chainKey in chainConfigs) {
    const config = chainConfigs[chainKey];
    const client = clients[chainKey];

    // Fetch USDC balance using the ERC-20 balanceOf call.
    let usdcBalance: bigint = 0n;
    try {
      usdcBalance = await client.readContract({
        address: config.usdcAddress as `0x${string}`,
        abi: USDC_ABI,
        functionName: "balanceOf",
        args: [sourceAddress],
      });
    } catch (err) {
      console.error(`Error fetching USDC balance on ${chainKey}:`, err);
    }

    // Fetch the current gas price.
    let gasPrice: bigint = 0n;
    try {
      gasPrice = await client.getGasPrice();
    } catch (err) {
      console.error(`Error fetching gas price on ${chainKey}:`, err);
    }

    chainData.push({
      chainName: chainKey,
      usdcBalance,
      gasPrice,
    });
  }

  // Step 4: Determine the destination chain (the one with the lowest gas fees).
  chainData.sort((a, b) => Number(a.gasPrice - b.gasPrice));
  const destinationChain = chainData[0].chainName;
  console.log("Chosen destination chain (lowest gas fees):", destinationChain);

  // Step 5: Check if the destination chain has enough USDC.
  const destChainData = chainData.find((data) => data.chainName === destinationChain);
  if (!destChainData) {
    throw new Error("Could not determine data for the destination chain.");
  }

  console.log(
    "Destination USDC balance (in USDC):",
    Number(destChainData.usdcBalance) / 1_000_000
  );
  console.log("Amount to send (in USDC):", decoded.amount);

  const bridgingInstructions: BridgingInstruction[] = [];
  if (destChainData.usdcBalance >= amountToSend) {
    console.log(chainData)
    console.log("Sufficient USDC is available on the destination chain. No bridging required.");
    return {formattedInstructions:bridgingInstructions, destinationChain};
  }

  // Calculate the remaining amount needed (in smallest units).
  let remaining = amountToSend - destChainData.usdcBalance;

  // Step 6: Create bridging instructions from the other chains.
  // Filter out the destination chain and sort candidates by available USDC (descending).
  const bridgingCandidates = chainData
    .filter((data) => data.chainName !== destinationChain)
    .sort((a, b) => Number(b.usdcBalance - a.usdcBalance));

  for (const candidate of bridgingCandidates) {
    if (remaining <= 0n) break;
    if (candidate.usdcBalance > 0n) {
      const amountToBridge =
        candidate.usdcBalance < remaining ? candidate.usdcBalance : remaining;
      remaining -= amountToBridge;

      bridgingInstructions.push({
        amount: (Number(amountToBridge / 1_000_000n)+1).toString(),
        direction: `${candidate.chainName}To${destinationChain.charAt(0).toUpperCase() + destinationChain.slice(1)}`,
      });
    }
  }

  if (remaining > 0n) {
    throw new Error("Insufficient USDC balance across all chains to complete the transfer.");
  }

  // Step 7: Use ChatGPT to format the final JSON instructions.
  const formattedInstructions = await generateJsonOutput(bridgingInstructions);
  console.log(chainData)
  return {formattedInstructions, destinationChain};
}