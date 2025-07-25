import "dotenv/config";
import { ethers } from "ethers";
import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const orderProcessorDataPath = path.resolve(__dirname, '../../lib/sbt-deployments/src/v0.4.0/order_processor.json');

const orderProcessorData = JSON.parse(fs.readFileSync(orderProcessorDataPath, 'utf8'));
const orderProcessorAbi = orderProcessorData.abi;


async function main() {

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("empty key");
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL) throw new Error("empty rpc url");



    let orderId = "50438270679946141550687030700144095769805958169587876758444056540810075161292";
    const provider = ethers.getDefaultProvider(RPC_URL);
    const signer = new ethers.Wallet(privateKey, provider);
    console.log(`Signer Address: ${signer.address}`);
    const chainId = Number((await provider.getNetwork()).chainId);
    const orderProcessorAddress = orderProcessorData.networkAddresses[chainId];
    console.log(`Order Processor Address: ${orderProcessorAddress}`);
    const orderProcessor = new ethers.Contract(
        orderProcessorAddress,
        orderProcessorAbi,
        signer,
    );
    const orderStatus = await orderProcessor.getOrderStatus(orderId);
    if (orderStatus == 1) {
        console.log(`- Order Pending : ${orderStatus}`);
    } else {
        console.log(`- Order Completed : ${orderStatus}`);
    }
}


main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
