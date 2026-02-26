import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import testRoutes from './routes/test.routes.js';
import './workers/worker.js';

dotenv.config();
if (!process.env.PORT) {
    console.log('Port variable missing in environment');
}
const app = express();
const PORT = process.env.PORT;
app.use(helmet());
app.use(express.json({ limit: '100kb' }));

const CLIENT = process.env.CLIENT_BASE_URL;
app.use(
    cors({
        origin: CLIENT,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }),
);
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'API GUARD UP' });
});

app.use('/api/tests', testRoutes);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
