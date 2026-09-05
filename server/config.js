import 'dotenv/config';

export const PORT = Number(process.env.PORT) || 3000;
export const REVOLAB_API_KEY = process.env.REVOLAB_API_KEY || '';
export const REVOLAB_BASE_URL = process.env.REVOLAB_BASE_URL || 'https://api.revolab.ai';
export const MOCK = process.env.MOCK === '1';
