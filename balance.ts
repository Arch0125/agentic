// balance.ts
import { createPublicClient, http } from "viem";
import { sepolia, arbitrumSepolia, baseSepolia } from "viem/chains";

// USDC contract addresses on each chain
export const USDC_ADDRESS = {
  sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  arb: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  base: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// Minimal ERC-20 ABI (only balanceOf is required)
const USDC_ABI = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
];

// Chain configurations with RPC endpoints and chain objects.
// Replace the RPC URLs below with your valid endpoints.
const chainConfigs: { [key: string]: { chain: any; rpc: string } } = {
  sepolia: {
    chain: sepolia,
    rpc: "https://eth-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML",
  },
  arb: {
    chain: arbitrumSepolia,
    rpc: "https://arb-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML",
  },
  base: {
    chain: baseSepolia,
    rpc: "https://base-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML",
  },
};

/**
 * Retrieves the USDC balance for the given address on one chain.
 * @param chainKey - Key for the chain (e.g., "sepolia", "arb", "base")
 * @param userAddress - The address whose balance will be checked.
 * @returns A Promise that resolves to the USDC balance (as a BigInt).
 */
async function getBalanceForChain(
  chainKey: string,
  userAddress: string
): Promise<bigint> {
  const { chain, rpc } = chainConfigs[chainKey];
  const client = createPublicClient({
    chain,
    transport: http(rpc),
  });

  try {
    const balance: bigint = await client.readContract({
      address: USDC_ADDRESS[chainKey] as `0x${string}`,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    });
    console.log(`${chainKey} balance: ${balance}`);
    return balance;
  } catch (err) {
    console.error(`Error fetching balance on ${chainKey}:`, err);
    return 0n;
  }
}

/**
 * Retrieves and sums up the USDC balance for the given address across all configured chains.
 * @param userAddress - The address to check.
 * @returns A Promise that resolves to the collective USDC balance (as a BigInt).
 */
async function getCollectiveUSDCBalance(userAddress: string): Promise<bigint> {
  const chainKeys = Object.keys(chainConfigs);
  let totalBalance: bigint = 0n;

  for (const key of chainKeys) {
    const balance = await getBalanceForChain(key, userAddress);
    totalBalance += balance;
  }

  return totalBalance;
}

// Example usage
async function main() {
  // Replace with the address you want to query
  const userAddress = "0x1547ffb043f7c5bde7baf3a03d1342ccd8211a28";
  const totalBalance = await getCollectiveUSDCBalance(userAddress);
  console.log(`Total USDC balance across chains: ${(Number(totalBalance)/1e6).toString()}`);
}

main().catch((error) => {
  console.error("Error in main:", error);
});
