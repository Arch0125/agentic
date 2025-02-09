"use client";

import { useState } from 'react';

export default function Dashboard() {
  const username = "User123";
  const balance = 500;
  const [prompt, setPrompt] = useState("");
  const [responses, setResponses] = useState([]);

  const handleSendPrompt = async (event) => {
    event.preventDefault();
    try {
      const res = await fetch("http://localhost:3060/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt }),
      });
      if (!res.ok) {
        throw new Error("Network response was not ok");
      }
      const data = await res.json();
      // Expecting data in the format: { response: "some text" }
      if (data.response) {
        setResponses((prev) => [...prev, data.response]);
      }
    } catch (error) {
      console.error("Error sending prompt:", error);
    }
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
        {/* Bottom section: White background listing responses */}
        <div className="p-6 bg-white">
          <h3 className="text-xl font-bold mb-4">Responses</h3>
          {responses.length === 0 ? (
            <p className="text-gray-500">No responses yet.</p>
          ) : (
            <ul>
              {responses.map((resp, index) => (
                <li
                  key={index}
                  className="border-b border-gray-200 py-2 text-gray-800"
                >
                  {resp}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
