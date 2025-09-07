import Dinari from '@dinari/api-sdk';
import "dotenv/config";

async function main() {

    const dinariClient = new Dinari({
        apiKeyID: process.env.DINARI_API_KEY,
        apiSecretKey: process.env.DINARI_API_SECRET_KEY,
        environment: 'sandbox',
    });

    let status = await dinariClient.v2.accounts.orders.getFulfillments(
        '182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e',
        { account_id: '182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e' }
    );
    console.log(status,"status")


}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
