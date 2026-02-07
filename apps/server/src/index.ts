import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import testRoutes from './routes/test.routes.js';
import './workers/worker.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(
    cors({
        origin: 'https://myfrontend.com',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    }),
);
app.use(express.json());

// Basic Health Check
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Resilience Engine Ready' });
});

// We will add routes here later
// app.use('/api/tests', testRoutes);
app.use('/api/tests', testRoutes);

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
