import "dotenv/config";
import { ethers } from "ethers";
import fs from 'fs';
import path from 'path';
import Dinari from '@dinari/api-sdk';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const orderProcessorDataPath = path.resolve(__dirname, '../../lib/sbt-deployments/src/v0.4.0/order_processor.json');
const orderProcessorData = JSON.parse(fs.readFileSync(orderProcessorDataPath, 'utf8'));
const orderProcessorAbi = orderProcessorData.abi;
// token abi
const tokenAbi = [
    "function name() external view returns (string memory)",
    "function decimals() external view returns (uint8)",
    "function version() external view returns (string memory)",
    "function nonces(address owner) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
];


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
        {
            name: "owner",
            type: "address"
        },
        {
            name: "spender",
            type: "address"
        },
        {
            name: "value",
            type: "uint256"
        },
        {
            name: "nonce",
            type: "uint256"
        },
        {
            name: "deadline",
            type: "uint256"
        }
    ],
};

async function main() {

    // ------------------ Setup ------------------

    // setup values
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("empty key");
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) throw new Error("empty rpc url");
    const assetTokenAddress = process.env.ASSETTOKEN;
    if (!assetTokenAddress) throw new Error("empty asset token address");
    const paymentTokenAddress = process.env.PAYMENTTOKEN;
    if (!paymentTokenAddress) throw new Error("empty payment token address");


    // setup axios
    const dinariClient = new Dinari({
        apiKeyID: process.env.DINARI_API_KEY,
        apiSecretKey: process.env.DINARI_API_SECRET_KEY,
        environment: 'sandbox',
    });

    // setup provider and signer
    const provider = ethers.getDefaultProvider(RPC_URL);
    const signer = new ethers.Wallet(privateKey, provider);
    console.log(`Signer Address: ${signer.address}`);
    const chainId = Number((await provider.getNetwork()).chainId);
    const orderProcessorAddress = orderProcessorData.networkAddresses[chainId];
    console.log(`Order Processor Address: ${orderProcessorAddress}`);

    // connect signer to payment token contract
    const paymentToken = new ethers.Contract(
        paymentTokenAddress,
        tokenAbi,
        signer,
    );

    // connect signer to asset token contract
    const assetToken = new ethers.Contract(
        assetTokenAddress,
        tokenAbi,
        signer,
    );

    // connect signer to buy processor contract
    const orderProcessor = new ethers.Contract(
        orderProcessorAddress,
        orderProcessorAbi,
        signer,
    );

    // ------------------ Configure Order ------------------

    // order amount (100 USDC)
    const orderAmount = BigInt("1000000000");
    // buy order (Change to true for Sell Order)
    const sellOrder = true;
    // market order
    const orderType = Number(0);

    // applicable to sell orders only
    if (sellOrder) {
        const allowedDecimalReduction = await orderProcessor.orderDecimalReduction(assetTokenAddress);
        const allowablePrecisionReduction = 10 ** allowedDecimalReduction;
        if (Number(orderAmount) % allowablePrecisionReduction != 0) {
            const assetTokenDecimals = await assetToken.decimals();
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
        assetTokenQuantity: orderAmount, // Asset amount to sell. Ignored for buys. Fees will be taken from proceeds for sells.
        paymentTokenQuantity: 0, // Payment amount to spend. Ignored for sells. Fees will be added to this amount for buys.
        price: 0, // Unused limit price
        tif: 1, // GTC
    };

    const _order = {
        chain_id: 'eip155:11155111',
        order_side: 'SELL',
        order_tif: 'DAY',
        order_type: 'MARKET',
        stock_id: "0196ea6d-b6de-70d5-ae41-9525959ef309",
        payment_token: orderParams.paymentToken,
        asset_token_quantity: orderAmount.toString()
    };

    const accountId = "019814c3-64d2-7611-a4b7-dcc7c068f6ea";
    const feeQuoteResponse = await dinariClient.v2.accounts.orders.stocks.eip155.getFeeQuote(accountId, _order);
    console.log(feeQuoteResponse, "response")
    const fees = BigInt(feeQuoteResponse.order_fee_contract_object.fee_quote.fee);
    console.log(`fees: ${ethers.utils.formatUnits(fees, 6)}`);

    // ------------------ Approve Spend ------------------
    const multiCallBytes: string[] = [];
    const nonce = await assetToken.nonces(signer.address);
    // 5 minute deadline from current blocktime
    const blockNumber = await provider.getBlockNumber();
    const blockTime = (await provider.getBlock(blockNumber))?.timestamp;
    if (!blockTime) throw new Error("no block time");
    const deadline = blockTime + 60 * 5;

    const balance = await assetToken.balanceOf(signer.address);
    console.log(`Asset Token Balance: ${ethers.utils.formatUnits(balance, await assetToken.decimals())}`);

    const permitDomain = {
        name: await assetToken.name(),
        version: await getContractVersion(assetToken),
        chainId: (await provider.getNetwork()).chainId,
        verifyingContract: assetTokenAddress,
    };

    const permitMessage = {
        owner: signer.address,
        spender: orderProcessorAddress,
        value: orderAmount,
        nonce: nonce,
        deadline: deadline
    };

    const permitSignatureBytes = await signer._signTypedData(permitDomain, permitTypes, permitMessage);
    const permitSignature = ethers.utils.splitSignature(permitSignatureBytes);

    // create selfPermit call data
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

    console.log(selfPermitData, "selfPermitData");

    // ------------------ Submit Order ------------------

    // submit request order transaction
    // see IOrderProcessor.Order struct for order parameters
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
    const tx = await orderProcessor.multicall(multiCallBytes);
    const receipt = await tx.wait();
    console.log(`tx hash: ${tx.hash}`);
  
    // get order id from event
    const orderEvent = receipt.logs.filter((log: any) => log.topics[0] === orderProcessor.interface.getEventTopic("OrderCreated")).map((log: any) => orderProcessor.interface.parseLog(log))[0];
    if (!orderEvent) throw new Error("no order event");
    const orderId = orderEvent.args[0];
    const orderAccount = orderEvent.args[1];
    console.log(`Order ID: ${orderId}`);
    console.log(`Order Account: ${orderAccount}`);
    const orderStatus = await orderProcessor.getOrderStatus(orderId);
    console.log(`Order Status: ${orderStatus}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });