"use client";

import { useState } from 'react';

export default function Dashboard() {
  const username = "User123";
  const balance = 500;
  const [prompt, setPrompt] = useState("");
  const [transactions, setTransactions] = useState([
    { receiver: 'Alice', amount: 50 },
    { receiver: 'Bob', amount: -20 },
    { receiver: 'Charlie', amount: 100 },
  ]);

  const handleSendPrompt = (event) => {
    event.preventDefault();
    // Process the prompt as needed. For now, log to the console.
    console.log("Prompt submitted:", prompt);
    // Clear the prompt input after submission
    setPrompt("");
  };

  return (
    <div className="min-h-screen bg-gray-200 flex justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg overflow-hidden">
        {/* Top section: Blue background with user info and prompt input */}
        <div className="p-6 bg-blue-500 text-white">
          <div>
            <p className="text-lg font-semibold">Username: {username}</p>
            <p className="mt-2 text-xl font-bold">Balance: ${balance}</p>
          </div>
          <form onSubmit={handleSendPrompt} className="mt-4">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your prompt"
              className="w-full p-3 rounded-full text-blue-800 focus:outline-none"
            />
            <button
              type="submit"
              className="mt-3 w-full bg-white text-blue-500 font-semibold py-2 rounded-full shadow hover:bg-gray-100 transition-colors"
            >
              Send
            </button>
          </form>
        </div>
        {/* Bottom section: White background listing transactions */}
        <div className="p-6 bg-white">
          <h3 className="text-xl font-bold mb-4">Transactions</h3>
          <ul>
            {transactions.map((tx, index) => (
              <li
                key={index}
                className="flex justify-between items-center border-b border-gray-200 py-2"
              >
                <span>{tx.receiver}</span>
                <span
                  className={
                    tx.amount >= 0
                      ? "text-green-500 font-bold"
                      : "text-red-500 font-bold"
                  }
                >
                  {tx.amount >= 0
                    ? `+$${tx.amount}`
                    : `-$${Math.abs(tx.amount)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
