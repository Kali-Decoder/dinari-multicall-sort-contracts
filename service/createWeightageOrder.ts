
import "dotenv/config";
import Dinari from '@dinari/api-sdk';
const accountId = "019814c3-64d2-7611-a4b7-dcc7c068f6ea";

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
    const portion = (asset.weightage / totalWeight) * totalDepositAmount;
    const paymentTokenQuantity = Math.floor(portion);

    const _order = {
      chain_id: 'eip155:11155111',
      order_side: 'BUY',
      order_tif: 'DAY',
      order_type: 'MARKET',
      stock_id: asset.stockId,
      payment_token: paymentTokenAddress,
      payment_token_quantity: paymentTokenQuantity,
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
module.exports= createWeightedOrders;


// createWeightedOrders(
//   accountId,
//   5000,
//   "0x665b099132d79739462DfDe6874126AFe840F7a3",
//   "0xdAF0182De86F904918Db8d07c7340A1EfcDF8244"
// );
