import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  
  const url = process.env.VITE_UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.VITE_UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ error: 'Credenziali Upstash mancanti sul server.' });
  }

  const { command, args } = req.body;
  
  const redis = new Redis({ url, token });
  
  try {
    const result = await redis[command](...args);
    res.status(200).json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
