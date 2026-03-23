import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './api/models/User.js';

dotenv.config();

const makeAdmin = async (email: string) => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || '');
    console.log('Connected to MongoDB');

    const user = await User.findOneAndUpdate(
      { email },
      { role: 'admin' },
      { new: true }
    );

    if (user) {
      console.log(`Success: User ${email} is now an ADMIN!`);
      console.log('Please log out and log in again in the application to see the Admin panel.');
    } else {
      console.log(`Error: User with email ${email} not found.`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

const emailArg = process.argv[2];
if (!emailArg) {
  console.log('Please provide the email address as an argument.');
  console.log('Example: npx tsx make-admin.ts admin@example.com');
  process.exit(1);
}

makeAdmin(emailArg);