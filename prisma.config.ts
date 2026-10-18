import dotenv from 'dotenv';
dotenv.config();

export default {
  migrate: {
    databaseUrl: process.env.DATABASE_URL,
  },
};