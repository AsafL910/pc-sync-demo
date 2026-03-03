import { connect, NatsConnection } from 'nats';

export async function connectNats(serviceName: string, url: string): Promise<NatsConnection> {
    const nodeName = process.env.NODE_NAME || 'unknown';
    const maxRetries = 30;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const nc = await connect({
                servers: url,
                name: `${nodeName}-${serviceName}`
            });
            console.log(`[${nodeName}] ${serviceName} connected to NATS at ${url}`);
            return nc;
        } catch (err: any) {
            console.log(`[${nodeName}] NATS not ready for ${serviceName}, retry ${i + 1}/${maxRetries}... (${err.message})`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    throw new Error(`[${nodeName}] ${serviceName} failed to connect to NATS after ${maxRetries} attempts`);
}
