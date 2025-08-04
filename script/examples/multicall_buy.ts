import "dotenv/config";
import { ethers } from "ethers";
import fs from 'fs';
import path from 'path';
import Dinari from '@dinari/api-sdk';
import { fileURLToPath } from 'url';
const assets = [
  {
    stockId: "0196ea6d-b6de-70d5-ae41-9525959ef309",
    assetAddress: "0xD771a71E5bb303da787b4ba2ce559e39dc6eD85c",
    weightage: 40,
  },
  {
    stockId: "0196ea6d-b6ed-716d-a541-4c36bd32e84a",
    assetAddress: "0x7B58f454c36Edc0FBDEDfA8E0D4392A1a4c0b96c",
    weightage: 40,
  },
  {
    stockId: "0196ea6d-b6f6-7025-867a-b1fc580ea1a0",
    assetAddress: "0xdc2C5910d367f62F2F3234C9eaa5Afb12948Ef01",
    weightage: 20,
  },
];
async function createWeightedOrders(
  accountId: string,
  totalDepositAmount: number,
  paymentTokenAddress: string,
  signerAddress: string,
  orderType: number = 0,
  tif: number = 1
) {
  const dinariClient = new Dinari({
    apiKeyID: process.env.DINARI_API_KEY,
    apiSecretKey: process.env.DINARI_API_SECRET_KEY,
    environment: 'sandbox',
  });

  const totalWeight = assets.reduce((sum, asset) => sum + asset.weightage, 0);

  const orders = [];
  let totalOrderAmount = BigInt(0);
  let totalFees = BigInt(0);
  for (const asset of assets) {
    const rawAmount = (asset.weightage / totalWeight) * totalDepositAmount;
    const paymentTokenQuantity = rawAmount.toString();
    const formattedQuantity = ethers.utils.formatUnits(paymentTokenQuantity, 6);

    console.log(` ${formattedQuantity} : paymentTokenQuantity : ${paymentTokenQuantity}`);
    const _order = {
      chain_id: 'eip155:11155111',
      order_side: 'BUY',
      order_tif: 'DAY',
      order_type: 'MARKET',
      stock_id: asset.stockId,
      payment_token: paymentTokenAddress,
      payment_token_quantity: formattedQuantity.toString(),
    };

    const orderParams = {
      requestTimestamp: Date.now(),
      recipient: signerAddress,
      assetToken: asset.assetAddress,
      paymentToken: paymentTokenAddress,
      sell: false,
      orderType: orderType,
      assetTokenQuantity: 0,
      paymentTokenQuantity: paymentTokenQuantity,
      price: 0,
      tif: tif,
    };

    const feeQuoteResponse = await dinariClient.v2.accounts.orders.stocks.eip155.getFeeQuote(accountId, _order);

    const orderFee = BigInt(feeQuoteResponse.order_fee_contract_object.fee_quote.fee);
    
    totalOrderAmount += BigInt(paymentTokenQuantity);
    totalFees += orderFee;

    orders.push({
      _order,
      orderParams,
      feeQuoteResponse,
      orderFee,
    });
  }

  const totalSpendAmount = totalOrderAmount + totalFees;
  console.log({
    orders,
    totalOrderAmount: totalOrderAmount.toString(),
    totalFees: totalFees.toString(),
    totalSpendAmount: totalSpendAmount.toString(),
  });
  return {
    orders,
    totalOrderAmount: totalOrderAmount.toString(),
    totalFees: totalFees.toString(),
    totalSpendAmount: totalSpendAmount.toString(),
  };
}
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

async function main() {

  // ------------------ Setup ------------------

  // permit EIP712 signature data type
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

  // setup values
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("empty key");
  const RPC_URL = process.env.RPC_URL;
  if (!RPC_URL) throw new Error("empty rpc url");
  const assetTokenAddress = process.env.ASSETTOKEN;
  if (!assetTokenAddress) throw new Error("empty asset token address");
  const paymentTokenAddress = process.env.PAYMENTTOKEN;
  if (!paymentTokenAddress) throw new Error("empty payment token address");
  const dinariApiKey = process.env.DINARI_API_SECRET_KEY;
  if (!dinariApiKey) throw new Error("empty dinari api key");

  // setup axios
  const dinariClient = new Dinari({
    apiKeyID: process.env.DINARI_API_KEY,
    apiSecretKey: process.env.DINARI_API_SECRET_KEY,
    environment: 'sandbox',
  });

  console.log(dinariClient, "dinariClient")

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


  // connect signer to buy processor contract
  const orderProcessor = new ethers.Contract(
    orderProcessorAddress,
    orderProcessorAbi,
    signer,
  );
  // console.log(orderProcessor.functions,"functions")
  
  // ------------------ Configure Order ------------------
  const totalDepositAmount = ethers.utils.parseUnits("13", 6);
  console.log(`Total Deposit Amount: ${totalDepositAmount.toString()}`);
  const executedOrders = await createWeightedOrders(
    "019814c3-64d2-7611-a4b7-dcc7c068f6ea",
    Number(totalDepositAmount),
    "0x665b099132d79739462DfDe6874126AFe840F7a3",
    "0xdAF0182De86F904918Db8d07c7340A1EfcDF8244"
  );

  const multiCallBytes: string[] = [];
  const nonce = await paymentToken.nonces(signer.address);
  // // 5 minute deadline from current blocktime
  const blockNumber = await provider.getBlockNumber();
  const blockTime = (await provider.getBlock(blockNumber))?.timestamp;
  if (!blockTime) throw new Error("no block time");
  const deadline = blockTime + 60 * 5;
  const permitDomain = {
    name: await paymentToken.name(),
    version: await getContractVersion(paymentToken),
    chainId: (await provider.getNetwork()).chainId,
    verifyingContract: paymentTokenAddress,
  };

  const permitMessage = {
    owner: signer.address,
    spender: orderProcessorAddress,
    value: executedOrders.totalSpendAmount,
    nonce: nonce,
    deadline: deadline
  };

  const permitSignatureBytes = await signer._signTypedData(permitDomain, permitTypes, permitMessage);
  const permitSignature = ethers.utils.splitSignature(permitSignatureBytes);

  // create selfPermit call data
  const selfPermitData = orderProcessor.interface.encodeFunctionData("selfPermit", [
    paymentTokenAddress,
    permitMessage.owner,
    permitMessage.value,
    permitMessage.deadline,
    permitSignature.v,
    permitSignature.r,
    permitSignature.s
  ]);

  multiCallBytes.push(selfPermitData);



  // // createOrder call data
  // // see IOrderProcessor.Order struct for order parameters

  if (executedOrders.orders.length > 0) {

    for (const order of executedOrders.orders) {
      const requestOrderData = orderProcessor.interface.encodeFunctionData("createOrder", [[
        order?.orderParams.requestTimestamp,
        order?.orderParams.recipient,
        order?.orderParams.assetToken,
        order?.orderParams.paymentToken,
        order?.orderParams.sell,
        order?.orderParams.orderType,
        order?.orderParams.assetTokenQuantity,
        order?.orderParams.paymentTokenQuantity,
        order?.orderParams.price,
        order?.orderParams.tif,
      ], [
        order?.feeQuoteResponse.order_fee_contract_object.fee_quote.orderId,
        order?.feeQuoteResponse.order_fee_contract_object.fee_quote.requester,
        order?.feeQuoteResponse.order_fee_contract_object.fee_quote.fee,
        order?.feeQuoteResponse.order_fee_contract_object.fee_quote.timestamp,
        order?.feeQuoteResponse.order_fee_contract_object.fee_quote.deadline,
      ], order?.feeQuoteResponse.order_fee_contract_object.fee_quote_signature]);

      multiCallBytes.push(requestOrderData);
    }

    console.log(multiCallBytes, multiCallBytes.length, "length");
  } else {
    console.log("No orders");
  }

  // // submit permit + create order multicall transaction
  const tx = await orderProcessor.multicall(multiCallBytes);
  const receipt = await tx.wait();
  console.log(`tx hash: ${tx.hash}`);


  const orderEvents = receipt.logs
    .filter((log: any) => log.topics[0] === orderProcessor.interface.getEventTopic("OrderCreated"))
    .map((log: any) => orderProcessor.interface.parseLog(log));

  console.log(orderEvents, "order Events");
  if (orderEvents.length === 0) throw new Error("No OrderCreated events found");

  for (const [index, orderEvent] of orderEvents.entries()) {
    const orderId = orderEvent.args[0];
    const orderAccount = orderEvent.args[1];
    const orderStatusCode = await orderProcessor.getOrderStatus(orderId);

    // Map status code to label
    let orderStatusLabel = "Unknown";
    if (orderStatusCode === 1) orderStatusLabel = "Pending";
    else if (orderStatusCode === 2) orderStatusLabel = "Completed";

    console.log(`Order ${index + 1}:`);
    console.log(`- Order ID: ${orderId}`);
    console.log(`- Order Account: ${orderAccount}`);
    console.log(`- Order Status: ${orderStatusLabel} (${orderStatusCode})`);
  }


}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


