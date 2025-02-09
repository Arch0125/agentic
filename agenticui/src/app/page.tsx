"use client";
import { useState } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [username, setUsername] = useState('');
  const router = useRouter();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    console.log('Username submitted:', username);

    try {
      // Create the prompt to mint a basename using the provided username
      const prompt = `mint basename using the name "${username}"`;
      
      // Make the POST request to the /prompt endpoint
      const response = await axios.post('http://localhost:3060/prompt', { prompt });
      console.log('Transaction successful:', response.data);
      
      // Navigate to the wallet page once the transaction is successful
      router.push('/wallet');
    } catch (error) {
      console.error('Error minting basename:', error);
      // Optionally add error handling or user feedback here
    }
  };

  return (
    <div className="min-h-screen bg-[#0052FF] flex flex-col items-center justify-center p-4">
      <h1 className="text-5xl font-bold text-white mb-8 text-center">
        Get onboard with new Digital Dollars
      </h1>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-center">
        <input
          type="text"
          placeholder="Enter your username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-64 p-3 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 mb-4 sm:mb-0 sm:mr-4 text-gray-800"
        />
        <button
          type="submit"
          className="px-6 py-3 bg-white text-[#0052FF] font-semibold rounded-full shadow hover:bg-gray-100 transition-colors"
        >
          Let's Go
        </button>
      </form>
    </div>
  );
}
