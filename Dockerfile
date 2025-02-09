# Use an official Bun image as the base (Bun comes preinstalled)
FROM oven/bun:latest

# Set the working directory in the container
WORKDIR /app

# Copy package manifests and lock file (if present)
COPY package.json .
COPY bun.lockb ./

# Install project dependencies using Bun
RUN bun install

# Copy the rest of your application code
COPY . .

# Set the required environment variables
ENV CDP_API_KEY_NAME="organizations/46fffcae-375d-4b92-9c1d-f2ae39344f1d/apiKeys/f0fbe048-7cd4-41e8-9600-f52926283185"
ENV CDP_API_KEY_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIMwx2R9XhM14eUhr5qkLnzmBYwsQh4jM/w3f6XiofJYvoAoGCCqGSM49\nAwEHoUQDQgAEBsBoy3u1DLXX9SaBELxkqPzCeHXFpqfFbAMbIh9QpRtElkS7mfRI\nbxJcfzcHIWv48/k+xhDDBaJvfU6XUXZkoA==\n-----END EC PRIVATE KEY-----\n"
ENV OPENAI_API_KEY="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"
ENV NETWORK_ID="base-sepolia"
ENV PVT_KEY="0xbc6be7d1a74b23117855c023c9012eda33542c17a948d43e3828d7f42a231b5b"

# Expose the port your Express server listens on
EXPOSE 3060

# Start the application using Bun
CMD ["bun", "run", "agent.ts"]
