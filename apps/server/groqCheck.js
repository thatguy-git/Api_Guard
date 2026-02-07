import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load .env explicitly
dotenv.config();

const apiKey = process.env.GROQ_API_KEY;

console.log('--------------------------------------------------');
console.log('🔍 GROQ HEALTH CHECK');
console.log('--------------------------------------------------');

if (!apiKey) {
    console.error('❌ ERROR: GROQ_API_KEY is missing from .env');
    process.exit(1);
}

// Print first 4 chars to verify you are using the right key
console.log(`🔑 Key Loaded: ${apiKey.substring(0, 4)}...${apiKey.slice(-4)}`);

const client = new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
});

async function testGroq() {
    try {
        console.log('📡 Pinging Groq API...');
        const completion = await client.chat.completions.create({
            messages: [
                {
                    role: 'user',
                    content:
                        'Return the word "pong" in JSON format: {"ping": "pong"}',
                },
            ],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: 'json_object' },
        });

        console.log('✅ SUCCESS!');
        console.log('📝 Response:', completion.choices[0].message.content);
    } catch (error) {
        console.error('\n❌ CONNECTION FAILED');
        console.error('Status:', error.status);
        console.error('Code:', error.code);
        console.error('Type:', error.type);
        console.error('Message:', error.message);
    }
}

testGroq();
