# 1. Use an official lightweight Node.js image
FROM node:20-alpine

# 2. Set the working directory inside the container
WORKDIR /app

# 3. Copy package dependency files first (optimizes Docker layer caching)
COPY package*.json ./

# 4. Install dependencies
RUN npm install

# 5. Copy the rest of your application files into the container
COPY . .

# 6. Expose the Vite dev-server port
EXPOSE 3000

# 7. Start the Vite dev server ("start" maps to "vite" in package.json)
CMD ["npm", "start"]
