import "dotenv/config";
import { BigNumber, ethers } from "ethers";
import fs from 'fs';
import path from 'path';
import Dinari from '@dinari/api-sdk';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const orderProcessorDataPath = path.resolve(__dirname, '../../lib/sbt-deployments/src/v0.4.0/order_processor.json');
const orderProcessorData = JSON.parse(fs.readFileSync(orderProcessorDataPath, 'utf8'));
const orderProcessorAbi = orderProcessorData.abi;

const tokenAbi = [
    "function name() external view returns (string memory)",
    "function decimals() external view returns (uint8)",
    "function version() external view returns (string memory)",
    "function nonces(address owner) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
];

const allSettledOrders = [];

const cratesPath = path.resolve(__dirname, "crates.json");
const crates = JSON.parse(fs.readFileSync(cratesPath, "utf8"));
console.log(`Found ${crates.length} crates to process.`);

async function getContractVersion(contract: ethers.Contract): Promise<string> {
    let contractVersion = '1';
    try {
        contractVersion = await contract.version();
    } catch {
        // do nothing
    }
    return contractVersion;
}

const permitTypes = {
    Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
    ],
};

async function main() {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("empty key");
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) throw new Error("empty rpc url");
    const paymentTokenAddress = process.env.PAYMENTTOKEN;
    if (!paymentTokenAddress) throw new Error("empty payment token address");

  

    const dinariClient = new Dinari({
        apiKeyID: process.env.DINARI_API_KEY,
        apiSecretKey: process.env.DINARI_API_SECRET_KEY,
        environment: 'sandbox',
    });

    const provider = ethers.getDefaultProvider(RPC_URL);
    const signer = new ethers.Wallet(privateKey, provider);
    console.log(`Signer Address: ${signer.address}`);

    const chainId = Number((await provider.getNetwork()).chainId);
    const orderProcessorAddress = orderProcessorData.networkAddresses[chainId];
    console.log(`Order Processor Address: ${orderProcessorAddress}`);

    const orderProcessor = new ethers.Contract(orderProcessorAddress, orderProcessorAbi, signer);

    const multiCallBytes: string[] = [];

    for (const crate of crates) {
        console.log(`\n📦 Processing crate: ${crate.stockId}`);

        const assetTokenAddress = crate.share;
        const assetToken = new ethers.Contract(assetTokenAddress, tokenAbi, signer);
        const orderAmount = ethers.utils.parseUnits(crate.minShares.toString(), await assetToken.decimals());
        console.log(`Order Amount: ${orderAmount}tokens`);

        const userBalance = await assetToken.balanceOf(await signer.getAddress());
        console.log(`User Balance: ${userBalance.toString()} tokens`);

        if (userBalance.lt(orderAmount)) {
            console.log(`⏩ Skipping crate ${crate.stockId} (Not enough balance)`);
            continue;
        }

        const sellOrder = true;
        const orderType = 0;
        let actualAmount = BigNumber.from(orderAmount);
        if (sellOrder) {
            const allowedDecimalReduction = await orderProcessor.orderDecimalReduction(assetTokenAddress);
            const allowablePrecisionReduction = 10 ** allowedDecimalReduction;
            const assetTokenDecimals = await assetToken.decimals();
            const maxDecimals = assetTokenDecimals - allowedDecimalReduction;
            console.log(`Max Decimals Allowed for Order Amount: ${maxDecimals}`);
            const scale = BigNumber.from(10).pow(assetTokenDecimals - allowedDecimalReduction);
            actualAmount = actualAmount.div(scale).mul(scale);

            console.log(`Adjusted Order Amount: ${actualAmount} tokens`);

            if (Number(actualAmount) % allowablePrecisionReduction != 0) {
                const assetTokenDecimals = await assetToken.decimals();
                console.log(`Asset Token Decimals: ${assetTokenDecimals}`);
                const maxDecimals = assetTokenDecimals - allowedDecimalReduction;
                throw new Error(`Order amount precision exceeds max decimals of ${maxDecimals}`);
            }
        }

        const orderParams = {
            requestTimestamp: Date.now(),
            recipient: signer.address,
            assetToken: assetTokenAddress,
            paymentToken: paymentTokenAddress,
            sell: sellOrder,
            orderType: orderType,
            assetTokenQuantity: actualAmount,
            paymentTokenQuantity: 0,
            price: 0,
            tif: 1,
        };

        const _order = {
            chain_id: `eip155:11155111`,
            order_side: 'SELL',
            order_tif: 'DAY',
            order_type: 'MARKET',
            stock_id: crate.stockId,
            payment_token: orderParams.paymentToken,
            asset_token_quantity: actualAmount.toString()
        };

        const accountId = "019814c3-64d2-7611-a4b7-dcc7c068f6ea";
        const feeQuoteResponse = await dinariClient.v2.accounts.orders.stocks.eip155.getFeeQuote(accountId, _order);
        const fees = BigInt(feeQuoteResponse.order_fee_contract_object.fee_quote.fee);
        console.log(`💰 Fee: ${ethers.utils.formatUnits(fees, 6)} USDC`);

        const nonce = await assetToken.nonces(signer.address);
        const blockNumber = await provider.getBlockNumber();
        const blockTime = (await provider.getBlock(blockNumber))?.timestamp;
        if (!blockTime) throw new Error("no block time");
        const deadline = blockTime + 60 * 5;

        const balance = await assetToken.balanceOf(signer.address);
        console.log(`Asset Token Balance: ${ethers.utils.formatUnits(balance, await assetToken.decimals())}`);

        const permitDomain = {
            name: await assetToken.name(),
            version: await getContractVersion(assetToken),
            chainId: chainId,
            verifyingContract: assetTokenAddress,
        };

        const permitMessage = {
            owner: signer.address,
            spender: orderProcessorAddress,
            value: actualAmount,
            nonce: nonce,
            deadline: deadline
        };

        const permitSignatureBytes = await signer._signTypedData(permitDomain, permitTypes, permitMessage);
        const permitSignature = ethers.utils.splitSignature(permitSignatureBytes);

        const selfPermitData = orderProcessor.interface.encodeFunctionData("selfPermit", [
            assetTokenAddress,
            permitMessage.owner,
            permitMessage.value,
            permitMessage.deadline,
            permitSignature.v,
            permitSignature.r,
            permitSignature.s
        ]);

        multiCallBytes.push(selfPermitData);

        const requestOrderData = orderProcessor.interface.encodeFunctionData("createOrder", [[
            orderParams.requestTimestamp,
            orderParams.recipient,
            orderParams.assetToken,
            orderParams.paymentToken,
            orderParams.sell,
            orderParams.orderType,
            orderParams.assetTokenQuantity,
            orderParams.paymentTokenQuantity,
            orderParams.price,
            orderParams.tif,
        ], [
            feeQuoteResponse.order_fee_contract_object.fee_quote.orderId,
            feeQuoteResponse.order_fee_contract_object.fee_quote.requester,
            feeQuoteResponse.order_fee_contract_object.fee_quote.fee,
            feeQuoteResponse.order_fee_contract_object.fee_quote.timestamp,
            feeQuoteResponse.order_fee_contract_object.fee_quote.deadline,
        ], feeQuoteResponse.order_fee_contract_object.fee_quote_signature]);

        multiCallBytes.push(requestOrderData);

        allSettledOrders.push({
            stockId: crate.stockId,
            minShares: ethers.utils.formatUnits(orderAmount, await assetToken.decimals()),
        });
    }

    if (multiCallBytes.length === 0) {
        console.log("⚠️ No orders to submit.");
        return;
    }

    console.log(`\n📤 Submitting multicall with ${multiCallBytes.length / 2} orders...`);
    const tx = await orderProcessor.multicall(multiCallBytes);
    const receipt = await tx.wait();
    console.log(`✅ tx hash: ${tx.hash}`);
    const _cratesPath = path.resolve(__dirname, "crates.json");
    const _crates = JSON.parse(fs.readFileSync(_cratesPath, "utf8"));
    
    console.log("\nUpdating crates.json with new minShares values...",{allSettledOrders});
    for (const order of allSettledOrders) {
      const crate = _crates.find(c => c.stockId === order.stockId);
      if (crate) {
        // Subtract the minShares value (ensure it doesn't go negative)
        crate.minShares = Math.max(
          0,
          (parseFloat(crate.minShares) || 0) - parseFloat(order.minShares)
        );
      }
    }
    
    // ✅ write back to file
    fs.writeFileSync(_cratesPath, JSON.stringify(_crates, null, 2), "utf8");
    console.log("✅ Updated crates.json");
    console.log("\n🎉 All done!");    

}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
