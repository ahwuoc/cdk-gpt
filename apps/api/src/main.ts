import { createApiApplication } from './app.factory';

const app = await createApiApplication();
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
