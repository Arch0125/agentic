import { createWalletClient, createPublicClient, http, padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";
import { writeContract, waitForTransactionReceipt, getTransactionReceipt } from "viem/actions";
import { MessageTransmitterABI, TokenMessengerABI } from "./abi";
import { ethers } from "ethers";

// --- ABI for the ERC-20 approve function ---
const approveABI = [
    {
        constant: false,
        inputs: [
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        payable: false,
        stateMutability: "nonpayable",
        type: "function",
    },
];

// --- Some constant addresses ---
// (Assuming the same message transmitter is deployed on both chains.)
const MESSAGE_TRANSMITTER_ADDRESS = "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD";
// This is the event topic (the keccak256 hash of the event signature) for the deposit event.
const DEPOSIT_EVENT_TOPIC =
    "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";

// --- Types and configuration ---
interface BridgeConfig {
    source: {
        chain: typeof sepolia; // using the chain objects from viem/chains
        tokenAddress: string;
        tokenMessenger: string;
        // depositChainId is the parameter passed to depositForBurn (e.g. an enum)
        depositChainId?: number;
        rpc: string;
    };
    destination: {
        chain: typeof sepolia;
        messageTransmitter: string;
        rpc: string;
    };
}

// Two simple configurations for bridging in either direction. (Adjust addresses as needed.)
const bridgeConfigs: Record<"baseToSepolia" | "sepoliaToBase" | "arbToBase" | "baseToArb", BridgeConfig> = {
    baseToSepolia: {
        source: {
            chain: baseSepolia,
            tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
            depositChainId: 0,
            rpc: "https://base-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML"
        },
        destination: {
            chain: sepolia,
            messageTransmitter: MESSAGE_TRANSMITTER_ADDRESS,
            rpc: "https://eth-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML"
        },
    },
    sepoliaToBase: {
        source: {
            chain: sepolia,
            tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
            tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
            depositChainId: 6, // adjust if necessary
            rpc: "https://eth-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML"
        },
        destination: {
            chain: baseSepolia,
            messageTransmitter: MESSAGE_TRANSMITTER_ADDRESS,
            rpc: "https://base-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML"
        },
    },
    arbToBase: {
        source: {
            chain: arbitrumSepolia,
            tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
            tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
            depositChainId: 6,
            rpc: "https://arb-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML"
        },
        destination: {
            chain: baseSepolia,
            messageTransmitter: MESSAGE_TRANSMITTER_ADDRESS,
            rpc: "https://base-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML"
        },
    },
    baseToArb: {
        source: {
            chain: baseSepolia,
            tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
            depositChainId: 3,
            rpc: "https://base-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML"
        },
        destination: {
            chain: arbitrumSepolia,
            messageTransmitter: "0xaCF1ceeF35caAc005e15888dDb8A3515C41B4872",
            rpc: "https://arb-sepolia.g.alchemy.com/v2/0fxbpb4OCXkkyHhFNPBRelJsFg7XdhML"
        },
    },
};

// --- Helper function to create wallet and public clients for a given chain ---
function createClients(account: any, chain: any, rpc: string) {
    const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpc),
    });
    const publicClient = createPublicClient({
        chain,
        transport: http(rpc),
    });
    return { walletClient, publicClient };
}

// --- Helper function to poll the Circle API for attestation ---
async function pollAttestation(messageHash: string): Promise<any> {
    let attestationResponse = { status: "pending" };
    while (attestationResponse.status !== "complete") {
        const response = await fetch(
            `https://iris-api-sandbox.circle.com/attestations/${messageHash}`
        );
        attestationResponse = await response.json();
        if (attestationResponse.status !== "complete") {
            // Wait 2 seconds before trying again.
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    return attestationResponse;
}

// --- Options for bridging ---
export interface BridgeOptions {
    // Optionally override the destination address (the recipient on the target chain).
    destinationAddress?: string;
    // Optionally override the approval amount (often you might want to approve more than the deposit amount).
    approvalAmount?: bigint;
}

/**
 * bridgeTokens bridges tokens between chains in either direction.
 *
 * @param direction - Either "baseToSepolia" or "sepoliaToBase"
 * @param depositAmount - The amount to bridge (should be specified as a bigint).
 * @param privateKey - Your private key.
 * @param options - Optional parameters (destinationAddress and/or approvalAmount).
 *
 * The function will:
 *  1. Approve the token messenger on the source chain to spend your tokens.
 *  2. Call depositForBurn on the token messenger (which emits an event with the message bytes).
 *  3. Parse the transaction receipt to extract the message bytes and compute its hash.
 *  4. Poll Circle’s API for the attestation corresponding to that hash.
 *  5. Finally, call receiveMessage on the destination chain to complete the bridge.
 */
export async function bridgeTokens(
    direction: "baseToSepolia" | "sepoliaToBase" | "arbToBase" | "baseToArb",
    depositAmount: bigint,
    privateKey: string,
    options?: BridgeOptions
) {
    const account = privateKeyToAccount(privateKey);
    const config = bridgeConfigs[direction];
    if (!config) {
        throw new Error(`Unsupported bridge direction: ${direction}`);
    }

    // Use the provided approvalAmount (if any) or default to the depositAmount.
    const approvalAmount = options?.approvalAmount || depositAmount;
    // The recipient address on the destination chain (defaults to the same account).
    const destinationAddress = options?.destinationAddress || account.address;

    // Create clients for both source and destination chains.
    const { walletClient: sourceWallet, publicClient: sourcePublic } = createClients(
        account,
        config.source.chain,
        config.source.rpc
    );
    const { walletClient: destWallet, publicClient: destPublic } = createClients(
        account,
        config.destination.chain,
        config.destination.rpc
    );

    // --- Step 1. Approve the token messenger to spend tokens on the source chain ---
    console.log("Approving tokens on source chain...");
    let txHash = await sourceWallet.writeContract({
        address: config.source.tokenAddress,
        functionName: "approve",
        args: [config.source.tokenMessenger, approvalAmount],
        abi: approveABI,
    });
    await sourcePublic.waitForTransactionReceipt({ hash: txHash });
    console.log(`Approval transaction confirmed: ${txHash}`);

    // --- Step 2. Call depositForBurn on the token messenger contract on the source chain ---
    // The depositForBurn call requires the recipient address to be padded.
    const paddedRecipient = padHex(destinationAddress, { dir: "left", size: 32 });
    console.log("Depositing for burn on source chain...");
    txHash = await sourceWallet.writeContract({
        address: config.source.tokenMessenger,
        functionName: "depositForBurn",
        args: [
            depositAmount,
            config.source.depositChainId ?? 0,
            paddedRecipient,
            config.source.tokenAddress,
        ],
        abi: TokenMessengerABI,
    });
    await sourcePublic.waitForTransactionReceipt({ hash: txHash });
    console.log(`Deposit transaction confirmed: ${txHash}`);

    // --- Step 3. Retrieve the message bytes from the deposit event ---
    const txReceipt = await sourcePublic.getTransactionReceipt({ hash: txHash });
    const depositLog = txReceipt.logs.find((log) => log.topics[0] === DEPOSIT_EVENT_TOPIC);
    if (!depositLog) {
        throw new Error("Deposit event not found in transaction logs");
    }
    // Decode the event data (which is expected to be a single bytes value)
    const decoded = new ethers.AbiCoder().decode(["bytes"], depositLog.data);
    const messageBytes = decoded[0];
    console.log(`Message bytes: ${messageBytes}`);

    // --- Step 4. Compute the message hash ---
    const messageHash = ethers.keccak256(messageBytes);
    console.log(`Message hash: ${messageHash}`);

    // --- Step 5. Poll Circle API for the attestation ---
    console.log("Polling attestation from Circle API...");
    const attestationResponse = await pollAttestation(messageHash);
    console.log("Attestation received:", attestationResponse);

    // --- Step 6. Submit the message and attestation on the destination chain ---
    console.log("Submitting message on destination chain...");
    txHash = await destWallet.writeContract({
        address: config.destination.messageTransmitter,
        functionName: "receiveMessage",
        args: [messageBytes, attestationResponse.attestation],
        abi: MessageTransmitterABI,
    });
    await destPublic.waitForTransactionReceipt({ hash: txHash });
    console.log(`Receive message transaction confirmed: ${txHash}`);

    console.log("Bridge transaction complete");
    return txHash;
}
